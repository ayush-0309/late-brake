// Canvas drawing: scenery, track, cars, ghost, skid marks and the minimap.

import { buildScenery, drawGround, drawMarkings, drawTrackside, drawStructures, makePatterns } from './scenery.js';
import { buildLine } from './line.js';

// Racing line colours by zone: throttle, lift, brake.
const LINE_COLORS = ['rgba(52,210,123,0.5)', 'rgba(245,197,66,0.6)', 'rgba(255,45,72,0.65)'];

const C = {
  grass: '#4b8a40',
  grassStripe: 'rgba(255,255,255,0.035)',
  city: '#a19f97',
  sidewalk: '#c9c6bd',
  barrier: '#26282c',
  barrierTop: '#c9ccd1',
  asphalt: '#3a3c41',
  edge: 'rgba(255,255,255,0.85)',
  kerbRed: '#d8342b',
  kerbWhite: '#f4f4f2',
  skid: 'rgba(20,20,22,0.28)',
  player: '#e8112d',
  ghost: '#4aa3ff',
};

const MAX_SKIDS = 2400;

export function createRenderer(canvas, minimap) {
  const ctx = canvas.getContext('2d');
  const mctx = minimap.getContext('2d');
  const cam = { x: 0, y: 0, a: 0, zoom: 8, ready: false };
  let paths = null;
  let scenery = null;
  let line = null, linePaths = null;
  const pats = makePatterns(ctx);
  let skids = [];
  let lastRear = null;
  let w = 0, h = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const mw = minimap.clientWidth, mh = minimap.clientHeight;
    minimap.width = Math.round(mw * dpr);
    minimap.height = Math.round(mh * dpr);
  }
  addEventListener('resize', resize);
  resize();

  function setTrack(track) {
    paths = buildPaths(track);
    scenery = track.scenery ||= buildScenery(track);
    line = track.line ||= buildLine(track);
    linePaths = track.linePaths ||= buildLinePaths(line);
    skids = [];
    lastRear = null;
    cam.ready = false;
  }

  function resetRun() {
    skids = [];
    lastRear = null;
    cam.ready = false;
  }

  // Called once per physics tick: lays rubber when the car slides or locks up.
  function addSkid(car) {
    const c = Math.cos(car.a), s = Math.sin(car.a);
    const bx = car.x - c * 1.75, by = car.y - s * 1.75;
    const ox = -s * 0.78, oy = c * 0.78;
    const rear = [bx + ox, by + oy, bx - ox, by - oy];
    const skidding = car.speed > 6 && (car.slip > 2.2 || (car.long < -38 && car.speed > 40));
    // A jump (reset to track) breaks the marks instead of joining them up.
    const jumped = lastRear && Math.abs(rear[0] - lastRear[0]) + Math.abs(rear[1] - lastRear[1]) > 4;
    if (skidding && lastRear && !jumped) {
      skids.push([lastRear[0], lastRear[1], rear[0], rear[1]]);
      skids.push([lastRear[2], lastRear[3], rear[2], rear[3]]);
      if (skids.length > MAX_SKIDS) skids.splice(0, skids.length - MAX_SKIDS);
    }
    lastRear = rear;
  }

  // World-space box that covers the (possibly rotated) screen, for culling.
  function viewBox(ax, ay, rot, z) {
    const c = Math.cos(-rot), sn = Math.sin(-rot);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const u = (sx - ax) / z, v = (sy - ay) / z;
      const wx = cam.x + u * c - v * sn, wy = cam.y + u * sn + v * c;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx);
      y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
    }
    return { x0, y0, x1, y1 };
  }

  function draw(session, alpha, opts, frameDt) {
    const car = session.car;
    const x = lerp(car.px, car.x, alpha), y = lerp(car.py, car.y, alpha);
    const a = lerpAngle(car.pa, car.a, alpha);

    // Another view (the 3D cockpit) is drawing the world: just keep the map
    // up to date, and snap the camera when this view comes back.
    if (opts.camera === 'none') {
      cam.ready = false;
      drawMinimap(session, opts.ghost ? session.ghostPose() : null, x, y, a, poses(session.opponents, alpha));
      return;
    }

    // Chase camera turns with the car so "left" is always screen-left, and
    // sits the car low on screen to show the road ahead. Fixed camera keeps
    // north up and leads the car. Both pull back with speed.
    const chase = opts.camera !== 'fixed';
    const lead = Math.min(1, car.speed / 90);
    const look = chase ? 0.2 : 0.4;
    const tx = x + car.vx * look, ty = y + car.vy * look;
    // Chase looks along the screen's height, so zoom is set by height: about
    // 40 m of road ahead at rest, twice that flat out.
    const base = chase ? Math.min(h / 60, w / 30) : Math.max(Math.min(w, h), 0.6 * Math.max(w, h)) / 70;
    const tz = base * (1 - (chase ? 0.5 : 0.45) * lead);
    if (!cam.ready) { cam.x = tx; cam.y = ty; cam.zoom = tz; cam.a = a; cam.ready = true; }
    const k = 1 - Math.exp(-frameDt * (chase ? 9 : 5));
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.zoom += (tz - cam.zoom) * (1 - Math.exp(-frameDt * 1.5));
    cam.a += angleDiff(cam.a, a) * (1 - Math.exp(-frameDt * 6));

    const t = session.track;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = scenery.city ? C.city : C.grass;
    ctx.fillRect(0, 0, w, h);

    const z = cam.zoom;
    const rot = chase ? -Math.PI / 2 - cam.a : 0;
    const ax = w / 2, ay = chase ? h * 0.63 : h / 2;
    ctx.translate(ax, ay);
    ctx.rotate(rot);
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);
    const view = viewBox(ax, ay, rot, z);

    if (!scenery.city) {
      // Grass: soft patches plus faint mowing stripes.
      ctx.fillStyle = pats.grass;
      ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
      const band = 24;
      ctx.fillStyle = C.grassStripe;
      for (let bx = Math.floor(view.x0 / band) * band; bx < view.x1; bx += band) {
        if (Math.round(bx / band) % 2 === 0) ctx.fillRect(bx, view.y0, band, view.y1 - view.y0);
      }
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    if (scenery.city) {
      ctx.strokeStyle = C.sidewalk;
      ctx.lineWidth = (t.halfW + t.runoff + 5) * 2;
      ctx.stroke(paths.center);
    }
    drawGround(ctx, scenery, view, pats);

    // Kerbs sit under the asphalt edge on corners.
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = C.kerbRed;
    ctx.stroke(paths.kerbs);
    ctx.setLineDash([1.6, 1.6]);
    ctx.strokeStyle = C.kerbWhite;
    ctx.stroke(paths.kerbs);
    ctx.setLineDash([]);

    ctx.strokeStyle = C.asphalt;
    ctx.lineWidth = t.halfW * 2;
    ctx.stroke(paths.center);

    ctx.strokeStyle = C.edge;
    ctx.lineWidth = 0.3;
    ctx.stroke(paths.edges);

    drawStartLine(ctx, t);
    drawMarkings(ctx, scenery, view);

    // Racing line: 'full' shows every zone, 'braking' only lifts and stops.
    if (opts.line === 'full' || opts.line === 'braking') {
      ctx.lineCap = 'butt';
      ctx.lineWidth = 1.4;
      for (let z = opts.line === 'braking' ? 1 : 0; z < 3; z++) {
        ctx.strokeStyle = LINE_COLORS[z];
        ctx.stroke(linePaths[z]);
      }
    }

    // Barriers: a steel rail with a dark tyre wall behind it.
    ctx.strokeStyle = C.barrier;
    ctx.lineWidth = 1.4;
    ctx.stroke(paths.barriers);
    ctx.strokeStyle = C.barrierTop;
    ctx.lineWidth = 0.35;
    ctx.stroke(paths.barriers);
    drawTrackside(ctx, scenery, view);
    drawBoards(ctx, line.boards, view);

    if (skids.length) {
      ctx.strokeStyle = C.skid;
      ctx.lineWidth = 0.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const sk of skids) { ctx.moveTo(sk[0], sk[1]); ctx.lineTo(sk[2], sk[3]); }
      ctx.stroke();
    }

    drawStructures(ctx, scenery, view, pats);

    const ghost = opts.ghost ? session.ghostPose() : null;
    if (ghost) drawCar(ctx, ghost.x, ghost.y, ghost.a, 0, C.ghost, 0.5);
    const rivals = poses(session.opponents, alpha);
    for (const r of rivals) {
      if (r.x < view.x0 - 6 || r.x > view.x1 + 6 || r.y < view.y0 - 6 || r.y > view.y1 + 6) continue;
      drawCar(ctx, r.x, r.y, r.a, r.steer, r.color, 1);
    }
    drawCar(ctx, x, y, a, car.steer, C.player, 1);

    drawMinimap(session, ghost, x, y, a, rivals);
  }

  function drawMinimap(session, ghost, x, y, a, rivals = []) {
    if (minimap.width !== Math.round(minimap.clientWidth * dpr)) resize();
    const mw = minimap.width, mh = minimap.height;
    if (!mw || !mh) return;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mw, mh);
    const t = session.track, b = t.bounds, pad = 12 * dpr;
    const sc = Math.min((mw - pad * 2) / (b.maxX - b.minX), (mh - pad * 2) / (b.maxY - b.minY));
    if (!(sc > 0)) return; // map too small to draw into
    const ox = (mw - (b.maxX - b.minX) * sc) / 2 - b.minX * sc;
    const oy = (mh - (b.maxY - b.minY) * sc) / 2 - b.minY * sc;
    const px = (u) => u * dpr / sc; // screen pixels to map units
    mctx.setTransform(sc, 0, 0, sc, ox, oy);
    mctx.lineJoin = 'round';
    mctx.lineCap = 'round';
    mctx.strokeStyle = 'rgba(0,0,0,0.55)';
    mctx.lineWidth = px(6);
    mctx.stroke(paths.center);
    mctx.strokeStyle = 'rgba(255,255,255,0.9)';
    mctx.lineWidth = px(2.6);
    mctx.stroke(paths.center);

    // Start/finish line.
    mctx.strokeStyle = C.player;
    mctx.lineWidth = px(2.4);
    mctx.beginPath();
    mctx.moveTo(t.xs[0] - t.nx[0] * px(6), t.ys[0] - t.ny[0] * px(6));
    mctx.lineTo(t.xs[0] + t.nx[0] * px(6), t.ys[0] + t.ny[0] * px(6));
    mctx.stroke();

    if (ghost) {
      mctx.fillStyle = C.ghost;
      mctx.beginPath();
      mctx.arc(ghost.x, ghost.y, px(3.5), 0, Math.PI * 2);
      mctx.fill();
    }
    for (const r of rivals) {
      mctx.fillStyle = r.color;
      mctx.strokeStyle = 'rgba(0,0,0,0.6)';
      mctx.lineWidth = px(1.2);
      mctx.beginPath();
      mctx.arc(r.x, r.y, px(3.6), 0, Math.PI * 2);
      mctx.fill();
      mctx.stroke();
    }
    // The player is an arrow pointing where the car is heading.
    mctx.save();
    mctx.translate(x, y);
    mctx.rotate(a);
    mctx.scale(px(1), px(1));
    mctx.beginPath();
    mctx.moveTo(8, 0);
    mctx.lineTo(-5, 5.5);
    mctx.lineTo(-2.5, 0);
    mctx.lineTo(-5, -5.5);
    mctx.closePath();
    mctx.fillStyle = C.player;
    mctx.strokeStyle = '#fff';
    mctx.lineWidth = 1.6;
    mctx.stroke();
    mctx.fill();
    mctx.restore();
  }

  return { setTrack, resetRun, addSkid, draw, resize };
}

