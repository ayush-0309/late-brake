// The 3D open-wheeler, in car space: x forward, y up, z to the driver's
// right, metres, with the ground at y = 0. Proportions follow the 2D car
// (5.6 m long, 2 m wide, axles at +1.85 and −1.75 m).
//
// The body is lofted through cross-sections so it reads as one smooth
// shape: paint on top, bare carbon underneath, a white stripe down the
// spine. Front wheels are a separate mesh so they can steer.

import { builder, boxAt, beam, tube, loft, revolve, hex } from './mesh3d.js';

export const FRONT_AXLE = 1.85;
export const REAR_AXLE = -1.75;
export const FRONT_TRACK = 0.8;     // wheel centre from the car's centre line
export const TYRE_R = 0.36;

const CARBON = hex('#16181c');
const WHITE = hex('#f2f2f2');
const HALO = hex('#2b2e34');
const TYRE = hex('#141518');
const SOFT = hex('#e8302a');          // soft compound: red sidewall band
const RIM = hex('#2c2f35');
const RIM_LIP = hex('#a9aeb6');

const PAINT = 0.75, SATIN = 0.35, RUBBER = 0.06;

// `decals`: atlas rects for the name on the rear wing and the race number.
export function carMesh(livery, W, decals, number = '7') {
  const b = builder();
  const body = hex(livery);

  // Paint on top, bare carbon underneath.
  const paint = () => (i, t) => (Math.sin(t) < -0.35 ? CARBON : body);

  b.gloss = PAINT;
  // Nose: tapers and drops from the cockpit to the front wing.
  const nose = [
    { x: 2.66, hw: 0.06, y0: 0.22, y1: 0.3, p: 3 },
    { x: 2.45, hw: 0.1, y0: 0.21, y1: 0.37, p: 3 },
    { x: 2.1, hw: 0.14, y0: 0.2, y1: 0.45, p: 3 },
    { x: 1.6, hw: 0.19, y0: 0.19, y1: 0.55, p: 3 },
    { x: 1.1, hw: 0.23, y0: 0.18, y1: 0.63, p: 3.4 },
    { x: 0.62, hw: 0.27, y0: 0.16, y1: 0.69, p: 4 },
  ];
  loft(b, nose, { color: paint(), W, capStart: body, capEnd: CARBON, ring: 28 });
  stripe(b, nose, 0.05, WHITE, W);

  // Cockpit tub: the same shape, open on top.
  const tub = [
    { x: 0.62, hw: 0.27, y0: 0.16, y1: 0.69, p: 4 },
    { x: 0.1, hw: 0.3, y0: 0.15, y1: 0.7, p: 4 },
    { x: -0.45, hw: 0.3, y0: 0.15, y1: 0.72, p: 4 },
    { x: -0.66, hw: 0.29, y0: 0.15, y1: 0.75, p: 4 },
  ];
  const OPEN = [125 * Math.PI / 180, 415 * Math.PI / 180];
  loft(b, tub, { color: paint(), W, arc: OPEN });
  // Padded rim round the cockpit opening.
  b.gloss = SATIN;
  for (const t of OPEN) {
    const e = 0.5, c = Math.cos(t), s = Math.sin(t);
    tube(b, tub.map((q) => [q.x, (q.y0 + q.y1) / 2 + ((q.y1 - q.y0) / 2) * Math.sign(s) * Math.abs(s) ** e, q.hw * Math.sign(c) * Math.abs(c) ** e]), 0.025, CARBON, W, 6);
  }

  // Engine cover, and the airbox over the driver's head.
  b.gloss = PAINT;
  const cover = [
    { x: -0.66, hw: 0.29, y0: 0.15, y1: 0.76, p: 3.5 },
    { x: -1.1, hw: 0.26, y0: 0.15, y1: 0.8, p: 3 },
    { x: -1.6, hw: 0.2, y0: 0.15, y1: 0.66, p: 3 },
    { x: -2.1, hw: 0.13, y0: 0.17, y1: 0.5, p: 3 },
    { x: -2.45, hw: 0.09, y0: 0.22, y1: 0.4, p: 3 },
  ];
  loft(b, cover, { color: paint(), W, capStart: CARBON, capEnd: CARBON });
  loft(b, [
    { x: -0.6, hw: 0.12, y0: 0.7, y1: 0.98, p: 2.6 },
    { x: -0.9, hw: 0.14, y0: 0.7, y1: 1.0, p: 2.6 },
    { x: -1.3, hw: 0.1, y0: 0.7, y1: 0.92, p: 2.6 },
    { x: -1.8, hw: 0.05, y0: 0.66, y1: 0.78, p: 2.6 },
  ], { color: paint(), W, capStart: CARBON, capEnd: body });
  // Shark fin with the race number on both sides.
  const fin = [[-1.3, 0.88], [-2.35, 0.8], [-2.35, 0.5], [-1.5, 0.66]];
  b.quad([fin[3][0], fin[3][1], 0], [fin[2][0], fin[2][1], 0], [fin[1][0], fin[1][1], 0], [fin[0][0], fin[0][1], 0], body, W);
  if (decals?.number) {
    for (const s of [-1, 1]) {
      const z = s * 0.004, x0 = -2.05, x1 = -1.75, y0 = 0.62, y1 = 0.78;
      const [l, r] = s > 0 ? [x0, x1] : [x1, x0];
      b.quad([l, y0, z], [r, y0, z], [r, y1, z], [l, y1, z], WHITE, decals.number);
    }
  }

  // Sidepods: wide inlets by the cockpit, tapering away to the gearbox.
  for (const s of [-1, 1]) {
    loft(b, [
      { x: 0.4, hw: 0.16, zc: s * 0.56, y0: 0.24, y1: 0.55, p: 3 },
      { x: 0.15, hw: 0.22, zc: s * 0.58, y0: 0.2, y1: 0.57, p: 3.4 },
      { x: -0.4, hw: 0.21, zc: s * 0.55, y0: 0.17, y1: 0.52, p: 3.4 },
      { x: -1.0, hw: 0.15, zc: s * 0.45, y0: 0.16, y1: 0.4, p: 3 },
      { x: -1.5, hw: 0.08, zc: s * 0.34, y0: 0.17, y1: 0.28, p: 3 },
    ], { color: paint(), W, capStart: CARBON, capEnd: CARBON });
  }

  // Floor and diffuser.
  b.gloss = SATIN;
  boxAt(b, -1.75, 0.95, 0.05, 0.09, -0.86, 0.86, CARBON, W);
  slab(b, [[-1.75, 0.09, -0.6], [-1.75, 0.09, 0.6], [-2.45, 0.3, 0.6], [-2.45, 0.3, -0.6]], 0.03, CARBON, W);

  // Front wing: a main plane and two flaps rising towards the endplates.
  b.gloss = PAINT;
  slab(b, wingTop(2.42, 2.8, 0, 0.95, 0.1, 0.08, 0.02), 0.025, body, W, true);
  for (const s of [-1, 1]) {
    slab(b, wingTop(2.36, 2.58, s * 0.14, s * 0.95, 0.13, 0.19, 0.03), 0.02, body, W);
    slab(b, wingTop(2.3, 2.46, s * 0.16, s * 0.95, 0.17, 0.26, 0.03), 0.018, WHITE, W);
    b.gloss = SATIN;
    boxAt(b, 2.26, 2.86, 0.04, 0.32, s > 0 ? 0.95 : -0.975, s > 0 ? 0.975 : -0.95, CARBON, W);
    b.gloss = PAINT;
  }

  // Rear wing: main plane, DRS flap, endplates with the name, beam wing below.
  slab(b, [[-2.62, 0.8, -0.6], [-2.62, 0.8, 0.6], [-2.95, 0.85, 0.6], [-2.95, 0.85, -0.6]], 0.03, body, W);
  slab(b, [[-2.78, 0.89, -0.6], [-2.78, 0.89, 0.6], [-2.98, 0.96, 0.6], [-2.98, 0.96, -0.6]], 0.02, WHITE, W);
  slab(b, [[-2.6, 0.34, -0.45], [-2.6, 0.34, 0.45], [-2.85, 0.37, 0.45], [-2.85, 0.37, -0.45]], 0.025, CARBON, W);
  for (const s of [-1, 1]) {
    boxAt(b, -3.02, -2.45, 0.32, 1.0, s > 0 ? 0.6 : -0.635, s > 0 ? 0.635 : -0.6, body, W);
    if (decals?.name) {
      const z = s * 0.638, x0 = -2.98, x1 = -2.5, y0 = 0.56, y1 = 0.68;
      const [l, r] = s > 0 ? [x0, x1] : [x1, x0];
      b.quad([l, y0, z], [r, y0, z], [r, y1, z], [l, y1, z], WHITE, decals.name);
    }
  }
  b.gloss = SATIN;
  beam(b, [-2.4, 0.42, 0], [-2.75, 0.82, 0], 0.04, CARBON, W);
  boxAt(b, -2.99, -2.95, 0.29, 0.36, -0.035, 0.035, hex('#ff2a2a'), W);

  // Rear wheels and the wishbones at both ends.
  for (const s of [-1, 1]) {
    tyre(b, REAR_AXLE, 0.37, s * 0.78, 0.21, W);
    b.gloss = SATIN;
    const fz = s * 0.66, rz = s * 0.6;
    for (const [p, q] of [
      [[FRONT_AXLE, 0.47, fz], [1.55, 0.5, s * 0.24]], [[FRONT_AXLE, 0.47, fz], [2.15, 0.48, s * 0.2]],
      [[FRONT_AXLE, 0.24, fz], [1.5, 0.24, s * 0.22]], [[FRONT_AXLE, 0.24, fz], [2.2, 0.25, s * 0.18]],
      [[1.83, 0.26, s * 0.62], [1.62, 0.56, s * 0.24]], [[1.95, 0.32, s * 0.64], [1.95, 0.34, s * 0.22]],
      [[REAR_AXLE, 0.5, rz], [-1.45, 0.45, s * 0.2]], [[REAR_AXLE, 0.5, rz], [-2.05, 0.48, s * 0.18]],
      [[REAR_AXLE, 0.24, rz], [-1.4, 0.2, s * 0.22]], [[REAR_AXLE, 0.24, rz], [-2.1, 0.22, s * 0.15]],
    ]) tube(b, [p, q], 0.018, CARBON, W, 6);

    // Mirrors on stalks, glass facing back.
    tube(b, [[0.3, 0.55, s * 0.5], [0.3, 0.68, s * 0.6]], 0.012, CARBON, W, 6);
    b.gloss = PAINT;
    loft(b, [
      { x: 0.37, hw: 0.09, zc: s * 0.64, y0: 0.68, y1: 0.77, p: 3 },
      { x: 0.27, hw: 0.095, zc: s * 0.64, y0: 0.675, y1: 0.775, p: 3.5 },
    ], { color: () => body, W, capStart: body, capEnd: hex('#3a4654'), ring: 14 });
  }

  // Halo: a round tube hoop on a single central strut.
  b.gloss = SATIN;
  tube(b, [[0.74, 0.69, 0], [0.6, 0.89, 0], [0.45, 1.05, 0], [0.33, 1.14, 0]], 0.026, HALO, W, 8);
  const C = -0.1, R = 0.43, Y = 1.15;
  for (const s of [-1, 1]) {
    const path = [];
    for (let d = 0; d <= 115; d += 10) {
      const a = d * Math.PI / 180;
      path.push([C + Math.cos(a) * R, Y - (d / 115) * 0.04, s * Math.sin(a) * R]);
    }
    path.push([-0.5, 0.74, s * 0.29]);
    tube(b, path, 0.019, HALO, W, 8);
  }
  b.gloss = 0;
  return b;
}

