// Raster helpers for the LiDAR providers: georeferencing (via getBoundingBox: geotiff.js getResolution() has a
// different Y sign for EA's ModelTransformation files (+) and tiepoint/scale COGs (-)), nodata -> NaN, windows on a
// coarse lattice, nearest-neighbour mosaicking into north-up BngGrids.
import type { GeoTIFFImage } from 'geotiff';
import type { Bbox27700, BngGrid } from '../contracts.js';

/** Georeferenced raster block (any orientation), values with nodata already mapped to NaN. */
export interface GeoRaster {
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  resX: number;
  resY: number;
  /** Row 0 is the northern edge. */
  northUp: boolean;
  data: Float32Array;
  /** GDAL_NODATA tag value, null when absent. */
  nodataTag: number | null;
}

/** Image georeferencing derived from the bounding box (robust to the resolution sign quirk). */
export interface ImageGeoref { width: number; height: number; minX: number; minY: number; maxX: number; maxY: number; resX: number; resY: number; northUp: boolean }

/** Largest window side accepted by the providers (m). */
export const MAX_WINDOW_M = 2048;

/** Georeferencing of a GeoTIFF image; throws for rotated/sheared rasters. */
export function imageGeoref(img: GeoTIFFImage): ImageGeoref {
  const fd = img.fileDirectory as unknown as { getValue(tag: string): unknown };
  const width = img.getWidth();
  const height = img.getHeight();
  const [minX, minY, maxX, maxY] = img.getBoundingBox();
  let northUp = true;
  const mt = fd.getValue('ModelTransformation') as number[] | undefined;
  if (mt && mt.length >= 8) {
    if (Math.abs(mt[1]) > 1e-9 || Math.abs(mt[4]) > 1e-9) throw new Error('rotated GeoTIFFs are not supported');
    northUp = mt[5] < 0;
  } else {
    const scale = fd.getValue('ModelPixelScale') as number[] | undefined;
    if (scale && scale[1] < 0) northUp = false;
  }
  return { width, height, minX, minY, maxX, maxY, resX: (maxX - minX) / width, resY: (maxY - minY) / height, northUp };
}

/** Maps nodata sentinels (GDAL_NODATA tag, -3.4e38 style, non-finite) to NaN. */
export function toNaN(band: ArrayLike<number>, nodataTag: number | null): Float32Array {
  const out = new Float32Array(band.length);
  const tolNd = nodataTag != null ? Math.max(1e-6, Math.abs(nodataTag) * 1e-6) : 0;
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    out[i] = !Number.isFinite(v) || v < -1e30 || (nodataTag != null && Math.abs(v - nodataTag) <= tolNd) ? NaN : v;
  }
  return out;
}

/** Reads the pixels of `img` covering `win` (BNG metres); null when the window misses the image. */
export async function readImageWindow(img: GeoTIFFImage, win: Bbox27700, signal?: AbortSignal): Promise<GeoRaster | null> {
  const g = imageGeoref(img);
  const c0 = Math.max(0, Math.floor((win.minE - g.minX) / g.resX + 1e-9));
  const c1 = Math.min(g.width, Math.ceil((win.maxE - g.minX) / g.resX - 1e-9));
  const r0 = Math.max(0, Math.floor((g.northUp ? g.maxY - win.maxN : win.minN - g.minY) / g.resY + 1e-9));
  const r1 = Math.min(g.height, Math.ceil((g.northUp ? g.maxY - win.minN : win.maxN - g.minY) / g.resY - 1e-9));
  if (c1 <= c0 || r1 <= r0) return null;
  const rasters = await img.readRasters({ window: [c0, r0, c1, r1], samples: [0], ...(signal ? { signal } : {}) });
  const band = (Array.isArray(rasters) ? rasters[0] : rasters) as unknown as ArrayLike<number>;
  const nodataTag = img.getGDALNoData();
  const w = c1 - c0;
  const h = r1 - r0;
  const minX = g.minX + c0 * g.resX;
  const maxX = minX + w * g.resX;
  const top = g.northUp ? g.maxY - r0 * g.resY : g.minY + r0 * g.resY;
  const [minY, maxY] = g.northUp ? [top - h * g.resY, top] : [top, top + h * g.resY];
  return { width: w, height: h, minX, minY, maxX, maxY, resX: g.resX, resY: g.resY, northUp: g.northUp, data: toNaN(band, nodataTag), nodataTag };
}

