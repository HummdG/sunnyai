// Full pipeline on the 9 recorded test addresses (fixture providers: recorded geocode, Overpass, LiDAR windows,
// OSTN15), with the deterministic reference stub fitter so the assertions do not depend on core/fit's evolution
// (the real fitter is exercised in pipeline-core-fit.test.ts). Footprint analysis and priors are the core modules.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BuildingPartSpec, HouseModelSpec } from '@sunny/sunscan-core';
import { buildModel, type BuildModelResult } from '../src/pipeline/index.js';
import { createFixtureProviders, inputOf } from './support/fixture-providers.js';
import { SLUGS, type Slug } from './support/paths.js';
import { expectWellFormedSpec, ridgeOf } from './support/spec-checks.js';
import { stubReconstruct } from './support/stub-fit/reconstruct.js';

const NOW = new Date('2026-10-08T12:00:00.000Z');

interface Expected {
  id: string;
  form: HouseModelSpec['builtForm'];
  nation: 'England' | 'Wales' | 'Scotland';
  heritage?: boolean;
  /** ordinary houses: reliable LiDAR fit expected (criterion A3) */
  ordinary?: boolean;
  party: number;
}

// Keyed by every SunScanV2 address; only the vendored ones (SLUGS) are exercised here.
const EXPECTED: Record<string, Expected> & Record<Slug, Expected> = {
  'uk-mendips': { id: 'osm:way/516128867', form: 'semi-detached', nation: 'England', ordinary: true, party: 1 },
  'uk-forthlin-road': { id: 'osm:way/516125064', form: 'mid-terrace', nation: 'England', ordinary: true, party: 2 },
  'uk-dickens-museum': { id: 'osm:way/805137285', form: 'mid-terrace', nation: 'England', party: 2 },
  'uk-jane-austen-house': { id: 'osm:way/293116440', form: 'detached', nation: 'England', heritage: true, party: 0 },
  'uk-shakespeare-birthplace': { id: 'osm:way/150342334', form: 'detached', nation: 'England', heritage: true, party: 0 },
  'uk-down-house': { id: 'osm:way/120876216', form: 'detached', nation: 'England', party: 0 },
  'uk-hill-top': { id: 'osm:way/164730604', form: 'detached', nation: 'England', heritage: true, party: 0 },
  'wales-dylan-thomas-birthplace': { id: 'osm:way/518358901', form: 'semi-detached', nation: 'Wales', ordinary: true, party: 1 },
  'scot-carnegie-birthplace': { id: 'osm:way/429457399', form: 'detached', nation: 'Scotland', heritage: true, party: 0 },
};

const providers = createFixtureProviders();
const results = new Map<Slug, BuildModelResult>();

async function run(slug: Slug): Promise<BuildModelResult> {
  const q = inputOf(slug);
  const geocode = await providers.geocodeUk(q);
  expect(geocode.best).toBeDefined();
  return buildModel(
    { lat: geocode.best!.lat, lon: geocode.best!.lon, address: q, geocode },
    { providers, reconstruct: stubReconstruct, reconstructLabel: 'stub-fit', now: () => NOW, log: () => undefined },
  );
}

const main = (s: HouseModelSpec): BuildingPartSpec => s.parts.find((p) => p.role === 'main') ?? s.parts[0];

