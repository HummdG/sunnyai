// The full pipeline on the REAL providers (createProviders) in replay mode: recorded HTTP fixtures (fixtures/http) for
// postcodes.io, Nominatim/Photon, Overpass, Overture, the LiDAR services (EA WCS, Welsh COGs, SRSP S3) and the Esri
// imagery, with the real core stages (footprint analysis, regularisation, front edge, fit, priors). Complements
// pipeline.test.ts (raw research fixtures + reference stub fitter): here every request the production code makes must
// be recorded, and the facade must be found from real roads / entrances, not guessed.
// Re-record: SUNSCAN_HTTP_MODE=record (npx tsx apps/server/test/support-data/record-fixtures.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import { FIT_METHOD } from '@sunny/sunscan-core/fit';
import type { HouseModelSpec, Vec2 } from '@sunny/sunscan-core';
import type { BuildingsResult, GeocodeResult, LonLat } from '../src/contracts.js';
import { getHttpLog, resetHttpConfig, resetHttpState, setHttpMode } from '../src/http/index.js';
import { createOrthoService, ESRI_IMAGERY_ATTRIBUTION } from '../src/imagery/ortho.js';
import { buildModel, type BuildModelResult } from '../src/pipeline/index.js';
import { createProviders } from '../src/providers/index.js';
import { SLUGS, type Slug } from './support/paths.js';
import { expectWellFormedSpec } from './support/spec-checks.js';
import { loadTestAddresses } from './support-data/expectations.js';

interface Expected {
  id: string;
  form: HouseModelSpec['builtForm'];
  nation: 'England' | 'Wales' | 'Scotland';
  /** party walls of the house (all parts) */
  party: number;
  lidar: string;
  /** the street the front of the house faces (addr:street / the road its front edge looks at) */
  street: string;
  /** the front edge's outward ray hits that street within this many metres (no mapped centre line: undefined) */
  rayWithin?: number;
}

// Keyed by every SunScanV2 address; only the vendored ones (SLUGS) are exercised here.
const EXPECTED: Record<string, Expected> & Record<Slug, Expected> = {
  'uk-mendips': { id: 'osm:way/516128867', form: 'semi-detached', nation: 'England', party: 1, lidar: 'ea-lidar-composite-2022', street: 'Menlove Avenue', rayWithin: 30 },
  'uk-forthlin-road': { id: 'osm:way/516125064', form: 'mid-terrace', nation: 'England', party: 2, lidar: 'ea-lidar-composite-2022', street: 'Forthlin Road', rayWithin: 20 },
  'uk-dickens-museum': { id: 'osm:way/805137285', form: 'mid-terrace', nation: 'England', party: 2, lidar: 'ea-lidar-composite-2022', street: 'Doughty Street', rayWithin: 15 },
  'uk-jane-austen-house': { id: 'osm:way/293116440', form: 'detached', nation: 'England', party: 0, lidar: 'ea-lidar-composite-2022', street: 'Winchester Road', rayWithin: 20 },
  'uk-shakespeare-birthplace': { id: 'osm:way/150342334', form: 'detached', nation: 'England', party: 0, lidar: 'ea-lidar-composite-2022', street: 'Henley Street', rayWithin: 20 },
  'uk-down-house': { id: 'osm:way/120876216', form: 'detached', nation: 'England', party: 0, lidar: 'ea-lidar-composite-2022', street: 'Luxted Road', rayWithin: 50 },
  'uk-hill-top': { id: 'osm:way/164730604', form: 'detached', nation: 'England', party: 0, lidar: 'ea-lidar-composite-2022', street: 'Near Sawrey' },
  'wales-dylan-thomas-birthplace': { id: 'osm:way/518358901', form: 'semi-detached', nation: 'Wales', party: 1, lidar: 'wg-lidar-2020-23', street: 'Cwmdonkin Drive', rayWithin: 20 },
  'scot-carnegie-birthplace': { id: 'osm:way/429457399', form: 'detached', nation: 'Scotland', party: 0, lidar: 'srsp-phase-5', street: 'Moodie Street', rayWithin: 60 },
};

const NOW = new Date('2026-10-09T12:00:00.000Z');
const QUERY = Object.fromEntries(loadTestAddresses().map((a) => [a.slug, a.query])) as Record<Slug, string>;
const providers = createProviders();
const results = new Map<Slug, BuildModelResult>();

