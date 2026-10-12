// Largest axis-aligned rectangle inscribed in a region given by slab pieces (plan frame).
// Bands: horizontal strips with the x-intervals whose full vertical extent lies inside the region
// (exact per trapezoid: [max(left side), min(right side)]); slanted slabs are refined into sub-bands.
import { INTERIOR_RULES as RULES } from './constants.js';
import type { Decomposition, Piece } from './trapezoids.js';

/** Axis-aligned rectangle in plan coordinates. */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Horizontal band [y0, y1] with the sorted, disjoint free x-intervals [lo0, hi0, lo1, hi1, ...]. */
export interface Band {
  y0: number;
  y1: number;
  iv: number[];
}

/** Width (x extent) of a rectangle. */
export const rectW = (r: Rect) => r.x1 - r.x0;
/** Depth (y extent) of a rectangle. */
export const rectH = (r: Rect) => r.y1 - r.y0;
/** Area of a rectangle. */
export const rectArea = (r: Rect) => (r.x1 - r.x0) * (r.y1 - r.y0);

const sideX = (b: number, t: number, P: Piece, y: number) =>
  y === P.yb ? b : y === P.yt ? t : b + ((t - b) * (y - P.yb)) / (P.yt - P.yb);

/** Bands of the pieces `ids` (all pieces when null); slabs with slanted sides are split every `step` m. */
export function bandsOf(d: Decomposition, ids: Iterable<number> | null, step: number = RULES.lirStep): Band[] {
  const bySlab = new Map<number, number[]>();
  const all = ids ?? d.pieces.map((_, i) => i);
  for (const id of all) {
    const k = d.pieces[id].slab;
    const l = bySlab.get(k);
    if (l) l.push(id);
    else bySlab.set(k, [id]);
  }
  const bands: Band[] = [];
  for (const k of [...bySlab.keys()].sort((a, b) => a - b)) {
    const ps = bySlab.get(k)!.map((id) => d.pieces[id]).sort((p, q) => p.xlb + p.xlt - (q.xlb + q.xlt));
    const yb = d.levels[k], yt = d.levels[k + 1], h = yt - yb;
    const slanted = ps.some((P) => P.xlb !== P.xlt || P.xrb !== P.xrt);
    const m = slanted ? Math.max(1, Math.ceil(h / step - 1e-9)) : 1;
    for (let j = 0; j < m; j++) {
      const ya = j === 0 ? yb : yb + (h * j) / m;
      const yc = j + 1 === m ? yt : yb + (h * (j + 1)) / m;
      const iv: number[] = [];
      for (const P of ps) {
        const lo = Math.max(sideX(P.xlb, P.xlt, P, ya), sideX(P.xlb, P.xlt, P, yc));
        const hi = Math.min(sideX(P.xrb, P.xrt, P, ya), sideX(P.xrb, P.xrt, P, yc));
        if (hi - lo <= 1e-9) continue;
        if (iv.length && lo <= iv[iv.length - 1] + 1e-9) iv[iv.length - 1] = Math.max(iv[iv.length - 1], hi);
        else iv.push(lo, hi);
      }
      bands.push({ y0: ya, y1: yc, iv });
    }
  }
  return bands;
}

/** Intersection of two sorted disjoint interval lists (flat arrays). */
function intersect(A: number[], B: number[]): number[] {
  const out: number[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const lo = Math.max(A[i], B[j]), hi = Math.min(A[i + 1], B[j + 1]);
    if (hi - lo > 1e-9) out.push(lo, hi);
    if (A[i + 1] < B[j + 1]) i += 2;
    else j += 2;
  }
  return out;
}

/**
 * Largest-area axis-aligned rectangle inside the union of the bands (contiguous runs only), optionally
 * restricted by `accept`. Exact in x for a given y-range; y-ranges are quantised to band boundaries.
 * Deterministic: the first strictly larger candidate wins (lowest start band, then end band, then x).
 */
export function largestRect(bands: Band[], accept?: (r: Rect) => boolean): Rect | null {
  let best: Rect | null = null, bestA = 0;
  const yTop = bands.length ? bands[bands.length - 1].y1 : 0;
  for (let i = 0; i < bands.length; i++) {
    let wMax = 0;
    for (let k = 0; k < bands[i].iv.length; k += 2) wMax = Math.max(wMax, bands[i].iv[k + 1] - bands[i].iv[k]);
    if (wMax * (yTop - bands[i].y0) <= bestA) continue; // cannot beat the incumbent
    let S = bands[i].iv;
    for (let j = i; j < bands.length && S.length; j++) {
      if (j > i) {
        if (bands[j].y0 - bands[j - 1].y1 > 1e-9) break;
        S = intersect(S, bands[j].iv);
        if (!S.length) break;
      }
      const y0 = bands[i].y0, y1 = bands[j].y1;
      for (let k = 0; k < S.length; k += 2) {
        const a = (S[k + 1] - S[k]) * (y1 - y0);
        if (a <= bestA + 1e-12) continue;
        const r = { x0: S[k], x1: S[k + 1], y0, y1 };
        if (!accept || accept(r)) { best = r; bestA = a; }
      }
    }
  }
  return best;
}
