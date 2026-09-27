// Track geometry: a closed centerline built from a real circuit outline,
// resampled at even spacing so progress along the lap is an index lookup.

import { CIRCUITS } from './circuits.js';

// Game settings per circuit. Geometry comes from circuits.js.
const SETTINGS = [
  { id: 'at-1969', name: 'Red Bull Ring', country: 'Austria', width: 14, runoff: 14,
    blurb: 'Short and fast. Three heavy stops uphill, then flat-out through the valley.' },
  { id: 'it-1922', name: 'Monza', country: 'Italy', width: 14, runoff: 12,
    blurb: 'The temple of speed. Huge straights, tight chicanes, brake as late as you dare.' },
  { id: 'gb-1948', name: 'Silverstone', country: 'Great Britain', width: 15, runoff: 14,
    blurb: 'High-speed flow. Maggotts, Becketts and Chapel reward commitment.' },
  { id: 'be-1925', name: 'Spa-Francorchamps', country: 'Belgium', width: 14, runoff: 12,
    blurb: 'Seven kilometres through the Ardennes. Eau Rouge, Pouhon, the Bus Stop.' },
  { id: 'mc-1929', name: 'Monaco', country: 'Monaco', width: 12, runoff: 1.5, setting: 'city',
    blurb: 'Barriers everywhere. The hairpin, the tunnel, the swimming pool. No room for error.' },
  { id: 'br-1940', name: 'Interlagos', country: 'Brazil', width: 14, runoff: 12,
    blurb: 'Anticlockwise and bumpy. The Senna S into a long climb to the line.' },
];

export const TRACKS = SETTINGS.map((cfg) => {
  const c = CIRCUITS.find((c) => c.id === cfg.id);
  return { ...cfg, points: c.points };
});

const SPACING = 2; // meters between centerline samples

export function buildTrack(def) {
  const dense = sampleCentripetal(def.points);
  const { xs, ys, n, length } = resample(dense, SPACING);

  const tx = new Float64Array(n), ty = new Float64Array(n);
  const nx = new Float64Array(n), ny = new Float64Array(n);
  const s = new Float64Array(n);
  const step = length / n;
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    let dx = xs[b] - xs[a], dy = ys[b] - ys[a];
    const l = Math.hypot(dx, dy);
    dx /= l; dy /= l;
    tx[i] = dx; ty[i] = dy;
    nx[i] = -dy; ny[i] = dx; // points to the driver's right (screen y is down)
    s[i] = i * step;
  }

  // Signed curvature (1/m), positive = right-hand corner, lightly smoothed.
  const rawCurv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const cross = tx[a] * ty[b] - ty[a] * tx[b];
    const dot = tx[a] * tx[b] + ty[a] * ty[b];
    rawCurv[i] = Math.atan2(cross, dot) / (2 * step);
  }
  const curv = new Float64Array(n);
  const R = 3;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -R; k <= R; k++) sum += rawCurv[(i + k + n) % n];
    curv[i] = sum / (2 * R + 1);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }

  const halfW = def.width / 2;
  const { runL, runR } = runoffWidths({ n, step, xs, ys, nx, ny, curv }, halfW, def.runoff);

  return {
    id: def.id,
    name: def.name,
    country: def.country,
    blurb: def.blurb,
    setting: def.setting || 'park',
    halfW,
    runoff: def.runoff,
    runL, runR,
    n, step, length,
    xs, ys, tx, ty, nx, ny, s, curv,
    sectors: [length / 3, (2 * length) / 3],
    bounds: { minX, minY, maxX, maxY },
  };
}

// Where two parts of the circuit run close together, pull each side's
// barrier in so they meet halfway instead of overlapping.
function runoffWidths(t, halfW, runoff) {
  const { n, step, xs, ys, nx, ny, curv } = t;
  const runL = new Float64Array(n).fill(runoff);
  const runR = new Float64Array(n).fill(runoff);
  // On the inside of a tight corner the barrier can't sit past the corner's center.
  for (let i = 0; i < n; i++) {
    const k = curv[i];
    if (Math.abs(k) < 1e-4) continue;
    const room = Math.max(0.8, 0.85 / Math.abs(k) - halfW);
    if (k > 0) runR[i] = Math.min(runR[i], room);
    else runL[i] = Math.min(runL[i], room);
  }
  const reach = 2 * (halfW + runoff) + 2;
  const skip = Math.ceil((reach * 2) / step); // ignore the track's own neighbours
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let di = Math.abs(i - j);
      di = Math.min(di, n - di);
      if (di < skip) continue;
      const dx = xs[j] - xs[i], dy = ys[j] - ys[i];
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const d = Math.hypot(dx, dy);
      if (d > reach) continue;
      const room = Math.max(0.8, d / 2 - halfW - 0.5);
      if (dx * nx[i] + dy * ny[i] > 0) runR[i] = Math.min(runR[i], room);
      else runL[i] = Math.min(runL[i], room);
    }
  }
  return { runL: smoothMin(runL, 12), runR: smoothMin(runR, 12) };
}

