"""Data handling for Sea State Forecast: downloads, cache, evaluation and the card payloads."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import datetime, timezone
import gzip
import hashlib
import json
import logging
from pathlib import Path
import time
from typing import Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    BACKOFF_MINUTES,
    CACHE_DIR,
    CHUNK_PAUSE_SECONDS,
    CYCLONE_MINUTES,
    DOMAIN,
    EARTH_DAY_FALLBACK_MONTH,
    EARTH_DAY_URL,
    EARTH_DIR,
    EARTH_NIGHT_URL,
    HOME_NEAREST,
    LAND_MASK_DAYS,
    RATE_LIMIT_BACKOFF_MINUTES,
    SHARED_EARTH_DIRS,
    SOURCE_CYCLONES,
    SOURCE_DOWN_HOURS,
    SOURCE_LABELS,
    SOURCE_OCEAN,
    SOURCE_SPOTS,
    SOURCE_WEATHER,
    SPOT_MINUTES,
    STORAGE_KEY,
    STORAGE_VERSION,
    VERSION,
)
from .cyclones import GDACS_EVENTS_URL, closest_approach, parse_events, parse_track
from .grid import (
    CHUNK,
    OCEAN_VARS,
    SPOT_MARINE_VARS,
    SPOT_WX_VARS,
    WX_VARS,
    chunks,
    find_storms,
    frame_index,
    frame_times,
    ocean_points,
    ocean_url,
    pack_ocean,
    pack_weather,
    parse_ocean_chunk,
    parse_weather_chunk,
    as_list,
    spot_marine_url,
    spot_weather_url,
    weather_points,
    weather_url,
)
from .sharks import shark_info
from .spots import REGIONS, builtin_spots, parse_custom_spots
from .surf import evaluate_spot, nearest_spot

_LOGGER = logging.getLogger(__name__)

USER_AGENT = f"HomeAssistant-SeaState/{VERSION} (+https://github.com/mb26-dev/ha-sea-state)"
HTTP_TIMEOUT = aiohttp.ClientTimeout(total=90)
IMAGE_TIMEOUT = aiohttp.ClientTimeout(total=180)
MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]
SPOT_CHUNK = 100
MAX_CYCLONE_TRACKS = 8

# feed -> source that enables it
FEEDS = {
    "ocean": SOURCE_OCEAN,
    "weather": SOURCE_WEATHER,
    "spots": SOURCE_SPOTS,
    "cyclones": SOURCE_CYCLONES,
}


def _fingerprint(*parts: Any) -> str:
    """Short hash of the variables a feed asks for, to notice when an update changes them."""
    return hashlib.sha1(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:12]


# When a new version asks Open-Meteo for other variables, cached data of that feed is
# refreshed right after the start instead of waiting for the next regular update.
SCHEMAS = {
    "spots": _fingerprint(SPOT_MARINE_VARS, SPOT_WX_VARS),
    "ocean": _fingerprint(OCEAN_VARS),
    "weather": _fingerprint(WX_VARS),
}


class FeedError(Exception):
    """A download or parse problem of one feed."""

    def __init__(self, message: str, rate_limited: bool = False) -> None:
        super().__init__(message)
        self.rate_limited = rate_limited


class SeaStateData:
    """Downloads, caches and evaluates waves, weather, surf spots and cyclones."""

    def __init__(
        self,
        hass: HomeAssistant,
        sources: list[str],
        home_spot: str,
        custom_spots: str,
        firing: float,
        cyclone_radius_km: float,
        grid_hours: int,
    ) -> None:
        self.hass = hass
        self.sources = list(sources)
        self.home_spot_option = home_spot or HOME_NEAREST
        self.firing = float(firing)
        self.cyclone_radius_km = float(cyclone_radius_km)
        self.grid_hours = int(grid_hours)
        custom, bad = parse_custom_spots(custom_spots)
        if bad:
            _LOGGER.warning("Sea State Forecast: these custom spot lines could not be read: %s", bad)
        self.spots: list[dict[str, Any]] = builtin_spots() + custom
        self.spot_by_id = {s["id"]: s for s in self.spots}
        self.webcams_enabled = False
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.cache_dir = Path(hass.config.path(".storage", CACHE_DIR))
        self._lock = asyncio.Lock()
        self._grid_task: asyncio.Task | None = None
        self.on_change: Callable[[], None] | None = None

        self.feed_state: dict[str, dict[str, Any]] = {}
        self.land: set[int] = set()
        self.land_checked: float = 0.0
        self.ocean_packed: dict[str, Any] | None = None
        self.weather_packed: dict[str, Any] | None = None
        self.grid_version: int = 0
        self.grid_updated: float = 0.0
        self.spot_raw: dict[str, dict[str, Any]] = {}
        self.spot_eval: dict[str, dict[str, Any]] = {}
        self.cyclones: list[dict[str, Any]] = []
        self._tracks: dict[str, list[dict[str, Any]]] = {}
        self.storms: list[dict[str, Any]] = []
        self.home_spot: dict[str, Any] | None = None
        self.home_distance_km: float | None = None
        self.updated: float = 0.0
        self.payload_json: bytes | None = None
        self.payload_gzip: bytes | None = None
        self.grid_json: bytes | None = None
        self.grid_gzip: bytes | None = None

        # earth imagery
        self.earth_dir = Path(hass.config.path(".storage", EARTH_DIR))
        self.shared_dirs = [Path(hass.config.path(".storage", d)) for d in SHARED_EARTH_DIRS]
        self._earth_lock = asyncio.Lock()
        self._earth_retry = 0.0
        self.earth_day_file: Path | None = None
        self.earth_night_file: Path | None = None
        self._pick_home()

    # ------------------------------------------------------------------ setup

    def _pick_home(self) -> None:
        spot = self.spot_by_id.get(self.home_spot_option)
        lat, lon = self.hass.config.latitude, self.hass.config.longitude
        if spot is None:
            hit = nearest_spot(self.spots, lat, lon)
            spot = hit[0] if hit else None
        self.home_spot = spot
        if spot is not None:
            from .surf import haversine_km

            self.home_distance_km = round(haversine_km(lat, lon, spot["lat"], spot["lon"]), 1)

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            self.feed_state = stored.get("feeds") or {}
            self.land = set(stored.get("land") or [])
            self.land_checked = float(stored.get("land_checked") or 0)
            self.grid_version = int(stored.get("grid_version") or 0)
            self.grid_updated = float(stored.get("grid_updated") or 0)
            self._tracks = stored.get("tracks") or {}
        cache = await self.hass.async_add_executor_job(self._read_cache)
        if cache:
            self.ocean_packed = cache.get("ocean")
            self.weather_packed = cache.get("weather")
            self.spot_raw = cache.get("spots") or {}
            self.cyclones = cache.get("cyclones") or []
        cached_schemas = (cache or {}).get("schemas") or {}
        for feed, schema in SCHEMAS.items():
            if cached_schemas.get(feed) != schema and feed in self.feed_state:
                # keep showing the old data, but fetch it again now
                _LOGGER.debug("Sea State Forecast: %s data was cached by another version, refreshing", feed)
                self.feed_state[feed]["last_ok"] = 0
                self.feed_state[feed]["retry_after"] = 0
        await self.async_rebuild()

    def _cache_file(self) -> Path:
        return self.cache_dir / "cache.json.gz"

    def _read_cache(self) -> dict[str, Any] | None:
        path = self._cache_file()
        if not path.is_file():
            return None
        try:
            with gzip.open(path, "rt", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError) as err:
            _LOGGER.warning("Sea State Forecast cache could not be read, starting fresh: %s", err)
            return None

    def _write_cache(self, blob: dict[str, Any]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = self._cache_file().with_suffix(".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as fh:
            json.dump(blob, fh, separators=(",", ":"))
        tmp.replace(self._cache_file())

    async def _async_save(self) -> None:
        await self._store.async_save({
            "feeds": self.feed_state,
            "land": sorted(self.land),
            "land_checked": self.land_checked,
            "grid_version": self.grid_version,
            "grid_updated": self.grid_updated,
            "tracks": self._tracks,
        })
        blob = {
            "ocean": self.ocean_packed,
            "weather": self.weather_packed,
            "spots": self.spot_raw,
            "cyclones": self.cyclones,
            "schemas": SCHEMAS,
        }
        await self.hass.async_add_executor_job(self._write_cache, blob)

    # ------------------------------------------------------------------ feeds

    def _enabled(self, feed: str) -> bool:
        return FEEDS[feed] in self.sources

    def _interval_min(self, feed: str) -> float:
        if feed in ("ocean", "weather"):
            return self.grid_hours * 60
        if feed == "spots":
            return SPOT_MINUTES
        return CYCLONE_MINUTES

    def _due(self, feed: str, now: float) -> bool:
        st = self.feed_state.get(feed) or {}
        if now < float(st.get("retry_after") or 0):
            return False
        return now - float(st.get("last_ok") or 0) >= self._interval_min(feed) * 60

    def _ok(self, feed: str, now: float) -> None:
        st = self.feed_state.setdefault(feed, {})
        st.update({"last_ok": now, "last_attempt": now, "retry_after": 0, "error": None, "failing_since": None})

    def _fail(self, feed: str, now: float, err: FeedError | str) -> None:
        st = self.feed_state.setdefault(feed, {})
        rate_limited = isinstance(err, FeedError) and err.rate_limited
        minutes = RATE_LIMIT_BACKOFF_MINUTES if rate_limited else BACKOFF_MINUTES
        st["last_attempt"] = now
        st["error"] = str(err)[:300]
        st["retry_after"] = now + minutes * 60
        if not st.get("failing_since"):
            st["failing_since"] = now
        _LOGGER.warning("Sea State Forecast feed %s failed, next attempt in %s minutes: %s", feed, minutes, err)

    async def _get(self, url: str, binary: bool = False) -> Any:
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(
                url, timeout=HTTP_TIMEOUT, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
            ) as resp:
                if resp.status == 429:
                    raise FeedError("rate limited by the server (HTTP 429)", rate_limited=True)
                if resp.status != 200:
                    body = (await resp.text())[:200]
                    raise FeedError(f"HTTP {resp.status} {body}".strip())
                return await (resp.read() if binary else resp.text())
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise FeedError(str(err) or err.__class__.__name__) from err

    async def _get_json(self, url: str) -> Any:
        text = await self._get(url)
        try:
            return await self.hass.async_add_executor_job(json.loads, text)
        except ValueError as err:
            raise FeedError(f"invalid JSON: {err}") from err

    async def async_refresh(self, force: bool = False) -> None:
        """Download what is due. The global grid runs as its own background task."""
        async with self._lock:
            now = time.time()
            changed = False
            if self._enabled("spots") and (force or self._due("spots", now)):
                try:
                    await self._refresh_spots()
                    self._ok("spots", now)
                    changed = True
                except FeedError as err:
                    self._fail("spots", now, err)
                except (ValueError, TypeError, KeyError, IndexError) as err:
                    self._fail("spots", now, f"unexpected content: {err}")
            if self._enabled("cyclones") and (force or self._due("cyclones", now)):
                try:
                    await self._refresh_cyclones()
                    self._ok("cyclones", now)
                    changed = True
                except FeedError as err:
                    self._fail("cyclones", now, err)
                except (ValueError, TypeError, KeyError, IndexError) as err:
                    self._fail("cyclones", now, f"unexpected content: {err}")
            self.async_update_repairs()
            if changed:
                await self._async_save()
            await self.async_rebuild()
        self._maybe_start_grid(force)

    # ------------------------------------------------------------------ spots

    async def _refresh_spots(self) -> None:
        raw: dict[str, dict[str, Any]] = {}
        groups = chunks(self.spots, SPOT_CHUNK)
        for n, group in enumerate(groups):
            if n:
                await asyncio.sleep(CHUNK_PAUSE_SECONDS)
            marine = as_list(await self._get_json(spot_marine_url(group)), len(group))
            weather: list[dict[str, Any]] | None = None
            try:
                weather = as_list(await self._get_json(spot_weather_url(group)), len(group))
            except (FeedError, ValueError) as err:
                # waves alone still give a rating; the wind is rated neutral then
                _LOGGER.warning("Sea State Forecast: spot winds not available this time: %s", err)
            for i, spot in enumerate(group):
                raw[spot["id"]] = {"m": _slim(marine[i]), "w": _slim(weather[i]) if weather else None}
        self.spot_raw = raw

    # ------------------------------------------------------------------ cyclones

    async def _refresh_cyclones(self) -> None:
        now = datetime.now(timezone.utc)
        text = await self._get(GDACS_EVENTS_URL)
        events = await self.hass.async_add_executor_job(parse_events, text, now)
        keep: dict[str, list[dict[str, Any]]] = {}
        for cyc in events[:MAX_CYCLONE_TRACKS]:
            key = f"{cyc['eventid']}_{cyc['episodeid']}"
            track = self._tracks.get(key)
            if track is None:
                try:
                    gtext = await self._get(cyc["geometry_url"])
                    track = await self.hass.async_add_executor_job(parse_track, gtext, now)
                except (FeedError, ValueError, TypeError, KeyError) as err:
                    _LOGGER.debug("No track for cyclone %s: %s", cyc["name"], err)
                    track = []
            keep[key] = track
            # forecast flags move with time
            cyc["track"] = [{**p, "forecast": datetime.fromisoformat(p["time"]) > now} for p in track]
        self._tracks = keep
        self.cyclones = events

    # ------------------------------------------------------------------ global grid

    def _maybe_start_grid(self, force: bool) -> None:
        if self._grid_task and not self._grid_task.done():
            return
        now = time.time()
        due = [f for f in ("ocean", "weather") if self._enabled(f) and (force or self._due(f, now))]
        if not due:
            return
        self._grid_task = self.hass.async_create_background_task(self._run_grid(due), f"{DOMAIN}_grid")

    async def _run_grid(self, feeds: list[str]) -> None:
        start = time.time()
        frames = frame_times(start)
        changed = False
        if "ocean" in feeds:
            try:
                await self._fetch_ocean(frames)
                self._ok("ocean", start)
                changed = True
            except FeedError as err:
                self._fail("ocean", start, err)
            except (ValueError, TypeError, KeyError, IndexError) as err:
                self._fail("ocean", start, f"unexpected content: {err}")
        if "weather" in feeds:
            try:
                if changed:
                    await asyncio.sleep(CHUNK_PAUSE_SECONDS)
                await self._fetch_weather(frames)
                self._ok("weather", start)
                changed = True
            except FeedError as err:
                self._fail("weather", start, err)
            except (ValueError, TypeError, KeyError, IndexError) as err:
                self._fail("weather", start, f"unexpected content: {err}")
        if changed:
            self.grid_version += 1
            self.grid_updated = time.time()
        async with self._lock:
            self.async_update_repairs()
            await self._async_save()
            await self.async_rebuild()
        if self.on_change:
            self.on_change()

    async def _fetch_ocean(self, frames: list[int]) -> None:
        relearn = not self.land or time.time() - self.land_checked > LAND_MASK_DAYS * 86400
        points = [p for p in ocean_points() if relearn or p[0] not in self.land]
        values: dict[int, dict[str, list[Any]]] = {}
        land: set[int] = set()
        for n, group in enumerate(chunks(points, CHUNK)):
            if n:
                await asyncio.sleep(CHUNK_PAUSE_SECONDS)
            data = await self._get_json(ocean_url(group))
            vals, dry = await self.hass.async_add_executor_job(parse_ocean_chunk, data, group, frames)
            values.update(vals)
            land |= dry
        if relearn:
            self.land = land
            self.land_checked = time.time()
        else:
            self.land |= land
        self.ocean_packed = await self.hass.async_add_executor_job(pack_ocean, values, frames)
        _LOGGER.info("Sea State Forecast: global waves updated (%s ocean points)", len(values))

    async def _fetch_weather(self, frames: list[int]) -> None:
        values: dict[int, dict[str, list[Any]]] = {}
        for n, group in enumerate(chunks(weather_points(), CHUNK)):
            if n:
                await asyncio.sleep(CHUNK_PAUSE_SECONDS)
            data = await self._get_json(weather_url(group))
            values.update(await self.hass.async_add_executor_job(parse_weather_chunk, data, group, frames))
        self.weather_packed = await self.hass.async_add_executor_job(pack_weather, values, frames)
        _LOGGER.info("Sea State Forecast: global weather updated (%s points)", len(values))

    async def async_shutdown(self) -> None:
        if self._grid_task and not self._grid_task.done():
            self._grid_task.cancel()

    # ------------------------------------------------------------------ repairs

    def async_update_repairs(self) -> None:
        now = time.time()
        for feed, source in FEEDS.items():
            st = self.feed_state.get(feed) or {}
            since = float(st.get("failing_since") or 0)
            issue_id = f"source_down_{feed}"
            if source in self.sources and since and now - since >= SOURCE_DOWN_HOURS * 3600:
                ir.async_create_issue(
                    self.hass,
                    DOMAIN,
                    issue_id,
                    is_fixable=False,
                    severity=ir.IssueSeverity.WARNING,
                    translation_key="source_down",
                    translation_placeholders={"source": SOURCE_LABELS[source], "hours": str(SOURCE_DOWN_HOURS)},
                )
            else:
                ir.async_delete_issue(self.hass, DOMAIN, issue_id)

    # ------------------------------------------------------------------ building

    async def async_rebuild(self) -> None:
        await self.hass.async_add_executor_job(self._rebuild)

    def _rebuild(self) -> None:
        now = datetime.now(timezone.utc)
        evals: dict[str, dict[str, Any]] = {}
        if SOURCE_SPOTS in self.sources:
            for spot in self.spots:
                raw = self.spot_raw.get(spot["id"])
                if not raw:
                    continue
                try:
                    ev = evaluate_spot(spot, raw.get("m") or {}, raw.get("w"), now)
                except (TypeError, ValueError, KeyError, IndexError) as err:
                    _LOGGER.debug("Spot %s could not be evaluated: %s", spot["id"], err)
                    ev = None
                if ev:
                    evals[spot["id"]] = ev
        self.spot_eval = evals

        storms: list[dict[str, Any]] = []
        if self.weather_packed and SOURCE_WEATHER in self.sources:
            fi = frame_index(self.weather_packed.get("times") or [], now.timestamp())
            if fi is not None:
                storms = find_storms(self.weather_packed, fi, self.ocean_packed)
        self.storms = storms

        lat, lon = self.hass.config.latitude, self.hass.config.longitude
        cyclones = self.cyclones if SOURCE_CYCLONES in self.sources else []
        for cyc in cyclones:
            cyc.update(closest_approach(cyc, lat, lon))

        self.updated = now.timestamp()
        payload = {
            "version": VERSION,
            "updated": self.updated,
            "home": [lat, lon],
            "home_spot": self.home_spot["id"] if self.home_spot else None,
            "firing": self.firing,
            "grid_version": self.grid_version,
            "grid_updated": self.grid_updated,
            "sources": self.source_status(),
            "webcams": self.webcams_enabled,
            "cyclone_radius_km": self.cyclone_radius_km,
            "regions": REGIONS,
            "spots": [_card_spot(s, evals.get(s["id"])) for s in self.spots],
            "cyclones": cyclones,
            "storms": storms,
        }
        raw = json.dumps(payload, separators=(",", ":")).encode()
        self.payload_json = raw
        self.payload_gzip = gzip.compress(raw, 6)
        grid = {
            "version": self.grid_version,
            "updated": self.grid_updated,
            "ocean": self.ocean_packed if SOURCE_OCEAN in self.sources else None,
            "weather": self.weather_packed if SOURCE_WEATHER in self.sources else None,
        }
        graw = json.dumps(grid, separators=(",", ":")).encode()
        self.grid_json = graw
        self.grid_gzip = gzip.compress(graw, 6)

    def source_status(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for feed in FEEDS:
            st = self.feed_state.get(feed) or {}
            last_ok = st.get("last_ok")
            out[feed] = {
                "enabled": self._enabled(feed),
                "ok": bool(last_ok) and not st.get("error"),
                "last_ok": datetime.fromtimestamp(last_ok, tz=timezone.utc).isoformat() if last_ok else None,
                "error": st.get("error"),
            }
        out["ocean"]["running"] = bool(self._grid_task and not self._grid_task.done())
        return out

    # ------------------------------------------------------------------ earth

    def _scan_earth(self) -> None:
        month = dt_util.now().month
        self.earth_day_file = None
        self.earth_night_file = None
        folders = [self.earth_dir, *self.shared_dirs]
        for folder in folders:
            if not folder.is_dir():
                continue
            night = folder / "earth_night.jpg"
            if self.earth_night_file is None and night.is_file():
                self.earth_night_file = night
            current = folder / f"earth_day_{month:02d}.jpg"
            if self.earth_day_file is None and current.is_file():
                self.earth_day_file = current
        if self.earth_day_file is None:
            for folder in folders:
                files = sorted(folder.glob("earth_day_*.jpg")) if folder.is_dir() else []
                if files:
                    self.earth_day_file = files[-1]
                    break

    def earth_path(self, kind: str) -> Path | None:
        if kind == "day":
            return self.earth_day_file
        if kind == "night":
            return self.earth_night_file
        return None

    def earth_status(self) -> str:
        if self.earth_day_file and self.earth_night_file:
            return "ready"
        if self.earth_day_file or self.earth_night_file:
            return "partial"
        return "missing"

    async def async_ensure_earth(self) -> None:
        """Download the NASA day and night images once (Orbitarium's or Magmarium's copies are used when present)."""
        if time.time() < self._earth_retry or self._earth_lock.locked():
            return
        async with self._earth_lock:
            await self.hass.async_add_executor_job(self._scan_earth)
            month = dt_util.now().month
            have_day = self.earth_day_file is not None and self.earth_day_file.name == f"earth_day_{month:02d}.jpg"
            have_night = self.earth_night_file is not None
            if have_day and have_night:
                return
            await self.hass.async_add_executor_job(lambda: self.earth_dir.mkdir(parents=True, exist_ok=True))
            session = async_get_clientsession(self.hass)
            ok = True
            if not have_day:
                image = None
                for m in (month, EARTH_DAY_FALLBACK_MONTH):
                    image = await self._fetch_image(session, EARTH_DAY_URL.format(month_name=MONTH_NAMES[m - 1], month=m))
                    if image:
                        break
                if image:
                    await self.hass.async_add_executor_job(self._store_day_image, month, image)
                else:
                    ok = False
            if not have_night:
                image = await self._fetch_image(session, EARTH_NIGHT_URL)
                if image:
                    await self.hass.async_add_executor_job((self.earth_dir / "earth_night.jpg").write_bytes, image)
                else:
                    ok = False
            await self.hass.async_add_executor_job(self._scan_earth)
            if not ok:
                self._earth_retry = time.time() + 6 * 3600

    def _store_day_image(self, month: int, image: bytes) -> None:
        path = self.earth_dir / f"earth_day_{month:02d}.jpg"
        path.write_bytes(image)
        for old in self.earth_dir.glob("earth_day_*.jpg"):
            if old != path:
                old.unlink(missing_ok=True)

    async def _fetch_image(self, session: aiohttp.ClientSession, url: str) -> bytes | None:
        try:
            async with session.get(url, timeout=IMAGE_TIMEOUT, headers={"User-Agent": USER_AGENT}) as resp:
                if resp.status != 200:
                    return None
                body = await resp.read()
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            _LOGGER.warning("Could not download Earth image %s: %s", url, err)
            return None
        if len(body) < 50_000 or not body.startswith(b"\xff\xd8"):
            return None
        return body


def _slim(item: dict[str, Any] | None) -> dict[str, Any] | None:
    """Keep only what the evaluation needs from an Open-Meteo answer."""
    if not item:
        return None
    return {
        "utc_offset_seconds": item.get("utc_offset_seconds"),
        "elevation": item.get("elevation"),
        "latitude": item.get("latitude"),
        "longitude": item.get("longitude"),
        "hourly": item.get("hourly") or {},
    }


def _card_spot(spot: dict[str, Any], ev: dict[str, Any] | None) -> dict[str, Any]:
    out = {
        "id": spot["id"],
        "name": spot["name"],
        "area": spot["area"],
        "country": spot["country"],
        "lat": spot["lat"],
        "lon": spot["lon"],
        "kind": spot["kind"],
        "region": spot["region"],
        "swell_from": spot["swell_from"],
        "window": spot["window"],
        "offshore_from": spot["offshore_from"],
        "size": [spot["size_min"], spot["size_ideal"], spot["size_max"]],
        "custom": spot.get("custom", False),
        "sharks": shark_info(spot["id"]),
    }
    if ev:
        out.update({
            "now": ev["now"],
            "days": ev["days"],
            "tides": ev["tides"],
            "hourly": ev["hourly"],
            "next_good": ev["next_good"],
            "utc_offset": ev["utc_offset"],
        })
    return out
