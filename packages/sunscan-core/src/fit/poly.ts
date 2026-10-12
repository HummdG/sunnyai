// Polygon helpers for the fitter (planar or local metres). Rings are open (no closing duplicate); the outer
// ring is CCW and holes are CW after `normalizeFootprint`. Edge i of a ring joins vertex i -> i + 1; edges are
// indexed globally (outer ring first, then each hole) exactly like the geometry engine.
import type { EdgeKind } from '../geometry/roof.js';
import type { PolygonM, Ring, Vec2 } from '../geometry/geom.js';
import { minAreaRect } from '../geo/geo.js';

/** Side of a part frame: S = -v, N = +v, W = -u, E = +u. */
export type Side = 'S' | 'N' | 'W' | 'E';
/** All frame sides in closed-form order. */
export const SIDES: Side[] = ['S', 'N', 'W', 'E'];

/** Per-edge attributes carried through partitions: semantic kind and whether the edge is an internal cut. */
export interface EdgeAttr { kind: EdgeKind; cut: boolean }

/** Outer ring followed by the holes. */
export const ringsOf = (p: PolygonM): Ring[] => [p.outer, ...(p.holes ?? [])];

/** Signed area of a ring (CCW positive). */
export function ringSignedArea(r: Ring): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
}

/** Polygon area with holes subtracted. */
export function polyArea(p: PolygonM): number {
  return Math.abs(ringSignedArea(p.outer)) - (p.holes ?? []).reduce((s, h) => s + Math.abs(ringSignedArea(h)), 0);
}

/** Area centroid (holes subtracted). */
export function polyCentroid(p: PolygonM): Vec2 {
  let A = 0, X = 0, Y = 0;
  ringsOf(p).forEach((r, ri) => {
    const sgn = ri === 0 ? 1 : -1;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < r.length; i++) {
      const p0 = r[i], p1 = r[(i + 1) % r.length];
      const c = p0[0] * p1[1] - p1[0] * p0[1];
      a += c; cx += (p0[0] + p1[0]) * c; cy += (p0[1] + p1[1]) * c;
    }
    if (Math.abs(a) < 1e-12) return;
    const area = Math.abs(a / 2) * sgn;
    A += area; X += (cx / (3 * a)) * area; Y += (cy / (3 * a)) * area;
  });
  if (Math.abs(A) < 1e-12) {
    const m = p.outer.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]);
    return [m[0] / p.outer.length, m[1] / p.outer.length];
  }
  return [X / A, Y / A];
}

/** Even-odd point-in-ring test. */
export function pointInRing(x: number, y: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Point inside the outer ring and outside every hole. */
export function pointInPoly(x: number, y: number, p: PolygonM): boolean {
  if (!pointInRing(x, y, p.outer)) return false;
  for (const h of p.holes ?? []) if (pointInRing(x, y, h)) return false;
  return true;
}

/** Squared distance from (px, py) to segment a-b. */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Translated copy of a polygon. */
export const translatePoly = (p: PolygonM, dx: number, dy: number): PolygonM => ({
  outer: p.outer.map(([x, y]) => [x + dx, y + dy] as Vec2),
  holes: (p.holes ?? []).map((h) => h.map(([x, y]) => [x + dx, y + dy] as Vec2)),
});

/** Bounding box [minX, minY, maxX, maxY] over all rings. */
export function bboxOfPoly(p: PolygonM): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of ringsOf(p)) for (const [x, y] of r) {
    if (x < a) a = x;
    if (y < b) b = y;
    if (x > c) c = x;
    if (y > d) d = y;
  }
  return [a, b, c, d];
}

/** Flat edge list in global edge order. */
export function edgeSegments(p: PolygonM): { ax: number; ay: number; bx: number; by: number }[] {
  const out: { ax: number; ay: number; bx: number; by: number }[] = [];
  for (const r of ringsOf(p)) r.forEach((a, i) => {
    const b = r[(i + 1) % r.length];
    out.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
  });
  return out;
}

