// A race against AI cars. Builds on the time-trial session (the player's lap
// timing, sectors and track limits work the same) and adds a grid, rivals,
// car-to-car contact, positions and a finish. No DOM, so it can run headless.

import { Session, OFF_LIMIT } from './session.js';
import { DT, CAR, createCar, stepCar, collideBarrier } from './car.js';
import { project } from './track.js';
import { buildLine } from './line.js';
import { createDriver, DIFFICULTY } from './ai.js';

export const RIVALS = [
  { name: 'A. Kovač', color: '#ff8000' },
  { name: 'J. Mendes', color: '#00a19b' },
  { name: 'L. Okafor', color: '#2b4bd4' },
  { name: 'S. Lindqvist', color: '#f5c542' },
  { name: 'R. Tanaka', color: '#9ca3af' },
];
const SKILL_SPREAD = [0.012, -0.004, 0.006, -0.012, 0]; // drivers differ a little
const MAX_SKILL = DIFFICULTY.hard;                       // but none past hard: quicker, the AI can't keep inside the track limits
const CAR_RADIUS = 1.0;                                  // three circles along each car
const CIRCLES = [-1.75, 0, 1.75];
const RESTITUTION = 0.3;
// Track limits in a race, as in Grand Prix racing: every trip off deletes
// that lap and is a strike (unless another car pushed you off). The third
// brings the black-and-white flag; the fourth and each one after add five
// seconds to the race time.
const WARN_AT = 3;
const PENALTY_FROM = 4;
const PENALTY = 5;      // s
const PUSHED = 2;       // s after car-to-car contact in which a trip off isn't a strike

export class RaceSession extends Session {
  // opts: { opponents: 1–3, laps, difficulty: 'easy' | 'medium' | 'hard', name }
  constructor(track, saved, opts) {
    super(track, saved);
    this.mode = 'race';
    this.opts = opts;
    this.setupRace();
  }

  reset() {
    super.reset();
    if (this.opts) this.setupRace();
  }

  setupRace() {
    const t = this.track, o = this.opts;
    const line = t.line ||= buildLine(t);
    const skill = DIFFICULTY[o.difficulty] || DIFFICULTY.medium;
    this.totalLaps = o.laps;
    this.finished = false;
    // Rivals on the front rows, the player at the back.
    this.rivals = RIVALS.slice(0, o.opponents).map((r, g) => {
      const car = gridCar(t, g);
      return {
        ...r, car, driver: createDriver(t, line, Math.min(MAX_SKILL, skill + SKILL_SPREAD[g])),
        progress: car.s - t.length, laps: 0, lapStart: 0, finishedAt: null, bestLap: null,
        valid: true, wasOff: false, strikes: 0, penalty: 0,
      };
    });
    const me = gridCar(t, o.opponents);
    Object.assign(this.car, me);
    this.progress = me.s - t.length;
    this.playerFinishedAt = null;
    this.playerBestLap = null;
    this.strikes = 0;
    this.penalty = 0;
  }

  // The player's trip off the track: a strike, unless pushed off or already
  // past the flag (the AI drives the car home then).
  leftTrack() {
    if (this.finished || !strike(this, this.car)) return;
    this.events.push({ type: 'strike', strikes: this.strikes, warn: this.strikes === WARN_AT, penalty: this.strikes >= PENALTY_FROM });
  }

  // No ghost in a race: the rivals are on track instead.
  ghostPose() { return null; }

  // After the flag the AI drives the car home; those laps don't count.
  get canRescue() { return !this.finished && super.canRescue; }

  // Every other car in the race (drawn, ranked, avoided). Online races add
  // the other players' cars to the locally driven AI.
  get opponents() { return this.rivals; }

