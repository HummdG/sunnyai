// Convex polygon clipping (Sutherland–Hodgman) for the compound-roof envelope: half-planes, intersections and
// convex differences (as convex pieces). Rings are open (no closing duplicate) and CCW.
import type { Vec2 } from './geom.js';

/** Half-plane { p : n·p >= c }. */
export interface HalfPlane { n: Vec2; c: number }

/** Signed area of a ring (CCW > 0). */
export function ringArea2(r: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** Inside half-planes of a convex CCW ring (left of every edge). */
export function edgeHalfPlanes(r: Vec2[]): HalfPlane[] {
  return r.map((a, i) => {
    const b = r[(i + 1) % r.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n: Vec2 = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    return { n, c: n[0] * a[0] + n[1] * a[1] };
  });
}

/** Convex ring clipped to a half-plane ([] when nothing is left). */
export function clipHalfPlane(poly: Vec2[], h: HalfPlane, eps = 1e-9): Vec2[] {
  const out: Vec2[] = [];
  const f = (p: Vec2) => h.n[0] * p[0] + h.n[1] * p[1] - h.c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= -eps) out.push(a);
    if ((fa > eps && fb < -eps) || (fa < -eps && fb > eps)) {
      const t = fa / (fa - fb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  const clean: Vec2[] = [];
  for (const p of out) {
    const q = clean[clean.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) clean.push(p);
  }
  while (clean.length > 1 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= eps) clean.pop();
  return clean.length >= 3 && ringArea2(clean) > eps ? clean : [];
}

/** a ∩ b for convex CCW rings. */
export function convexIntersect(a: Vec2[], b: Vec2[]): Vec2[] {
  let r = a;
  for (const h of edgeHalfPlanes(b)) { r = clipHalfPlane(r, h); if (!r.length) break; }
  return r;
}

/** a \ b as convex pieces (a, b convex CCW). */
export function convexMinus(a: Vec2[], b: Vec2[]): Vec2[][] {
  const hs = edgeHalfPlanes(b);
  const out: Vec2[][] = [];
  let rest = a;
  for (const h of hs) {
    const outside = clipHalfPlane(rest, { n: [-h.n[0], -h.n[1]], c: -h.c });
    if (outside.length) out.push(outside);
    rest = clipHalfPlane(rest, h);
    if (!rest.length) break;
  }
  return out;
}
