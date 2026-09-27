// One time-trial run on one track: physics, lap timing, sectors, track limits
// and ghost recording. No DOM here, so it can run headless too.

import { DT, CAR, createCar, stepCar, collideBarrier } from './car.js';
import { project } from './track.js';

export const COUNTDOWN = 2.4;      // seconds of start lights before GO
const GHOST_EVERY = 2;             // record a ghost sample every N ticks
const SPLIT_EVERY = 10;            // meters between live-delta checkpoints
const OFF_LIMIT = 1.2;             // car center this far past the edge = off track
const OFF_ALLOWED = 0.5;           // seconds fully off before the lap is invalid
const GRID_BACK = 8;               // start this many meters behind the line
const GRID_LAT = -3;               // and this far left of center

export class Session {
  constructor(track, saved) {
    this.track = track;
    this.best = saved?.best || null;               // { time, sectors, ghost, splits }
    this.bestSectors = saved?.bestSectors || [null, null, null];
    this.reset();
  }

  reset() {
    const t = this.track;
    const i = (t.n - Math.round(GRID_BACK / t.step)) % t.n;
    const a = Math.atan2(t.ty[i], t.tx[i]);
    // Pole position: the front-left grid slot.
    this.car = createCar(t.xs[i] + t.nx[i] * GRID_LAT, t.ys[i] + t.ny[i] * GRID_LAT, a);
    const pj = project(t, this.car.x, this.car.y);
    this.car.hint = pj.i;
    this.car.s = pj.s;
    this.progress = pj.s - t.length;   // negative: behind the start line

    this.phase = 'countdown';
    this.clock = -COUNTDOWN;           // race time, 0 = GO
    this.tick = 0;
    this.lap = 1;
    this.lapStart = 0;
    this.sector = 0;
    this.sectorStart = 0;
    this.sectorTimes = [];
    this.sectorClasses = [];
    this.offTime = 0;
    this.valid = true;
    this.laps = [];
    this.events = [];
    this.splits = [];
    this.rec = null;
  }

  get lapTime() {
    return this.phase === 'running' ? this.clock - this.lapStart : 0;
  }

  get lapProgress() {
    return this.progress - (this.lap - 1) * this.track.length;
  }

  step(input) {
    const t = this.track, car = this.car;
    this.clock += DT;
    if (this.phase === 'countdown') {
      car.px = car.x; car.py = car.y; car.pa = car.a;
      if (this.clock >= 0) {
        this.phase = 'running';
        this.clock = 0;
        this.startRecording(0);
        this.events.push({ type: 'go' });
      }
      return;
    }
    this.tick++;

    const before = project(t, car.x, car.y, car.hint);
    stepCar(car, input, Math.abs(before.lat) <= t.halfW + 0.5);

    let pj = project(t, car.x, car.y, car.hint);
    const run = pj.lat > 0 ? t.runR[pj.i] : t.runL[pj.i];
    const impact = collideBarrier(car, pj, t.halfW + run - CAR.width / 2);
    car.wall = impact !== null;
    if (car.wall) {
      pj = project(t, car.x, car.y, pj.i);
      if (impact > 2) this.events.push({ type: 'hit', impact });
    }
    car.hint = pj.i;
    car.lat = pj.lat;
    // Riding the kerbs: a wheel over the painted strip on a corner.
    const edge = Math.abs(pj.lat) - t.halfW;
    car.kerb = edge > -1.3 && edge < 1.6 && Math.abs(t.curv[pj.i]) > 1 / 150;

    let ds = pj.s - car.s;
    if (ds < -t.length / 2) ds += t.length;
    if (ds > t.length / 2) ds -= t.length;
    car.s = pj.s;
    const prev = this.progress;
    this.progress += ds;

    if (Math.abs(pj.lat) > t.halfW + OFF_LIMIT) {
      this.offTime += DT;
      if (this.valid && this.offTime > OFF_ALLOWED) {
        this.valid = false;
        this.events.push({ type: 'invalid' });
      }
    }

    this.recordSplits();
    this.checkSectors(prev);
    this.record();
  }

