// Ring utilities for the interior planner: snapping/cleaning, inward offset (wall inset), keyhole bridging.
import { computeSkeleton } from '../geometry/skeleton.js';
import { ringArea, segmentsIntersect, type Ring, type Vec2 } from '../geometry/geom.js';

/** Coordinates closer than this (m) are treated as identical. */
export const SNAP = 1e-7;

/** Maps every value to the first value of its run of near-equal values (gaps < eps chain together). */
function clusterMap(values: number[], eps: number): Map<number, number> {
  const s = [...new Set(values)].sort((a, b) => a - b);
  const m = new Map<number, number>();
  let rep = s[0], prev = s[0];
  for (const v of s) {
    if (v - prev >= eps) rep = v;
    m.set(v, rep);
    prev = v;
  }
  return m;
}

/**
 * Removes duplicate, collinear (deviation <= tol) and zero-area spike vertices.
 * Works on any open ring; returns a new array.
 */
export function simplifyRing(r: Ring, tol = 1e-9): Ring {
  const ring = r.slice();
  let changed = true;
  while (changed && ring.length >= 3) {
    changed = false;
    for (let i = 0; i < ring.length && ring.length >= 3; i++) {
      const n = ring.length;
      const a = ring[(i - 1 + n) % n], p = ring[i], b = ring[(i + 1) % n];
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const L = Math.hypot(abx, aby);
      const dup = Math.abs(p[0] - a[0]) <= tol && Math.abs(p[1] - a[1]) <= tol;
      const dev = L > tol ? Math.abs(abx * (p[1] - a[1]) - aby * (p[0] - a[0])) / L : 0;
      if (dup || dev <= tol) {
        ring.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return ring;
}

/**
 * Snaps near-equal x (and y) coordinates of all rings to common values (so axis-parallel edges become
 * exactly axis-parallel after a frame rotation), then drops duplicate/collinear vertices and rings with
 * fewer than 3 vertices or |area| <= 1e-6 m2. Ring orientation is preserved.
 */
export function cleanRings(rings: Ring[], eps = SNAP): Ring[] {
  const pts = rings.flat();
  if (!pts.length) return [];
  const xs = clusterMap(pts.map((p) => p[0]), eps);
  const ys = clusterMap(pts.map((p) => p[1]), eps);
  const out: Ring[] = [];
  for (const r of rings) {
    const ring = simplifyRing(r.map((p): Vec2 => [xs.get(p[0])!, ys.get(p[1])!]));
    if (ring.length >= 3 && Math.abs(ringArea(ring)) > 1e-6) out.push(ring);
  }
  return out;
}

const unitLeft = (a: Vec2, b: Vec2): Vec2 => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  return [-dy / L, dx / L];
};

/** True when no two non-adjacent edges of the ring set intersect. */
function ringsSimple(rings: Ring[]): boolean {
  const E: { a: Vec2; b: Vec2; r: number; i: number; n: number }[] = [];
  rings.forEach((r, ri) => r.forEach((a, i) => E.push({ a, b: r[(i + 1) % r.length], r: ri, i, n: r.length })));
  for (let i = 0; i < E.length; i++)
    for (let j = i + 1; j < E.length; j++) {
      const e = E[i], f = E[j];
      if (e.r === f.r && (Math.abs(e.i - f.i) === 1 || Math.abs(e.i - f.i) === e.n - 1)) continue;
      if (segmentsIntersect(e.a, e.b, f.a, f.b)) return false;
    }
  return true;
}

/** Mitred inward offset; null when an edge collapses/flips or the result is not simple (topology events). */
function mitreInset(rings: Ring[], t: number): Ring[] | null {
  const out: Ring[] = [];
  for (const r of rings) {
    const n = r.length;
    const q: Ring = [];
    for (let i = 0; i < n; i++) {
      const a = r[(i - 1 + n) % n], p = r[i], b = r[(i + 1) % n];
      const n1 = unitLeft(a, p), n2 = unitLeft(p, b);
      const den = 1 + n1[0] * n2[0] + n1[1] * n2[1];
      if (den < 1e-3) return null; // needle vertex: let the straight skeleton handle it
      const k = t / den;
      q.push([p[0] + k * (n1[0] + n2[0]), p[1] + k * (n1[1] + n2[1])]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = r[j][0] - r[i][0], ey = r[j][1] - r[i][1];
      const fx = q[j][0] - q[i][0], fy = q[j][1] - q[i][1];
      if (ex * fx + ey * fy <= 1e-12 || Math.hypot(fx, fy) < 1e-9) return null;
    }
    out.push(q);
  }
  if (!(ringArea(out[0]) > 0) || out.slice(1).some((h) => !(ringArea(h) < 0))) return null;
  return ringsSimple(out) ? out : null;
}

/** Result of insetting a polygon by the external wall thickness. */
export interface InsetResult {
  rings: Ring[];
  method: 'none' | 'mitre' | 'skeleton' | 'failed';
}

/**
 * Inward offset of a polygon (rings[0] CCW outer, rest CW holes) by t metres: exact mitred offset when
 * no topology event occurs, otherwise the straight-skeleton wavefront at time t (geometry/skeleton, all
 * speeds 1, capped at t), which handles edge collapses and splits. Output rings are cleaned; the outer
 * rings are CCW and holes CW. May return several outer rings (the polygon split) or none (it vanished).
 */
export function insetRings(rings: Ring[], t: number): InsetResult {
  if (!rings.length) return { rings: [], method: 'failed' };
  if (!(t > 1e-9)) return { rings: rings.map((r) => r.slice()), method: 'none' };
  const m = mitreInset(rings, t);
  if (m) return { rings: cleanRings(m), method: 'mitre' };
  try {
    const sk = computeSkeleton({ outer: rings[0], holes: rings.slice(1) }, { weights: () => 1, capTime: t });
    const cap = sk.faces.find((f) => f.key === 'cap');
    const loops = cap ? cap.loops.map((l) => l.map((i): Vec2 => [sk.nodes[i].x, sk.nodes[i].y])) : [];
    return { rings: cleanRings(loops), method: 'skeleton' };
  } catch {
    return { rings: [], method: 'failed' };
  }
}

/** Even-odd point-in-polygon test over a set of rings (outer + holes, any number of components). */
export function pointInRings(p: Vec2, rings: Ring[]): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  return inside;
}

/** Distance from p to the nearest edge of any ring. */
export function distToRings(p: Vec2, rings: Ring[]): number {
  let d = Infinity;
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const L2 = abx * abx + aby * aby;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / L2)) : 0;
      d = Math.min(d, Math.hypot(p[0] - a[0] - t * abx, p[1] - a[1] - t * aby));
    }
  return d;
}

