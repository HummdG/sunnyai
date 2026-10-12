// Aerial ground texture for the 3D viewer (optional live layer, never embedded in exports): Esri World Imagery z19
// tiles (through Providers.getImageryTile, i.e. fetchCached provider 'esri') stitched in Web Mercator and resampled
// into a north-up image of the square [-half, half]² metres in the local ENU frame of a point (x = east, y = north).
// JPEG and PNG tiles are decoded with jpeg-js / pngjs; missing tiles are filled with a neutral colour; the result is
// JPEG. Results are cached per service instance (one per Providers object, LRU) with in-flight de-duplication.
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { makeFrame } from '@sunny/sunscan-core/geo';
import type { ImageryRef } from '@sunny/sunscan-core';
import type { Providers } from '../contracts.js';

/** Zoom level of the stitched tiles (Esri World Imagery native maximum). */
export const ORTHO_ZOOM = 19;
/** Default half-size of the square (m). */
export const ORTHO_DEFAULT_HALF = 60;
/** Accepted half-size range (m). */
export const ORTHO_MIN_HALF = 10;
export const ORTHO_MAX_HALF = 100;
/** Largest output side (px). */
export const ORTHO_MAX_PX = 1024;
/** Most tiles one image may stitch (a +-100 m square needs at most 49 z19 tiles anywhere in the UK). */
export const ORTHO_MAX_TILES = 64;
/** Where the imagery layer is served (WGS84 box of the UK, as for model requests). */
export const IMAGERY_BOUNDS = { minLat: 49.8, maxLat: 60.95, minLon: -8.75, maxLon: 1.9 } as const;

/** True when (lat, lon) lies inside {@link IMAGERY_BOUNDS}. */
export const inImageryBounds = (lat: number, lon: number) =>
  lat >= IMAGERY_BOUNDS.minLat && lat <= IMAGERY_BOUNDS.maxLat && lon >= IMAGERY_BOUNDS.minLon && lon <= IMAGERY_BOUNDS.maxLon;

/** WGS84 bounds of tile (z, x, y): [west, south, east, north]. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lat = (yy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

/** True when tile (z, x, y) intersects {@link IMAGERY_BOUNDS}. */
export function tileInImageryBounds(z: number, x: number, y: number): boolean {
  const [w, s, e, n] = tileBounds(z, x, y);
  return e >= IMAGERY_BOUNDS.minLon && w <= IMAGERY_BOUNDS.maxLon && n >= IMAGERY_BOUNDS.minLat && s <= IMAGERY_BOUNDS.maxLat;
}
/** Attribution required whenever the imagery is shown. */
export const ESRI_IMAGERY_ATTRIBUTION = 'Powered by Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community';

const TILE = 256;
const EARTH_CIRCUMFERENCE_PX0 = 156_543.033_928_040_97; // m per pixel at zoom 0 on the equator
const FILL: [number, number, number] = [118, 122, 108]; // neutral earth tone for missing tiles

/** Web Mercator world pixel coordinates (256 px tiles) of a WGS84 point at zoom z. */
export function worldPx(lon: number, lat: number, z: number): [number, number] {
  const size = TILE * 2 ** z;
  const phi = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return [((lon + 180) / 360) * size, ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size];
}

