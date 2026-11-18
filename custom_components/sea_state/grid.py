"""Global ocean and weather grids from Open-Meteo (pure, no Home Assistant imports).

Two coarse grids cover the globe:

* the ocean grid (Open-Meteo Marine API): wave height, direction, period and wind sea
* the weather grid (Open-Meteo Forecast API): wind, clouds, rain and air pressure

Land points of the ocean grid are learnt from the first answer (the marine model has
no data there) and skipped afterwards. Requests are split into chunks so the free
Open-Meteo limits (600 calls per minute, 10,000 per day) are respected; every
location in a request counts as one call.
"""

from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any
from urllib.parse import urlencode

MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# ocean grid: 6 degrees, 26 x 60 points
OCEAN_LAT0, OCEAN_STEP, OCEAN_NLAT, OCEAN_NLON = -72.0, 6.0, 26, 60
# weather grid: 9 degrees, 19 x 40 points
WX_LAT0, WX_STEP, WX_NLAT, WX_NLON = -81.0, 9.0, 19, 40
LON0 = -180.0

FRAME_STEP_H = 3
FRAME_COUNT = 17  # now and every 3 hours up to +48 h
CHUNK = 200

OCEAN_VARS = ["wave_height", "wave_direction", "wave_period", "wind_wave_height"]
WX_VARS = ["wind_speed_10m", "wind_direction_10m", "cloud_cover", "precipitation", "pressure_msl"]
SPOT_MARINE_VARS = [
    "wave_height",
    "wind_wave_height",
    "swell_wave_height",
    "swell_wave_direction",
    "swell_wave_peak_period",
    "swell_wave_period",
    "wave_period",
    "secondary_swell_wave_height",
    "secondary_swell_wave_direction",
    "secondary_swell_wave_period",
    "sea_surface_temperature",
    "sea_level_height_msl",
]
SPOT_WX_VARS = [
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "temperature_2m",
    "weather_code",
    "precipitation",
    "cloud_cover",
]
SPOT_DAYS = 7
GRID_DAYS = 3

GALE_KMH = 62.0  # Beaufort 8


def ocean_points() -> list[tuple[int, float, float]]:
    """(index, lat, lon) for every point of the ocean grid."""
    pts = []
    for i in range(OCEAN_NLAT):
        lat = OCEAN_LAT0 + i * OCEAN_STEP
        for j in range(OCEAN_NLON):
            pts.append((i * OCEAN_NLON + j, lat, LON0 + j * OCEAN_STEP))
    return pts


def weather_points() -> list[tuple[int, float, float]]:
    pts = []
    for i in range(WX_NLAT):
        lat = WX_LAT0 + i * WX_STEP
        for j in range(WX_NLON):
            pts.append((i * WX_NLON + j, lat, LON0 + j * WX_STEP))
    return pts


