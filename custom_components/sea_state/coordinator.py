"""Coordinator for Sea State Forecast."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN, UPDATE_INTERVAL_MINUTES
from .data import SeaStateData

_LOGGER = logging.getLogger(__name__)


class SeaStateCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Re-evaluates the spots every few minutes and downloads what is due."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, data: SeaStateData) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(minutes=UPDATE_INTERVAL_MINUTES),
        )
        self.store = data
        data.on_change = self._grid_done

    @callback
    def _grid_done(self) -> None:
        self.async_set_updated_data(self.snapshot())

    async def _async_update_data(self) -> dict[str, Any]:
        await self.store.async_refresh()
        if self.store.earth_status() != "ready":
            self.config_entry.async_create_background_task(
                self.hass, self.store.async_ensure_earth(), f"{DOMAIN}_earth_retry"
            )
        return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        s = self.store
        return {
            "spots": s.spots,
            "eval": s.spot_eval,
            "home_spot": s.home_spot,
            "home_distance_km": s.home_distance_km,
            "cyclones": s.cyclones,
            "storms": s.storms,
            "updated": s.updated,
            "grid_updated": s.grid_updated,
            "sources": s.source_status(),
        }

    def spot_state(self, spot_id: str) -> dict[str, Any] | None:
        return (self.data or {}).get("eval", {}).get(spot_id)
