// An online race. Each player drives their own car and sends its state ten
// times a second; the other players' cars follow those updates, smoothed
// and extrapolated between them. The host also drives the AI cars that
// fill empty grid slots and sends theirs. Contact with another player's
// car only moves your own (theirs is moved on their screen).

import { RaceSession, gridCar, carContact } from './race.js';
import { createDriver, DIFFICULTY } from './ai.js';
import { buildLine } from './line.js';

const SEND_EVERY = 6;      // physics ticks between updates (10 a second)
const EXTRAPOLATE = 0.3;   // s, longest we carry a car on from its last update
const FOLLOW = 0.3;        // share of the gap to the predicted spot closed per tick
const SNAP = 15;           // m off: jump straight there
const RESTITUTION = 0.3;

export class OnlineRaceSession extends RaceSession {
  // online: { room, me: { id, name }, host: bool, start: { laps, difficulty,
  // grid: [{ id, name, color, ai }] } }, with the same start on every screen.
  constructor(track, saved, online) {
    super(track, saved, { opponents: 0, laps: online.start.laps, difficulty: online.start.difficulty, name: online.me.name, online });
    this.mode = 'race';
    this.online = true;
  }

  setupRace() {
    const t = this.track, o = this.opts, { room, me, start, host } = o.online;
    const line = t.line ||= buildLine(t);
    const skill = DIFFICULTY[o.difficulty] || DIFFICULTY.medium;
    this.totalLaps = o.laps;
    this.finished = false;
    this.room = room;
    this.me = me;
    this.host = host;
    this.sendTick = 0;
    this.rivals = [];           // AI cars this screen drives (host only)
    this.remotes = new Map();   // everyone else, by id
    this.playerFinishedAt = null;
    this.playerBestLap = null;

    start.grid.forEach((g, slot) => {
      const car = gridCar(t, slot);
      if (g.id === me.id) {
        Object.assign(this.car, car);
        this.progress = car.s - t.length;
        return;
      }
      const entry = {
        id: g.id, name: g.name, color: g.color, car, ai: !!g.ai, left: false,
        progress: car.s - t.length, laps: 0, lapStart: 0, finishedAt: null, bestLap: null, last: null, lastAt: 0,
      };
      if (g.ai && host) {
        entry.driver = createDriver(t, line, skill);
        this.rivals.push(entry);
      } else {
        this.remotes.set(g.id, entry);
      }
    });
    room.on('state', (msg) => this.receive(msg));
  }

  get opponents() {
    return [...this.rivals, ...[...this.remotes.values()].filter((r) => !r.left)];
  }

  // No watching an ad mid-race online: everyone else keeps driving.
  get canRescue() { return false; }

  // Someone left the room: their car disappears.
  markLeft(id) {
    const r = this.remotes.get(id);
    if (r) r.left = true;
  }

  step(input) {
    super.step(input);
    if (this.phase !== 'running') return;
    for (const r of this.remotes.values()) if (!r.left) this.follow(r);
    this.collideRemotes();
    if (++this.sendTick % SEND_EVERY === 0) this.broadcast();
  }

  receive(msg) {
    this.apply(msg);
    if (!this.host) for (const s of msg.ai || []) this.apply(s);
  }

  apply(s) {
    const r = this.remotes.get(s.id);
    if (!r) return;
    r.last = s;
    r.lastAt = this.clock;
    r.progress = s.progress;
    r.laps = s.laps;
    r.finishedAt = s.finishedAt;
    r.bestLap = s.bestLap;
  }

  // Carry a remote car on from its last update and ease it there.
  follow(r) {
    const s = r.last, c = r.car;
    if (!s) return;
    const dt = Math.min(EXTRAPOLATE, Math.max(0, this.clock - r.lastAt));
    const tx = s.x + s.vx * dt, ty = s.y + s.vy * dt;
    c.px = c.x; c.py = c.y; c.pa = c.a;
    if (Math.hypot(tx - c.x, ty - c.y) > SNAP) {
      c.x = tx; c.y = ty; c.a = s.a;
      c.px = c.x; c.py = c.y; c.pa = c.a;
    } else {
      c.x += (tx - c.x) * FOLLOW;
      c.y += (ty - c.y) * FOLLOW;
      c.a += Math.atan2(Math.sin(s.a - c.a), Math.cos(s.a - c.a)) * FOLLOW;
    }
    c.vx = s.vx; c.vy = s.vy;
    c.speed = Math.hypot(s.vx, s.vy);
    c.steer = s.steer;
  }

  collideRemotes() {
    const A = this.car;
    for (const r of this.remotes.values()) {
      if (r.left || !r.last) continue;
      const hit = carContact(A, r.car);
      if (!hit) continue;
      const { over, nx, ny } = hit;
      A.x -= nx * over;
      A.y -= ny * over;
      const vrel = (r.car.vx - A.vx) * nx + (r.car.vy - A.vy) * ny;
      if (vrel < 0) {
        const j = (-(1 + RESTITUTION) * vrel) / 2;
        A.vx -= j * nx;
        A.vy -= j * ny;
        if (-vrel > 2) this.events.push({ type: 'hit', impact: -vrel, car: true });
      }
    }
  }

  broadcast() {
    const pack = (id, c, extra) => ({
      id, x: r2(c.x), y: r2(c.y), a: Math.round(c.a * 1000) / 1000, vx: r2(c.vx), vy: r2(c.vy), steer: r2(c.steer), ...extra,
    });
    const msg = pack(this.me.id, this.car, {
      progress: r2(this.progress), laps: Math.min(this.laps.length, this.totalLaps),
      finishedAt: this.playerFinishedAt, bestLap: this.playerBestLap,
    });
    if (this.host) {
      msg.ai = this.rivals.map((r) => pack(r.id, r.car, { progress: r2(r.progress), laps: r.laps, finishedAt: r.finishedAt, bestLap: r.bestLap }));
    }
    this.room.send('state', msg);
  }
}

function r2(v) {
  return Math.round(v * 100) / 100;
}
