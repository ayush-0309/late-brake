// Everything around the circuit: runoff areas, tyre walls, ad boards, painted
// runoff logos, grandstands, the pit lane and garages, grid slots, and trees
// (or city blocks at street circuits). Generated once per track from its
// geometry with a seeded random generator, so every visit looks the same.

import { adsFor, drawAd } from './ads.js';

const CELL = 25;
const SEAT_COLORS = ['#2b6cb0', '#c53030', '#2f855a', '#6b7280', '#b7791f', '#6b46c1'];
const TEAM_COLORS = ['#e8112d', '#1e3a8a', '#00a19b', '#ff8000', '#0f5132', '#f5f5f5', '#1f2937', '#2563eb', '#7f1d1d', '#9ca3af'];
const ROOF_COLORS = ['#c7684a', '#e6d9bf', '#b9bcc2', '#d9a441', '#efefef', '#a55a3c', '#d8cfc0'];

export function buildScenery(t) {
  const rng = mulberry32(hashStr(t.id));
  const N = t.n;
  const hw = t.halfW;
  const ads = adsFor(t.id);
  const mod = (i) => ((i % N) + N) % N;
  const run = (i, side) => (side > 0 ? t.runR : t.runL)[mod(i)];
  const at = (i, lat) => {
    const j = mod(i);
    return [t.xs[j] + t.nx[j] * lat, t.ys[j] + t.ny[j] * lat];
  };
  const ang = (i) => {
    const j = mod(i);
    return Math.atan2(t.ty[j], t.tx[j]);
  };
  const maxRun = (i0, i1, side) => {
    let m = 0;
    for (let k = i0; k <= i1; k++) m = Math.max(m, run(k, side));
    return m;
  };

  // Spatial hashes: centerline samples, and ground already taken by buildings.
  const trackCells = new Map();
  for (let i = 0; i < N; i++) push(trackCells, t.xs[i], t.ys[i], [t.xs[i], t.ys[i]]);
  const blockedCells = new Map();
  const nearTrack = (x, y, r) => near(trackCells, x, y, r);
  const nearBlocked = (x, y, r) => near(blockedCells, x, y, r);
  const block = (x, y) => push(blockedCells, x, y, [x, y]);

  // Is a band alongside the track (samples i0..i1, `o1`..`o2` meters out on
  // `side`) clear of every other part of the circuit and of other buildings?
  const stripFree = (i0, i1, side, o1, o2) => {
    for (let k = i0; k <= i1; k += 2) {
      for (const lat of [o1, (o1 + o2) / 2, o2]) {
        const [x, y] = at(k, side * lat);
        if (nearTrack(x, y, o1 - 1.5) || nearBlocked(x, y, 2)) return false;
      }
    }
    return true;
  };
  const blockStrip = (i0, i1, side, o1, o2) => {
    for (let k = i0; k <= i1; k += 2) {
      for (let lat = o1; lat <= o2 + 0.1; lat += 4) block(...at(k, side * lat));
    }
  };
  const strip = (i0, i1, side, inner, outer) => {
    const path = new Path2D();
    const box = bbox();
    for (let k = i0; k <= i1; k++) {
      const [x, y] = at(k, side * inner(k));
      k === i0 ? path.moveTo(x, y) : path.lineTo(x, y);
      grow(box, x, y);
    }
    for (let k = i1; k >= i0; k--) {
      const [x, y] = at(k, side * outer(k));
      path.lineTo(x, y);
      grow(box, x, y);
    }
    path.closePath();
    return { path, box };
  };
  const line = (i0, i1, side, lat, path = new Path2D()) => {
    for (let k = i0; k <= i1; k++) {
      const [x, y] = at(k, side * (typeof lat === 'function' ? lat(k) : lat));
      k === i0 ? path.moveTo(x, y) : path.lineTo(x, y);
    }
    return path;
  };

  // Corners: peaks of smoothed curvature, tightest first, at least 80 m apart.
  const ks = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -10; k <= 10; k++) s += t.curv[mod(i + k)];
    ks[i] = s / 21;
  }
  const peaks = [];
  for (let i = 0; i < N; i++) {
    const a = Math.abs(ks[i]);
    if (a > 1 / 150 && a >= Math.abs(ks[mod(i - 1)]) && a >= Math.abs(ks[mod(i + 1)])) peaks.push(i);
  }
  peaks.sort((a, b) => Math.abs(ks[b]) - Math.abs(ks[a]));
  const corners = [];
  for (const i of peaks) {
    if (corners.some((c) => Math.min(Math.abs(c.i - i), N - Math.abs(c.i - i)) < 40)) continue;
    corners.push({ i, side: -Math.sign(ks[i]), k: Math.abs(ks[i]) });
  }

  const sc = {
    city: t.setting === 'city',
    runoffs: [], tyres: new Path2D(), logos: [], boards: [], stands: [],
    pit: null, trees: [], buildings: [], grid: [],
  };

  // ---- runoff on the outside of corners: tarmac (with painted logos) or gravel
  corners.forEach((c, idx) => {
    if (run(c.i, c.side) < 5) return;
    const i0 = c.i - 22, i1 = c.i + 38;
    const kind = idx % 3 === 1 ? 'gravel' : 'tarmac';
    const inner = () => hw + 1;
    const outer = (k) => {
      const u = (k - i0) / (i1 - i0);
      return hw + 1 + Math.max(0, run(k, c.side) - 1.3) * Math.sin(Math.PI * u) ** 0.6;
    };
    sc.runoffs.push({ kind, ...strip(i0, i1, c.side, inner, outer) });
    line(c.i - 30, c.i + 25, c.side, (k) => hw + run(k, c.side) + 0.7, sc.tyres);

    const r = run(c.i + 6, c.side);
    if (kind === 'tarmac' && r > 7) {
      const h = Math.min(8, (r - 2) * 0.55);
      const [x, y] = at(c.i + 6, c.side * (hw + 1 + (r - 1.3) / 2));
      sc.logos.push({ x, y, a: ang(c.i + 6), len: h * 4.5, h, ad: ads[idx % ads.length] });
    }
  });

  // ---- pit lane and garages beside the start straight, on the roomier side
  let pit = null;
  for (const side of [1, -1]) {
    for (let h = 150; h >= 40; h -= 10) {
      const o1 = hw + maxRun(-h, h, side) + 3;
      if (!stripFree(-h, h, side, o1, o1 + 31)) continue;
      if (!pit || h > pit.h) pit = { side, h, o1 };
      break;
    }
  }
  if (pit) {
    const { side, h, o1 } = pit;
    blockStrip(-h, h, side, o1, o1 + 31);
    const lane = strip(-h, h, side, () => o1, () => o1 + 11);
    const building = strip(-h, h, side, () => o1 + 13, () => o1 + 31);
    const lines = new Path2D();
    line(-h, h, side, o1 + 0.5, lines);
    line(-h, h, side, o1 + 10.5, lines);
    const seams = new Path2D();
    const doors = [];
    for (let k = -h + 2, g = 0; k <= h - 5; k += 5, g++) {
      const [ax, ay] = at(k, side * (o1 + 13));
      const [bx, by] = at(k, side * (o1 + 31));
      seams.moveTo(ax, ay);
      seams.lineTo(bx, by);
      const [dx, dy] = at(k + 2, side * (o1 + 13.8));
      doors.push({ x: dx + t.tx[mod(k + 2)] * t.step / 2, y: dy + t.ty[mod(k + 2)] * t.step / 2, a: ang(k + 2), color: TEAM_COLORS[Math.floor(g / 2) % TEAM_COLORS.length] });
    }
    const [rx, ry] = at(0, side * (o1 + 22));
    sc.pit = {
      lane, building, lines, seams, doors,
      roof: { x: rx, y: ry, a: ang(0), len: Math.min(h * 1.2, 120), h: 9, ad: ads[1 % ads.length] },
    };
  }

  // ---- grandstands: the main one opposite the pits, then the heaviest corners
  const addStand = (i0, i1, side, depth, label) => {
    const o1 = hw + maxRun(i0, i1, side) + 4.5, o2 = o1 + depth;
    if (!stripFree(i0, i1, side, o1, o2)) return false;
    blockStrip(i0, i1, side, o1, o2);
    const { path, box } = strip(i0, i1, side, () => o1, () => o2);
    const seatDepth = depth * 0.58;
    const rows = new Path2D();
    for (let lat = o1 + 1.2; lat < o1 + seatDepth; lat += 1.1) line(i0, i1, side, lat, rows);
    const aisles = new Path2D();
    for (let k = i0 + 6; k < i1; k += 12) {
      const [ax, ay] = at(k, side * o1);
      const [bx, by] = at(k, side * (o1 + seatDepth));
      aisles.moveTo(ax, ay);
      aisles.lineTo(bx, by);
    }
    const roof = strip(i0, i1, side, () => o1 + seatDepth, () => o2).path;
    const mid = Math.round((i0 + i1) / 2);
    const [rx, ry] = at(mid, side * (o1 + seatDepth + (depth - seatDepth) / 2));
    sc.stands.push({
      path, box, rows, aisles, roof, label,
      seat: SEAT_COLORS[sc.stands.length % SEAT_COLORS.length],
      roofAd: {
        x: rx, y: ry, a: ang(mid),
        len: Math.min((i1 - i0) * t.step * 0.7, 80), h: (depth - seatDepth) * 0.62,
        ad: ads[(sc.stands.length + 2) % ads.length],
      },
    });
    return true;
  };
  const mainSide = pit ? -pit.side : 1;
  for (const [a, b] of [[-40, 70], [-30, 50], [-20, 30]]) if (addStand(a, b, mainSide, 24, 'MAIN GRANDSTAND')) break;
  let letter = 0;
  for (const c of corners.slice(0, 10)) {
    if (sc.stands.length >= 7) break;
    const depth = 16 + Math.round(rng() * 8);
    for (const span of [24, 16]) {
      if (addStand(c.i - span, c.i + span, c.side, depth, `GRANDSTAND ${'ABCDEFGH'[letter]}`)) {
        letter++;
        break;
      }
    }
  }

  // ---- ad boards behind the barrier: braking zones, the main straight, straights
  const seen = new Set();
  let adCursor = 0, inGroup = 0;
  const addBoard = (k, side) => {
    const key = side + ':' + Math.round(mod(k) / 7);
    if (seen.has(key)) return;
    seen.add(key);
    const r = run(k, side);
    const lat = hw + r + 2.3;
    const [x, y] = at(k, side * lat);
    // Boards are straight, so check their real ends and track-side corners:
    // on a tight corner the ends would otherwise poke out over the road.
    const j = mod(k), c = t.tx[j], s = t.ty[j];
    for (const u of [-6, -3, 0, 3, 6]) {
      for (const v of [-0.7, 0.7]) {
        const px = x + c * u - s * v * side, py = y + s * u + c * v * side;
        if (nearTrack(px, py, hw + r + 1.2) || nearBlocked(px, py, 1)) return;
      }
    }
    if (inGroup++ % 3 === 0) adCursor++;
    sc.boards.push({ x, y, a: ang(k), len: 12, h: 1.4, ad: ads[adCursor % ads.length] });
  };
  for (const c of corners) for (let k = c.i - 50; k <= c.i + 8; k += 7) addBoard(k, c.side);
  for (let k = -60; k <= 100; k += 7) addBoard(k, mainSide);
  for (let k = 0; k < N; k += 60) {
    if (Math.abs(ks[k]) > 1 / 800 || rng() > 0.45) continue;
    const side = rng() < 0.5 ? 1 : -1;
    for (let j = 0; j < 4; j++) addBoard(k + j * 7, side);
  }

  // ---- starting grid: staggered slots behind the line, pole on the left
  for (let g = 0; g < 20; g++) {
    const k = -Math.round((8 + 8 * g) / t.step);
    const lat = g % 2 ? 3 : -3;
    const [x, y] = at(k, lat);
    sc.grid.push({ x, y, a: ang(k) });
  }

  // ---- trees (park circuits) or city blocks (street circuits)
  const b = t.bounds, M = 300;
  const W = b.maxX - b.minX + 2 * M, H = b.maxY - b.minY + 2 * M;
  if (!sc.city) {
    const clusters = Math.round((W * H) / 40000);
    for (let c = 0; c < clusters && sc.trees.length < 1400; c++) {
      const cx = b.minX - M + rng() * W, cy = b.minY - M + rng() * H;
      const count = 6 + Math.floor(rng() * 22), spread = 15 + rng() * 45;
      for (let j = 0; j < count; j++) {
        const x = cx + gauss(rng) * spread, y = cy + gauss(rng) * spread;
        const r = 2.2 + rng() * 2.8;
        if (nearTrack(x, y, hw + t.runoff + 10 + r) || nearBlocked(x, y, r + 3)) continue;
        sc.trees.push({ x, y, r, tone: rng() });
      }
    }
  } else {
    const tryBuilding = (x, y, a, w, d) => {
      const c = Math.cos(a), s = Math.sin(a);
      const pts = [[0, 0]];
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) pts.push([u * w / 2, v * d / 2]);
      for (const [u, v] of pts) {
        const px = x + c * u - s * v, py = y + s * u + c * v;
        if (nearTrack(px, py, hw + t.runoff + 5) || nearBlocked(px, py, 2)) return;
      }
      for (let u = -w / 2; u <= w / 2; u += 4) for (let v = -d / 2; v <= d / 2; v += 4) block(x + c * u - s * v, y + s * u + c * v);
      sc.buildings.push({
        x, y, a, w, d,
        color: ROOF_COLORS[Math.floor(rng() * ROOF_COLORS.length)],
        pool: rng() < 0.08,
        r: Math.hypot(w, d) / 2,
      });
    };
    // Blocks lining the street, then more filling the town behind them.
    for (let i = 0; i < N; i += 12) {
      for (const side of [1, -1]) {
        const w = 16 + rng() * 14, d = 14 + rng() * 16;
        const [x, y] = at(i, side * (hw + run(i, side) + 5 + d / 2));
        tryBuilding(x, y, ang(i), w, d);
      }
    }
    for (let gx = b.minX - M; gx < b.maxX + M; gx += 36) {
      for (let gy = b.minY - M; gy < b.maxY + M; gy += 36) {
        tryBuilding(gx + rng() * 10, gy + rng() * 10, 0, 20 + rng() * 12, 16 + rng() * 14);
      }
    }
  }

  return sc;
}

