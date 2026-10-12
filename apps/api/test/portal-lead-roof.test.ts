import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AssessmentRecord, SunScanService } from '@sunny/sunscan-adapter';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import type { ServerConfig } from '../src/config.js';
import { JOURNEY_KEYS } from '../src/journey/journey.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

/**
 * The installer's 3D view of a lead's roof: the model description and the GLB
 * behind `/v1/portal/tenants/:t/leads/:l/assessment/*`, reachable only through
 * the installer's own lead, and found through the visitor's quote journey when
 * the lead itself does not carry the assessment id.
 */

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const SECRET = 'test-secret-lead-roof';
const SPEC = new TextEncoder().encode('{"schema":"sunscan.house/1"}');
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);

function config(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-lead-roof',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: { enabled: false, trustProxyHops: 0, rules: {}, maxKeys: 1000 },
  } as unknown as ServerConfig;
}

/** Only `getArtefact` is reached by the portal routes. */
function fakeSunScan(): SunScanService {
  return {
    getArtefact(_tenantId: string, _id: string, name: string) {
      return Promise.resolve(name === 'spec.json' ? SPEC : name === 'model.glb' ? GLB : null);
    },
  } as unknown as SunScanService;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const as = (email: string) => ({ authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}` });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-lead-roof-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: config(),
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
    sunscan: fakeSunScan(),
  });
  await app.ready();
  return { app, store };
}

async function signUp(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/portal/tenants',
    headers: as(email),
    payload: { companyName: `Solar ${email}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ tenant: { id: string } }>().tenant.id;
}

/** A lead whose quote journey measured a roof, the way the chat leaves it. */
async function leadWithRoof(store: FileStore, tenantId: string): Promise<string> {
  const sessionId = `s_${tenantId}`;
  const assessmentId = `a_${tenantId}`;
  const record: AssessmentRecord = {
    id: assessmentId,
    tenantId,
    status: 'succeeded',
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    target: { address: '20 Forthlin Road, Liverpool', postcode: 'L18 9TN' },
    sessionId,
    summary: null,
    error: null,
    artefacts: ['spec.json', 'model.glb'],
    engine: 'test',
  } as unknown as AssessmentRecord;
  await store.saveSunScanAssessment(record);
  await store.mergeAnswers(tenantId, sessionId, { [JOURNEY_KEYS.assessmentId]: assessmentId });
  const leadId = `lead_${tenantId}`;
  await store.saveLead({
    id: leadId,
    tenantId,
    sessionId,
    conversationId: null,
    name: 'Pat',
    email: 'pat@example.com',
    phone: null,
    postcode: 'L18 9TN',
    summary: 'Wants a quote',
    score: null,
    createdAt: new Date(NOW).toISOString(),
  });
  return leadId;
}

describe("a lead's 3D roof in the portal", () => {
  it('serves the model description and the GLB for the installer’s own lead', async () => {
    const { app, store } = await setup();
    const tenantId = await signUp(app, 'owner@a.test');
    const leadId = await leadWithRoof(store, tenantId);
    const base = `/v1/portal/tenants/${tenantId}/leads/${leadId}/assessment`;

    const summary = await app.inject({ method: 'GET', url: base, headers: as('owner@a.test') });
    expect(summary.statusCode).toBe(200);
    expect(summary.json<{ modelAvailable: boolean }>().modelAvailable).toBe(true);

    const spec = await app.inject({
      method: 'GET',
      url: `${base}/spec.json`,
      headers: as('owner@a.test'),
    });
    expect(spec.statusCode).toBe(200);
    expect(spec.headers['content-type']).toContain('application/json');
    expect(spec.json<{ schema: string }>().schema).toBe('sunscan.house/1');

    const glb = await app.inject({
      method: 'GET',
      url: `${base}/model.glb`,
      headers: as('owner@a.test'),
    });
    expect(glb.statusCode).toBe(200);
    expect(glb.headers['content-type']).toBe('model/gltf-binary');
    expect(glb.headers['content-disposition']).toContain('roof-model.glb');
    expect([...glb.rawPayload.subarray(0, 4)]).toEqual([0x67, 0x6c, 0x54, 0x46]);
  });

  it('lists the journey’s assessment against the lead', async () => {
    const { app, store } = await setup();
    const tenantId = await signUp(app, 'owner@a.test');
    const leadId = await leadWithRoof(store, tenantId);
    const leads = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${tenantId}/leads`,
      headers: as('owner@a.test'),
    });
    const row = leads
      .json<{ leads: Array<{ id: string; assessmentId: string | null }> }>()
      .leads.find((l) => l.id === leadId);
    expect(row?.assessmentId).toBe(`a_${tenantId}`);
  });

  it('gives another installer nothing, whichever ids they try', async () => {
    const { app, store } = await setup();
    const a = await signUp(app, 'owner@a.test');
    const b = await signUp(app, 'owner@b.test');
    const leadA = await leadWithRoof(store, a);

    for (const name of ['spec.json', 'model.glb']) {
      // B through A's tenant path: not a member.
      const viaA = await app.inject({
        method: 'GET',
        url: `/v1/portal/tenants/${a}/leads/${leadA}/assessment/${name}`,
        headers: as('owner@b.test'),
      });
      expect(viaA.statusCode).toBe(404);
      // B through its own tenant path with A's lead id: no such lead.
      const viaB = await app.inject({
        method: 'GET',
        url: `/v1/portal/tenants/${b}/leads/${leadA}/assessment/${name}`,
        headers: as('owner@b.test'),
      });
      expect(viaB.statusCode).toBe(404);
    }
  });

  it('refuses without a sign-in and answers 404 when the lead has no roof', async () => {
    const { app, store } = await setup();
    const tenantId = await signUp(app, 'owner@a.test');
    const leadId = await leadWithRoof(store, tenantId);
    const anonymous = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${tenantId}/leads/${leadId}/assessment/model.glb`,
    });
    expect(anonymous.statusCode).toBe(401);

    await store.saveLead({
      id: 'lead_plain',
      tenantId,
      sessionId: 's_plain',
      conversationId: null,
      name: null,
      email: 'x@example.com',
      phone: null,
      postcode: null,
      summary: 'No roof',
      score: null,
      createdAt: new Date(NOW).toISOString(),
    });
    const none = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${tenantId}/leads/lead_plain/assessment/spec.json`,
      headers: as('owner@a.test'),
    });
    expect(none.statusCode).toBe(404);
  });
});