  step(input) {
    if (this.finished) input = this.coolDown(input);
    this.lastInput = input; // what drove the car this tick (sound and pedal bars follow it)
    const lapsBefore = this.laps.length;
    super.step(input);
    if (this.phase !== 'running') return;

    for (const r of this.rivals) this.stepRival(r);
    this.collideCars();

    // Player's laps: best lap in the race (deleted laps don't count), and the finish.
    if (this.laps.length > lapsBefore) {
      const l = this.laps.at(-1);
      if (l.valid && (this.playerBestLap === null || l.time < this.playerBestLap)) this.playerBestLap = l.time;
      if (!this.finished && this.laps.length >= this.totalLaps) {
        this.finished = true;
        this.playerFinishedAt = this.lapStart; // the moment the last lap ended
        this.events.push({ type: 'finish', position: this.position });
      }
    }
  }

  stepRival(r) {
    const t = this.track, car = r.car;
    const others = [this.car, ...this.opponents.filter((o) => o !== r).map((o) => o.car)]
      .map((c) => ({ car: c, lat: c.lat ?? 0 }));
    const inp = r.driver.control(car, others, DT);
    if (inp.reset) {
      resetOnTrack(t, car);
      r.driver.forget();
    }
    const before = project(t, car.x, car.y, car.hint);
    stepCar(car, inp, Math.abs(before.lat) <= t.halfW + 0.5);
    let pj = project(t, car.x, car.y, car.hint);
    const run = pj.lat > 0 ? t.runR[pj.i] : t.runL[pj.i];
    if (collideBarrier(car, pj, t.halfW + run - CAR.width / 2) !== null) pj = project(t, car.x, car.y, pj.i);
    car.hint = pj.i;
    car.lat = pj.lat;
    let ds = pj.s - car.s;
    if (ds < -t.length / 2) ds += t.length;
    if (ds > t.length / 2) ds -= t.length;
    car.s = pj.s;
    const prev = r.progress;
    r.progress += ds;

    // Track limits, the same as the player's.
    const off = Math.abs(pj.lat) > t.halfW + OFF_LIMIT;
    if (off && r.finishedAt === null) {
      r.valid = false;
      if (!r.wasOff) strike(this, car, r);
    }
    r.wasOff = off;

    // Crossing the line: count the lap, interpolating the exact moment.
    const line = (r.laps + 1) * t.length;
    if (r.progress >= line && prev < line) {
      const at = this.clock - DT + ((line - prev) / (r.progress - prev)) * DT;
      const lapTime = at - r.lapStart;
      if (r.valid && (r.laps > 0 || lapTime > 0)) r.bestLap = r.bestLap === null ? lapTime : Math.min(r.bestLap, lapTime);
      r.valid = true;
      r.laps++;
      r.lapStart = at;
      if (r.laps >= this.totalLaps && r.finishedAt === null) r.finishedAt = at;
    }
  }