/** Ground resolution (m per pixel) of zoom z at a latitude. */
export const groundResolution = (lat: number, z: number) => (EARTH_CIRCUMFERENCE_PX0 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** The z-tiles {x, y} covering the ENU square [-half, half]² around (lat, lon) (+1 px margin for resampling). */
export function tilesForSquare(lat: number, lon: number, half: number, z = ORTHO_ZOOM): { x: number; y: number }[] {
  const r = tileRange(lat, lon, half, z);
  const out: { x: number; y: number }[] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push({ x, y });
  return out;
}

function tileRange(lat: number, lon: number, half: number, z: number) {
  const frame = makeFrame(lat, lon);
  let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity;
  for (const [x, y] of [[-half, -half], [half, -half], [half, half], [-half, half], [0, half], [0, -half], [half, 0], [-half, 0]] as const) {
    const [lo, la] = frame.toLonLat([x, y]);
    const [px, py] = worldPx(lo, la, z);
    fx0 = Math.min(fx0, px); fy0 = Math.min(fy0, py); fx1 = Math.max(fx1, px); fy1 = Math.max(fy1, py);
  }
  return { x0: Math.floor((fx0 - 1) / TILE), y0: Math.floor((fy0 - 1) / TILE), x1: Math.floor((fx1 + 1) / TILE), y1: Math.floor((fy1 + 1) / TILE) };
}

/** Decoded RGBA raster. */
interface Rgba { width: number; height: number; data: Uint8Array }

/** Decode a JPEG or PNG tile (by magic bytes); null when it is neither or broken. */
export function decodeTile(body: Uint8Array): Rgba | null {
  try {
    if (body[0] === 0xff && body[1] === 0xd8) {
      const img = jpeg.decode(body, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 });
      return { width: img.width, height: img.height, data: img.data };
    }
    if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) {
      const img = PNG.sync.read(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
      return { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
    }
  } catch {
    /* corrupt tile: treated as missing */
  }
  return null;
}

/** A stitched north-up ground image. */
export interface OrthoImage {
  body: Uint8Array;
  contentType: 'image/jpeg';
  /** Pixel size of the (square) image. */
  size: number;
  /** Metres per output pixel. */
  resolution: number;
  /** Local ENU bounds around the requested point: [minX, minY, maxX, maxY] = [-half, -half, half, half]. */
  bounds: [number, number, number, number];
  zoom: number;
  tiles: number;
  missingTiles: number;
}

/** Tile source (Providers.getImageryTile). */
export type TileSource = NonNullable<Providers['getImageryTile']>;

/**
 * Stitch the z19 tiles around (lat, lon) into a north-up JPEG covering the ENU square [-half, half]² (output pixel
 * size = the native ground resolution, at most ORTHO_MAX_PX px). Null when no tile is available.
 */
export async function buildOrthoImage(getTile: TileSource, lat: number, lon: number, half = ORTHO_DEFAULT_HALF, z = ORTHO_ZOOM): Promise<OrthoImage | null> {
  const r = tileRange(lat, lon, half, z);
  const nx = r.x1 - r.x0 + 1, ny = r.y1 - r.y0 + 1;
  if (nx * ny > ORTHO_MAX_TILES) throw new RangeError(`imagery square needs ${nx * ny} tiles (limit ${ORTHO_MAX_TILES})`);
  const tiles = await Promise.all(
    Array.from({ length: nx * ny }, (_, k) => {
      const tx = r.x0 + (k % nx), ty = r.y0 + Math.floor(k / nx);
      return getTile(z, tx, ty).then((t) => (t ? decodeTile(t.body) : null), () => null);
    }),
  );
  const missingTiles = tiles.filter((t) => !t).length;
  if (missingTiles === tiles.length) return null;

  // mosaic (RGB) of the tile block; tiles that are not 256 px are resampled (nearest)
  const MW = nx * TILE, MH = ny * TILE;
  const mosaic = new Uint8Array(MW * MH * 3);
  tiles.forEach((t, k) => {
    const ox = (k % nx) * TILE, oy = Math.floor(k / nx) * TILE;
    for (let j = 0; j < TILE; j++) {
      for (let i = 0; i < TILE; i++) {
        const o = ((oy + j) * MW + ox + i) * 3;
        if (!t) { mosaic[o] = FILL[0]; mosaic[o + 1] = FILL[1]; mosaic[o + 2] = FILL[2]; continue; }
        const si = Math.min(t.width - 1, Math.floor((i * t.width) / TILE)), sj = Math.min(t.height - 1, Math.floor((j * t.height) / TILE));
        const s = (sj * t.width + si) * 4;
        mosaic[o] = t.data[s]; mosaic[o + 1] = t.data[s + 1]; mosaic[o + 2] = t.data[s + 2];
      }
    }
  });

  // output grid: ENU -> mercator mosaic pixel via a control grid (the map is smooth: bilinear between control points)
  const resolution0 = groundResolution(lat, z);
  const size = Math.max(64, Math.min(ORTHO_MAX_PX, Math.round((2 * half) / resolution0)));
  const step = (2 * half) / size;
  const frame = makeFrame(lat, lon);
  const N = 8;
  const ctl: [number, number][] = [];
  for (let b = 0; b <= N; b++) {
    for (let a = 0; a <= N; a++) {
      const [lo, la] = frame.toLonLat([-half + (2 * half * a) / N, half - (2 * half * b) / N]);
      const [px, py] = worldPx(lo, la, z);
      ctl.push([px - r.x0 * TILE, py - r.y0 * TILE]);
    }
  }
  const sample = (fx: number, fy: number, out: Uint8Array, o: number) => {
    const x = Math.min(MW - 1.001, Math.max(0, fx - 0.5)), y = Math.min(MH - 1.001, Math.max(0, fy - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const i00 = (y0 * MW + x0) * 3, i10 = i00 + 3, i01 = i00 + MW * 3, i11 = i01 + 3;
    for (let c = 0; c < 3; c++) {
      const v = (mosaic[i00 + c] * (1 - tx) + mosaic[i10 + c] * tx) * (1 - ty) + (mosaic[i01 + c] * (1 - tx) + mosaic[i11 + c] * tx) * ty;
      out[o + c] = Math.round(v);
    }
    out[o + 3] = 255;
  };
  const rgba = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const v = ((j + 0.5) * N) / size; // control-grid row coordinate (north -> south)
    const b0 = Math.min(N - 1, Math.floor(v)), tv = v - b0;
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) * N) / size;
      const a0 = Math.min(N - 1, Math.floor(u)), tu = u - a0;
      const c00 = ctl[b0 * (N + 1) + a0], c10 = ctl[b0 * (N + 1) + a0 + 1], c01 = ctl[(b0 + 1) * (N + 1) + a0], c11 = ctl[(b0 + 1) * (N + 1) + a0 + 1];
      const fx = (c00[0] * (1 - tu) + c10[0] * tu) * (1 - tv) + (c01[0] * (1 - tu) + c11[0] * tu) * tv;
      const fy = (c00[1] * (1 - tu) + c10[1] * tu) * (1 - tv) + (c01[1] * (1 - tu) + c11[1] * tu) * tv;
      sample(fx, fy, rgba, (j * size + i) * 4);
    }
  }
  const enc = jpeg.encode({ data: rgba, width: size, height: size }, 85);
  return {
    body: new Uint8Array(enc.data.buffer, enc.data.byteOffset, enc.data.byteLength),
    contentType: 'image/jpeg', size, resolution: step, bounds: [-half, -half, half, half], zoom: z, tiles: tiles.length, missingTiles,
  };
}

