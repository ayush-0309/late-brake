// AI drivers. Each one follows the circuit's racing line at a share of its
// ideal speed (its skill), moves off the line to pass a slower car, sits
// behind one it can't pass yet, and resets itself if it gets stuck.
// Deterministic: the same race plays out the same way.

const LOOK_MIN = 10;      // m, nearest steering target
const LOOK_TIME = 0.45;   // s of travel to the steering target at speed
const TRAFFIC = 28;       // m ahead to watch for cars
const SIDE = 2.6;         // m of lateral overlap that counts as "in the way"
const PASS_GAP = 3.2;     // m of lateral room to leave when passing
const OFFSET_RATE = 2.2;  // m/s the car moves across the track
const STUCK_TIME = 2.5;   // s nearly stopped before resetting to the track

export const DIFFICULTY = { easy: 0.86, medium: 0.93, hard: 0.985 };

export function createDriver(track, line, skill) {
  const lim = Math.max(0, track.halfW - 1.8);
  let j = -1;              // nearest racing-line point
  let offset = 0;          // current lateral shift from the line, m (+ = right)
  let stuck = 0;

  function nearest(car) {
    const { n, xs, ys } = line;
    let best = j, bd = Infinity;
    const scan = j < 0 ? [0, n] : [-12, 40];
    for (let q = scan[0]; q < scan[1]; q++) {
      const k = j < 0 ? q : (j + q + n) % n;
      const d = (xs[k] - car.x) ** 2 + (ys[k] - car.y) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    j = best;
  }

  // Line point `ahead` samples on, shifted sideways by `off` metres.
  function pointOn(ahead, off) {
    const k = (j + ahead) % line.n, i = line.ci[k];
    return [line.xs[k] + track.nx[i] * off, line.ys[k] + track.ny[i] * off];
  }

  // `others`: the other cars as { car, lat } (lat = offset from the centre line).
  function control(car, others, dt) {
    nearest(car);
    const v = car.speed;
    const fx = Math.cos(car.a), fy = Math.sin(car.a);

    // Traffic: the nearest car ahead that's in the way.
    let block = null;
    for (const o of others) {
      const rx = o.car.x - car.x, ry = o.car.y - car.y;
      const ahead = rx * fx + ry * fy, side = -rx * fy + ry * fx;
      if (ahead > 0 && ahead < TRAFFIC && Math.abs(side) < SIDE && (!block || ahead < block.ahead)) {
        block = { ahead, lat: o.lat, speed: o.car.speed };
      }
    }
    let target = line.v[(j + 2) % line.n] * skill;
    let wantOffset = 0;
    if (block && block.speed < target + 2) {
      // Pass on the side with more room, otherwise sit behind.
      const lineLat = line.off[j];
      const left = block.lat - PASS_GAP, right = block.lat + PASS_GAP;
      const roomLeft = left + lim, roomRight = lim - right;
      const pick = roomLeft > roomRight ? left : right;
      if (Math.max(roomLeft, roomRight) > 0) wantOffset = clamp(pick - lineLat, -lim - lineLat, lim - lineLat);
      if (block.ahead < 12 && Math.abs(offset - wantOffset) > 1) target = Math.min(target, block.speed);
    }
    offset += clamp(wantOffset - offset, -OFFSET_RATE * dt, OFFSET_RATE * dt);
    // Off the line, corners are tighter: give a little away.
    if (Math.abs(offset) > 1) target *= 0.96;

    const look = Math.max(1, Math.round(Math.max(LOOK_MIN, v * LOOK_TIME) / line.ds));
    const [tx, ty] = pointOn(look, offset);
    let err = Math.atan2(ty - car.y, tx - car.x) - car.a;
    err = Math.atan2(Math.sin(err), Math.cos(err));

    stuck = v < 2 ? stuck + dt : 0;
    const reset = stuck > STUCK_TIME;
    if (reset) stuck = 0;

    return {
      steer: clamp(err * 3.5, -1, 1),
      throttle: v < target - 0.5 ? 1 : v < target ? 0.4 : 0,
      brake: v > target + 1.5 ? clamp((v - target) / 6, 0.3, 1) : 0,
      sens: 1,
      reset,
    };
  }

  return { control, forget() { j = -1; offset = 0; } };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
