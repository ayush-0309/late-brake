// Racing line and speed profile, worked out once per circuit from its shape
// and the car's handling. Feeds the painted line and the braking boards.
// No DOM here, so it can run headless too.

import { CAR } from './car.js';

const STEP = 5;          // m between line points
const MARGIN = 1.6;      // m kept between the line and the track edge
const WALL_PAD = 1;      // and this much more where a wall is close
const GRIP_USE = 0.95;   // share of the grip limit the profile corners at
const BRAKE_USE = 0.8;   // share of full braking, leaves room to trail-brake
const BIG_STOP = 20;     // m/s of speed lost that earns braking boards (~70 km/h)
const LIFT = 8;          // braking zones losing less than this are shown as a lift
const BOARDS = [150, 100, 50];

export const ZONE = { throttle: 0, lift: 1, brake: 2 };

export function buildLine(t) {
  // The line lives on a coarser grid than the centerline.
  const n = Math.floor(t.length / STEP);
  const ds = t.length / n;
  const cx = new Float64Array(n), cy = new Float64Array(n);
  const nx = new Float64Array(n), ny = new Float64Array(n);
  const ci = new Int32Array(n); // centerline sample under each line point
  for (let j = 0; j < n; j++) {
    const i = Math.min(t.n - 1, Math.round((j * t.n) / n));
    ci[j] = i;
    cx[j] = t.xs[i]; cy[j] = t.ys[i];
    nx[j] = t.nx[i]; ny[j] = t.ny[i];
  }
  // How far the line may go each side of the centre (lo is negative: left).
  const lo = new Float64Array(n), hi = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const i = ci[j];
    hi[j] = Math.max(0, t.halfW - MARGIN - (t.runR[i] < 3 ? WALL_PAD : 0));
    lo[j] = -Math.max(0, t.halfW - MARGIN - (t.runL[i] < 3 ? WALL_PAD : 0));
  }

  // Minimum-curvature line: relax a coarse version first so long, sweeping
  // corners settle quickly, then refine at full resolution.
  const c = 4;
  const m = Math.floor(n / c);
  const pick = (a) => Float64Array.from({ length: m }, (_, j) => a[j * c]);
  const coarse = relax(new Float64Array(m), pick(cx), pick(cy), pick(nx), pick(ny), pick(lo), pick(hi), 1500);
  const off = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const f = j / c, j0 = Math.floor(f) % m, j1 = (j0 + 1) % m, u = f - Math.floor(f);
    off[j] = coarse[j0] + (coarse[j1] - coarse[j0]) * u;
  }
  relax(off, cx, cy, nx, ny, lo, hi, 400);

  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    xs[j] = cx[j] + nx[j] * off[j];
    ys[j] = cy[j] + ny[j] * off[j];
  }
  const curv = curvature(xs, ys, n);

  // Speed profile: corner limits, then braking backwards and accelerating
  // forwards from them. Two laps each way so it wraps cleanly at the line.
  const vc = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const kk = Math.abs(curv[j]) / GRIP_USE;
    vc[j] = kk > CAR.downforce ? Math.min(120, Math.sqrt(CAR.grip / (kk - CAR.downforce))) : 120;
  }
  const vb = Float64Array.from(vc), vf = Float64Array.from(vc);
  for (let pass = 0; pass < 2 * n; pass++) {
    const j = (2 * n - 1 - pass) % n, next = (j + 1) % n;
    vb[j] = Math.min(vb[j], Math.sqrt(vb[next] ** 2 + 2 * decel(vb[next]) * ds));
  }
  for (let pass = 0; pass < 2 * n; pass++) {
    const j = pass % n, next = (j + 1) % n;
    vf[next] = Math.min(vf[next], Math.sqrt(Math.max(0, vf[j] ** 2 + 2 * accel(vf[j]) * ds)));
  }
  const v = new Float64Array(n);
  for (let j = 0; j < n; j++) v[j] = Math.min(vb[j], vf[j]);

  // Zones: brake where the braking pass sets the speed, lift where a corner
  // does, throttle everywhere else.
  const zone = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    if (vb[j] < vf[j] - 0.3) zone[j] = ZONE.brake;
    else if (v[j] >= vc[j] - 0.3 && vc[j] < 115) zone[j] = ZONE.lift;
  }
  const stops = brakingZones(zone, v, n);
  for (const z of stops) {
    if (z.drop < LIFT) for (let j = z.start; j !== z.end; j = (j + 1) % n) zone[j] = ZONE.lift;
  }

  const line = { n, ds, ci, xs, ys, off, curv, v, zone, boards: [] };
  for (const z of stops) if (z.drop >= BIG_STOP) placeBoards(line, t, z, cx, cy, nx, ny);
  return line;
}