/**
 * Clean and orient a footprint: drops a closing duplicate and zero-length edges, makes the outer ring CCW and
 * holes CW, and re-maps the per-edge kinds (missing kinds default to 'eave'). Rings with < 3 vertices are dropped
 * (an invalid outer ring throws).
 */
export function normalizeFootprint(poly: PolygonM, kinds: EdgeKind[] | undefined): { poly: PolygonM; kinds: EdgeKind[] } {
  const rings = ringsOf(poly);
  const outRings: Ring[] = [];
  const outKinds: EdgeKind[] = [];
  let base = 0;
  rings.forEach((r0, ri) => {
    const n0 = r0.length;
    let pts: Vec2[] = [];
    let ks: EdgeKind[] = [];
    for (let i = 0; i < n0; i++) {
      const a = r0[i], b = r0[(i + 1) % n0];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue; // zero-length edge (incl. closing duplicate)
      pts.push([a[0], a[1]]);
      ks.push(kinds?.[base + i] ?? 'eave');
    }
    base += n0;
    if (pts.length < 3) {
      if (ri === 0) throw new Error('footprint outer ring needs at least 3 distinct vertices');
      return;
    }
    const wantCCW = ri === 0;
    if ((ringSignedArea(pts) > 0) !== wantCCW) {
      const n = pts.length;
      pts = pts.slice().reverse();
      ks = pts.map((_, j) => ks[(((n - 2 - j) % n) + n) % n]);
    }
    outRings.push(pts);
    outKinds.push(...ks);
  });
  return { poly: { outer: outRings[0], holes: outRings.slice(1) }, kinds: outKinds };
}

