"""Webcams near the surf spots, from the Windy Webcams API (optional, needs the user's own free key).

The image URLs of the free API tier carry a token that expires after 10 minutes, so the
list is fetched when a spot is opened and cached only for a few minutes. Windy's terms:
images are shown in their original size or smaller, every image links to the Windy
webcam page or timelapse player, and the card shows "Webcams provided by windy.com".
"""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any

import aiohttp

WINDY_WEBCAMS_URL = "https://api.windy.com/webcams/api/v3/webcams"
RADIUS_KM = 15
MAX_WEBCAMS = 3
CACHE_SECONDS = 8 * 60  # the free tier image tokens expire after 10 minutes
TIMEOUT_SECONDS = 15
# categories that usually look at the sea
SEA_CATEGORIES = ("beach", "coast", "harbor", "harbour", "lake", "water", "sea", "surf")


class WebcamError(Exception):
    """The Windy Webcams API could not be used."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))


def _looks_at_sea(cam: dict[str, Any]) -> bool:
    for cat in cam.get("categories") or []:
        text = f"{cat.get('id', '')} {cat.get('name', '')}".lower()
        if any(word in text for word in SEA_CATEGORIES):
            return True
    return False


def parse_webcams(payload: dict[str, Any], lat: float, lon: float, limit: int = MAX_WEBCAMS) -> list[dict[str, Any]]:
    """Webcams of a Windy API v3 answer, sea facing ones first, then by distance."""
    out: list[dict[str, Any]] = []
    for cam in (payload or {}).get("webcams") or []:
        if cam.get("status") not in (None, "active"):
            continue
        images = (cam.get("images") or {}).get("current") or {}
        image = images.get("preview") or images.get("thumbnail")
        if not image:
            continue
        loc = cam.get("location") or {}
        clat, clon = loc.get("latitude"), loc.get("longitude")
        dist = _distance_km(lat, lon, clat, clon) if clat is not None and clon is not None else None
        player = cam.get("player") or {}
        urls = cam.get("urls") or {}
        link = urls.get("detail") or player.get("day") or player.get("live")
        if not link:
            continue  # every image must link back to Windy
        out.append({
            "id": cam.get("webcamId"),
            "title": cam.get("title") or "Webcam",
            "city": loc.get("city"),
            "distance_km": round(dist, 1) if dist is not None else None,
            "updated": cam.get("lastUpdatedOn"),
            "image": image,
            "link": link,
            "sea": _looks_at_sea(cam),
        })
    out.sort(key=lambda c: (not c["sea"], c["distance_km"] if c["distance_km"] is not None else 999))
    return out[:limit]


class WebcamClient:
    """Fetches and briefly caches the webcams near a spot."""

    def __init__(self, session: aiohttp.ClientSession, api_key: str) -> None:
        self._session = session
        self._key = api_key.strip()
        self._cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def async_near(self, spot_id: str, lat: float, lon: float) -> list[dict[str, Any]]:
        now = time.monotonic()
        hit = self._cache.get(spot_id)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
        lock = self._locks.setdefault(spot_id, asyncio.Lock())
        async with lock:
            hit = self._cache.get(spot_id)
            if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
                return hit[1]
            payload = await self._request(lat, lon)
            cams = parse_webcams(payload, lat, lon)
            self._cache[spot_id] = (time.monotonic(), cams)
            return cams

    async def async_check_key(self) -> None:
        """Raise WebcamError when the key does not work (used by the config flow)."""
        await self._request(0.0, 0.0, limit=1)

    async def _request(self, lat: float, lon: float, limit: int = 20) -> dict[str, Any]:
        params = {
            "nearby": f"{lat:.4f},{lon:.4f},{RADIUS_KM}",
            "limit": str(limit),
            "include": "categories,images,location,player,urls",
            "lang": "en",
        }
        headers = {"x-windy-api-key": self._key}
        try:
            async with self._session.get(
                WINDY_WEBCAMS_URL, params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=TIMEOUT_SECONDS)
            ) as resp:
                if resp.status in (401, 403):
                    raise WebcamError("invalid_key")
                if resp.status == 429:
                    raise WebcamError("rate_limited")
                if resp.status >= 400:
                    raise WebcamError(f"http_{resp.status}")
                return await resp.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise WebcamError("unreachable") from err
