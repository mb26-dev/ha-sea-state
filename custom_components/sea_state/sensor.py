"""Sensors for Sea State Forecast."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory, UnitOfLength, UnitOfSpeed, UnitOfTemperature, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_FIRING, CONF_WATCHED, DEFAULT_FIRING, DEFAULT_WATCHED, DOMAIN
from .coordinator import SeaStateCoordinator
from .cyclones import CATEGORY_LABELS
from .entity import SeaStateEntity
from .sharks import shark_info
from .surf import CONDITIONS, DOUGLAS_LABELS

MAX_LIST = 25
SEA_STATES = list(DOUGLAS_LABELS)


def _spot_attrs(spot: dict[str, Any], ev: dict[str, Any] | None) -> dict[str, Any]:
    attrs: dict[str, Any] = {
        "spot": spot["name"],
        "area": spot["area"],
        "country": spot["country"],
        "latitude": spot["lat"],
        "longitude": spot["lon"],
        "break": spot["kind"],
        "swell_window_from": spot["swell_from"],
        "offshore_wind_from": spot["offshore_from"],
    }
    sharks = shark_info(spot["id"])
    if sharks:
        attrs["shark_species"] = sharks["species"]
        if sharks["measures"]:
            attrs["shark_measures"] = sharks["measures"]
        if sharks["service"]:
            attrs["shark_service"] = sharks["service"]["name"]
            attrs["shark_service_url"] = sharks["service"]["url"]
    if not ev:
        return attrs
    now = ev["now"]
    today = ev["days"][0] if ev["days"] else {}
    attrs.update({
        "condition": now["condition"],
        "surf_m": now["surf_m"],
        "wave_height_m": now["wave_height_m"],
        "swell_m": now["swell_m"],
        "swell_period_s": now["swell_period"],
        "swell_from": now["swell_dir"],
        "secondary_swell_m": now["swell2_m"],
        "secondary_swell_period_s": now["swell2_period"],
        "secondary_swell_from": now["swell2_dir"],
        "wind_kmh": now["wind_kmh"],
        "wind_from": now["wind_dir"],
        "gust_kmh": now["gust_kmh"],
        "wind": now["wind_kind"],
        "beaufort": now["beaufort"],
        "water_temperature_c": now["water_c"],
        "wetsuit": now["wetsuit"],
        "sea_state": now["sea_state"],
        "douglas": now["douglas"],
        "best_today": f"{today.get('best_from')}-{today.get('best_to')}" if today else None,
        "best_today_rating": today.get("rating"),
        "next_good_session": ev["next_good"],
        "tides": ev["tides"],
        "forecast": [
            {
                "date": d["date"],
                "rating": d["rating"],
                "condition": d["condition"],
                "surf_m": f"{d['surf_min']}-{d['surf_max']}",
                "best": f"{d['best_from']}-{d['best_to']}",
                "wind_kmh": d["wind_kmh"],
            }
            for d in ev["days"]
        ],
    })
    return attrs


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: SeaStateCoordinator = hass.data[DOMAIN][entry.entry_id]
    options = {**entry.data, **entry.options}
    firing = float(options.get(CONF_FIRING, DEFAULT_FIRING))
    entities: list[SensorEntity] = [
        HomeRatingSensor(coordinator, entry),
        HomeConditionSensor(coordinator, entry),
        HomeValueSensor(coordinator, entry, "home_surf", "surf_m", SensorDeviceClass.DISTANCE, UnitOfLength.METERS, "mdi:waves", 1),
        HomeValueSensor(coordinator, entry, "home_swell_period", "swell_period", SensorDeviceClass.DURATION, UnitOfTime.SECONDS, "mdi:sine-wave", 0),
        HomeValueSensor(coordinator, entry, "home_wind", "wind_kmh", SensorDeviceClass.WIND_SPEED, UnitOfSpeed.KILOMETERS_PER_HOUR, "mdi:weather-windy", 0),
        HomeValueSensor(coordinator, entry, "home_water_temperature", "water_c", SensorDeviceClass.TEMPERATURE, UnitOfTemperature.CELSIUS, "mdi:thermometer-water", 1),
        HomeSeaStateSensor(coordinator, entry),
        HomeTideSensor(coordinator, entry),
        FiringSensor(coordinator, entry, firing),
        BestSpotSensor(coordinator, entry),
        CycloneCountSensor(coordinator, entry),
        NearestCycloneSensor(coordinator, entry),
        GaleSensor(coordinator, entry),
        StatusSensor(coordinator, entry),
    ]
    spot_ids = {s["id"] for s in coordinator.store.spots}
    for spot_id in options.get(CONF_WATCHED, DEFAULT_WATCHED) or []:
        if spot_id in spot_ids:
            entities.append(SpotRatingSensor(coordinator, entry, spot_id))
    async_add_entities(entities)


class _HomeMixin:
    coordinator: SeaStateCoordinator

    def _home(self) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        spot = (self.coordinator.data or {}).get("home_spot")
        if not spot:
            return None, None
        return spot, self.coordinator.spot_state(spot["id"])


class HomeRatingSensor(_HomeMixin, SeaStateEntity, SensorEntity):
    """Surf rating of the home spot, 0 to 5 stars."""

    _attr_translation_key = "home_rating"
    _attr_icon = "mdi:surfing"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "home_rating")

    @property
    def native_value(self) -> float | None:
        _spot, ev = self._home()
        return ev["now"]["rating"] if ev else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        spot, ev = self._home()
        if not spot:
            return {}
        attrs = _spot_attrs(spot, ev)
        attrs["distance_from_home_km"] = (self.coordinator.data or {}).get("home_distance_km")
        return attrs


class HomeConditionSensor(_HomeMixin, SeaStateEntity, SensorEntity):
    """Surf condition of the home spot: flat, poor, fair, good, epic, blown out or too big."""

    _attr_translation_key = "home_condition"
    _attr_icon = "mdi:surfing"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = CONDITIONS

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "home_condition")

    @property
    def native_value(self) -> str | None:
        _spot, ev = self._home()
        return ev["now"]["condition"] if ev else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        spot, ev = self._home()
        if not spot:
            return {}
        return {"spot": spot["name"], "pose": ev["now"]["pose"] if ev else None}


class HomeValueSensor(_HomeMixin, SeaStateEntity, SensorEntity):
    """One number of the home spot."""

    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self,
        coordinator: SeaStateCoordinator,
        entry: ConfigEntry,
        key: str,
        field: str,
        device_class: SensorDeviceClass,
        unit: str,
        icon: str,
        precision: int,
    ) -> None:
        super().__init__(coordinator, entry, key)
        self._field = field
        self._attr_translation_key = key
        self._attr_device_class = device_class
        self._attr_native_unit_of_measurement = unit
        self._attr_icon = icon
        self._attr_suggested_display_precision = precision

    @property
    def native_value(self) -> float | None:
        _spot, ev = self._home()
        if not ev:
            return None
        return ev["now"].get(self._field)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        spot, ev = self._home()
        if not spot:
            return {}
        attrs: dict[str, Any] = {"spot": spot["name"]}
        if ev and self._field == "wind_kmh":
            now = ev["now"]
            attrs.update({"from": now["wind_dir"], "gust_kmh": now["gust_kmh"], "wind": now["wind_kind"], "beaufort": now["beaufort"]})
        if ev and self._field == "water_c":
            attrs["wetsuit"] = ev["now"]["wetsuit"]
        if ev and self._field == "swell_period":
            attrs.update({"swell_m": ev["now"]["swell_m"], "swell_from": ev["now"]["swell_dir"]})
        return attrs


class HomeSeaStateSensor(_HomeMixin, SeaStateEntity, SensorEntity):
    """Douglas sea state at the home spot."""

    _attr_translation_key = "home_sea_state"
    _attr_icon = "mdi:waves-arrow-up"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = SEA_STATES

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "home_sea_state")

    @property
    def native_value(self) -> str | None:
        _spot, ev = self._home()
        return ev["now"]["sea_state"] if ev else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        spot, ev = self._home()
        if not spot or not ev:
            return {}
        return {"spot": spot["name"], "douglas": ev["now"]["douglas"], "wave_height_m": ev["now"]["wave_height_m"]}


class HomeTideSensor(_HomeMixin, SeaStateEntity, SensorEntity):
    """Next high or low tide at the home spot (model sea level)."""

    _attr_translation_key = "home_next_tide"
    _attr_icon = "mdi:waves-arrow-left"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "home_next_tide")

    def _next(self) -> dict[str, Any] | None:
        _spot, ev = self._home()
        tides = (ev or {}).get("tides") or []
        return tides[0] if tides else None

    @property
    def native_value(self) -> datetime | None:
        nxt = self._next()
        if not nxt:
            return None
        return datetime.fromtimestamp(nxt["time"], tz=timezone.utc)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        _spot, ev = self._home()
        nxt = self._next()
        if not nxt:
            return {}
        return {
            "kind": nxt["kind"],
            "level_m": nxt["level_m"],
            "upcoming": [
                {"kind": t["kind"], "time": datetime.fromtimestamp(t["time"], tz=timezone.utc).isoformat(), "level_m": t["level_m"]}
                for t in (ev or {}).get("tides") or []
            ],
            "note": "From the global ocean model; local harbour tables can differ.",
        }


class FiringSensor(SeaStateEntity, SensorEntity):
    """Number of spots at or above the firing rating right now."""

    _attr_translation_key = "spots_firing"
    _attr_icon = "mdi:fire"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "spots"

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry, firing: float) -> None:
        super().__init__(coordinator, entry, "spots_firing")
        self._firing = firing

    def _list(self) -> list[tuple[dict[str, Any], dict[str, Any]]]:
        data = self.coordinator.data or {}
        evals = data.get("eval", {})
        out = [(s, evals[s["id"]]) for s in data.get("spots", []) if s["id"] in evals and evals[s["id"]]["now"]["rating"] >= self._firing]
        out.sort(key=lambda x: x[1]["now"]["rating"], reverse=True)
        return out

    @property
    def native_value(self) -> int:
        return len(self._list())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "threshold": self._firing,
            "spots": [
                {"spot": s["name"], "country": s["country"], "rating": ev["now"]["rating"], "condition": ev["now"]["condition"], "surf_m": ev["now"]["surf_m"]}
                for s, ev in self._list()[:MAX_LIST]
            ],
        }


class BestSpotSensor(SeaStateEntity, SensorEntity):
    """The best rated spot on the planet right now."""

    _attr_translation_key = "best_spot"
    _attr_icon = "mdi:trophy"

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "best_spot")

    def _best(self) -> tuple[dict[str, Any], dict[str, Any]] | None:
        data = self.coordinator.data or {}
        evals = data.get("eval", {})
        ranked = [(s, evals[s["id"]]) for s in data.get("spots", []) if s["id"] in evals]
        if not ranked:
            return None
        return max(ranked, key=lambda x: (x[1]["now"]["rating"], x[1]["now"]["surf_m"]))

    @property
    def native_value(self) -> str | None:
        best = self._best()
        return best[0]["name"] if best else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        best = self._best()
        if not best:
            return {}
        spot, ev = best
        return {"country": spot["country"], "area": spot["area"], "rating": ev["now"]["rating"], "condition": ev["now"]["condition"], "surf_m": ev["now"]["surf_m"], "swell_period_s": ev["now"]["swell_period"]}


class CycloneCountSensor(SeaStateEntity, SensorEntity):
    """Active tropical cyclones worldwide (GDACS)."""

    _attr_translation_key = "cyclones"
    _attr_icon = "mdi:weather-hurricane"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "cyclones"

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "cyclones")

    @property
    def native_value(self) -> int:
        return len((self.coordinator.data or {}).get("cyclones") or [])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "cyclones": [
                {
                    "name": c["name"],
                    "kind": c["kind"],
                    "category": CATEGORY_LABELS.get(c["category_key"], c["category_key"]),
                    "wind_kmh": c["wind_kmh"],
                    "alert": c["alert"],
                    "latitude": c["lat"],
                    "longitude": c["lon"],
                    "distance_km": c.get("now_km"),
                    "url": c["report_url"],
                }
                for c in ((self.coordinator.data or {}).get("cyclones") or [])[:MAX_LIST]
            ]
        }


class NearestCycloneSensor(SeaStateEntity, SensorEntity):
    """Nearest tropical cyclone to home, now or along its forecast track."""

    _attr_translation_key = "nearest_cyclone"
    _attr_icon = "mdi:weather-hurricane"

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "nearest_cyclone")

    def _nearest(self) -> dict[str, Any] | None:
        cyclones = (self.coordinator.data or {}).get("cyclones") or []
        if not cyclones:
            return None
        return min(cyclones, key=lambda c: c.get("closest_km") or 1e9)

    @property
    def native_value(self) -> str | None:
        c = self._nearest()
        return c["name"] if c else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        c = self._nearest()
        if not c:
            return {}
        return {
            "kind": c["kind"],
            "category": CATEGORY_LABELS.get(c["category_key"], c["category_key"]),
            "wind_kmh": c["wind_kmh"],
            "alert": c["alert"],
            "distance_km": c.get("now_km"),
            "closest_approach_km": c.get("closest_km"),
            "closest_approach_time": c.get("closest_time"),
            "latitude": c["lat"],
            "longitude": c["lon"],
            "url": c["report_url"],
        }


class GaleSensor(SeaStateEntity, SensorEntity):
    """Areas at sea with gale force winds (Beaufort 8 or more) right now."""

    _attr_translation_key = "gale_areas"
    _attr_icon = "mdi:weather-windy-variant"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "areas"

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "gale_areas")

    def _list(self) -> list[dict[str, Any]]:
        return [s for s in (self.coordinator.data or {}).get("storms") or [] if s.get("at_sea")]

    @property
    def native_value(self) -> int:
        return len(self._list())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"areas": self._list()[:MAX_LIST]}


class StatusSensor(SeaStateEntity, SensorEntity):
    """Health of the data sources."""

    _attr_translation_key = "status"
    _attr_icon = "mdi:database-check"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = ["ok", "degraded", "waiting"]

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator, entry, "status")

    @property
    def native_value(self) -> str:
        sources = (self.coordinator.data or {}).get("sources", {})
        enabled = [s for s in sources.values() if s["enabled"]]
        if not enabled or all(not s["last_ok"] for s in enabled):
            return "waiting"
        if any(s["error"] for s in enabled):
            return "degraded"
        return "ok"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data or {}
        store = self.coordinator.store
        return {
            "feeds": data.get("sources", {}),
            "spots": len(store.spots),
            "spots_with_data": len(store.spot_eval),
            "ocean_points": len([v for v in ((store.ocean_packed or {}).get("frames") or [{}])[0].get("h", []) if v is not None]),
            "land_points": len(store.land),
            "grid_version": store.grid_version,
            "earth_imagery": store.earth_status(),
        }


class SpotRatingSensor(SeaStateEntity, SensorEntity):
    """Surf rating of one watched spot."""

    _attr_translation_key = "spot_rating"
    _attr_icon = "mdi:surfing"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(self, coordinator: SeaStateCoordinator, entry: ConfigEntry, spot_id: str) -> None:
        super().__init__(coordinator, entry, f"spot_{spot_id}")
        self._spot_id = spot_id
        spot = coordinator.store.spot_by_id[spot_id]
        self._attr_translation_placeholders = {"spot": spot["name"]}

    @property
    def native_value(self) -> float | None:
        ev = self.coordinator.spot_state(self._spot_id)
        return ev["now"]["rating"] if ev else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        spot = self.coordinator.store.spot_by_id[self._spot_id]
        return _spot_attrs(spot, self.coordinator.spot_state(self._spot_id))