// Projected coordinate descent on the line's squared second differences:
// each point moves to the spot that best straightens it with its neighbours,
// limited to the track width.
function relax(off, cx, cy, nx, ny, lo, hi, iters) {
  const n = off.length;
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    px[j] = cx[j] + nx[j] * off[j];
    py[j] = cy[j] + ny[j] * off[j];
  }
  for (let it = 0; it < iters; it++) {
    for (let j = 0; j < n; j++) {
      const a = (j - 2 + n) % n, b = (j - 1 + n) % n, d = (j + 1) % n, e = (j + 2) % n;
      const tx = (4 * (px[b] + px[d]) - (px[a] + px[e])) / 6;
      const ty = (4 * (py[b] + py[d]) - (py[a] + py[e])) / 6;
      let o = (tx - cx[j]) * nx[j] + (ty - cy[j]) * ny[j];
      o = o < lo[j] ? lo[j] : o > hi[j] ? hi[j] : o;
      off[j] = o;
      px[j] = cx[j] + nx[j] * o;
      py[j] = cy[j] + ny[j] * o;
    }
  }
  return off;
}

// Signed curvature (1/m, positive = right-hand), lightly smoothed.
function curvature(xs, ys, n) {
  const raw = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const a = (j - 1 + n) % n, b = (j + 1) % n;
    const ax = xs[j] - xs[a], ay = ys[j] - ys[a];
    const bx = xs[b] - xs[j], by = ys[b] - ys[j];
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    raw[j] = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) / ((la + lb) / 2);
  }
  const out = new Float64Array(n);
  const R = 2;
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let q = -R; q <= R; q++) sum += raw[(j + q + n) % n];
    out[j] = sum / (2 * R + 1);
  }
  return out;
}

// Deceleration available at speed v (m/s²): brakes, limited by grip, plus drag.
function decel(v) {
  const G = CAR.grip + CAR.downforce * v * v;
  return BRAKE_USE * Math.min(CAR.brake, G * 1.1) + CAR.roll + CAR.aeroDrag * v * v;
}

// Acceleration available at speed v (m/s²): engine, limited by traction, minus drag.
function accel(v) {
  return Math.min(CAR.traction, CAR.power / Math.max(v, 1)) - CAR.roll - CAR.aeroDrag * v * v;
}

// Runs of braking, with the speed lost over each. `end` is the first point
// after braking stops: the corner entry.
function brakingZones(zone, v, n) {
  let s0 = 0;
  while (s0 < n && zone[s0] === ZONE.brake) s0++;
  if (s0 === n) return [];
  const out = [];
  for (let q = 1; q <= n; q++) {
    const j = (s0 + q) % n;
    if (zone[j] === ZONE.brake && zone[(j - 1 + n) % n] !== ZONE.brake) {
      let e = j;
      while (zone[e] === ZONE.brake) e = (e + 1) % n;
      out.push({ start: j, end: e, drop: v[j] - v[e] });
    }
  }
  return out;
}

// 150, 100 and 50 m boards counting down to the corner, on the outside of
// the approach. Boards that would land in the previous corner are skipped.
function placeBoards(line, t, z, cx, cy, nx, ny) {
  const { n, ds, zone, curv } = line;
  let apex = z.end, best = 0;
  for (let q = 0; q < Math.round(60 / ds); q++) {
    const j = (z.end + q) % n;
    if (Math.abs(curv[j]) > best) { best = Math.abs(curv[j]); apex = j; }
  }
  const side = curv[apex] > 0 ? -1 : 1;
  for (const dist of BOARDS) {
    const back = Math.round(dist / ds);
    let clear = true;
    for (let q = 0; q <= back; q++) {
      const j = (z.end - q + n) % n;
      const inThisStop = q <= ((z.end - z.start + n) % n);
      if (!inThisStop && zone[j] !== ZONE.throttle) { clear = false; break; }
    }
    if (!clear) break;
    const j = (z.end - back + n) % n;
    const i = line.ci[j];
    const run = side > 0 ? t.runR[i] : t.runL[i];
    // Board centre: its inner edge (it's 5.6 m wide) stays clear of the
    // track; with little runoff it stands behind the barrier.
    const lat = side * (t.halfW + Math.max(3.2, Math.min(run - 1, 6)));
    const a = Math.atan2(t.ty[i], t.tx[i]);
    line.boards.push({ x: cx[j] + nx[j] * lat, y: cy[j] + ny[j] * lat, a, label: String(dist) });
  }
}
