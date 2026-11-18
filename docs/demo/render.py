"""Renders the README screenshot of the lightning card (docs/images/lightning-card.jpg).

Run from the repository root with a web server on port 8765:
    python -m http.server 8765 &
    python docs/demo/render.py
The page uses simulated strikes (Blitzortung has no public feed for a screenshot job);
the map tiles are the real NASA GIBS images, loaded by the browser.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "images"
URL = "http://localhost:8765/docs/demo/lightning.html"


async def main() -> None:
    errors: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page(viewport={"width": 1000, "height": 900}, device_scale_factor=2)
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(URL)
        await page.wait_for_function(
            "window.__cards && window.__cards.every((c) => c.shadowRoot && c.shadowRoot.querySelector('.wrap'))",
            timeout=60000,
        )
        await page.wait_for_timeout(9000)  # map tiles load from NASA GIBS
        OUT.mkdir(parents=True, exist_ok=True)
        await page.locator("#wrap").screenshot(path=str(OUT / "lightning-card.jpg"), type="jpeg", quality=86)
        print("wrote docs/images/lightning-card.jpg")
        await browser.close()
    if errors:
        print("page errors:", errors)
        sys.exit(1)


asyncio.run(main())