// ---------- drawing ----------

// Ground level: under the track surface.
export function drawGround(ctx, sc, view, pats) {
  for (const r of sc.runoffs) {
    if (!overlaps(r.box, view)) continue;
    ctx.fillStyle = r.kind === 'gravel' ? pats.gravel : '#4a4d53';
    ctx.fill(r.path);
  }
  if (sc.pit && overlaps(sc.pit.lane.box, view)) {
    ctx.fillStyle = '#34363b';
    ctx.fill(sc.pit.lane.path);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 0.3;
    ctx.stroke(sc.pit.lines);
  }
}

// Painted on the track and runoff: grid slots and runoff logos.
export function drawMarkings(ctx, sc, view) {
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  for (const g of sc.grid) {
    if (!inView(g.x, g.y, 5, view)) continue;
    const c = Math.cos(g.a), s = Math.sin(g.a);
    const p = (u, v) => [g.x + c * u - s * v, g.y + s * u + c * v];
    ctx.moveTo(...p(1.6, -1.4)); ctx.lineTo(...p(3.2, -1.4)); ctx.lineTo(...p(3.2, 1.4)); ctx.lineTo(...p(1.6, 1.4));
  }
  ctx.stroke();

  ctx.globalAlpha = 0.85;
  for (const l of sc.logos) {
    if (!inView(l.x, l.y, l.len, view)) continue;
    placed(ctx, l, () => drawAd(ctx, l.ad, l.len, l.h, l.a, true));
  }
  ctx.globalAlpha = 1;
}