// Min-filter then average, so barriers ease in instead of stepping.
function smoothMin(a, r) {
  const n = a.length;
  const m = new Float64Array(n), out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = Infinity;
    for (let k = -r; k <= r; k++) v = Math.min(v, a[(i + k + n) % n]);
    m[i] = v;
  }
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += m[(i + k + n) % n];
    out[i] = Math.min(a[i], sum / (2 * r + 1));
  }
  return out;
}

// Closed centripetal Catmull-Rom: passes through every control point
// without the loops or cusps the uniform variant makes on uneven spacing.
function sampleCentripetal(pts) {
  const out = [];
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const p0 = pts[(i - 1 + m) % m], p1 = pts[i];
    const p2 = pts[(i + 1) % m], p3 = pts[(i + 2) % m];
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
    const t2 = t1 + Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
    const t3 = t2 + Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]));
    const steps = Math.max(8, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5));
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const pt = [0, 0];
      for (let d = 0; d < 2; d++) {
        const a1 = ((t1 - t) / (t1 - t0)) * p0[d] + ((t - t0) / (t1 - t0)) * p1[d];
        const a2 = ((t2 - t) / (t2 - t1)) * p1[d] + ((t - t1) / (t2 - t1)) * p2[d];
        const a3 = ((t3 - t) / (t3 - t2)) * p2[d] + ((t - t2) / (t3 - t2)) * p3[d];
        const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        pt[d] = ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
      }
      out.push(pt);
    }
  }
  return out;
}

function resample(pts, spacing) {
  const m = pts.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const length = cum[m];
  const n = Math.round(length / spacing);
  const step = length / n;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = i * step;
    while (cum[j + 1] < target) j++;
    const a = pts[j], b = pts[(j + 1) % m];
    const f = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
    xs[i] = a[0] + (b[0] - a[0]) * f;
    ys[i] = a[1] + (b[1] - a[1]) * f;
  }
  return { xs, ys, n, length };
}

// Nearest point on the centerline. `hint` is the last known sample index;
// searching near it is fast and stops the car snapping to a nearby straight.
export function project(track, x, y, hint = -1) {
  const { n, xs, ys } = track;
  let best = -1, bestD = Infinity;
  if (hint >= 0) {
    for (let k = -30; k <= 30; k++) {
      const i = (hint + k + n) % n;
      const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  const far = (track.halfW + track.runoff + 20) ** 2;
  if (best < 0 || bestD > far) {
    for (let i = 0; i < n; i++) {
      const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  }

  // Refine on the two segments touching the nearest sample.
  let res = null;
  for (const i0 of [(best - 1 + n) % n, best]) {
    const i1 = (i0 + 1) % n;
    const ax = xs[i0], ay = ys[i0];
    const abx = xs[i1] - ax, aby = ys[i1] - ay;
    const len2 = abx * abx + aby * aby;
    let t = ((x - ax) * abx + (y - ay) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + abx * t, cy = ay + aby * t;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (!res || d < res.d) {
      const len = Math.sqrt(len2);
      const snx = -aby / len, sny = abx / len;
      res = {
        d, i: i0, cx, cy, nx: snx, ny: sny,
        s: (i0 * track.step + t * len) % track.length,
        lat: (x - cx) * snx + (y - cy) * sny,
      };
    }
  }
  res.i = best;
  return res;
}

// Point on the centerline at arc length s (wraps).
export function pointAt(track, s) {
  const { n, step, xs, ys } = track;
  s = ((s % track.length) + track.length) % track.length;
  const f = s / step;
  const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
  return { x: xs[i0] + (xs[i1] - xs[i0]) * t, y: ys[i0] + (ys[i1] - ys[i0]) * t, i: i0 };
}
