// Real-LiDAR fixtures for the fit tests: fixtures/sunscan/raw/<slug>/{dsm.tif, dtm.tif, dsm-last-return.tif,
// footprint-summary.json, lidar-meta.json}. Footprints (local ENU around the summary's frame origin) are taken
// to WGS84 with the summary's tangent-plane formula and projected to EPSG:27700 with proj4 + the OSTN15 NTv2 grid,
// i.e. the same planar frame as the rasters. Test-only (geotiff / proj4 are dev dependencies at the repo root).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import type { EdgeKind, HeightGrid, PolygonM, ReconstructInput, Vec2 } from '../../../src/types.js';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const RAW_DIR = `${ROOT}fixtures/sunscan/raw`;
const OSTN15 = `${ROOT}packages/sunscan-engine/data/ostn15/uk_os_OSTN15_NTv2_OSGBtoETRS.tif`;
const BNG = '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +nadgrids=OSTN15 +units=m +no_defs';

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

let gridReady: Promise<void> | null = null;
/** Register the OSTN15 grid with proj4 (once). */
export function loadOstn15(): Promise<void> {
  gridReady ??= (async () => {
    const tiff = await fromArrayBuffer(toAB(readFileSync(OSTN15)));
    await proj4.nadgrid('OSTN15', tiff).ready;
    proj4.defs('BNG_OSTN15', BNG);
  })();
  return gridReady;
}

/** Read a single-band GeoTIFF into a HeightGrid (bounds from getBoundingBox; nodata and sentinels -> NaN). */
export async function readGrid(path: string): Promise<HeightGrid> {
  const tiff = await fromArrayBuffer(toAB(readFileSync(path)));
  const img = await tiff.getImage();
  const [minX, minY, maxX, maxY] = img.getBoundingBox();
  const width = img.getWidth(), height = img.getHeight();
  const nodata = img.getGDALNoData();
  const band = (await img.readRasters())[0] as ArrayLike<number>;
  const data = new Float32Array(width * height);
  // rows are north-first in both the EA (+Y scale) and Welsh (-Y scale) files: origin = (minX, maxY)
  const flip = img.getOrigin()[1] === minY && minY !== maxY;
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const v = band[(flip ? height - 1 - r : r) * width + c];
    data[r * width + c] = !Number.isFinite(v) || v < -1000 || v > 5000 || (nodata !== null && v === nodata) ? NaN : v;
  }
  return { width, height, originX: minX, originY: maxY, res: (maxX - minX) / width, data };
}

interface Summary {
  frame: { origin: { lat: number; lon: number }; M_m: number; N_m: number };
  target: { osm: string; ringLocal: number[][]; edges: { partyWall: boolean }[]; houseForm?: string; tags: Record<string, string> };
  neighbours: { osm: string; area_m2: number; ringLocal: number[][] }[];
}

export interface RealCase { slug: string; input: ReconstructInput; houseForm?: string; tags: Record<string, string> }

export const hasRealFixture = (slug: string) => existsSync(`${RAW_DIR}/${slug}/dsm.tif`) && existsSync(`${RAW_DIR}/${slug}/footprint-summary.json`) && existsSync(OSTN15);

/** Load a real fixture as a ReconstructInput in EPSG:27700 (OSTN15). */
export async function loadRealCase(slug: string): Promise<RealCase> {
  await loadOstn15();
  const base = `${RAW_DIR}/${slug}`;
  const fs: Summary = JSON.parse(readFileSync(`${base}/footprint-summary.json`, 'utf8'));
  const { lat, lon } = fs.frame.origin;
  const cos0 = Math.cos((lat * Math.PI) / 180);
  const toBng = (ring: number[][]): Vec2[] => {
    const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    return open.map(([x, y]) => {
      const lo = lon + ((x / (fs.frame.N_m * cos0)) * 180) / Math.PI;
      const la = lat + ((y / fs.frame.M_m) * 180) / Math.PI;
      const [e, n] = proj4('WGS84', 'BNG_OSTN15', [lo, la]) as [number, number];
      return [e, n] as Vec2;
    });
  };
  const target: PolygonM = { outer: toBng(fs.target.ringLocal) };
  const edgeKinds: EdgeKind[] = fs.target.edges.map((e) => (e.partyWall ? 'party' : 'eave'));
  const neighbours = fs.neighbours.filter((n) => n.area_m2 > 5 && n.ringLocal.length >= 4).map((n) => ({ id: n.osm, footprint: { outer: toBng(n.ringLocal) } }));
  const dsm = await readGrid(`${base}/dsm.tif`), dtm = await readGrid(`${base}/dtm.tif`);
  const dsmLast = existsSync(`${base}/dsm-last-return.tif`) ? await readGrid(`${base}/dsm-last-return.tif`) : undefined;
  return {
    slug, houseForm: fs.target.houseForm, tags: fs.target.tags,
    input: { dsm, dtm, ...(dsmLast ? { dsmLast } : {}), target: { id: fs.target.osm, footprint: target, edgeKinds }, neighbours, options: { searchRadius: 6 } },
  };
}
