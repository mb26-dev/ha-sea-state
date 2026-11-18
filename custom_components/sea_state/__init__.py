"""Sea State Forecast - live ocean, storms and surf on a living globe for Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path

from aiohttp import web

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.http import KEY_HASS
from homeassistant.helpers.typing import ConfigType

from .const import (
    CARD_FILE,
    CONF_CUSTOM_SPOTS,
    CONF_CYCLONE_RADIUS,
    CONF_FIRING,
    CONF_GRID_HOURS,
    CONF_HOME_SPOT,
    CONF_SOURCES,
    DEFAULT_CUSTOM_SPOTS,
    DEFAULT_CYCLONE_RADIUS,
    DEFAULT_FIRING,
    DEFAULT_GRID_HOURS,
    DEFAULT_HOME_SPOT,
    DEFAULT_SOURCES,
    DOMAIN,
    URL_DATA,
    URL_EARTH,
    URL_FRONTEND,
    URL_GRID,
    VERSION,
)
from .coordinator import SeaStateCoordinator
from .data import SeaStateData

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.BINARY_SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the frontend card and the API views once."""
    hass.data.setdefault(DOMAIN, {})
    frontend_dir = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_FRONTEND, str(frontend_dir), False)]
    )
    add_extra_js_url(hass, f"{URL_FRONTEND}/{CARD_FILE}?v={VERSION}")
    hass.http.register_view(SeaStateDataView())
    hass.http.register_view(SeaStateGridView())
    hass.http.register_view(SeaStateEarthView())
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Sea State Forecast from a config entry."""
    options = {**entry.data, **entry.options}
    data = SeaStateData(
        hass,
        options.get(CONF_SOURCES, DEFAULT_SOURCES),
        options.get(CONF_HOME_SPOT, DEFAULT_HOME_SPOT),
        options.get(CONF_CUSTOM_SPOTS, DEFAULT_CUSTOM_SPOTS),
        options.get(CONF_FIRING, DEFAULT_FIRING),
        options.get(CONF_CYCLONE_RADIUS, DEFAULT_CYCLONE_RADIUS),
        int(options.get(CONF_GRID_HOURS, DEFAULT_GRID_HOURS)),
    )
    await data.async_load()

    coordinator = SeaStateCoordinator(hass, entry, data)
    hass.data[DOMAIN]["data"] = data
    hass.data[DOMAIN][entry.entry_id] = coordinator

    # start with the cached data, the downloads run in the background so startup is never blocked
    coordinator.async_set_updated_data(coordinator.snapshot())
    entry.async_create_background_task(hass, coordinator.async_refresh(), f"{DOMAIN}_initial_refresh")
    entry.async_create_background_task(hass, data.async_ensure_earth(), f"{DOMAIN}_earth")

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        data: SeaStateData | None = hass.data[DOMAIN].pop("data", None)
        if data:
            await data.async_shutdown()
    return unloaded


def _json_response(request: web.Request, raw: bytes | None, gz: bytes | None, missing: str) -> web.Response:
    if raw is None or gz is None:
        return web.json_response({"error": missing}, status=503)
    headers = {"Cache-Control": "no-cache", "Content-Type": "application/json"}
    if "gzip" in request.headers.get("Accept-Encoding", ""):
        headers["Content-Encoding"] = "gzip"
        return web.Response(body=gz, headers=headers)
    return web.Response(body=raw, headers=headers)


class SeaStateDataView(HomeAssistantView):
    """Spots, cyclones and storms for the card."""

    url = URL_DATA
    name = "api:sea_state:data"
    requires_auth = True

    @callback
    def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app[KEY_HASS]
        data: SeaStateData | None = hass.data.get(DOMAIN, {}).get("data")
        if data is None:
            return web.json_response({"error": "Sea State Forecast is not configured"}, status=404)
        return _json_response(request, data.payload_json, data.payload_gzip, "Data not loaded yet")


class SeaStateGridView(HomeAssistantView):
    """Global wave and weather frames for the card."""

    url = URL_GRID
    name = "api:sea_state:grid"
    requires_auth = True

    @callback
    def get(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app[KEY_HASS]
        data: SeaStateData | None = hass.data.get(DOMAIN, {}).get("data")
        if data is None:
            return web.json_response({"error": "Sea State Forecast is not configured"}, status=404)
        return _json_response(request, data.grid_json, data.grid_gzip, "Grid not loaded yet")


class SeaStateEarthView(HomeAssistantView):
    """Serve the NASA Earth images (day and night) for the globe."""

    url = URL_EARTH
    name = "api:sea_state:earth"
    requires_auth = True

    async def get(self, request: web.Request, kind: str) -> web.StreamResponse:
        hass: HomeAssistant = request.app[KEY_HASS]
        data: SeaStateData | None = hass.data.get(DOMAIN, {}).get("data")
        if data is None:
            return web.json_response({"error": "Sea State Forecast is not configured"}, status=404)
        path = data.earth_path(kind)
        if path is None:
            return web.json_response({"error": "Earth image not downloaded yet"}, status=503)
        return web.FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})
