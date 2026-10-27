// First-person (cockpit) view, drawn with WebGL. The world is built once per
// circuit from the same track and scenery data the 2D view uses, so physics,
// timing and the HUD don't change.
//
// The circuit is flat, so ground layers (grass, runoff, tarmac, kerbs, paint)
// are drawn in order with depth testing off, and only things that stand up
// (barriers, boards, stands, trees, cars) use the depth buffer.
//
// World coordinates: x east, y up, z south (the 2D game's y). Car space:
// x forward, y up, z to the driver's right.

import { buildScenery } from './scenery.js';
import { poses } from './render.js';
import { buildLine } from './line.js';
import { adsFor, drawAd } from './ads.js';
import { STRIDE, builder, boxAt, hex, mulc, norm, sub, cross, dot } from './mesh3d.js';
import { carMesh, frontWheelMesh, driverMesh, steeringWheelMesh, FRONT_AXLE, FRONT_TRACK, TYRE_R } from './car3d.js';

const EYE = [-0.1, 0.97, 0];          // driver's eye in car space, just under the halo
const LOOK_DROP = 0.35;               // eyes pitched down slightly, m over 10 m
const WHEEL_LOCK = 0.35;              // front wheels' angle at full steering, radians
const FOV = 80;                       // horizontal field of view at rest, degrees
const FOV_SPEED = 8;                  // extra degrees flat out
const NEAR = 0.08, FAR = 2400;
const SUN = norm([0.38, 0.86, 0.34]);
const HAZE = hex('#bccfe0');          // fog and the sky at the horizon
const SKY_TOP = hex('#5d8fd0');
const ATLAS = 1024;
const LINE_COLORS = ['#34d27b', '#f5c542', '#ff2d48'];

