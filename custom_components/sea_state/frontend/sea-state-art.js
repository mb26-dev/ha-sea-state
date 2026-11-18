/*
 * Sea State Forecast artwork: surfers, waves, clouds, rain, lightning and cyclones,
 * all drawn with plain canvas paths (original artwork, no images).
 */

export const CONDITION_COLORS = {
  flat: "#8fa3b3",
  poor: "#5c8fe0",
  fair: "#35c4c9",
  good: "#3fd47c",
  epic: "#ffcf3a",
  blown_out: "#d39a62",
  too_big: "#ff5c5c",
};
export const CONDITION_LABELS = {
  flat: "Flat",
  poor: "Poor",
  fair: "Fair",
  good: "Good",
  epic: "Epic",
  blown_out: "Blown out",
  too_big: "Too big",
};
export const CATEGORY_COLORS = ["#5fd4ff", "#ffe14a", "#ffb03a", "#ff7a2e", "#ff3d3d", "#d13cff"];

export function rgba(hex, a) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function stars(rating) {
  const r = Math.max(0, Math.min(5, Math.round((rating || 0) * 2) / 2));
  let out = "";
  for (let i = 1; i <= 5; i++) out += r >= i ? "★" : r >= i - 0.5 ? "⯪" : "☆";
  return out;
}

const SKIN = "#e9c29c";
const SUIT = "#13161c";