  // Cars as three circles each; overlapping pairs are pushed apart and
  // bounce a little along the contact normal.
  collideCars() {
    const cars = [this.car, ...this.rivals.map((r) => r.car)];
    for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], B = cars[b];
        const hit = carContact(A, B);
        if (!hit) continue;
        const { over, nx, ny } = hit;
        A.contactAt = B.contactAt = this.clock;
        A.x -= nx * over / 2; A.y -= ny * over / 2;
        B.x += nx * over / 2; B.y += ny * over / 2;
        const vrel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (vrel < 0) {
          const j = (-(1 + RESTITUTION) * vrel) / 2;
          A.vx -= j * nx; A.vy -= j * ny;
          B.vx += j * nx; B.vy += j * ny;
          if (a === 0 && -vrel > 2) this.events.push({ type: 'hit', impact: -vrel, car: true });
        }
      }
    }
  }

  // After the flag the player's car is driven home by the AI.
  coolDown(input) {
    this.autopilot ||= createDriver(this.track, this.track.line, 0.7);
    const others = this.opponents.map((r) => ({ car: r.car, lat: r.car.lat ?? 0 }));
    const inp = this.autopilot.control(this.car, others, DT);
    if (inp.reset) resetOnTrack(this.track, this.car);
    return inp;
  }

  // Everyone, in race order: finished cars by race time (finishing time plus
  // penalties), then the rest by distance covered.
  get standings() {
    const L = this.track.length;
    const rows = [
      { name: this.opts.name || 'You', color: '#e8112d', me: true, progress: this.progress, finishedAt: this.playerFinishedAt, penalty: this.penalty, laps: Math.min(this.laps.length, this.totalLaps), bestLap: this.playerBestLap, car: this.car },
      ...this.opponents.map((r) => ({ name: r.name, color: r.color, me: false, progress: r.progress, finishedAt: r.finishedAt, penalty: r.penalty || 0, laps: Math.min(r.laps, this.totalLaps), bestLap: r.bestLap, car: r.car })),
    ];
    for (const r of rows) r.time = r.finishedAt === null ? null : r.finishedAt + r.penalty;
    rows.sort((a, b) => {
      if (a.time !== null && b.time !== null) return a.time - b.time;
      if (a.time !== null) return -1;
      if (b.time !== null) return 1;
      return b.progress - a.progress;
    });
    const lead = rows[0];
    for (const r of rows) {
      r.lapsDown = r.finishedAt === null ? Math.floor((lead.progress - r.progress) / L) : 0;
      // Gap to the leader in seconds: exact once both have finished, else
      // estimated from the distance between them at the current speed.
      if (r === lead) r.gap = 0;
      else if (r.time !== null && lead.time !== null) r.gap = r.time - lead.time;
      else r.gap = (lead.progress - r.progress) / Math.max(20, r.car.speed);
    }
    return rows;
  }

  get position() {
    return this.standings.findIndex((r) => r.me) + 1;
  }

  classify() {
    return this.standings.map((r, i) => ({
      pos: i + 1, name: r.name, color: r.color, me: r.me, done: r.finishedAt !== null,
      gap: r.gap, lapsDown: r.lapsDown, bestLap: r.bestLap,
      time: r.time, penalty: r.penalty,
    }));
  }
}

// Overlap between two cars, each three circles along its length: the
// deepest overlap and its direction (from A to B), or null.
export function carContact(A, B) {
  if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 > 36) return null;
  let best = null;
  for (const oa of CIRCLES) {
    const ax = A.x + Math.cos(A.a) * oa, ay = A.y + Math.sin(A.a) * oa;
    for (const ob of CIRCLES) {
      const bx = B.x + Math.cos(B.a) * ob, by = B.y + Math.sin(B.a) * ob;
      const d = Math.hypot(bx - ax, by - ay);
      const over = 2 * CAR_RADIUS - d;
      if (over > 0 && (!best || over > best.over)) best = { over, nx: (bx - ax) / (d || 1), ny: (by - ay) / (d || 1) };
    }
  }
  return best;
}

// A trip off the track by `car` (the player's, or rival `r`'s): a strike,
// with five seconds added from the fourth, unless another car touched it
// just before. Says whether it was one.
function strike(race, car, r = race) {
  if (race.clock - (car.contactAt ?? -Infinity) < PUSHED) return false;
  if (++r.strikes >= PENALTY_FROM) r.penalty += PENALTY;
  return true;
}

// A car parked in grid slot g (0 = pole), as the scenery paints the slots:
// 8 m apart, alternating sides, pole on the left.
export function gridCar(t, g) {
  const back = 8 + 8 * g;
  const i = (t.n - Math.round(back / t.step)) % t.n;
  const lat = g % 2 ? 3 : -3;
  const a = Math.atan2(t.ty[i], t.tx[i]);
  const car = createCar(t.xs[i] + t.nx[i] * lat, t.ys[i] + t.ny[i] * lat, a);
  const pj = project(t, car.x, car.y);
  car.hint = pj.i;
  car.s = pj.s;
  car.lat = pj.lat;
  return car;
}

export function resetOnTrack(t, car) {
  const i = project(t, car.x, car.y, car.hint).i;
  const a = Math.atan2(t.ty[i], t.tx[i]);
  Object.assign(car, { x: t.xs[i], y: t.ys[i], a, px: t.xs[i], py: t.ys[i], pa: a, vx: 0, vy: 0, steer: 0, speed: 0, vf: 0 });
}
