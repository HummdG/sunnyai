// Pixel selection (research 05 section 3.6): DSM pixel centres inside the registered footprint, at least
// `erode` from free (non-party) edges and `erodeParty` from party edges; nodata and vegetation / overhang
// pixels (dsm - dsmLast > vegThreshold) are dropped. Each pixel carries Q x Q sub-sample points for the
// area-averaged design. All coordinates are local metres (planar - origin).
import type { HeightGrid } from '../types.js';
import type { EdgeKind } from '../geometry/roof.js';
import type { PolygonM, Vec2 } from '../geometry/geom.js';
import { bilinear, pixelCentre, pixelWindow, sameGeometry } from './raster.js';
import { bboxOfPoly, edgeSegments, pointInPoly, segDist2 } from './poly.js';

/** Fit pixels with their sub-sample points (local metres) and observed DSM heights. */
export interface PixelSet {
  n: number;
  /** Sub-samples per pixel (Q * Q). */
  S2: number;
  res: number;
  /** Pixel centres (local metres). */
  cx: Float64Array;
  cy: Float64Array;
  /** Sub-sample points, interleaved x, y (local metres), n * S2 * 2. */
  sub: Float64Array;
  /** Observed DSM heights (m). */
  z: Float64Array;
  col: Int32Array;
  row: Int32Array;
}

/** Erosion distances (m), sub-samples per pixel axis and the vegetation threshold (m). */
export interface PixelOptions { erode: number; erodeParty: number; Q: number; vegThreshold: number }
/** Research 05 defaults: 0.5 m from free edges, 0.25 m from party edges, 4 x 4 sub-samples. */
export const DEFAULT_PIXELS: PixelOptions = { erode: 0.5, erodeParty: 0.25, Q: 4, vegThreshold: 1.0 };

/** Sub-sample offsets ((k + 0.5) / Q - 0.5) * res, x fastest (numpy meshgrid order). */
export function subOffsets(Q: number, res: number): Float64Array {
  const o = new Float64Array(2 * Q * Q);
  for (let i = 0; i < Q; i++) for (let j = 0; j < Q; j++) {
    o[2 * (i * Q + j)] = ((j + 0.5) / Q - 0.5) * res;
    o[2 * (i * Q + j) + 1] = ((i + 0.5) / Q - 0.5) * res;
  }
  return o;
}

/** Build a pixel set from explicit pixel indices of `dsm` (local frame = planar - origin). */
export function pixelSetFrom(dsm: HeightGrid, cols: number[], rows: number[], origin: Vec2, Q = 4): PixelSet {
  const n = cols.length, S2 = Q * Q;
  const off = subOffsets(Q, dsm.res);
  const ps: PixelSet = {
    n, S2, res: dsm.res, cx: new Float64Array(n), cy: new Float64Array(n), sub: new Float64Array(2 * n * S2),
    z: new Float64Array(n), col: Int32Array.from(cols), row: Int32Array.from(rows),
  };
  for (let k = 0; k < n; k++) {
    const [x, y] = pixelCentre(dsm, cols[k], rows[k]);
    const lx = x - origin[0], ly = y - origin[1];
    ps.cx[k] = lx; ps.cy[k] = ly;
    ps.z[k] = dsm.data[rows[k] * dsm.width + cols[k]];
    for (let j = 0; j < S2; j++) {
      ps.sub[2 * (k * S2 + j)] = lx + off[2 * j];
      ps.sub[2 * (k * S2 + j) + 1] = ly + off[2 * j + 1];
    }
  }
  return ps;
}

/** Subset of a pixel set (indices into it). */
export function subsetPixels(ps: PixelSet, idx: ArrayLike<number>): PixelSet {
  const n = idx.length, S2 = ps.S2;
  const out: PixelSet = {
    n, S2, res: ps.res, cx: new Float64Array(n), cy: new Float64Array(n), sub: new Float64Array(2 * n * S2),
    z: new Float64Array(n), col: new Int32Array(n), row: new Int32Array(n),
  };
  for (let a = 0; a < n; a++) {
    const k = idx[a];
    out.cx[a] = ps.cx[k]; out.cy[a] = ps.cy[k]; out.z[a] = ps.z[k]; out.col[a] = ps.col[k]; out.row[a] = ps.row[k];
    out.sub.set(ps.sub.subarray(2 * k * S2, 2 * (k + 1) * S2), 2 * a * S2);
  }
  return out;
}

/** Value of `g2` at the centre of pixel (col, row) of `ref`. */
export function valueAtPixel(g2: HeightGrid, ref: HeightGrid, col: number, row: number, same?: boolean): number {
  if (same ?? sameGeometry(g2, ref)) return g2.data[row * ref.width + col];
  const [x, y] = pixelCentre(ref, col, row);
  return bilinear(g2, x, y);
}

/** Selected pixels plus counts of pixels dropped as vegetation / nodata and of all inside pixels. */
export interface PixelSelection { set: PixelSet; nVegetation: number; nNodata: number; nInside: number }

/**
 * Select the fit pixels of a local-frame footprint `poly` (planar = local + origin) on the DSM raster.
 * `kinds[i] === 'party'` marks party edges (eroded by erodeParty); every other edge is free.
 */
export function selectPixels(dsm: HeightGrid, poly: PolygonM, kinds: EdgeKind[], origin: Vec2, opts: PixelOptions = DEFAULT_PIXELS, dsmLast?: HeightGrid): PixelSelection {
  const [x0, y0, x1, y1] = bboxOfPoly(poly);
  const win = pixelWindow(dsm, x0 + origin[0], y0 + origin[1], x1 + origin[0], y1 + origin[1]);
  const segs = edgeSegments(poly);
  const party = segs.map((_, i) => kinds[i] === 'party');
  const cols: number[] = [], rows: number[] = [];
  let nVegetation = 0, nNodata = 0, nInside = 0;
  const lastSame = dsmLast ? sameGeometry(dsmLast, dsm) : false;
  if (win) {
    for (let r = win.r0; r <= win.r1; r++) {
      for (let c = win.c0; c <= win.c1; c++) {
        const [px, py] = pixelCentre(dsm, c, r);
        const x = px - origin[0], y = py - origin[1];
        if (!pointInPoly(x, y, poly)) continue;
        nInside++;
        let dFree = Infinity, dParty = Infinity;
        segs.forEach((s, i) => {
          const d2 = segDist2(x, y, s.ax, s.ay, s.bx, s.by);
          if (party[i]) { if (d2 < dParty) dParty = d2; } else if (d2 < dFree) dFree = d2;
        });
        if (Math.sqrt(dFree) < opts.erode || Math.sqrt(dParty) < opts.erodeParty) continue;
        const z = dsm.data[r * dsm.width + c];
        if (!Number.isFinite(z)) { nNodata++; continue; }
        if (dsmLast) {
          const zl = valueAtPixel(dsmLast, dsm, c, r, lastSame);
          if (Number.isFinite(zl) && z - zl > opts.vegThreshold) { nVegetation++; continue; }
        }
        cols.push(c); rows.push(r);
      }
    }
  }
  return { set: pixelSetFrom(dsm, cols, rows, origin, opts.Q), nVegetation, nNodata, nInside };
}
