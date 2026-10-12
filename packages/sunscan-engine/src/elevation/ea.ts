// England: Environment Agency LIDAR Composite 2022 via WCS 2.0.1 (research 02 §2).
// Requests are aligned 128 m x 128 m tiles (integer metres, 128 px = multiple of 16 px, DEFLATE) mosaicked into the
// requested window: any window is served from the same cacheable/recordable units.
// Quirks: inside the coverage bbox but no data -> HTTP 200 + all zeros + no GDAL_NODATA tag (= no coverage);
// outside the coverage bbox -> HTTP 500 (= outside coverage, never retried); nodata = -3.4e38.
import { fromArrayBuffer } from 'geotiff';
import type { Bbox27700, BngGrid, NoCoverage, SurfaceRasters } from '../contracts.js';
import { bodyArrayBuffer, bodyJson, fetchCached, HttpError } from '../http/index.js';
import { emptyGrid, pasteInto, readImageWindow, tilesCovering, validFraction, type GeoRaster } from './grid.js';

/** One EA composite layer (canonical GeoServer endpoint + coverage id + survey-index layer). */
export interface EaLayer { key: 'dsm' | 'dsmLast' | 'dtm'; title: string; base: string; coverageId: string; indexLayer: string }

/** Verified 2026-10-08 (GetCapabilities/DescribeCoverage). Ids embed dataset UUIDs: re-validate on deploy. */
export const EA_LAYERS: Record<EaLayer['key'], EaLayer> = {
  dsm: {
    key: 'dsm', title: 'LIDAR Composite First Return DSM 1m (2022)',
    base: 'https://environment.data.gov.uk/geoservices/datasets/df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb/wcs',
    coverageId: 'df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m',
    indexLayer: 'LIDAR_Composite_1m_First_Return_DSM_2022_extents',
  },
  dsmLast: {
    key: 'dsmLast', title: 'LIDAR Composite Last Return DSM 1m (2022)',
    base: 'https://environment.data.gov.uk/geoservices/datasets/9ba4d5ac-d596-445a-9056-dae3ddec0178/wcs',
    coverageId: '9ba4d5ac-d596-445a-9056-dae3ddec0178__Lidar_Composite_Elevation_LZ_DSM_1m',
    indexLayer: 'LIDAR_Composite_1m_Last_Return_DSM_2022_extents',
  },
  dtm: {
    key: 'dtm', title: 'LIDAR Composite DTM 1m (2022)',
    base: 'https://environment.data.gov.uk/geoservices/datasets/13787b9a-26a4-4775-8523-806d13af58fc/wcs',
    coverageId: '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m',
    indexLayer: 'LIDAR_Composite_1m_DTM_2022_extents',
  },
};
/** EA survey-index WFS (composite vintage per point). */
export const EA_INDEX_WFS = 'https://environment.data.gov.uk/spatialdata/survey-index-files/wfs';
/** Side of the aligned request tiles (m). */
export const EA_TILE_M = 128;
/** SurfaceRasters.source.id of the EA provider. */
export const EA_SOURCE_ID = 'ea-lidar-composite-2022';
/** Required EA attribution (OGL v3). */
export const EA_ATTRIBUTION = '© Environment Agency copyright and/or database right 2022. Contains public sector information licensed under the Open Government Licence v3.0.';

/** GetCoverage URL for an integer-metre window in native EPSG:27700 (never resampled), DEFLATE-compressed. */
export function eaGetCoverageUrl(layer: EaLayer, w: Bbox27700): string {
  return `${layer.base}?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=${layer.coverageId}`
    + `&format=image/tiff&subset=E(${w.minE},${w.maxE})&subset=N(${w.minN},${w.maxN})&geotiff:compression=DEFLATE`;
}

/** Survey-index (WFS) URL for the composite vintage at a point (geometry suppressed, ~0.5 kB). */
export function eaIndexUrl(layer: EaLayer, e: number, n: number): string {
  return `${EA_INDEX_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${layer.indexLayer}`
    + '&outputFormat=application/json&propertyName=filename,polygon_id,resolution,year,sd_flown,ed_flown'
    + `&bbox=${e - 0.5},${n - 0.5},${e + 0.5},${n + 0.5},urn:ogc:def:crs:EPSG::27700&count=5`;
}

type TileResult = { kind: 'data'; raster: GeoRaster } | { kind: 'empty' } | { kind: 'outside' };

/** Parses an EA GeoTIFF; "all zeros without a nodata tag" becomes all-NaN (EA's silent no-data answer). */
export async function parseEaTiff(buf: ArrayBuffer, tile: Bbox27700): Promise<GeoRaster | null> {
  const img = await (await fromArrayBuffer(buf)).getImage();
  const r = await readImageWindow(img, tile);
  if (!r) return null;
  if (r.nodataTag == null) {
    let allZero = true;
    for (let i = 0; i < r.data.length && allZero; i++) if (r.data[i] !== 0) allZero = false;
    if (allZero) r.data.fill(NaN);
  }
  return r;
}

