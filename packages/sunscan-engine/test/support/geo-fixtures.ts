// Test support: GeoTIFF -> BngGrid (bounds from getBoundingBox(): getResolution()'s Y sign differs between EA and
// Welsh/Scottish files) and OSTN15 (proj4 + the NTv2 GeoTIFF grid shipped in apps/server/data/ostn15).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import type { BngGrid, Ostn15 } from '../../src/contracts.js';
import { REPO_ROOT } from './paths.js';

/** British National Grid with the OSTN15 grid shift (registered once under the key 'OSTN15'). */
export const BNG_OSTN15 = '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +nadgrids=OSTN15 +units=m +no_defs';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';
/** The OSTN15 NTv2 grid as GeoTIFF. */
export const OSTN15_GRID = path.join(REPO_ROOT, 'packages', 'sunscan-engine', 'data', 'ostn15', 'uk_os_OSTN15_NTv2_OSGBtoETRS.tif');

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Read a single-band GeoTIFF in EPSG:27700 as a BngGrid (nodata, < -1e30 and EA's "all zeros without tag" -> NaN). */
export async function readBngGrid(file: string): Promise<BngGrid> {
  const tiff = await fromArrayBuffer(toArrayBuffer(await readFile(file)));
  const img = await tiff.getImage();
  const [minE, , maxE, maxN] = img.getBoundingBox();
  const width = img.getWidth();
  const height = img.getHeight();
  const nodata = img.getGDALNoData();
  const [band] = (await img.readRasters()) as unknown as ArrayLike<number>[];
  const data = new Float32Array(width * height);
  let zeros = 0;
  for (let i = 0; i < data.length; i++) {
    let v = Number(band[i]);
    if ((nodata !== null && (v === nodata || Math.abs(v - nodata) <= 1e-6 * Math.abs(nodata))) || !Number.isFinite(v) || v < -1e30) v = NaN;
    if (v === 0) zeros++;
    data[i] = v;
  }
  if (nodata === null && zeros === data.length) data.fill(NaN);
  return { width, height, originE: minE, originN: maxN, res: (maxE - minE) / width, data };
}

let ostnPromise: Promise<Ostn15> | undefined;

/** OSTN15 transformer (loaded once per process). */
export function loadOstn15(): Promise<Ostn15> {
  ostnPromise ??= (async () => {
    const tiff = await fromArrayBuffer(toArrayBuffer(await readFile(OSTN15_GRID)));
    await proj4.nadgrid('OSTN15', tiff).ready;
    const conv = proj4(WGS84, BNG_OSTN15);
    return {
      toBng: (lon: number, lat: number) => {
        const [e, n] = conv.forward([lon, lat]);
        return [e, n] as [number, number];
      },
      toWgs84: (e: number, n: number) => {
        const [lon, lat] = conv.inverse([e, n]);
        return [lon, lat] as [number, number];
      },
    };
  })();
  return ostnPromise;
}
