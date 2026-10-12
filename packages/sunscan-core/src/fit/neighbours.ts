// Context heights of neighbouring buildings: robust percentiles of the DSM inside each registered, eroded
// neighbour footprint (p90 = representative top, p10 = eave-ish level), relative to the target's ground.
import type { HeightGrid } from '../types.js';
import type { EdgeKind } from '../geometry/roof.js';
import type { PolygonM } from '../geometry/geom.js';
import { pixelCentre, pixelWindow, sameGeometry } from './raster.js';
import { quantile } from './robust.js';
import { bboxOfPoly, edgeSegments, pointInPoly, segDist2 } from './poly.js';
import { valueAtPixel } from './pixels.js';

/** Representative heights of a neighbour above the target ground datum (m). */
export interface NeighbourHeight { id: string; height: number; eaveHeight?: number }

/** DSM samples inside `poly` (planar), eroded from free / party edges; vegetation pixels removed. */
function insideValues(dsm: HeightGrid, poly: PolygonM, kinds: EdgeKind[], erode: number, erodeParty: number, dsmLast?: HeightGrid): number[] {
  const [x0, y0, x1, y1] = bboxOfPoly(poly);
  const win = pixelWindow(dsm, x0, y0, x1, y1);
  if (!win) return [];
  const segs = edgeSegments(poly);
  const same = dsmLast ? sameGeometry(dsmLast, dsm) : false;
  const out: number[] = [];
  for (let r = win.r0; r <= win.r1; r++) for (let c = win.c0; c <= win.c1; c++) {
    const [x, y] = pixelCentre(dsm, c, r);
    if (!pointInPoly(x, y, poly)) continue;
    if (erode > 0 || erodeParty > 0) {
      let ok = true;
      for (let i = 0; i < segs.length && ok; i++) {
        const s = segs[i], lim = kinds[i] === 'party' ? erodeParty : erode;
        if (segDist2(x, y, s.ax, s.ay, s.bx, s.by) < lim * lim) ok = false;
      }
      if (!ok) continue;
    }
    const z = dsm.data[r * dsm.width + c];
    if (!Number.isFinite(z)) continue;
    if (dsmLast) {
      const zl = valueAtPixel(dsmLast, dsm, c, r, same);
      if (Number.isFinite(zl) && z - zl > 1) continue;
    }
    out.push(z);
  }
  return out;
}

/**
 * Heights above `ground` of registered neighbours (planar polygons): p90 of the eroded inside DSM (fallback: no
 * erosion), eaveHeight = p10 when >= 8 pixels. Neighbours without any valid pixel are omitted.
 */
export function neighbourHeights(dsm: HeightGrid, neighbours: { id: string; poly: PolygonM; kinds: EdgeKind[] }[], ground: number, dsmLast?: HeightGrid): NeighbourHeight[] {
  const out: NeighbourHeight[] = [];
  for (const n of neighbours) {
    let v = insideValues(dsm, n.poly, n.kinds, 0.5, 0.25, dsmLast);
    if (v.length < 3) v = insideValues(dsm, n.poly, n.kinds, 0, 0, dsmLast);
    if (!v.length) continue;
    const rec: NeighbourHeight = { id: n.id, height: quantile(v, 0.9) - ground };
    if (v.length >= 8) rec.eaveHeight = quantile(v, 0.1) - ground;
    out.push(rec);
  }
  return out;
}