async function fetchTile(layer: EaLayer, tile: Bbox27700, urls: string[], fetchedAt: string[]): Promise<TileResult> {
  const url = eaGetCoverageUrl(layer, tile);
  urls.push(url);
  const res = await fetchCached({ url, provider: 'ea-wcs', headers: { Accept: 'image/tiff' } });
  if (res.headers['x-sunscan-fetched-at']) fetchedAt.push(res.headers['x-sunscan-fetched-at']);
  if (res.status === 500) return { kind: 'outside' };
  if (res.status !== 200 || !/tiff/i.test(res.headers['content-type'] ?? '')) {
    throw new HttpError(`EA WCS ${layer.key}: HTTP ${res.status} ${res.headers['content-type'] ?? ''}`, 'ea-wcs', url, res.status);
  }
  const raster = await parseEaTiff(bodyArrayBuffer(res), tile);
  return raster && raster.data.some(Number.isFinite) ? { kind: 'data', raster } : { kind: 'empty' };
}

async function surveyDates(tiles: Bbox27700[]): Promise<{ dates: string[]; failed: number }> {
  const dates = new Set<string>();
  let failed = 0;
  const answers = await Promise.all(tiles.map((t) =>
    fetchCached({ url: eaIndexUrl(EA_LAYERS.dsm, (t.minE + t.maxE) / 2, (t.minN + t.maxN) / 2), provider: 'ea-index', headers: { Accept: 'application/json' } })));
  for (const res of answers) {
    const j = res.status === 200 ? bodyJson<{ features?: { properties?: { sd_flown?: string; ed_flown?: string } }[] }>(res) : null;
    if (!j?.features) {
      failed++;
      continue;
    }
    for (const f of j.features) for (const d of [f.properties?.sd_flown, f.properties?.ed_flown]) if (d) dates.add(d.slice(0, 10));
  }
  return { dates: [...dates].sort(), failed };
}

/** EA DSM (first return), DTM and last-return DSM for a (snapped) window, or why there is none. */
export async function eaSurfaceRasters(win: Bbox27700): Promise<SurfaceRasters | NoCoverage> {
  const tiles = tilesCovering(win, EA_TILE_M);
  const urls: string[] = [];
  const fetchedAt: string[] = [];
  const grids: Record<EaLayer['key'], BngGrid> = { dsm: emptyGrid(win, 1), dtm: emptyGrid(win, 1), dsmLast: emptyGrid(win, 1) };
  let outside = 0;
  let dataTiles = 0;
  const dsmResults = await Promise.all(tiles.map((t) => fetchTile(EA_LAYERS.dsm, t, urls, fetchedAt)));
  dsmResults.forEach((r) => {
    if (r.kind === 'outside') outside++;
    if (r.kind === 'data') {
      dataTiles++;
      pasteInto(grids.dsm, r.raster);
    }
  });
  if (!dataTiles) {
    return outside === tiles.length
      ? { coverage: 0, reason: 'outside-coverage', detail: 'EA WCS: window outside the composite coverage (HTTP 500)' }
      : { coverage: 0, reason: 'outside-coverage', detail: 'EA WCS: no data in window (HTTP 200, all zeros, no nodata tag)' };
  }
  const withData = tiles.filter((_, i) => dsmResults[i].kind === 'data');
  for (const key of ['dtm', 'dsmLast'] as const) {
    const rs = await Promise.all(withData.map((t) => fetchTile(EA_LAYERS[key], t, urls, fetchedAt)));
    for (const r of rs) if (r.kind === 'data') pasteInto(grids[key], r.raster);
  }
  const coverage = validFraction(grids.dsm, grids.dtm);
  const quality: string[] = [];
  if (coverage < 0.95) quality.push('partial-coverage');
  const vintage = await surveyDates(withData);
  if (vintage.failed) quality.push('survey-date-unknown');
  const retrievedAt = fetchedAt.sort().at(-1) ?? new Date().toISOString();
  const newest = Number(vintage.dates.at(-1)?.slice(0, 4));
  if (Number.isFinite(newest) && Number(retrievedAt.slice(0, 4)) - newest > 5) quality.push('survey-older-than-5y');
  const hasLast = validFraction(grids.dsmLast) > 0;
  return {
    dsm: grids.dsm,
    dtm: grids.dtm,
    ...(hasLast ? { dsmLast: grids.dsmLast } : {}),
    source: {
      id: EA_SOURCE_ID,
      title: 'Environment Agency LIDAR Composite 2022 (1 m first-return DSM, last-return DSM, DTM; WCS)',
      retrievalUrls: urls,
      ...(vintage.dates.length ? { surveyDates: vintage.dates } : {}),
      retrievedAt,
    },
    licence: { id: 'OGL-UK-3.0', attribution: EA_ATTRIBUTION },
    coverage,
    quality,
  };
}