/** Dominant axis angle in [0, pi/2): length-weighted circular mean of 4 * phi over the outer-ring edges. */
export function dominantAngle(p: PolygonM): number {
  let s = 0, c = 0;
  const r = p.outer;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy), phi = Math.atan2(dy, dx);
    s += L * Math.sin(4 * phi); c += L * Math.cos(4 * phi);
  }
  const th = 0.25 * Math.atan2(s, c);
  return ((th % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
}

/** Orthonormal plan frame: u = (cos, sin), v = (-sin, cos). */
export interface AxisFrame { cos: number; sin: number; angle: number }

/** Coordinate along the frame u axis. */
export const toU = (f: AxisFrame, x: number, y: number) => x * f.cos + y * f.sin;
/** Coordinate along the frame v axis. */
export const toV = (f: AxisFrame, x: number, y: number) => -x * f.sin + y * f.cos;

/** Frame aligned with the dominant axis, with u along the longer bbox extent; plus the bbox in that frame. */
export function partFrame(p: PolygonM): { frame: AxisFrame; u0: number; u1: number; v0: number; v1: number } {
  let th = dominantAngle(p);
  const ext = (t: number) => {
    const f = { cos: Math.cos(t), sin: Math.sin(t), angle: t };
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of p.outer) {
      const u = toU(f, x, y), v = toV(f, x, y);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    return { frame: f, u0, u1, v0, v1 };
  };
  let r = ext(th);
  if (r.v1 - r.v0 > r.u1 - r.u0 + 1e-9) {
    th += Math.PI / 2;
    r = ext(th);
  }
  return r;
}

/** Footprint area / minimum-area enclosing rectangle area (1 for a rectangle). */
export function rectangularity(p: PolygonM): number {
  const mar = minAreaRect(p.outer as [number, number][]);
  return mar.area > 0 ? polyArea(p) / mar.area : 0;
}

/** Per-edge geometric classification in a frame. */
export interface EdgeInfo {
  i: number; ax: number; ay: number; bx: number; by: number; len: number;
  /** Outward unit normal. */
  nx: number; ny: number;
  /** Side of the frame the outward normal faces most (S = -v, N = +v, W = -u, E = +u). */
  side: Side;
  /** Edge direction class: along u, along v (within 30 deg) or diagonal. */
  dir: 'u' | 'v' | 'd';
  attr: EdgeAttr;
}

/** Classify every edge (outer then holes) by length, outward side and direction in a frame. */
export function classifyEdges(p: PolygonM, attrs: EdgeAttr[], f: AxisFrame): EdgeInfo[] {
  const out: EdgeInfo[] = [];
  const cos30 = Math.cos(Math.PI / 6);
  for (const r of ringsOf(p)) r.forEach((a, k) => {
    const b = r[(k + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-12;
    const nx = dy / len, ny = -dx / len; // right normal = outward for CCW outer / CW holes
    const nu = toU(f, nx, ny), nv = toV(f, nx, ny);
    const side: Side = Math.abs(nu) >= Math.abs(nv) ? (nu > 0 ? 'E' : 'W') : nv > 0 ? 'N' : 'S';
    const du = Math.abs(toU(f, dx, dy)) / len, dv = Math.abs(toV(f, dx, dy)) / len;
    const dir = du >= cos30 ? 'u' : dv >= cos30 ? 'v' : 'd';
    const i = out.length;
    out.push({ i, ax: a[0], ay: a[1], bx: b[0], by: b[1], len, nx, ny, side, dir, attr: attrs[i] ?? { kind: 'eave', cut: false } });
  });
  return out;
}

/** Indices of reflex vertices of a CCW ring. */
export function reflexVertices(r: Ring): number[] {
  const out: number[] = [];
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const a = r[(i - 1 + n) % n], b = r[i], c = r[(i + 1) % n];
    const d1x = b[0] - a[0], d1y = b[1] - a[1], d2x = c[0] - b[0], d2y = c[1] - b[1];
    const cr = d1x * d2y - d1y * d2x;
    if (cr < -1e-6 * Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)) out.push(i);
  }
  return out;
}

/** First boundary hit of the ray o + s d (s > 0) with the ring, ignoring edges in `skip`. */
export function rayHit(r: Ring, ox: number, oy: number, dx: number, dy: number, skip: number[] = []): { x: number; y: number; s: number } | null {
  let best: { x: number; y: number; s: number } | null = null;
  for (let j = 0; j < r.length; j++) {
    if (skip.includes(j)) continue;
    const a = r[j], b = r[(j + 1) % r.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = a[0] - ox, wy = a[1] - oy;
    const s = (wx * ey - wy * ex) / den;
    const t = (wx * dy - wy * dx) / den;
    if (s > 1e-6 && t >= -1e-9 && t <= 1 + 1e-9 && (!best || s < best.s)) best = { x: ox + s * dx, y: oy + s * dy, s };
  }
  return best;
}

/** Locate a boundary point on a ring: edge index and parameter (t = 0 means vertex `edge`). */
function locateOnRing(r: Ring, x: number, y: number, tol: number): { edge: number; t: number } | null {
  let best: { edge: number; t: number; d: number } | null = null;
  for (let j = 0; j < r.length; j++) {
    const a = r[j], b = r[(j + 1) % r.length];
    const d2 = segDist2(x, y, a[0], a[1], b[0], b[1]);
    if (!best || d2 < best.d) {
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const L2 = ex * ex + ey * ey;
      const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * ex + (y - a[1]) * ey) / L2)) : 0;
      best = { edge: j, t, d: d2 };
    }
  }
  if (!best || best.d > tol * tol) return null;
  const L = Math.hypot(r[(best.edge + 1) % r.length][0] - r[best.edge][0], r[(best.edge + 1) % r.length][1] - r[best.edge][1]);
  if (best.t * L < tol) return { edge: best.edge, t: 0 };
  if ((1 - best.t) * L < tol) return { edge: (best.edge + 1) % r.length, t: 0 };
  return { edge: best.edge, t: best.t };
}

/**
 * Split a simple ring along the chord P-Q (both on its boundary). Returns the two sub-rings (CCW) with their
 * per-edge attributes (the chord gets { kind: 'eave', cut: true }), or null when the chord is not interior.
 */
