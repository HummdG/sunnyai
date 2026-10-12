// buildModel branches: no LiDAR (NI / NoCoverage / outage / replay miss), fit outcomes (reliable fit, unreliable or
// implausible fits -> best of {LoD1.3 blocks, priors}, registration failure, fitter errors, building missing in the
// survey), registration shift propagation, chimneys, drawn outlines, explicit building refs, Overture targets,
// options, logging and request validation.
import { describe, expect, it } from 'vitest';
import { makeFrame } from '@sunny/sunscan-core/geo';
import { distPointSeg } from '@sunny/sunscan-core/geometry';
import type { ReconstructInput } from '@sunny/sunscan-core';
import type { GeocodeResult } from '../src/contracts.js';
import { buildModel, PipelineError, type BuildModelDeps, type BuildModelRequest } from '../src/pipeline/index.js';
import { createFixtureProviders, fixture } from './support/fixture-providers.js';
import { expectWellFormedSpec } from './support/spec-checks.js';
import { cannedReconstruct, noLidar, stubProviders, syntheticBuildings } from './support/stubs.js';

const NOW = () => new Date('2026-10-08T12:00:00Z');
const quiet = () => undefined;
const forthlin = fixture('uk-forthlin-road');
const req = (over: Partial<BuildModelRequest> = {}): BuildModelRequest => ({
  lat: forthlin.geocode.best!.lat,
  lon: forthlin.geocode.best!.lon,
  address: forthlin.input,
  geocode: structuredClone(forthlin.geocode),
  ...over,
});
const deps = (over: Partial<BuildModelDeps> = {}): BuildModelDeps => ({ providers: createFixtureProviders(), now: NOW, log: quiet, ...over });

describe('no LiDAR', () => {
  it('falls back to priors when the elevation provider has no coverage (simulated Northern Ireland)', async () => {
    const providers = createFixtureProviders({ getSurfaceRasters: noLidar('no-open-lidar') });
    const { spec } = await buildModel(req(), { providers, now: NOW, log: quiet });
    expectWellFormedSpec(spec);
    expect(spec.quality.flags).toContain('lidar-unavailable');
    expect(spec.quality.heights).toBe('estimated');
    expect(spec.quality.roof).toBe('estimated');
    expect(spec.groundElevation).toBeNull();
    expect(spec.fit).toBeUndefined();
    expect(spec.evidence).toBeUndefined();
    expect(spec.context.terrain).toBeUndefined();
    expect(spec.parts[0].source).toEqual({ heights: 'prior', roof: 'prior' });
    expect(spec.parts[0].eaveHeight).toBeGreaterThan(2.3);
    expect(spec.builtForm).toBe('mid-terrace');
    expect(spec.provenance.map((p) => p.id)).toContain('sunscan-uk-priors');
    expect(spec.provenance.some((p) => /lidar/.test(p.id))).toBe(false);
  });

  it('skips the LiDAR providers entirely for a Northern Ireland address', async () => {
    const providers = createFixtureProviders();
    const geocode: GeocodeResult = structuredClone(forthlin.geocode);
    geocode.postcode!.nation = 'Northern Ireland';
    const { spec } = await buildModel(req({ geocode }), { providers, now: NOW, log: quiet });
    expect(providers.calls.getSurfaceRasters ?? 0).toBe(0);
    expect(providers.calls.getOstn15 ?? 0).toBe(0);
    expect(spec.address.nation).toBe('Northern Ireland');
    expect(spec.quality.flags).toContain('lidar-unavailable');
    expect(spec.quality.notes.join(' ')).toMatch(/Northern Ireland has no inland open LiDAR/);
  });

  it('degrades to estimates with a warning and an error log when the elevation service fails', async () => {
    const providers = createFixtureProviders({
      getSurfaceRasters: async () => {
        throw new Error('EA WCS 500');
      },
    });
    const logged: { level: string; message: string; err?: unknown }[] = [];
    const r = await buildModel(req(), { providers, now: NOW, log: (level, message, err) => logged.push({ level, message, err }) });
    expect(r.warnings.join(' ')).toMatch(/elevation service unavailable/);
    expect(r.spec.quality.flags).toContain('lidar-unavailable');
    const entry = logged.find((l) => /elevation provider failed/.test(l.message));
    expect(entry?.level).toBe('error');
    expect((entry?.err as Error).message).toBe('EA WCS 500');
  });

  it('never swallows HTTP replay misses', async () => {
    const providers = createFixtureProviders({
      getSurfaceRasters: async () => {
        throw Object.assign(new Error('HTTP replay miss: no fixture'), { code: 'REPLAY_MISS' });
      },
    });
    await expect(buildModel(req(), { providers, now: NOW, log: quiet })).rejects.toMatchObject({ code: 'REPLAY_MISS' });
  });
});

