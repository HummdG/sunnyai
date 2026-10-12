// WGS84 (treated as ETRS89) <-> British National Grid (EPSG:27700) with the OSTN15 NTv2 grid (research 02 §7):
// proj4js + OS's grid as GeoTIFF reproduces the official OSTN15 test vectors to <= 8 mm. Helmert-only (+towgs84)
// definitions are 0.6-2.0 m off at the test sites and must never be used for geometry overlaid on LiDAR.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { fromArrayBuffer } from 'geotiff';
import type { Bbox27700, LonLat, Ostn15 } from '../contracts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Folder with the OSTN15 grid and the official OS test vectors. */
export const OSTN15_DIR = path.resolve(HERE, '..', '..', 'data', 'ostn15');
/** OS OSTN15 NTv2 grid (PROJ CDN GeoTIFF conversion, 3.0 MB). */
export const OSTN15_GRID = path.join(OSTN15_DIR, 'uk_os_OSTN15_NTv2_OSGBtoETRS.tif');

const TMERC = '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +units=m +no_defs';
const GRID_KEY = 'sunscan_OSTN15';
const DEF_KEY = 'SUNSCAN_BNG_OSTN15';

let loading: Promise<Ostn15> | null = null;

async function load(file: string): Promise<Ostn15> {
  const buf = await readFile(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const tiff = await fromArrayBuffer(ab);
  await proj4.nadgrid(GRID_KEY, tiff).ready;
  proj4.defs('WGS84', '+proj=longlat +datum=WGS84 +no_defs');
  proj4.defs(DEF_KEY, `${TMERC} +nadgrids=@${GRID_KEY}`);
  const fwd = proj4('WGS84', DEF_KEY);
  const check = (v: number[], what: string) => {
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) throw new RangeError(`OSTN15: ${what} outside the transformation grid`);
    return [v[0], v[1]] as [number, number];
  };
  return {
    toBng: (lon, lat) => check(fwd.forward([lon, lat]), `lon/lat (${lon}, ${lat})`),
    toWgs84: (e, n) => check(fwd.inverse([e, n]), `E/N (${e}, ${n})`),
  };
}

/** Loads (once per process) the OSTN15 transformation. */
export function getOstn15(): Promise<Ostn15> {
  if (!loading) {
    loading = load(OSTN15_GRID).catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

/** Bounding box (BNG) of lon/lat rings, expanded by `margin` metres. */
export function bboxFromLonLat(ostn: Ostn15, rings: LonLat[][], margin = 0): Bbox27700 {
  let minE = Infinity;
  let minN = Infinity;
  let maxE = -Infinity;
  let maxN = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      const [e, n] = ostn.toBng(lon, lat);
      if (e < minE) minE = e;
      if (n < minN) minN = n;
      if (e > maxE) maxE = e;
      if (n > maxN) maxN = n;
    }
  }
  if (!Number.isFinite(minE)) throw new RangeError('bboxFromLonLat: no coordinates');
  return { minE: minE - margin, minN: minN - margin, maxE: maxE + margin, maxN: maxN + margin };
}