// One front wheel centred on its hub, so it can be placed and steered.
export function frontWheelMesh(W) {
  const b = builder();
  tyre(b, 0, 0, 0, 0.16, W);
  b.gloss = SATIN;
  boxAt(b, -0.08, 0.08, -0.13, 0.13, -0.2, -0.12, CARBON, W); // brake duct, inboard side
  boxAt(b, -0.08, 0.08, -0.13, 0.13, 0.12, 0.2, CARBON, W);
  b.gloss = 0;
  return b;
}

// The other car's driver (the ghost); the camera sits inside our own.
export function driverMesh(W) {
  const b = builder();
  // Yellow helmet with a dark visor band across the front.
  const visor = (i, t) => ((i === 1 || i === 2) && Math.sin(t) > -0.1 && Math.sin(t) < 0.5 ? hex('#15171b') : hex('#ffd23f'));
  b.gloss = PAINT;
  loft(b, [
    { x: 0.07, hw: 0.04, y0: 0.86, y1: 0.92, p: 2 },
    { x: 0.03, hw: 0.11, y0: 0.79, y1: 0.99, p: 2 },
    { x: -0.06, hw: 0.14, y0: 0.76, y1: 1.02, p: 2 },
    { x: -0.16, hw: 0.13, y0: 0.76, y1: 1.0, p: 2 },
    { x: -0.24, hw: 0.08, y0: 0.79, y1: 0.95, p: 2 },
    { x: -0.27, hw: 0.02, y0: 0.85, y1: 0.88, p: 2 },
  ], { color: visor, W, capStart: hex('#15171b'), capEnd: hex('#ffd23f'), ring: 16 });
  b.gloss = SATIN;
  boxAt(b, -0.35, 0.05, 0.6, 0.74, -0.2, 0.2, hex('#1b1c20'), W);
  b.gloss = 0;
  return b;
}