function board(ctx, x, y, len, ang, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.quadraticCurveTo(-len / 2 + len * 0.1, -len * 0.13, 0, -len * 0.13);
  ctx.quadraticCurveTo(len / 2 - len * 0.05, -len * 0.12, len / 2, 0);
  ctx.quadraticCurveTo(len / 2 - len * 0.05, len * 0.1, 0, len * 0.1);
  ctx.quadraticCurveTo(-len / 2 + len * 0.1, len * 0.1, -len / 2, 0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = Math.max(0.6, len * 0.035);
  ctx.stroke();
  // stringer
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = Math.max(0.4, len * 0.02);
  ctx.beginPath();
  ctx.moveTo(-len * 0.42, 0);
  ctx.lineTo(len * 0.42, 0);
  ctx.stroke();
  ctx.restore();
}

function limb(ctx, pts, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.stroke();
}

function head(ctx, x, y, r) {
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a2a1c";
  ctx.beginPath();
  ctx.arc(x, y - r * 0.25, r, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
}

function waterLine(ctx, x, y, s, t, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.8, s * 0.09);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let k = -1.6; k <= 1.6001; k += 0.2) {
    const px = x + k * s;
    const py = y + Math.sin(k * 3.2 + t * 2.4) * s * 0.07;
    if (k === -1.6) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function waveFace(ctx, x, y, s, t, big, night) {
  const k = big ? 1.35 : 1;
  const sway = Math.sin(t * 1.3) * s * 0.06;
  const g = ctx.createLinearGradient(x, y - 2.2 * s * k, x, y + 0.8 * s);
  g.addColorStop(0, night ? "#1d5a78" : "#3fc6d8");
  g.addColorStop(0.55, night ? "#123c5e" : "#1a7fb6");
  g.addColorStop(1, night ? "#0b2440" : "#0d4f86");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - 2.4 * s, y + 0.75 * s);
  ctx.quadraticCurveTo(x - 0.7 * s, y + 0.55 * s, x + 0.35 * s + sway, y - 1.25 * s * k);
  ctx.quadraticCurveTo(x + 0.95 * s + sway, y - 2.15 * s * k, x + 1.75 * s + sway, y - 1.45 * s * k);
  ctx.quadraticCurveTo(x + 1.15 * s + sway, y - 1.35 * s * k, x + 1.25 * s + sway, y - 0.7 * s * k);
  ctx.quadraticCurveTo(x + 1.6 * s, y + 0.2 * s, x + 2.4 * s, y + 0.75 * s);
  ctx.closePath();
  ctx.fill();
  // white lip and foam
  ctx.strokeStyle = night ? "rgba(220,235,245,0.75)" : "rgba(255,255,255,0.95)";
  ctx.lineWidth = Math.max(1, s * 0.16);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + 0.2 * s + sway, y - 1.05 * s * k);
  ctx.quadraticCurveTo(x + 0.95 * s + sway, y - 2.15 * s * k, x + 1.75 * s + sway, y - 1.45 * s * k);
  ctx.stroke();
  ctx.fillStyle = night ? "rgba(220,235,245,0.6)" : "rgba(255,255,255,0.85)";
  for (let i = 0; i < 6; i++) {
    const a = t * 2 + i * 1.7;
    const px = x + 1.3 * s + Math.cos(a) * 0.5 * s + i * 0.12 * s;
    const py = y + 0.55 * s + Math.sin(a * 1.3) * 0.12 * s;
    ctx.beginPath();
    ctx.arc(px, py, s * (0.09 + 0.04 * Math.sin(a)), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A small surfer at (x, y) (y = water line), unit size s (about 1/10 of the icon height).
 * pose: sitting, paddling, riding, barrel, windy, flag
 */
export function drawSurfer(ctx, x, y, s, pose, t, opts = {}) {
  const color = opts.color || "#ffcf3a";
  const night = opts.night || 0;
  const alpha = opts.alpha == null ? 1 : opts.alpha;
  const seed = opts.seed || 0;
  const tt = t + seed;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (opts.selected) {
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.6, s * 3.0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // glow ring in the colour of the condition
  const glow = ctx.createRadialGradient(x, y - s * 0.4, 0, x, y - s * 0.4, s * 3.2);
  glow.addColorStop(0, rgba(color, 0.35));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.4, s * 3.2, 0, Math.PI * 2);
  ctx.fill();
  const water = night > 0.5 ? "rgba(170,210,235,0.7)" : "rgba(235,250,255,0.9)";
  const bw = Math.max(0.9, s * 0.22);

  if (pose === "riding" || pose === "barrel") {
    const barrel = pose === "barrel";
    waveFace(ctx, x, y, s, tt, barrel, night > 0.5);
    const sx = x - 0.35 * s + Math.sin(tt * 1.6) * s * 0.25;
    const sy = y - 0.35 * s - (barrel ? 0.25 * s : 0);
    const crouch = barrel ? 0.75 : 1;
    board(ctx, sx, sy, s * 2.0, -0.38, color);
    // legs
    limb(ctx, [[sx - 0.45 * s, sy - 0.05 * s], [sx - 0.25 * s, sy - 0.65 * s * crouch], [sx - 0.05 * s, sy - 1.05 * s * crouch]], bw, SUIT);
    limb(ctx, [[sx + 0.4 * s, sy - 0.3 * s], [sx + 0.3 * s, sy - 0.8 * s * crouch], [sx - 0.05 * s, sy - 1.05 * s * crouch]], bw, SUIT);
    // torso
    limb(ctx, [[sx - 0.05 * s, sy - 1.05 * s * crouch], [sx + 0.05 * s, sy - 1.75 * s * crouch]], bw * 1.15, SUIT);
    // arms out for balance
    const arm = Math.sin(tt * 2.2) * 0.12 * s;
    limb(ctx, [[sx + 0.05 * s, sy - 1.6 * s * crouch], [sx - 0.55 * s, sy - 1.45 * s * crouch + arm], [sx - 0.95 * s, sy - 1.6 * s * crouch + arm]], bw * 0.8, SUIT);
    limb(ctx, [[sx + 0.05 * s, sy - 1.6 * s * crouch], [sx + 0.6 * s, sy - 1.7 * s * crouch - arm], [sx + 1.0 * s, sy - 1.5 * s * crouch - arm]], bw * 0.8, SUIT);
    head(ctx, sx + 0.1 * s, sy - 2.05 * s * crouch, s * 0.28);
    if (barrel) {
      // the lip throwing over the surfer
      ctx.strokeStyle = night > 0.5 ? "rgba(200,225,240,0.6)" : "rgba(255,255,255,0.75)";
      ctx.lineWidth = Math.max(1, s * 0.22);
      ctx.beginPath();
      ctx.arc(x + 0.4 * s, y - 0.9 * s, 1.9 * s, Math.PI * 1.08, Math.PI * 1.62);
      ctx.stroke();
      // spit
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let i = 0; i < 5; i++) {
        const a = (tt * 3 + i * 0.9) % 2;
        ctx.beginPath();
        ctx.arc(x - 1.6 * s - a * s, y - 0.4 * s - i * 0.15 * s, s * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pose === "paddling") {
    const bob = Math.sin(tt * 2) * s * 0.1;
    board(ctx, x, y - 0.1 * s + bob, s * 2.1, 0, color);
    // lying on the board
    limb(ctx, [[x - 0.85 * s, y - 0.32 * s + bob], [x + 0.35 * s, y - 0.42 * s + bob]], bw * 1.2, SUIT);
    head(ctx, x + 0.6 * s, y - 0.62 * s + bob, s * 0.26);
    const stroke = tt * 4;
    for (const off of [0, Math.PI]) {
      const a = stroke + off;
      limb(ctx, [[x + 0.2 * s, y - 0.4 * s + bob], [x + 0.2 * s + Math.cos(a) * 0.55 * s, y - 0.1 * s + Math.max(0, Math.sin(a)) * 0.45 * s + bob]], bw * 0.8, SUIT);
    }
    waterLine(ctx, x, y + 0.05 * s, s, tt, water);
  } else if (pose === "flag") {
    // too big: a warning flag on the beach and a towering wave
    waveFace(ctx, x + 0.4 * s, y, s * 1.1, tt, true, night > 0.5);
    ctx.strokeStyle = "#dcdcdc";
    ctx.lineWidth = Math.max(0.8, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(x - 1.4 * s, y + 0.6 * s);
    ctx.lineTo(x - 1.4 * s, y - 2.3 * s);
    ctx.stroke();
    const flap = Math.sin(tt * 6) * 0.2 * s;
    ctx.fillStyle = "#ff3b30";
    ctx.beginPath();
    ctx.moveTo(x - 1.4 * s, y - 2.3 * s);
    ctx.quadraticCurveTo(x - 0.8 * s, y - 2.1 * s + flap, x - 0.3 * s, y - 1.95 * s + flap);
    ctx.lineTo(x - 1.4 * s, y - 1.5 * s);
    ctx.closePath();
    ctx.fill();
  } else {
    // sitting (flat) or sitting in the wind (blown out)
    const windy = pose === "windy";
    const bob = Math.sin(tt * (windy ? 3.2 : 1.6)) * s * (windy ? 0.16 : 0.1);
    board(ctx, x, y - 0.1 * s + bob, s * 2.1, windy ? Math.sin(tt * 3) * 0.12 : 0, color);
    limb(ctx, [[x - 0.05 * s, y - 0.2 * s + bob], [x + 0.3 * s, y + 0.25 * s + bob], [x + 0.25 * s, y + 0.6 * s + bob]], bw, SUIT);
    limb(ctx, [[x - 0.05 * s, y - 0.2 * s + bob], [x - 0.05 * s, y - 1.0 * s + bob]], bw * 1.15, SUIT);
    limb(ctx, [[x - 0.05 * s, y - 0.85 * s + bob], [x + 0.35 * s, y - 0.5 * s + bob], [x + 0.55 * s, y - 0.25 * s + bob]], bw * 0.8, SUIT);
    head(ctx, x - 0.02 * s, y - 1.32 * s + bob, s * 0.27);
    waterLine(ctx, x, y + 0.05 * s, s, tt, water);
    if (windy) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = Math.max(0.6, s * 0.08);
      for (let i = 0; i < 4; i++) {
        const ph = (tt * 1.6 + i * 0.27) % 1;
        const yy = y - (0.6 + i * 0.45) * s;
        const xx = x - 2.2 * s + ph * 4.4 * s;
        ctx.globalAlpha = alpha * Math.sin(ph * Math.PI);
        ctx.beginPath();
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx + 0.9 * s, yy);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
    }
  }
  ctx.restore();
}

/** small spot marker for far zoom levels */
export function drawSpotDot(ctx, x, y, r, color, alpha, pulse, t) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (pulse) {
    const k = (t * 0.7) % 1;
    ctx.strokeStyle = rgba(color, (1 - k) * 0.8);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r + k * r * 3.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(6,10,18,0.8)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** soft cloud sprite, rendered once per kind */
const SPRITES = new Map();
export function cloudSprite(kind) {
  if (SPRITES.has(kind)) return SPRITES.get(kind);
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const tone = kind === "storm" ? [92, 98, 112] : kind === "rain" ? [168, 176, 190] : [252, 253, 255];
  let seed = kind === "storm" ? 7 : kind === "rain" ? 3 : 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // many small soft blobs along an elongated band give a natural, irregular cloud
  const blobs = kind === "storm" ? 34 : 26;
  for (let i = 0; i < blobs; i++) {
    const u = rnd() * 2 - 1;
    const x = size / 2 + u * size * 0.34;
    const y = size / 2 + (rnd() - 0.5) * size * 0.22 * (1 - Math.abs(u) * 0.6);
    const r = size * (0.07 + rnd() * 0.12) * (1 - Math.abs(u) * 0.45);
    const g = ctx.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
    const shade = 0.82 + rnd() * 0.18;
    g.addColorStop(0, `rgba(${Math.round(tone[0] * shade)},${Math.round(tone[1] * shade)},${Math.round(tone[2] * shade)},0.42)`);
    g.addColorStop(0.55, `rgba(${tone[0]},${tone[1]},${tone[2]},0.16)`);
    g.addColorStop(1, `rgba(${tone[0]},${tone[1]},${tone[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  SPRITES.set(kind, c);
  return c;
}

/** a forked lightning bolt from (x, y) downward */
export function drawLightning(ctx, x, y, len, seed, alpha) {
  let s = Math.floor(seed * 1e6) % 2147483647 || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(255,255,230,0.95)";
  ctx.shadowColor = "rgba(190,210,255,0.9)";
  ctx.shadowBlur = 8;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  let px = x, py = y;
  ctx.moveTo(px, py);
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    px += (rnd() - 0.5) * len * 0.35;
    py += len / steps;
    ctx.lineTo(px, py);
    if (i === 2) {
      ctx.moveTo(px, py);
      ctx.lineTo(px + (rnd() - 0.2) * len * 0.4, py + len * 0.25);
      ctx.moveTo(px, py);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Tropical cyclone: rotating spiral cloud bands around a clear eye.
 * spin: +1 counter clockwise (northern hemisphere), -1 clockwise (southern)
 */
export function drawCyclone(ctx, x, y, r, t, spin, cat, alpha, night, selected) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  const rot = -spin * t * (0.25 + cat * 0.06);
  ctx.rotate(rot);
  const arms = 4;
  const base = night > 0.5 ? [160, 170, 190] : [245, 248, 252];
  // soft body
  const body = ctx.createRadialGradient(0, 0, r * 0.08, 0, 0, r);
  body.addColorStop(0, `rgba(${base[0]},${base[1]},${base[2]},0.05)`);
  body.addColorStop(0.18, `rgba(${base[0]},${base[1]},${base[2]},0.75)`);
  body.addColorStop(0.55, `rgba(${base[0]},${base[1]},${base[2]},0.35)`);
  body.addColorStop(1, `rgba(${base[0]},${base[1]},${base[2]},0)`);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // spiral bands
  ctx.lineCap = "round";
  for (let a = 0; a < arms; a++) {
    const off = (a / arms) * Math.PI * 2;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass
        ? `rgba(255,255,255,${0.55 - 0.05 * a})`
        : `rgba(${base[0] - 40},${base[1] - 40},${base[2] - 30},0.35)`;
      ctx.lineWidth = pass ? Math.max(1, r * 0.06) : Math.max(2, r * 0.14);
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        const u = k / 40;
        const rr = r * (0.16 + u * 0.88);
        const th = off + spin * u * 3.4;
        const px = Math.cos(th) * rr;
        const py = -Math.sin(th) * rr;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.rotate(-rot);
  // eye wall and eye
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(10,30,60,0.55)";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.085, 0, Math.PI * 2);
  ctx.fill();
  // category ring
  const col = CATEGORY_COLORS[Math.max(0, Math.min(5, cat))];
  ctx.strokeStyle = rgba(col, selected ? 1 : 0.85);
  ctx.lineWidth = selected ? 2.4 : 1.6;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -t * 8;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