/** Cached ortho-image service over one tile source (LRU of finished images, in-flight requests shared). */
export interface OrthoService {
  get(lat: number, lon: number, half?: number): Promise<OrthoImage | null>;
}

/** Create an {@link OrthoService} (one per Providers object). Unavailable results (null) are not cached. */
export function createOrthoService(getTile: TileSource, maxEntries = 24): OrthoService {
  const done = new Map<string, OrthoImage>();
  const pending = new Map<string, Promise<OrthoImage | null>>();
  return {
    async get(lat, lon, half = ORTHO_DEFAULT_HALF) {
      const key = `${lat.toFixed(7)},${lon.toFixed(7)},${half}`;
      const hit = done.get(key);
      if (hit) {
        done.delete(key);
        done.set(key, hit); // most recently used last
        return hit;
      }
      let p = pending.get(key);
      if (!p) {
        p = buildOrthoImage(getTile, lat, lon, half).finally(() => pending.delete(key));
        pending.set(key, p);
        void p.then((img) => {
          if (!img) return;
          done.set(key, img);
          while (done.size > maxEntries) done.delete(done.keys().next().value as string);
        }, () => undefined);
      }
      return p;
    },
  };
}

/** URL (served by this server) of the ground image around a spec origin. */
export const orthoUrl = (lat: number, lon: number, half = ORTHO_DEFAULT_HALF) => `/api/imagery/ortho?lat=${lat}&lon=${lon}&half=${half}`;

/** spec.context.imagery for a spec whose ENU origin is (lat, lon): the live ground texture, never exported. */
export function imageryRef(lat: number, lon: number, half = ORTHO_DEFAULT_HALF): ImageryRef {
  return { url: orthoUrl(lat, lon, half), bounds: [-half, -half, half, half], attribution: ESRI_IMAGERY_ATTRIBUTION, exportable: false };
}

/** True when the imagery tile under (lat, lon) is available (live: fetched/cached; replay: recorded). Never throws. */
export async function imageryAvailable(providers: Providers, lat: number, lon: number, z = ORTHO_ZOOM): Promise<boolean> {
  if (!providers.getImageryTile) return false;
  try {
    const [px, py] = worldPx(lon, lat, z);
    return !!(await providers.getImageryTile(z, Math.floor(px / TILE), Math.floor(py / TILE)));
  } catch {
    return false;
  }
}