// Steering wheel round its pivot: grips, a display and coloured buttons.
export function steeringWheelMesh(W) {
  const b = builder();
  b.gloss = SATIN;
  const carbon = hex('#1b1d21'), grip = hex('#2a2c31');
  boxAt(b, -0.02, 0.02, -0.06, 0.05, -0.1, 0.1, carbon, W);
  for (const s of [-1, 1]) tube(b, [[0, -0.08, s * 0.12], [0, 0.07, s * 0.125]], 0.022, grip, W, 8);
  boxAt(b, -0.025, 0.022, -0.02, 0.035, -0.05, 0.05, hex('#0d3b2e'), W);
  // Buttons on the face towards the driver: three below the display, two above.
  for (const [z, y, c] of [[-0.06, -0.04, '#ffd23f'], [0, -0.04, '#4aa3ff'], [0.06, -0.04, '#34d27b'], [-0.07, 0.042, '#ff2d48'], [0.07, 0.042, '#ff8000']]) {
    boxAt(b, -0.028, -0.018, y - 0.008, y + 0.008, z - 0.008, z + 0.008, hex(c), W);
  }
  b.gloss = 0;
  return b;
}

// A thin painted strip along the top centre of lofted sections.
function stripe(b, sections, width, color, W) {
  for (let i = 0; i + 1 < sections.length; i++) {
    const a = sections[i], c = sections[i + 1], h = 0.004;
    b.quad([a.x, a.y1 + h, -width / 2], [a.x, a.y1 + h, width / 2], [c.x, c.y1 + h, width / 2], [c.x, c.y1 + h, -width / 2], color, W);
  }
}

