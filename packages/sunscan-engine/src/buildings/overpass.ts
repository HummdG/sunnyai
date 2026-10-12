// Overpass client with endpoint failover (research 01 §3.1-3.2).
//   504/5xx/network error -> next endpoint immediately (a 504 costs 7-14 s; never retry the same host)
//   429 -> one retry on the same host after Retry-After (or 2 s), then the next endpoint
//   HTTP 200 with a runtime-error `remark` (partial data) -> failure, next endpoint
//   a stored successful answer for the same query (cache or fixture, any endpoint) is used before any network pass
import { bodyJson, fetchCached, getHttpMode, isReplayMiss, peekCached, sleep, type FetchOptions } from '../http/index.js';
import type { HttpResponse } from '../contracts.js';
import type { OsmElement } from './osm.js';

/** Failover order (verified 2026-10-08: overpass-api.de 504s ~50 %, overpass.openstreetmap.fr reliable for the UK). */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Highway values fetched for front-edge detection (centre lines people can face a house from). */
export const ROAD_KINDS = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'pedestrian', 'road', 'footway', 'path', 'cycleway', 'track', 'steps', 'bridleway', 'busway',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
];

/** Parses 'way/123' | 'relation/45' | 'node/6' (also with an 'osm:' prefix). */
export function parseOsmRef(ref: string | undefined): { type: 'node' | 'way' | 'relation'; id: number } | undefined {
  const m = /^(?:osm:)?(node|way|relation)\/(\d+)$/.exec((ref ?? '').trim());
  return m ? { type: m[1] as 'node' | 'way' | 'relation', id: Number(m[2]) } : undefined;
}

/**
 * Overpass QL for everything the footprint analysis needs around a point: buildings, multipolygon buildings, building
 * parts, address nodes, entrances and highways within `radius` m (distance to the outline), plus the geocoder's OSM
 * object forced in. `out geom` attaches coordinates to ways and relation members.
 */
export function buildFootprintQuery(lat: number, lon: number, radius = 80, osmRef?: string, timeoutS = 25): string {
  const a = `(around:${Math.round(radius)},${lat.toFixed(7)},${lon.toFixed(7)})`;
  const ref = parseOsmRef(osmRef);
  return [
    `[out:json][timeout:${timeoutS}];`,
    '(',
    `  way["building"]${a};`,
    `  relation["building"]["type"="multipolygon"]${a};`,
    `  way["building:part"]${a};`,
    `  relation["building:part"]["type"="multipolygon"]${a};`,
    `  node["addr:housenumber"]${a};`,
    `  node["addr:housename"]${a};`,
    `  node["entrance"]${a};`,
    `  way["highway"~"^(${ROAD_KINDS.join('|')})$"]${a};`,
    ...(ref ? [`  ${ref.type}(${ref.id});`] : []),
    ');',
    'out geom;',
  ].join('\n');
}

/** One endpoint attempt (diagnostics). */
export interface OverpassAttempt { endpoint: string; status: number; note?: string; fromCache?: boolean }

/** Successful Overpass answer. */
export interface OverpassResult { endpoint: string; elements: OsmElement[]; osmBase?: string; attempts: OverpassAttempt[]; fromCache: boolean }

/** All endpoints failed. */
export class OverpassError extends Error {
  constructor(readonly attempts: OverpassAttempt[]) {
    super(`All Overpass endpoints failed: ${attempts.map((a) => `${new URL(a.endpoint).host} ${a.status}${a.note ? ` (${a.note})` : ''}`).join('; ')}`);
    this.name = 'OverpassError';
  }
}

interface OverpassJson { elements?: OsmElement[]; remark?: string; osm3s?: { timestamp_osm_base?: string } }

const FAILED_REMARK = /runtime error|timed out|out of memory|rate_limited|too busy/i;

function evaluate(res: HttpResponse): { ok: true; json: OverpassJson } | { ok: false; note: string } {
  if (res.status !== 200) return { ok: false, note: `HTTP ${res.status}` };
  const json = bodyJson<OverpassJson>(res);
  if (!json || !Array.isArray(json.elements)) return { ok: false, note: 'not an Overpass JSON response' };
  if (json.remark && FAILED_REMARK.test(json.remark)) return { ok: false, note: `remark: ${json.remark.slice(0, 120)}` };
  return { ok: true, json };
}

const recentFailures = new Map<string, number>();
const PENALTY_MS = 5 * 60_000;

function endpointOrder(endpoints: string[]): string[] {
  if (getHttpMode() !== 'live') return endpoints; // record/replay must follow the same deterministic order
  const now = Date.now();
  const failing = (e: string) => (recentFailures.get(e) ?? 0) > now - PENALTY_MS;
  return [...endpoints.filter((e) => !failing(e)), ...endpoints.filter(failing)];
}

/** Options of {@link overpassQuery}. */
export interface OverpassOptions { endpoints?: string[]; passes?: number; passPauseMs?: number; timeoutMs?: number }

/** Runs an Overpass query with failover; throws {@link OverpassError} when every endpoint fails. */
export async function overpassQuery(query: string, opts: OverpassOptions = {}): Promise<OverpassResult> {
  const endpoints = opts.endpoints ?? OVERPASS_ENDPOINTS;
  const body = `data=${encodeURIComponent(query)}`;
  const request = (endpoint: string, retry = 0): FetchOptions => ({
    url: retry ? `${endpoint}#retry=${retry}` : endpoint, // fragment: distinct cache/fixture key, never sent
    method: 'POST', body, provider: 'overpass', timeoutMs: opts.timeoutMs ?? 40_000,
    headers: { Accept: 'application/json' },
    cacheable: (r) => evaluate(r).ok,
  });
  const attempts: OverpassAttempt[] = [];
  for (const endpoint of endpoints) {
    const hit = await peekCached(request(endpoint));
    const ev = hit ? evaluate(hit) : undefined;
    if (hit && ev?.ok) {
      attempts.push({ endpoint, status: hit.status, fromCache: true });
      return { endpoint, elements: ev.json.elements ?? [], osmBase: ev.json.osm3s?.timestamp_osm_base, attempts, fromCache: true };
    }
  }
  const passes = opts.passes ?? 2;
  const live = getHttpMode() !== 'replay';
  for (let pass = 0; pass < passes; pass++) {
    if (pass > 0 && live) await sleep(opts.passPauseMs ?? 10_000);
    for (const endpoint of endpointOrder(endpoints)) {
      try {
        let res = await fetchCached(request(endpoint, pass * 2));
        if (res.status === 429) {
          attempts.push({ endpoint, status: 429, note: 'rate limited, one retry' });
          const ra = Number(res.headers['retry-after']);
          if (live) await sleep(Math.min(10_000, (Number.isFinite(ra) && ra >= 0 ? ra : 2) * 1000));
          res = await fetchCached(request(endpoint, pass * 2 + 1));
        }
        const ev = evaluate(res);
        if (ev.ok) {
          recentFailures.delete(endpoint);
          attempts.push({ endpoint, status: res.status, fromCache: res.fromCache });
          return { endpoint, elements: ev.json.elements ?? [], osmBase: ev.json.osm3s?.timestamp_osm_base, attempts, fromCache: res.fromCache };
        }
        recentFailures.set(endpoint, Date.now());
        attempts.push({ endpoint, status: res.status, note: ev.note });
      } catch (e) {
        if (isReplayMiss(e)) throw e;
        recentFailures.set(endpoint, Date.now());
        attempts.push({ endpoint, status: 0, note: String((e as Error).message ?? e).slice(0, 160) });
      }
    }
  }
  throw new OverpassError(attempts);
}
