/*
 * Sea State Forecast card - live ocean, storms and surf on a living globe.
 * https://github.com/mb26-dev/ha-sea-state
 */

import { DEG, ecef, viewFrame, sunDirection, loadEarth, renderEarth, upsampleGrid, waveColor, WAVE_STOPS } from "./sea-state-earth.js?v=0.1.0b8";
import {
  CONDITION_COLORS,
  CONDITION_LABELS,
  CATEGORY_COLORS,
  rgba,
  drawSpotDot,
  cloudSprite,
  drawLightning,
  drawCyclone,
} from "./sea-state-art.js?v=0.1.0b8";

const VERSION = "0.1.0b8";

// animated SVG markers, shown as <img> above the globe so their own animations run
const ICON_BASE = new URL("./icons/", import.meta.url);
const ICON_FILES = {
  riding: "surfer.svg",
  paddling: "surf_paddle.svg",
  sitting: "waiting_surfer.svg",
  windy: "blown-out.svg",
  flag: "too-big.svg",
  cyclone: "cyclone.svg",
  gale: "storm-area.svg",
  shark: "shark-warning.svg",
};
const POSE_ICON = { barrel: "riding", riding: "riding", paddling: "paddling", sitting: "sitting", windy: "windy", flag: "flag" };
const OWN_RING = new Set(["windy", "flag", "gale", "shark"]);
const MAX_SPOT_ICONS = 28;
const ICON_TEXT = {};
const ICON_URLS = new Map();
let iconLoad = null;

function loadIcons() {
  if (!iconLoad) {
    iconLoad = Promise.all(
      Object.entries(ICON_FILES).map(async ([kind, file]) => {
        try {
          const resp = await fetch(new URL(`${file}?v=${VERSION}`, ICON_BASE));
          if (resp.ok) ICON_TEXT[kind] = await resp.text();
        } catch (_err) {
          // the canvas dots stay as fallback
        }
      })
    );
  }
  return iconLoad;
}