export function splitRing(r: Ring, attrs: EdgeAttr[], P: Vec2, Q: Vec2, tol = 1e-6): [{ ring: Ring; attrs: EdgeAttr[] }, { ring: Ring; attrs: EdgeAttr[] }] | null {
  const lp = locateOnRing(r, P[0], P[1], tol), lq = locateOnRing(r, Q[0], Q[1], tol);
  if (!lp || !lq) return null;
  // augmented ring with P and Q inserted as vertices
  const pts: Vec2[] = [], at: EdgeAttr[] = [];
  let iP = -1, iQ = -1;
  for (let j = 0; j < r.length; j++) {
    const here = pts.length;
    pts.push(r[j]); at.push(attrs[j]);
    if (lp.edge === j && lp.t === 0) iP = here;
    if (lq.edge === j && lq.t === 0) iQ = here;
    const ins: { t: number; which: 'P' | 'Q' }[] = [];
    if (lp.edge === j && lp.t > 0) ins.push({ t: lp.t, which: 'P' });
    if (lq.edge === j && lq.t > 0) ins.push({ t: lq.t, which: 'Q' });
    ins.sort((u, v) => u.t - v.t);
    for (const s of ins) {
      if (s.which === 'P') { iP = pts.length; pts.push([P[0], P[1]]); } else { iQ = pts.length; pts.push([Q[0], Q[1]]); }
      at.push(attrs[j]);
    }
  }
  if (iP < 0 || iQ < 0 || iP === iQ) return null;
  const m = pts.length;
  const walk = (from: number, to: number) => {
    const ring: Ring = [], a: EdgeAttr[] = [];
    for (let k = from; ; k = (k + 1) % m) {
      ring.push(pts[k]);
      if (k === to) break;
      a.push(at[k]);
    }
    a.push({ kind: 'eave', cut: true });
    return { ring, attrs: a };
  };
  const A = walk(iP, iQ), B = walk(iQ, iP);
  if (A.ring.length < 3 || B.ring.length < 3) return null;
  if (!(ringSignedArea(A.ring) > 1e-9 && ringSignedArea(B.ring) > 1e-9)) return null;
  return [A, B];
}

/** Intersections of the line {p : u(p) = c} (u = frame axis) with a ring, sorted along v. */
export function lineRingCrossings(r: Ring, f: AxisFrame, c: number, axis: 'u' | 'v'): Vec2[] {
  const val = (x: number, y: number) => (axis === 'u' ? toU(f, x, y) : toV(f, x, y)) - c;
  const out: Vec2[] = [];
  for (let j = 0; j < r.length; j++) {
    const a = r[j], b = r[(j + 1) % r.length];
    const fa = val(a[0], a[1]), fb = val(b[0], b[1]);
    if ((fa < 0 && fb >= 0) || (fa >= 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  const key = (q: Vec2) => (axis === 'u' ? toV(f, q[0], q[1]) : toU(f, q[0], q[1]));
  return out.sort((p, q) => key(p) - key(q));
}

/**
 * Party edges from geometry: an edge is a party wall when >= `frac` of its length lies within `tol` metres of
 * another footprint's boundary (what the footprint module would compute from OSM).
 */
export function detectPartyEdges(polys: PolygonM[], tol = 0.15, frac = 0.5): boolean[][] {
  const boxes = polys.map(bboxOfPoly);
  const segs = polys.map(edgeSegments);
  return polys.map((p, i) => {
    const near = polys.map((_, j) => j).filter((j) => j !== i && boxes[j][0] - tol <= boxes[i][2] && boxes[i][0] <= boxes[j][2] + tol
      && boxes[j][1] - tol <= boxes[i][3] && boxes[i][1] <= boxes[j][3] + tol);
    return segs[i].map((e) => {
      if (!near.length) return false;
      let hit = 0;
      for (let k = 0; k < 19; k++) {
        const t = 0.05 + 0.05 * k;
        const x = e.ax + t * (e.bx - e.ax), y = e.ay + t * (e.by - e.ay);
        let ok = false;
        for (const j of near) {
          for (const s of segs[j]) if (segDist2(x, y, s.ax, s.ay, s.bx, s.by) < tol * tol) { ok = true; break; }
          if (ok) break;
        }
        if (ok) hit++;
      }
      return hit / 19 >= frac;
    });
  });
}