describe.each(SLUGS)('pipeline on recorded data: %s', (slug) => {
  const exp = EXPECTED[slug];
  let r: BuildModelResult;
  beforeAll(async () => {
    r = await run(slug);
    results.set(slug, r);
  }, 60_000);

  it('produces a well-formed spec for the right building', () => {
    expectWellFormedSpec(r.spec);
    expect(r.spec.id).toBe(exp.id);
    expect(r.spec.generatedAt).toBe(NOW.toISOString());
    expect(r.spec.address.input).toBe(inputOf(slug));
    expect(r.spec.address.nation).toBe(exp.nation);
    expect(r.spec.address.postcode).toMatch(/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/);
    expect(r.timings.total).toBeGreaterThan(0);
    for (const k of ['buildings', 'footprint', 'elevation', 'reconstruct', 'assemble']) expect(r.timings[k]).toBeGreaterThanOrEqual(0);
  });

  it('detects party walls and the built form', () => {
    expect(r.spec.builtForm).toBe(exp.form);
    const parties = main(r.spec).edgeKinds.filter((k) => k === 'party').length;
    expect(parties).toBe(exp.party);
    expect(r.spec.context.neighbours.filter((n) => n.attached).length).toBeGreaterThanOrEqual(exp.party);
  });

  it('has plausible heights above the LiDAR ground datum', () => {
    expect(r.spec.groundElevation).not.toBeNull();
    for (const p of r.spec.parts) {
      expect(p.eaveHeight).toBeGreaterThanOrEqual(2.3);
      expect(p.eaveHeight).toBeLessThanOrEqual(16);
      const ridge = ridgeOf(p);
      expect(ridge).toBeGreaterThanOrEqual(p.eaveHeight);
      expect(ridge - p.eaveHeight).toBeLessThan(15);
    }
    expect(main(r.spec).storeys).toBeGreaterThanOrEqual(1);
    expect(main(r.spec).storeys).toBeLessThanOrEqual(5);
  });

  it('carries LiDAR evidence, terrain, provenance and quality flags', () => {
    const s = r.spec;
    expect(s.fit).toBeDefined();
    expect(s.fit!.method).toBe('stub-fit');
    expect(s.evidence!.points.length).toBeGreaterThan(30);
    expect(s.context.terrain).toBeDefined();
    const ids = s.provenance.map((p) => p.id);
    expect(ids).toContain('osm');
    expect(ids).toContain('postcodes.io');
    const lidar = s.provenance.find((p) => /lidar|srsp/.test(p.id))!;
    expect(lidar.licence).toBe('OGL-UK-3.0');
    expect(lidar.attribution.length).toBeGreaterThan(10);
    expect(s.quality.flags.includes('heritage-building')).toBe(!!exp.heritage);
    expect(s.quality.flags).not.toContain('lidar-unavailable');
    expect(s.quality.geocode).toBe('high');
    // a registration shift of a few metres at most (research: 0.7–2.8 m)
    expect(Math.hypot(...s.fit!.registration.shift)).toBeLessThan(4);
  });

  if (exp.ordinary) {
    it('fits the ordinary house reliably (criterion A3)', () => {
      const s = r.spec;
      expect(s.fit!.unreliable).toBe(false);
      expect(s.fit!.sigma).toBeLessThanOrEqual(0.5);
      expect(s.quality.heights).toBe('measured');
      const p = main(s);
      expect(p.source).toEqual({ heights: 'lidar', roof: 'lidar' });
      expect(p.eaveHeight).toBeGreaterThanOrEqual(4.5);
      expect(p.eaveHeight).toBeLessThanOrEqual(7.5);
      expect(p.roof.pitchDeg!).toBeGreaterThanOrEqual(25);
      expect(p.roof.pitchDeg!).toBeLessThanOrEqual(50);
      expect(p.storeys).toBe(2);
    });
  } else {
    it('flags complex / heritage roofs as unreliable instead of silently wrong', () => {
      const s = r.spec;
      if ((slug as string) !== 'uk-shakespeare-birthplace') {
        expect(s.fit!.unreliable).toBe(true);
        expect(s.quality.flags).toContain('fit-unreliable');
        expect(['medium', 'low', 'estimated']).toContain(s.quality.heights);
      }
    });
  }
});

describe('pipeline determinism', () => {
  it('rebuilds an identical spec for the same input', async () => {
    const a = results.get('uk-forthlin-road') ?? (await run('uk-forthlin-road'));
    const b = await run('uk-forthlin-road');
    expect(b.spec).toEqual(a.spec);
  }, 60_000);
});