/** object URL of an icon, its outer ring recoloured (condition or storm category) */
function iconUrl(kind, ring) {
  const key = `${kind}|${ring || ""}`;
  let url = ICON_URLS.get(key);
  if (url) return url;
  let text = ICON_TEXT[kind];
  if (!text) return null;
  if (ring) text = text.replace(/(r="56" fill="none" stroke=")(#ffffff|url\(#ringGradC\))"/, `$1${ring}"`);
  url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  ICON_URLS.set(key, url);
  return url;
}
const MODES = [
  ["ocean", "Ocean & weather", "icon-ocean-weather.svg"],
  ["surf", "Surf", "icon-surf.svg"],
  ["all", "All", null],
];
// surf regions: key -> [lat, lon, zoom]
const SURF_VIEWS = {
  hawaii: [20.9, -157.4, 7.0],
  california: [35.5, -121.0, 3.4],
  central_america: [12.5, -90.0, 3.2],
  south_america: [-18.0, -62.0, 1.6],
  atlantic_americas: [25.0, -72.0, 2.4],
  europe: [48.0, -2.0, 2.4],
  morocco_islands: [31.0, -12.5, 4.2],
  africa: [-18.0, 22.0, 1.7],
  indian_ocean: [6.0, 78.0, 3.6],
  indonesia: [-5.0, 108.0, 2.6],
  asia: [18.0, 120.0, 2.0],
  australia: [-30.0, 140.0, 1.9],
  pacific: [-28.0, 178.0, 1.6],
};
// ocean basins: key, label, view [lat, lon, zoom], box [latMin, latMax, lonMin, lonMax]
const OCEAN_REGIONS = [
  ["north_atlantic", "North Atlantic", [42, -35, 1.7], [0, 70, -100, 10]],
  ["caribbean", "Caribbean & Gulf", [21, -78, 3.0], [8, 32, -100, -58]],
  ["east_pacific", "East Pacific", [15, -115, 2.2], [0, 35, -150, -80]],
  ["north_pacific", "North Pacific", [40, -165, 1.5], [25, 65, 140, -120]],
  ["west_pacific", "West Pacific", [20, 135, 2.0], [0, 45, 100, 180]],
  ["andaman", "Andaman Sea", [9, 96, 4.6], [3, 17, 90, 101]],
  ["bay_of_bengal", "Bay of Bengal", [15, 88, 3.4], [5, 24, 78, 98]],
  ["indian", "Indian Ocean", [-12, 75, 1.6], [-45, 25, 40, 110]],
  ["south_pacific", "South Pacific", [-30, -135, 1.5], [-60, 0, 150, -70]],
  ["southern_ocean", "Southern Ocean", [-55, 60, 1.4], [-75, -40, -180, 180]],
  ["mediterranean", "Mediterranean", [38, 17, 3.6], [30, 46, -6, 36]],
  ["north_sea", "North Sea & Baltic", [57, 7, 3.8], [50, 66, -5, 30]],
];
const PRESETS = {
  world: [15, 110, 1.0],
  ...SURF_VIEWS,
  ...Object.fromEntries(OCEAN_REGIONS.map(([k, , v]) => [k, v])),
};
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 16;
const DATA_REFRESH_MS = 5 * 60 * 1000;
const EARTH_RETRY_MS = 90 * 1000;
const SUN_REFRESH_MS = 60 * 1000;
const FIELD_REFRESH_MS = 10 * 60 * 1000;
const MAX_EARTH_PIXELS = 1.6e6;
const HOUR = 3600 * 1000;
const FORECAST_HOURS = 48;
const PLAY_HOURS_PER_SECOND = 4;

const ICONS = {
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  minus: "M19 13H5v-2h14v2z",
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14A8.2 8.2 0 0 1 4 12c0-.69.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 0 1 5.08 16zm2.95-8H5.08a7.99 7.99 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
  rotate: "M12 6v3l4-4-4-4v3a8 8 0 0 0-6.76 12.26l1.46-1.46A6 6 0 0 1 12 6zm6.76 1.74-1.46 1.46A6 6 0 0 1 12 18v-3l-4 4 4 4v-3a8 8 0 0 0 6.76-12.26z",
  full: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  unfull: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z",
  play: "M8 5v14l11-7z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
};

function svg(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
}

const CAM_COURTESY = `<div class="by muted">Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener">windy.com</a> &mdash; <a href="https://www.windy.com/webcams/add" target="_blank" rel="noopener">add a webcam</a></div>`;

/** sun elevation in degrees at a place and time (simple solar position, good to about 1 degree) */
function sunElevation(lat, lon, ms) {
  const rad = Math.PI / 180;
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}

/** "12 min ago" style age of an image */
function ageText(ms) {
  if (!Number.isFinite(ms)) return "";
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function rel(ms) {
  if (!ms) return "";
  const d = Date.now() - ms;
  const m = Math.round(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function distKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function inBox(lat, lon, box) {
  const [la0, la1, lo0, lo1] = box;
  if (lat < la0 || lat > la1) return false;
  return lo0 <= lo1 ? lon >= lo0 && lon <= lo1 : lon >= lo0 || lon <= lo1;
}

const COMPASS_NAMES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
function compass(deg) {
  if (deg == null || !Number.isFinite(deg)) return "";
  return COMPASS_NAMES[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

const DOUGLAS = [
  [0.0, 0, "Calm (glassy)"],
  [0.1, 1, "Calm (rippled)"],
  [0.5, 2, "Smooth"],
  [1.25, 3, "Slight"],
  [2.5, 4, "Moderate"],
  [4.0, 5, "Rough"],
  [6.0, 6, "Very rough"],
  [9.0, 7, "High"],
  [14.0, 8, "Very high"],
];
const SEA_STATE_NAMES = {
  calm_glassy: "Calm (glassy)",
  calm_rippled: "Calm (rippled)",
  smooth: "Smooth",
  slight: "Slight",
  moderate: "Moderate",
  rough: "Rough",
  very_rough: "Very rough",
  high: "High",
  very_high: "Very high",
  phenomenal: "Phenomenal",
};
function douglas(h) {
  if (h == null || !Number.isFinite(h)) return [null, ""];
  for (const [lim, code, label] of DOUGLAS) if (h <= lim) return [code, label];
  return [9, "Phenomenal"];
}
const BEAUFORT_KMH = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
const BEAUFORT_NAMES = ["Calm", "Light air", "Light breeze", "Gentle breeze", "Moderate breeze", "Fresh breeze", "Strong breeze", "Near gale", "Gale", "Strong gale", "Storm", "Violent storm", "Hurricane force"];
function beaufort(kmh) {
  if (kmh == null || !Number.isFinite(kmh)) return null;
  for (let i = 0; i < BEAUFORT_KMH.length; i++) if (kmh < BEAUFORT_KMH[i]) return i;
  return 12;
}
const WIND_KINDS = {
  glassy: "glassy",
  offshore: "offshore",
  cross_offshore: "cross-offshore",
  cross_shore: "cross-shore",
  onshore: "onshore",
};
const CATEGORY_NAMES = {
  tropical_depression: "Tropical depression",
  tropical_storm: "Tropical storm",
  category_1: "Category 1",
  category_2: "Category 2",
  category_3: "Category 3",
  category_4: "Category 4",
  category_5: "Category 5",
};
const BREAKS = { reef: "Reef break", point: "Point break", beach: "Beach break", rivermouth: "River mouth", bigwave: "Big wave spot", custom: "Custom spot" };

function starsHtml(rating) {
  const r = clamp(Math.round((rating || 0) * 2) / 2, 0, 5);
  let out = "";
  for (let i = 1; i <= 5; i++) {
    if (r >= i) out += "<span>★</span>";
    else if (r >= i - 0.5) out += '<span class="half">★</span>';
    else out += '<span class="off">★</span>';
  }
  return `<span class="stars" title="${r} of 5">${out}</span>`;
}

function ratingColor(r) {
  if (r == null) return CONDITION_COLORS.flat;
  if (r >= 4) return CONDITION_COLORS.epic;
  if (r >= 3) return CONDITION_COLORS.good;
  if (r >= 1.8) return CONDITION_COLORS.fair;
  if (r >= 0.6) return CONDITION_COLORS.poor;
  return CONDITION_COLORS.flat;
}

/** fill land cells of a grid with the mean of their sea neighbours, a few rings deep */
function fillLand(src, nlat, nlon, passes) {
  let cur = Float32Array.from(src);
  for (let p = 0; p < passes; p++) {
    const next = Float32Array.from(cur);
    let changed = false;
    for (let i = 0; i < nlat; i++) {
      for (let j = 0; j < nlon; j++) {
        const idx = i * nlon + j;
        if (cur[idx] === cur[idx]) continue;
        let sum = 0, n = 0;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nlat) continue;
          for (let dj = -1; dj <= 1; dj++) {
            const v = cur[ii * nlon + ((j + dj + nlon) % nlon)];
            if (v === v) {
              sum += v;
              n++;
            }
          }
        }
        if (n) {
          next[idx] = sum / n;
          changed = true;
        }
      }
    }
    cur = next;
    if (!changed) break;
  }
  return cur;
}

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; background: #02060c; border-radius: var(--ha-card-border-radius, 12px); }
  .stage { position: relative; width: 100%; overflow: hidden; user-select: none; -webkit-user-select: none;
    font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); color: #eef6fb; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  canvas.fx { touch-action: none; cursor: grab; }
  canvas.fx.dragging { cursor: grabbing; }
  .markers { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .markers img { position: absolute; left: 0; top: 0; display: block; will-change: transform; user-select: none; -webkit-user-drag: none; }
  .markers img.sel { filter: drop-shadow(0 0 7px rgba(255,255,255,.85)); }
  .markers .cbadge { position: absolute; left: 0; top: 0; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: #0b1622; border: 1.5px solid rgba(255,255,255,.85); color: #fff; font: 700 10.5px/15px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: center; will-change: transform; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
  .top { position: absolute; top: 10px; left: 12px; right: 12px; pointer-events: none; display: flex; flex-direction: column; gap: 7px; }
  .title { display: flex; align-items: baseline; gap: 8px; min-width: 0; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
  .title b { font-size: 16px; letter-spacing: .4px; font-weight: 650; flex: 0 0 auto; }
  .title b span { color: #4fd3e8; }
  .title .sub { font-size: 12px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; pointer-events: auto; padding-bottom: 2px; }
  .chips::-webkit-scrollbar { display: none; }
  .chips.fr { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 46px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 46px), transparent); }
  .chips.fl { -webkit-mask-image: linear-gradient(90deg, transparent, #000 46px); mask-image: linear-gradient(90deg, transparent, #000 46px); }
  .chips.fl.fr { -webkit-mask-image: linear-gradient(90deg, transparent, #000 46px, #000 calc(100% - 46px), transparent); mask-image: linear-gradient(90deg, transparent, #000 46px, #000 calc(100% - 46px), transparent); }
  .chip { flex: 0 0 auto; font-size: 11.5px; padding: 4px 10px; border-radius: 14px; cursor: pointer;
    background: rgba(8,16,26,.62); border: 1px solid rgba(255,255,255,.12); color: #e3eef5;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); white-space: nowrap; }
  .chip.on { background: rgba(40,170,210,.26); border-color: rgba(79,211,232,.8); color: #fff; }
  .chip .n { opacity: .75; margin-left: 4px; }
  .chip.sep { margin-left: 4px; }
  .chip .mi { width: 16px; height: 16px; margin: -2px 5px -3px -2px; vertical-align: middle; }
  .regions .chip { font-size: 11px; padding: 3px 9px; background: rgba(8,16,26,.5); }
  .regions .chip.quiet { color: #a9b8c4; }
  .regions .chip .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 0.5px; }
  .legend { position: absolute; left: 10px; bottom: 10px; pointer-events: none; font-size: 10.5px;
    background: rgba(4,10,18,.6); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 6px 9px;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); max-width: calc(100% - 70px); }
  .legend .bar { height: 7px; width: 190px; max-width: 100%; border-radius: 4px; margin: 3px 0 2px; }
  .legend .ticks { display: flex; justify-content: space-between; width: 190px; max-width: 100%; opacity: .8; }
  .legend .row { display: flex; flex-wrap: wrap; gap: 3px 9px; align-items: center; margin-top: 4px; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: -0.5px; }
  .legend .st { margin-top: 4px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .legend .st.bad { color: #ffc0a8; opacity: .95; }
  .controls { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
  .controls button, .info .x { width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,.14);
    background: rgba(8,14,22,.66); color: #eef; display: flex; align-items: center; justify-content: center; cursor: pointer;
    padding: 0; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .controls button.on { border-color: rgba(79,211,232,.85); color: #4fd3e8; }
  .controls svg, .info .x svg { width: 18px; height: 18px; fill: currentColor; }
  .info { position: absolute; top: 104px; right: 54px; width: 316px; max-height: calc(100% - 126px); overflow-y: auto;
    background: rgba(6,12,20,.84); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 12px 14px;
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-size: 12.5px; line-height: 1.45; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
  .info.hidden { display: none; }
  .stage:fullscreen { height: 100vh !important; border-radius: 0; }
  .stage.pseudo-full { position: fixed; inset: 0; width: 100vw; height: 100vh !important; height: 100dvh !important; z-index: 9999; }
  .timebar { position: absolute; left: 10px; right: 54px; bottom: 10px; display: none; align-items: center; gap: 8px;
    background: rgba(4,10,18,.8); border: 1px solid rgba(79,211,232,.45); border-radius: 12px; padding: 7px 10px;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); font-size: 11.5px; }
  .stage.timing .timebar { display: flex; }
  .stage.timing .legend { display: none; }
  .timebar button { width: 28px; height: 28px; flex: 0 0 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,.18);
    background: rgba(40,170,210,.2); color: #bdf1fb; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
  .timebar button svg { width: 16px; height: 16px; fill: currentColor; }
  .timebar input[type=range] { flex: 1 1 auto; min-width: 60px; accent-color: #36c4dc; }
  .timebar .when { flex: 0 0 auto; text-align: right; line-height: 1.25; white-space: nowrap; }
  .timebar .when b { color: #9fe9f6; font-weight: 650; }
  .timebar .when span { opacity: .7; font-size: 10.5px; }
  .info .x { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; }
  .info h3 { margin: 0 34px 2px 0; font-size: 16px; font-weight: 650; line-height: 1.25; }
  .info .where { opacity: .72; font-size: 11.5px; margin-bottom: 8px; }
  .badges { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; align-items: center; }
  .badge { font-size: 10.5px; font-weight: 650; letter-spacing: .4px; padding: 2px 8px; border-radius: 10px; color: #0b1118; white-space: nowrap; }
  .badge.soft { background: rgba(255,255,255,.1); color: #e8f1f6; font-weight: 500; letter-spacing: 0; }
  .stars { color: #ffcf3a; font-size: 14px; letter-spacing: 1px; white-space: nowrap; }
  .stars .off { color: rgba(255,255,255,.22); }
  .stars .half { background: linear-gradient(90deg, #ffcf3a 50%, rgba(255,255,255,.22) 50%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .days .stars { font-size: 12px; }
  .line { display: flex; gap: 8px; align-items: flex-start; margin: 6px 0; }
  .line .ic { flex: 0 0 18px; text-align: center; }
  .line .tx { flex: 1 1 auto; min-width: 0; }
  .muted { opacity: .65; font-size: 11px; }
  .head { display: flex; gap: 10px; align-items: center; margin: 4px 0 6px; }
  .head .big { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .head .big small { font-size: 12px; font-weight: 500; opacity: .75; margin-left: 2px; }
  .chart { margin: 8px 0 2px; }
  .chart svg { width: 100%; height: 64px; display: block; }
  .group { display: grid; gap: 4px; margin-top: 4px; }
  .group button { all: unset; cursor: pointer; display: grid; grid-template-columns: 10px minmax(0,1fr) auto auto; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; background: rgba(255,255,255,.05); font-size: 12px; }
  .group button:hover { background: rgba(255,255,255,.12); }
  .group .dot { width: 9px; height: 9px; border-radius: 50%; }
  .group .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group .s { color: #ffcf3a; letter-spacing: .5px; white-space: nowrap; }
  .group .m { opacity: .75; white-space: nowrap; }
  .days { margin-top: 8px; display: grid; grid-template-columns: auto auto minmax(0,1fr) auto; gap: 3px 8px; font-size: 11.5px; align-items: center; }
  .days .d { opacity: .8; white-space: nowrap; }
  .days .s { color: #ffcf3a; letter-spacing: .5px; white-space: nowrap; }
  .days .w { opacity: .7; white-space: nowrap; text-align: right; }
  .sharkbox { margin: 9px 0 4px; padding: 8px 9px; border-radius: 10px; background: rgba(239,68,68,.09); border: 1px solid rgba(239,68,68,.32); display: flex; gap: 9px; align-items: flex-start; }
  .sharkbox img { width: 34px; height: 34px; flex: 0 0 34px; }
  .sharkbox .t { font-weight: 650; font-size: 12.5px; margin-bottom: 1px; }
  .sharkbox a { color: #6fdcf0; text-decoration: none; font-weight: 600; }
  .sharkbox a:hover { text-decoration: underline; }
  .cams { margin: 9px 0 4px; }
  .cams .ct { font-weight: 650; font-size: 12.5px; margin-bottom: 5px; }
  .cams .cl { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
  .cams .cl::-webkit-scrollbar { display: none; }
  .cams a.cam { flex: 0 0 auto; width: 150px; color: inherit; text-decoration: none; border-radius: 8px; overflow: hidden; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
  .cams a.cam img { display: block; width: 150px; height: auto; max-width: 100%; }
  .cams a.cam .cn { padding: 3px 6px 4px; font-size: 11px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cams a.cam:hover { border-color: #6fdcf0; }
  .cams .by { font-size: 10.5px; margin-top: 4px; text-align: right; }
  .cams .by a { color: #6fdcf0; text-decoration: none; }
  .legend .shk { width: 14px; height: 14px; margin: -3px 3px -3px 0; vertical-align: middle; }
  .links { margin-top: 9px; display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; }
  .links a { color: #6fdcf0; text-decoration: none; }
  .links a:hover { text-decoration: underline; }
  .msg { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); font-size: 13px; opacity: .85; pointer-events: none; text-align: center; max-width: 80%; }
  @media (max-width: 520px) {
    .info { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 60%; }
    .stage.info-open .legend, .stage.info-open .controls, .stage.info-open .timebar { display: none; }
    .controls button { width: 31px; height: 31px; }
    .title b { font-size: 15px; }
    .legend .bar, .legend .ticks { width: 150px; }
  }
`;

class SeaStateCard extends HTMLElement {
  static getStubConfig() {
    return { mode: "all", center: "home", zoom: 1.6 };
  }

  static getConfigElement() {
    return document.createElement("sea-state-card-editor");
  }

  setConfig(config) {
    this._config = {
      title: "Sea State",
      height: 480,
      center: "home",
      mode: "all",
      regions: true,
      labels: true,
      rotate: false,
      waves: true,
      crests: true,
      clouds: true,
      rain: true,
      cyclones: true,
      spots: true,
      sharks: true,
      webcams: true,
      forecast: true,
      lighting: "day",
      units: "auto",
      quality: "auto",
      ...(config || {}),
    };
    if (this._stage) {
      this._stage.style.height = `${this._height()}px`;
      this._mode = this._config.mode;
      this._renderChips();
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    if (first) {
      this._initView();
      this._loadData();
      this._loadEarth();
    }
  }

  getCardSize() {
    return Math.ceil(this._height() / 50);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, min_rows: 5 };
  }

  _height() {
    const h = Number(this._config?.height);
    return Number.isFinite(h) && h >= 200 ? h : 480;
  }

  _imperial() {
    const u = this._config.units;
    if (u === "imperial") return true;
    if (u === "metric") return false;
    return this._hass?.config?.unit_system?.length === "mi";
  }

  _len(m, digits = 1) {
    if (m == null || !Number.isFinite(m)) return "–";
    return this._imperial() ? `${(m * 3.2808).toFixed(digits === 1 ? 0 : digits)} ft` : `${m.toFixed(digits)} m`;
  }

  _lenRange(a, b) {
    if (a == null || b == null) return "–";
    if (this._imperial()) return `${Math.round(a * 3.2808)}–${Math.round(b * 3.2808)} ft`;
    return `${a.toFixed(1)}–${b.toFixed(1)} m`;
  }

  _speed(kmh) {
    if (kmh == null || !Number.isFinite(kmh)) return "–";
    return this._imperial() ? `${Math.round(kmh * 0.6214)} mph` : `${Math.round(kmh)} km/h`;
  }

  _temp(c) {
    if (c == null || !Number.isFinite(c)) return "–";
    return this._imperial() ? `${Math.round(c * 1.8 + 32)} °F` : `${c.toFixed(1)} °C`;
  }

  _dist(km) {
    if (km == null) return "";
    return this._imperial() ? `${Math.round(km * 0.6214).toLocaleString("en-US")} mi` : `${Math.round(km).toLocaleString("en-US")} km`;
  }

  // ------------------------------------------------------------------ setup

  _build() {
    this._built = true;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="stage">
          <canvas class="stars"></canvas>
          <canvas class="earth"></canvas>
          <!-- id "slider": hass-swipe-navigation leaves gestures on #slider alone, so dragging the globe does not switch views -->
          <canvas class="fx" id="slider"></canvas>
          <div class="markers"></div>
          <div class="msg">Loading the oceans...</div>
          <div class="top">
            <div class="title"><b></b><span class="sub"></span></div>
            <div class="chips modes"></div>
            <div class="chips regions"></div>
          </div>
          <div class="legend"><div class="lt"></div><div class="bar"></div><div class="ticks"></div><div class="row"></div><div class="st"></div></div>
          <div class="controls">
            <button class="zin" title="Zoom in">${svg(ICONS.plus)}</button>
            <button class="zout" title="Zoom out">${svg(ICONS.minus)}</button>
            <button class="home" title="Back to start view">${svg(ICONS.home)}</button>
            <button class="world" title="Whole globe">${svg(ICONS.globe)}</button>
            <button class="rot" title="Rotate">${svg(ICONS.rotate)}</button>
            <button class="time" title="Forecast: the next 48 hours">${svg(ICONS.clock)}</button>
            <button class="full" title="Fullscreen">${svg(ICONS.full)}</button>
          </div>
          <div class="timebar">
            <button class="tplay" title="Play">${svg(ICONS.play)}</button>
            <input class="trange" type="range" min="0" max="${FORECAST_HOURS}" step="0.25" value="0">
            <div class="when"><b class="tdate"></b><br><span class="tsum"></span></div>
          </div>
          <div class="info hidden"></div>
        </div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._stage = $(".stage");
    this._stage.style.height = `${this._height()}px`;
    this._cStars = $("canvas.stars");
    this._cEarth = $("canvas.earth");
    this._cFx = $("canvas.fx");
    this._markers = $(".markers");
    this._iconMap = new Map();
    this._icons = [];
    loadIcons().then(() => {
      this._iconsReady = true;
      this._renderLegend();
      this._loop();
    });
    this._msg = $(".msg");
    this._titleEl = $(".title b");
    this._subEl = $(".title .sub");
    this._modesEl = $(".chips.modes");
    this._regionsEl = $(".chips.regions");
    for (const row of [this._modesEl, this._regionsEl]) this._scrollable(row);
    this._legend = $(".legend");
    this._info = $(".info");
    this._titleEl.innerHTML = this._titleHtml();

    this._mode = this._config.mode;
    this._firingOnly = false;
    this._rotate = !!this._config.rotate;
    this._spots = [];
    this._cyclones = [];
    this._storms = [];
    this._crests = [];
    this._clouds = [];
    this._flashes = [];
    this._pointers = new Map();
    this._vel = { lat: 0, lon: 0 };
    this._lastInput = 0;
    this._t = 0;
    this._earth = null;
    this._earthDirty = true;
    this._hqAt = 0;
    this._lastSun = 0;
    this._offsetH = 0;
    this._playing = false;
    this._field = null;
    this._fieldAt = 0;

    $(".zin").addEventListener("click", () => this._zoomBy(1.6));
    $(".zout").addEventListener("click", () => this._zoomBy(1 / 1.6));
    $(".home").addEventListener("click", () => {
      const [lat, lon, zoom] = this._startView();
      this._flyTo(lat, lon, zoom, null, typeof this._config.center === "string" && PRESETS[this._config.center] ? this._config.center : null);
    });
    $(".world").addEventListener("click", () => this._flyTo(this._view.lat, this._view.lon, 1.0));
    this._rotBtn = $(".rot");
    this._rotBtn.classList.toggle("on", this._rotate);
    this._rotBtn.addEventListener("click", () => {
      this._rotate = !this._rotate;
      this._rotBtn.classList.toggle("on", this._rotate);
      this._lastInput = 0;
    });
    this._timeBtn = $(".time");
    this._timeBtn.style.display = this._config.forecast === false ? "none" : "";
    this._timeBtn.addEventListener("click", () => this._toggleTime());
    this._tPlay = $(".tplay");
    this._tRange = $(".trange");
    this._tDate = $(".tdate");
    this._tSum = $(".tsum");
    this._tPlay.addEventListener("click", () => this._setPlaying(!this._playing));
    this._tRange.addEventListener("input", () => {
      this._setPlaying(false);
      this._setOffset(Number(this._tRange.value));
    });
    this._fullBtn = $(".full");
    this._fullBtn.addEventListener("click", () => this._toggleFull());
    this._onFullChange = () => this._syncFull();
    document.addEventListener("fullscreenchange", this._onFullChange);
    this._onKey = (e) => {
      if (e.key === "Escape" && this._pseudoFull) this._setPseudoFull(false);
    };
    document.addEventListener("keydown", this._onKey);
    this._renderChips();

    const fx = this._cFx;
    fx.addEventListener("pointerdown", (e) => this._onDown(e));
    fx.addEventListener("pointermove", (e) => this._onMove(e));
    fx.addEventListener("pointerup", (e) => this._onUp(e));
    fx.addEventListener("pointercancel", (e) => this._onUp(e, true));
    fx.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
    fx.addEventListener("dblclick", (e) => this._onDouble(e));
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this._stage);
    this._io = new IntersectionObserver((entries) => {
      this._visible = entries.some((en) => en.isIntersecting);
      this._loop();
    });
    this._io.observe(this._stage);
    this._onVis = () => this._loop();
    document.addEventListener("visibilitychange", this._onVis);
  }

  connectedCallback() {
    if (this._built) {
      this._ro?.observe(this._stage);
      this._io?.observe(this._stage);
      if (this._hass) {
        this._loadData();
        if (!this._earth) this._loadEarth();
      }
      this._loop();
    }
  }

  disconnectedCallback() {
    this._visible = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._io?.disconnect();
    this._ro?.disconnect();
    clearTimeout(this._dataTimer);
    clearTimeout(this._earthTimer);
    if (this._pseudoFull) this._setPseudoFull(false);
  }

  // ------------------------------------------------------------------ fullscreen

  _isFull() {
    return !!this._pseudoFull || (!!document.fullscreenElement && document.fullscreenElement === this);
  }

  _toggleFull() {
    if (this._pseudoFull) {
      this._setPseudoFull(false);
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    const el = this._stage;
    if (document.fullscreenEnabled && el.requestFullscreen) {
      el.requestFullscreen().catch(() => this._setPseudoFull(true));
    } else {
      this._setPseudoFull(true);
    }
  }

  _setPseudoFull(on) {
    this._pseudoFull = on;
    this._stage.classList.toggle("pseudo-full", on);
    this._syncFull();
  }

  _syncFull() {
    const full = this._isFull() || document.fullscreenElement === this._stage;
    this._fullBtn.innerHTML = svg(full ? ICONS.unfull : ICONS.full);
    this._fullBtn.title = full ? "Exit fullscreen" : "Fullscreen";
    this._fullBtn.classList.toggle("on", full);
    setTimeout(() => this._resize(), 60);
  }

  _scrollable(row) {
    // fade the edge where more chips are hidden, so it is clear the row scrolls
    const fade = () => {
      const max = row.scrollWidth - row.clientWidth;
      row.classList.toggle("fl", max > 2 && row.scrollLeft > 2);
      row.classList.toggle("fr", max > 2 && row.scrollLeft < max - 2);
    };
    row._fade = fade;
    row.addEventListener("scroll", fade, { passive: true });
    if (typeof ResizeObserver === "function") new ResizeObserver(fade).observe(row);
    row.addEventListener(
      "wheel",
      (e) => {
        if (row.scrollWidth <= row.clientWidth) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!d) return;
        e.preventDefault();
        row.scrollLeft += d;
      },
      { passive: false }
    );
    let drag = null;
    row.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || row.scrollWidth <= row.clientWidth) return;
      drag = { x: e.clientX, left: row.scrollLeft, moved: 0 };
    });
    row.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      row.scrollLeft = drag.left - dx;
    });
    let draggedAt = 0;
    row.addEventListener(
      "click",
      (ev) => {
        if (performance.now() - draggedAt < 250) ev.stopPropagation();
      },
      { capture: true }
    );
    row.addEventListener("pointerup", () => {
      if (drag && drag.moved > 5) draggedAt = performance.now();
      drag = null;
    });
    row.addEventListener("pointerleave", () => (drag = null));
  }

  _titleHtml() {
    const title = String(this._config.title ?? "Sea State");
    if (title === "Sea State") return "Sea <span>State</span>";
    return esc(title);
  }

  _startView() {
    const c = this._config.center;
    const userZoom = Number(this._config.zoom);
    const z = clamp(Number.isFinite(userZoom) && userZoom > 0 ? userZoom : 1.6, ZOOM_MIN, ZOOM_MAX);
    if (Array.isArray(c) && c.length >= 2) return [Number(c[0]), Number(c[1]), z];
    if (typeof c === "string" && PRESETS[c]) {
      const p = PRESETS[c];
      return [p[0], p[1], Number.isFinite(userZoom) && userZoom > 0 ? z : p[2]];
    }
    const lat = this._hass?.config?.latitude ?? 0;
    const lon = this._hass?.config?.longitude ?? 110;
    return [lat, lon, z];
  }

  _initView() {
    const [lat, lon, zoom] = this._startView();
    this._view = { lat, lon, zoom };
    const c = this._config.center;
    this._region = typeof c === "string" && PRESETS[c] && c !== "world" ? c : null;
  }

  _resize() {
    const r = this._stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this._w = r.width;
    this._h = r.height;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fx = this._cFx;
    fx.width = Math.round(this._w * this._dpr);
    fx.height = Math.round(this._h * this._dpr);
    this._drawStars();
    this._earthDirty = true;
    this._loop();
  }

  _drawStars() {
    const c = this._cStars;
    c.width = Math.round(this._w * this._dpr);
    c.height = Math.round(this._h * this._dpr);
    const ctx = c.getContext("2d");
    const W = c.width, H = c.height;
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#081626");
    bg.addColorStop(0.6, "#030912");
    bg.addColorStop(1, "#010306");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    let seed = 7654321;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = Math.round((W * H) / (2600 * this._dpr * this._dpr));
    for (let i = 0; i < n; i++) {
      const x = rnd() * W, y = rnd() * H;
      const m = rnd();
      const r = (m > 0.97 ? 1.3 : m > 0.85 ? 0.9 : 0.55) * this._dpr;
      const tint = rnd();
      ctx.fillStyle = tint > 0.9 ? `rgba(255,224,190,${0.3 + m * 0.5})` : tint > 0.78 ? `rgba(170,215,255,${0.35 + m * 0.5})` : `rgba(255,255,255,${0.25 + m * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _quality() {
    const q = this._config.quality;
    if (q === "low" || q === "high") return q;
    try {
      const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      const mem = navigator.deviceMemory;
      if (coarse || (typeof mem === "number" && mem < 4)) return "low";
    } catch (_e) {
      return "high";
    }
    return "high";
  }

  // ------------------------------------------------------------------ data

  async _loadData() {
    clearTimeout(this._dataTimer);
    try {
      const resp = await this._hass.fetchWithAuth("/api/sea_state/data");
      if (resp.status === 503) {
        this._msg.textContent = "Sea State is loading the first forecasts...";
        this._dataTimer = setTimeout(() => this._loadData(), 15000);
        return;
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this._setData(data);
      if (data.grid_version && (!this._grid || this._grid.version !== data.grid_version)) await this._loadGrid();
      this._msg.textContent = this._grid?.ocean || this._spots.some((s) => s.now) ? "" : "Sea State is loading the global wave and weather data, this takes a few minutes...";
    } catch (err) {
      this._msg.textContent = this._data ? "" : `Sea State data not available (${err.message}). Is the Sea State Forecast integration set up?`;
    }
    this._dataTimer = setTimeout(() => this._loadData(), DATA_REFRESH_MS);
  }

  async _loadGrid() {
    try {
      const resp = await this._hass.fetchWithAuth("/api/sea_state/grid");
      if (!resp.ok) return;
      this._setGrid(await resp.json());
    } catch (_err) {
      // next data refresh tries again
    }
  }

  async _loadEarth() {
    clearTimeout(this._earthTimer);
    try {
      this._earth = await loadEarth(this._hass);
      this._earthDirty = true;
      this._loop();
    } catch (_err) {
      this._earthTimer = setTimeout(() => this._loadEarth(), EARTH_RETRY_MS);
    }
  }

  /** used by the preview page and by tests */
  setPreviewData(data, grid, earth) {
    if (earth) {
      this._earth = earth;
      this._earthDirty = true;
    }
    if (data) this._setData(data);
    if (grid) this._setGrid(grid);
    this._msg.textContent = "";
  }

  _setData(data) {
    this._data = data;
    this._spots = (data.spots || [])
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s, i) => ({ ...s, p: ecef(s.lat, s.lon), seed: (i * 0.731) % 7 }));
    this._cyclones = (data.cyclones || []).map((c) => ({
      ...c,
      p: ecef(c.lat, c.lon),
      track: (c.track || []).map((q) => ({ ...q, p: ecef(q.lat, q.lon), ms: new Date(q.time).getTime() })),
    }));
    this._storms = (data.storms || []).filter((s) => s.at_sea).map((s) => ({ ...s, p: ecef(s.lat, s.lon) }));
    this._renderChips();
    this._renderHeader();
    this._renderLegend();
    if (this._selected) this._renderInfo();
    this._loop();
  }

  _setGrid(grid) {
    this._grid = grid;
    this._field = null;
    this._fieldAt = 0;
    this._earthDirty = true;
    this._renderLegend();
    this._loop();
  }

  _now() {
    return Date.now() + this._offsetH * HOUR;
  }

  /** wave and weather fields for the shown time, interpolated between the 3 hourly frames */
  _ensureField(force) {
    const g = this._grid;
    if (!g) return null;
    const t = this._now();
    if (!force && this._field && Math.abs(t - this._fieldAt) < (this._offsetH ? 15 * 60 * 1000 : FIELD_REFRESH_MS)) return this._field;
    const pick = (block) => {
      if (!block || !block.times || !block.times.length) return null;
      const ts = t / 1000;
      const times = block.times;
      if (ts <= times[0]) return [0, 0, 0];
      const last = times.length - 1;
      if (ts >= times[last]) return [last, last, 0];
      let k = 0;
      while (k < last && times[k + 1] < ts) k++;
      return [k, k + 1, (ts - times[k]) / (times[k + 1] - times[k])];
    };
    const out = { t };
    const o = g.ocean;
    const po = pick(o);
    if (o && po) {
      const [a, b, f] = po;
      const A = o.frames[a], B = o.frames[b];
      const n = o.nlat * o.nlon;
      const h = new Float32Array(n), p = new Float32Array(n), w = new Float32Array(n), mask = new Float32Array(n);
      const ux = new Float32Array(n), uy = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const ha = A.h[i], hb = B.h[i];
        if (ha == null && hb == null) {
          h[i] = p[i] = w[i] = ux[i] = uy[i] = NaN;
          continue;
        }
        mask[i] = 1;
        const H0 = ha == null ? hb : ha, H1 = hb == null ? ha : hb;
        h[i] = (H0 * (1 - f) + H1 * f) / 10;
        const pa = A.p[i] ?? B.p[i], pb = B.p[i] ?? A.p[i];
        p[i] = pa == null ? NaN : (pa * (1 - f) + pb * f) / 10;
        const wa = A.w[i] ?? 0, wb = B.w[i] ?? 0;
        w[i] = (wa * (1 - f) + wb * f) / 10;
        const da = A.d[i] ?? B.d[i], db = B.d[i] ?? A.d[i];
        if (da == null) {
          ux[i] = uy[i] = NaN;
        } else {
          ux[i] = Math.sin(da * DEG) * (1 - f) + Math.sin(db * DEG) * f;
          uy[i] = Math.cos(da * DEG) * (1 - f) + Math.cos(db * DEG) * f;
        }
      }
      const hFilled = fillLand(h, o.nlat, o.nlon, 6);
      out.ocean = {
        nlat: o.nlat, nlon: o.nlon, lat0: o.lat0, lon0: o.lon0, step: o.step,
        h: hFilled, p: fillLand(p, o.nlat, o.nlon, 3), w: fillLand(w, o.nlat, o.nlon, 3),
        ux: fillLand(ux, o.nlat, o.nlon, 3), uy: fillLand(uy, o.nlat, o.nlon, 3), mask,
        // smooth version for painting the globe (the coarse grid shows edges otherwise)
        fine: upsampleGrid(hFilled, o.nlat, o.nlon, o.step, 4, 0),
        fineMask: upsampleGrid(mask, o.nlat, o.nlon, o.step, 4, 0, 1),
      };
    }
    const wx = g.weather;
    const pw = pick(wx);
    if (wx && pw) {
      const [a, b, f] = pw;
      const A = wx.frames[a], B = wx.frames[b];
      const n = wx.nlat * wx.nlon;
      const ws = new Float32Array(n), cc = new Float32Array(n), pr = new Float32Array(n), ps = new Float32Array(n);
      const ux = new Float32Array(n), uy = new Float32Array(n);
      const lerp = (x, y) => (x == null ? (y == null ? NaN : y) : y == null ? x : x * (1 - f) + y * f);
      for (let i = 0; i < n; i++) {
        ws[i] = lerp(A.ws[i], B.ws[i]);
        cc[i] = lerp(A.cc[i], B.cc[i]);
        pr[i] = lerp(A.pr[i], B.pr[i]) / 10;
        ps[i] = lerp(A.ps[i], B.ps[i]);
        const da = A.wd[i] ?? B.wd[i], db = B.wd[i] ?? A.wd[i];
        ux[i] = da == null ? NaN : Math.sin(da * DEG) * (1 - f) + Math.sin(db * DEG) * f;
        uy[i] = da == null ? NaN : Math.cos(da * DEG) * (1 - f) + Math.cos(db * DEG) * f;
      }
      out.weather = { nlat: wx.nlat, nlon: wx.nlon, lat0: wx.lat0, lon0: wx.lon0, step: wx.step, ws, cc, pr, ps, ux, uy };
    }
    this._field = out;
    this._fieldAt = t;
    this._earthDirty = true;
    return out;
  }

  /** bilinear sample of a grid array at lat/lon */
  _sample(block, arr, lat, lon) {
    const fi = (lat - block.lat0) / block.step;
    const fj = ((((lon - block.lon0) % 360) + 360) % 360) / block.step;
    let i0 = Math.floor(fi);
    let j0 = Math.floor(fj);
    const ti = fi - i0, tj = fj - j0;
    let i1 = i0 + 1;
    i0 = clamp(i0, 0, block.nlat - 1);
    i1 = clamp(i1, 0, block.nlat - 1);
    const j1 = (j0 + 1) % block.nlon;
    j0 %= block.nlon;
    const n = block.nlon;
    return (arr[i0 * n + j0] * (1 - tj) + arr[i0 * n + j1] * tj) * (1 - ti) + (arr[i1 * n + j0] * (1 - tj) + arr[i1 * n + j1] * tj) * ti;
  }

  _oceanAt(lat, lon) {
    const f = this._field?.ocean;
    if (!f) return null;
    const h = this._sample(f, f.h, lat, lon);
    if (!(h === h)) return null;
    const sea = this._sample(f, f.mask, lat, lon);
    const ux = this._sample(f, f.ux, lat, lon), uy = this._sample(f, f.uy, lat, lon);
    const dir = ux === ux ? ((Math.atan2(ux, uy) / DEG) + 360) % 360 : null;
    const p = this._sample(f, f.p, lat, lon);
    return { h, sea, dir, p: p === p ? p : null, w: this._sample(f, f.w, lat, lon) };
  }

  _weatherAt(lat, lon) {
    const f = this._field?.weather;
    if (!f) return null;
    const ws = this._sample(f, f.ws, lat, lon);
    if (!(ws === ws)) return null;
    const ux = this._sample(f, f.ux, lat, lon), uy = this._sample(f, f.uy, lat, lon);
    return {
      ws,
      wd: ux === ux ? ((Math.atan2(ux, uy) / DEG) + 360) % 360 : null,
      cc: this._sample(f, f.cc, lat, lon),
      pr: this._sample(f, f.pr, lat, lon),
      ps: this._sample(f, f.ps, lat, lon),
    };
  }

  /** whether a point is sea, from the NASA imagery (finer than the grid) when available */
  _isSea(lat, lon) {
    const e = this._earth;
    if (e && e.ocean) {
      const u = Math.floor(((lon + 180) / 360) * e.w) % e.w;
      const v = clamp(Math.floor(((90 - lat) / 180) * e.h), 0, e.h - 1);
      return e.ocean[v * e.w + u] > 140;
    }
    const f = this._field?.ocean;
    return !!f && this._sample(f, f.mask, lat, lon) > 0.6;
  }

  // ------------------------------------------------------------------ header, chips, legend

  _showSurf() {
    return this._config.spots !== false && (this._mode === "surf" || this._mode === "all");
  }

  _showWeather() {
    return this._mode === "ocean" || this._mode === "all";
  }

  _firingThreshold() {
    return Number(this._data?.firing) || 3.5;
  }

  _renderHeader() {
    const parts = [];
    const firing = this._spots.filter((s) => s.now && s.now.rating >= this._firingThreshold()).length;
    const cyc = this._cyclones.length;
    if (cyc) parts.push(`${cyc} tropical cyclone${cyc === 1 ? "" : "s"}`);
    if (this._storms.length) parts.push(`${this._storms.length} gale area${this._storms.length === 1 ? "" : "s"}`);
    parts.push(`${firing} spot${firing === 1 ? "" : "s"} firing`);
    this._subEl.textContent = parts.join(" · ");
  }

  _renderChips() {
    if (!this._modesEl) return;
    const firing = this._spots.filter((s) => s.now && s.now.rating >= this._firingThreshold()).length;
    const chips = MODES.map(([key, label, icon]) => {
      const img = icon ? `<img class="mi" src="${new URL(`${icon}?v=${VERSION}`, ICON_BASE).href}" alt="">` : "";
      return `<span class="chip ${this._mode === key ? "on" : ""}" data-m="${key}">${img}${label}</span>`;
    });
    if (this._showSurf()) {
      chips.push(`<span class="chip sep ${this._firingOnly ? "on" : ""}" data-f="firing">Firing<span class="n">${firing}</span></span>`);
    }
    this._modesEl.innerHTML = chips.join("");
    this._modesEl.querySelectorAll(".chip").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.dataset.m) {
          this._mode = el.dataset.m;
          this._earthDirty = true;
          this._clouds = [];
        } else if (el.dataset.f) {
          this._firingOnly = !this._firingOnly;
        }
        this._renderChips();
        this._renderLegend();
      });
    });
    this._renderRegions();
  }

  _regionList() {
    if (this._config.regions === false) return [];
    if (this._mode === "surf") {
      const names = this._data?.regions || {};
      return Object.keys(SURF_VIEWS).map((k) => ({ key: k, label: names[k] || k, kind: "surf" }));
    }
    return OCEAN_REGIONS.map(([key, label, , box]) => ({ key, label, box, kind: "ocean" }));
  }

  _renderRegions() {
    const list = this._regionList();
    this._regionsEl.style.display = list.length ? "" : "none";
    if (!list.length) return;
    const thr = this._firingThreshold();
    const html = list.map((r) => {
      let n = 0;
      let color = null;
      let title = r.label;
      if (r.kind === "surf") {
        const inReg = this._spots.filter((s) => s.region === r.key && s.now);
        n = inReg.filter((s) => s.now.rating >= thr).length;
        const best = inReg.reduce((m, s) => Math.max(m, s.now.rating), 0);
        if (best >= 1.8) color = ratingColor(best);
        title = `${r.label}: ${n} firing, best ${best.toFixed(1)} stars`;
      } else {
        const cyc = this._cyclones.filter((c) => inBox(c.lat, c.lon, r.box));
        const gales = this._storms.filter((s) => inBox(s.lat, s.lon, r.box));
        n = cyc.length + gales.length;
        if (cyc.length) color = CATEGORY_COLORS[Math.max(...cyc.map((c) => c.category || 0))];
        else if (gales.length) color = "#c7d3dc";
        title = `${r.label}: ${cyc.length} cyclones, ${gales.length} gale areas`;
      }
      const dot = color ? `<span class="dot" style="background:${color}"></span>` : "";
      const cls = ["chip", this._region === r.key ? "on" : "", n ? "" : "quiet"].filter(Boolean).join(" ");
      return `<span class="${cls}" data-r="${r.key}" title="${esc(title)}">${dot}${esc(r.label)}${n ? `<span class="n">${n}</span>` : ""}</span>`;
    });
    this._regionsEl.innerHTML = html.join("");
    this._regionsEl.querySelectorAll(".chip").forEach((el) => el.addEventListener("click", () => this._goRegion(el.dataset.r)));
    requestAnimationFrame(() => this._regionsEl?._fade?.());
  }

  _goRegion(key) {
    const v = PRESETS[key];
    if (!v) return;
    if (this._selected) {
      this._selected = null;
      this._renderInfo();
    }
    this._flyTo(v[0], v[1], v[2], null, key);
    this._regionsEl.querySelector(`[data-r="${key}"]`)?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  _setRegion(key) {
    if (this._region === key) return;
    this._region = key;
    this._regionsEl?.querySelectorAll(".chip").forEach((el) => el.classList.toggle("on", el.dataset.r === key));
  }

  _renderLegend() {
    if (!this._legend) return;
    const imp = this._imperial();
    const ticks = imp ? [0, 3, 6, 10, 15, 25, 40] : [0, 1, 2, 4, 6, 9, 14];
    const maxM = 14;
    const grad = WAVE_STOPS.filter((s) => s[0] <= maxM).map(([m, c]) => `rgb(${c[0]},${c[1]},${c[2]}) ${((m / maxM) * 100).toFixed(1)}%`);
    this._legend.querySelector(".lt").textContent = `Significant wave height (${imp ? "ft" : "m"})`;
    this._legend.querySelector(".bar").style.background = `linear-gradient(90deg, ${grad.join(", ")})`;
    this._legend.querySelector(".ticks").innerHTML = ticks.map((t) => `<span>${t}</span>`).join("");
    const row = this._legend.querySelector(".row");
    if (this._showSurf()) {
      const shark = this._config.sharks !== false && iconUrl("shark", null);
      row.innerHTML = ["epic", "good", "fair", "poor", "flat"].map((k) => `<span><i style="background:${CONDITION_COLORS[k]}"></i>${CONDITION_LABELS[k]}</span>`).join("")
        + (shark ? `<span><img class="shk" src="${shark}" alt="">Shark area</span>` : "");
    } else {
      row.innerHTML = `<span><i style="background:#ffffff"></i>Clouds</span><span><i style="background:#8fb2d8"></i>Rain</span><span><i style="background:${CATEGORY_COLORS[3]}"></i>Cyclone</span>`;
    }
    const st = this._legend.querySelector(".st");
    const src = this._data?.sources || {};
    const bad = Object.entries(src).filter(([, s]) => s.enabled && s.error);
    const NAMES = { ocean: "Waves", weather: "Weather", spots: "Spots", cyclones: "Cyclones (GDACS)" };
    if (bad.length) {
      st.textContent = `${bad.map(([k]) => NAMES[k] || k).join(", ")} not reachable · last data shown`;
      st.classList.add("bad");
    } else {
      const gu = this._data?.grid_updated ? rel(this._data.grid_updated * 1000) : "";
      st.textContent = gu ? `Global model ${gu} · Open-Meteo, GDACS` : "Open-Meteo, GDACS";
      st.classList.remove("bad");
    }
  }

  // ------------------------------------------------------------------ geometry

  _R() {
    return this._view.zoom * Math.min(this._w, this._h) * 0.42;
  }

  /** daylight everywhere (default) or the real day and night with city lights */
  _allDay() {
    return this._config.lighting !== "real";
  }

  _frame() {
    return viewFrame(this._view.lat, this._view.lon);
  }

  _project(p, G, R) {
    return { x: this._w / 2 + R * dot(p, G.east), y: this._h / 2 - R * dot(p, G.north), z: dot(p, G.view) };
  }

  _projLL(lat, lon, G, R) {
    const la = lat * DEG, lo = lon * DEG, c = Math.cos(la);
    const p0 = c * Math.cos(lo), p1 = c * Math.sin(lo), p2 = Math.sin(la);
    return {
      x: this._w / 2 + R * (p0 * G.east[0] + p1 * G.east[1] + p2 * G.east[2]),
      y: this._h / 2 - R * (p0 * G.north[0] + p1 * G.north[1] + p2 * G.north[2]),
      z: p0 * G.view[0] + p1 * G.view[1] + p2 * G.view[2],
    };
  }

  _unproject(sx, sy) {
    const R = this._R();
    const x = (sx - this._w / 2) / R;
    const y = (this._h / 2 - sy) / R;
    const q = x * x + y * y;
    if (q >= 1) return null;
    const z = Math.sqrt(1 - q);
    const G = this._frame();
    const n = [0, 1, 2].map((i) => x * G.east[i] + y * G.north[i] + z * G.view[i]);
    return { lat: Math.asin(clamp(n[2], -1, 1)) / DEG, lon: Math.atan2(n[1], n[0]) / DEG };
  }

  /** screen direction (unit) of a compass bearing at a point */
  _screenDir(lat, lon, G, bearing) {
    const la = lat * DEG, lo = lon * DEG;
    const e = [-Math.sin(lo), Math.cos(lo), 0];
    const n = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    const ex = dot(e, G.east), ey = -dot(e, G.north);
    const nx = dot(n, G.east), ny = -dot(n, G.north);
    const b = bearing * DEG;
    const dx = Math.sin(b) * ex + Math.cos(b) * nx;
    const dy = Math.sin(b) * ey + Math.cos(b) * ny;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    return [dx / len, dy / len, len];
  }

  /** a random visible point on the globe */
  _randomVisible(R) {
    const W = this._w, H = this._h;
    const cx = W / 2, cy = H / 2;
    const x0 = Math.max(0, cx - R), x1 = Math.min(W, cx + R);
    const y0 = Math.max(0, cy - R), y1 = Math.min(H, cy + R);
    for (let k = 0; k < 6; k++) {
      const x = x0 + Math.random() * (x1 - x0);
      const y = y0 + Math.random() * (y1 - y0);
      const ll = this._unproject(x, y);
      if (ll) return ll;
    }
    return null;
  }

  // ------------------------------------------------------------------ interaction

  _markInput() {
    this._lastInput = performance.now();
    this._fly = null;
  }

  _pos(e) {
    const r = this._cFx.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onDown(e) {
    try {
      this._cFx.setPointerCapture?.(e.pointerId);
    } catch (_err) {
      // synthetic pointers cannot be captured
    }
    const pos = this._pos(e);
    this._pointers.set(e.pointerId, pos);
    this._markInput();
    this._vel = { lat: 0, lon: 0 };
    if (this._pointers.size === 1) {
      this._drag = { x: pos.x, y: pos.y, t: performance.now(), moved: 0 };
      this._cFx.classList.add("dragging");
    } else if (this._pointers.size === 2) {
      const [a, b] = [...this._pointers.values()];
      this._pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this._view.zoom };
      this._drag = null;
    }
  }

  _onMove(e) {
    if (!this._pointers.has(e.pointerId)) return;
    const pos = this._pos(e);
    this._pointers.set(e.pointerId, pos);
    if (this._pinch && this._pointers.size >= 2) {
      const [a, b] = [...this._pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this._setZoom(this._pinch.zoom * (d / this._pinch.d));
      this._markInput();
      return;
    }
    if (!this._drag) return;
    const dx = pos.x - this._drag.x;
    const dy = pos.y - this._drag.y;
    this._drag.x = pos.x;
    this._drag.y = pos.y;
    this._drag.moved += Math.abs(dx) + Math.abs(dy);
    if (this._drag.moved >= 7) this._setRegion(null);
    const R = this._R();
    const now = performance.now();
    const dt = Math.max(1, now - (this._drag.lt || now - 16)) / 1000;
    this._drag.lt = now;
    const dLon = (-dx / R / Math.max(0.3, Math.cos(this._view.lat * DEG))) / DEG;
    const dLat = dy / R / DEG;
    this._view.lon += dLon;
    this._view.lat = clamp(this._view.lat + dLat, -85, 85);
    this._vel = { lat: dLat / dt, lon: dLon / dt };
    this._earthDirty = true;
    this._markInput();
    this._loop();
  }

  _onUp(e, cancel) {
    const pos = this._pos(e);
    this._pointers.delete(e.pointerId);
    this._cFx.classList.remove("dragging");
    if (this._pointers.size < 2) this._pinch = null;
    if (this._drag && !cancel) {
      const quick = performance.now() - this._drag.t < 450;
      if (this._drag.moved < 7 && quick) this._tap(pos.x, pos.y);
      else if (performance.now() - (this._drag.lt || 0) > 80) this._vel = { lat: 0, lon: 0 };
    }
    this._drag = null;
    this._markInput();
    this._hqAt = performance.now() + 160;
    this._loop();
  }

  _onWheel(e) {
    e.preventDefault();
    this._setZoom(this._view.zoom * Math.exp(-e.deltaY * 0.0016));
    this._markInput();
    this._hqAt = performance.now() + 220;
  }

  _onDouble(e) {
    const pos = this._pos(e);
    const ll = this._unproject(pos.x, pos.y);
    if (ll) this._flyTo(ll.lat, ll.lon, this._view.zoom * 2);
  }

  _setZoom(z) {
    const nz = clamp(z, ZOOM_MIN, ZOOM_MAX);
    if (nz !== this._view.zoom) {
      this._view.zoom = nz;
      this._earthDirty = true;
      this._loop();
    }
  }

  _zoomBy(f) {
    this._flyTo(this._view.lat, this._view.lon, this._view.zoom * f, 450, this._region);
  }

  _flyTo(lat, lon, zoom, ms, region) {
    this._setRegion(region || null);
    const from = { ...this._view };
    const dLon = ((lon - from.lon + 540) % 360) - 180;
    const to = { lat: clamp(lat, -85, 85), lon: from.lon + dLon, zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX) };
    const dist = Math.hypot(to.lat - from.lat, dLon);
    const duration = ms || clamp(700 + dist * 12, 700, 1800);
    this._fly = { from, to, t0: performance.now(), duration, bump: Math.min(1.4, dist / 55) };
    this._vel = { lat: 0, lon: 0 };
    this._lastInput = performance.now();
    this._loop();
  }

  _tap(x, y) {
    const cl = this._clusterAt(x, y);
    if (cl) {
      // spots lying on top of each other: zoom in until they separate
      const lat = cl.members.reduce((a, m) => a + m.lat, 0) / cl.members.length;
      const lon = cl.members.reduce((a, m) => a + m.lon, 0) / cl.members.length;
      const span = Math.max(0.05, ...cl.members.map((m) => distKm(lat, lon, m.lat, m.lon))) / 111;
      this._selected = { kind: "group", v: { lat, lon, members: cl.members } };
      this._renderInfo();
      if (this._view.zoom < ZOOM_MAX * 0.6) this._flyTo(lat, lon, clamp(Math.max(this._view.zoom * 2.2, 40 / span), this._view.zoom * 1.6, ZOOM_MAX));
      return;
    }
    const hit = this._hitTest(x, y);
    if (hit) {
      this._selected = hit;
      this._renderInfo();
      if (hit.kind === "spot") this._flyTo(hit.v.lat, hit.v.lon, Math.max(this._view.zoom, 4.5));
      return;
    }
    const ll = this._unproject(x, y);
    if (ll && (this._oceanAt(ll.lat, ll.lon) || this._weatherAt(ll.lat, ll.lon))) {
      this._selected = { kind: "point", v: ll };
      this._renderInfo();
      return;
    }
    if (this._selected) {
      this._selected = null;
      this._renderInfo();
    }
  }

  /** a spot group whose badge (not its leading spot) was tapped */
  _clusterAt(x, y) {
    for (const c of this._clusters || []) {
      if (Math.hypot(c.bx - x, c.by - y) <= 14) return c;
    }
    return null;
  }

  _hitTest(x, y) {
    let best = null;
    for (const kind of ["spot", "cyclone", "storm"]) {
      for (const h of this._hits || []) {
        if (h.kind !== kind) continue;
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= h.r && (!best || d < best.d)) best = { ...h, d };
      }
      if (best) return best;
    }
    return null;
  }

  // ------------------------------------------------------------------ forecast time

  _toggleTime() {
    const on = !this._stage.classList.contains("timing");
    this._stage.classList.toggle("timing", on);
    this._timeBtn.classList.toggle("on", on);
    if (!on) {
      this._setPlaying(false);
      this._setOffset(0);
    } else {
      this._setOffset(this._offsetH);
    }
  }

  _setPlaying(on) {
    if (on && this._offsetH >= FORECAST_HOURS - 0.5) this._setOffset(0);
    this._playing = on;
    this._tPlay.innerHTML = svg(on ? ICONS.pause : ICONS.play);
    this._tPlay.title = on ? "Pause" : "Play";
    this._loop();
  }

  _setOffset(h) {
    this._offsetH = clamp(h, 0, FORECAST_HOURS);
    this._tRange.value = String(this._offsetH);
    const d = new Date(this._now());
    this._tDate.textContent = this._offsetH < 0.25 ? "Now" : `+${Math.round(this._offsetH)} h · ${d.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
    this._tSum.textContent = "Model forecast · waves, wind, clouds, rain";
    this._ensureField(true);
    if (this._selected) this._renderInfo();
  }

  /** spot values at the shown time (hourly series), falling back to now */
  _spotAt(s) {
    if (!s.now) return null;
    if (!this._offsetH || !s.hourly || !s.hourly.t) return s.now;
    const ts = this._now() / 1000;
    const t = s.hourly.t;
    let k = 0;
    while (k < t.length - 1 && t[k + 1] <= ts) k++;
    const r = s.hourly.rating[k];
    let cond = "poor";
    if (r >= 4) cond = "epic";
    else if (r >= 3) cond = "good";
    else if (r >= 1.8) cond = "fair";
    const surf = s.hourly.surf[k];
    if (surf < Math.max(0.3, s.size[0] * 0.5)) cond = "flat";
    else if (surf > s.size[2] * 1.3) cond = "too_big";
    const poses = { flat: "sitting", poor: "paddling", fair: "riding", good: "riding", epic: "barrel", too_big: "flag" };
    return { ...s.now, rating: r, surf_m: surf, condition: cond, pose: poses[cond], wind_kmh: s.hourly.wind[k], wind_dir: s.hourly.wind_dir[k] };
  }

  // ------------------------------------------------------------------ info panel

  _infoShell(title, where, body) {
    this._info.innerHTML = `<button class="x" title="Close">${svg(ICONS.close)}</button><h3>${esc(title)}</h3><div class="where">${esc(where)}</div>${body}`;
    this._info.classList.remove("hidden");
    this._info.querySelector(".x").addEventListener("click", () => {
      this._selected = null;
      this._renderInfo();
    });
  }

  /** shark background for a spot: species, safety measures and the official live service */
  _sharkHtml(sh) {
    const icon = iconUrl("shark", null);
    const svc = sh.service;
    return `<div class="sharkbox">${icon ? `<img src="${icon}" alt="">` : ""}<div><div class="t">Shark area</div>`
      + `<div>${esc(sh.species)}</div>`
      + (sh.measures ? `<div class="muted">${esc(sh.measures)}</div>` : "")
      + (svc ? `<div style="margin-top:4px">Live: <a href="${esc(svc.url)}" target="_blank" rel="noopener">${esc(svc.name)}</a><div class="muted">${esc(svc.offers)}</div></div>` : "")
      + `<div class="muted" style="margin-top:4px">Background information, not a live warning. Check the local service and the lifeguards before you paddle out.</div></div></div>`;
  }

  /** spots that share one place on the globe: pick one */
  _groupInfo(g) {
    const list = g.members
      .map((m) => this._spots.find((s) => s.id === m.id) || m)
      .map((s) => ({ s, now: this._spotAt(s) }))
      .sort((a, b) => (b.now?.rating ?? -1) - (a.now?.rating ?? -1));
    const rows = list.map(({ s, now }) => {
      const color = now ? CONDITION_COLORS[now.condition] || "#9ab" : "#6d7f8c";
      return `<button data-id="${esc(s.id)}"><span class="dot" style="background:${color}"></span><span class="n">${esc(s.name)}</span><span class="s">${now ? starsHtml(now.rating) : ""}</span><span class="m">${now ? this._len(now.surf_m) : ""}</span></button>`;
    });
    const area = list[0]?.s.area || "";
    this._infoShell(`${list.length} spots`, area, `<div class="group">${rows.join("")}</div>`);
    for (const btn of this._info.querySelectorAll(".group button")) {
      btn.addEventListener("click", () => {
        const s = this._spots.find((x) => x.id === btn.dataset.id);
        if (!s) return;
        this._selected = { kind: "spot", v: s };
        this._renderInfo();
      });
    }
  }

  _renderInfo() {
    const sel = this._selected;
    this._stage.classList.toggle("info-open", !!sel);
    if (!sel) {
      this._info.classList.add("hidden");
      this._info.innerHTML = "";
      return;
    }
    if (sel.kind === "spot") this._spotInfo(this._spots.find((s) => s.id === sel.v.id) || sel.v);
    else if (sel.kind === "cyclone") this._cycloneInfo(this._cyclones.find((c) => c.id === sel.v.id) || sel.v);
    else if (sel.kind === "storm") this._stormInfo(sel.v);
    else if (sel.kind === "group") this._groupInfo(sel.v);
    else this._pointInfo(sel.v);
  }

  _compassSvg(spot, now) {
    const c = 34, r = 26;
    const pt = (deg, rr) => [c + Math.sin(deg * DEG) * rr, c - Math.cos(deg * DEG) * rr];
    const a0 = spot.swell_from - spot.window, a1 = spot.swell_from + spot.window;
    const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
    const large = spot.window * 2 > 180 ? 1 : 0;
    const wedge = `<path d="M${c},${c} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="rgba(63,212,124,.25)" stroke="rgba(63,212,124,.6)" stroke-width="1"/>`;
    const arrow = (deg, color, len, w) => {
      if (deg == null) return "";
      const [sx, sy] = pt(deg, r + 2);
      const [ex, ey] = pt(deg, r - len);
      const ang = Math.atan2(ey - sy, ex - sx);
      const hx = ex + Math.cos(ang) * 5, hy = ey + Math.sin(ang) * 5;
      const l1 = [hx - Math.cos(ang - 0.5) * 7, hy - Math.sin(ang - 0.5) * 7];
      const l2 = [hx - Math.cos(ang + 0.5) * 7, hy - Math.sin(ang + 0.5) * 7];
      return `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/><path d="M${hx.toFixed(1)},${hy.toFixed(1)} L${l1[0].toFixed(1)},${l1[1].toFixed(1)} L${l2[0].toFixed(1)},${l2[1].toFixed(1)} Z" fill="${color}"/>`;
    };
    const windColor = now.wind_kind === "offshore" || now.wind_kind === "glassy" ? "#3fd47c" : now.wind_kind === "onshore" ? "#ff7a5c" : "#ffcf3a";
    return `<svg width="68" height="68" viewBox="0 0 68 68" aria-label="Swell window">
      <circle cx="${c}" cy="${c}" r="${r}" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.25)"/>
      ${wedge}
      <text x="${c}" y="9" font-size="8" fill="#cfe" text-anchor="middle">N</text>
      ${arrow(now.swell2_dir, "rgba(130,190,255,.7)", 12, 1.5)}
      ${arrow(now.swell_dir, "#4fd3e8", 16, 2.4)}
      ${arrow(now.wind_dir, windColor, 10, 1.6)}
    </svg>`;
  }

  _chartSvg(s) {
    const hr = s.hourly;
    if (!hr || !hr.t || !hr.t.length) return "";
    const n = hr.t.length;
    const W = 288, H = 64, pad = 2;
    const bw = (W - pad * 2) / n;
    const bars = hr.rating
      .map((r, i) => {
        const h = Math.max(1.5, ((r || 0) / 5) * (H - 18));
        return `<rect x="${(pad + i * bw).toFixed(1)}" y="${(H - 12 - h).toFixed(1)}" width="${Math.max(1, bw - 0.6).toFixed(1)}" height="${h.toFixed(1)}" fill="${ratingColor(r)}" opacity="0.85"/>`;
      })
      .join("");
    let tide = "";
    const lv = hr.sea_level || [];
    const vals = lv.filter((v) => v != null);
    if (vals.length > 4) {
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const span = Math.max(0.05, hi - lo);
      const pts = lv
        .map((v, i) => (v == null ? null : `${(pad + i * bw + bw / 2).toFixed(1)},${(4 + (1 - (v - lo) / span) * (H - 22)).toFixed(1)}`))
        .filter(Boolean)
        .join(" ");
      tide = `<polyline points="${pts}" fill="none" stroke="rgba(160,210,255,.8)" stroke-width="1.3" stroke-dasharray="3 2"/>`;
    }
    // shown time and midnights
    const ts = this._now() / 1000;
    const k = clamp((ts - hr.t[0]) / 3600, 0, n - 1);
    const marks = [];
    const off = (s.utc_offset || 0) * 1000;
    for (let i = 0; i < n; i++) {
      const d = new Date(hr.t[i] * 1000 + off);
      if (d.getUTCHours() === 0) {
        marks.push(`<line x1="${(pad + i * bw).toFixed(1)}" y1="0" x2="${(pad + i * bw).toFixed(1)}" y2="${H - 10}" stroke="rgba(255,255,255,.18)"/>`);
        marks.push(`<text x="${(pad + i * bw + 2).toFixed(1)}" y="${H - 2}" font-size="8" fill="rgba(220,235,245,.7)">${d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</text>`);
      }
    }
    const cur = `<line x1="${(pad + k * bw).toFixed(1)}" y1="0" x2="${(pad + k * bw).toFixed(1)}" y2="${H - 10}" stroke="#fff" stroke-width="1.2"/>`;
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${marks.join("")}${bars}${tide}${cur}</svg>
      <div class="muted">Rating for the next 48 h${tide ? " · dashed: tide (model sea level)" : ""}</div></div>`;
  }

  _spotInfo(s) {
    const now = this._spotAt(s);
    const where = [s.area, s.country].filter(Boolean).join(", ");
    if (!now) {
      this._infoShell(s.name, where, `<div class="muted">No forecast for this spot yet.</div>`);
      return;
    }
    const color = CONDITION_COLORS[now.condition] || "#9ab";
    const parts = [];
    parts.push(`<div class="badges"><span class="badge" style="background:${color}">${esc((CONDITION_LABELS[now.condition] || now.condition).toUpperCase())}</span>${starsHtml(now.rating)}<span class="badge soft">${now.rating.toFixed(1)} / 5</span><span class="badge soft">${esc(BREAKS[s.kind] || s.kind)}</span></div>`);
    parts.push(`<div class="head">${this._compassSvg(s, now)}<div><div class="big">${this._len(now.surf_m)}<small> surf</small></div><div class="muted">${this._offsetH ? `forecast +${Math.round(this._offsetH)} h` : "breaking wave height, model estimate"}</div><div class="muted">ideal ${this._lenRange(s.size[0], s.size[2])}</div></div></div>`);
    if (now.swell_m != null) {
      parts.push(`<div class="line"><span class="ic">🌀</span><span class="tx">Swell ${this._len(now.swell_m)} · ${now.swell_period != null ? `${Math.round(now.swell_period)} s` : "–"} from ${compass(now.swell_dir)} (${Math.round(now.swell_dir ?? 0)}°)${now.swell2_m ? `<div class="muted">2nd swell ${this._len(now.swell2_m)} · ${now.swell2_period != null ? `${Math.round(now.swell2_period)} s` : "–"} from ${compass(now.swell2_dir)}</div>` : ""}<div class="muted">Swell window ${compass(s.swell_from - s.window)}–${compass(s.swell_from + s.window)} (green)</div></span></div>`);
    }
    if (now.wind_kmh != null) {
      parts.push(`<div class="line"><span class="ic">💨</span><span class="tx">Wind ${this._speed(now.wind_kmh)} from ${compass(now.wind_dir)} · <b>${esc(WIND_KINDS[now.wind_kind] || "")}</b>${now.gust_kmh ? `<div class="muted">gusts ${this._speed(now.gust_kmh)} · Beaufort ${now.beaufort ?? beaufort(now.wind_kmh)}</div>` : ""}</span></div>`);
    }
    if (now.water_c != null) parts.push(`<div class="line"><span class="ic">🌡</span><span class="tx">Water ${this._temp(now.water_c)}<div class="muted">${esc(now.wetsuit || "")}</div></span></div>`);
    if (now.sea_state) parts.push(`<div class="line"><span class="ic">🌊</span><span class="tx">Sea state ${esc(SEA_STATE_NAMES[now.sea_state] || now.sea_state)} (Douglas ${now.douglas}) · waves ${this._len(now.wave_height_m)}</span></div>`);
    const tides = s.tides || [];
    if (tides.length) {
      const fmt = (t) => new Date(t.time * 1000 + (s.utc_offset || 0) * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
      parts.push(`<div class="line"><span class="ic">↕</span><span class="tx">${tides.slice(0, 3).map((t) => `${t.kind === "high" ? "High" : "Low"} ${fmt(t)}`).join(" · ")}<div class="muted">tide from the ocean model, local time; harbour tables can differ</div></span></div>`);
    }
    if (s.next_good && (!now || now.rating < 3)) {
      const d = new Date(new Date(s.next_good).getTime() + (s.utc_offset || 0) * 1000);
      parts.push(`<div class="line"><span class="ic">⏭</span><span class="tx">Next good session ${d.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} local</span></div>`);
    }
    if (s.sharks && this._config.sharks !== false) parts.push(this._sharkHtml(s.sharks));
    const cams = this._camsOn();
    if (cams) parts.push(`<div class="cams" data-spot="${esc(s.id)}">${this._camsHtml(s.id)}</div>`);
    parts.push(this._chartSvg(s));
    if (s.days && s.days.length) {
      const rows = s.days.map((d) => {
        const dt = new Date(`${d.date}T12:00:00Z`);
        const label = dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
        return `<span class="d">${esc(label)}</span><span class="s">${starsHtml(d.rating)}</span><span>${this._lenRange(d.surf_min, d.surf_max)}</span><span class="w">${esc(d.best_from)}–${esc(d.best_to)}</span>`;
      });
      parts.push(`<div class="days">${rows.join("")}</div><div class="muted" style="margin-top:3px">best window per day, local time</div>`);
    }
    const home = this._data?.home;
    if (home) parts.push(`<div class="muted" style="margin-top:6px">${this._dist(distKm(home[0], home[1], s.lat, s.lon))} from home</div>`);
    const links = [
      `<a href="https://www.windy.com/?waves,${s.lat.toFixed(3)},${s.lon.toFixed(3)},10" target="_blank" rel="noopener">Windy waves</a>`,
      `<a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}" target="_blank" rel="noopener">Map</a>`,
    ];
    parts.push(`<div class="links">${links.join("")}</div>`);
    this._infoShell(s.name, where, parts.join(""));
    if (cams) this._loadCams(s.id);
  }

  // ------------------------------------------------------------------ webcams (Windy, optional)

  _camsOn() {
    return this._config.webcams !== false && !!this._data?.webcams;
  }

  /** cached list of a spot, null while it still has to be fetched */
  _camsHtml(id) {
    const hit = this._cams?.[id];
    if (!hit) return `<div class="ct">Webcams nearby</div><div class="muted">loading...</div>`;
    if (hit.error) return hit.error === "disabled" ? "" : `<div class="ct">Webcams nearby</div><div class="muted">Webcams not available right now.</div>`;
    if (!hit.list.length) return `<div class="ct">Webcams nearby</div><div class="muted">No webcam within 15 km.</div>${CAM_COURTESY}`;
    const spot = this._spots.find((x) => x.id === id);
    // at night the live image is black: show the last daylight image of the cam instead
    const night = spot ? sunElevation(spot.lat, spot.lon, Date.now()) < -4 : false;
    const cards = hit.list.map((c) => {
      const useDay = night && c.daylight;
      const age = useDay ? "last daylight" : c.updated ? ageText(Date.parse(c.updated)) : "";
      const dist = c.distance_km == null ? "" : c.distance_km < 1 ? `< ${this._dist(1)}` : this._dist(c.distance_km);
      const meta = [dist, age].filter(Boolean).join(" · ");
      return `<a class="cam" href="${esc(c.link)}" target="_blank" rel="noopener" title="${esc(c.title)}"><img src="${esc(useDay ? c.daylight : c.image)}" alt="${esc(c.title)}" loading="lazy"><div class="cn">${esc(c.title)}<div class="muted">${esc(meta)}</div></div></a>`;
    });
    return `<div class="ct">Webcams nearby</div><div class="cl">${cards.join("")}</div>${CAM_COURTESY}`;
  }

  async _loadCams(id) {
    this._cams = this._cams || {};
    const hit = this._cams[id];
    // image links of the free Windy tier expire after 10 minutes, the backend caches 8
    if (hit && Date.now() - hit.t < (hit.error ? 60000 : 5 * 60000)) return;
    if (this._camsBusy?.[id]) return;
    this._camsBusy = { ...(this._camsBusy || {}), [id]: true };
    try {
      const resp = await this._hass.fetchWithAuth(`/api/sea_state/webcams/${encodeURIComponent(id)}`);
      const body = await resp.json().catch(() => ({}));
      this._cams[id] = resp.ok ? { t: Date.now(), list: body.webcams || [] } : { t: Date.now(), error: body.error || `HTTP ${resp.status}` };
    } catch (err) {
      this._cams[id] = { t: Date.now(), error: "unreachable" };
    } finally {
      delete this._camsBusy[id];
    }
    const box = this._info.querySelector(`.cams[data-spot="${CSS.escape(id)}"]`);
    if (box) box.innerHTML = this._camsHtml(id);
  }

  _pointInfo(ll) {
    const o = this._oceanAt(ll.lat, ll.lon);
    const w = this._weatherAt(ll.lat, ll.lon);
    const parts = [];
    if (o && o.sea > 0.4) {
      const [code, label] = douglas(o.h);
      const col = waveColor(o.h);
      parts.push(`<div class="badges"><span class="badge" style="background:rgb(${col[0]},${col[1]},${col[2]})">${esc(label.toUpperCase())}</span><span class="badge soft">Douglas ${code}</span></div>`);
      parts.push(`<div class="head"><div><div class="big">${this._len(o.h)}<small> waves</small></div><div class="muted">significant wave height${this._offsetH ? ` · +${Math.round(this._offsetH)} h` : ""}</div></div></div>`);
      parts.push(`<div class="line"><span class="ic">🌀</span><span class="tx">${o.p ? `Period ${o.p.toFixed(0)} s · ` : ""}from ${compass(o.dir)}${o.dir != null ? ` (${Math.round(o.dir)}°)` : ""}${o.w ? `<div class="muted">wind sea ${this._len(o.w)}</div>` : ""}</span></div>`);
    }
    if (w) {
      const bft = beaufort(w.ws);
      parts.push(`<div class="line"><span class="ic">💨</span><span class="tx">Wind ${this._speed(w.ws)} from ${compass(w.wd)}<div class="muted">Beaufort ${bft} · ${BEAUFORT_NAMES[bft]}</div></span></div>`);
      parts.push(`<div class="line"><span class="ic">☁</span><span class="tx">Clouds ${Math.round(w.cc)} %${w.pr >= 0.1 ? ` · rain ${w.pr.toFixed(1)} mm/h` : ""}</span></div>`);
      if (Number.isFinite(w.ps)) parts.push(`<div class="line"><span class="ic">◎</span><span class="tx">Pressure ${Math.round(w.ps)} hPa</span></div>`);
    }
    parts.push(`<div class="muted" style="margin-top:6px">Global model grid (Open-Meteo), interpolated; coastal values are rough.</div>`);
    parts.push(`<div class="links"><a href="https://www.windy.com/?waves,${ll.lat.toFixed(2)},${ll.lon.toFixed(2)},6" target="_blank" rel="noopener">Windy waves</a></div>`);
    const title = o && o.sea > 0.4 ? "Open sea" : "Weather";
    this._infoShell(title, `${Math.abs(ll.lat).toFixed(1)}°${ll.lat >= 0 ? "N" : "S"} ${Math.abs(ll.lon).toFixed(1)}°${ll.lon >= 0 ? "E" : "W"}`, parts.join(""));
  }

  _cycloneInfo(c) {
    const col = CATEGORY_COLORS[Math.max(0, Math.min(5, c.category || 0))];
    const parts = [];
    parts.push(`<div class="badges"><span class="badge" style="background:${col}">${esc((CATEGORY_NAMES[c.category_key] || "").toUpperCase())}</span>${c.alert ? `<span class="badge soft">GDACS ${esc(c.alert)}</span>` : ""}</div>`);
    parts.push(`<div class="head"><div><div class="big">${this._speed(c.wind_kmh)}<small> max wind</small></div><div class="muted">${esc(c.severity_text || "")}</div></div></div>`);
    if (c.now_km != null) parts.push(`<div class="line"><span class="ic">📍</span><span class="tx">${this._dist(c.now_km)} from home${c.closest_km != null && c.closest_km < c.now_km ? `<div class="muted">closest forecast approach ${this._dist(c.closest_km)}${c.closest_time ? ` · ${new Date(c.closest_time).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</div>` : ""}</span></div>`);
    const fc = (c.track || []).filter((p) => p.forecast);
    if (fc.length) {
      const last = fc[fc.length - 1];
      parts.push(`<div class="line"><span class="ic">➜</span><span class="tx">Forecast track ${fc.length} positions, until ${new Date(last.time).toLocaleString("en-GB", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}<div class="muted">dashed line; dots coloured by strength</div></span></div>`);
    }
    if (c.country) parts.push(`<div class="line"><span class="ic">🗺</span><span class="tx">${esc(c.country)}</span></div>`);
    parts.push(`<div class="muted" style="margin-top:6px">Source ${esc(c.source || "GDACS")} via GDACS${c.updated ? `, updated ${esc(rel(new Date(c.updated).getTime()))}` : ""}. Follow your national weather service for warnings.</div>`);
    parts.push(`<div class="links"><a href="${esc(c.report_url)}" target="_blank" rel="noopener">GDACS report</a></div>`);
    this._infoShell(`${c.kind || "Cyclone"} ${c.name}`, c.title || "", parts.join(""));
  }

  _stormInfo(s) {
    const bft = beaufort(s.max_wind_kmh);
    const parts = [];
    parts.push(`<div class="badges"><span class="badge" style="background:#c7d3dc">BEAUFORT ${bft}</span><span class="badge soft">${esc(BEAUFORT_NAMES[bft])}</span></div>`);
    parts.push(`<div class="line"><span class="ic">💨</span><span class="tx">Up to ${this._speed(s.max_wind_kmh)} wind</span></div>`);
    if (s.min_pressure_hpa) parts.push(`<div class="line"><span class="ic">◎</span><span class="tx">Lowest pressure ${s.min_pressure_hpa} hPa</span></div>`);
    if (s.max_rain_mm) parts.push(`<div class="line"><span class="ic">🌧</span><span class="tx">Rain up to ${s.max_rain_mm} mm/h</span></div>`);
    const o = this._oceanAt(s.lat, s.lon);
    if (o) parts.push(`<div class="line"><span class="ic">🌊</span><span class="tx">Waves ${this._len(o.h)} · ${douglas(o.h)[1]}</span></div>`);
    parts.push(`<div class="muted" style="margin-top:6px">Area with gale force winds in the global weather model.</div>`);
    this._infoShell("Gale at sea", `${Math.abs(s.lat).toFixed(0)}°${s.lat >= 0 ? "N" : "S"} ${Math.abs(s.lon).toFixed(0)}°${s.lon >= 0 ? "E" : "W"}`, parts.join(""));
  }

  // ------------------------------------------------------------------ animation

  _loop() {
    if (this._raf || !this._w) return;
    if (this._visible === false || document.hidden) return;
    this._last = performance.now();
    const tick = (ts) => {
      this._raf = null;
      if (this._visible === false || document.hidden || !this.isConnected) return;
      this._frameStep(ts);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _frameStep(ts) {
    const dt = Math.min(0.06, Math.max(0, (ts - this._last) / 1000));
    if (ts - (this._lastDraw || 0) < 31) return;
    this._lastDraw = ts;
    this._last = ts;
    this._t += dt;
    const v = this._view;
    let moving = false;

    if (this._fly) {
      const f = this._fly;
      const u = clamp((ts - f.t0) / f.duration, 0, 1);
      const e = ease(u);
      v.lat = f.from.lat + (f.to.lat - f.from.lat) * e;
      v.lon = f.from.lon + (f.to.lon - f.from.lon) * e;
      const lz = Math.log(f.from.zoom) + (Math.log(f.to.zoom) - Math.log(f.from.zoom)) * e;
      v.zoom = clamp(Math.exp(lz) / (1 + f.bump * Math.sin(Math.PI * e)), ZOOM_MIN, ZOOM_MAX);
      moving = true;
      if (u >= 1) {
        this._fly = null;
        this._hqAt = ts + 120;
      }
    } else if (!this._drag && !this._pinch && (Math.abs(this._vel.lat) > 0.05 || Math.abs(this._vel.lon) > 0.05)) {
      v.lat = clamp(v.lat + this._vel.lat * dt, -85, 85);
      v.lon += this._vel.lon * dt;
      const k = Math.exp(-dt * 3.2);
      this._vel.lat *= k;
      this._vel.lon *= k;
      moving = true;
      if (Math.abs(this._vel.lat) <= 0.05 && Math.abs(this._vel.lon) <= 0.05) this._hqAt = ts + 120;
    } else if (this._rotate && !this._drag && !this._selected && ts - this._lastInput > 6000) {
      v.lon += (4 / Math.max(1, v.zoom)) * dt;
      moving = true;
    }
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon) || !Number.isFinite(v.zoom)) {
      const [lat, lon, zoom] = this._startView();
      Object.assign(v, { lat, lon, zoom });
      this._vel = { lat: 0, lon: 0 };
    }
    if (v.lon > 180) v.lon -= 360;
    if (v.lon < -180) v.lon += 360;

    if (this._playing) {
      const nh = this._offsetH + dt * PLAY_HOURS_PER_SECOND;
      if (nh >= FORECAST_HOURS) {
        this._setOffset(FORECAST_HOURS);
        this._setPlaying(false);
      } else {
        this._offsetH = nh;
        this._tRange.value = String(nh);
        if (Math.abs(nh - (this._lastPlayField || 0)) >= 0.5) {
          this._lastPlayField = nh;
          this._setOffset(nh);
        }
      }
    }
    this._ensureField(false);

    const interacting = moving || !!this._drag || !!this._pinch;
    if (interacting) this._earthDirty = true;
    const now = Date.now();
    if (this._allDay()) {
      // daylight everywhere: the light follows the view, from the upper left
      const G = this._frame();
      const l = [0, 1, 2].map((k) => G.view[k] + 0.4 * G.north[k] - 0.3 * G.east[k]);
      const n = Math.hypot(l[0], l[1], l[2]);
      const sun = l.map((v) => v / n);
      if (!this._sun || Math.abs(sun[0] - this._sun[0]) + Math.abs(sun[1] - this._sun[1]) + Math.abs(sun[2] - this._sun[2]) > 1e-6) {
        this._sun = sun;
        this._earthDirty = true;
      }
      this._fxSun = G.view;
    } else if (now - this._lastSun > SUN_REFRESH_MS || this._sunFor !== Math.round(this._offsetH * 4) || this._fxSun) {
      this._fxSun = null;
      this._sun = sunDirection(this._now());
      this._sunFor = Math.round(this._offsetH * 4);
      this._lastSun = now;
      this._earthDirty = true;
    }
    if (this._earthDirty) {
      this._renderEarth(interacting ? 0.5 : 1);
      this._earthDirty = false;
      this._earthLow = interacting;
      if (interacting) this._hqAt = Math.max(this._hqAt, ts + 180);
    } else if (this._earthLow && ts >= this._hqAt && !interacting) {
      this._renderEarth(1);
      this._earthLow = false;
    }
    this._drawFx(dt);
  }

  _waveAmount() {
    if (this._config.waves === false) return 0;
    return this._mode === "surf" ? 0.55 : 0.72;
  }

  _renderEarth(quality) {
    if (!this._w) return;
    let scale = this._dpr * quality;
    const px = this._w * this._h * scale * scale;
    if (px > MAX_EARTH_PIXELS) scale *= Math.sqrt(MAX_EARTH_PIXELS / px);
    const W = Math.max(1, Math.round(this._w * scale));
    const H = Math.max(1, Math.round(this._h * scale));
    const R = this._R() * (W / this._w);
    const f = this._field?.ocean;
    const amount = this._waveAmount();
    const fine = f && f.fine;
    const waves = f && amount > 0
      ? (fine
        ? { field: fine.data, mask: f.fineMask.data, nlat: fine.nlat, nlon: fine.nlon, lat0: f.lat0, lon0: f.lon0, step: fine.step, amount }
        : { field: f.h, mask: f.mask, nlat: f.nlat, nlon: f.nlon, lat0: f.lat0, lon0: f.lon0, step: f.step, amount })
      : null;
    renderEarth(this._cEarth, this._earth, this._frame(), this._sun || sunDirection(this._now()), W, H, R, waves, this._allDay());
  }

  // ------------------------------------------------------------------ fx layers

  _drawFx(dt) {
    const ctx = this._cFx.getContext("2d");
    const dpr = this._dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._cFx.width, this._cFx.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = this._w, H = this._h;
    const G = this._frame();
    const R = this._R();
    // markers and clouds: no night dimming in daylight mode
    const sun = this._fxSun || this._sun || sunDirection(this._now());
    const zoom = this._view.zoom;
    const t = this._t;
    const hits = [];
    this._icons = [];
    const zf = clamp(Math.pow(zoom, 0.5), 0.85, 3.4);
    const low = this._quality() === "low";

    // atmosphere
    const cx = W / 2, cy = H / 2;
    if (R < Math.hypot(W, H)) {
      const g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
      g.addColorStop(0, "rgba(120,190,255,0.38)");
      g.addColorStop(0.35, "rgba(80,150,255,0.14)");
      g.addColorStop(1, "rgba(60,120,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
      ctx.arc(cx, cy, R * 0.98, 0, Math.PI * 2, true);
      ctx.fill("evenodd");
    }

    if (this._config.crests !== false && this._field?.ocean) this._drawCrests(ctx, dt, G, R, zoom, zf, low, sun);
    const weatherOn = this._showWeather() || this._mode === "surf";
    if (this._config.clouds !== false && this._field?.weather && weatherOn) this._drawClouds(ctx, dt, G, R, zoom, zf, low, sun);
    if (this._showWeather()) this._drawStorms(ctx, G, R, zoom, t, hits);
    if (this._config.cyclones !== false) this._drawCyclones(ctx, G, R, zoom, t, sun, hits);
    this._drawSpots(ctx, G, R, zoom, zf, t, sun, hits);
    this._drawHome(ctx, G, R);
    this._hits = hits;
    this._syncIcons();
  }

  /** place the animated SVG markers; each keeps its <img> while visible so animations run on */
  _syncIcons() {
    const list = this._iconsReady ? this._icons : [];
    const map = this._iconMap;
    const seen = new Set();
    for (const it of list) {
      const url = iconUrl(it.kind, it.ring);
      if (!url) continue;
      let img = map.get(it.id);
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        img.draggable = false;
        this._markers.appendChild(img);
        map.set(it.id, img);
      }
      seen.add(it.id);
      if (img._src !== url) {
        img.src = url;
        img._src = url;
      }
      const sz = Math.round(it.size);
      if (img._sz !== sz) {
        img.style.width = `${sz}px`;
        img.style.height = `${sz}px`;
        img._sz = sz;
      }
      img.style.transform = `translate(${(it.x - sz / 2).toFixed(1)}px, ${(it.y - sz / 2).toFixed(1)}px)`;
      const op = it.alpha.toFixed(2);
      if (img._op !== op) {
        img.style.opacity = op;
        img._op = op;
      }
      img.classList.toggle("sel", !!it.sel);
      if (it.badge) {
        const bid = `${it.id}#badge`;
        let b = map.get(bid);
        if (!b) {
          b = document.createElement("div");
          b.className = "cbadge";
          this._markers.appendChild(b);
          map.set(bid, b);
        }
        seen.add(bid);
        if (b.textContent !== it.badge) b.textContent = it.badge;
        b.style.transform = `translate(${(it.x + sz * 0.22).toFixed(1)}px, ${(it.y - sz * 0.5 - 2).toFixed(1)}px)`;
        b.style.opacity = op;
      }
    }
    for (const [id, img] of map) {
      if (!seen.has(id)) {
        img.remove();
        map.delete(id);
      }
    }
  }

  /** wave crests rolling with the swell: short white arcs moving in the wave direction */
  _drawCrests(ctx, dt, G, R, zoom, zf, low, sun) {
    const W = this._w, H = this._h;
    // fewer crests when zoomed in, otherwise the sea turns into scratches
    const zoomThin = 1 / Math.max(1, Math.sqrt(zoom / 2.5));
    const target = Math.round(clamp((W * H) / (low ? 1400 : 820), low ? 160 : 260, low ? 420 : 900) * (this._mode === "surf" ? 1.0 : 0.85) * zoomThin);
    const list = this._crests;
    while (list.length < target) list.push({ dead: true });
    if (list.length > target) list.length = target;
    const speedPx = clamp(Math.pow(zoom, 0.35), 0.9, 2.4);
    ctx.lineCap = "round";
    for (const c of list) {
      if (c.dead || c.age > c.life) {
        const ll = this._randomVisible(R);
        c.dead = true;
        if (!ll || !this._isSea(ll.lat, ll.lon)) continue;
        const o = this._oceanAt(ll.lat, ll.lon);
        if (!o || o.dir == null) continue;
        // denser where the sea is high
        if (Math.random() > 0.3 + 0.7 * Math.min(1, o.h / 4)) continue;
        Object.assign(c, { lat: ll.lat, lon: ll.lon, age: 0, life: 2.2 + Math.random() * 2.6, dead: false, ph: Math.random() * 6 });
      }
      const o = this._oceanAt(c.lat, c.lon);
      if (!o || o.dir == null || o.sea < 0.3) {
        c.dead = true;
        continue;
      }
      const toward = (o.dir + 180) % 360;
      const period = o.p || 8;
      const pxs = (6 + 1.6 * period) * speedPx;
      const degs = pxs / (R * DEG);
      const b = toward * DEG;
      c.lat += Math.cos(b) * degs * dt;
      c.lon += (Math.sin(b) * degs * dt) / Math.max(0.15, Math.cos(c.lat * DEG));
      if (c.lon > 180) c.lon -= 360;
      if (c.lon < -180) c.lon += 360;
      c.age += dt;
      const pr = this._projLL(c.lat, c.lon, G, R);
      if (pr.z <= 0.05 || pr.x < -20 || pr.x > W + 20 || pr.y < -20 || pr.y > H + 20) {
        c.dead = true;
        continue;
      }
      const sd = this._screenDir(c.lat, c.lon, G, toward);
      if (!sd) continue;
      const [dx, dy, fore] = sd;
      const life = Math.sin(Math.PI * clamp(c.age / c.life, 0, 1));
      const hgt = o.h;
      const a = life * clamp(0.22 + hgt / 4, 0.22, 0.95) * smooth(0.05, 0.3, pr.z);
      const night = smooth(0.1, -0.15, (Math.cos(c.lat * DEG) * Math.cos(c.lon * DEG)) * sun[0] + (Math.cos(c.lat * DEG) * Math.sin(c.lon * DEG)) * sun[1] + Math.sin(c.lat * DEG) * sun[2]);
      const L = (4.2 + 2.6 * Math.sqrt(hgt)) * Math.min(zf, 2.2) * (0.55 + 0.45 * fore) * (0.75 + 0.5 * ((c.ph * 7) % 1));
      const px = -dy, py = dx;
      const bend = L * 0.22;
      // a tapered crescent reads as a breaking crest; a dark one just behind gives it body
      const thick = clamp(0.9 + hgt * 0.38, 0.9, 3.4);
      const crescent = (ox, oy, th) => {
        ctx.beginPath();
        ctx.moveTo(pr.x - px * L + ox, pr.y - py * L + oy);
        ctx.quadraticCurveTo(pr.x + dx * (bend + th) + ox, pr.y + dy * (bend + th) + oy, pr.x + px * L + ox, pr.y + py * L + oy);
        ctx.quadraticCurveTo(pr.x + dx * (bend - th) + ox, pr.y + dy * (bend - th) + oy, pr.x - px * L + ox, pr.y - py * L + oy);
        ctx.fill();
      };
      ctx.fillStyle = `rgba(2,18,40,${(a * 0.5).toFixed(3)})`;
      crescent(-dx * thick * 1.6, -dy * thick * 1.6, thick * 1.2);
      ctx.fillStyle = `rgba(${night > 0.5 ? "170,205,230" : "242,251,255"},${a.toFixed(3)})`;
      crescent(0, 0, thick);
      // rough sea: white caps
      const churn = Math.max(0, hgt - 3) / 4 + Math.max(0, (o.w || 0) - 1.5) / 3;
      if (churn > 0.05 && !low) {
        const k = 0.5 + 0.5 * Math.sin(t2(this._t, c.ph));
        ctx.fillStyle = `rgba(255,255,255,${(a * Math.min(1, churn) * k).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(pr.x - dx * L * 0.5, pr.y - dy * L * 0.5, clamp(0.8 + churn, 0.8, 2.2), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** drifting clouds, rain streaks and lightning from the weather grid */
  _drawClouds(ctx, dt, G, R, zoom, zf, low, sun) {
    const W = this._w, H = this._h;
    const surfOnly = this._mode === "surf";
    const target = Math.round(clamp((W * H) / (low ? 7000 : 3800), low ? 40 : 70, low ? 90 : 180) * (surfOnly ? 0.5 : 1));
    const list = this._clouds;
    while (list.length < target) list.push({ dead: true });
    if (list.length > target) list.length = target;
    const rainOn = this._config.rain !== false && !surfOnly;
    const speedPx = clamp(Math.pow(zoom, 0.3), 0.9, 2.0);
    // clouds fade a little when zoomed in close, so the sea and the spots stay readable
    const modeAlpha = (surfOnly ? 0.4 : 1) * (zoom > 3 ? clamp(1.24 - zoom * 0.08, 0.45, 1) : 1);
    const czf = clamp(Math.pow(zoom, 0.35), 0.85, 1.8);
    for (const c of list) {
      if (c.dead || c.age > c.life) {
        c.dead = true;
        const ll = this._randomVisible(R);
        if (!ll) continue;
        const w = this._weatherAt(ll.lat, ll.lon);
        if (!w || !(w.cc > 35)) continue;
        if (Math.random() > Math.pow(clamp((w.cc - 35) / 65, 0, 1), 1.3)) continue;
        const storm = w.ws >= 55 || w.pr >= 3;
        Object.assign(c, {
          lat: ll.lat, lon: ll.lon, age: 0, life: 6 + Math.random() * 8, dead: false,
          size: (0.8 + Math.random() * 0.6) * (storm ? 1.5 : 1),
          seed: Math.random(), flash: 0,
        });
      }
      const w = this._weatherAt(c.lat, c.lon);
      if (!w) {
        c.dead = true;
        continue;
      }
      const toward = ((w.wd ?? 270) + 180) % 360;
      const pxs = (1.5 + w.ws * 0.12) * speedPx;
      const degs = pxs / (R * DEG);
      const b = toward * DEG;
      c.lat = clamp(c.lat + Math.cos(b) * degs * dt, -85, 85);
      c.lon += (Math.sin(b) * degs * dt) / Math.max(0.15, Math.cos(c.lat * DEG));
      if (c.lon > 180) c.lon -= 360;
      if (c.lon < -180) c.lon += 360;
      c.age += dt;
      const pr = this._projLL(c.lat, c.lon, G, R);
      if (pr.z <= 0.04) {
        c.dead = true;
        continue;
      }
      const size = (44 + w.cc * 0.5) * czf * c.size;
      if (pr.x < -size || pr.x > W + size || pr.y < -size || pr.y > H + size) {
        c.dead = true;
        continue;
      }
      const lifeA = Math.sin(Math.PI * clamp(c.age / c.life, 0, 1));
      const ex = Math.cos(c.lat * DEG) * Math.cos(c.lon * DEG), ey = Math.cos(c.lat * DEG) * Math.sin(c.lon * DEG), ez = Math.sin(c.lat * DEG);
      const lit = smooth(-0.15, 0.15, ex * sun[0] + ey * sun[1] + ez * sun[2]);
      const kind = w.ws >= 55 || w.pr >= 3 ? "storm" : w.pr >= 0.4 ? "rain" : "fair";
      const a = lifeA * clamp(w.cc / 100, 0, 1) * (0.3 + 0.6 * lit) * smooth(0.04, 0.25, pr.z) * modeAlpha;
      if (a < 0.02) continue;
      const sprite = cloudSprite(kind);
      // clouds stretch along the wind
      const sd = this._screenDir(c.lat, c.lon, G, toward);
      const ang = sd ? Math.atan2(sd[1], sd[0]) : 0;
      const squash = sd ? clamp(sd[2], 0.35, 1) : 1;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(pr.x, pr.y);
      ctx.rotate(ang);
      ctx.drawImage(sprite, -size * 0.65 * squash, -size * 0.4, size * 1.3 * squash, size * 0.8);
      ctx.restore();
      if (rainOn && w.pr >= 0.3) {
        const n = Math.min(9, 2 + Math.round(w.pr * 1.5));
        ctx.strokeStyle = `rgba(150,185,225,${(a * 0.9).toFixed(3)})`;
        ctx.lineWidth = 1;
        const fall = size * 0.55;
        for (let i = 0; i < n; i++) {
          const off = ((this._t * 40 + i * 37 + c.seed * 100) % fall);
          const x = pr.x - size * 0.3 + (i / Math.max(1, n - 1)) * size * 0.6 + Math.sin(i * 7.1) * 3;
          const y = pr.y + size * 0.1 + off;
          ctx.globalAlpha = 1 - off / fall;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 2, y + 5);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (rainOn && kind === "storm" && w.pr >= 1.5 && !low) {
        if (c.flash > 0) {
          c.flash -= dt;
          const fa = Math.min(1, c.flash * 6);
          const glow = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, size * 0.5);
          glow.addColorStop(0, `rgba(235,240,255,${(0.55 * fa).toFixed(3)})`);
          glow.addColorStop(1, "rgba(235,240,255,0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, size * 0.5, 0, Math.PI * 2);
          ctx.fill();
          drawLightning(ctx, pr.x + (c.seed - 0.5) * size * 0.3, pr.y + size * 0.05, clamp(size * 0.28, 8, 34), c.seed + Math.floor(this._t * 3), fa);
        } else if (Math.random() < 0.002 * (1 + w.pr / 4)) {
          c.flash = 0.18;
        }
      }
    }
  }

  _drawStorms(ctx, G, R, zoom, t, hits) {
    ctx.save();
    ctx.font = "600 10px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const s of this._storms) {
      // tropical cyclones get their own drawing
      if (this._cyclones.some((c) => distKm(c.lat, c.lon, s.lat, s.lon) < 700)) continue;
      const pr = this._project(s.p, G, R);
      if (pr.z <= 0.05) continue;
      const a = smooth(0.05, 0.25, pr.z);
      let r;
      if (this._iconsReady && ICON_TEXT.gale) {
        const size = clamp(34 + 6 * Math.sqrt(s.cells || 1) + 8 * Math.log2(Math.max(1, zoom)), 40, 72);
        r = size / 2;
        const sel = this._selected && this._selected.kind === "storm" && this._selected.v === s;
        this._icons.push({ id: `gale:${s.lat.toFixed(1)},${s.lon.toFixed(1)}`, kind: "gale", ring: null, x: pr.x, y: pr.y, size, alpha: a, sel });
      } else {
        r = clamp(R * 0.035 * Math.sqrt(s.cells || 1), 10, 70);
        const spin = s.lat >= 0 ? 1 : -1;
        ctx.strokeStyle = `rgba(220,230,240,${0.45 * a})`;
        ctx.lineWidth = 1.4;
        for (let k = 0; k < 3; k++) {
          const ph = -spin * t * 0.6 + (k * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, r * (0.55 + 0.2 * k), ph, ph + 1.4);
          ctx.stroke();
        }
      }
      if (zoom >= 1.6) {
        ctx.fillStyle = `rgba(6,10,18,${0.55 * a})`;
        const label = `${this._speed(s.max_wind_kmh)}${s.min_pressure_hpa ? ` · ${s.min_pressure_hpa} hPa` : ""}`;
        const tw = ctx.measureText(label).width;
        ctx.fillRect(pr.x - tw / 2 - 5, pr.y + r + 4, tw + 10, 15);
        ctx.fillStyle = `rgba(230,240,248,${a})`;
        ctx.fillText(label, pr.x, pr.y + r + 11.5);
      }
      hits.push({ kind: "storm", v: s, x: pr.x, y: pr.y, r: Math.max(16, r) });
    }
    ctx.restore();
  }

  _drawCyclones(ctx, G, R, zoom, t, sun, hits) {
    for (const c of this._cyclones) {
      const sel = this._selected && this._selected.kind === "cyclone" && this._selected.v.id === c.id;
      // position at the shown time: follow the track in forecast mode
      let lat = c.lat, lon = c.lon;
      if (this._offsetH && c.track.length > 1) {
        const ms = this._now();
        for (let i = 1; i < c.track.length; i++) {
          const a = c.track[i - 1], b = c.track[i];
          if (a.ms <= ms && ms <= b.ms) {
            const f = (ms - a.ms) / Math.max(1, b.ms - a.ms);
            lat = a.lat + (b.lat - a.lat) * f;
            lon = a.lon + (((b.lon - a.lon + 540) % 360) - 180) * f;
            break;
          }
          if (i === c.track.length - 1 && ms > b.ms) {
            lat = b.lat;
            lon = b.lon;
          }
        }
      }
      const pr = this._projLL(lat, lon, G, R);
      if (pr.z <= 0.03) continue;
      const degR = 3.5 + (c.category || 0) * 0.8 + ((c.wind_kmh || 80) / 250) * 3;
      const r = clamp(degR * DEG * R, 12, 260);
      const ex = Math.cos(lat * DEG) * Math.cos(lon * DEG), ey = Math.cos(lat * DEG) * Math.sin(lon * DEG), ez = Math.sin(lat * DEG);
      const night = smooth(0.08, -0.14, ex * sun[0] + ey * sun[1] + ez * sun[2]);
      drawCyclone(ctx, pr.x, pr.y, r, t, lat >= 0 ? 1 : -1, c.category || 0, smooth(0.03, 0.2, pr.z), night, sel);
      const catColor = CATEGORY_COLORS[Math.max(0, Math.min(5, c.category || 0))];
      this._icons.push({
        id: `cyc:${c.id}`,
        kind: "cyclone",
        ring: catColor,
        x: pr.x,
        y: pr.y,
        size: clamp(r * 0.55, 34, 76) * (sel ? 1.12 : 1),
        alpha: smooth(0.03, 0.2, pr.z),
        sel,
      });
      ctx.save();
      ctx.font = "650 11px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
      ctx.textBaseline = "middle";
      const text = `${c.name} · ${this._speed(c.wind_kmh)}`;
      const tw = ctx.measureText(text).width;
      const lx = pr.x + r * 0.75 + 6, ly = pr.y - r * 0.6;
      ctx.fillStyle = "rgba(6,10,18,0.66)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(lx - 4, ly - 8, tw + 8, 16, 8);
      else ctx.rect(lx - 4, ly - 8, tw + 8, 16);
      ctx.fill();
      ctx.fillStyle = CATEGORY_COLORS[Math.max(0, Math.min(5, c.category || 0))];
      ctx.fillText(text, lx, ly + 0.5);
      ctx.restore();
      // track on top of the clouds: past solid, forecast dashed
      const pts = c.track.map((q) => ({ q, pr: this._project(q.p, G, R) }));
      if (pts.length > 1) {
        ctx.save();
        ctx.lineCap = "round";
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          if (a.pr.z <= 0.02 || b.pr.z <= 0.02) continue;
          ctx.setLineDash(b.q.forecast ? [5, 5] : []);
          ctx.lineDashOffset = -t * 10;
          ctx.strokeStyle = b.q.forecast ? `rgba(255,255,255,${sel ? 0.9 : 0.6})` : `rgba(200,210,220,${sel ? 0.8 : 0.45})`;
          ctx.lineWidth = sel ? 2 : 1.4;
          ctx.beginPath();
          ctx.moveTo(a.pr.x, a.pr.y);
          ctx.lineTo(b.pr.x, b.pr.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const { q, pr } of pts) {
          if (pr.z <= 0.02) continue;
          const cat = q.wind_kmh == null ? 0 : q.wind_kmh < 119 ? 0 : q.wind_kmh < 154 ? 1 : q.wind_kmh < 178 ? 2 : q.wind_kmh < 209 ? 3 : q.wind_kmh < 252 ? 4 : 5;
          ctx.fillStyle = CATEGORY_COLORS[cat];
          ctx.globalAlpha = q.forecast ? 0.95 : 0.6;
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, sel ? 3.4 : 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      hits.push({ kind: "cyclone", v: c, x: pr.x, y: pr.y, r: Math.max(18, r * 0.6) });
    }
  }

  _drawSpots(ctx, G, R, zoom, zf, t, sun, hits) {
    this._clusters = [];
    if (this._config.spots === false) return;
    const surf = this._showSurf();
    const W = this._w, H = this._h;
    const thr = this._firingThreshold();
    const items = [];
    for (const s of this._spots) {
      const now = this._spotAt(s);
      if (this._firingOnly && surf && !(now && now.rating >= thr)) continue;
      const pr = this._project(s.p, G, R);
      if (pr.z <= 0.03 || pr.x < -40 || pr.x > W + 40 || pr.y < -40 || pr.y > H + 40) continue;
      items.push({ s, now, pr });
    }
    // best spots win the space
    items.sort((a, b) => (b.now?.rating ?? -1) - (a.now?.rating ?? -1));
    const iconSize = clamp(17 * Math.pow(zoom, 0.5), 32, 60);
    const figures = this._iconsReady && (surf ? zoom >= 1.9 : zoom >= 4);
    const placed = [];
    const draws = [];
    const clusters = [];
    for (const it of items) {
      const { s, now, pr } = it;
      const sel = this._selected && this._selected.kind === "spot" && this._selected.v.id === s.id;
      const color = now ? CONDITION_COLORS[now.condition] || "#9ab" : "#6d7f8c";
      const alpha = smooth(0.03, 0.2, pr.z);
      const ex = s.p[0] * sun[0] + s.p[1] * sun[1] + s.p[2] * sun[2];
      const night = smooth(0.08, -0.14, ex);
      if (figures && now && !sel) {
        // a better spot already sits here: join its group instead of hiding under it
        const host = placed.find((q) => Math.hypot(q.x - pr.x, q.y - pr.y) < iconSize * 1.15);
        if (host) {
          host.members.push(s);
          continue;
        }
      }
      const big = !!(figures && now && (sel || placed.length < MAX_SPOT_ICONS));
      const d = { s, now, pr, sel, color, alpha, night, big, members: [s] };
      if (big) placed.push({ x: pr.x, y: pr.y, members: d.members });
      draws.push(d);
    }
    // small dots first, figures on top, back to front
    draws.sort((a, b) => (a.big === b.big ? a.pr.y - b.pr.y : a.big ? 1 : -1));
    for (const d of draws) {
      const { s, now, pr, sel, color, alpha, night, big } = d;
      if (big) {
        const kind = POSE_ICON[now.pose] || "riding";
        const size = iconSize * (sel ? 1.18 : 1);
        // the group count only while its surfer is on screen, not peeking in at the edge
        const extra = pr.x >= 0 && pr.x <= W && pr.y >= 0 && pr.y <= H ? d.members.length - 1 : 0;
        this._icons.push({
          id: `spot:${s.id}`,
          kind,
          ring: OWN_RING.has(kind) ? null : color,
          x: pr.x,
          y: pr.y,
          size,
          alpha: alpha * (1 - 0.3 * night),
          sel,
          badge: extra > 0 ? `+${extra}` : null,
        });
        if (extra > 0) clusters.push({ members: d.members, bx: pr.x + size * 0.22 + 9, by: pr.y - size * 0.5 + 7 });
        if (s.sharks && this._config.sharks !== false && ICON_TEXT.shark) {
          // small shark marker at the lower left of the surfer
          this._icons.push({ id: `shark:${s.id}`, kind: "shark", ring: null, x: pr.x - size * 0.4, y: pr.y + size * 0.32, size: size * 0.55, alpha: alpha * (1 - 0.3 * night), sel: false });
        }
        hits.push({ kind: "spot", v: s, x: pr.x, y: pr.y, r: Math.max(16, iconSize * 0.55) });
      } else {
        const r = surf ? clamp(2.4 * zf, 2.5, 6) : clamp(1.8 * zf, 2, 4.5);
        drawSpotDot(ctx, pr.x, pr.y, r, color, alpha * (surf ? 1 : 0.8), surf && now && now.rating >= thr, t + s.seed);
        hits.push({ kind: "spot", v: s, x: pr.x, y: pr.y, r: Math.max(10, r * 2.5) });
      }
    }
    this._clusters = clusters;
    // labels for the best and the selected spots
    if (this._config.labels === false || !surf) return;
    ctx.save();
    ctx.font = "600 10.5px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = "middle";
    // labels never cover a surfer
    const rects = draws.filter((d) => d.big).map((d) => [d.pr.x - iconSize * 0.45, d.pr.y - iconSize * 0.45, iconSize * 0.9, iconSize * 0.9]);
    const top = 92;
    for (const d of draws.slice().sort((a, b) => (b.sel ? 1 : 0) - (a.sel ? 1 : 0) || (b.now?.rating ?? 0) - (a.now?.rating ?? 0))) {
      const { s, now, pr, sel, big } = d;
      if (!now) continue;
      const show = sel || (now.rating >= thr && zoom >= 1.6) || (zoom >= 2.6 && big) || zoom >= 5;
      if (!show) continue;
      const extra = d.members ? d.members.length - 1 : 0;
      const text = `${s.name} ${now.rating.toFixed(1)}★${extra > 0 ? `  +${extra}` : ""}`;
      const tw = ctx.measureText(text).width;
      const lx = pr.x + (big ? iconSize * 0.55 + 5 : 8);
      const ly = pr.y;
      const rect = [lx - 4, ly - 8, tw + 8, 16];
      if (rect[0] + rect[2] > W - 48 || ly < top || ly > H - 20) continue;
      const lg = this._legendBox();
      if (lg && rect[0] < lg[0] + lg[2] && rect[0] + rect[2] > lg[0] && rect[1] + rect[3] > lg[1]) continue;
      if (rects.some((r) => rect[0] < r[0] + r[2] && rect[0] + rect[2] > r[0] && rect[1] < r[1] + r[3] && rect[1] + rect[3] > r[1])) continue;
      rects.push(rect);
      ctx.globalAlpha = smooth(0.1, 0.3, pr.z);
      ctx.fillStyle = "rgba(4,10,18,0.66)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(rect[0], rect[1], rect[2], rect[3], 8);
      else ctx.rect(rect[0], rect[1], rect[2], rect[3]);
      ctx.fill();
      ctx.fillStyle = sel ? "#ffffff" : rgba(CONDITION_COLORS[now.condition] || "#ffffff", 1);
      ctx.fillText(text, lx, ly + 0.5);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** the legend (or time bar) area in stage pixels, labels stay out of it */
  _legendBox() {
    const el = this._stage.classList.contains("timing") ? this.shadowRoot.querySelector(".timebar") : this._legend;
    if (!el || el.offsetParent === null) return null;
    return [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight];
  }

  _drawHome(ctx, G, R) {
    const home = this._data?.home;
    if (!home || !Number.isFinite(home[0])) return;
    const pr = this._projLL(home[0], home[1], G, R);
    if (pr.z <= 0.05) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.fillStyle = "rgba(79,211,232,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function t2(t, ph) {
  return t * 5 + ph;
}

const EDITOR_SCHEMA = [
  { name: "title", selector: { text: {} } },
  {
    name: "mode",
    selector: { select: { mode: "dropdown", options: [{ value: "all", label: "All" }, { value: "ocean", label: "Ocean & weather" }, { value: "surf", label: "Surf" }] } },
  },
  {
    name: "center",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "home", label: "Home" },
          { value: "world", label: "Whole globe" },
          ...Object.keys(SURF_VIEWS).map((k) => ({ value: k, label: `Surf: ${k.replace(/_/g, " ")}` })),
          ...OCEAN_REGIONS.map(([k, label]) => ({ value: k, label: `Ocean: ${label}` })),
        ],
      },
    },
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "height", selector: { number: { min: 240, max: 1600, step: 20, unit_of_measurement: "px", mode: "box" } } },
      { name: "zoom", selector: { number: { min: 0.8, max: 16, step: 0.1, mode: "box" } } },
      { name: "units", selector: { select: { mode: "dropdown", options: [{ value: "auto", label: "Like Home Assistant" }, { value: "metric", label: "Metric" }, { value: "imperial", label: "Imperial" }] } } },
      { name: "quality", selector: { select: { mode: "dropdown", options: [{ value: "auto", label: "Automatic" }, { value: "high", label: "High" }, { value: "low", label: "Low (old tablets)" }] } } },
      { name: "lighting", selector: { select: { mode: "dropdown", options: [{ value: "day", label: "Daylight everywhere" }, { value: "real", label: "Real day and night" }] } } },
    ],
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "waves", selector: { boolean: {} } },
      { name: "crests", selector: { boolean: {} } },
      { name: "clouds", selector: { boolean: {} } },
      { name: "rain", selector: { boolean: {} } },
      { name: "cyclones", selector: { boolean: {} } },
      { name: "spots", selector: { boolean: {} } },
      { name: "sharks", selector: { boolean: {} } },
      { name: "webcams", selector: { boolean: {} } },
      { name: "labels", selector: { boolean: {} } },
      { name: "regions", selector: { boolean: {} } },
      { name: "forecast", selector: { boolean: {} } },
      { name: "rotate", selector: { boolean: {} } },
    ],
  },
];
const EDITOR_LABELS = {
  title: "Title",
  mode: "Mode",
  center: "Start view",
  height: "Height",
  zoom: "Zoom (empty = automatic)",
  units: "Units",
  quality: "Animation quality",
  lighting: "Lighting",
  waves: "Wave height colours",
  crests: "Rolling wave crests",
  clouds: "Clouds",
  rain: "Rain and lightning",
  cyclones: "Tropical cyclones",
  spots: "Surf spots",
  sharks: "Shark areas",
  webcams: "Webcams (needs a Windy key in the integration)",
  labels: "Spot names",
  regions: "Region buttons",
  forecast: "Forecast button (48 h)",
  rotate: "Slow rotation",
};

class SeaStateCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => EDITOR_LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const value = { ...ev.detail.value };
        for (const k of Object.keys(value)) if (value[k] === "" || value[k] == null) delete value[k];
        this._config = value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: value }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = {
      mode: "all",
      center: "home",
      units: "auto",
      quality: "auto",
      lighting: "day",
      waves: true,
      crests: true,
      clouds: true,
      rain: true,
      cyclones: true,
      spots: true,
      sharks: true,
      webcams: true,
      labels: true,
      regions: true,
      forecast: true,
      rotate: false,
      ...this._config,
      center: Array.isArray(this._config.center) ? "home" : this._config.center || "home",
    };
  }
}

if (!customElements.get("sea-state-card-editor")) {
  customElements.define("sea-state-card-editor", SeaStateCardEditor);
}

if (!customElements.get("sea-state-card")) {
  customElements.define("sea-state-card", SeaStateCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "sea-state-card",
    name: "Sea State Forecast",
    description: "Live waves, storms, tropical cyclones and surf spots on a living globe.",
    preview: true,
    documentationURL: "https://github.com/mb26-dev/ha-sea-state",
  });
  console.info(`%c SEA STATE %c ${VERSION} `, "background:#1aa6c4;color:#02121a;font-weight:700", "background:#0b1a24;color:#4fd3e8");
}

// ====================================================================== compact spot card

/** data of the integration, shared by all spot cards on a page */
const SPOT_DATA = { at: 0, data: null, busy: null };

async function loadSpotData(hass, force = false) {
  if (!force && SPOT_DATA.data && Date.now() - SPOT_DATA.at < DATA_REFRESH_MS - 5000) return SPOT_DATA.data;
  if (SPOT_DATA.busy) return SPOT_DATA.busy;
  SPOT_DATA.busy = (async () => {
    try {
      const resp = await hass.fetchWithAuth("/api/sea_state/data");
      if (resp.status === 503) throw new Error("loading");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      SPOT_DATA.data = await resp.json();
      SPOT_DATA.at = Date.now();
      return SPOT_DATA.data;
    } finally {
      SPOT_DATA.busy = null;
    }
  })();
  return SPOT_DATA.busy;
}

const SPOT_SHOW = ["surf", "swell", "wind", "water", "sea_state", "tide", "chart", "next_good", "sharks", "cyclone", "webcams"];

const SPOT_STYLE = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); color: #eef6fb;
    background: radial-gradient(120% 90% at 0% 0%, #0d2a3a 0%, #071622 45%, #02060c 100%);
    font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); }
  .wrap { padding: 12px 14px 10px; font-size: 12.5px; line-height: 1.45; }
  .brand { display: flex; align-items: baseline; gap: 6px; font-size: 13px; font-weight: 650; letter-spacing: .4px; margin-bottom: 8px; }
  .brand span { color: #4fd3e8; }
  .brand .sub { margin-left: auto; font-size: 10.5px; font-weight: 400; letter-spacing: 0; opacity: .6; }
  .top { display: flex; gap: 11px; align-items: center; cursor: default; }
  .top.nav { cursor: pointer; }
  .top img { width: 58px; height: 58px; flex: 0 0 58px; filter: drop-shadow(0 2px 6px rgba(0,0,0,.5)); }
  .top .ph { width: 58px; height: 58px; flex: 0 0 58px; border-radius: 50%; border: 3px solid currentColor; box-sizing: border-box; }
  .top .nm { min-width: 0; flex: 1 1 auto; }
  .top h3 { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .top .where { opacity: .7; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .top .rt { display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap; }
  .badge { font-size: 10.5px; font-weight: 650; letter-spacing: .4px; padding: 2px 8px; border-radius: 10px; color: #0b1118; white-space: nowrap; }
  .badge.soft { background: rgba(255,255,255,.1); color: #e8f1f6; font-weight: 500; letter-spacing: 0; }
  .stars { color: #ffcf3a; font-size: 14px; letter-spacing: 1px; white-space: nowrap; }
  .stars .off { color: rgba(255,255,255,.22); }
  .stars .half { background: linear-gradient(90deg, #ffcf3a 50%, rgba(255,255,255,.22) 50%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .surf { display: flex; gap: 10px; align-items: center; margin: 10px 0 4px; }
  .surf .big { font-size: 26px; font-weight: 700; line-height: 1.05; }
  .surf .big small { font-size: 12px; font-weight: 500; opacity: .75; margin-left: 3px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; margin-top: 8px; }
  .tile { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 6px 8px; min-width: 0; }
  .tile .k { font-size: 10.5px; opacity: .65; text-transform: uppercase; letter-spacing: .5px; }
  .tile .v { font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .s { font-size: 11px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .muted { opacity: .65; font-size: 11px; }
  .chart { margin: 10px 0 2px; }
  .chart svg { width: 100%; height: 64px; display: block; }
  .days { margin-top: 8px; display: grid; grid-template-columns: auto auto minmax(0,1fr) auto; gap: 3px 8px; font-size: 11.5px; align-items: center; }
  .days .d { opacity: .8; white-space: nowrap; }
  .days .s .stars { font-size: 12px; }
  .days .w { opacity: .7; white-space: nowrap; text-align: right; }
  .note { margin-top: 8px; padding: 6px 9px; border-radius: 10px; display: flex; gap: 8px; align-items: center; font-size: 12px; }
  .note img { width: 26px; height: 26px; flex: 0 0 26px; }
  .note.next { background: rgba(63,212,124,.09); border: 1px solid rgba(63,212,124,.3); }
  .note.shark { background: rgba(239,68,68,.09); border: 1px solid rgba(239,68,68,.32); }
  .note.cyc { background: rgba(255,176,58,.1); border: 1px solid rgba(255,176,58,.4); }
  .note a { color: #6fdcf0; text-decoration: none; font-weight: 600; }
  .cams { margin: 10px 0 2px; }
  .cams .ct { font-weight: 650; font-size: 12px; margin-bottom: 5px; }
  .cams .cl { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
  .cams .cl::-webkit-scrollbar { display: none; }
  .cams a.cam { flex: 1 0 128px; max-width: 200px; color: inherit; text-decoration: none; border-radius: 8px; overflow: hidden; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
  .cams a.cam img { display: block; width: 100%; max-width: 200px; height: auto; }
  .cams a.cam .cn { padding: 3px 6px 4px; font-size: 11px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cams .by { font-size: 10.5px; margin-top: 4px; text-align: right; }
  .cams .by a { color: #6fdcf0; text-decoration: none; }
  .list { display: flex; flex-direction: column; gap: 4px; }
  .row { display: grid; grid-template-columns: 34px minmax(0,1fr) auto auto; gap: 8px; align-items: center; padding: 4px 6px; border-radius: 10px; background: rgba(255,255,255,.04); }
  .row.nav { cursor: pointer; }
  .row img, .row .ph { width: 34px; height: 34px; }
  .row .ph { border-radius: 50%; border: 2px solid currentColor; box-sizing: border-box; }
  .row .n { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .n .muted { display: block; font-weight: 400; }
  .row .m { text-align: right; font-weight: 650; white-space: nowrap; }
  .row .m .muted { display: block; font-weight: 400; }
  .row .stars { font-size: 12px; }
  .msg { opacity: .75; padding: 6px 0; }
`;

class SeaStateSpotCard extends HTMLElement {
  constructor() {
    super();
    this._offsetH = 0;
    this._cams = {};
    this._root = this.attachShadow({ mode: "open" });
    this._root.innerHTML = `<style>${SPOT_STYLE}</style><ha-card><div class="wrap"><div class="msg">Loading Sea State...</div></div></ha-card>`;
    this._wrap = this._root.querySelector(".wrap");
    this._info = this._root; // used by the shared webcam loader
  }

  static getConfigElement() {
    return document.createElement("sea-state-spot-card-editor");
  }

  static getStubConfig() {
    return { spot: "home" };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    if (config.spots != null && !Array.isArray(config.spots)) throw new Error("spots must be a list of spot ids");
    this._config = { spot: "home", days: 3, ...config };
    if (this._hass) this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  connectedCallback() {
    if (this._hass && !this._timer) this._load();
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
    this._timer = null;
  }

  getCardSize() {
    return this._config?.spots?.length ? 1 + this._config.spots.length : 5;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  async _load() {
    clearTimeout(this._timer);
    let wait = DATA_REFRESH_MS;
    try {
      this._data = await loadSpotData(this._hass);
      await loadIcons();
      this._render();
    } catch (err) {
      wait = 30000;
      if (!this._data) this._wrap.innerHTML = `<div class="msg">${err.message === "loading" ? "Sea State is loading the first forecasts..." : `Sea State data not available (${esc(err.message)}). Is the Sea State Forecast integration set up?`}</div>`;
    }
    this._timer = setTimeout(() => this._load(), wait);
  }

  _show(key) {
    const show = this._config.show;
    if (Array.isArray(show)) return show.includes(key);
    return this._config[key] !== false;
  }

  _findSpot(id) {
    const spots = this._data?.spots || [];
    if (!id || id === "home") id = this._data?.home_spot;
    return spots.find((s) => s.id === id) || null;
  }

  _icon(now, cls = "") {
    if (!now) return `<span class="ph ${cls}" style="color:#6d7f8c"></span>`;
    const kind = POSE_ICON[now.pose] || "riding";
    const color = CONDITION_COLORS[now.condition] || "#9ab";
    const url = iconUrl(kind, OWN_RING.has(kind) ? null : color);
    return url ? `<img class="${cls}" src="${url}" alt="">` : `<span class="ph ${cls}" style="color:${color}"></span>`;
  }

  _navigate() {
    const path = this._config.navigation_path;
    if (!path) return;
    history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  _render() {
    if (!this._data) return;
    this._spots = this._data.spots || [];
    const brand = this._config.title === false ? "" : `<div class="brand">${this._config.title ? esc(this._config.title) : "Sea <span>State</span>"}<span class="sub">${esc(rel((this._data.updated || 0) * 1000))}</span></div>`;
    if (Array.isArray(this._config.spots) && this._config.spots.length) {
      this._wrap.innerHTML = brand + this._listHtml();
      for (const row of this._wrap.querySelectorAll(".row.nav")) row.addEventListener("click", () => this._navigate());
      return;
    }
    const s = this._findSpot(this._config.spot);
    if (!s) {
      this._wrap.innerHTML = `${brand}<div class="msg">Spot "${esc(this._config.spot)}" not found. Pick one in the card editor.</div>`;
      return;
    }
    this._wrap.innerHTML = brand + this._spotHtml(s);
    if (this._config.navigation_path) this._wrap.querySelector(".top").addEventListener("click", () => this._navigate());
    if (this._show("webcams") && this._camsOn()) this._loadCams(s.id);
  }

  _listHtml() {
    const rows = this._config.spots
      .map((id) => this._findSpot(id))
      .filter(Boolean)
      .map((s) => {
        const now = s.now;
        const where = [s.area, s.country].filter(Boolean).join(", ");
        const wind = now?.wind_kind ? WIND_KINDS[now.wind_kind] || "" : "";
        return `<div class="row${this._config.navigation_path ? " nav" : ""}">${this._icon(now)}<div class="n">${esc(s.name)}<span class="muted">${esc(where)}</span></div>`
          + `<div>${now ? starsHtml(now.rating) : ""}</div>`
          + `<div class="m">${now ? this._len(now.surf_m) : "–"}<span class="muted">${esc(wind)}</span></div></div>`;
      });
    return rows.length ? `<div class="list">${rows.join("")}</div>` : `<div class="msg">None of the spots was found. Pick them in the card editor.</div>`;
  }

  _spotHtml(s) {
    const now = s.now;
    const where = [s.area, s.country].filter(Boolean).join(", ");
    const parts = [];
    const cond = now ? now.condition : null;
    const color = cond ? CONDITION_COLORS[cond] || "#9ab" : "#6d7f8c";
    parts.push(`<div class="top${this._config.navigation_path ? " nav" : ""}">${this._icon(now)}<div class="nm"><h3>${esc(this._config.name || s.name)}</h3><div class="where">${esc(where)}</div>`
      + (now ? `<div class="rt"><span class="badge" style="background:${color}">${esc((CONDITION_LABELS[cond] || cond).toUpperCase())}</span>${starsHtml(now.rating)}<span class="badge soft">${now.rating.toFixed(1)} / 5</span></div>` : "")
      + `</div></div>`);
    if (!now) {
      parts.push(`<div class="msg">No forecast for this spot yet.</div>`);
      return parts.join("");
    }
    if (this._show("surf")) {
      parts.push(`<div class="surf">${this._compassSvg(s, now)}<div><div class="big">${this._len(now.surf_m)}<small>surf</small></div><div class="muted">ideal ${this._lenRange(s.size[0], s.size[2])} · ${esc(BREAKS[s.kind] || s.kind)}</div></div></div>`);
    }
    const tiles = [];
    const tile = (k, v, sub) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
    if (this._show("swell") && now.swell_m != null) {
      tiles.push(tile("Swell", `${this._len(now.swell_m)} · ${now.swell_period != null ? `${Math.round(now.swell_period)} s` : "–"}`, `from ${compass(now.swell_dir)}${now.swell2_m ? ` · 2nd ${this._len(now.swell2_m)}` : ""}`));
    }
    if (this._show("wind") && now.wind_kmh != null) {
      const wc = now.wind_kind === "offshore" || now.wind_kind === "glassy" ? "#3fd47c" : now.wind_kind === "onshore" ? "#ff7a5c" : "#ffcf3a";
      tiles.push(tile("Wind", `${this._speed(now.wind_kmh)} ${compass(now.wind_dir)}`, `<span style="color:${wc};font-weight:650">${esc(WIND_KINDS[now.wind_kind] || "")}</span>${now.gust_kmh ? ` · gusts ${this._speed(now.gust_kmh)}` : ""}`));
    }
    if (this._show("water") && now.water_c != null) tiles.push(tile("Water", this._temp(now.water_c), esc(now.wetsuit || "")));
    if (this._show("tide")) {
      const ts = Date.now() / 1000;
      const next = (s.tides || []).filter((t) => t.time > ts).slice(0, 2);
      if (next.length) {
        const fmt = (t) => new Date(t.time * 1000 + (s.utc_offset || 0) * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
        tiles.push(tile("Tide", `${next[0].kind === "high" ? "High" : "Low"} ${fmt(next[0])}`, next[1] ? `then ${next[1].kind === "high" ? "high" : "low"} ${fmt(next[1])}` : "local time"));
      }
    }
    if (this._show("sea_state") && now.sea_state) {
      tiles.push(tile("Sea", esc(SEA_STATE_NAMES[now.sea_state] || now.sea_state), `Douglas ${now.douglas} · waves ${this._len(now.wave_height_m)}`));
    }
    if (tiles.length) parts.push(`<div class="tiles">${tiles.join("")}</div>`);
    if (this._show("chart")) parts.push(this._chartSvg(s));
    const days = Number(this._config.days);
    if (days > 0 && s.days && s.days.length) {
      const rows = s.days.slice(0, days).map((d) => {
        const dt = new Date(`${d.date}T12:00:00Z`);
        const label = dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
        return `<span class="d">${esc(label)}</span><span class="s">${starsHtml(d.rating)}</span><span>${this._lenRange(d.surf_min, d.surf_max)}</span><span class="w">${esc(d.best_from)}–${esc(d.best_to)}</span>`;
      });
      parts.push(`<div class="days">${rows.join("")}</div>`);
    }
    if (this._show("next_good") && s.next_good && now.rating < 3) {
      const d = new Date(new Date(s.next_good).getTime() + (s.utc_offset || 0) * 1000);
      parts.push(`<div class="note next">⏭ <span>Next good session <b>${d.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</b> local</span></div>`);
    }
    if (this._show("cyclone")) {
      const radius = this._data.cyclone_radius_km || 800;
      const near = (this._data.cyclones || []).filter((c) => (c.closest_km ?? c.now_km ?? 1e9) <= radius);
      for (const c of near.slice(0, 2)) {
        const cyc = iconUrl("cyclone", CATEGORY_COLORS[Math.max(0, Math.min(5, c.category || 0))]);
        parts.push(`<div class="note cyc">${cyc ? `<img src="${cyc}" alt="">` : "🌀"}<span><b>${esc(c.name || "Tropical cyclone")}</b> ${c.now_km != null ? `${this._dist(c.now_km)} from home` : ""}${c.closest_km != null && c.closest_km < (c.now_km ?? 1e9) ? `<span class="muted"> · forecast closest ${this._dist(c.closest_km)}</span>` : ""}</span></div>`);
      }
    }
    if (this._show("sharks") && s.sharks) {
      const sh = s.sharks;
      const icon = iconUrl("shark", null);
      parts.push(`<div class="note shark">${icon ? `<img src="${icon}" alt="">` : "🦈"}<span>Shark area · ${esc(sh.species)}${sh.service ? ` · <a href="${esc(sh.service.url)}" target="_blank" rel="noopener">${esc(sh.service.name)}</a>` : ""}</span></div>`);
    }
    if (this._show("webcams") && this._camsOn()) parts.push(`<div class="cams" data-spot="${esc(s.id)}">${this._camsHtml(s.id)}</div>`);
    return parts.join("");
  }
}

for (const m of ["_imperial", "_len", "_lenRange", "_speed", "_temp", "_dist", "_compassSvg", "_chartSvg", "_now", "_camsOn", "_camsHtml", "_loadCams"]) {
  SeaStateSpotCard.prototype[m] = SeaStateCard.prototype[m];
}

const SPOT_EDITOR_LABELS = {
  spot: "Spot",
  spots: "Several spots as a list (instead of one spot)",
  name: "Name (empty = spot name)",
  title: "Header (empty = Sea State)",
  days: "Days in the outlook",
  units: "Units",
  navigation_path: "Open on tap (e.g. /dashboard-surf/globe)",
  surf: "Surf height and swell window",
  swell: "Swell",
  wind: "Wind",
  water: "Water temperature",
  tide: "Tide",
  sea_state: "Sea state",
  chart: "48 h chart",
  next_good: "Next good session",
  cyclone: "Cyclone nearby",
  sharks: "Shark area",
  webcams: "Webcams",
};

class SeaStateSpotCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._form) this._form.hass = hass;
    if (first) {
      loadSpotData(hass)
        .then((data) => {
          this._spotList = data.spots || [];
          this._render();
        })
        .catch(() => {});
    }
  }

  _schema() {
    const spots = (this._spotList || [])
      .slice()
      .sort((a, b) => (a.country || "").localeCompare(b.country || "") || a.name.localeCompare(b.name))
      .map((s) => ({ value: s.id, label: s.country ? `${s.name} (${s.country})` : s.name }));
    const toggles = SPOT_SHOW.map((name) => ({ name, selector: { boolean: {} } }));
    return [
      { name: "spot", selector: { select: { mode: "dropdown", options: [{ value: "home", label: "Home spot" }, ...spots] } } },
      { name: "spots", selector: { select: { multiple: true, mode: "dropdown", options: spots } } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "name", selector: { text: {} } },
          { name: "title", selector: { text: {} } },
          { name: "days", selector: { number: { min: 0, max: 7, mode: "slider" } } },
          { name: "units", selector: { select: { mode: "dropdown", options: [{ value: "auto", label: "Like Home Assistant" }, { value: "metric", label: "Metric" }, { value: "imperial", label: "Imperial" }] } } },
        ],
      },
      { name: "navigation_path", selector: { text: {} } },
      { type: "expandable", name: "", title: "What to show", schema: [{ type: "grid", name: "", schema: toggles }] },
    ];
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => SPOT_EDITOR_LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const value = { ...ev.detail.value };
        for (const k of Object.keys(value)) {
          if (value[k] === "" || value[k] == null || (Array.isArray(value[k]) && !value[k].length)) delete value[k];
          else if (SPOT_SHOW.includes(k) && value[k] === true) delete value[k];
        }
        if (value.units === "auto") delete value.units;
        this._config = value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: value }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    const data = { spot: "home", days: 3, units: "auto", ...this._config };
    for (const k of SPOT_SHOW) data[k] = this._config?.[k] !== false;
    this._form.data = data;
  }
}

if (!customElements.get("sea-state-spot-card-editor")) {
  customElements.define("sea-state-spot-card-editor", SeaStateSpotCardEditor);
}

if (!customElements.get("sea-state-spot-card")) {
  customElements.define("sea-state-spot-card", SeaStateSpotCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "sea-state-spot-card",
    name: "Sea State Spot",
    description: "Compact surf report for one spot or a list of spots, without the globe.",
    preview: true,
    documentationURL: "https://github.com/mb26-dev/ha-sea-state",
  });
}
