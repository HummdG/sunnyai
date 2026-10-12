import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { COMPASS_POINTS, SUNSCAN_STATUSES, sunscanSummarySchema } from '@sunny/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createSunScanEngine,
  createSunScanService,
  facingOf,
  FileArtefactStore,
  FINAL_STATUSES,
  isSuitable,
  MemoryArtefactStore,
  MemoryAssessmentRepository,
  SunScanError,
  toRoofAssessmentSummary,
  type EngineOutcome,
  type SunScanEngine,
} from '../src/index.js';

const NOW = () => new Date('2026-10-09T12:00:00.000Z');
// The query SunScanV2 recorded for this house (fixtures/sunscan/test-addresses.json).
const FORTHLIN = '20 Forthlin Road, Liverpool L18 9TN';

describe('the vendored engine, in replay mode (recorded open data, no network)', () => {
  const engine = createSunScanEngine({ httpMode: 'replay', now: NOW });
  let outcome: EngineOutcome;

  beforeAll(async () => {
    outcome = await engine.assess({ address: FORTHLIN });
  }, 120_000);

  it('models 20 Forthlin Road and summarises its roof planes', () => {
    const s = outcome.summary;
    expect(s.address).toMatch(/Forthlin/);
    expect(s.postcode).toBe('L18 9TN');
    expect(s.builtForm).toBe('mid-terrace');
    expect(s.roofPlanes.length).toBeGreaterThanOrEqual(2);
    for (const p of s.roofPlanes) {
      expect(p.areaM2).toBeGreaterThan(0);
      expect(p.pitchDeg).toBeGreaterThanOrEqual(0);
    }
    // A pitched terrace house: the main planes are pitched, at a plausible angle.
    expect(s.roofPlanes[0]?.pitchDeg ?? 0).toBeGreaterThan(20);
    expect(s.roofPlanes[0]?.pitchDeg ?? 0).toBeLessThan(55);
  });

  it('reports the engine’s confidence honestly and labels everything indicative', () => {
    const s = outcome.summary;
    expect(s.reliable).toBe(true); // SunScanV2 A3: Forthlin fits reliably from LiDAR
    expect(s.confidence.roof).not.toBe('estimated');
    expect(s.label).toBe('Indicative — subject to an on-site survey');
    expect(s.sources.map((x) => x.id)).toContain('osm');
    expect(sunscanSummarySchema.safeParse(s).success).toBe(true);
  });

  it('suitable area is the sum of the planes it calls suitable, and nothing else', () => {
    const s = outcome.summary;
    const sum = s.roofPlanes.filter((p) => p.suitable).reduce((a, p) => a + p.areaM2, 0);
    expect(s.suitableRoofAreaM2).toBeCloseTo(sum, 0);
    if (s.suitableRoofAreaM2 > 0) expect(s.bestFacing).not.toBeNull();
  });

  it('measures each plane and estimates usable area and panel capacity for the quote', () => {
    const s = outcome.summary;
    expect(s.usableRoofAreaM2).toBeGreaterThan(0);
    expect(s.usableRoofAreaM2).toBeLessThanOrEqual(s.suitableRoofAreaM2);
    for (const p of s.roofPlanes) {
      expect(p.widthM).toBeGreaterThan(1);
      expect(p.slopeLengthM).toBeGreaterThan(1);
      // The bounding rectangle holds the plane.
      expect(p.widthM * p.slopeLengthM).toBeGreaterThanOrEqual(p.areaM2 * 0.95);
      if (!p.suitable) expect([p.usableAreaM2, p.maxPanels]).toEqual([0, 0]);
    }
    const main = s.roofPlanes.find((p) => p.id === s.mainPlaneId);
    expect(main?.suitable).toBe(true);
    // A terrace house's main slope holds a handful to a couple of dozen modules.
    expect(s.estimatedMaxPanels).toBeGreaterThanOrEqual(4);
    expect(s.estimatedMaxPanels).toBeLessThanOrEqual(30);
    expect(s.shadingFlags).toContain('shading-not-assessed');
  });

  it('exports a binary glTF and the spec the viewer rebuilds from', () => {
    const magic = new TextDecoder().decode(outcome.glb.slice(0, 4));
    expect(magic).toBe('glTF');
    expect(outcome.glb.byteLength).toBeGreaterThan(10_000);
    const spec = JSON.parse(outcome.specJson) as { schema: string; parts: unknown[] };
    expect(spec.schema).toBe('sunscan.house/1');
    expect(spec.parts.length).toBeGreaterThan(0);
  });

  it('refuses an address it has no record of instead of guessing', async () => {
    await expect(
      engine.assess({ address: '1 Nowhere Lane, Atlantis ZZ1 1ZZ' }),
    ).rejects.toBeInstanceOf(SunScanError);
  });

  it('refuses points outside the UK', async () => {
    await expect(engine.assess({ lat: 48.8584, lon: 2.2945 })).rejects.toMatchObject({
      code: 'outside-uk',
    });
  });
});

