// Test support: a replay `Providers` implementation built from the recorded research data in fixtures/sunscan/raw/<slug>/
// (footprint-summary.json geocode + selection, nominatim/photon responses, overpass.json, dsm/dtm GeoTIFFs,
// lidar-meta.json) and the OSTN15 grid. No network access. Unknown inputs fail like a replay miss.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Nation } from '@sunny/sunscan-core';
import type {
  BngGrid,
  BuildingsRequest,
  BuildingsResult,
  ElevationRequest,
  GeocodeCandidate,
  GeocodeLevel,
  GeocodeResult,
  NoCoverage,
  Providers,
  Suggestion,
  SurfaceRasters,
} from '../../src/contracts.js';
import { loadOstn15, readBngGrid } from './geo-fixtures.js';
import { parseOverpass, type OsmElement } from './overpass.js';
import { FIXTURE_DIR, SLUGS, type Slug } from './paths.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const readJson = (slug: string, name: string): Json => JSON.parse(readFileSync(path.join(FIXTURE_DIR, slug, name), 'utf8'));

const NATIONS: Record<string, Nation> = { england: 'England', wales: 'Wales', scotland: 'Scotland', 'northern-ireland': 'Northern Ireland', 'northern ireland': 'Northern Ireland' };
const nationOf = (s: string | undefined): Nation | undefined => (s ? NATIONS[s.toLowerCase()] : undefined);
const LEVELS: GeocodeLevel[] = ['building', 'address-point', 'poi', 'street', 'postcode', 'locality', 'other'];
const levelOf = (s: string | undefined): GeocodeLevel => (LEVELS.includes(s as GeocodeLevel) ? (s as GeocodeLevel) : 'other');
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Everything recorded for one address. */
export interface FixtureRecord {
  slug: Slug;
  input: string;
  summary: Json;
  meta: Json;
  geocode: GeocodeResult;
  suggestions: Suggestion[];
}

const records = new Map<Slug, FixtureRecord>();

/** Position lookup osm ref -> [lat, lon] from the recorded Nominatim and Photon responses. */
function positions(slug: Slug): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const r of readJson(slug, 'nominatim.json').requests ?? []) {
    const list = Array.isArray(r.response) ? r.response : r.response ? [r.response] : [];
    for (const x of list) if (x?.osm_type && x.osm_id && x.lat) out.set(`${x.osm_type}/${x.osm_id}`, [Number(x.lat), Number(x.lon)]);
  }
  const types: Record<string, string> = { W: 'way', N: 'node', R: 'relation' };
  for (const r of readJson(slug, 'photon.json').requests ?? [])
    for (const f of r.response?.features ?? []) {
      const p = f.properties ?? {};
      const key = `${types[p.osm_type] ?? p.osm_type}/${p.osm_id}`;
      if (!out.has(key) && f.geometry?.coordinates) out.set(key, [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
    }
  return out;
}

/** Load (and memoise) the recorded data of one address. */
export function fixture(slug: Slug): FixtureRecord {
  const cached = records.get(slug);
  if (cached) return cached;
  const summary = readJson(slug, 'footprint-summary.json');
  const meta = readJson(slug, 'lidar-meta.json');
  const g = summary.geocode;
  const pos = positions(slug);
  const pc = g.postcode;
  const candidates: GeocodeCandidate[] = (g.candidates ?? []).flatMap((c: Json) => {
    const p = c.osm === g.osm ? [g.lat, g.lon] : pos.get(c.osm);
    return p ? [{ label: c.label, lat: p[0], lon: p[1], level: levelOf(c.level), osmRef: c.osm, score: c.score, reasons: c.reasons ?? [], sources: String(c.source).split(' + ') }] : [];
  });
  const best = candidates.find((c) => c.osmRef === g.osm);
  const geocode: GeocodeResult = {
    query: summary.input,
    parsed: {
      raw: g.parsed.input,
      ...(g.parsed.postcode ? { postcode: g.parsed.postcode.postcode, outward: g.parsed.postcode.outward } : {}),
      ...(g.parsed.houseNumber ? { houseNumber: g.parsed.houseNumber } : {}),
      ...(g.parsed.houseName ? { houseName: g.parsed.houseName } : {}),
      ...(g.parsed.street ? { street: g.parsed.street } : {}),
      localities: g.parsed.localities ?? [],
      ...(nationOf(g.parsed.postcode?.country) ? { nationHint: nationOf(g.parsed.postcode?.country) } : {}),
    },
    confidence: g.confidence,
    ...(best ? { best } : {}),
    candidates,
    ...(pc ? { postcode: { postcode: pc.postcode, lat: pc.lat, lon: pc.lon, nation: nationOf(pc.country), eastings: pc.eastings, northings: pc.northings } } : {}),
  };
  const types: Record<string, string> = { W: 'way', N: 'node', R: 'relation' };
  const suggestions: Suggestion[] = [];
  for (const r of readJson(slug, 'photon.json').requests ?? []) {
    if (!/^photon$/.test(r.purpose)) continue;
    for (const f of r.response?.features ?? []) {
      const p = f.properties ?? {};
      const label = [p.name, [p.housenumber, p.street].filter(Boolean).join(' '), p.city, p.postcode].filter((s: string) => s && s.trim()).join(', ');
      suggestions.push({ label, kind: 'address', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], osmRef: `${types[p.osm_type] ?? p.osm_type}/${p.osm_id}` });
    }
  }
  const rec: FixtureRecord = { slug, input: summary.input, summary, meta, geocode, suggestions };
  records.set(slug, rec);
  return rec;
}