/**
 * Merges CW hole rings into a CCW outer ring with zero-width bridges (a weakly simple "keyhole" ring
 * with the same signed area), so a room with an enclosed hole is still one CCW polygon.
 */
export function bridgeHoles(outer: Ring, holes: Ring[]): Ring {
  let ring = outer.slice();
  const hs = holes.map((h) => {
    let i = 0;
    for (let k = 1; k < h.length; k++) if (h[k][0] < h[i][0] || (h[k][0] === h[i][0] && h[k][1] < h[i][1])) i = k;
    return { h, i };
  });
  hs.sort((a, b) => a.h[a.i][0] - b.h[b.i][0] || a.h[a.i][1] - b.h[b.i][1]);
  for (const { h, i } of hs) {
    const p = h[i];
    let bestX = -Infinity, bestK = -1;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      if (a[1] > p[1] === b[1] > p[1]) continue;
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x <= p[0] + 1e-12 && x > bestX) { bestX = x; bestK = k; }
    }
    if (bestK < 0) continue;
    const q: Vec2 = [bestX, p[1]];
    const hr = [...h.slice(i), ...h.slice(0, i)];
    ring = [...ring.slice(0, bestK + 1), q, ...hr, [p[0], p[1]], [q[0], q[1]], ...ring.slice(bestK + 1)];
  }
  // drop exact consecutive duplicates only (the bridge itself must survive)
  return ring.filter((p, k) => {
    const o = ring[(k + ring.length - 1) % ring.length];
    return !(o[0] === p[0] && o[1] === p[1]);
  });
}
