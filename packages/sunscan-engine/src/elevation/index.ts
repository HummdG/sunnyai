// getSurfaceRasters (spec §5.4): provider by nation (England EA WCS, Wales COG, Scotland SRSP S3, NI none) with a
// border fallback; window snapped outward to a 16 m lattice (integer metres, multiple of 16 px); EPSG:27700 + ODN.
import type { Nation } from '@sunny/sunscan-core';
import { makeFrame, pointPolygonDistance, type XY } from '@sunny/sunscan-core/geo';
import type { Bbox27700, BuildingsResult, ElevationRequest, LonLat, NoCoverage, Ostn15, SurfaceRasters } from '../contracts.js';
import { nationAt } from '../geocode/suggest.js';
import { isReplayMiss } from '../http/index.js';
import { eaSurfaceRasters } from './ea.js';
import { snapWindow } from './grid.js';
import { bboxFromLonLat, getOstn15 } from './ostn15.js';
import { scotlandSurfaceRasters } from './scotland.js';
import { walesSurfaceRasters } from './wales.js';

export { getOstn15, bboxFromLonLat, OSTN15_GRID, OSTN15_DIR } from './ostn15.js';
export { snapWindow, emptyGrid, pasteInto, validFraction, gridBounds, sampleGrid, tilesCovering, imageGeoref, readImageWindow, toNaN, MAX_WINDOW_M, type GeoRaster, type ImageGeoref } from './grid.js';
export { eaSurfaceRasters, eaGetCoverageUrl, eaIndexUrl, parseEaTiff, EA_LAYERS, EA_TILE_M, EA_SOURCE_ID, EA_ATTRIBUTION, type EaLayer } from './ea.js';
export { walesSurfaceRasters, walesCatalogueUrl, walesDate, WALES_COGS, WALES_SOURCE_ID, WALES_ATTRIBUTION } from './wales.js';
export { scotlandSurfaceRasters, osGridLetters, srspTileStem, srspTileStems, srspListUrl, parseS3List, dtmKeyFor, SRSP_DATASETS, SRSP_BASE, type SrspDataset } from './scotland.js';
export { CachedRangeSource, openRemoteTiff, readRemoteWindow, RemoteFileError, COG_BLOCK } from './cog.js';

/** Window lattice (m): integer metres and a multiple of 16 px at 1 m and 0.5 m. */
export const WINDOW_LATTICE_M = 16;

type ProviderId = 'ea' | 'wales' | 'scotland';
const PROVIDERS: Record<ProviderId, (w: Bbox27700) => Promise<SurfaceRasters | NoCoverage>> = {
  ea: eaSurfaceRasters,
  wales: walesSurfaceRasters,
  scotland: scotlandSurfaceRasters,
};

/** Provider order for a nation: primary first, then plausible cross-border fallbacks for the window. */
export function providerOrder(nation: Nation | undefined, win: Bbox27700): ProviderId[] {
  const cE = (win.minE + win.maxE) / 2;
  const cN = (win.minN + win.maxN) / 2;
  switch (nation) {
    case 'England': return ['ea', ...(cE < 345_000 && cN < 400_000 ? (['wales'] as const) : []), ...(cN > 520_000 ? (['scotland'] as const) : [])];
    case 'Wales': return ['wales', 'ea'];
    case 'Scotland': return ['scotland', ...(cN < 680_000 ? (['ea'] as const) : [])];
    case 'Northern Ireland': return [];
    default: return cN > 560_000 ? ['scotland', 'ea'] : cE < 345_000 && cN < 400_000 ? ['wales', 'ea'] : ['ea', 'wales', 'scotland'];
  }
}

async function nationOfWindow(win: Bbox27700): Promise<Nation | undefined> {
  try {
    const ostn = await getOstn15();
    const [lon, lat] = ostn.toWgs84((win.minE + win.maxE) / 2, (win.minN + win.maxN) / 2);
    return await nationAt(lat, lon);
  } catch (e) {
    if (isReplayMiss(e)) throw e;
    return undefined;
  }
}

/**
 * DSM + DTM (+ last-return DSM in England) covering `req.bbox` (snapped outward to the 16 m lattice), in EPSG:27700,
 * heights in metres above ODN, NaN = nodata; or a NoCoverage reason ('no-open-lidar' for Northern Ireland,
 * 'outside-coverage', 'source-error' when the primary source failed).
 */
export async function getSurfaceRasters(req: ElevationRequest): Promise<SurfaceRasters | NoCoverage> {
  const win = snapWindow(req.bbox, WINDOW_LATTICE_M);
  const nation = req.nation ?? (await nationOfWindow(win));
  if (nation === 'Northern Ireland') return { coverage: 0, reason: 'no-open-lidar', detail: 'Northern Ireland has no national open LiDAR' };
  const order = providerOrder(nation, win);
  let best: SurfaceRasters | undefined;
  let bestFrom: ProviderId | undefined;
  let firstNone: NoCoverage | undefined;
  const errors: string[] = [];
  let primaryFailed = false;
  for (const [i, id] of order.entries()) {
    let r: SurfaceRasters | NoCoverage;
    try {
      r = await PROVIDERS[id](win);
    } catch (e) {
      if (isReplayMiss(e)) throw e;
      errors.push(`${id}: ${(e as Error).message}`);
      if (i === 0) primaryFailed = true;
      continue;
    }
    if (r.coverage === 0) {
      firstNone ??= r as NoCoverage;
      continue;
    }
    const sr = r as SurfaceRasters;
    if (!best || sr.coverage > best.coverage) (best = sr), (bestFrom = id);
    if (best.coverage >= 0.95) break;
  }
  if (best) {
    if (bestFrom !== order[0]) best.quality.push('border-fallback');
    if (errors.length) best.quality.push('provider-error');
    return best;
  }
  if (primaryFailed || (!firstNone && errors.length)) return { coverage: 0, reason: 'source-error', detail: errors.join('; ') };
  return firstNone ?? { coverage: 0, reason: 'outside-coverage', detail: nation ? `no open LiDAR source for ${nation}` : 'nation unknown' };
}

/** Options of {@link elevationBboxForBuildings}. */
export interface ElevationBboxOptions { neighbourDistance?: number; margin?: number }

/**
 * Standard elevation window for a buildings result: bbox (BNG, OSTN15) of the target and every non-part building
 * within `neighbourDistance` (default 50 m, outline-to-outline) of it, expanded by `margin` (default 14 m).
 */
export function elevationBboxForBuildings(result: BuildingsResult, ostn: Ostn15, opts: ElevationBboxOptions = {}): Bbox27700 {
  const target = result.buildings.find((b) => b.ref === result.target);
  if (!target) throw new Error('elevationBboxForBuildings: result has no target');
  const frame = makeFrame(result.center.lat, result.center.lon);
  const loc = (r: LonLat[]): XY[] => r.map((c) => frame.toLocal(c));
  const t = loc(target.outer);
  const maxD = opts.neighbourDistance ?? 50;
  const rings: LonLat[][] = [target.outer];
  for (const b of result.buildings) {
    if (b === target || b.isPart) continue;
    const r = loc(b.outer);
    let d = Infinity;
    for (const p of r) d = Math.min(d, pointPolygonDistance(p, t));
    for (const p of t) d = Math.min(d, pointPolygonDistance(p, r));
    if (d <= maxD) rings.push(b.outer);
  }
  return bboxFromLonLat(ostn, rings, opts.margin ?? 14);
}