describe('fit outcomes', () => {
  it('propagates the registration shift to the origin, the parts and the neighbours', async () => {
    const a = await buildModel(req(), deps({ reconstruct: cannedReconstruct({ shift: [0, 0] }).fn }));
    const stub = cannedReconstruct({ shift: [1.0, 0.5] });
    const b = await buildModel(req(), deps({ reconstruct: stub.fn, reconstructLabel: 'canned' }));
    expectWellFormedSpec(b.spec);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].dsm.res).toBe(1);
    expect(b.spec.fit!.method).toBe('canned');
    // the ENU shift has the BNG magnitude (grid convergence only rotates it)
    expect(Math.hypot(...b.spec.fit!.registration.shift)).toBeCloseTo(Math.hypot(1, 0.5), 2);
    // the origin (registered centroid) moved by the shift
    const f = makeFrame(a.spec.origin.lat, a.spec.origin.lon);
    expect(Math.hypot(...f.toLocal([b.spec.origin.lon, b.spec.origin.lat]))).toBeCloseTo(Math.hypot(1, 0.5), 2);
    // party walls still coincide with the (equally shifted) attached neighbours
    const main = b.spec.parts[0];
    const attached = b.spec.context.neighbours.filter((n) => n.attached);
    expect(attached).toHaveLength(2);
    main.edgeKinds.forEach((k, i) => {
      if (k !== 'party') return;
      const p = main.footprint.outer[i];
      const q = main.footprint.outer[(i + 1) % main.footprint.outer.length];
      const mid: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const d = Math.min(...attached.map((n) => Math.min(...n.footprint.outer.map((v, j, r) => distPointSeg(mid, v, r[(j + 1) % r.length])))));
      expect(d).toBeLessThan(0.35);
    });
    expect(b.spec.quality.heights).toBe('measured');
    expect(b.spec.parts[0].source).toEqual({ heights: 'lidar', roof: 'lidar' });
    expect(b.spec.context.neighbours.filter((n) => n.height === 7.5).length).toBeGreaterThan(0);
  });

  it('maps chimneys into ENU and onto their part', async () => {
    const { spec } = await buildModel(req(), deps({ reconstruct: cannedReconstruct({ chimneyAtCentroid: true }).fn }));
    const c = spec.parts[0].chimneys[0];
    expect(c).toBeDefined();
    expect(Math.hypot(c.center[0], c.center[1])).toBeLessThan(0.05); // registered centroid = origin
    expect(Math.abs(c.angleDeg)).toBeLessThan(3); // grid convergence only
    expect(c.top).toBeCloseTo(9.2, 1);
  });

  it('replaces an unreliable fit by the best of {LoD1.3 blocks, priors} (flagged)', async () => {
    const { spec } = await buildModel(req(), deps({ reconstruct: cannedReconstruct({ ok: false, unreliable: true, sigma: 0.8 }).fn }));
    expectWellFormedSpec(spec);
    expect(spec.quality.flags).toContain('fit-unreliable');
    expect(spec.fit!.unreliable).toBe(true);
    expect(spec.quality.heights).toBe('medium');
    expect(spec.parts[0].source.heights).toBe('lidar');
    expect(spec.quality.notes.join(' ')).toMatch(/No reliable roof shape: (LoD1.3 blocks|UK priors)/);
    // whichever candidate wins, the height comes from the survey (not the canned 5.2 m eave)
    expect(spec.parts[0].eaveHeight).not.toBeCloseTo(5.2, 3);
    expect(spec.parts[0].eaveHeight).toBeGreaterThan(4);
    expect(spec.parts[0].eaveHeight).toBeLessThan(9);
  });

  it('ignores the shift and partition of a failed registration', async () => {
    const { spec } = await buildModel(req(), deps({ reconstruct: cannedReconstruct({ ok: false, unreliable: true, sigma: 0.8, flag: 'on-boundary', shift: [3, 3] }).fn }));
    expect(spec.quality.flags).toEqual(expect.arrayContaining(['fit-unreliable', 'registration-ambiguous']));
    expect(spec.parts[0].source.heights).toBe('lidar');
    expect(spec.quality.heights).toBe('medium');
    expect(spec.groundElevation).not.toBeNull();
    expect(spec.fit!.registration.shift).toEqual([0, 0]);
    // the outline was not moved: the origin stays at the mapped centroid (within a centimetre)
    const ref = await buildModel(req(), deps({ reconstruct: cannedReconstruct().fn }));
    const f = makeFrame(ref.spec.origin.lat, ref.spec.origin.lon);
    expect(Math.hypot(...f.toLocal([spec.origin.lon, spec.origin.lat]))).toBeLessThan(0.01);
  });

  it('rejects implausible fitted parts (eave < 2 m) even when the fitter says ok, and logs it', async () => {
    const logged: string[] = [];
    const { spec } = await buildModel(req(), deps({ reconstruct: cannedReconstruct({ eave: 0.2 }).fn, log: (_l, m) => logged.push(m) }));
    expectWellFormedSpec(spec);
    expect(spec.fit!.unreliable).toBe(true);
    expect(spec.quality.flags).toContain('fit-unreliable');
    expect(spec.quality.notes.join(' ')).toMatch(/rejected as implausible: main: eave 0\.20 m < 2 m/);
    expect(logged.join(' ')).toMatch(/rejected as implausible/);
    expect(spec.parts[0].eaveHeight).toBeGreaterThanOrEqual(2);
  });

  it('rejects tiny fitted parts (< 4 m²)', async () => {
    const stub = cannedReconstruct();
    const withTinyPart = (input: ReconstructInput) => {
      const o = stub.fn(input);
      const [x, y] = o.parts[0].footprint.outer[0];
      o.parts.push({ ...o.parts[0], id: 'ext-1', role: 'extension', footprint: { outer: [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] }, edgeKinds: ['eave', 'eave', 'eave', 'eave'] });
      return o;
    };
    const { spec } = await buildModel(req(), deps({ reconstruct: withTinyPart }));
    expect(spec.quality.notes.join(' ')).toMatch(/ext-1: 1\.0 m² part/);
    expect(spec.quality.flags).toContain('fit-unreliable');
    expect(spec.parts.map((p) => p.id)).not.toContain('ext-1');
  });

  it('falls back to priors when the LiDAR shows no building inside the outline', async () => {
    const base = createFixtureProviders();
    const providers = createFixtureProviders({
      getSurfaceRasters: async (q) => {
        const r = await base.getSurfaceRasters(q);
        return 'dsm' in r ? { ...r, dsm: r.dtm, dsmLast: r.dtm } : r;
      },
    });
    const { spec } = await buildModel(req(), { providers, now: NOW, log: quiet, reconstruct: cannedReconstruct({ ok: false, unreliable: true, sigma: 2 }).fn });
    expect(spec.quality.flags).toEqual(expect.arrayContaining(['building-missing-in-lidar', 'fit-unreliable']));
    expect(spec.parts[0].source.roof).toBe('prior');
    expect(spec.provenance.map((p) => p.id)).toContain('sunscan-uk-priors');
  });

  it('falls back with a warning and an error log when the fitter throws', async () => {
    const logged: string[] = [];
    const r = await buildModel(
      req(),
      deps({
        reconstruct: () => {
          throw new Error('boom');
        },
        log: (level, m) => logged.push(`${level}:${m}`),
      }),
    );
    expect(r.warnings.join(' ')).toMatch(/roof fit failed \(boom\)/);
    expect(logged.join(' ')).toMatch(/error:reconstruct threw/);
    expect(r.spec.quality.flags).toContain('fit-failed');
    expect(r.spec.fit).toBeUndefined();
    expect(r.spec.context.terrain).toBeDefined(); // the rasters are still used for the ground and terrain
  });

  it('falls back to a block model when the priors fallback misbehaves', async () => {
    const r = await buildModel(
      req(),
      deps({ providers: createFixtureProviders({ getSurfaceRasters: noLidar() }), priorsFallback: () => ({ parts: [] }) }),
    );
    expect(r.warnings.join(' ')).toMatch(/no usable parts/);
    expect(r.spec.parts[0].roof.type).toBe('flat');
  });
});

