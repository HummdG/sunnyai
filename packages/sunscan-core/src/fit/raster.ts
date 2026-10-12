// HeightGrid helpers (north-up raster, row 0 = north edge, pixel-is-area, NaN = nodata).
//   pixel (col, row) centre = (originX + (col + 0.5) res, originY - (row + 0.5) res)
import type { HeightGrid } from '../types.js';

/** Planar coordinates of the centre of pixel (col, row). */
export function pixelCentre(g: HeightGrid, col: number, row: number): [number, number] {
  return [g.originX + (col + 0.5) * g.res, g.originY - (row + 0.5) * g.res];
}

/**
 * Bilinear interpolation of a HeightGrid at planar (x, y), between pixel centres.
 *  - Points inside the raster extent but beyond the outermost pixel centres are clamped to the border pixels
 *    (like scipy `map_coordinates(..., order=1, mode='nearest')`).
 *  - Points outside the raster extent return NaN.
 *  - Nodata (NaN) corners are ignored and the remaining weights renormalised; NaN if every corner with a
 *    non-zero weight is nodata.
 */
export function bilinear(grid: HeightGrid, x: number, y: number): number {
  const w = grid.width, h = grid.height;
  let fx = (x - grid.originX) / grid.res - 0.5;
  let fy = (grid.originY - y) / grid.res - 0.5;
  if (!(fx >= -0.5 && fy >= -0.5 && fx <= w - 0.5 && fy <= h - 0.5)) return NaN;
  fx = Math.min(Math.max(fx, 0), w - 1);
  fy = Math.min(Math.max(fy, 0), h - 1);
  const c0 = Math.min(Math.floor(fx), Math.max(w - 2, 0));
  const r0 = Math.min(Math.floor(fy), Math.max(h - 2, 0));
  const c1 = Math.min(c0 + 1, w - 1), r1 = Math.min(r0 + 1, h - 1);
  const tx = fx - c0, ty = fy - r0;
  const d = grid.data;
  let s = 0, ws = 0;
  const acc = (v: number, wt: number) => {
    if (wt > 0 && v === v) { s += wt * v; ws += wt; }
  };
  acc(d[r0 * w + c0], (1 - tx) * (1 - ty));
  acc(d[r0 * w + c1], tx * (1 - ty));
  acc(d[r1 * w + c0], (1 - tx) * ty);
  acc(d[r1 * w + c1], tx * ty);
  return ws > 1e-12 ? s / ws : NaN;
}

/** True when two grids share size, origin and resolution (to 1e-6 m). */
export function sameGeometry(a: HeightGrid, b: HeightGrid): boolean {
  return a.width === b.width && a.height === b.height && Math.abs(a.originX - b.originX) < 1e-6
    && Math.abs(a.originY - b.originY) < 1e-6 && Math.abs(a.res - b.res) < 1e-9;
}

/** `other` sampled at the pixel centres of `ref` (direct copy when the geometry matches, else bilinear). */
export function resampleTo(other: HeightGrid, ref: HeightGrid): Float64Array {
  const out = new Float64Array(ref.width * ref.height);
  if (sameGeometry(other, ref)) {
    for (let i = 0; i < out.length; i++) out[i] = other.data[i];
    return out;
  }
  for (let r = 0; r < ref.height; r++) {
    for (let c = 0; c < ref.width; c++) {
      const [x, y] = pixelCentre(ref, c, r);
      out[r * ref.width + c] = bilinear(other, x, y);
    }
  }
  return out;
}

/** Inclusive pixel index window of `g` whose centres can fall inside the planar bbox; null when disjoint. */
export function pixelWindow(g: HeightGrid, minX: number, minY: number, maxX: number, maxY: number): { c0: number; c1: number; r0: number; r1: number } | null {
  const c0 = Math.max(0, Math.floor((minX - g.originX) / g.res - 0.5));
  const c1 = Math.min(g.width - 1, Math.ceil((maxX - g.originX) / g.res - 0.5));
  const r0 = Math.max(0, Math.floor((g.originY - maxY) / g.res - 0.5));
  const r1 = Math.min(g.height - 1, Math.ceil((g.originY - minY) / g.res - 0.5));
  return c0 > c1 || r0 > r1 ? null : { c0, c1, r0, r1 };
}
