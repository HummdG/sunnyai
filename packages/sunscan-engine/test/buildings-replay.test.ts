// Replay-mode tests of fetchBuildings + core/footprint on the recorded Overpass/Overture fixtures (no network).
import { frameAtCentroid, frontEdge, lonLatToLocal, regularizeFootprintDetailed } from '@sunny/sunscan-core/footprint';
import { isSimple, polygonArea } from '@sunny/sunscan-core/geometry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchBuildings, fetchOvertureBuildings } from '../src/buildings/index.js';
import type { BuildingsResult, GeocodeResult } from '../src/contracts.js';
import { geocodeUk } from '../src/geocode/index.js';
import { resetHttpConfig, resetHttpState, setHttpMode } from '../src/http/index.js';
import { analyseTarget } from './support-data/analysis.js';
import { EXPECTED, loadTestAddresses } from './support-data/expectations.js';

/** Research 01 §3.7: area (m2) and party-wall lengths (m) of each target. */
const RESEARCH: Record<string, { area: number; party: number[]; street?: string }> = {
  'uk-mendips': { area: 73.85, party: [9.65], street: 'Menlove Avenue' },
  'uk-forthlin-road': { area: 55.96, party: [8.11, 8.1], street: 'Forthlin Road' },
  'uk-dickens-museum': { area: 61.87, party: [10.38, 10.37], street: 'Doughty Street' },
  'uk-jane-austen-house': { area: 193.36, party: [], street: 'Winchester Road' },
  'uk-shakespeare-birthplace': { area: 174.24, party: [], street: 'Henley Street' },
  'uk-down-house': { area: 522.15, party: [], street: 'Luxted Road' },
  'uk-hill-top': { area: 223.92, party: [] },
  'wales-dylan-thomas-birthplace': { area: 87.23, party: [9.73], street: 'Cwmdonkin Drive' },
  'scot-carnegie-birthplace': { area: 527.27, party: [] },
};

const cache = new Map<string, { g: GeocodeResult; b: BuildingsResult }>();
async function load(slug: string, query: string) {
  if (!cache.has(slug)) {
    const g = await geocodeUk(query);
    const b = await fetchBuildings({ lat: g.best!.lat, lon: g.best!.lon, osmRef: g.best!.osmRef, parsed: g.parsed });
    cache.set(slug, { g, b });
  }
  return cache.get(slug)!;
}

beforeAll(() => {
  resetHttpConfig();
  setHttpMode('replay');
  resetHttpState();
});
afterAll(() => resetHttpConfig());

describe('fetchBuildings + analyseFootprint (replay)', () => {
  for (const a of loadTestAddresses()) {
    const exp = EXPECTED[a.slug];
    const res = RESEARCH[a.slug];
    it(`${a.slug}: target ${exp.osmRef}, ${exp.builtForm}`, async () => {
      const { b } = await load(a.slug, a.query);
      expect(b.target).toBe(`osm:${exp.osmRef}`);
      expect(b.ambiguous).toBe(false);
      const [top, second] = b.buildings;
      expect(top.ref).toBe(b.target);
      expect(top.score).toBeGreaterThanOrEqual(150);
      expect(top.reasons).toContain('geocoder returned this building');
      if (second && !second.isPart) expect(top.score! - second.score!).toBeGreaterThan(100);
      expect(b.sources.some((s) => s.startsWith('overpass:'))).toBe(true);
      expect(b.sources).toContain('overture:2026-09-23.1');
      expect(b.roads.length).toBeGreaterThan(0);
      const osm = analyseTarget(b, ['osm']);
      const all = analyseTarget(b);
      expect(osm.builtForm).toBe(exp.builtForm);
      expect(all.builtForm).toBe(exp.builtForm); // Overture gap-fillers must not invent party walls
      expect(polygonArea(osm.local)).toBeCloseTo(res.area, 1);
      const party = osm.edgeKinds.map((k, i) => (k === 'party' ? osm.sharedLength[i] : -1)).filter((x) => x >= 0).sort((x, y) => y - x);
      expect(party).toHaveLength(res.party.length);
      party.forEach((len, i) => expect(Math.abs(len - res.party[i])).toBeLessThan(0.05));
    });
  }
  it('Mendips: only 2 OSM buildings within 80 m; Overture fills in the missing neighbours', async () => {
    const { b } = await load('uk-mendips', '251 Menlove Avenue, Liverpool L25 7SA');
    expect(b.buildings.filter((x) => x.source === 'osm' && !x.isPart)).toHaveLength(2);
    const ov = b.buildings.filter((x) => x.source === 'overture');
    expect(ov.length).toBeGreaterThan(10);
    expect(ov.every((x) => x.ref.startsWith('overture:') && x.tags['overture:id'] && x.tags.building)).toBe(true);
    expect(b.warnings.join(' ')).toMatch(/Overture outline/);
  });
  it('Doughty Street: address nodes and entrances are returned with tags', async () => {
    const { b } = await load('uk-dickens-museum', '48 Doughty Street, London WC1N 2LX');
    expect(b.addressNodes.length).toBeGreaterThan(5);
    expect(b.addressNodes.some((n) => n.tags['addr:housenumber'] === '48-49')).toBe(true);
    expect(b.entrances.length).toBeGreaterThan(0);
  });
});

describe('regularisation and street-facing edge on real footprints (replay)', () => {
  for (const a of loadTestAddresses()) {
    it(`${a.slug}`, async () => {
      const { g, b } = await load(a.slug, a.query);
      const an = analyseTarget(b, ['osm']);
      const reg = regularizeFootprintDetailed(an.local);
      expect(Math.abs(reg.areaChange)).toBeLessThan(0.02);
      expect(isSimple(reg.polygon)).toBe(true);
      expect(reg.polygon.outer.length).toBeLessThanOrEqual(an.local.outer.length);
      const frame = frameAtCentroid(an.target.outer, an.target.holes);
      const roads = b.roads.map((r) => ({ kind: r.kind, ...(r.name ? { name: r.name } : {}), line: lonLatToLocal(frame, r.coords) }));
      const entrance = b.entrances.map((e) => lonLatToLocal(frame, [[e.lon, e.lat]])[0])[0];
      const fe = frontEdge(an.local, an.edgeKinds, roads, entrance, an.target.tags['addr:street'] ?? g.parsed.street)!;
      expect(fe).not.toBeNull();
      expect(an.edgeKinds[fe.edge]).toBe('eave');
      const street = RESEARCH[a.slug].street;
      if (street && fe.method === 'road') expect(fe.road).toBe(street);
    });
  }
});

describe('Overture PMTiles (replay)', () => {
  it('decodes the recorded z14 tile around Mendips with OSM and Microsoft ML sources', async () => {
    const all = await fetchOvertureBuildings(53.3772527, -2.8813616, 110);
    expect(all.length).toBeGreaterThan(500);
    const ds = new Set(all.flatMap((x) => x.datasets));
    expect(ds.has('OpenStreetMap')).toBe(true);
    expect(ds.has('Microsoft ML Buildings')).toBe(true);
    const mendips = all.find((x) => x.osmRef === 'way/516128867');
    expect(mendips?.outer.length).toBeGreaterThanOrEqual(4);
  });
});
