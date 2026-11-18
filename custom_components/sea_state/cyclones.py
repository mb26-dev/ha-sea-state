"""Tropical cyclones from GDACS (pure, no Home Assistant imports).

GDACS (Global Disaster Alert and Coordination System, a joint UN and European
Commission service) publishes every active tropical cyclone worldwide with its
alert level, position and maximum wind. The geometry of an event holds the wind
radii per forecast time; the centre of each time slice gives the track.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import math
import re
from typing import Any

GDACS_EVENTS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC"
GDACS_GEOMETRY_URL = "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid={eventid}&episodeid={episodeid}"
GDACS_REPORT_URL = "https://www.gdacs.org/report.aspx?eventtype=TC&eventid={eventid}"

# Saffir-Simpson on 1 minute sustained winds (km/h)
CATEGORIES = [
    (63, 0, "tropical_depression"),
    (119, 0, "tropical_storm"),
    (154, 1, "category_1"),
    (178, 2, "category_2"),
    (209, 3, "category_3"),
    (252, 4, "category_4"),
]
CATEGORY_LABELS = {
    "tropical_depression": "Tropical depression",
    "tropical_storm": "Tropical storm",
    "category_1": "Category 1",
    "category_2": "Category 2",
    "category_3": "Category 3",
    "category_4": "Category 4",
    "category_5": "Category 5",
}
_KMH = re.compile(r"(\d+(?:\.\d+)?)\s*km/h", re.I)
_POINT_LABEL = re.compile(r"(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})")
# typical wind of a track segment class (GDACS labels them TD, TS, or with the category number)
_CLASS_WIND = {"TD": 55.0, "TS": 90.0}
_CAT_WIND = {1: 140.0, 2: 165.0, 3: 195.0, 4: 230.0, 5: 270.0}


def category(wind_kmh: float | None) -> tuple[int, str]:
    """Saffir-Simpson category number (0 below hurricane strength) and key."""
    if wind_kmh is None:
        return 0, "tropical_storm"
    for limit, num, key in CATEGORIES:
        if wind_kmh < limit:
            return num, key
    return 5, "category_5"


def basin_word(lat: float, lon: float) -> str:
    """Hurricane, typhoon or cyclone, by ocean basin."""
    if lat >= 0 and (lon < -10 or lon >= 180):
        return "Hurricane"
    if lat >= 0 and 100 <= lon < 180:
        return "Typhoon"
    return "Cyclone"


def _bool(v: Any) -> bool:
    return v is True or str(v).strip().lower() == "true"


def _iso(v: Any) -> str | None:
    if not v:
        return None
    s = str(v)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def parse_events(text: str, now: datetime, max_age_h: float = 36) -> list[dict[str, Any]]:
    """Active cyclones from the GDACS event list."""
    text = (text or "").lstrip(chr(0xFEFF))
    data = json.loads(text) if text.strip() else {}
    out: list[dict[str, Any]] = []
    for feat in data.get("features") or []:
        props = feat.get("properties") or {}
        if str(props.get("eventtype") or "").upper() != "TC":
            continue
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if geom.get("type") != "Point" or len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        to_iso = _iso(props.get("todate"))
        current = _bool(props.get("iscurrent"))
        if not current:
            if not to_iso:
                continue
            age_h = (now - datetime.fromisoformat(to_iso)).total_seconds() / 3600
            if age_h > max_age_h:
                continue
        sev = props.get("severitydata") or {}
        wind = sev.get("severity")
        try:
            wind = float(wind) if wind is not None else None
        except (TypeError, ValueError):
            wind = None
        if wind is None:
            m = _KMH.search(str(sev.get("severitytext") or ""))
            wind = float(m.group(1)) if m else None
        cat_num, cat_key = category(wind)
        urls = props.get("url") or {}
        eventid = props.get("eventid")
        episodeid = props.get("episodeid")
        name = str(props.get("eventname") or props.get("name") or "Cyclone").strip()
        out.append({
            "id": f"gdacs_{eventid}",
            "eventid": eventid,
            "episodeid": episodeid,
            "name": name,
            "title": str(props.get("name") or name),
            "lat": round(lat, 2),
            "lon": round(lon, 2),
            "wind_kmh": None if wind is None else round(wind),
            "category": cat_num,
            "category_key": cat_key,
            "kind": basin_word(lat, lon),
            "alert": str(props.get("alertlevel") or "").title() or None,
            "country": props.get("country") or None,
            "from": _iso(props.get("fromdate")),
            "to": to_iso,
            "updated": _iso(props.get("datemodified")),
            "source": props.get("source") or None,
            "severity_text": sev.get("severitytext"),
            "current": current,
            "report_url": urls.get("report") or GDACS_REPORT_URL.format(eventid=eventid),
            "geometry_url": urls.get("geometry")
            or GDACS_GEOMETRY_URL.format(eventid=eventid, episodeid=episodeid),
            "track": [],
        })
    out.sort(key=lambda c: (c["wind_kmh"] or 0), reverse=True)
    return out


def _ring_centroid(ring: list[list[float]]) -> tuple[float, float] | None:
    """Area weighted centroid of a lon/lat ring, unwrapped across the antimeridian."""
    if not ring or len(ring) < 3:
        return None
    base = ring[0][0]
    pts = []
    for p in ring:
        lon = p[0]
        while lon - base > 180:
            lon -= 360
        while lon - base < -180:
            lon += 360
        pts.append((lon, p[1]))
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-9:
        x = sum(p[0] for p in pts) / len(pts)
        y = sum(p[1] for p in pts) / len(pts)
    else:
        x = cx / (3 * a)
        y = cy / (3 * a)
    x = ((x + 180) % 360) - 180
    return y, x


def _outer_ring(geom: dict[str, Any]) -> list[list[float]] | None:
    coords = geom.get("coordinates") or []
    if geom.get("type") == "Polygon" and coords:
        return coords[0]
    if geom.get("type") == "MultiPolygon" and coords:
        biggest = max(coords, key=lambda poly: len(poly[0]) if poly else 0)
        return biggest[0] if biggest else None
    return None


def _class_wind(label: str) -> float | None:
    label = (label or "").strip().upper()
    if label in _CLASS_WIND:
        return _CLASS_WIND[label]
    m = re.search(r"([1-5])", label)
    if m:
        return _CAT_WIND[int(m.group(1))]
    m = _KMH.search(label)
    return float(m.group(1)) if m else None


def _point_time(label: str, ref: datetime) -> datetime | None:
    """Time of a track point from labels like '17/11 06:00 UTC' (no year given)."""
    m = _POINT_LABEL.search(label or "")
    if not m:
        return None
    day, month, hour, minute = (int(g) for g in m.groups())
    best = None
    for year in (ref.year - 1, ref.year, ref.year + 1):
        try:
            cand = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
        except ValueError:
            continue
        if best is None or abs((cand - ref).total_seconds()) < abs((best - ref).total_seconds()):
            best = cand
    return best


def _track_from_points(features: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    """Track from the small 'PointRadii' circles GDACS draws at every track position."""
    advisory = None
    for feat in features:
        when = _iso((feat.get("properties") or {}).get("polygondate"))
        if when:
            advisory = datetime.fromisoformat(when)
            break
    ref = advisory or now
    # wind class of each track segment, keyed by its start and end position
    seg_wind: dict[tuple[float, float], float] = {}
    seg_end: dict[tuple[float, float], float] = {}
    for feat in features:
        geom = feat.get("geometry") or {}
        if geom.get("type") != "LineString":
            continue
        coords = geom.get("coordinates") or []
        wind = _class_wind(str((feat.get("properties") or {}).get("polygonlabel") or ""))
        if len(coords) < 2 or wind is None:
            continue
        seg_wind[(round(coords[0][1], 1), round(coords[0][0], 1))] = wind
        seg_end[(round(coords[-1][1], 1), round(coords[-1][0], 1))] = wind
    points: dict[str, dict[str, Any]] = {}
    for feat in features:
        props = feat.get("properties") or {}
        if str(props.get("featuretype") or "") != "PointRadii":
            continue
        when = _point_time(str(props.get("polygonlabel") or ""), ref)
        ring = _outer_ring(feat.get("geometry") or {})
        if not when or not ring:
            continue
        cen = _ring_centroid(ring)
        if not cen:
            continue
        lat, lon = cen
        key = (round(lat, 1), round(lon, 1))
        wind = seg_wind.get(key, seg_end.get(key))
        iso = when.isoformat()
        points[iso] = {
            "time": iso,
            "lat": round(lat, 2),
            "lon": round(lon, 2),
            "wind_kmh": None if wind is None else round(wind),
            "forecast": when > (advisory or now),
        }
    return [points[k] for k in sorted(points)]


def parse_track(text: str, now: datetime) -> list[dict[str, Any]]:
    """Track points (past and forecast) from the GDACS event geometry.

    GDACS draws a small circle ('PointRadii') at every past and forecast position,
    labelled with its time, and line segments between them labelled with the storm
    class. Older geometries only have wind radii polygons per time slice; then the
    centre of the largest one is used as the position.
    """
    text = (text or "").lstrip(chr(0xFEFF))
    data = json.loads(text) if text.strip() else {}
    features = data.get("features") or []
    track = _track_from_points(features, now)
    if len(track) >= 2:
        return track
    slices: dict[str, dict[str, Any]] = {}
    for feat in features:
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        when = _iso(props.get("polygondate") or props.get("trackdate"))
        if not when:
            continue
        label = str(props.get("polygonlabel") or "")
        m = _KMH.search(label)
        wind = float(m.group(1)) if m else None
        sl = slices.setdefault(when, {"wind": None, "pos": None, "area": -1.0})
        if wind is not None:
            sl["wind"] = max(sl["wind"] or 0.0, wind)
        if geom.get("type") == "Point":
            c = geom.get("coordinates") or []
            if len(c) >= 2:
                sl["pos"] = (float(c[1]), float(c[0]))
                sl["area"] = float("inf")
            continue
        ring = _outer_ring(geom)
        if not ring:
            continue
        lons = [p[0] for p in ring]
        lats = [p[1] for p in ring]
        area = (max(lats) - min(lats)) * (max(lons) - min(lons))
        if area > sl["area"]:
            cen = _ring_centroid(ring)
            if cen:
                sl["pos"] = cen
                sl["area"] = area
    track = []
    for when in sorted(slices):
        sl = slices[when]
        if not sl["pos"]:
            continue
        lat, lon = sl["pos"]
        track.append({
            "time": when,
            "lat": round(lat, 2),
            "lon": round(lon, 2),
            "wind_kmh": None if sl["wind"] is None else round(sl["wind"]),
            "forecast": datetime.fromisoformat(when) > now,
        })
    return track


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(a)))


def closest_approach(cyclone: dict[str, Any], lat: float, lon: float) -> dict[str, Any]:
    """Distance now and the closest point of the forecast track to a place."""
    now_km = distance_km(lat, lon, cyclone["lat"], cyclone["lon"])
    best = {"distance_km": round(now_km), "time": None, "forecast": False}
    for p in cyclone.get("track") or []:
        if not p.get("forecast"):
            continue
        d = distance_km(lat, lon, p["lat"], p["lon"])
        if d < best["distance_km"]:
            best = {"distance_km": round(d), "time": p["time"], "forecast": True}
    return {"now_km": round(now_km), "closest_km": best["distance_km"], "closest_time": best["time"]}