// Right behind the barrier: tyre walls on corners and ad boards.
export function drawTrackside(ctx, sc, view) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([0, 0.75]);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = '#0d0e10';
  ctx.stroke(sc.tyres);
  ctx.restore();

  for (const b of sc.boards) {
    if (!inView(b.x, b.y, 8, view)) continue;
    placed(ctx, b, () => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-b.len / 2 + 0.3, -b.h / 2 + 0.3, b.len, b.h);
      drawAd(ctx, b.ad, b.len, b.h, b.a);
    });
  }
}

// Tall things: garages, grandstands, trees and buildings.
export function drawStructures(ctx, sc, view, pats) {
  const pit = sc.pit;
  if (pit && overlaps(pit.building.box, view)) {
    shadow(ctx, pit.building.path, 2.5);
    ctx.fillStyle = '#d7dade';
    ctx.fill(pit.building.path);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.3;
    ctx.stroke(pit.seams);
    for (const d of pit.doors) {
      placed(ctx, d, () => {
        ctx.fillStyle = d.color;
        ctx.fillRect(-3.5, -0.8, 7, 1.6);
      });
    }
    placed(ctx, pit.roof, () => drawAd(ctx, pit.roof.ad, pit.roof.len, pit.roof.h, pit.roof.a));
  }

  for (const st of sc.stands) {
    if (!overlaps(st.box, view)) continue;
    shadow(ctx, st.path, 3);
    ctx.fillStyle = st.seat;
    ctx.fill(st.path);
    ctx.fillStyle = pats.crowd;
    ctx.fill(st.path);
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 0.18;
    ctx.stroke(st.rows);
    ctx.strokeStyle = 'rgba(220,220,220,0.8)';
    ctx.lineWidth = 0.9;
    ctx.stroke(st.aisles);
    ctx.fillStyle = '#e9ebee';
    ctx.fill(st.roof);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.3;
    ctx.stroke(st.roof);
    placed(ctx, st.roofAd, () => drawAd(ctx, st.roofAd.ad, st.roofAd.len, st.roofAd.h, st.roofAd.a));
  }

  if (sc.trees.length) {
    const shadows = new Path2D(), dark = new Path2D(), mid = new Path2D(), light = new Path2D();
    for (const tr of sc.trees) {
      if (!inView(tr.x, tr.y, tr.r + 3, view)) continue;
      circle(shadows, tr.x + tr.r * 0.45, tr.y + tr.r * 0.55, tr.r);
      circle(tr.tone < 0.5 ? dark : mid, tr.x, tr.y, tr.r);
      circle(light, tr.x - tr.r * 0.3, tr.y - tr.r * 0.3, tr.r * 0.5);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill(shadows);
    ctx.fillStyle = '#23582a';
    ctx.fill(dark);
    ctx.fillStyle = '#2f6d33';
    ctx.fill(mid);
    ctx.fillStyle = 'rgba(160,210,120,0.28)';
    ctx.fill(light);
  }

  for (const bd of sc.buildings) {
    if (!inView(bd.x, bd.y, bd.r + 4, view)) continue;
    placed(ctx, bd, () => {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(-bd.w / 2 + 2.5, -bd.d / 2 + 2.5, bd.w, bd.d);
      ctx.fillStyle = bd.color;
      ctx.fillRect(-bd.w / 2, -bd.d / 2, bd.w, bd.d);
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.fillRect(-bd.w / 2, 0, bd.w, bd.d / 2);
      if (bd.pool) {
        ctx.fillStyle = '#4fc3e8';
        ctx.fillRect(-bd.w / 4, -bd.d / 4, bd.w / 3, bd.d / 4);
      }
    });
  }
}

// Canvas patterns, created once per drawing context.
export function makePatterns(ctx) {
  const pattern = (size, scale, paint) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    paint(c.getContext('2d'), size);
    const p = ctx.createPattern(c, 'repeat');
    p.setTransform(new DOMMatrix().scaleSelf(scale, scale));
    return p;
  };
  const rng = mulberry32(7);

  // Spectators: dots of shirt colors; seat color shows through the gaps.
  const crowd = pattern(48, 0.25, (g, n) => {
    const shirts = ['#f4f4f4', '#e8112d', '#ffd23f', '#1d4ed8', '#111', '#ff8000', '#16a34a', '#f472b6', '#a3a3a3'];
    for (let i = 0; i < 330; i++) {
      g.fillStyle = shirts[Math.floor(rng() * shirts.length)];
      g.fillRect(Math.floor(rng() * n), Math.floor(rng() * n), 2, 2);
    }
  });

  const gravel = pattern(64, 0.15, (g, n) => {
    g.fillStyle = '#cdb58a';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rng() < 0.5 ? '#b89f72' : '#ddcaa4';
      g.fillRect(Math.floor(rng() * n), Math.floor(rng() * n), 1, 1);
    }
  });

  // Soft light and dark patches so the grass isn't one flat color.
  const grass = pattern(96, 4, (g, n) => {
    const G = 12, grid = [];
    for (let i = 0; i <= G; i++) { grid.push([]); for (let j = 0; j <= G; j++) grid[i].push(rng()); }
    for (let i = 0; i < G; i++) grid[i][G] = grid[i][0];
    grid[G] = grid[0];
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * G, fy = (y / n) * G, ix = Math.floor(fx), iy = Math.floor(fy);
        const u = fx - ix, v = fy - iy;
        const val = grid[iy][ix] * (1 - u) * (1 - v) + grid[iy][ix + 1] * u * (1 - v) + grid[iy + 1][ix] * (1 - u) * v + grid[iy + 1][ix + 1] * u * v;
        const k = (y * n + x) * 4, d = val - 0.5;
        img.data[k] = d > 0 ? 190 : 10;
        img.data[k + 1] = d > 0 ? 220 : 40;
        img.data[k + 2] = d > 0 ? 120 : 10;
        img.data[k + 3] = Math.abs(d) * 70 + rng() * 6;
      }
    }
    g.putImageData(img, 0, 0);
  });

  return { crowd, gravel, grass };
}

