"""Binary sensors for Sea State Forecast."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_CYCLONE_RADIUS, CONF_FIRING, DEFAULT_CYCLONE_RADIUS, DEFAULT_FIRING, DOMAIN
from .coordinator import SeaStateCoordinator
from .cyclones import CATEGORY_LABELS
from .entity import SeaStateEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: SeaStateCoordinator = hass.data[DOMAIN][entry.entry_id]
    options = {**entry.data, **entry.options}
    async_add_entities([
        HomeFiringSensor(coordinator, entry, float(options.get(CONF_FIRING, DEFAULT_FIRING))),
        CycloneNearbySensor(coordinator, entry, float(options.get(CONF_CYCLONE_RADIUS, DEFAULT_CYCLONE_RADIUS))),
    ])


class HomeFiringSensor(SeaStateEntity, BinarySensorEntity):
    """On while the home spot rates at or above the firing threshold."""

    _attr_translation_key = "home_firing"
    _attr_icon = "mdi:surfing"

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry, firing: float) -> None:
        super().__init__(coordinator, entry, "home_firing")
        self._firing = firing

    def _ev(self) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        spot = (self.coordinator.data or {}).get("home_spot")
        return spot, self.coordinator.spot_state(spot["id"]) if spot else None

    @property
    def is_on(self) -> bool | None:
        _spot, ev = self._ev()
        if not ev:
            return None
        return ev["now"]["rating"] >= self._firing

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        spot, ev = self._ev()
        if not spot:
            return {}
        attrs: dict[str, Any] = {"spot": spot["name"], "threshold": self._firing}
        if ev:
            now = ev["now"]
            today = ev["days"][0] if ev["days"] else {}
            attrs.update({
                "rating": now["rating"],
                "condition": now["condition"],
                "surf_m": now["surf_m"],
                "swell_m": now["swell_m"],
                "swell_period_s": now["swell_period"],
                "wind_kmh": now["wind_kmh"],
                "wind": now["wind_kind"],
                "best_today": f"{today.get('best_from')}-{today.get('best_to')}" if today else None,
                "next_good_session": ev["next_good"],
            })
        return attrs


class CycloneNearbySensor(SeaStateEntity, BinarySensorEntity):
    """On while a tropical cyclone is, or is forecast to be, within the radius of home."""

    _attr_translation_key = "cyclone_nearby"
    _attr_device_class = BinarySensorDeviceClass.SAFETY

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry, radius_km: float) -> None:
        super().__init__(coordinator, entry, "cyclone_nearby")
        self._radius = radius_km

    def _hits(self) -> list[dict[str, Any]]:
        cyclones = (self.coordinator.data or {}).get("cyclones") or []
        return sorted(
            [c for c in cyclones if (c.get("closest_km") or 1e9) <= self._radius],
            key=lambda c: c.get("closest_km") or 1e9,
        )

    @property
    def is_on(self) -> bool:
        return bool(self._hits())

    @property
    def icon(self) -> str:
        return "mdi:weather-hurricane" if self.is_on else "mdi:weather-hurricane-outline"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        hits = self._hits()
        attrs: dict[str, Any] = {"radius_km": self._radius}
        if hits:
            c = hits[0]
            attrs.update({
                "name": c["name"],
                "kind": c["kind"],
                "category": CATEGORY_LABELS.get(c["category_key"], c["category_key"]),
                "wind_kmh": c["wind_kmh"],
                "alert": c["alert"],
                "distance_km": c.get("now_km"),
                "closest_approach_km": c.get("closest_km"),
                "closest_approach_time": c.get("closest_time"),
                "url": c["report_url"],
            })
        return attrs
