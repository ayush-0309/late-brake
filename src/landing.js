// Landing page: circuit cards and a car lapping a circuit behind the hero.

import { TRACKS } from './track.js';
import { CIRCUITS } from './circuits.js';
import { initAnalytics } from './analytics.js';

initAnalytics();

const dpr = Math.min(window.devicePixelRatio || 1, 2);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function bounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

// Scale and offset that fit the points into a w×h box (device pixels).
function fit(pts, w, h, pad) {
  const b = bounds(pts);
  const sc = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxY - b.minY));
  return {
    sc,
    ox: (w - (b.maxX - b.minX) * sc) / 2 - b.minX * sc,
    oy: (h - (b.maxY - b.minY) * sc) / 2 - b.minY * sc,
  };
}

function outline(ctx, pts) {
  ctx.beginPath();
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.closePath();
}

// ---------- circuit cards ----------

const list = document.getElementById('circuits');
for (const t of TRACKS) {
  const info = CIRCUITS.find((c) => c.id === t.id);
  const a = document.createElement('a');
  a.className = 'circuit';
  a.href = `play.html?track=${encodeURIComponent(t.id)}`;
  a.innerHTML = `<canvas aria-hidden="true"></canvas><div><b>${t.name}</b><small>${t.country} · ${(info.length / 1000).toFixed(3)} km</small></div>`;
  list.appendChild(a);
  const c = a.querySelector('canvas');
  c.width = 96 * dpr; c.height = 72 * dpr;
  const ctx = c.getContext('2d');
  const f = fit(t.points, c.width, c.height, 6 * dpr);
  ctx.setTransform(f.sc, 0, 0, f.sc, f.ox, f.oy);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = (2.5 * dpr) / f.sc;
  outline(ctx, t.points);
  ctx.stroke();
  ctx.fillStyle = '#e8112d';
  ctx.beginPath();
  ctx.arc(t.points[0][0], t.points[0][1], (3.5 * dpr) / f.sc, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- hero ----------

const hero = document.getElementById('heroTrack');
const hctx = hero.getContext('2d');
const track = TRACKS[Math.floor(Math.random() * TRACKS.length)];
const pts = track.points;
const cum = [0];
for (let i = 1; i <= pts.length; i++) {
  const a = pts[i - 1], b = pts[i % pts.length];
  cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
}
const total = cum[pts.length];

function at(s) {
  s = ((s % total) + total) % total;
  let lo = 0, hi = pts.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[(lo + 1) % pts.length];
  const u = (s - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

let view = null;
function layout() {
  const w = hero.clientWidth, h = hero.clientHeight;
  hero.width = Math.round(w * dpr);
  hero.height = Math.round(h * dpr);
  // Sit the circuit to the right on wide screens, behind the text on narrow ones.
  const wide = w > 820;
  const bw = (wide ? w * 0.6 : w) * dpr, bh = h * dpr;
  const f = fit(pts, bw, bh, 48 * dpr);
  view = { ...f, ox: f.ox + (wide ? w * 0.4 * dpr : 0) };
}
addEventListener('resize', layout);
layout();

const SPEED = 75; // m/s, a quick lap
let s = 0, last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  s += SPEED * dt;
  const { sc, ox, oy } = view;
  hctx.setTransform(1, 0, 0, 1, 0, 0);
  hctx.clearRect(0, 0, hero.width, hero.height);
  hctx.setTransform(sc, 0, 0, sc, ox, oy);
  hctx.lineJoin = 'round';
  hctx.lineCap = 'round';
  outline(hctx, pts);
  hctx.strokeStyle = 'rgba(255,255,255,0.08)';
  hctx.lineWidth = (14 * dpr) / sc;
  hctx.stroke();
  hctx.strokeStyle = 'rgba(255,255,255,0.22)';
  hctx.lineWidth = (2 * dpr) / sc;
  hctx.stroke();

  if (!reduced) {
    // A fading red trail behind the car.
    const trail = 500, steps = 40;
    for (let k = 0; k < steps; k++) {
      const p0 = at(s - (trail * k) / steps), p1 = at(s - (trail * (k + 1)) / steps);
      hctx.strokeStyle = `rgba(232,17,45,${(1 - k / steps) * 0.9})`;
      hctx.lineWidth = (4 * dpr) / sc;
      hctx.beginPath();
      hctx.moveTo(p0[0], p0[1]);
      hctx.lineTo(p1[0], p1[1]);
      hctx.stroke();
    }
    const [x, y] = at(s);
    hctx.fillStyle = '#ff2d48';
    hctx.shadowColor = '#ff2d48';
    hctx.shadowBlur = 18 * dpr;
    hctx.beginPath();
    hctx.arc(x, y, (6 * dpr) / sc, 0, Math.PI * 2);
    hctx.fill();
    hctx.shadowBlur = 0;
    requestAnimationFrame(frame);
  }
}
requestAnimationFrame(frame);
