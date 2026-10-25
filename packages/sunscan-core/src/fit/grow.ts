// Outline growth: push a free edge of the target outline out to where the roof the LiDAR sees really ends.
//
// Map outlines are traced from imagery that can be years apart from the survey, or offset from it by a metre or
// so on one side only; registration moves the whole outline and cannot fix one short edge. A roof fitted inside a
// short outline is wrong in a specific way: every model starts all its eaves at one height, so a slope cut short
// by the outline can only reach that height by becoming far too steep (3A Downs Walk, Peacehaven: a 30-40 degree
// south slope reported as 63 degrees and unusable).
//
// For each free edge, heights (last return where there is one, so trees do not count) are sampled along the
// middle of the edge in steps outwards. While most samples stay at least as high as the house's own lowest eave,
// and none is inside a neighbour's outline, the roof continues and the edge moves out with it.
import type { EdgeKind } from '../geometry/roof.js';
import type { PolygonM, Vec2 } from '../geometry/geom.js';
import type { HeightGrid } from '../types.js';
import { pointInPoly } from './poly.js';
import { bilinear } from './raster.js';

/** Limits of the outline growth. */
export interface GrowOptions {
  /** Step outwards and furthest growth (m). */
  step: number;
  maxGrow: number;
  /** Shortest edge considered (m). */
  minEdge: number;
  /** Share of an edge's samples that must still be roof for the edge to move. */
  minShare: number;
  /** How far below the house's lowest eave a sample may be and still count as roof (m). The eave is read
   *  half a metre inside the walls, so it reads a little high. */
  tolerance: number;
  /** Lowest height above ground that is ever roof (m). */
  minRoof: number;
  /** How far below the height just inside the edge the roof outside must be: it slopes down, away (m). */
  minDrop: number;
  /** Rise between steps put down to noise rather than a roof going up (m). */
  noise: number;
  /** How far past an edge there must still be roof for the edge to be short rather than overhung (m). */
  minRun: number;
  /** Smallest growth applied (m). */
  minGrow: number;
}

export const DEFAULT_GROW: GrowOptions = { step: 0.25, maxGrow: 3, minEdge: 3, minShare: 0.6, tolerance: 0.5, minRoof: 2.2, minDrop: 0.3, noise: 0.25, minRun: 1, minGrow: 0.5 };

/** Samples along the middle 70 % of an edge. */
const ALONG = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85];

function median(values: number[]): number {
  const v = values.filter((x) => x === x).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}

/** Intersection of the lines p + s d and q + t e, or null when they are (nearly) parallel. */
function intersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 0.2 * Math.hypot(...d) * Math.hypot(...e)) return null;
  const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + s * d[0], p[1] + s * d[1]];
}

/**
 * Grow the outer ring of `poly` (edge i runs from vertex i to i + 1; `kinds` per edge) to the roof in the
 * rasters. Party walls never move, and neither does an edge whose neighbours are too close to parallel for a
 * clean corner. Returns the polygon unchanged (`grown: false`) when nothing moved.
 */
export function growOutline(
  poly: PolygonM,
  kinds: EdgeKind[],
  dsm: HeightGrid,
  dtm: HeightGrid,
  dsmLast: HeightGrid | undefined,
  neighbours: PolygonM[],
  o: GrowOptions = DEFAULT_GROW,
): { poly: PolygonM; grown: boolean; moves: number[] } {
  const ring = poly.outer.map((v) => [v[0], v[1]] as Vec2);
  const n = ring.length;
  const moves = new Array<number>(n).fill(0);
  const height = (x: number, y: number): number => {
    // interpolated, not nearest: at 1 m pixels the eave falls between two of them
    const first = bilinear(dsm, x, y);
    const last = dsmLast ? bilinear(dsmLast, x, y) : first;
    return Math.min(first, last === last ? last : first) - bilinear(dtm, x, y);
  };
  const byNeighbour = (x: number, y: number) => neighbours.some((p) => pointInPoly(x, y, p));
  // the outer ring is CCW, so the outward normal of edge a -> b is (dy, -dx)
  const frame = (i: number) => {
    const a = ring[i], b = ring[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    return { a, b, L, u, out: [u[1], -u[0]] as Vec2 };
  };
  // the height just inside each free edge, and the house's own lowest eave (the lowest of them)
  const inside = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (kinds[i] === 'party') continue;
    const { a, L, u, out } = frame(i);
    if (L < o.minEdge) continue;
    inside[i] = median(ALONG.map((f) => height(a[0] + u[0] * f * L - out[0] * 0.5, a[1] + u[1] * f * L - out[1] * 0.5)));
  }
  const eave = Math.min(...inside.filter((h) => h === h));
  if (!Number.isFinite(eave)) return { poly, grown: false, moves };
  const threshold = Math.max(o.minRoof, eave - o.tolerance);

  for (let i = 0; i < n; i++) {
    if (kinds[i] === 'party') continue;
    const { a, L, u, out } = frame(i);
    if (L < o.minEdge) continue;
    // an outline that ends at the eave is right, even with an overhang beyond it: an overhang stops within about
    // half a metre. One that has cut the roof short still has roof a full `minRun` beyond it.
    const run: number[] = [];
    let runBlocked = false;
    for (const f of ALONG) {
      const x = a[0] + u[0] * f * L + out[0] * o.minRun, y = a[1] + u[1] * f * L + out[1] * o.minRun;
      if (byNeighbour(x, y)) { runBlocked = true; break; }
      run.push(height(x, y));
    }
    if (runBlocked || run.filter((h) => h >= o.minRoof).length < o.minShare * ALONG.length) continue;
    let grow = 0;
    let previous = inside[i];
    for (let d = o.step; d <= o.maxGrow + 1e-9; d += o.step) {
      let roof = 0;
      let blocked = false;
      const hs: number[] = [];
      for (const f of ALONG) {
        const x = a[0] + u[0] * f * L + out[0] * d, y = a[1] + u[1] * f * L + out[1] * d;
        if (byNeighbour(x, y)) { blocked = true; break; }
        const h = height(x, y);
        hs.push(h);
        if (h >= threshold) roof++;
      }
      if (blocked || roof < o.minShare * ALONG.length) break;
      // a roof that runs on past its outline slopes down away from the house; one that stays level or rises
      // is something else (the house next door with no outline of its own, a taller building)
      const here = median(hs);
      if (!(here <= inside[i] - o.minDrop && here <= previous + o.noise)) break;
      previous = here;
      grow = d;
    }
    // under half a metre is within what registration and overhangs leave over: not a short outline
    if (grow < o.minGrow) continue;
    // move the edge's line out by `grow` and re-corner it on the lines of the two edges either side
    const prev = frame((i - 1 + n) % n), next = frame((i + 1) % n);
    const p: Vec2 = [a[0] + out[0] * grow, a[1] + out[1] * grow];
    const na = intersect(p, u, prev.a, prev.u), nb = intersect(p, u, next.a, next.u);
    if (!na || !nb) continue;
    ring[i] = na;
    ring[(i + 1) % n] = nb;
    moves[i] = grow;
  }
  const grown = moves.some((m) => m > 0);
  return { poly: grown ? { outer: ring, holes: poly.holes ?? [] } : poly, grown, moves };
}
