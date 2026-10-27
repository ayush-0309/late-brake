// Geometry for the WebGL view: a vertex builder, shapes (boxes, beams,
// round tubes, lofted bodies, surfaces of revolution) and small vector maths.
// Shapes are plain triangle lists; nothing here touches WebGL.

export const STRIDE = 12; // floats per vertex: position 3, normal 3, colour 3, uv 2, gloss 1

// `gloss` (0–1) is stamped on every vertex added while it's set: 0 is matte,
// 1 is wet paint. `uv` rects are [u0, v0, u1, v1] in the texture atlas.
export function builder() {
  const a = [];
  return {
    a,
    gloss: 0,
    vert(p, n, c, uv) {
      a.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], uv[0], uv[1], this.gloss);
    },
    tri(p, q, r, c, uvRect) {
      const n = norm(cross(sub(q, p), sub(r, p)));
      const u = uvRect || [0, 0, 0, 0];
      this.vert(p, n, c, [u[0], u[1]]);
      this.vert(q, n, c, [u[0], u[1]]);
      this.vert(r, n, c, [u[0], u[1]]);
    },
    // p0 bottom-left, p1 bottom-right, p2 top-right, p3 top-left of `uv` rect.
    quad(p0, p1, p2, p3, c, uv) {
      const n = norm(cross(sub(p1, p0), sub(p3, p0)));
      const [u0, v0, u1, v1] = uv;
      this.vert(p0, n, c, [u0, v1]);
      this.vert(p1, n, c, [u1, v1]);
      this.vert(p2, n, c, [u1, v0]);
      this.vert(p0, n, c, [u0, v1]);
      this.vert(p2, n, c, [u1, v0]);
      this.vert(p3, n, c, [u0, v0]);
    },
  };
}

// Axis-aligned box from (x0, y0, z0) to (x1, y1, z1), flat shaded.
export function boxAt(b, x0, x1, y0, y1, z0, z1, color, W) {
  const c = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  for (const [a, bb, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) {
    b.quad(c[a], c[bb], c[cc], c[d], color, W);
  }
}

// Square beam from p to q, `t` thick.
export function beam(b, p, q, t, color, W) {
  const d = sub(q, p);
  const up = Math.abs(d[1]) > 0.9 * len(d) ? [1, 0, 0] : [0, 1, 0];
  const s = scale(norm(cross(d, up)), t / 2), u = scale(norm(cross(s, d)), t / 2);
  const c = [];
  for (const end of [p, q]) for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) c.push(add(end, add(scale(s, i), scale(u, j))));
  for (const [a, bb, cc, dd] of [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [0, 3, 2, 1], [4, 5, 6, 7]]) {
    b.quad(c[a], c[bb], c[cc], c[dd], color, W);
  }
}

// Round tube of radius r through the points, smooth shaded.
export function tube(b, pts, r, color, W, sides = 8) {
  const rings = pts.map((p, i) => {
    const d = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const s = norm(cross(d, up)), u = cross(s, d);
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const n = add(scale(s, Math.cos(a)), scale(u, Math.sin(a)));
      ring.push({ p: add(p, scale(n, r)), n });
    }
    return ring;
  });
  const uv = [W[0], W[1]];
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      const a = rings[i][k], bb = rings[i][k1], c = rings[i + 1][k1], d = rings[i + 1][k];
      for (const v of [a, bb, c, a, c, d]) b.vert(v.p, v.n, color, uv);
    }
  }
}