def chunks(items: list[Any], size: int = CHUNK) -> list[list[Any]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def _coords(points: list[tuple[Any, float, float]]) -> dict[str, str]:
    return {
        "latitude": ",".join(f"{p[1]:g}" for p in points),
        "longitude": ",".join(f"{p[2]:g}" for p in points),
    }


def ocean_url(points: list[tuple[int, float, float]]) -> str:
    query = {
        **_coords(points),
        "hourly": ",".join(OCEAN_VARS),
        "forecast_days": GRID_DAYS,
        "timeformat": "unixtime",
        "timezone": "GMT",
        "cell_selection": "nearest",
    }
    return f"{MARINE_URL}?{urlencode(query, safe=',')}"


def weather_url(points: list[tuple[int, float, float]]) -> str:
    query = {
        **_coords(points),
        "hourly": ",".join(WX_VARS),
        "forecast_days": GRID_DAYS,
        "wind_speed_unit": "kmh",
        "timeformat": "unixtime",
        "timezone": "GMT",
    }
    return f"{FORECAST_URL}?{urlencode(query, safe=',')}"


def spot_marine_url(spots: list[dict[str, Any]]) -> str:
    query = {
        "latitude": ",".join(f"{s['lat']:g}" for s in spots),
        "longitude": ",".join(f"{s['lon']:g}" for s in spots),
        "hourly": ",".join(SPOT_MARINE_VARS),
        "forecast_days": SPOT_DAYS,
        "timeformat": "unixtime",
        "timezone": "auto",
        "cell_selection": "sea",
    }
    return f"{MARINE_URL}?{urlencode(query, safe=',')}"


def spot_weather_url(spots: list[dict[str, Any]]) -> str:
    query = {
        "latitude": ",".join(f"{s['lat']:g}" for s in spots),
        "longitude": ",".join(f"{s['lon']:g}" for s in spots),
        "hourly": ",".join(SPOT_WX_VARS),
        "forecast_days": SPOT_DAYS,
        "wind_speed_unit": "kmh",
        "timeformat": "unixtime",
        "timezone": "auto",
    }
    return f"{FORECAST_URL}?{urlencode(query, safe=',')}"


def as_list(data: Any, expected: int) -> list[dict[str, Any]]:
    """Open-Meteo answers a list for several locations and an object for one."""
    if isinstance(data, dict) and data.get("error"):
        raise ValueError(f"Open-Meteo error: {data.get('reason')}")
    items = data if isinstance(data, list) else [data]
    if len(items) != expected:
        raise ValueError(f"expected {expected} locations, got {len(items)}")
    return items


def frame_times(start_ts: float) -> list[int]:
    """Frame times: the current full hour and every 3 hours after it."""
    base = int(start_ts // 3600 * 3600)
    return [base + k * FRAME_STEP_H * 3600 for k in range(FRAME_COUNT)]


def _series_at(item: dict[str, Any], keys: list[str], frames: list[int]) -> dict[str, list[Any]]:
    hourly = (item or {}).get("hourly") or {}
    times = [int(t) for t in hourly.get("time") or []]
    index = {t: i for i, t in enumerate(times)}
    out: dict[str, list[Any]] = {}
    for key in keys:
        values = hourly.get(key) or []
        col = []
        for ft in frames:
            i = index.get(ft)
            col.append(values[i] if i is not None and i < len(values) else None)
        out[key] = col
    return out


def parse_ocean_chunk(
    data: Any, points: list[tuple[int, float, float]], frames: list[int]
) -> tuple[dict[int, dict[str, list[Any]]], set[int]]:
    """Values per grid index, and the indices that turned out to be land."""
    items = as_list(data, len(points))
    values: dict[int, dict[str, list[Any]]] = {}
    land: set[int] = set()
    for point, item in zip(points, items):
        series = _series_at(item, OCEAN_VARS, frames)
        hourly_all = ((item or {}).get("hourly") or {}).get("wave_height") or []
        if not any(v is not None for v in hourly_all):
            land.add(point[0])
            continue
        values[point[0]] = series
    return values, land


def parse_weather_chunk(
    data: Any, points: list[tuple[int, float, float]], frames: list[int]
) -> dict[int, dict[str, list[Any]]]:
    items = as_list(data, len(points))
    return {point[0]: _series_at(item, WX_VARS, frames) for point, item in zip(points, items)}


def _q(v: Any, scale: float = 1.0) -> int | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f):
        return None
    return int(round(f * scale))


def pack_ocean(values: dict[int, dict[str, list[Any]]], frames: list[int]) -> dict[str, Any]:
    """Compact frames for the card: wave height in dm, direction in degrees, period in 0.1 s."""
    n = OCEAN_NLAT * OCEAN_NLON
    out_frames = []
    for k in range(len(frames)):
        h = [None] * n
        d = [None] * n
        p = [None] * n
        w = [None] * n
        for idx, series in values.items():
            h[idx] = _q(series["wave_height"][k], 10)
            d[idx] = _q(series["wave_direction"][k])
            p[idx] = _q(series["wave_period"][k], 10)
            w[idx] = _q(series["wind_wave_height"][k], 10)
        out_frames.append({"h": h, "d": d, "p": p, "w": w})
    return {
        "lat0": OCEAN_LAT0,
        "lon0": LON0,
        "step": OCEAN_STEP,
        "nlat": OCEAN_NLAT,
        "nlon": OCEAN_NLON,
        "times": frames,
        "frames": out_frames,
    }


def pack_weather(values: dict[int, dict[str, list[Any]]], frames: list[int]) -> dict[str, Any]:
    """Compact frames: wind km/h, direction, cloud %, rain in 0.1 mm/h, pressure hPa."""
    n = WX_NLAT * WX_NLON
    out_frames = []
    for k in range(len(frames)):
        ws = [None] * n
        wd = [None] * n
        cc = [None] * n
        pr = [None] * n
        ps = [None] * n
        for idx, series in values.items():
            ws[idx] = _q(series["wind_speed_10m"][k])
            wd[idx] = _q(series["wind_direction_10m"][k])
            cc[idx] = _q(series["cloud_cover"][k])
            pr[idx] = _q(series["precipitation"][k], 10)
            ps[idx] = _q(series["pressure_msl"][k])
        out_frames.append({"ws": ws, "wd": wd, "cc": cc, "pr": pr, "ps": ps})
    return {
        "lat0": WX_LAT0,
        "lon0": LON0,
        "step": WX_STEP,
        "nlat": WX_NLAT,
        "nlon": WX_NLON,
        "times": frames,
        "frames": out_frames,
    }


def frame_index(times: list[int], now_ts: float) -> int | None:
    if not times:
        return None
    idx = min(range(len(times)), key=lambda i: abs(times[i] - now_ts))
    if abs(times[idx] - now_ts) > 2 * FRAME_STEP_H * 3600:
        return None
    return idx


def ocean_value_at(ocean: dict[str, Any], frame: int, lat: float, lon: float) -> dict[str, Any] | None:
    """Nearest ocean grid cell with data around a position (searches the 3 x 3 neighbourhood)."""
    if not ocean or frame is None:
        return None
    fr = ocean["frames"][frame]
    step = ocean["step"]
    i0 = round((lat - ocean["lat0"]) / step)
    j0 = round((((lon - ocean["lon0"]) % 360)) / step) % ocean["nlon"]
    best = None
    for di in (0, -1, 1):
        for dj in (0, -1, 1):
            i = i0 + di
            if not 0 <= i < ocean["nlat"]:
                continue
            j = (j0 + dj) % ocean["nlon"]
            idx = i * ocean["nlon"] + j
            if fr["h"][idx] is None:
                continue
            dist = abs(di) + abs(dj)
            if best is None or dist < best[0]:
                best = (dist, idx)
    if best is None:
        return None
    idx = best[1]
    return {
        "wave_height_m": fr["h"][idx] / 10,
        "wave_dir": fr["d"][idx],
        "wave_period": None if fr["p"][idx] is None else fr["p"][idx] / 10,
        "wind_wave_m": None if fr["w"][idx] is None else fr["w"][idx] / 10,
    }


def find_storms(
    weather: dict[str, Any], frame: int, ocean: dict[str, Any] | None = None, min_kmh: float = GALE_KMH
) -> list[dict[str, Any]]:
    """Areas with gale force winds (Beaufort 8+), clustered over neighbouring grid cells."""
    if not weather or frame is None:
        return []
    fr = weather["frames"][frame]
    nlat, nlon = weather["nlat"], weather["nlon"]
    strong = {i for i, v in enumerate(fr["ws"]) if v is not None and v >= min_kmh}
    seen: set[int] = set()
    storms: list[dict[str, Any]] = []
    for start in sorted(strong):
        if start in seen:
            continue
        stack = [start]
        cells = []
        seen.add(start)
        while stack:
            c = stack.pop()
            cells.append(c)
            ci, cj = divmod(c, nlon)
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    ni = ci + di
                    if not 0 <= ni < nlat:
                        continue
                    n = ni * nlon + (cj + dj) % nlon
                    if n in strong and n not in seen:
                        seen.add(n)
                        stack.append(n)
        weights = [fr["ws"][c] for c in cells]
        total = sum(weights)
        lat = sum((weather["lat0"] + (c // nlon) * weather["step"]) * w for c, w in zip(cells, weights)) / total
        # circular mean for the longitude
        sx = sum(math.cos(math.radians(weather["lon0"] + (c % nlon) * weather["step"])) * w for c, w in zip(cells, weights))
        sy = sum(math.sin(math.radians(weather["lon0"] + (c % nlon) * weather["step"])) * w for c, w in zip(cells, weights))
        lon = math.degrees(math.atan2(sy, sx))
        pressures = [fr["ps"][c] for c in cells if fr["ps"][c] is not None]
        rain = [fr["pr"][c] for c in cells if fr["pr"][c] is not None]
        at_sea = True
        if ocean:
            at_sea = ocean_value_at(ocean, min(frame, len(ocean["frames"]) - 1), lat, lon) is not None
        storms.append({
            "lat": round(lat, 2),
            "lon": round(lon, 2),
            "max_wind_kmh": max(weights),
            "min_pressure_hpa": min(pressures) if pressures else None,
            "max_rain_mm": round(max(rain) / 10, 1) if rain else None,
            "cells": len(cells),
            "at_sea": at_sea,
        })
    storms.sort(key=lambda s: s["max_wind_kmh"], reverse=True)
    return storms


def utc_iso(ts: float | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
