// Canvas drawing: scenery, track, cars, ghost, skid marks and the minimap.

import { buildScenery, drawGround, drawMarkings, drawTrackside, drawStructures, makePatterns } from './scenery.js';

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
  const cam = { x: 0, y: 0, zoom: 8, ready: false };
  let paths = null;
  let scenery = null;
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
    if (skidding && lastRear) {
      skids.push([lastRear[0], lastRear[1], rear[0], rear[1]]);
      skids.push([lastRear[2], lastRear[3], rear[2], rear[3]]);
      if (skids.length > MAX_SKIDS) skids.splice(0, skids.length - MAX_SKIDS);
    }
    lastRear = rear;
  }

  function draw(session, alpha, opts, frameDt) {
    const car = session.car;
    const x = lerp(car.px, car.x, alpha), y = lerp(car.py, car.y, alpha);
    const a = lerpAngle(car.pa, car.a, alpha);

    // Camera leads the car a little and pulls back with speed.
    const lead = Math.min(1, car.speed / 90);
    const tx = x + car.vx * 0.4, ty = y + car.vy * 0.4;
    const base = Math.max(Math.min(w, h), 0.6 * Math.max(w, h)) / 70;
    const tz = base * (1 - 0.45 * lead);
    if (!cam.ready) { cam.x = tx; cam.y = ty; cam.zoom = tz; cam.ready = true; }
    const k = 1 - Math.exp(-frameDt * 5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.zoom += (tz - cam.zoom) * (1 - Math.exp(-frameDt * 1.5));

    const t = session.track;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = scenery.city ? C.city : C.grass;
    ctx.fillRect(0, 0, w, h);

    const z = cam.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - cam.x * z), dpr * (h / 2 - cam.y * z));
    const view = {
      x0: cam.x - w / 2 / z, x1: cam.x + w / 2 / z,
      y0: cam.y - h / 2 / z, y1: cam.y + h / 2 / z,
    };

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

    // Barriers: a steel rail with a dark tyre wall behind it.
    ctx.strokeStyle = C.barrier;
    ctx.lineWidth = 1.4;
    ctx.stroke(paths.barriers);
    ctx.strokeStyle = C.barrierTop;
    ctx.lineWidth = 0.35;
    ctx.stroke(paths.barriers);
    drawTrackside(ctx, scenery, view);

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
    drawCar(ctx, x, y, a, car.steer, C.player, 1);

    drawMinimap(session, ghost, x, y);
  }

  function drawMinimap(session, ghost, x, y) {
    if (minimap.width !== Math.round(minimap.clientWidth * dpr)) resize();
    const mw = minimap.width, mh = minimap.height;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mw, mh);
    const b = session.track.bounds, pad = 14 * dpr;
    const sc = Math.min((mw - pad * 2) / (b.maxX - b.minX), (mh - pad * 2) / (b.maxY - b.minY));
    const ox = (mw - (b.maxX - b.minX) * sc) / 2 - b.minX * sc;
    const oy = (mh - (b.maxY - b.minY) * sc) / 2 - b.minY * sc;
    mctx.setTransform(sc, 0, 0, sc, ox, oy);
    mctx.lineJoin = 'round';
    mctx.strokeStyle = 'rgba(255,255,255,0.85)';
    mctx.lineWidth = 3.2 * dpr / sc;
    mctx.stroke(paths.center);
    const dot = (px, py, col, r) => {
      mctx.fillStyle = col;
      mctx.beginPath();
      mctx.arc(px, py, (r * dpr) / sc, 0, Math.PI * 2);
      mctx.fill();
    };
    if (ghost) dot(ghost.x, ghost.y, C.ghost, 4);
    dot(x, y, C.player, 4.5);
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
function drawCar(ctx, x, y, a, steer, color, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.globalAlpha = alpha;
  const dark = '#15171b';

  if (alpha === 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0.1, 0.35, 2.9, 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tyres: fronts steer, rears are wider.
  ctx.fillStyle = dark;
  for (const wy of [-0.8, 0.8]) {
    ctx.save();
    ctx.translate(1.85, wy);
    ctx.rotate(steer * 0.4);
    ctx.fillRect(-0.36, -0.16, 0.72, 0.32);
    ctx.restore();
    ctx.fillRect(-1.75 - 0.37, wy * 0.98 - 0.21, 0.74, 0.42);
  }

  // Suspension arms.
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  for (const wy of [-0.8, 0.8]) {
    ctx.moveTo(1.85, wy * 0.8); ctx.lineTo(1.2, wy * 0.2);
    ctx.moveTo(1.85, wy * 0.8); ctx.lineTo(1.75, wy * 0.2);
    ctx.moveTo(-1.75, wy * 0.75); ctx.lineTo(-1.3, wy * 0.35);
  }
  ctx.stroke();

  // Front wing and rear wing.
  ctx.fillStyle = color;
  ctx.fillRect(2.45, -0.95, 0.32, 1.9);
  ctx.fillStyle = dark;
  ctx.fillRect(2.45, -0.98, 0.32, 0.1);
  ctx.fillRect(2.45, 0.88, 0.32, 0.1);
  ctx.fillRect(-2.8, -0.7, 0.42, 1.4);
  ctx.fillStyle = color;
  ctx.fillRect(-2.74, -0.62, 0.3, 1.24);

  // Chassis: nose, cockpit section, sidepods tapering to the gearbox.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(2.6, -0.1);
  ctx.lineTo(2.6, 0.1);
  ctx.lineTo(1.0, 0.28);
  ctx.lineTo(0.55, 0.3);
  ctx.quadraticCurveTo(0.25, 0.72, -0.35, 0.72);
  ctx.lineTo(-1.1, 0.62);
  ctx.quadraticCurveTo(-1.9, 0.4, -2.4, 0.22);
  ctx.lineTo(-2.4, -0.22);
  ctx.quadraticCurveTo(-1.9, -0.4, -1.1, -0.62);
  ctx.lineTo(-0.35, -0.72);
  ctx.quadraticCurveTo(0.25, -0.72, 0.55, -0.3);
  ctx.lineTo(1.0, -0.28);
  ctx.closePath();
  ctx.fill();

  // Livery stripe along the spine.
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(2.55, -0.04); ctx.lineTo(2.55, 0.04); ctx.lineTo(0.9, 0.09); ctx.lineTo(0.9, -0.09);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-2.35, -0.08, 1.9, 0.16);

  // Cockpit, driver's helmet and the halo.
  ctx.fillStyle = dark;
  roundRect(ctx, -0.25, -0.26, 0.95, 0.52, 0.2);
  ctx.fill();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(0.05, 0, 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#9aa0a8';
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.moveTo(-0.3, -0.3);
  ctx.quadraticCurveTo(0.75, -0.34, 0.8, 0);
  ctx.quadraticCurveTo(0.75, 0.34, -0.3, 0.3);
  ctx.moveTo(0.8, 0);
  ctx.lineTo(1.0, 0);
  ctx.stroke();

  // Airbox behind the driver.
  ctx.fillStyle = dark;
  roundRect(ctx, -0.75, -0.14, 0.4, 0.28, 0.1);
  ctx.fill();

  ctx.restore();
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

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export function drawTrackPreview(canvas, track) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (cw < 40 || ch < 40) return;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  const ctx = canvas.getContext('2d');
  const b = track.bounds, pad = 16 * dpr;
  const sc = Math.min((canvas.width - pad * 2) / (b.maxX - b.minX), (canvas.height - pad * 2) / (b.maxY - b.minY));
  const ox = (canvas.width - (b.maxX - b.minX) * sc) / 2 - b.minX * sc;
  const oy = (canvas.height - (b.maxY - b.minY) * sc) / 2 - b.minY * sc;
  ctx.setTransform(sc, 0, 0, sc, ox, oy);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < track.n; i++) ctx.lineTo(track.xs[i], track.ys[i]);
  ctx.closePath();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = (5 * dpr) / sc;
  ctx.stroke();
  ctx.fillStyle = '#e8112d';
  ctx.beginPath();
  ctx.arc(track.xs[0], track.ys[0], (6 * dpr) / sc, 0, Math.PI * 2);
  ctx.fill();
}
