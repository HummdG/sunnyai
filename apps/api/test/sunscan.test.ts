import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EMPTY_KNOWLEDGE } from '@sunny/knowledge';
import { sunscanAssessmentSchema } from '@sunny/contracts';
import {
  createSunScanService,
  MemoryArtefactStore,
  SunScanError,
  type EngineOutcome,
  type SunScanEngine,
  type SunScanService,
} from '@sunny/sunscan-adapter';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeTool, type ToolContext, type ToolEvent } from '../src/agent/tools.js';
import { loadConfig } from '../src/config.js';
import { createDefaultSunScan } from '../src/routes/sunscan.js';
import { buildServer } from '../src/server.js';
import { issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry } from '../src/tenants.js';

const NOW = 1_791_000_000_000;
const SECRET = 'test-secret-sunscan';
const ADMIN = 'admin-token-sunscan';
const TENANT_A = 't_demo0001';
const TENANT_B = 't_other0002';

const token = (tenantId: string, sessionId: string) =>
  issueSessionToken({ tenantId, sessionId, expiresAt: NOW + 3_600_000, origin: null }, SECRET);
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

const outcome = (address: string): EngineOutcome => ({
  summary: {
    address,
    postcode: 'L18 9TN',
    builtForm: 'mid-terrace',
    era: 'unknown',
    storeys: 2,
    roofType: 'gabled',
    eaveHeightM: 5.1,
    roofPlanes: [
      {
        id: 0,
        partId: 'main',
        pitchDeg: 40,
        azimuthDeg: 180,
        facing: 'S',
        areaM2: 30,
        planAreaM2: 23,
        widthM: 6,
        slopeLengthM: 5,
        fillRatio: 1,
        usableAreaM2: 21,
        maxPanels: 12,
        suitable: true,
      },
      {
        id: 1,
        partId: 'main',
        pitchDeg: 40,
        azimuthDeg: 0,
        facing: 'N',
        areaM2: 30,
        planAreaM2: 23,
        widthM: 6,
        slopeLengthM: 5,
        fillRatio: 1,
        usableAreaM2: 0,
        maxPanels: 0,
        suitable: false,
      },
    ],
    suitableRoofAreaM2: 30,
    usableRoofAreaM2: 21,
    estimatedMaxPanels: 12,
    mainPlaneId: 0,
    obstructions: { chimneys: 0 },
    shadingFlags: ['shading-not-assessed'],
    bestFacing: 'S',
    confidence: { geocode: 'high', footprint: 'high', heights: 'measured', roof: 'high' },
    reliable: true,
    flags: [],
    notes: [],
    sources: [
      { id: 'osm', title: 'OpenStreetMap', licence: 'ODbL-1.0', attribution: '© OpenStreetMap' },
    ],
    label: 'Indicative — subject to an on-site survey',
  },
  specJson: '{"schema":"sunscan.house/1","parts":[]}',
  glb: new TextEncoder().encode('glTF-fake-model'),
});

const fakeEngine: SunScanEngine = {
  version: 'fake/1',
  assess(target) {
    if (target.address?.includes('Nowhere')) {
      return Promise.reject(new SunScanError('address-not-found', 'Not found.'));
    }
    return Promise.resolve(outcome(target.address ?? 'point'));
  },
};

let dir: string;
let app: FastifyInstance;
let store: FileStore;
let current: SunScanService | null = null;

function serviceOn(s: FileStore): SunScanService {
  return createSunScanService({
    engine: fakeEngine,
    repository: {
      save: (r) => s.saveSunScanAssessment(r),
      get: (t, id) => s.getSunScanAssessment(t, id),
    },
    artefacts: new MemoryArtefactStore(),
  });
}