// A smooth body lofted through cross-sections along x. Each section is a
// rounded rectangle (superellipse, `p` 2 = ellipse, higher = boxier):
//   { x, hw (half width), y0, y1 (bottom, top), zc (centre, default 0), p }
// `arc` limits the ring to [a0, a1] radians (0 = right side, π/2 = top) for
// open shapes like the cockpit tub. `color(i, angle)` paints each vertex,
// which is how stripes and bare-carbon undersides are drawn. Caps close
// the ends of full rings.
export function loft(b, sections, { color, W, ring = 20, arc = null, capStart = null, capEnd = null }) {
  const closed = !arc;
  const [a0, a1] = arc || [0, Math.PI * 2];
  const count = closed ? ring : ring + 1;
  const grid = sections.map((s) => {
    const row = [];
    for (let k = 0; k < count; k++) {
      const t = a0 + ((a1 - a0) * k) / ring;
      const ct = Math.cos(t), st = Math.sin(t), e = 2 / (s.p || 4);
      const z = (s.zc || 0) + s.hw * Math.sign(ct) * Math.abs(ct) ** e;
      const ym = (s.y0 + s.y1) / 2, hh = (s.y1 - s.y0) / 2;
      row.push({ p: [s.x, ym + hh * Math.sign(st) * Math.abs(st) ** e, z], t });
    }
    return row;
  });
  smoothGrid(b, grid, closed, (i, v) => color(i, v.t), W, (i) => [sections[i].x, (sections[i].y0 + sections[i].y1) / 2, sections[i].zc || 0]);
  const cap = (i, col) => {
    const s = sections[i], c = [s.x, (s.y0 + s.y1) / 2, s.zc || 0];
    for (let k = 0; k < count; k++) b.tri(c, grid[i][k].p, grid[i][(k + 1) % count].p, col, W);
  };
  if (closed && capStart) cap(0, capStart);
  if (closed && capEnd) cap(sections.length - 1, capEnd);
}

// Surface of revolution about an axis along z through (x, y): `profile` is a
// list of [radius, z] points. Used for tyres, rims and helmets on their side.
export function revolve(b, x, y, profile, color, W, segments = 28) {
  const grid = profile.map(([r, z]) => {
    const row = [];
    for (let k = 0; k < segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      row.push({ p: [x + Math.cos(a) * r, y + Math.sin(a) * r, z] });
    }
    return row;
  });
  const zMid = (profile[0][1] + profile[profile.length - 1][1]) / 2;
  smoothGrid(b, grid, true, () => color, W, () => [x, y, zMid]);
}

// Quads between rows of a grid with normals averaged from neighbours, turned
// to face away from each row's centre.
function smoothGrid(b, grid, closed, colorAt, W, centre) {
  const rows = grid.length, cols = grid[0].length;
  const at = (i, k) => grid[Math.max(0, Math.min(rows - 1, i))][closed ? (k + cols) % cols : Math.max(0, Math.min(cols - 1, k))].p;
  for (let i = 0; i < rows; i++) {
    const c = centre(i);
    for (let k = 0; k < cols; k++) {
      const du = sub(at(i + 1, k), at(i - 1, k)), dv = sub(at(i, k + 1), at(i, k - 1));
      let n = norm(cross(du, dv));
      if (len(n) < 0.5) n = norm(sub(grid[i][k].p, c));
      if (dot(n, sub(grid[i][k].p, c)) < 0) n = scale(n, -1);
      grid[i][k].n = n;
    }
  }
  const uv = [W[0], W[1]];
  for (let i = 0; i + 1 < rows; i++) {
    for (let k = 0; k < (closed ? cols : cols - 1); k++) {
      const k1 = (k + 1) % cols;
      const v = [grid[i][k], grid[i][k1], grid[i + 1][k1], grid[i + 1][k]];
      const cols4 = [colorAt(i, v[0]), colorAt(i, v[1]), colorAt(i + 1, v[2]), colorAt(i + 1, v[3])];
      for (const q of [0, 1, 2, 0, 2, 3]) b.vert(v[q].p, v[q].n, cols4[q], uv);
    }
  }
}

// ---------- vectors and colours ----------

export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function len(a) { return Math.hypot(a[0], a[1], a[2]); }
export function norm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export function hex(s) {
  const v = parseInt(s.slice(1), 16);
  if (s.length === 4) return [((v >> 8) & 15) / 15, ((v >> 4) & 15) / 15, (v & 15) / 15];
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function mulc(c, k) { return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]; }