/** Distance along the outward normal of the front edge (from its midpoint) to the named road, or undefined. */
function frontRayTo(spec: HouseModelSpec, street: string): number | undefined {
  const f = spec.facade.front!;
  const ring = spec.parts.find((p) => p.id === f.partId)!.footprint.outer;
  const a = ring[f.edge], b = ring[(f.edge + 1) % ring.length];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n: Vec2 = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]; // outward normal of a CCW ring
  const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let best: number | undefined;
  for (const r of spec.context.roads ?? []) {
    if (r.name !== street) continue;
    for (let k = 0; k + 1 < r.line.length; k++) {
      const [p, q] = [r.line[k], r.line[k + 1]];
      const ex = q[0] - p[0], ey = q[1] - p[1], den = n[0] * ey - n[1] * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = p[0] - m[0], wy = p[1] - m[1];
      const t = (wx * ey - wy * ex) / den, u = (wx * n[1] - wy * n[0]) / den;
      if (t > 0 && u >= 0 && u <= 1 && (best === undefined || t < best)) best = t;
    }
  }
  return best;
}

beforeAll(() => {
  setHttpMode('replay');
  resetHttpState();
});
afterAll(() => {
  resetHttpConfig();
});

describe.each(SLUGS)('pipeline on the real providers in replay mode: %s', (slug) => {
  const exp = EXPECTED[slug];
  let r: BuildModelResult;
  beforeAll(async () => {
    // like POST /api/model: the geocoded point + address, buildings fetched by the pipeline itself
    const geocode = await providers.geocodeUk(QUERY[slug]);
    r = await buildModel({ lat: geocode.best!.lat, lon: geocode.best!.lon, address: QUERY[slug], geocode }, { providers, now: () => NOW, log: () => undefined });
    results.set(slug, r);
  }, 60_000);

  it('builds a well-formed spec of the right building from recorded data only', () => {
    const s = r.spec;
    expectWellFormedSpec(s);
    expect(s.id).toBe(exp.id);
    expect(s.address.nation).toBe(exp.nation);
    expect(s.address.postcode).toMatch(/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/);
    expect(s.quality.geocode).toBe('high');
    expect(s.fit?.method).toBe(FIT_METHOD);
    expect(s.groundElevation).not.toBeNull();
    expect(s.context.terrain).toBeDefined();
    expect(s.quality.flags).not.toContain('lidar-unavailable');
    const lidar = s.provenance.find((p) => p.id === exp.lidar);
    expect(lidar?.licence).toBe('OGL-UK-3.0');
    for (const id of ['osm', 'postcodes.io']) expect(s.provenance.map((p) => p.id)).toContain(id);
  });

  it('detects party walls and the built form (no multi-dwelling outline)', () => {
    expect(r.spec.builtForm).toBe(exp.form);
    const party = r.spec.parts.reduce((n, p) => n + p.edgeKinds.filter((k) => k === 'party').length, 0);
    if (exp.party === 0) expect(party).toBe(0);
    else expect(party).toBeGreaterThanOrEqual(exp.party);
    expect(r.spec.context.neighbours.filter((n) => n.attached).length).toBeGreaterThanOrEqual(exp.party);
    expect(r.diagnostics?.footprint.terraceBlock).toBe(false);
    expect(r.spec.quality.flags).not.toContain('terrace-block');
  });

  it(`faces ${exp.street}: front edge from a real road or entrance, not guessed`, () => {
    const s = r.spec;
    expect(['road', 'entrance']).toContain(r.diagnostics?.front?.method);
    expect(s.quality.flags).not.toContain('front-edge-guessed');
    expect(s.facade.streetName).toBe(exp.street);
    expect(s.facade.front).toBeDefined();
    if (exp.rayWithin !== undefined) {
      const d = frontRayTo(s, exp.street);
      expect(d, `ray from the front edge towards ${exp.street}`).toBeDefined();
      expect(d!).toBeLessThan(exp.rayWithin);
    }
    if (r.diagnostics?.front?.method === 'entrance') {
      // the mapped entrance lies on the front wall
      const f = s.facade.front!;
      const ring = s.parts.find((p) => p.id === f.partId)!.footprint.outer;
      const [a, b] = [ring[f.edge], ring[(f.edge + 1) % ring.length]];
      const e = s.facade.entrance!;
      const t = Math.max(0, Math.min(1, ((e[0] - a[0]) * (b[0] - a[0]) + (e[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)));
      expect(Math.hypot(e[0] - (a[0] + t * (b[0] - a[0])), e[1] - (a[1] + t * (b[1] - a[1])))).toBeLessThan(1.5);
    }
  });

  it('references the recorded aerial ground texture (live layer, not exportable)', () => {
    expect(r.spec.context.imagery).toEqual({
      url: `/api/imagery/ortho?lat=${r.spec.origin.lat}&lon=${r.spec.origin.lon}&half=60`,
      bounds: [-60, -60, 60, 60],
      attribution: ESRI_IMAGERY_ATTRIBUTION,
      exportable: false,
    });
  });
});

describe('replay completeness', () => {
  // 48 Doughty Street (front from an entrance) is not among the vendored fixtures; SunScanV2's suite covers it.
  it('20 Forthlin Road and 251 Menlove Avenue face their own streets', () => {
    expect(results.get('uk-forthlin-road')!.diagnostics?.front?.method).toBe('road');
    expect(results.get('uk-mendips')!.diagnostics?.front?.method).toBe('road');
  });

  it('fits 20 Forthlin Road reliably on the real provider path (A3; CR-01: Overture outlines are no registration anchors)', () => {
    const s = results.get('uk-forthlin-road')!.spec;
    expect(s.fit!.unreliable).toBe(false);
    expect(s.fit!.sigma).toBeLessThan(0.4);
    expect(s.quality.heights).toBe('measured');
    const main = s.parts.find((p) => p.role === 'main')!;
    expect(main.source).toEqual({ heights: 'lidar', roof: 'lidar' });
    expect(main.roof.type).toBe('gabled');
    expect(main.roof.pitchDeg!).toBeGreaterThan(38);
    expect(main.roof.pitchDeg!).toBeLessThan(46);
    expect(main.eaveHeight).toBeGreaterThanOrEqual(5.05);
    expect(main.eaveHeight).toBeLessThanOrEqual(5.35);
    // registration close to the research shift (−0.7, −0.3) m, not dragged by the ML-traced Overture outlines
    expect(Math.hypot(s.fit!.registration.shift[0] + 0.5, s.fit!.registration.shift[1] + 0.25)).toBeLessThan(0.6);
  });

  it.each(['uk-mendips', 'uk-forthlin-road', 'wales-dylan-thomas-birthplace'] as const)('%s: ordinary house, reliable LiDAR roof (A3: eave 4.5–7.5 m, pitch 25–50°, σ* <= 0.5 m)', (slug) => {
    const s = results.get(slug)!.spec;
    expect(s.fit!.unreliable).toBe(false);
    expect(s.fit!.sigma).toBeLessThanOrEqual(0.5);
    const main = s.parts.find((p) => p.role === 'main')!;
    expect(main.roof.type).not.toBe('flat');
    expect(main.eaveHeight).toBeGreaterThanOrEqual(4.5);
    expect(main.eaveHeight).toBeLessThanOrEqual(7.5);
    expect(main.roof.pitchDeg!).toBeGreaterThanOrEqual(25);
    expect(main.roof.pitchDeg!).toBeLessThanOrEqual(50);
  });

  it('served every request from fixtures (no replay miss)', () => {
    expect(results.size).toBe(SLUGS.length);
    const log = getHttpLog();
    expect(log.length).toBeGreaterThan(50);
    expect(log.filter((e) => e.source === 'miss').map((e) => `${e.provider} ${e.url}`)).toEqual([]);
    expect(log.every((e) => e.source === 'fixture')).toBe(true);
  });

  it('stitches the recorded Esri tiles around every origin without gaps', async () => {
    const svc = createOrthoService((z, x, y) => providers.getImageryTile!(z, x, y));
    for (const slug of SLUGS) {
      const s = results.get(slug)!.spec;
      const img = await svc.get(s.origin.lat, s.origin.lon, 60);
      expect(img, slug).not.toBeNull();
      expect(img!.missingTiles, slug).toBe(0);
      const px = jpeg.decode(img!.body, { useTArray: true });
      let min = 255, max = 0;
      for (let i = 0; i < px.data.length; i += 4 * 97) (min = Math.min(min, px.data[i + 1])), (max = Math.max(max, px.data[i + 1]));
      expect(max - min, `${slug}: a real photo, not a fill`).toBeGreaterThan(60);
    }
  });
});