// ---------- helpers ----------

function placed(ctx, o, draw) {
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.a);
  draw();
  ctx.restore();
}

function shadow(ctx, path, off) {
  ctx.save();
  ctx.translate(off, off);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill(path);
  ctx.restore();
}

function circle(path, x, y, r) {
  path.moveTo(x + r, y);
  path.arc(x, y, r, 0, Math.PI * 2);
}

function inView(x, y, r, v) {
  return x + r > v.x0 && x - r < v.x1 && y + r > v.y0 && y - r < v.y1;
}

function overlaps(b, v) {
  return b.x1 > v.x0 && b.x0 < v.x1 && b.y1 > v.y0 && b.y0 < v.y1;
}

function bbox() {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

function grow(b, x, y) {
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
}

function cellKey(cx, cy) {
  return cx * 65536 + cy;
}

function push(cells, x, y, item) {
  const k = cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
  let list = cells.get(k);
  if (!list) cells.set(k, (list = []));
  list.push(item);
}

function near(cells, x, y, r) {
  const r2 = r * r;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const list = cells.get(cellKey(cx, cy));
      if (!list) continue;
      for (const p of list) if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < r2) return true;
    }
  }
  return false;
}

function gauss(rng) {
  return (rng() + rng() + rng() - 1.5) * 1.4;
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
