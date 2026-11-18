"""Surf and sea state models (pure, no Home Assistant imports).

Everything here works on plain numbers, so it can be tested without Home Assistant.
The rating is a transparent heuristic, not a forecast service:

* every swell component (primary swell, secondary swell, wind sea) is weighted by how
  well its direction fits the swell window of the spot and by its period (longer
  period swells grow more when they reach shallow water), then combined by energy
* the size is compared with the size range of the spot
* the wind is rated by its speed and its angle to the offshore direction
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math
from typing import Any

DOUGLAS = [
    (0.0, 0, "calm_glassy"),
    (0.1, 1, "calm_rippled"),
    (0.5, 2, "smooth"),
    (1.25, 3, "slight"),
    (2.5, 4, "moderate"),
    (4.0, 5, "rough"),
    (6.0, 6, "very_rough"),
    (9.0, 7, "high"),
    (14.0, 8, "very_high"),
]
DOUGLAS_LABELS = {
    "calm_glassy": "Calm (glassy)",
    "calm_rippled": "Calm (rippled)",
    "smooth": "Smooth",
    "slight": "Slight",
    "moderate": "Moderate",
    "rough": "Rough",
    "very_rough": "Very rough",
    "high": "High",
    "very_high": "Very high",
    "phenomenal": "Phenomenal",
}
BEAUFORT_KMH = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]
BEAUFORT_LABELS = [
    "Calm", "Light air", "Light breeze", "Gentle breeze", "Moderate breeze", "Fresh breeze",
    "Strong breeze", "Near gale", "Gale", "Strong gale", "Storm", "Violent storm", "Hurricane force",
]
CONDITIONS = ["flat", "poor", "fair", "good", "epic", "blown_out", "too_big"]
POSES = {
    "flat": "sitting",
    "poor": "paddling",
    "fair": "riding",
    "good": "riding",
    "epic": "barrel",
    "blown_out": "windy",
    "too_big": "flag",
}
WIND_KINDS = ["glassy", "offshore", "cross_offshore", "cross_shore", "onshore"]
DAY_START_H = 6
DAY_END_H = 19


def angdiff(a: float, b: float) -> float:
    """Smallest angle between two directions in degrees (0..180)."""
    d = abs((a - b) % 360)
    return 360 - d if d > 180 else d


def direction_factor(from_deg: float | None, centre: float, window: float) -> float:
    """1 inside the swell window, fading out over the next 60 degrees."""
    if from_deg is None:
        return 0.6
    d = angdiff(from_deg, centre)
    if d <= window:
        return 1.0
    if d >= window + 60:
        return 0.0
    return math.cos((d - window) / 60 * math.pi / 2) ** 1.5


def period_factor(period: float | None) -> float:
    """Long period swell grows more in shallow water (shoaling)."""
    if period is None or period <= 0:
        return 0.85
    return max(0.6, min(1.5, 0.75 + 0.05 * (period - 6)))


def surf_height(spot: dict[str, Any], row: dict[str, Any]) -> float:
    """Expected breaking wave height at the spot in metres."""
    centre = spot["swell_from"]
    window = spot.get("window", 40)
    parts = []
    for h_key, d_key, p_key in (("sw_h", "sw_dir", "sw_per"), ("sw2_h", "sw2_dir", "sw2_per")):
        h = row.get(h_key)
        if h is None or h <= 0:
            continue
        parts.append(h * direction_factor(row.get(d_key), centre, window) * period_factor(row.get(p_key)))
    ww = row.get("ww_h")
    if ww and ww > 0:
        # wind sea travels with the wind and is short period
        parts.append(ww * direction_factor(row.get("wind_dir"), centre, window + 20) * 0.7)
    if not parts:
        hs = row.get("hs")
        if hs is None:
            return 0.0
        parts.append(hs * 0.7)
    return round(1.2 * math.sqrt(sum(p * p for p in parts)), 2)


def size_score(surf: float, spot: dict[str, Any]) -> float:
    lo, ideal, hi = spot["size_min"], spot["size_ideal"], spot["size_max"]
    if surf < lo * 0.4:
        return 0.0
    if surf < lo:
        return 0.4 * (surf - lo * 0.4) / (lo * 0.6)
    if surf < ideal:
        return 0.4 + 0.6 * (surf - lo) / (ideal - lo)
    if surf <= hi:
        return 1.0
    if surf <= hi * 1.4:
        return 1.0 - 0.7 * (surf - hi) / (hi * 0.4)
    return 0.15


def period_score(period: float | None) -> float:
    if period is None:
        return 0.5
    return max(0.15, min(1.0, (period - 5) / 9))


def wind_kind(speed_kmh: float | None, from_deg: float | None, offshore_from: float) -> str:
    if speed_kmh is None or from_deg is None:
        return "cross_shore"
    if speed_kmh < 5:
        return "glassy"
    rel = angdiff(from_deg, offshore_from)
    if rel <= 45:
        return "offshore"
    if rel <= 80:
        return "cross_offshore"
    if rel <= 110:
        return "cross_shore"
    return "onshore"


def wind_score(speed_kmh: float | None, from_deg: float | None, offshore_from: float) -> float:
    if speed_kmh is None or from_deg is None:
        return 0.6
    v = speed_kmh
    kind = wind_kind(v, from_deg, offshore_from)
    if kind == "glassy":
        return 1.0
    if kind == "offshore":
        return 1.0 if v <= 30 else 0.8 if v <= 45 else 0.55
    if kind == "cross_offshore":
        return 0.95 if v <= 15 else 0.75 if v <= 25 else 0.5
    if kind == "cross_shore":
        return 0.85 if v <= 8 else 0.55 if v <= 18 else 0.3
    return 0.75 if v <= 6 else 0.45 if v <= 14 else 0.25 if v <= 25 else 0.1


def rate(spot: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    """Surf height, rating (0-5), condition and surfer pose for one hour."""
    surf = surf_height(spot, row)
    period = row.get("sw_per") or row.get("per")
    ss = size_score(surf, spot)
    ws = wind_score(row.get("wind"), row.get("wind_dir"), spot["offshore_from"])
    rating = 5.0 * ss * (0.45 + 0.55 * period_score(period)) * ws
    rating = round(max(0.0, min(5.0, rating)), 1)
    if surf < max(0.3, spot["size_min"] * 0.5):
        cond = "flat"
    elif surf > spot["size_max"] * 1.3:
        cond = "too_big"
    elif ws <= 0.25 and ss > 0.3:
        cond = "blown_out"
    elif rating >= 4.0:
        cond = "epic"
    elif rating >= 3.0:
        cond = "good"
    elif rating >= 1.8:
        cond = "fair"
    else:
        cond = "poor"
    return {
        "surf_m": surf,
        "rating": rating,
        "condition": cond,
        "pose": POSES[cond],
        "wind_kind": wind_kind(row.get("wind"), row.get("wind_dir"), spot["offshore_from"]),
    }


def douglas(hs: float | None) -> tuple[int | None, str | None]:
    """Douglas sea state (WMO code 3700) for a significant wave height in metres."""
    if hs is None:
        return None, None
    code, key = 9, "phenomenal"
    for limit, c, k in DOUGLAS:
        if hs <= limit:
            code, key = c, k
            break
    return code, key


def beaufort(speed_kmh: float | None) -> int | None:
    if speed_kmh is None:
        return None
    for i, limit in enumerate(BEAUFORT_KMH):
        if speed_kmh < limit:
            return i
    return 12


def wetsuit(sst: float | None) -> str | None:
    if sst is None:
        return None
    if sst >= 25:
        return "Boardshorts or lycra"
    if sst >= 22:
        return "Neoprene top or springsuit"
    if sst >= 19:
        return "Springsuit or 2 mm"
    if sst >= 16:
        return "3/2 mm full suit"
    if sst >= 13:
        return "4/3 mm full suit, boots optional"
    if sst >= 10:
        return "5/4 mm, boots and gloves"
    return "6/5 mm hooded, boots and gloves"


def tide_extremes(times: list[int], levels: list[float | None], now_ts: float, limit: int = 4) -> list[dict[str, Any]]:
    """Next high and low tides from an hourly sea level series (parabolic refinement)."""
    out: list[dict[str, Any]] = []
    n = len(times)
    for i in range(2, n - 2):
        window = levels[i - 2:i + 3]
        if any(v is None for v in window):
            continue
        y = levels[i]
        a, b = levels[i - 1], levels[i + 1]
        if y >= max(window) and y > min(a, b):
            kind = "high"
        elif y <= min(window) and y < max(a, b):
            kind = "low"
        else:
            continue
        denom = a - 2 * y + b
        shift = 0.5 * (a - b) / denom if denom else 0.0
        shift = max(-0.5, min(0.5, shift))
        ts = times[i] + shift * 3600
        if ts < now_ts:
            continue
        height = y - 0.25 * (a - b) * shift
        if out and out[-1]["kind"] == kind:
            continue
        out.append({"kind": kind, "time": int(ts), "level_m": round(height, 2)})
        if len(out) >= limit:
            break
    return out


def daily_summary(spot: dict[str, Any], rows: list[dict[str, Any]], offset_s: int) -> list[dict[str, Any]]:
    """Best rating per local day in daylight, with the best session window."""
    days: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        local = datetime.fromtimestamp(r["t"] + offset_s, tz=timezone.utc)
        if not DAY_START_H <= local.hour <= DAY_END_H:
            continue
        days.setdefault(local.date().isoformat(), []).append({**r, "_h": local.hour})
    out: list[dict[str, Any]] = []
    for day, items in sorted(days.items()):
        best = max(items, key=lambda x: x["rating"])
        # contiguous hours close to the best rating around the best hour
        idx = items.index(best)
        lo = hi = idx
        limit = max(0.5, best["rating"] - 0.5)
        while lo > 0 and items[lo - 1]["rating"] >= limit and items[lo - 1]["_h"] == items[lo]["_h"] - 1:
            lo -= 1
        while hi < len(items) - 1 and items[hi + 1]["rating"] >= limit and items[hi + 1]["_h"] == items[hi]["_h"] + 1:
            hi += 1
        surfs = [x["surf_m"] for x in items]
        winds = [x["wind"] for x in items if x.get("wind") is not None]
        out.append({
            "date": day,
            "rating": best["rating"],
            "condition": best["condition"],
            "surf_min": round(min(surfs), 1),
            "surf_max": round(max(surfs), 1),
            "best_from": f"{items[lo]['_h']:02d}:00",
            "best_to": f"{items[hi]['_h'] + 1:02d}:00",
            "swell_m": best.get("sw_h"),
            "swell_period": best.get("sw_per"),
            "swell_dir": best.get("sw_dir"),
            "wind_kmh": round(sum(winds) / len(winds)) if winds else None,
            "wind_kind": best.get("wind_kind"),
        })
    return out


def build_rows(marine: dict[str, Any], weather: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Merge the hourly marine and weather series of one location into rows."""
    mh = (marine or {}).get("hourly") or {}
    times = [int(t) for t in mh.get("time") or []]
    wh = (weather or {}).get("hourly") or {}
    wtimes = {int(t): i for i, t in enumerate(wh.get("time") or [])}

    def pick(series: dict[str, Any], key: str, i: int | None) -> Any:
        if i is None:
            return None
        values = series.get(key) or []
        return values[i] if i < len(values) else None

    rows: list[dict[str, Any]] = []
    for i, t in enumerate(times):
        j = wtimes.get(t)
        rows.append({
            "t": t,
            "hs": pick(mh, "wave_height", i),
            "ww_h": pick(mh, "wind_wave_height", i),
            "sw_h": pick(mh, "swell_wave_height", i),
            "sw_dir": pick(mh, "swell_wave_direction", i),
            "sw_per": pick(mh, "swell_wave_peak_period", i),
            "sw2_h": pick(mh, "secondary_swell_wave_height", i),
            "sw2_dir": pick(mh, "secondary_swell_wave_direction", i),
            "sw2_per": pick(mh, "secondary_swell_wave_period", i),
            "sst": pick(mh, "sea_surface_temperature", i),
            "sea_level": pick(mh, "sea_level_height_msl", i),
            "wind": pick(wh, "wind_speed_10m", j),
            "wind_dir": pick(wh, "wind_direction_10m", j),
            "gust": pick(wh, "wind_gusts_10m", j),
            "temp": pick(wh, "temperature_2m", j),
            "code": pick(wh, "weather_code", j),
            "precip": pick(wh, "precipitation", j),
            "cloud": pick(wh, "cloud_cover", j),
        })
    return rows


