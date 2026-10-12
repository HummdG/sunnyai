// Basic 2D/3D geometry helpers (local metres, x = east, y = north).

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Ring = Vec2[]; // open ring (no closing duplicate)

/** Outer ring CCW + optional hole rings CW, local metres. */
export interface PolygonM {
  outer: Ring;
  holes?: Ring[];
}

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const normalize = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};
/** Left normal (rotate +90deg). For a CCW outer ring / CW hole ring this points into the polygon. */
export const leftNormal = (d: Vec2): Vec2 => [-d[1], d[0]];

export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize3 = (a: Vec3): Vec3 => {
  const l = len3(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** Signed area (CCW positive). */
export function ringArea(r: Ring): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
}

export function polygonArea(p: PolygonM): number {
  return Math.abs(ringArea(p.outer)) - (p.holes ?? []).reduce((s, h) => s + Math.abs(ringArea(h)), 0);
}

/** Returns a copy with outer CCW and holes CW. */
export function orientPolygon(p: PolygonM): PolygonM {
  const outer = ringArea(p.outer) < 0 ? [...p.outer].reverse() : [...p.outer];
  const holes = (p.holes ?? []).map((h) => (ringArea(h) > 0 ? [...h].reverse() : [...h]));
  return { outer, holes };
}

/** Even-odd point in ring test. */
export function pointInRing(p: Vec2, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: Vec2, poly: PolygonM): boolean {
  if (!pointInRing(p, poly.outer)) return false;
  for (const h of poly.holes ?? []) if (pointInRing(p, h)) return false;
  return true;
}

/** Distance from point to segment. */
export function distPointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return dist(p, add(a, mul(ab, t)));
}

/** Proper or improper intersection test between closed segments. */
export function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2, eps = 1e-12): boolean {
  const d1 = cross(sub(p2, p1), sub(q1, p1));
  const d2 = cross(sub(p2, p1), sub(q2, p1));
  const d3 = cross(sub(q2, q1), sub(p1, q1));
  const d4 = cross(sub(q2, q1), sub(p2, q1));
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  const onSeg = (a: Vec2, b: Vec2, c: Vec2) =>
    Math.min(a[0], b[0]) - eps <= c[0] && c[0] <= Math.max(a[0], b[0]) + eps && Math.min(a[1], b[1]) - eps <= c[1] && c[1] <= Math.max(a[1], b[1]) + eps;
  if (Math.abs(d1) <= eps && onSeg(p1, p2, q1)) return true;
  if (Math.abs(d2) <= eps && onSeg(p1, p2, q2)) return true;
  if (Math.abs(d3) <= eps && onSeg(q1, q2, p1)) return true;
  if (Math.abs(d4) <= eps && onSeg(q1, q2, p2)) return true;
  return false;
}

/** O(n^2) simplicity check over all rings (no two non-adjacent edges intersect). */
export function isSimple(p: PolygonM): boolean {
  const rings = [p.outer, ...(p.holes ?? [])];
  const edges: { a: Vec2; b: Vec2; r: number; i: number; n: number }[] = [];
  rings.forEach((r, ri) => r.forEach((a, i) => edges.push({ a, b: r[(i + 1) % r.length], r: ri, i, n: r.length })));
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const e = edges[i], f = edges[j];
      if (e.r === f.r && (Math.abs(e.i - f.i) === 1 || Math.abs(e.i - f.i) === e.n - 1)) continue;
      if (segmentsIntersect(e.a, e.b, f.a, f.b)) return false;
    }
  return true;
}

export function bboxDiag(p: PolygonM): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of [p.outer, ...(p.holes ?? [])])
    for (const [x, y] of r) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  return Math.hypot(maxX - minX, maxY - minY);
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