const rasterCache = new Map<string, Promise<{ dsm: BngGrid; dtm: BngGrid; dsmLast?: BngGrid }>>();

function rasters(slug: Slug) {
  let p = rasterCache.get(slug);
  if (!p) {
    const dir = path.join(FIXTURE_DIR, slug);
    p = (async () => {
      const [dsm, dtm] = await Promise.all([readBngGrid(path.join(dir, 'dsm.tif')), readBngGrid(path.join(dir, 'dtm.tif'))]);
      const meta = fixture(slug).meta;
      const dsmLast = meta.files?.['dsm-last-return.tif'] ? await readBngGrid(path.join(dir, 'dsm-last-return.tif')) : undefined;
      return { dsm, dtm, ...(dsmLast ? { dsmLast } : {}) };
    })();
    rasterCache.set(slug, p);
  }
  return p;
}

/** Crop a raster to the pixel window covering bbox (intersection with the raster). */
export function crop(g: BngGrid, b: ElevationRequest['bbox']): BngGrid | undefined {
  const c0 = Math.max(0, Math.floor((b.minE - g.originE) / g.res + 1e-9));
  const c1 = Math.min(g.width, Math.ceil((b.maxE - g.originE) / g.res - 1e-9));
  const r0 = Math.max(0, Math.floor((g.originN - b.maxN) / g.res + 1e-9));
  const r1 = Math.min(g.height, Math.ceil((g.originN - b.minN) / g.res - 1e-9));
  if (c1 <= c0 || r1 <= r0) return undefined;
  const width = c1 - c0;
  const height = r1 - r0;
  const data = new Float32Array(width * height);
  for (let r = 0; r < height; r++) data.set(g.data.subarray((r0 + r) * g.width + c0, (r0 + r) * g.width + c0 + width), r * width);
  return { width, height, originE: g.originE + c0 * g.res, originN: g.originN - r0 * g.res, res: g.res, data };
}

function surveyDates(meta: Json): string[] {
  const v = meta.vintage;
  const out = new Set<string>();
  for (const s of v?.dsmFirst?.surveys ?? []) for (const d of [s.sd_flown, s.ed_flown]) if (d) out.add(String(d).slice(0, 10));
  for (const t of v?.tiles ?? []) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t.date ?? '');
    if (m) out.add(`${m[3]}-${m[2]}-${m[1]}`);
  }
  if (!out.size && meta.dataset?.vintage) for (const y of String(meta.dataset.vintage).split('-')) out.add(y);
  return [...out].sort();
}

function sourceOf(meta: Json): SurfaceRasters['source'] & { licence: SurfaceRasters['licence'] } {
  const id = meta.country === 'England' ? 'ea-lidar-composite-2022' : meta.country === 'Wales' ? 'wg-lidar-2020-23' : `srsp-${meta.dataset?.dataset ?? 'unknown'}`;
  const dates = surveyDates(meta);
  return {
    id,
    title: meta.source,
    retrievalUrls: Object.values(meta.files ?? {}).map((f: Json) => f.retrievalUrl),
    ...(dates.length ? { surveyDates: dates } : {}),
    retrievedAt: meta.retrievedAt,
    licence: { id: 'OGL-UK-3.0', attribution: meta.attribution },
  };
}

/** Options of {@link createFixtureProviders}. */
export interface FixtureProviderOptions {
  /** Replace the elevation provider (e.g. to simulate Northern Ireland / an outage). */
  getSurfaceRasters?: Providers['getSurfaceRasters'];
  /** Override nationAt. */
  nationAt?: Providers['nationAt'];
  /** Imagery tile stub. */
  getImageryTile?: Providers['getImageryTile'];
}

