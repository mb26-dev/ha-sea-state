"""Draw the Sea State Forecast brand images (icon, logo, dark variants) from code.

The artwork is generated, so there is no binary source file: a night globe with
wave height colours, a curling wave and a small surfer. The GitHub workflow runs
this script whenever brand_src changes and commits the PNG files Home Assistant needs.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parents[1] / "custom_components" / "sea_state" / "brand"
OUT.mkdir(parents=True, exist_ok=True)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]
FONT_LIGHT = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
]

S = 4  # supersampling


def font(paths: list[str], size: int) -> ImageFont.FreeTypeFont:
    for p in paths:
        if Path(p).is_file():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


STOPS = [(0.0, (9, 34, 78)), (0.25, (24, 122, 186)), (0.5, (38, 178, 196)), (0.7, (120, 214, 172)), (0.85, (242, 210, 110)), (1.0, (240, 138, 75))]


def palette(v: float):
    v = max(0.0, min(1.0, v))
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if v <= b:
            return lerp(ca, cb, (v - a) / (b - a))
    return STOPS[-1][1]


def emblem(size: int) -> Image.Image:
    """Square emblem: rounded dark tile, globe with a wave field, curling wave and surfer."""
    W = size * S
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    # background tile with a deep sea gradient
    tile = Image.new("RGBA", (W, W))
    td = ImageDraw.Draw(tile)
    for y in range(W):
        td.line([(0, y), (W, y)], fill=lerp((6, 20, 40), (2, 8, 18), y / W) + (255,))
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.2), fill=255)
    img.paste(tile, (0, 0), mask)

    cx, cy, r = W * 0.5, W * 0.47, W * 0.36
    # atmosphere glow
    glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - r * 1.1, cy - r * 1.1, cx + r * 1.1, cy + r * 1.1], fill=(90, 170, 255, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(W * 0.03))
    img.alpha_composite(glow)
    # globe: wave height field, lit from the upper left
    globe = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    px = globe.load()
    for y in range(int(cy - r), int(cy + r) + 1):
        for x in range(int(cx - r), int(cx + r) + 1):
            dx, dy = (x - cx) / r, (y - cy) / r
            q = dx * dx + dy * dy
            if q >= 1:
                continue
            z = math.sqrt(1 - q)
            lat = math.asin(-dy)
            lon = math.atan2(dx, z) + 0.6
            field = 0.25 + 0.22 * math.sin(lon * 3 + lat * 2) + 0.55 * math.exp(-((lat + 0.85) ** 2) / 0.05) + 0.4 * math.exp(-((lat - 0.8) ** 2 + (lon - 0.2) ** 2) / 0.06)
            c = palette(field)
            light = 0.45 + 0.65 * max(0.0, -0.55 * dx - 0.45 * dy + 0.7 * z)
            rim = (1 - z) ** 2.4 * 0.55
            col = tuple(int(min(255, c[i] * light * (1 - rim) + (120, 180, 255)[i] * rim)) for i in range(3))
            px[x, y] = col + (255,)
    img.alpha_composite(globe)
    d = ImageDraw.Draw(img)
    # soft crest arcs on the globe
    for k in range(6):
        yy = cy - r * 0.5 + k * r * 0.19
        half = math.sqrt(max(0.0, 1 - ((yy - cy) / r) ** 2)) * r
        for j in range(3):
            x0 = cx - half * 0.8 + j * half * 0.55 + (k % 2) * half * 0.2
            seg = [(x0 + t * half * 0.32, yy - math.sin(t * math.pi) * r * 0.035) for t in [i / 10 for i in range(11)]]
            if seg[-1][0] < cx + half * 0.85:
                d.line(seg, fill=(235, 250, 255, 120), width=max(1, int(W * 0.007)), joint="curve")
    # curling wave in front of the globe, breaking from right to left
    base_y = W * 0.9
    crest = (W * 0.7, base_y - W * 0.31)
    face = []
    for i in range(41):
        t = i / 40
        x = W * 0.0 + t * (crest[0] - W * 0.0)
        y = base_y - (t ** 2.2) * (base_y - crest[1])
        face.append((x, y))
    back = []
    for i in range(1, 31):
        t = i / 30
        x = crest[0] + t * (W * 1.0 - crest[0])
        y = crest[1] + (1 - (1 - t) ** 2) * (base_y - W * 0.06 - crest[1])
        back.append((x, y))
    body = face + back + [(W, W), (0, W)]
    wmask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(wmask).polygon(body, fill=255)
    grad = Image.new("RGBA", (W, W))
    gd = ImageDraw.Draw(grad)
    for y in range(int(crest[1]), W):
        t = max(0.0, (y - crest[1]) / (W - crest[1]))
        gd.line([(0, y), (W, y)], fill=lerp((70, 205, 222), (8, 60, 120), t ** 0.8) + (255,))
    img.paste(grad, (0, 0), wmask)
    d = ImageDraw.Draw(img)
    def bez(p0, p1, p2, p3, n=30):
        pts = []
        for i in range(n + 1):
            t = i / n
            mt = 1 - t
            pts.append((
                mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1],
            ))
        return pts

    # the lip throws forward (to the left) and down, leaving a dark hollow below it
    lip = bez(crest, (crest[0] - W * 0.06, crest[1] - W * 0.07), (crest[0] - W * 0.2, crest[1] - W * 0.03), (crest[0] - W * 0.19, crest[1] + W * 0.11))
    hollow = lip + [(crest[0] - W * 0.13, crest[1] + W * 0.17), (crest[0] - W * 0.02, crest[1] + W * 0.12), (crest[0] + W * 0.005, crest[1] + W * 0.02)]
    hm = Image.new("L", (W, W), 0)
    ImageDraw.Draw(hm).polygon(hollow, fill=255)
    hm = hm.filter(ImageFilter.GaussianBlur(W * 0.006))
    dark = Image.new("RGBA", (W, W), (5, 34, 72, 255))
    img.paste(dark, (0, 0), hm)
    d = ImageDraw.Draw(img)
    d.line(lip, fill=(250, 254, 255, 255), width=int(W * 0.03), joint="curve")
    for i, (lx, ly) in enumerate(lip[-6:]):
        rr = W * (0.012 + 0.004 * i)
        d.ellipse([lx - rr, ly - rr + W * 0.01 * i, lx + rr, ly + rr + W * 0.01 * i], fill=(250, 254, 255, 220))
    d.line(face[18:], fill=(250, 254, 255, 255), width=int(W * 0.02), joint="curve")
    # foam at the foot of the wave
    for i in range(16):
        fx = W * (0.44 + i * 0.03)
        fy = base_y - W * 0.02 + math.sin(i * 1.7) * W * 0.012
        rr = W * (0.014 + 0.008 * math.sin(i * 2.3) ** 2)
        d.ellipse([fx - rr, fy - rr, fx + rr, fy + rr], fill=(250, 254, 255, 235))
    # surfer on the face
    d = ImageDraw.Draw(img)
    sx, sy = W * 0.36, base_y - W * 0.1
    u = W * 0.022
    board = [(sx - 3.2 * u, sy + 1.7 * u), (sx + 3.4 * u, sy - 0.2 * u)]
    d.line(board, fill=(255, 207, 58, 255), width=int(u * 0.9))
    d.line([(sx - 1.0 * u, sy + 1.1 * u), (sx - 0.4 * u, sy - 1.2 * u)], fill=(16, 20, 28, 255), width=int(u * 0.75))
    d.line([(sx + 1.2 * u, sy + 0.5 * u), (sx + 0.2 * u, sy - 1.2 * u)], fill=(16, 20, 28, 255), width=int(u * 0.75))
    d.line([(sx - 0.1 * u, sy - 1.2 * u), (sx + 0.2 * u, sy - 3.0 * u)], fill=(16, 20, 28, 255), width=int(u * 0.9))
    d.line([(sx + 0.1 * u, sy - 2.6 * u), (sx - 1.8 * u, sy - 2.2 * u)], fill=(16, 20, 28, 255), width=int(u * 0.6))
    d.line([(sx + 0.1 * u, sy - 2.6 * u), (sx + 1.9 * u, sy - 3.0 * u)], fill=(16, 20, 28, 255), width=int(u * 0.6))
    d.ellipse([sx - 0.3 * u, sy - 4.2 * u, sx + 0.9 * u, sy - 3.0 * u], fill=(233, 194, 156, 255))
    # keep everything inside the rounded tile
    out = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def logo(height: int) -> Image.Image:
    """Banner: emblem plus the name, on a dark rounded background (works on light and dark themes)."""
    H = height * S
    W = int(H * 4.1)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bg = Image.new("RGBA", (W, H))
    bd = ImageDraw.Draw(bg)
    for x in range(W):
        bd.line([(x, 0), (x, H)], fill=lerp((4, 16, 32), (6, 28, 52), x / W) + (255,))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=int(H * 0.16), fill=255)
    img.paste(bg, (0, 0), mask)
    em = emblem(int(H * 0.84 / S))
    em = em.resize((int(H * 0.84), int(H * 0.84)), Image.LANCZOS)
    img.alpha_composite(em, (int(H * 0.08), int(H * 0.08)))
    d = ImageDraw.Draw(img)
    big = font(FONT_CANDIDATES, int(H * 0.34))
    small = font(FONT_LIGHT, int(H * 0.14))
    x0 = int(H * 1.02)
    d.text((x0, int(H * 0.16)), "Sea", font=big, fill=(238, 246, 251, 255))
    sea_w = d.textlength("Sea ", font=big)
    d.text((x0 + sea_w, int(H * 0.16)), "State", font=big, fill=(79, 211, 232, 255))
    d.text((x0 + int(H * 0.02), int(H * 0.6)), "FORECAST  ·  ocean · storms · surf", font=small, fill=(170, 200, 215, 255))
    return img.resize((W // S, H // S), Image.LANCZOS)


for name, size in (("icon.png", 256), ("icon@2x.png", 512)):
    emblem(size).save(OUT / name, optimize=True)
for suffix, height in (("", 128), ("@2x", 256)):
    banner = logo(height)
    for base in ("logo", "dark_logo"):
        banner.save(OUT / f"{base}{suffix}.png", optimize=True)

print("brand images written to", OUT)