  checkSectors(prev) {
    const L = this.track.length;
    const boundary = (this.lap - 1) * L + ((this.sector + 1) * L) / 3;
    if (!(this.progress >= boundary && prev < boundary)) return;

    // Interpolate the exact crossing moment inside this tick.
    const f = (boundary - prev) / (this.progress - prev);
    const at = this.clock - DT + f * DT;
    const st = at - this.sectorStart;
    this.sectorTimes.push(st);
    this.sectorClasses.push(this.classify(this.sector, st));
    this.sectorStart = at;
    this.sector++;
    if (this.sector === 3) this.finishLap(at);
    else this.events.push({ type: 'sector', index: this.sector - 1, time: st });
  }

  // purple = best ever for this sector, green = beats the best lap's sector.
  classify(i, st) {
    if (!this.valid) return 'invalid';
    const pb = this.bestSectors[i];
    if (pb === null || st < pb) return 'purple';
    const lb = this.best?.sectors[i];
    if (lb != null && st < lb) return 'green';
    return 'yellow';
  }

  finishLap(at) {
    const time = at - this.lapStart;
    const sectors = this.sectorTimes;
    const classes = this.sectorClasses;
    const valid = this.valid;
    const prevBest = this.best?.time ?? null;
    const isBest = valid && (prevBest === null || time < prevBest);

    this.sample(this.rec);
    if (isBest) {
      this.best = {
        time, sectors,
        ghost: { t0: this.rec.t0, every: GHOST_EVERY * DT, pts: this.rec.pts },
        splits: this.splits,
      };
    }
    if (valid) {
      sectors.forEach((st, i) => {
        if (this.bestSectors[i] === null || st < this.bestSectors[i]) this.bestSectors[i] = st;
      });
    }
    this.laps.push({ lap: this.lap, time, sectors, classes, valid });
    this.events.push({ type: 'lap', lap: this.lap, time, sectors, valid, isBest, prevBest });

    this.lap++;
    this.lapStart = at;
    this.sector = 0;
    this.sectorTimes = [];
    this.sectorClasses = [];
    this.offTime = 0;
    this.valid = true;
    this.splits = [];
    this.startRecording(at);
  }

  // Time at every SPLIT_EVERY meters of the lap, for the live delta.
  recordSplits() {
    const p = this.lapProgress;
    while (p >= this.splits.length * SPLIT_EVERY && this.splits.length * SPLIT_EVERY < this.track.length) {
      this.splits.push(this.lapTime);
    }
  }

  // Live gap to the best lap at the same point on track (seconds, + = slower).
  delta() {
    const sp = this.best?.splits;
    const p = this.lapProgress;
    if (!sp || p < 20) return null;
    const f = p / SPLIT_EVERY;
    const i = Math.floor(f);
    if (i + 1 >= sp.length) return null;
    const bestT = sp[i] + (sp[i + 1] - sp[i]) * (f - i);
    return this.lapTime - bestT;
  }

  startRecording(at) {
    this.rec = { t0: this.clock - at, startTick: this.tick, pts: [] };
    this.sample(this.rec);
  }

  record() {
    if ((this.tick - this.rec.startTick) % GHOST_EVERY === 0) this.sample(this.rec);
  }

  sample(rec) {
    const c = this.car;
    rec.pts.push(round(c.x), round(c.y), Math.round(c.a * 1000) / 1000);
  }

  // Best-lap ghost pose at the current lap time.
  ghostPose() {
    const g = this.best?.ghost;
    if (!g || this.phase !== 'running') return null;
    const f = (this.lapTime - g.t0) / g.every;
    const count = g.pts.length / 3;
    if (f < 0 || f >= count - 1) return null;
    const i = Math.floor(f), u = f - i, k = i * 3;
    let da = g.pts[k + 5] - g.pts[k + 2];
    da = Math.atan2(Math.sin(da), Math.cos(da));
    return {
      x: g.pts[k] + (g.pts[k + 3] - g.pts[k]) * u,
      y: g.pts[k + 1] + (g.pts[k + 4] - g.pts[k + 1]) * u,
      a: g.pts[k + 2] + da * u,
    };
  }

  saveData() {
    return { best: this.best, bestSectors: this.bestSectors };
  }
}

function round(v) {
  return Math.round(v * 100) / 100;
}