const VERT = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
attribute vec2 aUv;
attribute float aGloss;
uniform mat4 uVP;
uniform mat4 uModel;
uniform vec3 uEye;
uniform vec2 uTile;     // world-space tiling (metres per repeat); 0 = use aUv
uniform vec2 uTileOrigin;
varying vec3 vCol;
varying vec2 vUv;
varying vec3 vNrm;
varying float vGloss;
varying vec3 vRel;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  gl_Position = uVP * wp;
  vNrm = (uModel * vec4(aNrm, 0.0)).xyz;
  vGloss = aGloss;
  vCol = aCol;
  vUv = uTile.x > 0.0 ? (wp.xz - uTileOrigin) / uTile : aUv;
  vRel = wp.xyz - uEye;
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
uniform vec3 uSun;
uniform vec3 uSky;
uniform vec3 uFog;
uniform vec2 uFogRange;
uniform float uAlpha;
varying vec3 vCol;
varying vec2 vUv;
varying vec3 vNrm;
varying float vGloss;
varying vec3 vRel;
void main() {
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * uAlpha;
  if (a < 0.03) discard;
  // Normals are turned to face the viewer, so either winding lights the same.
  vec3 v = normalize(-vRel);
  vec3 n = normalize(vNrm);
  if (dot(n, v) < 0.0) n = -n;
  vec3 c = vCol * t.rgb * (0.55 + 0.45 * max(dot(n, uSun), 0.0));
  // Glossy surfaces (paint, carbon, rims): a sun highlight, and the sky
  // reflected at grazing angles.
  if (vGloss > 0.0) {
    float spec = pow(max(dot(n, normalize(uSun + v)), 0.0), 60.0);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    c = mix(c, uSky, fres * vGloss * 0.5) + vec3(spec * vGloss * 0.8);
  }
  // Distance per pixel: ground triangles are huge, so a per-vertex
  // distance blended across them would fog the near ground too.
  float f = clamp((length(vRel) - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  gl_FragColor = vec4(mix(c, uFog, f), a);
}`;

// Returns null when WebGL isn't available.
export function createView3D(canvas) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' })
      || canvas.getContext('experimental-webgl');
  } catch {}
  if (!gl) return null;

  let prog, loc, tex, aniso;
  let world = null, worldTrack = null, atlas = null;
  let car = null, ghostCar = null, driver = null, frontWheel = null, wheel = null, sky = null, shadow = null;
  let liveries = new Map(); // rival colour -> car mesh
  let lost = false;
  let w = 0, h = 0, dpr = 1;

  function init() {
    prog = program(gl, VERT, FRAG);
    loc = {};
    for (const a of ['aPos', 'aNrm', 'aCol', 'aUv', 'aGloss']) loc[a] = gl.getAttribLocation(prog, a);
    for (const u of ['uVP', 'uModel', 'uEye', 'uSun', 'uSky', 'uTile', 'uTileOrigin', 'uTex', 'uFog', 'uFogRange', 'uAlpha']) {
      loc[u] = gl.getUniformLocation(prog, u);
    }
    aniso = gl.getExtension('EXT_texture_filter_anisotropic')
      || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    tex = {
      grass: texture(gl, groundCanvas('grass'), true, aniso),
      asphalt: texture(gl, groundCanvas('asphalt'), true, aniso),
      gravel: texture(gl, groundCanvas('gravel'), true, aniso),
    };
    world = null;
    worldTrack = null;
    car = ghostCar = driver = frontWheel = wheel = sky = shadow = null;
  }
  init();

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; init(); });

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
  }

  function setTrack(track) {
    if (worldTrack === track && world) return;
    worldTrack = track;
    const sc = track.scenery ||= buildScenery(track);
    const line = track.line ||= buildLine(track);
    if (atlas) gl.deleteTexture(atlas.tex);
    atlas = makeAtlas(track);
    atlas.tex = texture(gl, atlas.canvas, false, aniso);
    // Ad text uses the web font; redraw the atlas once it has loaded.
    document.fonts?.load("800 40px 'Barlow Condensed'").then(() => {
      if (!atlas || worldTrack !== track) return;
      paintAtlas(atlas, track);
      gl.bindTexture(gl.TEXTURE_2D, atlas.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
    }).catch(() => {});
    if (world) for (const m of Object.values(world).flat()) if (m?.buf) gl.deleteBuffer(m.buf);
    world = buildWorld(gl, track, sc, line, atlas);
    // Cars use this atlas's decals, so they're rebuilt with it.
    for (const m of [car, ghostCar, driver, frontWheel, wheel, sky, shadow, ...liveries.values()]) if (m) gl.deleteBuffer(m.buf);
    liveries = new Map();
    const W = atlas.white, decals = { name: atlas.decalName, number: atlas.decalNumber };
    car = mesh(gl, carMesh('#e8112d', W, decals));
    ghostCar = mesh(gl, carMesh('#4aa3ff', W, decals));
    driver = mesh(gl, driverMesh(W));
    frontWheel = mesh(gl, frontWheelMesh(W));
    wheel = mesh(gl, steeringWheelMesh(W));
    sky = mesh(gl, skyMesh(W));
    shadow = mesh(gl, shadowMesh(atlas.shadow));
  }

  function draw(session, alpha, opts) {
    if (lost) return;
    resize();
    setTrack(session.track);
    const c = session.car;
    const x = lerp(c.px, c.x, alpha), y = lerp(c.py, c.y, alpha);
    const a = lerpAngle(c.pa, c.a, alpha);
    const M = carMatrix(x, y, a);

    // A little shake over the kerbs and on the grass.
    const rough = c.speed > 5 && (c.kerb || !c.onTrack) ? Math.min(1, c.speed / 40) : 0;
    const shake = rough ? (Math.random() - 0.5) * 0.02 * rough : 0;
    const eye = apply(M, [EYE[0], EYE[1] + shake, EYE[2]]);
    const look = apply(M, [EYE[0] + 10, EYE[1] - LOOK_DROP + shake, EYE[2]]);
    const aspect = w / h;
    const hfov = (FOV + FOV_SPEED * Math.min(1, c.speed / 90)) * Math.PI / 180;
    let vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    vfov = Math.max(0.6, Math.min(1.45, vfov));
    const VP = mul(perspective(vfov, aspect, NEAR, FAR), lookAt(eye, look, [0, 1, 0]));

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(HAZE[0], HAZE[1], HAZE[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.uVP, false, VP);
    gl.uniform3fv(loc.uEye, eye);
    gl.uniform3fv(loc.uSun, SUN);
    gl.uniform3fv(loc.uSky, SKY_TOP);
    gl.uniform3fv(loc.uFog, HAZE);
    gl.disable(gl.CULL_FACE);
    const fog = world.fog;

    // Sky, then the flat ground layers in order, no depth.
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    drawMesh(sky, atlas.tex, { model: translation(eye), fog: [1e6, 2e6] });
    // Texture coordinates are taken relative to a nearby point (a multiple of
    // every tile size) so they stay small and precise far from the origin.
    const ground = { fog, tileOrigin: [Math.floor(eye[0] / 120) * 120, Math.floor(eye[2] / 120) * 120] };
    drawMesh(world.ground, tex[world.groundTex], { ...ground, tile: world.groundTile });
    drawMesh(world.stripes, tex.grass, { ...ground, tile: [12, 12] });
    drawMesh(world.tarmac, tex.asphalt, { ...ground, tile: [5, 5] });
    drawMesh(world.gravel, tex.gravel, { ...ground, tile: [3, 3] });
    drawMesh(world.paint, atlas.tex, { fog });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawMesh(world.logos, atlas.tex, { fog, alpha: 0.85 });
    if (opts.line === 'full' || opts.line === 'braking') {
      for (let z = opts.line === 'braking' ? 1 : 0; z < 3; z++) drawMesh(world.line[z], atlas.tex, { fog, alpha: 0.6 });
    }
    const g = opts.ghost ? session.ghostPose() : null;
    const G = g ? carMatrix(g.x, g.y, g.a) : null;
    const rivals = poses(session.opponents, alpha).map((r) => ({ ...r, M: carMatrix(r.x, r.y, r.a) }));
    drawMesh(shadow, atlas.tex, { model: M, fog, alpha: 0.55 });
    if (G) drawMesh(shadow, atlas.tex, { model: G, fog, alpha: 0.3 });
    for (const r of rivals) drawMesh(shadow, atlas.tex, { model: r.M, fog, alpha: 0.55 });
    gl.disable(gl.BLEND);

    // Everything that stands up.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    drawMesh(world.solid, atlas.tex, { fog });
    drawMesh(car, atlas.tex, { model: M, fog });
    drawFrontWheels(M, c.steer, {});
    for (const r of rivals) {
      if (!liveries.has(r.color)) liveries.set(r.color, mesh(gl, carMesh(r.color, atlas.white, { name: atlas.decalName, number: atlas.decalNumber })));
      drawMesh(liveries.get(r.color), atlas.tex, { model: r.M, fog });
      drawMesh(driver, atlas.tex, { model: r.M, fog });
      drawFrontWheels(r.M, r.steer, {});
    }
    drawMesh(wheel, atlas.tex, { model: mul(M, mul(translation([0.46, 0.64, 0]), rotX(c.steer * 1.7))), fog });

    if (G) {
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      const ghost = { fog, alpha: 0.42 };
      drawMesh(ghostCar, atlas.tex, { model: G, ...ghost });
      drawMesh(driver, atlas.tex, { model: G, ...ghost });
      drawFrontWheels(G, 0, ghost);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    function drawFrontWheels(model, steer, o) {
      for (const s of [-1, 1]) {
        const at = mul(model, mul(translation([FRONT_AXLE, TYRE_R, s * FRONT_TRACK]), rotY(-steer * WHEEL_LOCK)));
        drawMesh(frontWheel, atlas.tex, { model: at, fog, ...o });
      }
    }
  }

  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  function drawMesh(m, t, { model = IDENTITY, fog = [1e6, 2e6], tile = [0, 0], tileOrigin = [0, 0], alpha = 1 } = {}) {
    if (!m || !m.count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    const F = 4;
    attrib(loc.aPos, 3, 0);
    attrib(loc.aNrm, 3, 3 * F);
    attrib(loc.aCol, 3, 6 * F);
    attrib(loc.aUv, 2, 9 * F);
    attrib(loc.aGloss, 1, 11 * F);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(loc.uTex, 0);
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniform2fv(loc.uFogRange, fog);
    gl.uniform2fv(loc.uTile, tile);
    gl.uniform2fv(loc.uTileOrigin, tileOrigin);
    gl.uniform1f(loc.uAlpha, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }

  function attrib(l, size, offset) {
    if (l < 0) return;
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE * 4, offset);
  }

  return { draw, setTrack, resize };
}

// ---------- world ----------

function buildWorld(gl, t, sc, line, atlas) {
  const W = atlas.white;
  const N = t.n, hw = t.halfW;
  const P = (x, z, y = 0) => [x, y, z];
  const at = (i, lat) => {
    const j = ((i % N) + N) % N;
    return [t.xs[j] + t.nx[j] * lat, t.ys[j] + t.ny[j] * lat];
  };
  const run = (i, side) => (side > 0 ? t.runR : t.runL)[((i % N) + N) % N];

  // Band alongside the centreline between two lateral offsets, every `step` samples.
  const band = (b, latA, latB, color, { step = 1, from = 0, to = N, y = 0 } = {}) => {
    for (let i = from; i < to; i += step) {
      const k = Math.min(i + step, to);
      const la = typeof latA === 'function' ? latA : () => latA;
      const lb = typeof latB === 'function' ? latB : () => latB;
      const [ax, az] = at(i, la(i)), [bx, bz] = at(i, lb(i));
      const [cx, cz] = at(k, lb(k)), [dx, dz] = at(k, la(k));
      const col = typeof color === 'function' ? color(i) : color;
      if (col) b.quad(P(ax, az, y), P(bx, bz, y), P(cx, cz, y), P(dx, dz, y), col, W);
    }
  };
  // Strip between two matching point lists.
  const between = (b, A, B, color, y = 0) => {
    for (let k = 0; k + 1 < A.length; k++) {
      b.quad(P(A[k][0], A[k][1], y), P(B[k][0], B[k][1], y), P(B[k + 1][0], B[k + 1][1], y), P(A[k + 1][0], A[k + 1][1], y), color, W);
    }
  };
  // Thin painted line along a point list.
  const stroke = (b, pts, width, color) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
      const ox = (-dz / l) * width / 2, oz = (dx / l) * width / 2;
      b.quad(P(x0 - ox, z0 - oz), P(x0 + ox, z0 + oz), P(x1 + ox, z1 + oz), P(x1 - ox, z1 - oz), color, W);
    }
  };
  // Vertical wall along a point list from y0 to y1.
  const wall = (b, pts, y0, y1, color) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
      b.quad(P(x0, z0, y0), P(x1, z1, y0), P(x1, z1, y1), P(x0, z0, y1), color, W);
    }
  };

  const city = sc.city;
  const out = { fog: city ? [160, 900] : [240, 1150] };

  // ---- ground: a huge plane, then mowing stripes over the circuit area
  const g = builder();
  const bb = t.bounds, FAR_EDGE = 4000;
  const groundCol = city ? hex('#a19f97') : hex('#4f9044');
  g.quad(P(bb.minX - FAR_EDGE, bb.minY - FAR_EDGE), P(bb.maxX + FAR_EDGE, bb.minY - FAR_EDGE),
    P(bb.maxX + FAR_EDGE, bb.maxY + FAR_EDGE), P(bb.minX - FAR_EDGE, bb.maxY + FAR_EDGE), groundCol, W);
  out.ground = mesh(gl, g);
  out.groundTex = city ? 'asphalt' : 'grass';
  out.groundTile = city ? [6, 6] : [12, 12];
  const st = builder();
  if (!city) {
    const M = 400, band24 = 24;
    for (let bx = Math.floor((bb.minX - M) / band24) * band24; bx < bb.maxX + M; bx += band24 * 2) {
      st.quad(P(bx, bb.minY - M), P(bx + band24, bb.minY - M), P(bx + band24, bb.maxY + M), P(bx, bb.maxY + M), mulc(groundCol, 1.07), W);
    }
  }
  out.stripes = mesh(gl, st);

  // ---- tarmac: sidewalks (city), runoff, pit lane, the track itself
  const tm = builder();
  if (city) {
    const sw = hex('#c9c6bd');
    band(tm, hw, hw + t.runoff + 5, sw, { step: 2 });
    band(tm, -hw - t.runoff - 5, -hw, sw, { step: 2 });
  }
  const gv = builder();
  for (const r of sc.runoffs) between(r.kind === 'gravel' ? gv : tm, r.inner, r.outer, r.kind === 'gravel' ? hex('#d2bb90') : hex('#5a5d64'));
  if (sc.pit) between(tm, sc.pit.lane.inner, sc.pit.lane.outer, hex('#45484e'));
  band(tm, -hw, hw, hex('#4a4c52'));
  out.tarmac = mesh(gl, tm);
  out.gravel = mesh(gl, gv);

  // ---- paint: kerbs, edge lines, start line, pit lines
  const pa = builder();
  const red = hex('#d8342b'), white = hex('#f4f4f2'), dark = hex('#16171a');
  for (const side of [1, -1]) {
    band(pa, side * (hw - 0.5), side * (hw + 0.8), (i) => Math.abs(t.curv[i]) > 1 / 150 ? (i % 2 ? red : white) : null);
    band(pa, side * (hw - 0.75), side * (hw - 0.45), (i) => Math.abs(t.curv[i]) > 1 / 150 ? null : white, { step: 2 });
  }
  {
    const tx = t.tx[0], tz = t.ty[0], nx = t.nx[0], nz = t.ny[0];
    const rows = Math.round(hw * 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 2; c++) {
        const u0 = c - 1, u1 = c, v0 = -hw + r, v1 = v0 + 1;
        const p = (u, v) => P(t.xs[0] + tx * u + nx * v, t.ys[0] + tz * u + nz * v);
        pa.quad(p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1), (r + c) % 2 ? dark : white, W);
      }
    }
  }
  if (sc.pit) for (const l of sc.pit.laneLines) stroke(pa, l, 0.3, white);
  for (const gs of sc.grid) {
    const c = Math.cos(gs.a), s = Math.sin(gs.a);
    const p = (u, v) => [gs.x + c * u - s * v, gs.y + s * u + c * v];
    stroke(pa, [p(1.6, -1.4), p(3.2, -1.4), p(3.2, 1.4), p(1.6, 1.4)], 0.25, white);
  }
  out.paint = mesh(gl, pa);

  // ---- painted runoff logos
  const lg = builder();
  for (const l of sc.logos) {
    const r = atlas.logo.get(l.ad);
    if (!r) continue;
    const c = Math.cos(l.a), s = Math.sin(l.a);
    const p = (u, v) => P(l.x + c * u - s * v, l.y + s * u + c * v);
    lg.quad(p(-l.len / 2, l.h / 2), p(l.len / 2, l.h / 2), p(l.len / 2, -l.h / 2), p(-l.len / 2, -l.h / 2), [1, 1, 1], r);
  }
  out.logos = mesh(gl, lg);

  // ---- racing line, one mesh per zone
  out.line = [0, 1, 2].map((zone) => {
    const b = builder();
    const col = hex(LINE_COLORS[zone]);
    for (let j = 0; j < line.n; j++) {
      if (line.zone[j] !== zone) continue;
      const k = (j + 1) % line.n;
      stroke(b, [[line.xs[j], line.ys[j]], [line.xs[k], line.ys[k]]], 1.4, col);
    }
    return mesh(gl, b);
  });

  // ---- everything standing up goes in one mesh
  const so = builder();

  // Barriers: steel with a bright top rail, or a stack of tyres on corners.
  for (const side of [1, -1]) {
    const tyre = new Uint8Array(N);
    for (const r of sc.tyreRanges) {
      if (r.side !== side) continue;
      for (let i = r.i0; i <= r.i1; i++) tyre[((i % N) + N) % N] = 1;
    }
    const lat = (i) => side * (hw + run(i, side) + 0.1);
    for (let i = 0; i < N; i += 2) {
      const k = i + 2;
      const [ax, az] = at(i, lat(i)), [bx, bz] = at(k, lat(k));
      if (tyre[i]) {
        const [cx, cz] = at(k, lat(k) + side * 0.9), [dx, dz] = at(i, lat(i) + side * 0.9);
        so.quad(P(ax, az, 0), P(bx, bz, 0), P(bx, bz, 0.9), P(ax, az, 0.9), hex('#1c1d20'), W);
        so.quad(P(ax, az, 0.9), P(bx, bz, 0.9), P(cx, cz, 0.9), P(dx, dz, 0.9), hex('#26272b'), W);
      } else {
        so.quad(P(ax, az, 0), P(bx, bz, 0), P(bx, bz, 0.8), P(ax, az, 0.8), hex('#8e949c'), W);
        so.quad(P(ax, az, 0.8), P(bx, bz, 0.8), P(bx, bz, 1.05), P(ax, az, 1.05), hex('#dfe2e6'), W);
      }
    }
  }

  // Ad boards behind the barrier, facing the track.
  for (const bd of sc.boards) {
    const r = atlas.board.get(bd.ad);
    if (!r) continue;
    const nx = -Math.sin(bd.a), nz = Math.cos(bd.a);
    facing(so, bd.x, bd.y, nx * bd.side, nz * bd.side, bd.len, 0.3, 0.3 + bd.h, r);
    facing(so, bd.x + nx * bd.side * 0.05, bd.y + nz * bd.side * 0.05, -nx * bd.side, -nz * bd.side, bd.len, 0.3, 0.3 + bd.h, null, hex('#2a2c31'), W);
  }

  // Braking boards: signs on posts facing the approaching car.
  for (const bd of line.boards) {
    const r = atlas.label.get(bd.label);
    const fx = Math.cos(bd.a), fz = Math.sin(bd.a);
    facing(so, bd.x, bd.y, fx, fz, 2.4, 0.7, 2.3, r);
    facing(so, bd.x + fx * 0.05, bd.y + fz * 0.05, -fx, -fz, 2.4, 0.7, 2.3, null, hex('#2a2c31'), W);
    box(so, P(bd.x, bd.y, 0), 0.12, 0.7, 0.12, hex('#3a3c41'), W);
  }

  // Grandstands: raked seating full of spectators, a roof, walls round the back.
  for (const s of sc.stands) {
    const seatCol = mulc(hex(s.seat), 0.8);
    const roofIn = s.front.map(([x, z], k) => [x + (s.back[k][0] - x) * 0.12, z + (s.back[k][1] - z) * 0.12]);
    const crowd = atlas.crowd;
    for (let k = 0; k + 1 < s.front.length; k++) {
      const u = (k % 4) / 4, du = 0.25;
      const uv = [crowd[0] + (crowd[2] - crowd[0]) * u, crowd[1], crowd[0] + (crowd[2] - crowd[0]) * (u + du), crowd[3]];
      const [ax, az] = s.front[k], [bx, bz] = s.front[k + 1], [cx, cz] = s.mid[k + 1], [dx, dz] = s.mid[k];
      so.quad(P(ax, az, 1.2), P(bx, bz, 1.2), P(cx, cz, 9), P(dx, dz, 9), [1, 1, 1], uv);
    }
    wall(so, s.front, 0, 1.2, seatCol);
    between(so, s.mid, s.back, hex('#9ca1a8'), 9);
    wall(so, s.back, 0, 13.5, hex('#b9bcc2'));
    between(so, roofIn, s.back, hex('#e9ebee'), 13.5);
    for (const k of [0, s.front.length - 1]) {
      const F = s.front[k], B = s.back[k], R = roofIn[k];
      so.tri(P(F[0], F[1], 0), P(B[0], B[1], 0), P(B[0], B[1], 13.5), hex('#c3c6cc'), W);
      so.tri(P(F[0], F[1], 0), P(B[0], B[1], 13.5), P(R[0], R[1], 13.5), hex('#c3c6cc'), W);
      so.tri(P(F[0], F[1], 0), P(R[0], R[1], 13.5), P(F[0], F[1], 1.2), hex('#c3c6cc'), W);
    }
  }

  // Pit building with team-coloured garage doors facing the lane.
  if (sc.pit) {
    const { inner, outer } = sc.pit.building;
    wall(so, inner, 0, 7, hex('#d7dade'));
    wall(so, outer, 0, 7, hex('#c3c6cc'));
    between(so, inner, outer, hex('#e4e6e9'), 7);
    for (const k of [0, inner.length - 1]) {
      const A = inner[k], B = outer[k];
      so.quad(P(A[0], A[1], 0), P(B[0], B[1], 0), P(B[0], B[1], 7), P(A[0], A[1], 7), hex('#c9ccd1'), W);
    }
    for (const d of sc.pit.doors) {
      const nx = -Math.sin(d.a) * sc.pit.side, nz = Math.cos(d.a) * sc.pit.side;
      facing(so, d.x - nx * 0.85, d.y - nz * 0.85, nx, nz, 7, 0.05, 5, null, hex(d.color), W);
    }
  }

  // City blocks.
  for (const bd of sc.buildings) {
    const height = 9 + hash2(bd.x, bd.y) * 24;
    const c = Math.cos(bd.a), s = Math.sin(bd.a);
    const p = (u, v) => [bd.x + c * u - s * v, bd.y + s * u + c * v];
    const ring = [p(-bd.w / 2, -bd.d / 2), p(bd.w / 2, -bd.d / 2), p(bd.w / 2, bd.d / 2), p(-bd.w / 2, bd.d / 2), p(-bd.w / 2, -bd.d / 2)];
    const col = hex(bd.color);
    wall(so, ring, 0, height, mulc(col, 0.88));
    so.quad(P(...ring[0], height), P(...ring[1], height), P(...ring[2], height), P(...ring[3], height), col, W);
  }

  // Trees: a low-poly double cone each.
  const greens = [hex('#23582a'), hex('#2f6d33'), hex('#3b7d3a')];
  for (const tr of sc.trees) {
    const col = greens[Math.min(2, Math.floor(tr.tone * 3))];
    const base = 0.8, wide = base + tr.r * 0.9, top = base + tr.r * 2.4;
    const SIDES = 6;
    for (let q = 0; q < SIDES; q++) {
      const a0 = (q / SIDES) * Math.PI * 2, a1 = ((q + 1) / SIDES) * Math.PI * 2;
      const e0 = P(tr.x + Math.cos(a0) * tr.r, tr.y + Math.sin(a0) * tr.r, wide);
      const e1 = P(tr.x + Math.cos(a1) * tr.r, tr.y + Math.sin(a1) * tr.r, wide);
      so.tri(P(tr.x, tr.y, top), e0, e1, col, W);
      so.tri(P(tr.x, tr.y, base), e1, e0, mulc(col, 0.8), W);
    }
  }
  out.solid = mesh(gl, so);
  return out;
}

// A vertical rectangle centred on (x, z), `width` wide, seen by someone
// looking along (fx, fz). Textured from atlas rect `uv` or flat `color`.
function facing(b, x, z, fx, fz, width, y0, y1, uv, color = [1, 1, 1], white) {
  const rx = -fz, rz = fx; // viewer's right
  const l = [x - rx * width / 2, z - rz * width / 2], r = [x + rx * width / 2, z + rz * width / 2];
  b.quad([l[0], y0, l[1]], [r[0], y0, r[1]], [r[0], y1, r[1]], [l[0], y1, l[1]], color, uv || white);
}

// Axis-aligned box standing on p, w × h × d.
function box(b, p, w, h, d, color, W) {
  const [x, y, z] = p;
  boxAt(b, x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2, color, W);
}

// Soft shadow under a car, in car space just above the ground.
function shadowMesh(uv) {
  const b = builder();
  b.quad([-3.1, 0.01, -1.15], [3.0, 0.01, -1.15], [3.0, 0.01, 1.15], [-3.1, 0.01, 1.15], [0, 0, 0], uv);
  return b;
}

// Sky dome around the camera: haze at the horizon, blue overhead.
function skyMesh(W) {
  const b = builder();
  const R = 1500, rings = [0, 6, 18, 40, 90], seg = 24;
  const col = (e) => {
    const t = Math.min(1, e / 40);
    return [0, 1, 2].map((i) => HAZE[i] + (SKY_TOP[i] - HAZE[i]) * t);
  };
  for (let r = 0; r + 1 < rings.length; r++) {
    const e0 = rings[r] * Math.PI / 180, e1 = rings[r + 1] * Math.PI / 180;
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
      const p = (a, e) => [Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R - 20, Math.sin(a) * Math.cos(e) * R];
      const c0 = col(rings[r]), c1 = col(rings[r + 1]);
      b.vert(p(a0, e0), [0, 1, 0], c0, W);
      b.vert(p(a1, e0), [0, 1, 0], c0, W);
      b.vert(p(a1, e1), [0, 1, 0], c1, W);
      b.vert(p(a0, e0), [0, 1, 0], c0, W);
      b.vert(p(a1, e1), [0, 1, 0], c1, W);
      b.vert(p(a0, e1), [0, 1, 0], c1, W);
    }
  }
  return b;
}

// ---------- textures ----------

// One canvas holds every ad creative, the braking board numbers, a patch of
// crowd and a white texel for untextured geometry.
function makeAtlas(track) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const slots = [];
  let x = 0, y = 0, rowH = 0;
  // Shelf packing; null once the atlas is full (extra ads are then skipped).
  const alloc = (w, h) => {
    if (x + w + 6 > ATLAS) { x = 0; y += rowH + 6; rowH = 0; }
    if (y + h + 6 > ATLAS) return null;
    const r = { x: x + 3, y: y + 3, w, h };
    x += w + 6;
    rowH = Math.max(rowH, h);
    return r;
  };
  const uv = (r) => [r.x / ATLAS, r.y / ATLAS, (r.x + r.w) / ATLAS, (r.y + r.h) / ATLAS];
  const whiteR = alloc(8, 8);
  const crowdR = alloc(256, 128);
  const shadowR = alloc(128, 64);
  const nameR = alloc(256, 48);
  const numberR = alloc(64, 64);
  const board = new Map(), logo = new Map(), label = new Map();
  // Board numbers first so they always fit, then as many ads as there's room for.
  for (const text of ['150', '100', '50']) {
    const r = alloc(240, 160);
    slots.push({ kind: 'label', text, r });
    label.set(text, uv(r));
  }
  for (const ad of adsFor(track.id)) {
    const br = alloc(512, 60), lr = alloc(512, 114);
    if (!br || !lr) break;
    slots.push({ kind: 'board', ad, r: br }, { kind: 'logo', ad, r: lr });
    board.set(ad, uv(br));
    logo.set(ad, uv(lr));
  }
  const cx = (whiteR.x + 4) / ATLAS, cy = (whiteR.y + 4) / ATLAS;
  const atlas = {
    canvas, slots, whiteR, crowdR, shadowR, nameR, numberR, board, logo, label,
    crowd: uv(crowdR), shadow: uv(shadowR), decalName: uv(nameR), decalNumber: uv(numberR), white: [cx, cy, cx, cy],
  };
  paintAtlas(atlas, track);
  return atlas;
}

function paintAtlas(atlas, track) {
  const g = atlas.canvas.getContext('2d');
  g.clearRect(0, 0, ATLAS, ATLAS);
  g.fillStyle = '#fff';
  g.fillRect(atlas.whiteR.x - 2, atlas.whiteR.y - 2, atlas.whiteR.w + 4, atlas.whiteR.h + 4);

  // Crowd: shirts on dark seats.
  const c = atlas.crowdR, rng = mulberry(hashStr(track.id));
  g.fillStyle = '#3d4048';
  g.fillRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4);
  const shirts = ['#f4f4f4', '#e8112d', '#ffd23f', '#1d4ed8', '#111', '#ff8000', '#16a34a', '#f472b6', '#a3a3a3'];
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = shirts[Math.floor(rng() * shirts.length)];
    g.fillRect(c.x + Math.floor(rng() * (c.w - 3)), c.y + Math.floor(rng() * (c.h - 4)), 3, 4);
  }

  // Soft shadow: dark in the middle, fading out to the edges.
  const sh = atlas.shadowR;
  g.save();
  g.beginPath();
  g.rect(sh.x - 2, sh.y - 2, sh.w + 4, sh.h + 4);
  g.clip();
  g.translate(sh.x + sh.w / 2, sh.y + sh.h / 2);
  g.scale(sh.w / 2, sh.h / 2);
  const grad = g.createRadialGradient(0, 0, 0.2, 0, 0, 1);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(-1.1, -1.1, 2.2, 2.2);
  g.restore();

  // Car decals: white on transparent.
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = "italic 800 40px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  g.fillText('LATE BRAKE', atlas.nameR.x + atlas.nameR.w / 2, atlas.nameR.y + atlas.nameR.h / 2 + 2, atlas.nameR.w - 8);
  g.font = "italic 800 58px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  g.fillText('7', atlas.numberR.x + atlas.numberR.w / 2, atlas.numberR.y + atlas.numberR.h / 2 + 3);

  for (const s of atlas.slots) {
    const r = s.r;
    g.save();
    if (s.kind === 'label') {
      g.fillStyle = '#f4f4f2';
      g.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
      g.strokeStyle = '#15171b';
      g.lineWidth = 8;
      g.strokeRect(r.x + 10, r.y + 10, r.w - 20, r.h - 20);
      g.fillStyle = '#15171b';
      g.font = "800 112px 'Barlow Condensed', 'Arial Narrow', sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s.text, r.x + r.w / 2, r.y + r.h / 2 + 6);
    } else {
      const painted = s.kind === 'logo';
      const len = painted ? 4.5 : 12, ht = painted ? 1 : 1.4;
      if (!painted) {
        g.fillStyle = s.ad.bg || '#fff';
        g.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
      }
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      g.translate(r.x + r.w / 2, r.y + r.h / 2);
      g.scale(r.w / len, r.h / ht);
      drawAd(g, s.ad, len, ht, 0, painted);
    }
    g.restore();
  }
}

// Seamless grey noise; multiplied by each surface's colour.
function groundCanvas(kind) {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  const rng = mulberry(kind.length * 977);
  const G = kind === 'grass' ? 8 : 16;
  const grid = [];
  for (let i = 0; i < G; i++) { grid.push([]); for (let j = 0; j < G; j++) grid[i].push(rng()); }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * G, fy = (y / n) * G, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
      const a = grid[iy % G][ix % G], b = grid[iy % G][(ix + 1) % G], cc = grid[(iy + 1) % G][ix % G], d = grid[(iy + 1) % G][(ix + 1) % G];
      const smooth = a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v;
      const fine = rng();
      let val;
      if (kind === 'grass') val = 0.8 + smooth * 0.14 + fine * 0.06;
      else if (kind === 'gravel') val = 0.78 + fine * 0.22;
      else val = 0.86 + smooth * 0.06 + fine * 0.08 - (fine > 0.985 ? 0.2 : 0);
      const k = (y * n + x) * 4, v8 = Math.round(Math.min(1, val) * 255);
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v8;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- GL helpers ----------

function mesh(gl, b) {
  const data = new Float32Array(b.a);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { buf, count: data.length / STRIDE };
}

function texture(gl, canvas, repeat, aniso) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (aniso) {
    const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
  }
  return t;
}

function program(gl, vs, fs) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// ---------- maths (column-major 4×4) ----------

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function lookAt(e, c, up) {
  const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
}

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

// Car space to world: heading `a` in the 2D game becomes a turn about y.
function carMatrix(x, z, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, x, 0, z, 1]);
}

function translation(p) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1]);
}

function rotY(t) {
  const c = Math.cos(t), s = Math.sin(t);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotX(t) {
  const c = Math.cos(t), s = Math.sin(t);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t; }
function hash2(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
