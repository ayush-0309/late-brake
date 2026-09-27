// Arcade car physics. Runs at a fixed timestep so a lap given the same
// inputs always plays out the same way (ghosts and AI simulation rely on it).

export const DT = 1 / 60;

// Tuned to feel like an F1 car rather than match one exactly: grip grows with
// speed (downforce), so fast corners are flat and slow ones need care.
export const CAR = {
  length: 5.6,
  width: 2.0,
  wheelbase: 3.6,
  traction: 16,      // m/s², max acceleration off the line
  power: 1000,       // accel × speed, limits pull at high speed
  brake: 50,         // m/s² at full downforce (~5 g)
  reverse: 6,
  reverseMax: 8,
  roll: 0.4,         // constant drag
  aeroDrag: 0.0012,  // drag per (m/s)²; ~1 g of lift-off decel at 300 km/h
  grip: 21,          // lateral grip at walking pace, m/s²
  downforce: 0.0028, // extra grip per (m/s)²; ~4.5 g at 300 km/h
  steerMax: 0.5,     // rad at walking pace
  steerFalloff: 16,  // steering angle halves by this speed
  yawCap: 1.2,       // allowed over-rotation vs grip, gives a little slide
  align: 3.5,        // how hard the car straightens up when sliding
  steerIn: 4.5,      // steering rates, per second
  steerOut: 7,
  grassGrip: 0.45,
  grassDrag: 0.4,    // extra drag per m/s on grass
};

export function createCar(x, y, a) {
  return {
    x, y, a, vx: 0, vy: 0,
    px: x, py: y, pa: a, // previous tick, for render interpolation
    steer: 0, speed: 0, vf: 0, slip: 0, long: 0,
    onTrack: true,
  };
}

export function stepCar(car, input, onTrack, dt = DT) {
  car.px = car.x; car.py = car.y; car.pa = car.a;
  car.onTrack = onTrack;

  // Steering wheel moves smoothly toward the input.
  const target = input.steer;
  const rate = Math.abs(target) > Math.abs(car.steer) && Math.sign(target) === Math.sign(car.steer || target)
    ? CAR.steerIn : CAR.steerOut;
  car.steer += clamp(target - car.steer, -rate * dt, rate * dt);

  let fx = Math.cos(car.a), fy = Math.sin(car.a);
  let vf = car.vx * fx + car.vy * fy;
  let vr = -car.vx * fy + car.vy * fx;
  const sp = Math.abs(vf);
  const G = (CAR.grip + CAR.downforce * sp * sp) * (onTrack ? 1 : CAR.grassGrip);

  // Yaw: bicycle model, capped by grip, plus self-alignment when sliding.
  const maxAngle = CAR.steerMax / (1 + sp / CAR.steerFalloff);
  let yaw = (vf / CAR.wheelbase) * Math.tan(car.steer * maxAngle);
  const cap = (G * CAR.yawCap) / Math.max(sp, 4);
  yaw = clamp(yaw, -cap, cap);
  if (sp > 1) yaw += CAR.align * Math.atan2(vr, sp) * Math.sign(vf);
  car.a += yaw * dt;

  // Re-express velocity in the rotated frame.
  fx = Math.cos(car.a); fy = Math.sin(car.a);
  vf = car.vx * fx + car.vy * fy;
  vr = -car.vx * fy + car.vy * fx;

  // Longitudinal.
  let long = 0;
  if (input.throttle > 0) {
    long += input.throttle * Math.min(CAR.traction, CAR.power / Math.max(vf, 1));
  }
  let braking = 0;
  if (input.brake > 0) {
    if (vf > 0.5) braking = input.brake * CAR.brake;
    else if (!(input.throttle > 0)) long -= input.brake * CAR.reverse * Math.max(0, 1 + vf / CAR.reverseMax);
  }
  braking = Math.min(braking, G * 1.1);
  long = clamp(long, -G, G);
  const drag = CAR.roll + CAR.aeroDrag * vf * vf + (onTrack ? 0 : CAR.grassDrag * Math.abs(vf));
  const decel = braking + drag;
  vf += long * dt;
  // Brakes and drag slow the car toward zero, never past it.
  if (vf > 0) vf = Math.max(0, vf - decel * dt);
  else if (vf < 0) vf = Math.min(0, vf + drag * dt);

  // Lateral grip shares a friction circle with braking/acceleration.
  const used = Math.abs(long) + braking;
  const latAvail = Math.sqrt(Math.max(0, G * G - (0.6 * used) ** 2));
  const dv = Math.min(Math.abs(vr), latAvail * dt);
  vr -= Math.sign(vr) * dv;

  car.vx = fx * vf - fy * vr;
  car.vy = fy * vf + fx * vr;
  car.x += car.vx * dt;
  car.y += car.vy * dt;

  car.vf = vf;
  car.slip = Math.abs(vr);
  car.long = long - braking;
  car.speed = Math.hypot(car.vx, car.vy);
}

// Keep the car inside the barriers. `pj` is the car's projection on the track.
// Returns null when clear of the wall, else the speed of impact into it (m/s).
export function collideBarrier(car, pj, limit) {
  if (Math.abs(pj.lat) <= limit) return null;
  const side = Math.sign(pj.lat);
  const over = pj.lat - side * limit;
  car.x -= pj.nx * over;
  car.y -= pj.ny * over;
  const vn = car.vx * pj.nx + car.vy * pj.ny;
  const impact = Math.max(0, vn * side);
  if (impact > 0) {
    car.vx -= pj.nx * vn * 1.3;
    car.vy -= pj.ny * vn * 1.3;
  }
  car.vx *= 0.9;
  car.vy *= 0.9;
  return impact;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
