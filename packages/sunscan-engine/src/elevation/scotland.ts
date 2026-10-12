// Scotland: Scottish Remote Sensing Portal LiDAR, public S3 bucket `srsp-open-data` (research 02 §4). WCS is disabled;
// raw tiled GeoTIFFs (256 px tiles + overviews, nodata -9999) are read with range requests. Coverage is a patchwork of
// datasets: candidates are tried by recency/resolution; tile keys come from cached S3 ListObjectsV2 prefix queries
// (naming differs per dataset), stubs (< 10 kB, all-nodata) are skipped, and a dataset is accepted when >= 95 % of
// the window is valid (otherwise the best partial result is kept as a fallback).
import type { Bbox27700, BngGrid, NoCoverage, SurfaceRasters } from '../contracts.js';
import { bodyText, fetchCached, isReplayMiss } from '../http/index.js';
import { readRemoteWindow, RemoteFileError } from './cog.js';
import { emptyGrid, pasteInto, validFraction } from './grid.js';

/** Public SRSP bucket (eu-west-2, anonymous, CORS *). */
export const SRSP_BASE = 'https://srsp-open-data.s3.eu-west-2.amazonaws.com';

/** One SRSP LiDAR dataset (S3 prefix lidar/<id>/{dsm,dtm}/27700/gridded/). */
export interface SrspDataset { id: string; title: string; vintage: string; res: number; tileM: 1000 | 5000 | 10000; attribution: string }

/** Candidate order: newest first, finer first. Attributions marked (*) are generic (exact per-phase text unverified). */
export const SRSP_DATASETS: SrspDataset[] = [
  { id: 'national-lidar-programme', title: 'Scottish Land LiDAR Programme (national, 50 cm)', vintage: '2025-2027', res: 0.5, tileM: 1000, attribution: 'Scottish Land LiDAR Programme © Crown copyright Scottish Government (*)' },
  { id: 'phase-6', title: 'Scottish Public Sector LiDAR Phase 6 (50 cm)', vintage: '2021-2022', res: 0.5, tileM: 5000, attribution: 'Crown copyright Scottish Government and Fugro (2022) (*)' },
  { id: 'phase-5', title: 'Scottish Public Sector LiDAR Phase 5 (50 cm)', vintage: '2020-2021', res: 0.5, tileM: 5000, attribution: 'Crown copyright Scottish Government and Fugro (2020) [DSM] / (2021) [DTM]' },
  { id: 'phase-4', title: 'Scottish Public Sector LiDAR Phase 4 (50 cm)', vintage: '2017-2019', res: 0.5, tileM: 5000, attribution: 'Crown copyright Scottish Government (2019) (*)' },
  { id: 'phase-3', title: 'Scottish Public Sector LiDAR Phase 3 (50 cm)', vintage: '2015-2016', res: 0.5, tileM: 5000, attribution: 'Crown copyright Scottish Government (2016) (*)' },
  { id: 'phase-2', title: 'Scottish Public Sector LiDAR Phase 2 (1 m)', vintage: '2012-2014', res: 1, tileM: 10000, attribution: 'Crown copyright Scottish Government, SEPA and Scottish Water (2014) (*)' },
  { id: 'phase-1', title: 'Scottish Public Sector LiDAR Phase 1 (1 m)', vintage: '2011-2012', res: 1, tileM: 10000, attribution: 'Crown copyright Scottish Government, SEPA and Scottish Water (2012)' },
];

/** OS 100 km grid-square letters for BNG (e, n), e.g. 'NT'. */
export function osGridLetters(e: number, n: number): string {
  const e100k = Math.floor(e / 100000);
  const n100k = Math.floor(n / 100000);
  let l1 = 19 - n100k - ((19 - n100k) % 5) + Math.floor((e100k + 10) / 5);
  let l2 = (((19 - n100k) * 5) % 25) + (e100k % 5);
  if (l1 > 7) l1++;
  if (l2 > 7) l2++;
  return String.fromCharCode(65 + l1) + String.fromCharCode(65 + l2);
}

/** Tile-name stem of the dataset tile containing (e, n): 'NT0987' (1 km), 'NT08NE' (5 km quadrant), 'NT08' (10 km). */
export function srspTileStem(tileM: SrspDataset['tileM'], e: number, n: number): string {
  const sq = osGridLetters(e, n);
  const ek = Math.floor((e % 100000) / 1000);
  const nk = Math.floor((n % 100000) / 1000);
  if (tileM === 1000) return `${sq}${String(ek).padStart(2, '0')}${String(nk).padStart(2, '0')}`;
  const t10 = `${sq}${Math.floor(ek / 10)}${Math.floor(nk / 10)}`;
  if (tileM === 10000) return t10;
  return `${t10}${n % 10000 >= 5000 ? 'N' : 'S'}${e % 10000 >= 5000 ? 'E' : 'W'}`;
}

