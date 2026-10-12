// Raster sampling, pixel selection and order statistics on core HeightGrids (planar metres, north-up).
import type { EdgeKind, HeightGrid, PolygonM, Vec2 } from '@sunny/sunscan-core';
import { distPointSeg, pointInPolygon } from '@sunny/sunscan-core/geometry';

/** Centre of pixel (col, row) in the grid's planar frame. */
export function pixelCentre(g: HeightGrid, col: number, row: number): Vec2 {
  return [g.originX + (col + 0.5) * g.res, g.originY - (row + 0.5) * g.res];
}

/** Bilinear interpolation between pixel centres; NaN outside the grid or next to nodata. */
export function sampleBilinear(g: HeightGrid, x: number, y: number): number {
  const fx = (x - g.originX) / g.res - 0.5;
  const fy = (g.originY - y) / g.res - 0.5;
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  if (c0 < 0 || r0 < 0 || c0 + 1 >= g.width || r0 + 1 >= g.height) return NaN;
  const tx = fx - c0;
  const ty = fy - r0;
  const d = g.data;
  const w = g.width;
  const v00 = d[r0 * w + c0];
  const v10 = d[r0 * w + c0 + 1];
  const v01 = d[(r0 + 1) * w + c0];
  const v11 = d[(r0 + 1) * w + c0 + 1];
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

/** Nearest-pixel value (NaN outside). */
export function sampleNearest(g: HeightGrid, x: number, y: number): number {
  const c = Math.floor((x - g.originX) / g.res);
  const r = Math.floor((g.originY - y) / g.res);
  if (c < 0 || r < 0 || c >= g.width || r >= g.height) return NaN;
  return g.data[r * g.width + c];
}

/** True if two grids share the same lattice. */
export function sameGrid(a: HeightGrid, b: HeightGrid): boolean {
  return a.width === b.width && a.height === b.height && a.res === b.res && Math.abs(a.originX - b.originX) < 1e-6 && Math.abs(a.originY - b.originY) < 1e-6;
}

/** A selected pixel. */
export interface Px { col: number; row: number; x: number; y: number; idx: number }

/**
 * Pixels whose centre lies inside `poly` and at least `erode` metres from every non-party edge and `erodeParty`
 * metres from party edges (kinds indexed like the polygon's edges; missing kinds count as free edges).
 */
export function pixelsInPolygon(g: HeightGrid, poly: PolygonM, kinds: EdgeKind[] = [], erode = 0, erodeParty = 0): Px[] {
  const rings = [poly.outer, ...(poly.holes ?? [])];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly.outer) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const c0 = Math.max(0, Math.floor((minX - g.originX) / g.res));
  const c1 = Math.min(g.width - 1, Math.ceil((maxX - g.originX) / g.res));
  const r0 = Math.max(0, Math.floor((g.originY - maxY) / g.res));
  const r1 = Math.min(g.height - 1, Math.ceil((g.originY - minY) / g.res));
  const segs: { a: Vec2; b: Vec2; party: boolean }[] = [];
  let k = 0;
  for (const r of rings) for (let i = 0; i < r.length; i++, k++) segs.push({ a: r[i], b: r[(i + 1) % r.length], party: kinds[k] === 'party' });
  const out: Px[] = [];
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++) {
      const p = pixelCentre(g, col, row);
      if (!pointInPolygon(p, poly)) continue;
      if (erode > 0 || erodeParty > 0) {
        let ok = true;
        for (const s of segs) {
          if (distPointSeg(p, s.a, s.b) < (s.party ? erodeParty : erode)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      out.push({ col, row, x: p[0], y: p[1], idx: row * g.width + col });
    }
  return out;
}

/** Median of finite values (NaN if none). */
export function median(values: ArrayLike<number>): number {
  return quantile(values, 0.5);
}

/** Linear-interpolated quantile q in [0, 1] of the finite values (NaN if none). */
export function quantile(values: ArrayLike<number>, q: number): number {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) v.push(values[i]);
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  const pos = Math.min(1, Math.max(0, q)) * (v.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** Median absolute deviation about the median (unscaled). */
export function mad(values: ArrayLike<number>): number {
  const m = median(values);
  const d: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) d.push(Math.abs(values[i] - m));
  return median(d);
}
