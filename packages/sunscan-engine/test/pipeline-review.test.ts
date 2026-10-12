// Integration fixes (iteration 3): Overture outlines stay out of the co-registration but keep measured context heights
// (CR-01), height-hint provenance for the priors, multi-dwelling outlines from core/footprint, suffixed relation refs
// (CR-07), Overpass outages during /api/model (CR-08) and validation of a client-supplied geocode (CR-11).
import { describe, expect, it } from 'vitest';
import type { PriorContext, ReconstructInput } from '@sunny/sunscan-core';
import type { BuildingsResult, GeocodeResult } from '../src/contracts.js';
import { buildModel, coreAnalyseFootprint, corePriors, normaliseRef, osmRefOf, type BuildModelDeps, type BuildModelRequest } from '../src/pipeline/index.js';
import { createFixtureProviders, fixture } from './support/fixture-providers.js';
import { expectWellFormedSpec } from './support/spec-checks.js';
import { cannedReconstruct, noLidar, stubProviders, syntheticBuildings } from './support/stubs.js';

const NOW = () => new Date('2026-10-09T12:00:00Z');
const quiet = () => undefined;
const forthlin = fixture('uk-forthlin-road');
const req = (over: Partial<BuildModelRequest> = {}): BuildModelRequest => ({
  lat: forthlin.geocode.best!.lat, lon: forthlin.geocode.best!.lon, address: forthlin.input, geocode: structuredClone(forthlin.geocode), ...over,
});

/** The recorded Forthlin buildings with the two attached houses turned into Overture (ML-traced) outlines. */
async function withOvertureNeighbours(): Promise<{ buildings: BuildingsResult; ids: string[] }> {
  const providers = createFixtureProviders();
  const b = await providers.fetchBuildings({ lat: forthlin.geocode.best!.lat, lon: forthlin.geocode.best!.lon, osmRef: 'way/516125064' });
  const { spec } = await buildModel(req(), { providers, reconstruct: cannedReconstruct().fn, now: NOW, log: quiet });
  const attached = spec.context.neighbours.filter((n) => n.attached).map((n) => n.id);
  expect(attached).toHaveLength(2);
  const ids: string[] = [];
  b.buildings = b.buildings.map((f) => {
    if (!attached.includes(normaliseRef(f.ref))) return f;
    const ref = `overture:test-${ids.length + 1}`;
    ids.push(ref);
    return { ...f, ref, source: 'overture' as const, tags: { building: 'yes' } };
  });
  return { buildings: b, ids };
}

describe('CR-01: Overture outlines are context, not co-registration anchors', () => {
  it('keeps them out of the fitter but uses them for party walls and LiDAR context heights', async () => {
    const { buildings, ids } = await withOvertureNeighbours();
    const canned = cannedReconstruct();
    const { spec } = await buildModel(req({ buildings }), { providers: createFixtureProviders(), reconstruct: canned.fn, now: NOW, log: quiet });
    expectWellFormedSpec(spec);
    const input = canned.calls[0] as ReconstructInput;
    expect(input.neighbours.length).toBeGreaterThan(3);
    expect(input.neighbours.some((n) => n.id.startsWith('overture:'))).toBe(false);
    // party walls with the Overture outlines still make it a mid-terrace
    expect(spec.builtForm).toBe('mid-terrace');
    const ctx = spec.context.neighbours.filter((n) => ids.includes(n.id));
    expect(ctx.map((n) => n.attached)).toEqual([true, true]);
    for (const n of ctx) {
      expect(n.source).toBe('overture');
      expect(n.height).toBeGreaterThan(6); // measured (two-storey terrace ridge), not the 7 m prior
      expect(n.height).toBeLessThan(11);
      expect(n.height).not.toBe(7);
      expect(n.eaveHeight).toBeDefined();
    }
  });
});

describe('priors: provenance of the height hint (PriorContext.heightHintSource)', () => {
  const spyPriors = () => {
    const seen: PriorContext[] = [];
    const fn: BuildModelDeps['priorsFallback'] = (ctx, fp, kinds) => { seen.push(ctx); return corePriors(ctx, fp, kinds); };
    return { fn, seen };
  };

  it("labels a rejected fit's LiDAR top height as LiDAR, never as an OSM height", async () => {
    const pri = spyPriors();
    const { spec } = await buildModel(req(), { providers: createFixtureProviders(), reconstruct: cannedReconstruct({ ok: false, unreliable: true, sigma: 0.9 }).fn, priorsFallback: pri.fn, now: NOW, log: quiet });
    expect(pri.seen[0].heightHintSource).toBe('lidar');
    expect(pri.seen[0].heightHint).toBeGreaterThan(6);
    expect(spec.quality.notes.join(' ')).not.toMatch(/OSM height|no elevation data/);
  });

  it('labels an OSM height tag as OSM (no LiDAR)', async () => {
    const providers = createFixtureProviders({ getSurfaceRasters: noLidar('no-open-lidar') });
    const b = await providers.fetchBuildings({ lat: forthlin.geocode.best!.lat, lon: forthlin.geocode.best!.lon, osmRef: 'way/516125064' });
    const t = b.buildings.find((f) => f.ref === 'osm:way/516125064')!;
    t.tags = { ...t.tags, height: '8.4' };
    const pri = spyPriors();
    const { spec } = await buildModel(req({ buildings: b }), { providers, priorsFallback: pri.fn, now: NOW, log: quiet });
    expect(pri.seen[0]).toMatchObject({ heightHint: 8.4, heightHintSource: 'osm' });
    expect(spec.quality.notes.join(' ')).toMatch(/OSM height=8.4/);
    expect(spec.quality.notes.join(' ')).toMatch(/no elevation data/);
  });
});

describe('multi-dwelling outlines (core/footprint multiDwelling -> terrace-block)', () => {
  it('flags a terrace row mapped as one polygon and leaves single houses alone', () => {
    const row = { outer: [[0, 0], [24, 0], [24, 9], [0, 9]] as [number, number][] };
    const a = coreAnalyseFootprint({
      target: { id: 'osm:way/9', footprint: row, tags: { building: 'yes' }, isPart: false, source: 'osm' },
      others: [],
      addressNodes: [2, 4, 6, 8].map((n, i) => ({ xy: [3 + 6 * i, 4.5] as [number, number], tags: { 'addr:housenumber': String(n) } })),
    });
    expect(a.terraceBlock).toBe(true);
    expect(a.builtForm).toBe('block');
    const one = coreAnalyseFootprint({
      target: { id: 'osm:way/1', footprint: { outer: [[0, 0], [6, 0], [6, 10], [0, 10]] }, tags: { building: 'house', 'addr:housenumber': '48' }, isPart: false, source: 'osm' },
      others: [],
      addressNodes: [{ xy: [3, 5], tags: { 'addr:housenumber': '48-49', tourism: 'museum' } }],
    });
    expect(one.terraceBlock).toBe(false);
  });
});

describe('CR-07: suffixed refs of multi-outer relations', () => {
  it('normalises them and forces the relation itself into the Overpass query', () => {
    expect(normaliseRef('relation/45#2')).toBe('osm:relation/45#2');
    expect(normaliseRef('osm:relation/45#2')).toBe('osm:relation/45#2');
    expect(osmRefOf('osm:relation/45#2')).toBe('relation/45');
    expect(osmRefOf('relation/45#3')).toBe('relation/45');
    expect(osmRefOf('way/7')).toBe('way/7');
    expect(osmRefOf('overture:abc')).toBeUndefined();
  });
});