/** Stems of the dataset tiles intersecting a window. */
export function srspTileStems(ds: SrspDataset, win: Bbox27700): string[] {
  const out: string[] = [];
  const S = ds.tileM;
  for (let n = Math.floor(win.minN / S) * S; n < win.maxN; n += S) {
    for (let e = Math.floor(win.minE / S) * S; e < win.maxE; e += S) out.push(srspTileStem(S, e + S / 2, n + S / 2));
  }
  return out;
}

/** S3 ListObjectsV2 URL for keys starting with lidar/<dataset>/<product>/27700/gridded/<stem>. */
export function srspListUrl(ds: SrspDataset, product: 'dsm' | 'dtm', stem: string): string {
  return `${SRSP_BASE}/?list-type=2&prefix=${encodeURIComponent(`lidar/${ds.id}/${product}/27700/gridded/${stem}`)}&max-keys=50`;
}

/** Parses a ListObjectsV2 XML body into keys and sizes. */
export function parseS3List(xml: string): { key: string; size: number }[] {
  const out: { key: string; size: number }[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([^<]+)<\/Key>/.exec(m[1])?.[1];
    const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? NaN);
    if (key) out.push({ key: key.replace(/&amp;/g, '&'), size });
  }
  return out;
}

async function listTiles(ds: SrspDataset, stem: string): Promise<string[]> {
  const res = await fetchCached({ url: srspListUrl(ds, 'dsm', stem), provider: 'srsp', headers: { Accept: 'application/xml' } });
  if (res.status !== 200) throw new Error(`SRSP listing ${ds.id}/${stem}: HTTP ${res.status}`);
  const re = new RegExp(`/${stem}_[^/]*dsm[^/]*\\.tiff?$`, 'i');
  return parseS3List(bodyText(res)).filter((o) => re.test(o.key) && o.size > 10_000).map((o) => o.key).sort();
}

/** DTM key next to a DSM key (same naming with DSM -> DTM). */
export const dtmKeyFor = (dsmKey: string) => dsmKey.replace('/dsm/', '/dtm/').replace(/_DSM_/, '_DTM_').replace(/_dsm_/, '_dtm_');

async function mosaic(keys: string[], win: Bbox27700, res: number): Promise<BngGrid> {
  const g = emptyGrid(win, res);
  for (const key of keys) {
    try {
      const { raster } = await readRemoteWindow(`${SRSP_BASE}/${key}`, 'srsp', win);
      if (raster) pasteInto(g, raster);
    } catch (e) {
      if (isReplayMiss(e) || !(e instanceof RemoteFileError)) throw e;
    }
  }
  return g;
}

/** Scottish DSM/DTM for a (snapped) window from the best available SRSP dataset, or why there is none. */
export async function scotlandSurfaceRasters(win: Bbox27700): Promise<SurfaceRasters | NoCoverage> {
  let best: { ds: SrspDataset; dsm: BngGrid; dtm: BngGrid; coverage: number; keys: string[] } | undefined;
  const tried: string[] = [];
  for (const ds of SRSP_DATASETS) {
    const keys = (await Promise.all(srspTileStems(ds, win).map((s) => listTiles(ds, s)))).flat();
    if (!keys.length) continue;
    const dsm = await mosaic(keys, win, ds.res);
    const dsmCov = validFraction(dsm);
    tried.push(`${ds.id}: ${(dsmCov * 100).toFixed(1)} %`);
    if (dsmCov <= (best?.coverage ?? 0)) continue;
    const dtm = await mosaic(keys.map(dtmKeyFor), win, ds.res);
    const coverage = validFraction(dsm, dtm);
    if (!best || coverage > best.coverage) best = { ds, dsm, dtm, coverage, keys };
    if (coverage >= 0.95) break;
  }
  if (!best || best.coverage === 0) {
    return { coverage: 0, reason: 'outside-coverage', detail: `no SRSP dataset covers the window${tried.length ? ` (${tried.join(', ')})` : ''}` };
  }
  const quality: string[] = [];
  if (best.coverage < 0.95) quality.push('partial-coverage');
  if (Number(new Date().getFullYear()) - Number(best.ds.vintage.slice(-4)) > 5) quality.push('survey-older-than-5y');
  return {
    dsm: best.dsm,
    dtm: best.dtm,
    source: {
      id: `srsp-${best.ds.id}`,
      title: `Scottish Remote Sensing Portal: ${best.ds.title}`,
      retrievalUrls: best.keys.flatMap((k) => [`${SRSP_BASE}/${k}`, `${SRSP_BASE}/${dtmKeyFor(k)}`]),
      surveyDates: [best.ds.vintage],
      retrievedAt: new Date().toISOString(),
    },
    licence: { id: 'OGL-UK-3.0', attribution: `${best.ds.attribution}. Contains public sector information licensed under the Open Government Licence v3.0.` },
    coverage: best.coverage,
    quality,
  };
}
