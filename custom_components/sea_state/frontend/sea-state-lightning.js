/*
 * Sea State Forecast lightning card: live lightning strikes around home on a radar map,
 * with range rings, a sweep, flashing fresh strikes and the storm trend.
 * Strikes come from the Blitzortung integration (its geo_location entities).
 *
 * Map engine: Web Mercator tiles loaded by the browser from NASA GIBS (Blue Marble
 * shaded relief, or today's VIIRS true colour image with coastlines), drag and pinch
 * to move, buttons for saved views, named places and a popup per strike.
 */

const R_EARTH = 6371;
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const LAYERS = {
  relief: { url: (z, y, x) => `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`, max: 8, dim: 0.28 },
  satellite: {
    url: (z, y, x, date) => `${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`,
    max: 9,
    dim: 0.12,
  },
};
const COAST = (z, y, x) => `${GIBS}/Coastlines_15m/default/GoogleMapsCompatible_Level13/${z}/${y}/${x}.png`;
const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const hex = (c) => `rgb(${c.join(",")})`;
const kmText = (km) => (km < 10 ? km.toFixed(1) : String(Math.round(km)));

function haversine(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

const compass = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** global Web Mercator pixel of a point at zoom z */
function project(lat, lon, z) {
  const s = 256 * 2 ** z;
  const sin = Math.sin(clamp(lat, -85, 85) * (Math.PI / 180));
  return { x: ((lon + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}

function unproject(x, y, z) {
  const s = 256 * 2 ** z;
  const lon = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon };
}

/** zoom that shows `km` from the centre to the shorter edge */
function zoomFor(lat, km, px) {
  const mpp = (km * 1000) / Math.max(40, px / 2);
  return Math.log2((156543.03392 * Math.cos(lat * (Math.PI / 180))) / mpp);
}

function ago(ms) {
  const min = Math.max(0, (Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

function isoDay(offset) {
  return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
}

/* --------------------------------------------------------------- tile cache */

const TILES = new Map();

function tile(url, onload) {
  let t = TILES.get(url);
  if (t) {
    if (!t.ok && !t.failed && onload) t.waiting.add(onload);
    return t;
  }
  t = { img: new Image(), ok: false, failed: false, waiting: new Set(onload ? [onload] : []) };
  t.img.crossOrigin = "anonymous";
  t.img.decoding = "async";
  t.img.onload = () => {
    t.ok = true;
    t.waiting.forEach((f) => f());
    t.waiting.clear();
  };
  t.img.onerror = () => {
    t.failed = true;
    t.waiting.clear();
  };
  t.img.src = url;
  TILES.set(url, t);
  if (TILES.size > 900) TILES.delete(TILES.keys().next().value);
  return t;
}

/** true when a satellite tile has image data (days with a missing swath are black) */
function hasData(img) {
  try {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 12) dark++;
    return dark < 200;
  } catch (_e) {
    return true;
  }
}

/* --------------------------------------------------------------- colours */

/** lightning colour by age in minutes */
function strikeColor(min) {
  if (min < 5) return [255, 255, 255];
  if (min < 15) return [253, 224, 71];
  if (min < 45) return [251, 146, 60];
  return [220, 38, 38];
}


/* --------------------------------------------------------------- styles */

const STYLE = `
  :host { display: block; }
  ha-card { display: block; overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); color: #f3f1ee;
    background: radial-gradient(120% 90% at 0% 0%, var(--mf-bg1, #2a1408) 0%, #120a07 45%, #050304 100%);
    font-family: var(--paper-font-body1_-_font-family, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); }
  .top { display: flex; align-items: center; gap: 12px; padding: 12px 14px 8px; }
  .top img { width: 48px; height: 48px; flex: 0 0 48px; filter: drop-shadow(0 0 8px var(--mf-glow, rgba(255,120,30,.45))); }
  .top img.calm { filter: grayscale(.85) brightness(.75); opacity: .75; }
  .top .t { min-width: 0; flex: 1; }
  .top h3 { margin: 0; font-size: 17px; font-weight: 700; color: var(--mf-title, #ffd700); letter-spacing: .2px; }
  .top .s { font-size: 13px; font-weight: 650; margin-top: 2px; }
  .top .h { font-size: 11px; opacity: .65; margin-top: 2px; }
  .big { text-align: right; flex: 0 0 auto; }
  .big b { display: block; font-size: 26px; line-height: 1; font-weight: 750; }
  .big span { font-size: 10px; opacity: .65; text-transform: uppercase; letter-spacing: .6px; white-space: nowrap; }
  .map { position: relative; height: var(--mf-height, 260px); margin: 0 10px; border-radius: 10px; overflow: hidden;
    border: 1px solid rgba(255,215,0,.22); background: #0b1622; touch-action: none; cursor: grab; }
  .map.drag { cursor: grabbing; }
  .map canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .flash { position: absolute; inset: 0; background: radial-gradient(circle at var(--fx, 50%) var(--fy, 50%), rgba(255,255,255,.55), rgba(180,200,255,.15) 40%, transparent 70%);
    opacity: 0; pointer-events: none; z-index: 1; }
  .flash.on { animation: mfFlash .7s ease-out; }
  @keyframes mfFlash { 0% { opacity: 1; } 12% { opacity: .2; } 20% { opacity: .8; } 100% { opacity: 0; } }
  .ctl { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; gap: 5px; z-index: 2; }
  .ctl button, .chips button { font: inherit; color: #eee; background: rgba(10,8,8,.72); border: 1px solid rgba(255,255,255,.18);
    border-radius: 8px; cursor: pointer; backdrop-filter: blur(4px); }
  .ctl button { width: 30px; height: 30px; font-size: 16px; line-height: 1; padding: 0; }
  .chips { position: absolute; left: 8px; top: 8px; display: flex; flex-wrap: wrap; gap: 5px; z-index: 2; max-width: calc(100% - 60px); }
  .chips button { font-size: 11px; padding: 4px 9px; border-radius: 12px; }
  .chips button.on { background: var(--mf-accent, #ff8a1f); color: #160b03; border-color: var(--mf-accent, #ff8a1f); font-weight: 700; }
  .stamp { position: absolute; left: 8px; bottom: 6px; font-size: 9.5px; opacity: .7; z-index: 2; pointer-events: none; text-shadow: 0 1px 3px #000; }
  .legend { position: absolute; right: 8px; bottom: 6px; display: flex; gap: 8px; font-size: 9.5px; z-index: 2; pointer-events: none;
    text-shadow: 0 1px 3px #000; opacity: .85; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; vertical-align: -1px; }
  .pop { position: absolute; z-index: 3; min-width: 170px; max-width: 250px; padding: 7px 10px; border-radius: 10px; font-size: 11.5px; line-height: 1.35;
    background: rgba(12,8,6,.92); border: 1px solid var(--mf-accent, #ff8a1f); box-shadow: 0 6px 18px rgba(0,0,0,.5); pointer-events: auto; }
  .pop b { font-size: 13px; }
  .pop .m { opacity: .7; font-size: 11px; }
  .pop a { color: var(--mf-link, #ffab4a); }
  .pop .x { position: absolute; right: 6px; top: 2px; cursor: pointer; opacity: .6; font-size: 14px; }
  .wrap { padding: 8px 12px 12px; }
  .alert { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding: 6px 10px; border-radius: 10px;
    border: 1px solid var(--ac); background: color-mix(in srgb, var(--ac) 14%, transparent); font-size: 12.5px; }
  .alert img { width: 34px; height: 34px; flex: 0 0 34px; }
  .alert b { color: var(--ac); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
  .tile { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 6px 8px; min-width: 0; }
  .tile[data-lat] { cursor: pointer; }
  .tile.hot { border-color: var(--mf-hot, rgba(255,90,31,.6)); background: var(--mf-hotbg, rgba(255,90,31,.12)); }
  .tile .k { font-size: 10px; opacity: .7; text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .v { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile .s { font-size: 10.5px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list { margin-top: 8px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 6px 2px; border-top: 1px solid rgba(255,255,255,.07); cursor: pointer; font-size: 12.5px; }
  .row .dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 10px; }
  .row .mag { flex: 0 0 auto; min-width: 38px; text-align: center; font-weight: 800; font-size: 12px; padding: 1px 6px; border-radius: 8px; color: #120a07; }
  .row .main { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .main b { font-weight: 700; }
  .row .main em { font-style: normal; opacity: .6; }
  .row .pw { font-weight: 700; white-space: nowrap; }
  .row .tm { opacity: .6; font-size: 11px; white-space: nowrap; width: 62px; text-align: right; }
  .none { padding: 8px 2px 2px; font-size: 12.5px; opacity: .75; }
  .foot { margin-top: 8px; font-size: 10px; opacity: .55; display: flex; gap: 8px; flex-wrap: wrap; }
  .foot a { color: inherit; }
  .msg { padding: 16px; font-size: 13px; opacity: .8; }
`;

/* --------------------------------------------------------------- shared map engine */

function defineLightningCard() {
  const VERSION = "0.1.0b9";
  const loadData = null;
  const refreshMs = 0;
  const icon = (name) => new URL(`./icons/${name}?v=${VERSION}`, import.meta.url).href;
  const ICONS = {
    lightning: icon("lightning-marker.svg"),
  };
  const IMAGES = {};
  const image = (name) => {
    if (!IMAGES[name]) {
      IMAGES[name] = new Image();
      IMAGES[name].src = ICONS[name];
    }
    return IMAGES[name];
  };

  class SeaStateMapCard extends HTMLElement {
    /* ------------------------------------------------------------ hooks */

    // icon name, card defaults, default views, data from the integration?
    get kind() { return "lightning"; }
    get usesPayload() { return true; }
    defaults() { return {}; }
    defaultViews() { return [{ name: "Near", radius_km: 40 }, { name: "Region", radius_km: 150 }, { name: "Wide", radius_km: 900 }]; }
    theme() { return {}; }
    legend() { return ""; }
    prepare() {}
    paintItems() {}
    renderText() {}
    popupHtml() { return ""; }
    disabledText() { return ""; }

    /* ------------------------------------------------------------ setup */

    setConfig(config) {
      this._config = { list: 5, map: "relief", ...this.defaults(), ...config };
      this._views = Array.isArray(this._config.views) && this._config.views.length ? this._config.views : this.defaultViews();
      this._viewIdx = clamp(Number(this._config.view ?? 1) || 0, 0, this._views.length - 1);
      this._view = null;
      this._centered = false;
      if (this._root) this._build();
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (first) {
        this._build();
        this._load();
        return;
      }
      if (this.hassChanged(hass)) {
        this._prepare();
        this._renderBody();
      }
    }

    // true when the card has to recompute from the new states
    hassChanged(hass) {
      const id = this._config.air_quality_entity;
      if (id && hass.states[id] !== this._aqState) {
        this._aqState = hass.states[id];
        return true;
      }
      return false;
    }

    getCardSize() {
      return 7;
    }

    getGridOptions() {
      return { columns: 12, min_columns: 6, rows: "auto" };
    }

    connectedCallback() {
      if (this.usesPayload) this._timer = setInterval(() => this._load(), refreshMs);
      else this._timer = setInterval(() => { this._prepare(); this._renderBody(); }, 30000);
      this._io = new IntersectionObserver((e) => {
        this._visible = e.some((x) => x.isIntersecting);
        if (this._visible) this._loop();
      });
      this._io.observe(this);
      if (this._canvas) this._resize();
    }

    disconnectedCallback() {
      clearInterval(this._timer);
      this._io?.disconnect();
      this._ro?.disconnect();
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    async _load() {
      if (this.usesPayload) {
        try {
          this._data = await loadData(this._hass, true);
          this._error = null;
        } catch (err) {
          this._error = String(err.message || err);
        }
      } else {
        this._data = this._data || {};
      }
      this._prepare();
      if ((this._data || !this.usesPayload) && !this._centered) {
        // the first view waits for the home location
        this._centered = true;
        this._view = null;
        this._resize();
      }
      this._renderBody();
      this._drawBase();
    }

    home() {
      const c = this._config.center;
      if (Array.isArray(c) && c.length === 2) return { lat: Number(c[0]), lon: Number(c[1]) };
      const h = this._data?.home;
      if (h && h[0] != null) return { lat: h[0], lon: h[1] };
      const cfg = this._hass?.config;
      return { lat: cfg?.latitude ?? 0, lon: cfg?.longitude ?? 0 };
    }

    homeName() {
      return this._config.home_name || "Home";
    }

    _prepare() {
      this._places = (this._config.places || [])
        .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
        .map((p) => ({ name: String(p.name || ""), lat: Number(p.lat), lon: Number(p.lon), r: Number(p.radius_km) || 30 }));
      this.prepare();
    }

    /** the nearest configured place within 2.5 x its radius, for "near Krabi" */
    nearPlace(lat, lon) {
      let best = null;
      for (const p of this._places || []) {
        const d = haversine(p.lat, p.lon, lat, lon);
        if (d <= p.r * 2.5 && (!best || d < best.d)) best = { p, d };
      }
      return best;
    }

    /* ------------------------------------------------------------ dom */

    _build() {
      if (!this._config || !this._hass) return;
      if (!this._root) this._root = this.attachShadow({ mode: "open" });
      const h = Number(this._config.height) || 260;
      const th = this.theme();
      const vars = Object.entries({ "--mf-height": `${h}px`, ...th }).map(([k, v]) => `${k}:${v}`).join(";");
      this._root.innerHTML = `<style>${STYLE}</style>
        <ha-card style="${vars}">
          <div class="top"><img class="calm" src="${ICONS[this.kind]}" alt=""><div class="t">
            <h3>${esc(this._config.title || "")}</h3><div class="s"></div><div class="h"></div></div>
            <div class="big"><b>–</b><span></span></div></div>
          <div class="map">
            <canvas class="base"></canvas><canvas class="fx"></canvas><div class="flash"></div>
            <div class="chips"></div>
            <div class="ctl"><button class="zin" title="Zoom in">+</button><button class="zout" title="Zoom out">−</button>
              <button class="lay" title="Relief map / today's satellite image">🛰</button><button class="ctr" title="Back to home">⌂</button></div>
            <div class="stamp"></div>
            <div class="legend">${this.legend()}</div>
          </div>
          <div class="wrap"></div>
        </ha-card>`;
      const $ = (s) => this._root.querySelector(s);
      this._mapEl = $(".map");
      this._canvas = $("canvas.base");
      this._fx = $("canvas.fx");
      this._flashEl = $(".flash");
      image(this.kind).addEventListener("load", () => this._loop(), { once: true });
      $(".zin").addEventListener("click", () => this._zoomBy(1));
      $(".zout").addEventListener("click", () => this._zoomBy(-1));
      $(".ctr").addEventListener("click", () => this._setView(this._viewIdx));
      $(".lay").addEventListener("click", () => {
        this._layer = this._layerName() === "relief" ? "satellite" : "relief";
        this._satDate = null;
        this._drawBase();
      });
      this._bindPointer();
      this._renderChips();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this._mapEl);
      this._resize();
      this._renderBody();
    }

    _renderChips() {
      const el = this._root.querySelector(".chips");
      el.innerHTML = this._views.map((v, i) => `<button data-i="${i}" class="${i === this._viewIdx ? "on" : ""}">${esc(v.name || `View ${i + 1}`)}</button>`).join("");
      el.querySelectorAll("button").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        this._setView(Number(b.dataset.i));
      }));
    }

    _layerName() {
      return this._layer || (this._config.map === "satellite" ? "satellite" : "relief");
    }

    _viewTarget(i) {
      const v = this._views[i] || {};
      const home = this.home();
      const lat = Number.isFinite(Number(v.lat)) ? Number(v.lat) : home.lat;
      const lon = Number.isFinite(Number(v.lon)) ? Number(v.lon) : home.lon;
      return { lat, lon, km: Number(v.radius_km) || 150 };
    }

    _setView(i) {
      this._viewIdx = i;
      const v = this._viewTarget(i);
      this._flyTo(v.lat, v.lon, zoomFor(v.lat, v.km, Math.min(this._w || 400, this._h || 260)));
      this._root.querySelectorAll(".chips button").forEach((b, j) => b.classList.toggle("on", j === i));
      this._closePop();
    }

    flyToKm(lat, lon, km) {
      this._flyTo(lat, lon, zoomFor(lat, km, Math.min(this._w, this._h)));
    }

    _resize() {
      if (!this._mapEl) return;
      const r = this._mapEl.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this._w = r.width;
      this._h = r.height;
      this._dpr = dpr;
      for (const c of [this._canvas, this._fx]) {
        c.width = Math.round(r.width * dpr);
        c.height = Math.round(r.height * dpr);
      }
      if (!this._view) {
        const v = this._viewTarget(this._viewIdx);
        this._view = { lat: v.lat, lon: v.lon, zoom: zoomFor(v.lat, v.km, Math.min(r.width, r.height)) };
      }
      this._drawBase();
      this._loop();
    }

    /* ------------------------------------------------------------ view */

    _flyTo(lat, lon, zoom, ms = 650) {
      if (!this._view) return;
      this._fly = { from: { ...this._view }, to: { lat, lon, zoom: clamp(zoom, 2, 13) }, t0: performance.now(), ms };
      this._loop();
    }

    _zoomBy(dz, cx, cy) {
      if (!this._view) return;
      const z = clamp(this._view.zoom + dz, 2, 13);
      if (cx == null) {
        this._flyTo(this._view.lat, this._view.lon, z, 300);
        return;
      }
      // keep the point under the cursor in place
      const before = this.toLatLon(cx, cy);
      this._view.zoom = z;
      const after = this.toLatLon(cx, cy);
      this._view.lat = clamp(this._view.lat + (before.lat - after.lat), -80, 80);
      this._view.lon += before.lon - after.lon;
      this._drawBase();
    }

    toPx(lat, lon) {
      const z = this._view.zoom;
      const c = project(this._view.lat, this._view.lon, z);
      const p = project(lat, lon, z);
      const world = 256 * 2 ** z;
      let dx = p.x - c.x;
      if (dx > world / 2) dx -= world;
      if (dx < -world / 2) dx += world;
      return { x: this._w / 2 + dx, y: this._h / 2 + (p.y - c.y) };
    }

    toLatLon(x, y) {
      const z = this._view.zoom;
      const c = project(this._view.lat, this._view.lon, z);
      return unproject(c.x + (x - this._w / 2), c.y + (y - this._h / 2), z);
    }

    /** pixels per km at the centre of the view */
    pxPerKm() {
      return 1000 / ((156543.03392 * Math.cos(this._view.lat * (Math.PI / 180))) / 2 ** this._view.zoom);
    }

    onScreen(q, pad = 30) {
      return q.x > -pad && q.y > -pad && q.x < this._w + pad && q.y < this._h + pad;
    }

    _bindPointer() {
      const el = this._mapEl;
      const pts = new Map();
      let moved = 0;
      let pinch = null;
      el.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".ctl, .chips, .pop")) return;
        el.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = 0;
        this._fly = null;
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this._view.zoom };
        }
        el.classList.add("drag");
      });
      el.addEventListener("pointermove", (e) => {
        const p = pts.get(e.pointerId);
        if (!p || !this._view) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (pts.size === 2 && pinch) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          this._view.zoom = clamp(pinch.zoom + Math.log2(d / pinch.d), 2, 13);
          moved += 10;
          this._drawBase();
          return;
        }
        moved += Math.abs(dx) + Math.abs(dy);
        const z = this._view.zoom;
        const c = project(this._view.lat, this._view.lon, z);
        const ll = unproject(c.x - dx, c.y - dy, z);
        this._view.lat = clamp(ll.lat, -80, 80);
        this._view.lon = ll.lon;
        this._drawBase();
      });
      const up = (e) => {
        const had = pts.delete(e.pointerId);
        if (pts.size < 2) pinch = null;
        if (!pts.size) el.classList.remove("drag");
        if (had && moved < 6 && e.type === "pointerup") {
          const r = el.getBoundingClientRect();
          this._tap(e.clientX - r.left, e.clientY - r.top);
        }
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        this._zoomBy(-e.deltaY * 0.0022, e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      el.addEventListener("dblclick", (e) => {
        const r = el.getBoundingClientRect();
        const ll = this.toLatLon(e.clientX - r.left, e.clientY - r.top);
        this._flyTo(ll.lat, ll.lon, this._view.zoom + 1.2, 400);
      });
    }

    /* ------------------------------------------------------------ base map */

    _drawBase() {
      if (!this._canvas || !this._view || !this._w) return;
      cancelAnimationFrame(this._baseRaf);
      this._baseRaf = requestAnimationFrame(() => this._paintBase());
    }

    _satelliteDate(again) {
      // today's swath may still be missing: step back a day when the tile under the view is empty
      if (this._satDate) return this._satDate;
      const tries = this._satTries || 0;
      const date = isoDay(tries);
      const z = 6;
      const c = project(this._view.lat, this._view.lon, z);
      const t = tile(LAYERS.satellite.url(z, Math.floor(c.y / 256), Math.floor(c.x / 256), date), again);
      if (!t.ok && !t.failed) return null;
      if (t.ok && hasData(t.img)) {
        this._satDate = date;
        this._satTries = 0;
        return date;
      }
      if (tries >= 3) {
        this._satDate = isoDay(1);
        this._satTries = 0;
        return this._satDate;
      }
      this._satTries = tries + 1;
      return this._satelliteDate(again);
    }

    _paintBase() {
      const g = this._canvas.getContext("2d");
      g.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      g.fillStyle = "#0b1622";
      g.fillRect(0, 0, this._w, this._h);
      const again = () => this._drawBase();
      const name = this._layerName();
      const layer = LAYERS[name];
      const date = name === "satellite" ? this._satelliteDate(again) : null;
      if (name === "satellite" && !date) {
        this._stamp("Loading satellite image…");
        return;
      }
      this._paintLayer(g, (z, y, x) => layer.url(z, y, x, date), layer.max, again);
      // the relief map ends at about 600 m per pixel: sharp coastlines on top when zoomed in close
      if (name === "satellite" || this._view.zoom > 8.6) this._paintLayer(g, COAST, 11, again, name === "satellite" ? 0.8 : 0.55);
      g.fillStyle = `rgba(4,3,3,${layer.dim})`;
      g.fillRect(0, 0, this._w, this._h);
      const when = date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
      this._stamp(name === "satellite" ? `VIIRS NOAA-20 · ${when} · NASA GIBS` : "Blue Marble · NASA GIBS");
    }

    _stamp(text) {
      const el = this._root.querySelector(".stamp");
      if (el && el.textContent !== text) el.textContent = text;
    }

    _paintLayer(g, url, maxLevel, again, alpha = 1) {
      const zoom = this._view.zoom;
      const level = clamp(Math.round(zoom), 1, maxLevel);
      const scale = 2 ** (zoom - level);
      const n = 2 ** level;
      const c = project(this._view.lat, this._view.lon, level);
      const size = 256 * scale;
      const x0 = c.x * scale - this._w / 2;
      const y0 = c.y * scale - this._h / 2;
      const tx0 = Math.floor(x0 / size);
      const ty0 = Math.floor(y0 / size);
      const tx1 = Math.floor((x0 + this._w) / size);
      const ty1 = Math.floor((y0 + this._h) / size);
      g.globalAlpha = alpha;
      g.imageSmoothingQuality = "high";
      for (let ty = ty0; ty <= ty1; ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = tx0; tx <= tx1; tx++) {
          const wx = ((tx % n) + n) % n;
          const dx = tx * size - x0;
          const dy = ty * size - y0;
          const t = tile(url(level, ty, wx), again);
          if (t.ok) {
            g.drawImage(t.img, dx, dy, size + 0.5, size + 0.5);
            continue;
          }
          // parent tile as a placeholder while loading
          for (let up = 1; up <= 3 && level - up >= 0; up++) {
            const f = 2 ** up;
            const p = tile(url(level - up, Math.floor(ty / f), Math.floor(wx / f)));
            if (!p.ok) continue;
            const sx = ((wx % f) * 256) / f;
            const sy = ((ty % f) * 256) / f;
            g.drawImage(p.img, sx, sy, 256 / f, 256 / f, dx, dy, size + 0.5, size + 0.5);
            break;
          }
        }
      }
      g.globalAlpha = 1;
    }

    /* ------------------------------------------------------------ animation */

    _loop() {
      if (this._raf || !this._fx) return;
      let last = 0;
      const step = (ts) => {
        this._raf = 0;
        if (!this.isConnected) return;
        // about 30 frames per second are enough
        if (ts - last >= 30 || this._fly) {
          last = ts;
          if (this._fly) {
            const f = this._fly;
            const e = clamp((ts - f.t0) / f.ms, 0, 1);
            const k = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2;
            this._view.lat = f.from.lat + (f.to.lat - f.from.lat) * k;
            this._view.lon = f.from.lon + (f.to.lon - f.from.lon) * k;
            this._view.zoom = f.from.zoom + (f.to.zoom - f.from.zoom) * k;
            this._paintBase();
            if (e >= 1) this._fly = null;
          }
          this._paintFx(ts);
        }
        if (this._visible !== false && !document.hidden) this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
    }

    flash(lat, lon) {
      if (!this._flashEl || !this._view) return;
      const q = this.toPx(lat, lon);
      this._flashEl.style.setProperty("--fx", `${(q.x / this._w) * 100}%`);
      this._flashEl.style.setProperty("--fy", `${(q.y / this._h) * 100}%`);
      this._flashEl.classList.remove("on");
      void this._flashEl.offsetWidth;
      this._flashEl.classList.add("on");
    }

    _paintFx(ts) {
      if (!this._view || !this._w) return;
      const g = this._fx.getContext("2d");
      g.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      g.clearRect(0, 0, this._w, this._h);
      const t = ts / 1000;
      this._hits = [];
      this._labels = [];

      // places
      for (const p of this._places || []) {
        const q = this.toPx(p.lat, p.lon);
        if (!this.onScreen(q, 40)) continue;
        g.beginPath();
        g.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
        g.fillStyle = "#7dd3c0";
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = "#0a1a22";
        g.stroke();
        this._labels.push({ x: q.x, y: q.y, text: p.name, color: "#9be5d3" });
        this._hits.push({ x: q.x, y: q.y, r: 10, place: p });
      }

      this.paintItems(g, t);

      // home: gold marker with a slow pulse
      const home = this.home();
      const hq = this.toPx(home.lat, home.lon);
      const hp = (t % 2.4) / 2.4;
      g.beginPath();
      g.arc(hq.x, hq.y, 6 + hp * 16, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,215,0,${0.55 * (1 - hp)})`;
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.arc(hq.x, hq.y, 5, 0, Math.PI * 2);
      g.fillStyle = "#ffd700";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = "#1a1203";
      g.stroke();
      this._labels.unshift({ x: hq.x, y: hq.y, text: this.homeName(), color: "#ffd700" });

      // labels skip each other
      g.font = "700 11px system-ui, sans-serif";
      const boxes = [];
      for (const l of this._labels) {
        const w = g.measureText(l.text).width;
        const options = [[l.x + 8, l.y - 7], [l.x - 8 - w, l.y - 7], [l.x - w / 2, l.y + 8], [l.x - w / 2, l.y - 22]];
        const spot = options.find(([bx, by]) => bx >= 2 && bx + w <= this._w - 2 && !boxes.some((b) => bx < b.x + b.w + 3 && bx + w + 3 > b.x && by < b.y + 14 && by + 14 > b.y));
        if (!spot) continue;
        boxes.push({ x: spot[0], y: spot[1], w });
        g.lineWidth = 3;
        g.strokeStyle = "rgba(5,8,12,.85)";
        g.strokeText(l.text, spot[0], spot[1] + 11);
        g.fillStyle = l.color;
        g.fillText(l.text, spot[0], spot[1] + 11);
      }

      // scale bar
      const ppk = this.pxPerKm();
      const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
      const km = nice.find((k) => k * ppk > 50) || 2000;
      const px = km * ppk;
      g.fillStyle = "rgba(255,255,255,.8)";
      g.fillRect(this._w - 12 - px, this._h - 24, px, 2);
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "right";
      g.fillText(`${km} km`, this._w - 12, this._h - 28);
      g.textAlign = "left";
    }

    /** an animated icon standing on its foot (y = 98 of 128 for the lightning marker) on a ring in its colour */
    drawIcon(g, name, x, y, size, col, t, seed, alpha = 1) {
      const ring = 1 + 0.08 * Math.sin(t * 4 + seed * 5);
      g.save();
      g.globalAlpha = alpha;
      g.beginPath();
      g.ellipse(x, y, size * 0.42 * ring, size * 0.14 * ring, 0, 0, Math.PI * 2);
      g.lineWidth = 2;
      g.strokeStyle = rgb(col, 0.95);
      g.shadowColor = rgb(col, 0.9);
      g.shadowBlur = 8;
      g.stroke();
      g.shadowBlur = 0;
      const img = image(name);
      if (img.complete && img.naturalWidth) {
        const foot = { lightning: 98 }[name] || 115;
        g.drawImage(img, x - size / 2, y - size * (foot / 128), size, size);
      }
      g.restore();
    }

    /** an item marker is drawn only where no other icon stands */
    placeIcons(items, max, size) {
      const placed = [];
      for (const it of items) {
        if (placed.length >= max) break;
        if (placed.some((p) => Math.hypot(p.q.x - it.q.x, p.q.y - it.q.y) < size * 0.8)) continue;
        placed.push(it);
      }
      return placed;
    }

    /* ------------------------------------------------------------ popups */

    _tap(x, y) {
      let best = null;
      for (const h of this._hits || []) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= h.r && (!best || d < best.d || (h.item && !best.h.item))) best = { h, d };
      }
      if (!best) {
        this._closePop();
        return;
      }
      if (best.h.place) {
        const p = best.h.place;
        this.flyToKm(p.lat, p.lon, p.r * 1.3);
        return;
      }
      this.showPop(best.h.item, best.h.x, best.h.y);
    }

    _closePop() {
      this._root?.querySelector(".pop")?.remove();
    }

    showPop(item, x, y) {
      this._closePop();
      const el = document.createElement("div");
      el.className = "pop";
      el.innerHTML = `<span class="x">×</span>${this.popupHtml(item)}`;
      this._mapEl.appendChild(el);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      el.style.left = `${clamp(x - w / 2, 6, this._w - w - 6)}px`;
      const top = y - h - 14 >= 4 ? y - h - 14 : y + 14 + h <= this._h - 4 ? y + 14 : 4;
      el.style.top = `${top}px`;
      el.querySelector(".x").addEventListener("click", () => el.remove());
    }

    /** fly to an item and open its popup */
    focusItem(item, zoom = 9) {
      this._flyTo(item.lat, item.lon, Math.max(this._view.zoom, zoom), 600);
      setTimeout(() => {
        const q = this.toPx(item.lat, item.lon);
        this.showPop(item, q.x, q.y);
      }, 650);
    }

    time(ms) {
      const tz = this._hass?.config?.time_zone;
      try {
        return new Date(ms).toLocaleString(this._hass?.locale?.language || undefined, { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" });
      } catch (_e) {
        return new Date(ms).toLocaleString();
      }
    }

    /* ------------------------------------------------------------ text */

    _renderBody() {
      if (!this._root) return;
      const wrap = this._root.querySelector(".wrap");
      if (!wrap) return;
      const top = {
        sub: this._root.querySelector(".top .s"),
        hint: this._root.querySelector(".top .h"),
        big: this._root.querySelector(".big b"),
        bigLabel: this._root.querySelector(".big span"),
        icon: this._root.querySelector(".top img"),
      };
      if (this.usesPayload && this._error && !this._data) {
        wrap.innerHTML = `<div class="msg">${this._error === "loading" ? "Loading…" : `Could not load the data (${esc(this._error)}).`}</div>`;
        return;
      }
      if (this.usesPayload && !this._data) return;
      const off = this.disabledText();
      if (off) {
        wrap.innerHTML = `<div class="msg">${off}</div>`;
        top.sub.textContent = "Not configured";
        return;
      }
      wrap.innerHTML = this.renderText(top);
      wrap.querySelectorAll(".tile[data-lat]").forEach((el) => el.addEventListener("click", () => {
        this.flyToKm(Number(el.dataset.lat), Number(el.dataset.lon), Number(el.dataset.r) * 1.3);
      }));
      wrap.querySelectorAll(".row[data-i]").forEach((el) => el.addEventListener("click", () => {
        const item = (this._rows || [])[Number(el.dataset.i)];
        if (item) this.focusItem(item, this.focusZoom ?? 9);
      }));
    }

    tile(k, v, s, opts = {}) {
      const data = opts.place ? ` data-lat="${opts.place.lat}" data-lon="${opts.place.lon}" data-r="${opts.place.r}"` : "";
      return `<div class="tile ${opts.hot ? "hot" : ""}"${data}><div class="k">${esc(k)}</div>
        <div class="v" style="color:${opts.color || "#f3f1ee"}">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    }
  }

  /* ============================================================ lightning */

  class SeaStateLightningCard extends SeaStateMapCard {
    static getStubConfig() {
      return { title: "Lightning Watch" };
    }

    get kind() { return "lightning"; }
    get usesPayload() { return false; }
    get focusZoom() { return 10; }
    defaults() { return { title: "Lightning Watch", radius_km: 100, minutes: 120 }; }
    defaultViews() {
      const r = Number(this._config?.radius_km) || 100;
      return [{ name: "Near", radius_km: Math.round(r * 0.3) }, { name: "Radar", radius_km: Math.round(r * 1.08) }, { name: "Region", radius_km: r * 3 }];
    }
    theme() {
      return { "--mf-bg1": "#0d1330", "--mf-accent": "#60a5fa", "--mf-glow": "rgba(96,165,250,.55)", "--mf-link": "#93c5fd", "--mf-title": "#ffd700",
        "--mf-hot": "rgba(253,224,71,.6)", "--mf-hotbg": "rgba(253,224,71,.1)" };
    }
    legend() {
      return `<span><i style="background:#fff"></i>&lt;5 min</span><span><i style="background:#fde047"></i>15</span>
        <span><i style="background:#fb923c"></i>45</span><span><i style="background:#dc2626"></i>older</span>`;
    }

    home() {
      const c = this._config.center;
      if (Array.isArray(c) && c.length === 2) return { lat: Number(c[0]), lon: Number(c[1]) };
      const cfg = this._hass?.config;
      return { lat: cfg?.latitude ?? 0, lon: cfg?.longitude ?? 0 };
    }

    _strikeStates(hass) {
      const want = this._config.entities;
      const out = [];
      if (Array.isArray(want) && want.length) {
        for (const id of want) if (hass.states[id]) out.push(hass.states[id]);
        return out;
      }
      for (const id in hass.states) {
        if (!id.startsWith("geo_location.")) continue;
        const st = hass.states[id];
        if (String(st.attributes.source || "").toLowerCase() === (this._config.source || "blitzortung")) out.push(st);
      }
      return out;
    }

    hassChanged(hass) {
      const strikes = this._strikeStates(hass);
      const sig = strikes.map((s) => s.entity_id).sort().join(",");
      const sensors = ["distance_entity", "counter_entity"].map((k) => this._config[k] && hass.states[this._config[k]]);
      const changed = sig !== this._sig || sensors.some((s, i) => s !== (this._sensorStates || [])[i]) || super.hassChanged(hass);
      this._sig = sig;
      this._sensorStates = sensors;
      return changed;
    }

    prepare() {
      const home = this.home();
      const maxAge = (Number(this._config.minutes) || 120) * 60000;
      const prev = new Set((this._items || []).map((s) => s.id));
      this._items = this._strikeStates(this._hass)
        .map((st) => {
          const a = st.attributes;
          const lat = Number(a.latitude);
          const lon = Number(a.longitude);
          const ms = Date.parse(a.publication_date || a.time || st.last_changed);
          return { id: st.entity_id, lat, lon, ms, km: haversine(home.lat, home.lon, lat, lon), brg: bearing(home.lat, home.lon, lat, lon) };
        })
        .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Date.now() - s.ms <= maxAge)
        .sort((a, b) => b.ms - a.ms);
      // a new strike lights up the map
      const fresh = this._items.find((s) => !prev.has(s.id) && Date.now() - s.ms < 5 * 60000);
      if (fresh && prev.size) this.flash(fresh.lat, fresh.lon);
    }

    paintItems(g, t) {
      const home = this.home();
      const hq = this.toPx(home.lat, home.lon);
      const ppk = this.pxPerKm();
      const r = Number(this._config.radius_km) || 100;
      // radar: range rings and a slow sweep around home
      const rings = [10, 25, 50, 100, 200].filter((k) => k <= r * 1.01);
      g.save();
      for (const k of rings) {
        g.beginPath();
        g.arc(hq.x, hq.y, k * ppk, 0, Math.PI * 2);
        g.strokeStyle = k === rings[rings.length - 1] ? "rgba(96,165,250,.55)" : "rgba(96,165,250,.25)";
        g.setLineDash(k === rings[rings.length - 1] ? [] : [4, 5]);
        g.lineWidth = 1;
        g.stroke();
        if (k * ppk > 22) {
          g.font = "600 9.5px system-ui, sans-serif";
          g.fillStyle = "rgba(191,219,254,.75)";
          g.fillText(`${k} km`, hq.x + 3, hq.y - k * ppk + 11);
        }
      }
      g.setLineDash([]);
      const R = r * ppk;
      const a = (t * 0.9) % (Math.PI * 2);
      if (typeof g.createConicGradient === "function") {
        const cg = g.createConicGradient(a - 0.9, hq.x, hq.y);
        cg.addColorStop(0, "rgba(96,165,250,0)");
        cg.addColorStop(0.14, "rgba(96,165,250,.16)");
        cg.addColorStop(0.145, "rgba(147,197,253,.5)");
        cg.addColorStop(0.15, "rgba(96,165,250,0)");
        cg.addColorStop(1, "rgba(96,165,250,0)");
        g.fillStyle = cg;
        g.beginPath();
        g.arc(hq.x, hq.y, R, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();

      const icons = [];
      // oldest first, the newest on top
      for (const s of [...(this._items || [])].reverse()) {
        const q = this.toPx(s.lat, s.lon);
        if (!this.onScreen(q)) continue;
        const min = (Date.now() - s.ms) / 60000;
        const col = strikeColor(min);
        const fade = clamp(1 - min / ((Number(this._config.minutes) || 120) * 1.15), 0.25, 1);
        if (min < 10) {
          // shock wave of a fresh strike
          const k = (((t * 0.8 + s.lat * 3) % 1) + 1) % 1;
          g.beginPath();
          g.arc(q.x, q.y, 4 + k * 22, 0, Math.PI * 2);
          g.strokeStyle = `rgba(147,197,253,${(1 - k) * 0.85})`;
          g.lineWidth = 1.6;
          g.stroke();
        }
        const rad = min < 5 ? 9 : min < 15 ? 7 : 5;
        const grd = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, rad * 2);
        grd.addColorStop(0, rgb(col, 0.95 * fade));
        grd.addColorStop(0.4, rgb(min < 5 ? [147, 197, 253] : col, 0.45 * fade));
        grd.addColorStop(1, rgb(col, 0));
        g.fillStyle = grd;
        g.beginPath();
        g.arc(q.x, q.y, rad * 2, 0, Math.PI * 2);
        g.fill();
        // a small cross like a strike symbol
        g.strokeStyle = rgb(col, fade);
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(q.x - 3, q.y - 3);
        g.lineTo(q.x + 3, q.y + 3);
        g.moveTo(q.x + 3, q.y - 3);
        g.lineTo(q.x - 3, q.y + 3);
        g.stroke();
        this._hits.push({ x: q.x, y: q.y, r: 12, item: s });
        if (min < 30) icons.push({ s, q, min });
      }
      // the bolt for the newest strikes
      const size = clamp(26 + this._view.zoom * 1.2, 30, 44);
      icons.sort((x, y) => x.min - y.min);
      for (const it of this.placeIcons(icons, 3, size)) {
        const flick = it.min < 5 ? (Math.sin(t * 23 + it.s.lon * 7) > -0.3 ? 1 : 0.35) : 0.85;
        this.drawIcon(g, "lightning", it.q.x, it.q.y, size, strikeColor(it.min), t, it.s.lat, flick);
      }
    }

    popupHtml(s) {
      const min = (Date.now() - s.ms) / 60000;
      const near = this.nearPlace(s.lat, s.lon);
      return `<b style="color:${hex(strikeColor(min))}">⚡ Lightning strike</b>
        <div>${kmText(s.km)} km ${compass(s.brg)} of ${esc(this.homeName())}${near ? `<br>${Math.round(near.d)} km from ${esc(near.p.name)}` : ""}</div>
        <div class="m">${esc(this.time(s.ms))} (${ago(s.ms)})</div>
        <div class="m">Blitzortung.org community network</div>`;
    }

    _trend() {
      // average distance of the last 15 minutes against the 15 to 45 minutes before
      const now = Date.now();
      const a = (this._items || []).filter((s) => now - s.ms <= 15 * 60000);
      const b = (this._items || []).filter((s) => now - s.ms > 15 * 60000 && now - s.ms <= 45 * 60000);
      if (a.length < 2 || b.length < 2) return null;
      const avg = (l) => l.reduce((x, s) => x + s.km, 0) / l.length;
      const d = avg(a) - avg(b);
      if (d < -5) return { text: "Nearing", sub: `${Math.round(-d)} km closer`, color: "#f97316" };
      if (d > 5) return { text: "Moving away", sub: `${Math.round(d)} km further`, color: "#7dd3c0" };
      return { text: "Steady", sub: "same distance", color: "#fde047" };
    }

    renderText(top) {
      const items = this._items || [];
      this._rows = items;
      const now = Date.now();
      const hour = items.filter((s) => now - s.ms <= 3600000);
      const ten = items.filter((s) => now - s.ms <= 600000);
      const near = items.reduce((m, s) => (!m || s.km < m.km ? s : m), null);
      const newest = items[0];
      const r = Number(this._config.radius_km) || 100;
      const dist = this._config.distance_entity && this._hass.states[this._config.distance_entity];
      const col = !near ? "#7dd3c0" : near.km <= 10 ? "#ff3b3b" : near.km <= 25 ? "#f97316" : near.km <= 50 ? "#fde047" : "#93c5fd";
      top.big.textContent = String(hour.length);
      top.big.style.color = hour.length ? col : "#7dd3c0";
      top.bigLabel.textContent = "strikes 1 h";
      top.icon.classList.toggle("calm", !ten.length);
      top.sub.style.color = col;
      top.sub.textContent = newest
        ? `Nearest ${kmText(near.km)} km ${compass(near.brg)} · last ${ago(newest.ms)}`
        : `No lightning within ${r} km`;
      const tr = this._trend();
      top.hint.textContent = newest
        ? `${tr ? `${tr.text === "Nearing" ? "Storm approaching" : tr.text === "Moving away" ? "Storm moving away" : "Storm steady"} · ` : ""}${items.length} strike${items.length === 1 ? "" : "s"} in ${Math.round((Number(this._config.minutes) || 120) / 60)} h`
        : `Blitzortung.org live network · ${dist && Number.isFinite(Number(dist.state)) ? `last strike ${dist.state} km` : "all quiet"}`;

      const tiles = [];
      tiles.push(this.tile("Last 10 min", String(ten.length), ten.length ? "storm active" : "quiet", { color: ten.length ? "#fde047" : "#7dd3c0", hot: ten.length > 0 }));
      tiles.push(this.tile("Last hour", String(hour.length), `within ${r} km`, { color: hour.length ? "#93c5fd" : "#7dd3c0" }));
      tiles.push(this.tile("Nearest", near ? `${kmText(near.km)} km` : "–", near ? `${compass(near.brg)} · ${ago(near.ms)}` : "no strikes", { color: col, hot: !!near && near.km <= 25 }));
      tiles.push(this.tile("Storm", tr ? tr.text : newest ? "Scattered" : "None", tr ? tr.sub : newest ? "too few strikes" : `radius ${r} km`, { color: tr ? tr.color : "#7dd3c0", hot: !!tr && tr.text === "Nearing" }));
      for (const p of this._places || []) {
        const inside = hour.filter((s) => haversine(p.lat, p.lon, s.lat, s.lon) <= p.r);
        tiles.push(this.tile(p.name, inside.length ? `${inside.length} strike${inside.length === 1 ? "" : "s"}` : "Clear", inside.length ? "last hour" : `within ${p.r} km`,
          { place: p, hot: inside.length > 0, color: inside.length ? "#fde047" : "#7dd3c0" }));
      }
      let html = `<div class="tiles">${tiles.join("")}</div>`;
      const n = Number(this._config.list) || 0;
      if (n > 0) {
        html += items.length
          ? `<div class="list">${items.slice(0, n).map((s, i) => {
            const c = hex(strikeColor((now - s.ms) / 60000));
            const pl = this.nearPlace(s.lat, s.lon);
            return `<div class="row" data-i="${i}"><span class="dot" style="background:${c};box-shadow:0 0 8px ${c}"></span>
              <span class="main"><b>${kmText(s.km)} km ${compass(s.brg)}</b>${pl ? ` · ${esc(pl.p.name)}` : ""}</span><span class="tm">${ago(s.ms)}</span></div>`;
          }).join("")}</div>`
          : `<div class="none">🌤 No lightning within ${r} km in the last ${Math.round((Number(this._config.minutes) || 120) / 60)} hours.</div>`;
      }
      html += `<div class="foot"><span>Strikes: <a href="https://www.blitzortung.org" target="_blank" rel="noopener">Blitzortung.org</a> via Home Assistant</span></div>`;
      return html;
    }
  }

  if (!customElements.get("sea-state-lightning-card")) {
    customElements.define("sea-state-lightning-card", SeaStateLightningCard);
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: "sea-state-lightning-card",
      name: "Sea State lightning",
      description: "Live lightning strikes around your home on a radar map with storm trend (Blitzortung integration).",
      preview: false,
      documentationURL: "https://github.com/mb26-dev/ha-sea-state",
    });
  }
}

defineLightningCard();
