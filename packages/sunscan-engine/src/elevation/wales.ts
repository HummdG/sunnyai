// Wales: Welsh Government LiDAR 2020-2023 national 1 m DSM/DTM Cloud-Optimised GeoTIFFs on Azure Blob
// (research 02 §3). Range reads only, server-side (CORS is restricted to datamap.gov.wales). nodata -9999.
// Datum (ODN) and DSM type (first-return-like) were established empirically against EA data (Chester overlap).
import type { Bbox27700, NoCoverage, SurfaceRasters } from '../contracts.js';
import { bodyJson, fetchCached } from '../http/index.js';
import { readRemoteWindow } from './cog.js';
import { emptyGrid, pasteInto, validFraction } from './grid.js';

/** National 1 m Float32 COGs (DSM 52 GB, DTM 48.6 GB; Range reads only). */
export const WALES_COGS = {
  dsm: 'https://dmwproductionblob.blob.core.windows.net/cogs/lidar/wales_dsm_32bit_cog.tif',
  dtm: 'https://dmwproductionblob.blob.core.windows.net/cogs/lidar/wales_dtm_32bit_cog.tif',
};
/** DataMapWales WFS with the 1 km LiDAR tile catalogue (survey dates). */
export const WALES_TILE_WFS = 'https://datamap.gov.wales/geoserver/ows';
/** SurfaceRasters.source.id of the Wales provider. */
export const WALES_SOURCE_ID = 'wg-lidar-2020-23';
/** Required Welsh Government attribution (OGL v3). */
export const WALES_ATTRIBUTION = 'Contains Welsh Government LiDAR data © Crown copyright, licensed under the Open Government Licence v3.0.';

/** WFS tile-catalogue URL for the 1 km tile containing (e, n). */
export function walesCatalogueUrl(e: number, n: number): string {
  return `${WALES_TILE_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=geonode:welsh_government_lidar_tile_catalogue_2020_2023`
    + `&outputFormat=application/json&srsName=EPSG:27700&bbox=${e - 0.5},${n - 0.5},${e + 0.5},${n + 0.5},EPSG:27700&count=5`;
}

/** "13-01-2022" -> "2022-01-13" (other formats are passed through). */
export function walesDate(d: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d.trim();
}

async function surveyDates(win: Bbox27700): Promise<{ dates: string[]; failed: number }> {
  const dates = new Set<string>();
  let failed = 0;
  for (let n = Math.floor(win.minN / 1000) * 1000; n < win.maxN; n += 1000) {
    for (let e = Math.floor(win.minE / 1000) * 1000; e < win.maxE; e += 1000) {
      const res = await fetchCached({ url: walesCatalogueUrl(e + 500, n + 500), provider: 'wales-index', headers: { Accept: 'application/json' } });
      const j = res.status === 200 ? bodyJson<{ features?: { properties?: { date?: string } }[] }>(res) : null;
      if (!j?.features) {
        failed++;
        continue;
      }
      for (const f of j.features) if (f.properties?.date) dates.add(walesDate(f.properties.date));
    }
  }
  return { dates: [...dates].sort(), failed };
}

/** Welsh DSM/DTM for a (snapped, 1 m-aligned) window, or why there is none. */
export async function walesSurfaceRasters(win: Bbox27700): Promise<SurfaceRasters | NoCoverage> {
  const dsm = emptyGrid(win, 1);
  const a = await readRemoteWindow(WALES_COGS.dsm, 'wales-cog', win);
  if (!a.raster) return { coverage: 0, reason: 'outside-coverage', detail: 'window outside the Welsh national COG extent' };
  pasteInto(dsm, a.raster);
  if (validFraction(dsm) < 0.01) return { coverage: 0, reason: 'outside-coverage', detail: 'no Welsh LiDAR in window (nodata / sea)' };
  const dtm = emptyGrid(win, 1);
  const b = await readRemoteWindow(WALES_COGS.dtm, 'wales-cog', win);
  if (b.raster) pasteInto(dtm, b.raster);
  const coverage = validFraction(dsm, dtm);
  const quality: string[] = ['datum-verified-empirically'];
  if (coverage < 0.95) quality.push('partial-coverage');
  const vintage = await surveyDates(win);
  if (vintage.failed) quality.push('survey-date-unknown');
  return {
    dsm,
    dtm,
    source: {
      id: WALES_SOURCE_ID,
      title: 'Welsh Government LiDAR 2020-2023 national 1 m DSM/DTM (DataMapWales COG)',
      retrievalUrls: [WALES_COGS.dsm, WALES_COGS.dtm],
      ...(vintage.dates.length ? { surveyDates: vintage.dates } : {}),
      retrievedAt: new Date().toISOString(),
    },
    licence: { id: 'OGL-UK-3.0', attribution: WALES_ATTRIBUTION },
    coverage,
    quality,
  };
}