describe('addresses recorded on the first live run (docs/integration/sunscan-live-run.md)', () => {
  const engine = createSunScanEngine({ httpMode: 'replay', now: NOW });

  it('models a Welsh semi from the Welsh LiDAR (5 Cwmdonkin Drive, Swansea)', async () => {
    const { summary: s } = await engine.assess({ address: '5 Cwmdonkin Drive, Swansea SA2 0RA' });
    expect(s.reliable).toBe(true);
    expect(s.builtForm).toBe('semi-detached');
    expect(s.bestFacing).toBe('S');
    expect(s.estimatedMaxPanels).toBe(20);
    expect(Math.round(s.usableRoofAreaM2)).toBe(60);
  }, 120_000);

  it('flags a London terrace it cannot fit reliably instead of claiming it (48 Doughty Street)', async () => {
    const { summary: s } = await engine.assess({ address: '48 Doughty Street, London WC1N 2LX' });
    expect(s.reliable).toBe(false);
    expect(s.flags).toContain('fit-unreliable');
    expect(s.confidence.roof).toBe('low');
  }, 120_000);
});

describe('roof plane classification', () => {
  it('names the facing on the 8-point compass, flat when there is no slope', () => {
    expect(facingOf(180)).toBe('S');
    expect(facingOf(200)).toBe('S');
    expect(facingOf(225)).toBe('SW');
    expect(facingOf(359)).toBe('N');
    expect(facingOf(null)).toBe('flat');
    expect([...COMPASS_POINTS]).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'flat']);
  });

  it('counts east-through-west planes at panel pitches, and flat roofs', () => {
    expect(isSuitable({ pitchDeg: 35, azimuthDeg: 180, areaM2: 20 })).toBe(true);
    expect(isSuitable({ pitchDeg: 35, azimuthDeg: 90, areaM2: 20 })).toBe(true);
    expect(isSuitable({ pitchDeg: 35, azimuthDeg: 0, areaM2: 20 })).toBe(false); // north-facing
    expect(isSuitable({ pitchDeg: 70, azimuthDeg: 180, areaM2: 20 })).toBe(false); // too steep
    expect(isSuitable({ pitchDeg: 35, azimuthDeg: 180, areaM2: 2 })).toBe(false); // too small
    expect(isSuitable({ pitchDeg: 0, azimuthDeg: null, areaM2: 30 })).toBe(true); // flat
  });
});

