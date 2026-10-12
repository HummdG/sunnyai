// Ground estimate (research 05 section 3.7): median of the DTM inside the registered footprint, cross-checked
// against a robust plane fitted to DTM pixels in the ring 1 m < d <= 3 m outside the footprint (excluding pixels
// inside or within 0.5 m of any other footprint), evaluated at the footprint centroid.
import type { HeightGrid } from '../types.js';
import type { PolygonM } from '../geometry/geom.js';
import { bilinear, pixelCentre, pixelWindow } from './raster.js';
import { TUKEY_C, irls, median } from './robust.js';
import { bboxOfPoly, edgeSegments, pointInPoly, polyCentroid, segDist2 } from './poly.js';

/** Ground height under a footprint with its ring-plane cross-check. */
export interface GroundEstimate {
  /** Ground height (raster units, m ODN): DTM median inside the footprint. */
  ground: number;
  /** Ring-plane cross-check at the centroid, or null when < 5 ring pixels. */
  check: number | null;
  nInside: number;
  nRing: number;
  /** |ground - check| > threshold. */
  mismatch: boolean;
}

/** Ring geometry (m) and the mismatch threshold of the ground cross-check. */
export interface GroundOptions { ringIn: number; ringOut: number; clearance: number; mismatch: number }
/** Ring 1-3 m outside, 0.5 m clearance from other footprints, flag differences > 0.5 m. */
export const DEFAULT_GROUND: GroundOptions = { ringIn: 1, ringOut: 3, clearance: 0.5, mismatch: 0.5 };

/** Minimum distance from (x, y) to the polygon boundary. */
function boundaryDist(segs: { ax: number; ay: number; bx: number; by: number }[], x: number, y: number): number {
  let d = Infinity;
  for (const s of segs) d = Math.min(d, segDist2(x, y, s.ax, s.ay, s.bx, s.by));
  return Math.sqrt(d);
}

/** Ground under a registered footprint (planar coordinates, same frame as the DTM). */
export function estimateGround(dtm: HeightGrid, target: PolygonM, others: PolygonM[], opts: GroundOptions = DEFAULT_GROUND): GroundEstimate {
  const [x0, y0, x1, y1] = bboxOfPoly(target);
  const c = polyCentroid(target);
  const inside: number[] = [];
  const win = pixelWindow(dtm, x0, y0, x1, y1);
  if (win) {
    for (let r = win.r0; r <= win.r1; r++) for (let k = win.c0; k <= win.c1; k++) {
      const [x, y] = pixelCentre(dtm, k, r);
      const v = dtm.data[r * dtm.width + k];
      if (Number.isFinite(v) && pointInPoly(x, y, target)) inside.push(v);
    }
  }
  // ring pixels
  const R = opts.ringOut;
  const segs = edgeSegments(target);
  const near = others.filter((p) => {
    const b = bboxOfPoly(p);
    return b[0] <= x1 + R + 1 && b[2] >= x0 - R - 1 && b[1] <= y1 + R + 1 && b[3] >= y0 - R - 1;
  }).map((p) => ({ p, segs: edgeSegments(p), bb: bboxOfPoly(p) }));
  const rx: number[] = [], ry: number[] = [], rz: number[] = [];
  const wr = pixelWindow(dtm, x0 - R - 1, y0 - R - 1, x1 + R + 1, y1 + R + 1);
  if (wr) {
    for (let r = wr.r0; r <= wr.r1; r++) for (let k = wr.c0; k <= wr.c1; k++) {
      const v = dtm.data[r * dtm.width + k];
      if (!Number.isFinite(v)) continue;
      const [x, y] = pixelCentre(dtm, k, r);
      if (pointInPoly(x, y, target)) continue;
      const d = boundaryDist(segs, x, y);
      if (!(d > opts.ringIn && d <= R)) continue;
      let clear = true;
      for (const q of near) {
        if (x < q.bb[0] - opts.clearance || x > q.bb[2] + opts.clearance || y < q.bb[1] - opts.clearance || y > q.bb[3] + opts.clearance) continue;
        if (pointInPoly(x, y, q.p) || boundaryDist(q.segs, x, y) <= opts.clearance) { clear = false; break; }
      }
      if (!clear) continue;
      rx.push(x - c[0]); ry.push(y - c[1]); rz.push(v);
    }
  }
  let check: number | null = null;
  if (rz.length >= 5) {
    const z = Float64Array.from(rz);
    const X = [new Float64Array(rz.length).fill(1), Float64Array.from(rx), Float64Array.from(ry)];
    const fit = irls(X, z, 0.15, [median(rz), 0, 0], TUKEY_C, { updateScale: true });
    if (fit.beta.every(Number.isFinite)) check = fit.beta[0];
  }
  let ground = inside.length ? median(inside) : bilinear(dtm, c[0], c[1]);
  if (!Number.isFinite(ground)) ground = check ?? (rz.length ? median(rz) : NaN);
  return { ground, check, nInside: inside.length, nRing: rz.length, mismatch: check !== null && Math.abs(ground - check) > opts.mismatch };
}