/** Count of calls per provider method (for assertions). */
export type CallLog = Record<string, number>;

const dist2 = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const dy = (a.lat - b.lat) * 111_320;
  const dx = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return dx * dx + dy * dy;
};

/** The recorded address nearest to a point (within `maxM` metres). */
export function nearestFixture(lat: number, lon: number, maxM = 400): FixtureRecord | undefined {
  let best: { f: FixtureRecord; d: number } | undefined;
  for (const s of SLUGS) {
    const f = fixture(s);
    const g = f.summary.geocode;
    const d = dist2({ lat, lon }, { lat: g.lat, lon: g.lon });
    if (!best || d < best.d) best = { f, d };
  }
  return best && best.d <= maxM * maxM ? best.f : undefined;
}

/** Replay Providers over all 9 recorded addresses. */
export function createFixtureProviders(opts: FixtureProviderOptions = {}): Providers & { calls: CallLog } {
  const calls: CallLog = {};
  const hit = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const providers: Providers & { calls: CallLog } = {
    calls,
    async geocodeUk(q: string) {
      hit('geocodeUk');
      const n = norm(q);
      const f = SLUGS.map(fixture).find((r) => norm(r.input) === n || norm(r.slug) === n);
      if (!f) throw Object.assign(new Error(`replay miss: no recorded geocode for "${q}"`), { code: 'REPLAY_MISS' });
      return structuredClone(f.geocode);
    },
    async suggestUk(q: string) {
      hit('suggestUk');
      const n = norm(q);
      return SLUGS.map(fixture)
        .filter((r) => n.length >= 3 && norm(r.input).includes(n))
        .flatMap((r) => r.suggestions.slice(0, 3));
    },
    async nationAt(lat: number, lon: number) {
      hit('nationAt');
      if (opts.nationAt) return opts.nationAt(lat, lon);
      return nearestFixture(lat, lon, 5000)?.geocode.postcode?.nation;
    },
    async fetchBuildings(req: BuildingsRequest): Promise<BuildingsResult> {
      hit('fetchBuildings');
      const f = nearestFixture(req.lat, req.lon, 300);
      if (!f) return { center: { lat: req.lat, lon: req.lon }, ambiguous: true, buildings: [], addressNodes: [], entrances: [], roads: [], sources: ['overpass:fixture'], warnings: ['no recorded buildings here'] };
      const op = readJson(f.slug, 'overpass.json');
      const sel = f.summary.selection;
      return parseOverpass(op.response.elements as OsmElement[], {
        center: { lat: req.lat, lon: req.lon },
        target: req.osmRef && op.response.elements.some((e: Json) => `${e.type}/${e.id}` === req.osmRef) ? req.osmRef : sel.target,
        ambiguous: sel.ambiguous,
        candidates: sel.candidates,
        source: `overpass:fixture/${f.slug}`,
      });
    },
    async getSurfaceRasters(req: ElevationRequest): Promise<SurfaceRasters | NoCoverage> {
      hit('getSurfaceRasters');
      if (opts.getSurfaceRasters) return opts.getSurfaceRasters(req);
      const b = req.bbox;
      for (const s of SLUGS) {
        const meta = fixture(s).meta;
        const w = meta.bounds;
        if (b.maxE <= w.minE || b.minE >= w.maxE || b.maxN <= w.minN || b.minN >= w.maxN) continue;
        const r = await rasters(s);
        const dsm = crop(r.dsm, b);
        const dtm = crop(r.dtm, b);
        if (!dsm || !dtm) continue;
        const dsmLast = r.dsmLast ? crop(r.dsmLast, b) : undefined;
        const requested = ((b.maxE - b.minE) / dsm.res) * ((b.maxN - b.minN) / dsm.res);
        let valid = 0;
        for (let i = 0; i < dsm.data.length; i++) if (Number.isFinite(dsm.data[i]) && Number.isFinite(dtm.data[i])) valid++;
        const { licence, ...source } = sourceOf(meta);
        return { dsm, dtm, ...(dsmLast ? { dsmLast } : {}), source, licence, coverage: Math.min(1, valid / requested), quality: [] };
      }
      return { coverage: 0, reason: 'outside-coverage', detail: 'no recorded LiDAR window here' };
    },
    getOstn15: () => {
      hit('getOstn15');
      return loadOstn15();
    },
    ...(opts.getImageryTile ? { getImageryTile: opts.getImageryTile } : {}),
  };
  return providers;
}

/** The recorded input of a slug (fixtures/test-addresses.json query). */
export const inputOf = (slug: Slug): string => fixture(slug).input;