function buildPaths(t) {
  const center = new Path2D();
  const edges = new Path2D();
  const kerbs = new Path2D();
  const barriers = new Path2D();
  for (let i = 0; i < t.n; i++) {
    i ? center.lineTo(t.xs[i], t.ys[i]) : center.moveTo(t.xs[i], t.ys[i]);
  }
  center.closePath();

  for (const side of [1, -1]) {
    const off = side * (t.halfW - 0.6);
    for (let i = 0; i <= t.n; i++) {
      const j = i % t.n;
      const px = t.xs[j] + t.nx[j] * off, py = t.ys[j] + t.ny[j] * off;
      i ? edges.lineTo(px, py) : edges.moveTo(px, py);
    }
    // Barrier line sits 0.7 m further out so its inner face is the collision limit.
    const run = side > 0 ? t.runR : t.runL;
    for (let i = 0; i <= t.n; i++) {
      const j = i % t.n;
      const o = side * (t.halfW + run[j] + 0.7);
      const px = t.xs[j] + t.nx[j] * o, py = t.ys[j] + t.ny[j] * o;
      i ? barriers.lineTo(px, py) : barriers.moveTo(px, py);
    }
    // Kerb runs wherever the corner is tighter than ~150 m radius.
    const koff = side * (t.halfW + 0.15);
    let open = false;
    for (let i = 0; i <= t.n; i++) {
      const j = i % t.n;
      const on = Math.abs(t.curv[j]) > 1 / 150 && i < t.n;
      const px = t.xs[j] + t.nx[j] * koff, py = t.ys[j] + t.ny[j] * koff;
      if (on && !open) { kerbs.moveTo(px, py); open = true; }
      else if (on) kerbs.lineTo(px, py);
      else open = false;
    }
  }
  return { center, edges, kerbs, barriers };
}