/** An engine that answers instantly, for the service's own behaviour. */
function fakeEngine(behaviour: (address: string) => EngineOutcome | Error): SunScanEngine {
  return {
    version: 'fake/1',
    assess(target) {
      const r = behaviour(target.address ?? '');
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
  };
}

const fakeOutcome = (reliable: boolean): EngineOutcome => ({
  summary: {
    address: '1 Test Street',
    postcode: 'AB1 2CD',
    builtForm: 'detached',
    era: 'unknown',
    storeys: 2,
    roofType: 'gabled',
    eaveHeightM: 5,
    roofPlanes: [],
    suitableRoofAreaM2: 0,
    usableRoofAreaM2: 0,
    estimatedMaxPanels: 0,
    mainPlaneId: null,
    obstructions: { chimneys: 0 },
    shadingFlags: ['shading-not-assessed'],
    bestFacing: null,
    confidence: {
      geocode: 'high',
      footprint: 'high',
      heights: 'measured',
      roof: reliable ? 'high' : 'low',
    },
    reliable,
    flags: reliable ? [] : ['fit-unreliable'],
    notes: [],
    sources: [],
    label: 'Indicative — subject to an on-site survey',
  },
  specJson: '{"schema":"sunscan.house/1"}',
  glb: new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
});

describe('the assessment service', () => {
  const make = (engine: SunScanEngine) =>
    createSunScanService({
      engine,
      repository: new MemoryAssessmentRepository(),
      artefacts: new MemoryArtefactStore(),
      now: NOW,
    });

  it('runs a job to succeeded and stores the model files', async () => {
    const svc = make(fakeEngine(() => fakeOutcome(true)));
    const started = await svc.startAssessment(
      'tenant-a',
      { address: '1 Test Street' },
      { sessionId: 's1' },
    );
    expect(started.status).toBe('queued');
    const done = await svc.waitFor('tenant-a', started.id, 5_000);
    expect(done?.status).toBe('succeeded');
    expect(done?.summary?.reliable).toBe(true);
    expect(await svc.getArtefact('tenant-a', started.id, 'model.glb')).not.toBeNull();
    expect(
      new TextDecoder().decode((await svc.getArtefact('tenant-a', started.id, 'spec.json'))!),
    ).toContain('sunscan.house/1');
  });

  it('marks an unreliable fit low-confidence rather than succeeded', async () => {
    const svc = make(fakeEngine(() => fakeOutcome(false)));
    const { id } = await svc.startAssessment('tenant-a', { address: 'x' });
    expect((await svc.waitFor('tenant-a', id, 5_000))?.status).toBe('low-confidence');
  });

  it('records a coded failure', async () => {
    const svc = make(fakeEngine(() => new SunScanError('address-not-found', 'nope')));
    const { id } = await svc.startAssessment('tenant-a', { address: 'x' });
    const done = await svc.waitFor('tenant-a', id, 5_000);
    expect(done?.status).toBe('failed');
    expect(done?.error).toEqual({ code: 'address-not-found', message: 'nope' });
    expect(await svc.getArtefact('tenant-a', id, 'model.glb')).toBeNull();
  });

  it('never hands one tenant another tenant’s assessment or model', async () => {
    const svc = make(fakeEngine(() => fakeOutcome(true)));
    const { id } = await svc.startAssessment('tenant-a', { address: 'x' });
    await svc.idle();
    expect(await svc.getAssessment('tenant-b', id)).toBeNull();
    expect(await svc.getArtefact('tenant-b', id, 'model.glb')).toBeNull();
    expect(await svc.getAssessment('tenant-a', id)).not.toBeNull();
  });

  it('hands the quote journey a RoofAssessmentSummary only once the roof is measured', async () => {
    const svc = make(fakeEngine(() => fakeOutcome(true)));
    const started = await svc.startAssessment('tenant-a', { address: 'x' });
    expect(toRoofAssessmentSummary(started)).toBeNull();
    const done = await svc.waitFor('tenant-a', started.id, 5_000);
    expect(toRoofAssessmentSummary(done!)).toMatchObject({
      assessmentId: started.id,
      status: 'succeeded',
    });
  });

  it('final statuses match the contract', () => {
    expect([...SUNSCAN_STATUSES]).toEqual([
      'queued',
      'running',
      'succeeded',
      'low-confidence',
      'failed',
    ]);
    expect([...FINAL_STATUSES]).toEqual(['succeeded', 'low-confidence', 'failed']);
  });
});

describe('file artefact store', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sunscan-art-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips bytes per tenant and cannot be walked out of its tenant folder', async () => {
    const store = new FileArtefactStore(dir);
    await store.put('tenant-a', 'id1', 'model.glb', new Uint8Array([1, 2, 3]));
    expect(await store.get('tenant-a', 'id1', 'model.glb')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.get('tenant-b', 'id1', 'model.glb')).toBeNull();
    expect(await store.get('tenant-b', '../tenant-a/id1', 'model.glb')).toBeNull();
  });
});

it('the replay fixtures this suite needs are vendored', () => {
  // The address above is one of the three SunScanV2 test addresses Sunny carries.
  const list = JSON.parse(
    readFileSync(new URL('../../../fixtures/sunscan/test-addresses.json', import.meta.url), 'utf8'),
  ) as { slug: string }[];
  expect(list.map((a) => a.slug)).toContain('uk-forthlin-road');
});