describe('targets', () => {
  it('models a user-drawn outline', async () => {
    const f = makeFrame(53.4, -2.98);
    const ring = [[-5, -4], [5, -4], [5, 4], [-5, 4]].map(([x, y]) => f.toLonLat([x, y]) as [number, number]);
    const { spec } = await buildModel({ lat: 53.4, lon: -2.98, footprint: ring }, { providers: stubProviders(), now: NOW, log: quiet });
    expectWellFormedSpec(spec);
    expect(spec.id).toMatch(/^drawn:[0-9a-f]{12}$/);
    expect(spec.quality.flags).toEqual(expect.arrayContaining(['footprint-user-drawn', 'lidar-unavailable']));
    expect(spec.quality.footprint).toBe('low');
    expect(spec.quality.geocode).toBe('manual');
    expect(Math.abs(spec.parts[0].footprint.outer[0][0])).toBeCloseTo(5, 1);
    // the synthetic house under the drawing is replaced, its semi partner remains as context
    expect(spec.context.neighbours.map((n) => n.id)).toEqual(['osm:way/2']);
  });

  it('rejects a self-intersecting drawn outline with 422', async () => {
    const f = makeFrame(53.4, -2.98);
    const bow = [[-5, -5], [5, 5], [5, -5], [-5, 5]].map(([x, y]) => f.toLonLat([x, y]) as [number, number]);
    await expect(buildModel({ lat: 53.4, lon: -2.98, footprint: bow }, { providers: stubProviders(), log: quiet })).rejects.toMatchObject({ status: 422, code: 'invalid-footprint' });
  });

  it('honours an explicit building ref (neighbour of the geocoded house)', async () => {
    const { spec } = await buildModel(req({ buildingRef: 'way/1498655200' }), deps({ reconstruct: cannedReconstruct().fn }));
    expect(spec.id).toBe('osm:way/1498655200');
    expect(spec.quality.geocode).toBe('manual');
  });

  it('answers 404 for an unknown building ref and 422 outside the UK', async () => {
    await expect(buildModel(req({ buildingRef: 'way/1' }), deps())).rejects.toMatchObject({ status: 404, code: 'building-not-found' });
    await expect(buildModel({ lat: 48.85, lon: 2.35 }, deps())).rejects.toBeInstanceOf(PipelineError);
    await expect(buildModel({ lat: 48.85, lon: 2.35 }, deps())).rejects.toMatchObject({ status: 422, code: 'outside-uk' });
  });

  it('maps a building-lookup failure to 502 (or continues for a drawn outline)', async () => {
    const providers = stubProviders({
      fetchBuildings: async () => {
        throw new Error('Overpass 504 on all endpoints');
      },
    });
    await expect(buildModel({ lat: 53.4, lon: -2.98 }, { providers, log: quiet })).rejects.toMatchObject({ status: 502, code: 'upstream-error' });
    const f = makeFrame(53.4, -2.98);
    const ring = [[-4, -4], [4, -4], [4, 4], [-4, 4]].map(([x, y]) => f.toLonLat([x, y]) as [number, number]);
    const r = await buildModel({ lat: 53.4, lon: -2.98, footprint: ring }, { providers, now: NOW, log: quiet });
    expect(r.warnings.join(' ')).toMatch(/building lookup failed/);
    expect(r.spec.context.neighbours).toEqual([]);
  });

  it('flags Overture footprints and credits Overture', async () => {
    const providers = stubProviders({ fetchBuildings: async (q) => syntheticBuildings(q.lat, q.lon, { overture: true }) });
    const { spec } = await buildModel({ lat: 53.4, lon: -2.98 }, { providers, now: NOW, log: quiet });
    expect(spec.id).toBe('overture:abc');
    expect(spec.quality.flags).toContain('footprint-from-overture');
    const ov = spec.provenance.find((p) => p.id === 'overture-buildings')!;
    expect(ov.date).toBe('2026-09-23.1');
    expect(spec.builtForm).toBe('semi-detached');
    expect(spec.facade.streetName).toBe('Test Road');
    expect(spec.context.roads?.[0].name).toBe('Test Road');
  });
});

describe('options', () => {
  it('can omit evidence and terrain and cap the evidence size', async () => {
    const a = await buildModel(req({ options: { evidence: false, terrain: false } }), deps({ reconstruct: cannedReconstruct().fn }));
    expect(a.spec.evidence).toBeUndefined();
    expect(a.spec.context.terrain).toBeUndefined();
    const b = await buildModel(req({ options: { maxEvidence: 1 } }), deps({ reconstruct: cannedReconstruct().fn }));
    expect(b.spec.evidence!.points).toHaveLength(3);
  });
});
