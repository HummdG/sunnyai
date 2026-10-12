// Small deterministic 2D polygon helpers used by the synthesis (plan metres, x east, y north).
import { pointInRing, ringArea, type Ring, type Vec2 } from '../geometry/geom.js';

const EPS = 1e-9;

/**
 * Parameter intervals [t0, t1] (0..1 along a -> b) where the segment lies strictly inside the polygon given as
 * rings (outer + holes, even-odd rule). Adjacent inside intervals are merged.
 */
export function segmentInsideIntervals(a: Vec2, b: Vec2, rings: Ring[]): [number, number][] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const ts: number[] = [0, 1];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const c = r[i], d = r[(i + 1) % r.length];
      const ex = d[0] - c[0], ey = d[1] - c[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-14) continue; // parallel: midpoint tests below handle collinear overlaps
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (t > -EPS && t < 1 + EPS && u > -EPS && u < 1 + EPS) ts.push(Math.min(1, Math.max(0, t)));
    }
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const m = (t0 + t1) / 2;
    const p: Vec2 = [a[0] + dx * m, a[1] + dy * m];
    let inside = false;
    for (const r of rings) if (pointInRing(p, r)) inside = !inside;
    if (!inside) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

/** Sutherland-Hodgman against one half-plane: keeps points with n . p <= c. */
export function clipHalfPlane(poly: Vec2[], n: Vec2, c: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const fp = n[0] * p[0] + n[1] * p[1] - c, fq = n[0] * q[0] + n[1] * q[1] - c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** Area of a ring (absolute). */
export const absArea = (r: Ring): number => Math.abs(ringArea(r));

/**
 * Convex subject minus convex hole (both CCW) as a list of disjoint convex CCW pieces:
 * piece_i = subject ∩ outside(edge i of hole) ∩ inside(edges 0..i-1 of hole).
 */
export function subtractConvex(subject: Vec2[], hole: Vec2[]): Vec2[][] {
  const pieces: Vec2[][] = [];
  let rest = subject;
  for (let i = 0; i < hole.length && rest.length >= 3; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-12) continue;
    const out: Vec2 = [dy / l, -dx / l]; // right normal = outside of a CCW hole
    const c = out[0] * a[0] + out[1] * a[1];
    const piece = clipHalfPlane(rest, [-out[0], -out[1]], -c); // outside: out . p >= c
    if (piece.length >= 3 && absArea(piece) > 1e-10) pieces.push(piece);
    rest = clipHalfPlane(rest, out, c); // continue with the part inside this edge
  }
  return pieces;
}

/** True if the CCW ring is convex (collinear vertices allowed). */
export function isConvexCCW(r: Ring): boolean {
  if (r.length < 3 || ringArea(r) <= 0) return false;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], c = r[(i + 2) % r.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9) return false;
  }
  return true;
}

/** Copy of a ring in CCW order. */
export const ccw = (r: Ring): Ring => (ringArea(r) < 0 ? [...r].reverse() : [...r]);

/** Area-weighted centroid of a ring (falls back to the vertex mean for degenerate rings). */
export function ringCentroid(r: Ring): Vec2 {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const c = a[0] * b[1] - b[0] * a[1];
    A += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
  }
  if (Math.abs(A) < 1e-12) {
    const n = Math.max(1, r.length);
    return [r.reduce((s, p) => s + p[0], 0) / n, r.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * A), cy / (3 * A)];
}

/** Ray (origin o, unit direction d) against a segment: distance along the ray or null. */
export function raySegment(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const den = d[0] * ey - d[1] * ex;
  if (Math.abs(den) < 1e-14) return null;
  const t = ((a[0] - o[0]) * ey - (a[1] - o[1]) * ex) / den;
  const u = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
  return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

/** True if every number is finite. */
export const finite = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x));

/** Merge sorted-or-not intervals and subtract them from [lo, hi]; returns the remaining intervals. */
export function subtractIntervals(lo: number, hi: number, cut: [number, number][]): [number, number][] {
  const cs = cut.map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let cur = lo;
  for (const [a, b] of cs) {
    if (b <= cur) continue;
    if (a >= hi) break;
    if (a > cur) out.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
    if (cur >= hi) break;
  }
  if (cur < hi) out.push([cur, hi]);
  return out.filter(([a, b]) => b - a > 1e-9);
}