/** Snaps a window outward to a lattice of `latticeM` metres (a multiple of the pixel size) and validates its size. */
export function snapWindow(b: Bbox27700, latticeM = 16): Bbox27700 {
  if (![b.minE, b.minN, b.maxE, b.maxN].every(Number.isFinite) || b.maxE <= b.minE || b.maxN <= b.minN) {
    throw new RangeError(`invalid bbox ${JSON.stringify(b)}`);
  }
  const w = {
    minE: Math.floor(b.minE / latticeM) * latticeM,
    minN: Math.floor(b.minN / latticeM) * latticeM,
    maxE: Math.ceil(b.maxE / latticeM) * latticeM,
    maxN: Math.ceil(b.maxN / latticeM) * latticeM,
  };
  if (w.maxE - w.minE > MAX_WINDOW_M || w.maxN - w.minN > MAX_WINDOW_M) {
    throw new RangeError(`window ${w.maxE - w.minE} x ${w.maxN - w.minN} m exceeds ${MAX_WINDOW_M} m`);
  }
  return w;
}

/** North-up grid of NaN covering `win` at resolution `res`. */
export function emptyGrid(win: Bbox27700, res: number): BngGrid {
  const width = Math.round((win.maxE - win.minE) / res);
  const height = Math.round((win.maxN - win.minN) / res);
  return { width, height, originE: win.minE, originN: win.maxN, res, data: new Float32Array(width * height).fill(NaN) };
}

/** Copies finite source values into `dst` by nearest-neighbour sampling at dst pixel centres; returns pixels written. */
export function pasteInto(dst: BngGrid, src: GeoRaster): number {
  let written = 0;
  for (let r = 0; r < dst.height; r++) {
    const y = dst.originN - (r + 0.5) * dst.res;
    if (y < src.minY || y >= src.maxY) continue;
    const sr = Math.floor((src.northUp ? src.maxY - y : y - src.minY) / src.resY);
    if (sr < 0 || sr >= src.height) continue;
    for (let c = 0; c < dst.width; c++) {
      const x = dst.originE + (c + 0.5) * dst.res;
      if (x < src.minX || x >= src.maxX) continue;
      const sc = Math.floor((x - src.minX) / src.resX);
      if (sc < 0 || sc >= src.width) continue;
      const v = src.data[sr * src.width + sc];
      if (Number.isFinite(v)) {
        dst.data[r * dst.width + c] = v;
        written++;
      }
    }
  }
  return written;
}

/** Fraction of finite pixels (optionally: finite in both grids). */
export function validFraction(a: BngGrid, b?: BngGrid): number {
  if (!a.data.length) return 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i++) if (Number.isFinite(a.data[i]) && (!b || Number.isFinite(b.data[i]))) n++;
  return n / a.data.length;
}

/** BNG bounds of a grid. */
export function gridBounds(g: BngGrid): Bbox27700 {
  return { minE: g.originE, maxN: g.originN, maxE: g.originE + g.width * g.res, minN: g.originN - g.height * g.res };
}

/** Value at BNG (e, n) by nearest pixel; NaN outside. */
export function sampleGrid(g: BngGrid, e: number, n: number): number {
  const c = Math.floor((e - g.originE) / g.res);
  const r = Math.floor((g.originN - n) / g.res);
  return c < 0 || r < 0 || c >= g.width || r >= g.height ? NaN : g.data[r * g.width + c];
}

/** Aligned square tiles of `size` m covering a window (cache-friendly request units). */
export function tilesCovering(win: Bbox27700, size: number): Bbox27700[] {
  const out: Bbox27700[] = [];
  for (let n = Math.floor(win.minN / size) * size; n < win.maxN; n += size) {
    for (let e = Math.floor(win.minE / size) * size; e < win.maxE; e += size) out.push({ minE: e, minN: n, maxE: e + size, maxN: n + size });
  }
  return out;
}
