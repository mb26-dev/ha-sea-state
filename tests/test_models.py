"""Tests for the pure modules (surf rating, grids, cyclones, spots). Run: python tests/test_models.py"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import importlib.util
import json
import math
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1] / "custom_components" / "sea_state"


def load(name: str):
    spec = importlib.util.spec_from_file_location(f"sea_state_{name}", BASE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


surf = load("surf")
grid = load("grid")
cyclones = load("cyclones")
spots = load("spots")
sharks = load("sharks")

NOW = datetime(2026, 11, 18, 6, 30, tzinfo=timezone.utc)


def spot_by(spot_id):
    return next(s for s in spots.builtin_spots() if s["id"] == spot_id)


def test_catalogue():
    cat = spots.builtin_spots()
    ids = [s["id"] for s in cat]
    assert len(ids) == len(set(ids)), "duplicate spot ids"
    assert len(cat) >= 100
    for s in cat:
        assert -90 <= s["lat"] <= 90 and -180 <= s["lon"] <= 180, s["id"]
        assert 0 <= s["swell_from"] < 360 and 0 <= s["offshore_from"] < 360, s["id"]
        assert 0 < s["size_min"] < s["size_ideal"] < s["size_max"], s["id"]
        assert s["region"] in spots.REGIONS, s["id"]


def test_custom_spots():
    good, bad = spots.parse_custom_spots("My Reef, 7.81, 98.29, 250, 90, 0.5, 1.2, 2.5\nBeach, 1, 2, 180\n# comment\nbroken line")
    assert [s["name"] for s in good] == ["My Reef", "Beach"]
    assert good[0]["offshore_from"] == 90 and good[1]["offshore_from"] == 0
    assert good[0]["size_ideal"] == 1.2
    assert bad == ["broken line"]


def test_direction_and_wind():
    assert surf.angdiff(350, 10) == 20
    assert surf.direction_factor(315, 315, 40) == 1.0
    assert surf.direction_factor(135, 315, 40) == 0.0
    assert 0 < surf.direction_factor(370 - 10, 315, 40) <= 1
    # Pipeline offshore wind comes from the SE
    assert surf.wind_kind(15, 135, 135) == "offshore"
    assert surf.wind_kind(15, 315, 135) == "onshore"
    assert surf.wind_kind(3, 315, 135) == "glassy"
    assert surf.wind_score(40, 315, 135) < 0.2


def test_rating_pipeline():
    pipe = spot_by("pipeline")
    epic = {"sw_h": 2.8, "sw_dir": 315, "sw_per": 16, "ww_h": 0.2, "wind": 12, "wind_dir": 135}
    r = surf.rate(pipe, epic)
    assert r["condition"] in ("good", "epic"), r
    assert r["rating"] >= 3.5, r
    flat = {"sw_h": 0.3, "sw_dir": 315, "sw_per": 8, "ww_h": 0.1, "wind": 5, "wind_dir": 135}
    assert surf.rate(pipe, flat)["condition"] == "flat"
    wrong_dir = {"sw_h": 2.8, "sw_dir": 160, "sw_per": 16, "ww_h": 0.0, "wind": 5, "wind_dir": 135}
    assert surf.rate(pipe, wrong_dir)["rating"] < 1.0
    blown = {"sw_h": 2.0, "sw_dir": 315, "sw_per": 12, "ww_h": 0.8, "wind": 45, "wind_dir": 315}
    assert surf.rate(pipe, blown)["condition"] == "blown_out"
    huge = {"sw_h": 9.0, "sw_dir": 315, "sw_per": 18, "ww_h": 0.0, "wind": 5, "wind_dir": 135}
    assert surf.rate(pipe, huge)["condition"] == "too_big"
    jaws = spot_by("jaws")
    assert surf.rate(jaws, huge)["rating"] >= 3.5


def test_douglas_beaufort_wetsuit():
    assert surf.douglas(0.05)[1] == "calm_rippled"
    assert surf.douglas(2.0) == (4, "moderate")
    assert surf.douglas(20)[1] == "phenomenal"
    assert surf.beaufort(0.5) == 0 and surf.beaufort(70) == 8 and surf.beaufort(130) == 12
    assert surf.wetsuit(29).startswith("Boardshorts")
    assert "6/5" in surf.wetsuit(8)


def _series(start_ts, hours, fn):
    return [fn(h) for h in range(hours)]


def test_tides_and_evaluate():
    start = int(NOW.replace(minute=0).timestamp()) - 6 * 3600
    hours = 7 * 24
    times = [start + h * 3600 for h in range(hours)]
    # semidiurnal tide, period 12.42 h, high water at 3 h after start
    level = [round(0.8 * math.cos(2 * math.pi * (h - 3) / 12.42), 3) for h in range(hours)]
    marine = {
        "utc_offset_seconds": 7 * 3600,
        "hourly": {
            "time": times,
            "wave_height": [2.0] * hours,
            "wind_wave_height": [0.3] * hours,
            "swell_wave_height": [1.8] * hours,
            "swell_wave_direction": [245] * hours,
            "swell_wave_peak_period": [13] * hours,
            "secondary_swell_wave_height": [0.5] * hours,
            "secondary_swell_wave_direction": [200] * hours,
            "secondary_swell_wave_period": [8] * hours,
            "sea_surface_temperature": [29.5] * hours,
            "sea_level_height_msl": level,
        },
    }
    weather = {
        "utc_offset_seconds": 7 * 3600,
        "hourly": {
            "time": times,
            "wind_speed_10m": [8 if (h % 24) < 12 else 25 for h in range(hours)],
            "wind_direction_10m": [90] * hours,
            "wind_gusts_10m": [15] * hours,
            "temperature_2m": [30] * hours,
            "weather_code": [1] * hours,
            "precipitation": [0] * hours,
            "cloud_cover": [20] * hours,
        },
    }
    ev = surf.evaluate_spot(spot_by("kata"), marine, weather, NOW)
    assert ev is not None
    assert ev["now"]["condition"] in surf.CONDITIONS
    assert ev["now"]["wetsuit"].startswith("Boardshorts")
    assert ev["now"]["sea_state"] == "moderate"
    assert len(ev["tides"]) == 4
    kinds = [t["kind"] for t in ev["tides"]]
    assert kinds[0] != kinds[1]
    gap_h = (ev["tides"][1]["time"] - ev["tides"][0]["time"]) / 3600
    assert 5.5 < gap_h < 7.0, gap_h
    assert 6 <= len(ev["days"]) <= 8
    assert all("best_from" in d for d in ev["days"])
    assert len(ev["hourly"]["t"]) == 48
    # without weather the rating still works
    ev2 = surf.evaluate_spot(spot_by("kata"), marine, None, NOW)
    assert ev2 and ev2["now"]["wind_kmh"] is None
    # stale data is refused
    assert surf.evaluate_spot(spot_by("kata"), marine, weather, NOW + timedelta(days=10)) is None


def test_grid_parse_and_pack():
    pts = grid.ocean_points()
    assert len(pts) == grid.OCEAN_NLAT * grid.OCEAN_NLON
    frames = grid.frame_times(NOW.timestamp())
    assert len(frames) == grid.FRAME_COUNT and frames[1] - frames[0] == 3 * 3600
    sample = pts[:3]
    hours = list(range(frames[0] - 3600, frames[0] + 72 * 3600, 3600))
    items = []
    for k, p in enumerate(sample):
        if k == 1:
            items.append({"hourly": {"time": hours, "wave_height": [None] * len(hours), "wave_direction": [None] * len(hours), "wave_period": [None] * len(hours), "wind_wave_height": [None] * len(hours)}})
        else:
            items.append({"hourly": {"time": hours, "wave_height": [1.5 + k] * len(hours), "wave_direction": [270] * len(hours), "wave_period": [11.2] * len(hours), "wind_wave_height": [0.4] * len(hours)}})
    vals, land = grid.parse_ocean_chunk(items, sample, frames)
    assert land == {sample[1][0]}
    assert set(vals) == {sample[0][0], sample[2][0]}
    packed = grid.pack_ocean(vals, frames)
    assert packed["frames"][0]["h"][sample[0][0]] == 15
    assert packed["frames"][0]["p"][sample[2][0]] == 112
    assert packed["frames"][0]["h"][sample[1][0]] is None
    url = grid.ocean_url(sample)
    assert "cell_selection=nearest" in url and url.count(",") > 3
    try:
        grid.as_list({"error": True, "reason": "bad"}, 1)
        raise AssertionError("error answer accepted")
    except ValueError:
        pass


def test_storms():
    n = grid.WX_NLAT * grid.WX_NLON
    ws = [10] * n
    ps = [1012] * n
    pr = [0] * n
    # a gale cluster of 3 cells near 15N 135E, crossing nothing special
    i = round((18 - grid.WX_LAT0) / grid.WX_STEP)
    j = round((135 - grid.LON0) / grid.WX_STEP)
    for dj in (0, 1):
        ws[i * grid.WX_NLON + j + dj] = 90
        ps[i * grid.WX_NLON + j + dj] = 975
    ws[(i + 1) * grid.WX_NLON + j] = 70
    wx = {"lat0": grid.WX_LAT0, "lon0": grid.LON0, "step": grid.WX_STEP, "nlat": grid.WX_NLAT, "nlon": grid.WX_NLON,
          "times": [0], "frames": [{"ws": ws, "wd": [0] * n, "cc": [0] * n, "pr": pr, "ps": ps}]}
    storms = grid.find_storms(wx, 0)
    assert len(storms) == 1
    s = storms[0]
    assert s["cells"] == 3 and s["max_wind_kmh"] == 90 and s["min_pressure_hpa"] == 975
    assert 15 < s["lat"] < 25 and 130 < s["lon"] < 145
    # a cluster across the antimeridian stays one storm
    ws2 = [10] * n
    ws2[i * grid.WX_NLON + 0] = 80
    ws2[i * grid.WX_NLON + grid.WX_NLON - 1] = 80
    wx["frames"][0]["ws"] = ws2
    storms2 = grid.find_storms(wx, 0)
    assert len(storms2) == 1 and abs(abs(storms2[0]["lon"]) - 175.5) < 5


EVENTS = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [87.2, 11.6]},
            "properties": {
                "eventtype": "TC", "eventid": 1001351, "episodeid": 2, "eventname": "AKVAN-26",
                "name": "Tropical Cyclone AKVAN-26", "alertlevel": "Orange", "iscurrent": "true",
                "country": "India", "fromdate": "2026-11-16T18:00:00", "todate": "2026-11-17T00:00:00",
                "datemodified": "2026-11-17T02:21:18", "source": "JTWC",
                "severitydata": {"severity": 101.8512, "severitytext": "Tropical Storm (maximum wind speed of 102 km/h)", "severityunit": "km/h"},
                "url": {"geometry": "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001351&episodeid=2",
                        "report": "https://www.gdacs.org/report.aspx?eventid=1001351&episodeid=2&eventtype=TC"},
            },
        },
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [80.2, 15.8]},
            "properties": {
                "eventtype": "TC", "eventid": 1001346, "episodeid": 10, "eventname": "MURASU-26",
                "alertlevel": "Red", "iscurrent": "false", "todate": "2026-11-03T00:00:00",
                "severitydata": {"severity": 157, "severitytext": "x", "severityunit": "km/h"}, "url": {},
            },
        },
    ],
}


def _square(lon, lat, r):
    return [[lon - r, lat - r], [lon + r, lat - r], [lon + r, lat + r], [lon - r, lat + r], [lon - r, lat - r]]


GEOMETRY = {
    "type": "FeatureCollection",
    "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [87.2, 11.6]},
         "properties": {"polygonlabel": "Centroid", "Class": "Point_Centroid"}},
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [_square(87.0, 11.0, 2.0)]},
         "properties": {"polygondate": "2026-11-17T00:00:00", "polygonlabel": "60 km/h", "Class": "Poly_Green"}},
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [_square(87.0, 11.0, 1.0)]},
         "properties": {"polygondate": "2026-11-17T00:00:00", "polygonlabel": "90 km/h", "Class": "Poly_Orange"}},
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [_square(85.0, 13.0, 2.0)]},
         "properties": {"polygondate": "2026-11-18T12:00:00", "polygonlabel": "60 km/h", "Class": "Poly_Green"}},
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [_square(179.0, 13.0, 2.0)]},
         "properties": {"polygondate": "2026-11-19T12:00:00", "polygonlabel": "60 km/h"}},
    ],
}


def test_cyclones():
    events = cyclones.parse_events(json.dumps(EVENTS), NOW)
    assert [c["name"] for c in events] == ["AKVAN-26"]
    c = events[0]
    assert c["wind_kmh"] == 102 and c["category_key"] == "tropical_storm" and c["kind"] == "Cyclone"
    assert c["alert"] == "Orange" and "getgeometry" in c["geometry_url"]
    track = cyclones.parse_track(json.dumps(GEOMETRY), NOW)
    assert [p["forecast"] for p in track] == [False, True, True]
    assert abs(track[0]["lat"] - 11.0) < 0.01 and abs(track[0]["lon"] - 87.0) < 0.01
    assert track[0]["wind_kmh"] == 90
    assert abs(track[2]["lon"] - 179.0) < 0.01
    c["track"] = track
    appr = cyclones.closest_approach(c, 13.0, 85.0)
    assert appr["closest_km"] < 5 < appr["now_km"]
    assert cyclones.category(200) == (3, "category_3")
    assert cyclones.basin_word(20, -60) == "Hurricane"
    assert cyclones.basin_word(20, 130) == "Typhoon"
    assert cyclones.basin_word(-15, 120) == "Cyclone"


def _circle(lon, lat, r=0.3, n=16):
    pts = [[lon + r * math.cos(2 * math.pi * k / n), lat + r * math.sin(2 * math.pi * k / n)] for k in range(n)]
    return pts + [pts[0]]


def test_cyclone_point_track():
    """Real GDACS layout: PointRadii circles labelled with the time, class labelled segments."""
    adv = {"polygondate": "2026-11-17T18:00:00"}
    pts = [("16/11 18:00 UTC", 86.7, 11.3), ("17/11 18:00 UTC", 87.3, 13.1), ("18/11 06:00 UTC", 86.7, 13.8), ("19/11 18:00 UTC", 84.4, 17.5)]
    feats = [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [_circle(lon, lat)]},
              "properties": {**adv, "featuretype": "PointRadii", "polygonlabel": label, "Class": "Point_Polygon_Point_%d" % k}}
             for k, (label, lon, lat) in enumerate(pts)]
    feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[87.3, 13.1], [86.7, 13.8]]},
                  "properties": {**adv, "polygonlabel": "TS", "Class": "Line_Line_0", "forecast": True}})
    feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[86.7, 13.8], [84.4, 17.5]]},
                  "properties": {**adv, "polygonlabel": "TD", "Class": "Line_Line_1", "forecast": True}})
    feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [_square(87.0, 14.0, 3.0)]},
                  "properties": {"polygondate": "2026-11-18T06:00:00", "polygonlabel": "18/11 06:00", "featuretype": "WindRadii"}})
    track = cyclones.parse_track(json.dumps({"type": "FeatureCollection", "features": feats}), NOW)
    assert [p["time"][:16] for p in track] == ["2026-11-16T18:00", "2026-11-17T18:00", "2026-11-18T06:00", "2026-11-19T18:00"]
    assert [p["forecast"] for p in track] == [False, False, True, True]
    assert abs(track[2]["lat"] - 13.8) < 0.05 and abs(track[2]["lon"] - 86.7) < 0.05
    assert track[1]["wind_kmh"] == 90 and track[3]["wind_kmh"] == 55
    # new year: a December point read in January belongs to the old year
    assert cyclones._point_time("31/12 18:00 UTC", datetime(2027, 1, 1, 6, tzinfo=timezone.utc)).year == 2026


def test_period_fallback():
    marine = {"hourly": {"time": [0], "swell_wave_peak_period": [None], "swell_wave_period": [9.5], "wave_period": [7.0]}}
    row = surf.build_rows(marine, None)[0]
    assert row["sw_per"] == 9.5 and row["per"] == 7.0


def test_sharks():
    ids = {s["id"] for s in spots.builtin_spots()}
    # every shark area entry points to a real spot, an area and (if any) a service with an https link
    for spot_id, area in sharks.SPOT_AREAS.items():
        assert spot_id in ids, spot_id
        assert area in sharks._AREAS, area
        info = sharks.shark_info(spot_id)
        assert info["species"]
        if info["service"]:
            assert info["service"]["url"].startswith("https://")
    assert sharks.shark_info("muizenberg")["service"]["name"] == "Shark Spotters"
    assert sharks.shark_info("uluwatu") is None


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} tests passed")
