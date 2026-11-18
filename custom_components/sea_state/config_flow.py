"""Config flow for Sea State Forecast."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_CUSTOM_SPOTS,
    CONF_CYCLONE_RADIUS,
    CONF_FIRING,
    CONF_GRID_HOURS,
    CONF_HOME_SPOT,
    CONF_SOURCES,
    CONF_WATCHED,
    CONF_WINDY_KEY,
    DEFAULT_CUSTOM_SPOTS,
    DEFAULT_CYCLONE_RADIUS,
    DEFAULT_FIRING,
    DEFAULT_GRID_HOURS,
    DEFAULT_HOME_SPOT,
    DEFAULT_SOURCES,
    DEFAULT_WATCHED,
    DOMAIN,
    GRID_HOURS_OPTIONS,
    HOME_NEAREST,
    NAME,
    SOURCE_LABELS,
    SOURCES,
)
from .spots import builtin_spots, parse_custom_spots
from .webcams import WebcamClient, WebcamError


def _spot_options(custom_text: str | None) -> list[SelectOptionDict]:
    custom, _bad = parse_custom_spots(custom_text)
    spots = sorted(builtin_spots(), key=lambda s: (s["country"], s["name"])) + custom
    return [
        SelectOptionDict(value=s["id"], label=f"{s['name']} ({s['country']})" if s["country"] else s["name"])
        for s in spots
    ]


def _schema(defaults: dict[str, Any]) -> vol.Schema:
    custom_text = defaults.get(CONF_CUSTOM_SPOTS, DEFAULT_CUSTOM_SPOTS)
    spot_options = _spot_options(custom_text)
    return vol.Schema(
        {
            vol.Required(CONF_SOURCES, default=defaults.get(CONF_SOURCES, DEFAULT_SOURCES)): SelectSelector(
                SelectSelectorConfig(
                    options=[SelectOptionDict(value=key, label=SOURCE_LABELS[key]) for key in SOURCES],
                    multiple=True,
                    mode=SelectSelectorMode.LIST,
                )
            ),
            vol.Required(CONF_HOME_SPOT, default=defaults.get(CONF_HOME_SPOT, DEFAULT_HOME_SPOT)): SelectSelector(
                SelectSelectorConfig(
                    options=[SelectOptionDict(value=HOME_NEAREST, label="Nearest spot to home"), *spot_options],
                    mode=SelectSelectorMode.DROPDOWN,
                )
            ),
            vol.Optional(CONF_WATCHED, default=defaults.get(CONF_WATCHED, DEFAULT_WATCHED)): SelectSelector(
                SelectSelectorConfig(options=spot_options, multiple=True, mode=SelectSelectorMode.DROPDOWN)
            ),
            vol.Optional(CONF_FIRING, default=defaults.get(CONF_FIRING, DEFAULT_FIRING)): NumberSelector(
                NumberSelectorConfig(min=1, max=5, step=0.5, mode=NumberSelectorMode.SLIDER)
            ),
            vol.Optional(
                CONF_CYCLONE_RADIUS, default=defaults.get(CONF_CYCLONE_RADIUS, DEFAULT_CYCLONE_RADIUS)
            ): NumberSelector(
                NumberSelectorConfig(min=100, max=3000, step=50, unit_of_measurement="km", mode=NumberSelectorMode.BOX)
            ),
            vol.Optional(CONF_GRID_HOURS, default=str(defaults.get(CONF_GRID_HOURS, DEFAULT_GRID_HOURS))): SelectSelector(
                SelectSelectorConfig(
                    options=[SelectOptionDict(value=h, label=f"Every {h} hours") for h in GRID_HOURS_OPTIONS],
                    mode=SelectSelectorMode.DROPDOWN,
                )
            ),
            vol.Optional(CONF_CUSTOM_SPOTS, default=custom_text): TextSelector(TextSelectorConfig(multiline=True)),
            vol.Optional(CONF_WINDY_KEY, default=defaults.get(CONF_WINDY_KEY, "")): TextSelector(
                TextSelectorConfig(type=TextSelectorType.PASSWORD)
            ),
        }
    )


def _validate(user_input: dict[str, Any]) -> dict[str, str]:
    errors: dict[str, str] = {}
    if not user_input.get(CONF_SOURCES):
        errors[CONF_SOURCES] = "no_sources"
    _spots, bad = parse_custom_spots(user_input.get(CONF_CUSTOM_SPOTS))
    if bad:
        errors[CONF_CUSTOM_SPOTS] = "bad_custom_spots"
    return errors


async def _validate_key(hass, user_input: dict[str, Any], errors: dict[str, str]) -> None:
    """Check the optional Windy webcams key once, so a typo shows up in the form."""
    key = (user_input.get(CONF_WINDY_KEY) or "").strip()
    user_input[CONF_WINDY_KEY] = key
    if not key or errors:
        return
    try:
        await WebcamClient(async_get_clientsession(hass), key).async_check_key()
    except WebcamError as err:
        errors[CONF_WINDY_KEY] = "bad_windy_key" if err.reason == "invalid_key" else "windy_unreachable"


class SeaStateConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the initial setup."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = _validate(user_input)
            await _validate_key(self.hass, user_input, errors)
            if not errors:
                return self.async_create_entry(title=NAME, data=user_input)
        return self.async_show_form(step_id="user", data_schema=_schema(user_input or {}), errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return SeaStateOptionsFlow()


class SeaStateOptionsFlow(OptionsFlow):
    """Change sources, spots and thresholds."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            errors = _validate(user_input)
            await _validate_key(self.hass, user_input, errors)
            if not errors:
                return self.async_create_entry(data=user_input)
        current = {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(step_id="init", data_schema=_schema(user_input or current), errors=errors)