async function start(sunscan?: SunScanService | null): Promise<void> {
  store = new FileStore(dir);
  app = buildServer({
    config: loadConfig({
      nodeEnv: 'test',
      dataDir: dir,
      sessionSecret: SECRET,
      adminToken: ADMIN,
      logLevel: 'silent',
    }),
    store,
    tenants: new TenantRegistry(),
    now: () => NOW,
    sunscan: (current = sunscan === undefined ? serviceOn(store) : sunscan),
  });
  await app.ready();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sunny-sunscan-'));
});
afterEach(async () => {
  // Jobs still running would write into the directory being removed.
  await current?.idle();
  current = null;
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

async function startAssessment(t: string, address: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sunscan/assessments',
    headers: auth(t),
    payload: { address },
  });
  return res;
}

async function untilFinal(t: string, id: string) {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sunscan/assessments/${id}`,
      headers: auth(t),
    });
    const body = sunscanAssessmentSchema.parse(res.json());
    if (['succeeded', 'low-confidence', 'failed'].includes(body.status)) return body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('assessment never finished');
}

describe('SunScan routes', () => {
  it('starts an assessment for a visitor and serves its summary and model', async () => {
    await start();
    const visitor = token(TENANT_A, 's_one');
    const res = await startAssessment(visitor, '20 Forthlin Road, Liverpool L18 9TN');
    expect(res.statusCode).toBe(202);
    const started = sunscanAssessmentSchema.parse(res.json());
    expect(started.status).toBe('queued');

    const done = await untilFinal(visitor, started.id);
    expect(done.status).toBe('succeeded');
    expect(done.summary?.suitableRoofAreaM2).toBe(30);
    expect(done.summary?.label).toBe('Indicative — subject to an on-site survey');
    expect(done.modelUrl).toBe(`/v1/sunscan/assessments/${started.id}/model.glb`);
    // The public shape names neither the tenant nor the address target.
    expect(JSON.stringify(res.json())).not.toContain(TENANT_A);

    const glb = await app.inject({ method: 'GET', url: done.modelUrl!, headers: auth(visitor) });
    expect(glb.statusCode).toBe(200);
    expect(glb.headers['content-type']).toBe('model/gltf-binary');
    expect(glb.body).toContain('glTF');
    const spec = await app.inject({ method: 'GET', url: done.specUrl!, headers: auth(visitor) });
    expect(spec.json()).toMatchObject({ schema: 'sunscan.house/1' });
  });

  it('never shows one tenant, or one visitor, another’s assessment or model', async () => {
    await start();
    const owner = token(TENANT_A, 's_one');
    const { id } = sunscanAssessmentSchema.parse(
      (await startAssessment(owner, '1 Test Street')).json(),
    );
    await untilFinal(owner, id);

    for (const intruder of [token(TENANT_B, 's_one'), token(TENANT_A, 's_two')]) {
      for (const url of [
        `/v1/sunscan/assessments/${id}`,
        `/v1/sunscan/assessments/${id}/model.glb`,
        `/v1/sunscan/assessments/${id}/spec.json`,
      ]) {
        const res = await app.inject({ method: 'GET', url, headers: auth(intruder) });
        expect(res.statusCode, url).toBe(404);
      }
    }
    // The admin token is not a credential on this visitor surface.
    const admin = await app.inject({
      method: 'GET',
      url: `/v1/sunscan/assessments/${id}?tenantId=${TENANT_A}`,
      headers: auth(ADMIN),
    });
    expect(admin.statusCode).toBe(401);
  });

  it('requires a credential, validates the body and rate-limits a session', async () => {
    await start();
    expect(
      (await app.inject({ method: 'POST', url: '/v1/sunscan/assessments', payload: {} }))
        .statusCode,
    ).toBe(401);
    const visitor = token(TENANT_A, 's_busy');
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/sunscan/assessments',
      headers: auth(visitor),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++)
      codes.push((await startAssessment(visitor, `${i} Test Street`)).statusCode);
    expect(codes).toEqual([202, 202, 202, 202, 202, 429]);
  });

  it('reports a failed lookup with its code rather than a model', async () => {
    await start();
    const visitor = token(TENANT_A, 's_one');
    const { id } = sunscanAssessmentSchema.parse(
      (await startAssessment(visitor, '1 Nowhere Lane')).json(),
    );
    const done = await untilFinal(visitor, id);
    expect(done.status).toBe('failed');
    expect(done.error?.code).toBe('address-not-found');
    expect(done.modelUrl).toBeNull();
  });

  it('answers not_enabled when the deployment switches assessments off', async () => {
    await start(null);
    const res = await startAssessment(token(TENANT_A, 's_one'), '1 Test Street');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'not_enabled' } });
  });
});

describe('SunScan tools', () => {
  function context(
    service: SunScanService,
    events: ToolEvent[],
    sessionId = 's_tool',
  ): ToolContext {
    return {
      tenant: new TenantRegistry().all[0]!,
      sessionId,
      conversationId: null,
      store,
      answers: {},
      events,
      sunscanConnected: true,
      sunscan: service,
      knowledge: EMPTY_KNOWLEDGE,
    };
  }

  it('start_sunscan_assessment measures the roof, tells the widget, and labels it indicative', async () => {
    await start();
    const service = serviceOn(store);
    const events: ToolEvent[] = [];
    const result = await executeTool(
      {
        name: 'start_sunscan_assessment',
        args: { address: '20 Forthlin Road, Liverpool L18 9TN' },
      },
      context(service, events),
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/21 m² usable/);
    expect(result.summary).toMatch(/Indicative — subject to an on-site survey/);
    // The full RoofAssessmentSummary the quote journey reads.
    const data = result.data as {
      assessmentId: string;
      reliable: boolean;
      usableRoofAreaM2: number;
      mainPlaneId: number | null;
      roofPlanes: { usableAreaM2: number; maxPanels: number }[];
    };
    expect(data.reliable).toBe(true);
    expect(data.usableRoofAreaM2).toBe(21);
    expect(data.mainPlaneId).toBe(0);
    expect(data.roofPlanes[0]).toMatchObject({ usableAreaM2: 21, maxPanels: 12 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'sunscan', detail: { status: 'succeeded' } });

    // get_sunscan_result reads it back for this conversation only.
    const again = await executeTool(
      { name: 'get_sunscan_result', args: { assessmentId: data.assessmentId } },
      context(service, []),
    );
    expect(again.ok).toBe(true);
    const other = await executeTool(
      { name: 'get_sunscan_result', args: { assessmentId: data.assessmentId } },
      context(service, [], 's_someone_else'),
    );
    expect(other.ok).toBe(false);
  });

  it('asks for an address rather than guessing one', async () => {
    await start();
    const result = await executeTool(
      { name: 'start_sunscan_assessment', args: {} },
      context(serviceOn(store), []),
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/address/);
  });
});

describe('the real vendored engine through the API (replay mode, recorded open data)', () => {
  it('models 20 Forthlin Road end to end and serves a real binary glTF', async () => {
    store = new FileStore(dir);
    const service = createDefaultSunScan(store, dir, { SUNSCAN_HTTP_MODE: 'replay' });
    await start(service);
    const visitor = token(TENANT_A, 's_real');
    const res = await startAssessment(visitor, '20 Forthlin Road, Liverpool L18 9TN');
    expect(res.statusCode).toBe(202);
    const { id } = sunscanAssessmentSchema.parse(res.json());
    await service!.idle();
    const done = await untilFinal(visitor, id);
    expect(done.status).toBe('succeeded');
    expect(done.summary?.builtForm).toBe('mid-terrace');
    expect(done.summary?.roofPlanes.length).toBeGreaterThanOrEqual(2);
    const glb = await app.inject({ method: 'GET', url: done.modelUrl!, headers: auth(visitor) });
    expect(glb.rawPayload.subarray(0, 4).toString('latin1')).toBe('glTF');
  }, 120_000);
});