// Tyre with rounded shoulders, a compound band on each sidewall, a wheel
// cover and a polished rim lip. Axle along z through (x, y, z).
function tyre(b, x, y, z, hw, W) {
  const rim = 0.235;
  b.gloss = RUBBER;
  revolve(b, x, y, [
    [rim, z - hw + 0.012], [0.3, z - hw], [0.34, z - hw + 0.012], [TYRE_R, z - hw + 0.045],
    [TYRE_R, z + hw - 0.045], [0.34, z + hw - 0.012], [0.3, z + hw], [rim, z + hw - 0.012],
  ], TYRE, W);
  for (const s of [-1, 1]) {
    b.gloss = 0.2;
    revolve(b, x, y, [[0.293, z + s * (hw + 0.002)], [0.312, z + s * (hw + 0.0015)]], SOFT, W);
    b.gloss = 0.55;
    revolve(b, x, y, [[0.002, z + s * (hw - 0.03)], [rim - 0.01, z + s * (hw - 0.014)]], RIM, W, 20);
    revolve(b, x, y, [[rim - 0.012, z + s * (hw - 0.012)], [rim + 0.004, z + s * (hw - 0.012)]], RIM_LIP, W, 20);
  }
}

// Top surface corners for a wing element from chord x0 (trailing) to x1
// (leading), across z0..z1, with its leading edge at heights yA (inboard)
// and yB (outboard) and the trailing edge raised by `lift`.
function wingTop(x0, x1, z0, z1, yA, yB, lift) {
  return [[x1, yA, z0], [x1, yB, z1], [x0, yB + lift, z1], [x0, yA + lift, z0]];
}

// A thin plate: four top corners, extruded down by `t`. `mirror` also
// builds the same plate reflected across the centre line.
function slab(b, top, t, color, W, mirror = false) {
  const sets = mirror ? [top, top.map(([x, y, z]) => [x, y, -z])] : [top];
  for (const pts of sets) {
    const bot = pts.map(([x, y, z]) => [x, y - t, z]);
    b.quad(pts[0], pts[1], pts[2], pts[3], color, W);
    b.quad(bot[3], bot[2], bot[1], bot[0], color, W);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      b.quad(bot[k], bot[k1], pts[k1], pts[k], color, W);
    }
  }
}
