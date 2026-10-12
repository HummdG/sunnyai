// Outline simplification for roofs the geometry engine cannot build on the raw outline. Irregular real footprints
// (short jogs between nearly parallel walls) can make the weighted skeleton emit runaway nodes or broken faces;
// removing the least significant vertices (Visvalingam-Whyatt, effective area < tau) usually fixes that while
// changing the plan by a few square metres. Used by the priors fallback; holes are kept unchanged.
import type { EdgeKind } from '../geometry/roof.js';
import type { PolygonM, Vec2 } from '../geometry/geom.js';
import { polyArea, ringSignedArea } from './poly.js';

/** Limits of the outline simplification. */
export interface SimplifyOptions {
  /** Effective-area thresholds tried in order (m2). */
  steps: number[];
  /** Largest relative area change accepted. */
  maxAreaChange: number;
  /** Minimum vertices kept on the outer ring. */
  minVertices: number;
}
/** Thresholds 0.5-8 m2, at most 10 % area change, at least 4 vertices. */
export const DEFAULT_SIMPLIFY: SimplifyOptions = { steps: [0.5, 1, 2, 4, 8], maxAreaChange: 0.1, minVertices: 4 };

const triArea = (a: Vec2, b: Vec2, c: Vec2) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

function properIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const o = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(p1, p2, q1), d2 = o(p1, p2, q2), d3 = o(q1, q2, p1), d4 = o(q1, q2, p2);
  return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
}

/** Would the chord a-b (replacing vertex i) cross any other edge of the ring or the holes? */
function chordCrosses(r: Vec2[], i: number, holes: Vec2[][]): boolean {
  const n = r.length, a = r[(i - 1 + n) % n], b = r[(i + 1) % n];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    if (k === (i - 1 + n) % n || k === i || k1 === (i - 1 + n) % n || k === (i + 1) % n) continue;
    if (properIntersect(a, b, r[k], r[k1])) return true;
  }
  for (const h of holes) for (let k = 0; k < h.length; k++) if (properIntersect(a, b, h[k], h[(k + 1) % h.length])) return true;
  return false;
}

/**
 * Simplify the outer ring until `accept(poly, kinds)` holds. A removed vertex merges its two edges into one whose
 * kind is the common kind, else the kind of the longer edge. Returns null when no level is accepted within the
 * limits; `removed` counts deleted vertices (0 = the input itself was accepted).
 */
export function simplifyUntil(
  poly: PolygonM, kinds: EdgeKind[], accept: (p: PolygonM, k: EdgeKind[]) => boolean, o: SimplifyOptions = DEFAULT_SIMPLIFY,
): { poly: PolygonM; kinds: EdgeKind[]; removed: number } | null {
  if (accept(poly, kinds)) return { poly, kinds, removed: 0 };
  const holes = poly.holes ?? [];
  const nOuter = poly.outer.length;
  let r: Vec2[] = poly.outer.map((p) => [p[0], p[1]] as Vec2);
  let k: EdgeKind[] = kinds.slice(0, nOuter);
  const holeKinds = kinds.slice(nOuter);
  const a0 = polyArea(poly);
  let removed = 0;
  for (const tau of o.steps) {
    for (;;) {
      if (r.length <= o.minVertices) break;
      let best = -1, ba = Infinity;
      for (let i = 0; i < r.length; i++) {
        const n = r.length, area = triArea(r[(i - 1 + n) % n], r[i], r[(i + 1) % n]);
        if (area < ba && area < tau && !chordCrosses(r, i, holes)) { ba = area; best = i; }
      }
      if (best < 0) break;
      const n = r.length, prev = (best - 1 + n) % n;
      const lPrev = Math.hypot(r[best][0] - r[prev][0], r[best][1] - r[prev][1]);
      const lNext = Math.hypot(r[(best + 1) % n][0] - r[best][0], r[(best + 1) % n][1] - r[best][1]);
      const merged: EdgeKind = k[prev] === k[best] ? k[prev] : lPrev >= lNext ? k[prev] : k[best];
      const nr = r.filter((_, i) => i !== best), nk = k.filter((_, i) => i !== best);
      nk[best === 0 ? nr.length - 1 : prev] = merged;
      if (!(ringSignedArea(nr) > 0) || Math.abs(Math.abs(ringSignedArea(nr)) - a0) > o.maxAreaChange * a0) break;
      r = nr; k = nk; removed++;
    }
    const cand: PolygonM = { outer: r, holes };
    if (removed && accept(cand, [...k, ...holeKinds])) return { poly: cand, kinds: [...k, ...holeKinds], removed };
  }
  return null;
}