def current_index(rows: list[dict[str, Any]], now_ts: float) -> int | None:
    if not rows:
        return None
    idx = min(range(len(rows)), key=lambda i: abs(rows[i]["t"] - now_ts))
    if abs(rows[idx]["t"] - now_ts) > 3 * 3600:
        return None
    return idx


def evaluate_spot(
    spot: dict[str, Any],
    marine: dict[str, Any],
    weather: dict[str, Any] | None,
    now: datetime,
    hourly_hours: int = 48,
) -> dict[str, Any] | None:
    """Everything the sensors and the card need for one spot."""
    rows = build_rows(marine, weather)
    if not rows:
        return None
    offset = int((marine or {}).get("utc_offset_seconds") or (weather or {}).get("utc_offset_seconds") or 0)
    for r in rows:
        r.update(rate(spot, r))
    now_ts = now.timestamp()
    idx = current_index(rows, now_ts)
    if idx is None:
        return None
    cur = rows[idx]
    dcode, dkey = douglas(cur.get("hs"))
    future = rows[idx: idx + hourly_hours]
    sea_times = [r["t"] for r in rows]
    sea_levels = [r.get("sea_level") for r in rows]
    tides = tide_extremes(sea_times, sea_levels, now_ts)
    days = daily_summary(spot, rows[idx:], offset)
    next_good = next((r for r in rows[idx + 1:] if r["rating"] >= 3.0), None)
    return {
        "now": {
            "time": datetime.fromtimestamp(cur["t"], tz=timezone.utc).isoformat(),
            "surf_m": cur["surf_m"],
            "rating": cur["rating"],
            "condition": cur["condition"],
            "pose": cur["pose"],
            "wave_height_m": cur.get("hs"),
            "swell_m": cur.get("sw_h"),
            "swell_dir": cur.get("sw_dir"),
            "swell_period": cur.get("sw_per"),
            "swell2_m": cur.get("sw2_h"),
            "swell2_dir": cur.get("sw2_dir"),
            "swell2_period": cur.get("sw2_per"),
            "wind_wave_m": cur.get("ww_h"),
            "wind_kmh": cur.get("wind"),
            "wind_dir": cur.get("wind_dir"),
            "gust_kmh": cur.get("gust"),
            "wind_kind": cur["wind_kind"],
            "beaufort": beaufort(cur.get("wind")),
            "water_c": cur.get("sst"),
            "wetsuit": wetsuit(cur.get("sst")),
            "air_c": cur.get("temp"),
            "weather_code": cur.get("code"),
            "douglas": dcode,
            "sea_state": dkey,
            "sea_level_m": cur.get("sea_level"),
        },
        "utc_offset": offset,
        "tides": tides,
        "days": days,
        "next_good": datetime.fromtimestamp(next_good["t"], tz=timezone.utc).isoformat() if next_good else None,
        "hourly": {
            "t": [r["t"] for r in future],
            "surf": [r["surf_m"] for r in future],
            "rating": [r["rating"] for r in future],
            "wind": [None if r.get("wind") is None else round(r["wind"]) for r in future],
            "wind_dir": [None if r.get("wind_dir") is None else round(r["wind_dir"]) for r in future],
            "sea_level": [None if r.get("sea_level") is None else round(r["sea_level"], 2) for r in future],
        },
    }


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(a)))


def nearest_spot(spots: list[dict[str, Any]], lat: float, lon: float) -> tuple[dict[str, Any], float] | None:
    best: tuple[dict[str, Any], float] | None = None
    for s in spots:
        d = haversine_km(lat, lon, s["lat"], s["lon"])
        if best is None or d < best[1]:
            best = (s, d)
    return best


def iso_in(hours: float, now: datetime) -> str:
    return (now + timedelta(hours=hours)).isoformat()