function drawStartLine(ctx, t) {
  ctx.save();
  ctx.translate(t.xs[0], t.ys[0]);
  ctx.rotate(Math.atan2(t.ty[0], t.tx[0]));
  const sq = 1;
  const rows = Math.round((t.halfW * 2) / sq);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#111' : '#f4f4f2';
      ctx.fillRect(c * sq - sq, -t.halfW + r * sq, sq, sq);
    }
  }
  ctx.restore();
}

// Top-down open-wheeler. Local frame: +x forward, +y right, meters.
// Static shapes are built once as Path2D; only the steered front wheels and
// colours change per frame.
const CAR_SHAPES = buildCarShapes();
let carShadow = null;
let bodyShade = null;

function drawCar(ctx, x, y, a, steer, color, alpha) {
  const S = CAR_SHAPES;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.globalAlpha = alpha;
  const carbon = '#16181c';

  // Soft shadow, always falling the same way on the ground whatever the heading.
  if (alpha === 1) {
    carShadow ||= makeCarShadow();
    const ox = Math.cos(a) * 0.35 + Math.sin(a) * 0.45, oy = -Math.sin(a) * 0.35 + Math.cos(a) * 0.45;
    ctx.drawImage(carShadow.canvas, -carShadow.w / 2 + ox, -carShadow.h / 2 + oy, carShadow.w, carShadow.h);
  }

  ctx.fillStyle = carbon;
  ctx.fill(S.floor);

  // Tyres: dark rubber, a worn band down the middle, the compound line outside.
  const tyre = (cx, cy, l, w, rot, side) => {
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.fillStyle = '#141518';
    roundRect(ctx, -l / 2, -w / 2, l, w, 0.1);
    ctx.fill();
    ctx.fillStyle = '#26282d';
    ctx.fillRect(-l / 2 + 0.06, -w * 0.18, l - 0.12, w * 0.36);
    ctx.fillStyle = '#e8302a';
    ctx.fillRect(-l / 2 + 0.1, side * (w / 2 - 0.035) - 0.015, l - 0.2, 0.03);
    ctx.restore();
  };
  for (const side of [-1, 1]) {
    tyre(-1.75, side * 0.78, 0.74, 0.42, 0, side);
    tyre(1.85, side * 0.8, 0.72, 0.32, steer * 0.4, side);
  }

  ctx.strokeStyle = carbon;
  ctx.lineWidth = 0.06;
  ctx.stroke(S.suspension);

  // Front wing: main plane in the livery, a white flap, carbon endplates.
  ctx.fillStyle = color;
  ctx.fill(S.frontMain);
  ctx.fillStyle = '#f2f2f2';
  ctx.fill(S.frontFlap);
  ctx.fillStyle = carbon;
  ctx.fill(S.frontPlates);

  // Body, then shading across it so it reads as rounded.
  ctx.fillStyle = color;
  ctx.fill(S.body);
  bodyShade ||= makeBodyShade(ctx);
  ctx.fillStyle = bodyShade;
  ctx.fill(S.body);
  ctx.fillStyle = carbon;
  ctx.fill(S.inlets);
  ctx.fillStyle = '#f2f2f2';
  ctx.fill(S.stripe);

  // Cockpit, driver and airbox.
  ctx.fillStyle = '#0d0e10';
  ctx.fill(S.cockpit);
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(-0.06, 0, 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#15171b';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.arc(-0.06, 0, 0.115, -0.75, 0.75);
  ctx.stroke();
  ctx.fillStyle = carbon;
  ctx.fill(S.airbox);

  // Halo: a hoop round the driver's head on one strut.
  ctx.strokeStyle = '#2b2e34';
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.07;
  ctx.stroke(S.halo);
  ctx.lineCap = 'butt';

  // Mirrors and the rear wing on top.
  ctx.fillStyle = carbon;
  ctx.fill(S.mirrors);
  ctx.fillStyle = color;
  ctx.fill(S.rearMain);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill(S.rearFlap);
  ctx.fillStyle = color;
  ctx.fill(S.rearPlates);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill(S.rearPlates);

  ctx.restore();
}

function buildCarShapes() {
  const P = () => new Path2D();
  const rect = (path, x0, x1, y0, y1) => path.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  const both = (fn) => { fn(1); fn(-1); };

  // Body outline: nose, sidepods and engine cover, smoothed through these
  // right-hand points and mirrored.
  const half = [
    [2.66, 0.05], [2.45, 0.09], [2.1, 0.13], [1.6, 0.18], [1.1, 0.22], [0.66, 0.27],
    [0.44, 0.42], [0.38, 0.7], [0.18, 0.79], [-0.4, 0.77], [-1.0, 0.6], [-1.5, 0.42],
    [-2.0, 0.22], [-2.42, 0.12],
  ];
  const outline = [...half, ...half.slice().reverse().map(([x, y]) => [x, -y])];
  const body = smoothClosed(outline);

  const inlets = P();
  both((s) => {
    inlets.moveTo(0.43, s * 0.44);
    inlets.lineTo(0.38, s * 0.7);
    inlets.lineTo(0.3, s * 0.68);
    inlets.lineTo(0.35, s * 0.45);
    inlets.closePath();
  });

  const stripe = P();
  stripe.moveTo(2.6, -0.025); stripe.lineTo(2.6, 0.025); stripe.lineTo(0.7, 0.05); stripe.lineTo(0.7, -0.05); stripe.closePath();
  stripe.moveTo(-0.95, -0.05); stripe.lineTo(-0.95, 0.05); stripe.lineTo(-2.35, 0.025); stripe.lineTo(-2.35, -0.025); stripe.closePath();

  const cockpit = P();
  cockpit.moveTo(0.62, 0);
  cockpit.bezierCurveTo(0.6, 0.2, 0.2, 0.24, -0.45, 0.23);
  cockpit.quadraticCurveTo(-0.62, 0.2, -0.62, 0);
  cockpit.quadraticCurveTo(-0.62, -0.2, -0.45, -0.23);
  cockpit.bezierCurveTo(0.2, -0.24, 0.6, -0.2, 0.62, 0);

  const airbox = P();
  airbox.ellipse(-0.78, 0, 0.14, 0.09, 0, 0, Math.PI * 2);

  const halo = P();
  halo.moveTo(0.72, 0);
  halo.lineTo(0.33, 0);
  halo.moveTo(-0.5, -0.29);
  halo.bezierCurveTo(-0.3, -0.46, 0.3, -0.42, 0.33, 0);
  halo.bezierCurveTo(0.3, 0.42, -0.3, 0.46, -0.5, 0.29);

  const floor = P();
  floor.moveTo(1.0, -0.5);
  floor.quadraticCurveTo(0.9, -0.86, 0.6, -0.86);
  floor.lineTo(-1.75, -0.86);
  floor.lineTo(-2.45, -0.6);
  floor.lineTo(-2.45, 0.6);
  floor.lineTo(-1.75, 0.86);
  floor.lineTo(0.6, 0.86);
  floor.quadraticCurveTo(0.9, 0.86, 1.0, 0.5);
  floor.closePath();

  const suspension = P();
  both((s) => {
    for (const [x0, y0, x1, y1] of [
      [1.85, 0.64, 1.5, 0.22], [1.85, 0.64, 2.2, 0.18], [1.83, 0.6, 1.62, 0.24],
      [-1.75, 0.58, -1.42, 0.22], [-1.75, 0.58, -2.08, 0.16],
    ]) {
      suspension.moveTo(x0, s * y0);
      suspension.lineTo(x1, s * y1);
    }
  });

  const frontMain = P(), frontFlap = P(), frontPlates = P();
  rect(frontMain, 2.46, 2.82, -0.95, 0.95);
  both((s) => {
    rect(frontFlap, 2.36, 2.46, s * 0.14, s * 0.95);
    rect(frontPlates, 2.26, 2.86, s * 0.94, s * 0.99);
  });

  const rearMain = P(), rearFlap = P(), rearPlates = P();
  rect(rearMain, -2.95, -2.62, -0.6, 0.6);
  rect(rearFlap, -2.98, -2.82, -0.6, 0.6);
  both((s) => rect(rearPlates, -3.02, -2.45, s * 0.6, s * 0.65));

  const mirrors = P();
  both((s) => {
    rect(mirrors, 0.24, 0.36, s * 0.56, s * 0.72);
    rect(mirrors, 0.28, 0.31, s * 0.48, s * 0.58);
  });

  return { body, inlets, stripe, cockpit, airbox, halo, floor, suspension, frontMain, frontFlap, frontPlates, rearMain, rearFlap, rearPlates, mirrors };
}

// Closed shape through the points, smoothed with curves through midpoints.
function smoothClosed(pts) {
  const p = new Path2D();
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  p.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    p.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  p.closePath();
  return p;
}

// Darker towards the edges with a soft highlight down the spine, so the
// flat-coloured body looks rounded. Gradients live in car space.
function makeBodyShade(ctx) {
  const g = ctx.createLinearGradient(0, -0.8, 0, 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.32, 'rgba(0,0,0,0.06)');
  g.addColorStop(0.44, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.56, 'rgba(255,255,255,0.04)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  return g;
}

// Blurred silhouette, drawn once. Uses shadowBlur (supported everywhere) by
// drawing the shape off the canvas and offsetting its shadow back on.
function makeCarShadow() {
  const PX = 40, w = 7.2, h = 3.0;
  const c = document.createElement('canvas');
  c.width = Math.round(w * PX);
  c.height = Math.round(h * PX);
  const g = c.getContext('2d');
  const off = c.width * 2;
  g.translate(c.width / 2 - off, c.height / 2);
  g.scale(PX, PX);
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 10;
  g.shadowOffsetX = off;
  g.fillStyle = '#000';
  g.fill(CAR_SHAPES.floor);
  g.fill(CAR_SHAPES.body);
  g.fillRect(2.26, -0.98, 0.6, 1.96);
  g.fillRect(-3.02, -0.65, 0.57, 1.3);
  for (const s of [-1, 1]) {
    g.fillRect(-2.12, s * 0.78 - 0.21, 0.74, 0.42);
    g.fillRect(1.49, s * 0.8 - 0.16, 0.72, 0.32);
  }
  return { canvas: c, w, h };
}

// One path per zone. Runs start at a zone change so none is split at index 0,
// and each run ends on the next run's first point so there are no gaps.
function buildLinePaths(line) {
  const paths = [new Path2D(), new Path2D(), new Path2D()];
  const { n, xs, ys, zone } = line;
  let j0 = 0;
  for (let q = 1; q < n; q++) if (zone[q] !== zone[q - 1]) { j0 = q; break; }
  let cur = -1;
  for (let q = 0; q <= n; q++) {
    const j = (j0 + q) % n, z = zone[j];
    if (z !== cur) {
      if (cur >= 0) paths[cur].lineTo(xs[j], ys[j]);
      paths[z].moveTo(xs[j], ys[j]);
      cur = z;
    } else {
      paths[z].lineTo(xs[j], ys[j]);
    }
  }
  return paths;
}

// Braking boards: white signs beside the track, numbers upright for a car
// driving towards the corner.
function drawBoards(ctx, boards, view) {
  const W = 5.6, H = 3.2, S = 20;
  for (const b of boards) {
    if (b.x < view.x0 - 4 || b.x > view.x1 + 4 || b.y < view.y0 - 4 || b.y > view.y1 + 4) continue;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-W / 2 + 0.35, -H / 2 + 0.35, W, H);
    ctx.fillStyle = '#f4f4f2';
    ctx.fillRect(-W / 2, -H / 2, W, H);
    ctx.strokeStyle = '#15171b';
    ctx.lineWidth = 0.2;
    ctx.strokeRect(-W / 2 + 0.3, -H / 2 + 0.3, W - 0.6, H - 0.6);
    ctx.scale(1 / S, 1 / S);
    ctx.font = `800 ${Math.round(2.6 * S)}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#15171b';
    ctx.fillText(b.label, 0, 0.08 * S);
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Interpolated poses of a race's rival cars (none in a time trial).
export function poses(rivals, alpha) {
  if (!rivals) return [];
  return rivals.map((r) => ({
    x: lerp(r.car.px, r.car.x, alpha), y: lerp(r.car.py, r.car.y, alpha),
    a: lerpAngle(r.car.pa, r.car.a, alpha), steer: r.car.steer, color: r.color,
  }));
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

function lerpAngle(a, b, t) {
  return a + angleDiff(a, b) * t;
}

// Circuit outline for the menu. `detail` adds sector colours and a
// direction arrow at the start line.
const SECTOR_COLORS = ['#ff2d48', '#f5c542', '#4aa3ff'];

export function drawTrackPreview(canvas, track, { detail = false } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (cw < 20 || ch < 20) return;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  const ctx = canvas.getContext('2d');
  const b = track.bounds, pad = (detail ? 22 : 5) * dpr;
  const sc = Math.min((canvas.width - pad * 2) / (b.maxX - b.minX), (canvas.height - pad * 2) / (b.maxY - b.minY));
  const ox = (canvas.width - (b.maxX - b.minX) * sc) / 2 - b.minX * sc;
  const oy = (canvas.height - (b.maxY - b.minY) * sc) / 2 - b.minY * sc;
  const px = (u) => (u * dpr) / sc;
  ctx.setTransform(sc, 0, 0, sc, ox, oy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const outline = new Path2D();
  for (let i = 0; i < track.n; i++) outline.lineTo(track.xs[i], track.ys[i]);
  outline.closePath();

  if (!detail) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = px(2.5);
    ctx.stroke(outline);
    return;
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = px(11);
  ctx.stroke(outline);
  // Each sector in its own colour.
  for (let k = 0; k < 3; k++) {
    const i0 = Math.floor((k * track.n) / 3), i1 = Math.floor(((k + 1) * track.n) / 3);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) ctx.lineTo(track.xs[i % track.n], track.ys[i % track.n]);
    ctx.strokeStyle = SECTOR_COLORS[k];
    ctx.lineWidth = px(4.5);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = px(1.2);
  ctx.stroke(outline);

  // Chequered start line and an arrow showing race direction.
  const x0 = track.xs[0], y0 = track.ys[0];
  const ang = Math.atan2(track.ty[0], track.tx[0]);
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(ang);
  ctx.scale(px(1), px(1));
  for (let r = -3; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
      ctx.fillRect(c * 3 - 3, r * 3, 3, 3);
    }
  }
  ctx.translate(0, -16);
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(10, 0);
  ctx.moveTo(4, -5);
  ctx.lineTo(10, 0);
  ctx.lineTo(4, 5);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();
}
