import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditEventSchema, type AuditEvent, type AuditEventsResponse } from '@sunny/contracts';

import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry } from '../src/tenants.js';
import {
  CATALOGUE,
  DEMO_TENANT_ID,
  TEST_ADMIN_TOKEN,
  csv,
  PANEL_500,
} from './catalogue-fixture.js';
import { ScriptedProvider } from './scripted-provider.js';
import type { ServerConfig } from '../src/config.js';
import type { ChatProvider } from '../src/agent/provider.js';
import type { FastifyInstance } from 'fastify';

/**
 * The audit trail, end to end through a real server and a real store on disk.
 *
 * Two things this file is for, and the second matters more than the first:
 *
 *   - that each privileged act writes exactly one record, saying who did what to
 *     which thing and whether it worked -- including the refusals, which are the
 *     half a security review is usually about;
 *   - that the record does **not** contain the thing it is about. Every marker
 *     planted below (an email address, a model name, a warranty paragraph) is
 *     searched for in the stored bytes and the served response. That check is the
 *     point: an audit log is a second copy of the data it describes unless
 *     somebody is actively preventing it, and "somebody" is this test.
 */

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-audit',
    allowedOrigins: ['http://localhost:4173'],
    sessionSecret: 'test-secret-not-used-in-production',
    adminToken: TEST_ADMIN_TOKEN,
    logLevel: 'silent',
    sandboxTenant: false,
    // Long enough that the sweep the server starts on boot cannot reach a fixture.
    // Retention has its own suite.
    leadRetentionDays: 730,
    rateLimit: {
      enabled: true,
      trustProxyHops: 0,
      rules: {
        session: { limit: 100_000, windowMs: 60_000 },
        chat: { limit: 100_000, windowMs: 60_000 },
        leads: { limit: 100_000, windowMs: 60_000 },
        qualification: { limit: 100_000, windowMs: 60_000 },
        catalogue: { limit: 100_000, windowMs: 60_000 },
        knowledge: { limit: 100_000, windowMs: 60_000 },
      },
      maxKeys: 10_000,
    },
    ...overrides,
  };
}

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
});

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

interface Harness {
  app: FastifyInstance;
  store: FileStore;
  dir: string;
}

async function h(provider?: ChatProvider): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-audit-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const app = buildServer({
    config: makeConfig(),
    store,
    tenants: new TenantRegistry(),
    ...(provider ? { provider } : {}),
    now: () => 1_700_000_000_000,
  });
  await app.ready();
  return { app, store, dir };
}

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

async function trail(app: FastifyInstance, tenantId = DEMO_TENANT_ID): Promise<AuditEvent[]> {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/audit/events?tenantId=${tenantId}`,
    headers: ADMIN,
  });
  expect(response.statusCode).toBe(200);
  return response.json<AuditEventsResponse>().events as AuditEvent[];
}

/**
 * Every stored line, from both files, parsed as the contract's own schema.
 *
 * Reading the files rather than the route is deliberate: the route strips
 * `tenantId` and caps at a limit, so a test that only read the route could not
 * see the refused-attempt file at all, and would not notice a stored line that
 * does not parse.
 */
async function storedEvents(dir: string): Promise<AuditEvent[]> {
  const events: AuditEvent[] = [];
  for (const name of [`${encodeURIComponent(DEMO_TENANT_ID)}.jsonl`, '_unscoped.jsonl']) {
    const raw = await readFile(join(dir, 'audit', name), 'utf8').catch(() => '');
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      events.push(auditEventSchema.parse(JSON.parse(line)));
    }
  }
  return events;
}

async function openSession(app: FastifyInstance): Promise<{ sessionId: string; token: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/widget/session',
    payload: { publicId: 'w_demo000001', origin: 'http://localhost:4173' },
  });
  const body = response.json<{ sessionId: string; sessionToken: string }>();
  return { sessionId: body.sessionId, token: body.sessionToken };
}

describe('what a privileged act records', () => {
  it('writes one event per act, with the actor, the target and the outcome', async () => {
    const { app } = await h();

    const uploaded = await app.inject({
      method: 'POST',
      url: '/v1/catalog/products',
      headers: ADMIN,
      payload: { tenantId: DEMO_TENANT_ID, csv: CATALOGUE },
    });
    expect(uploaded.statusCode).toBe(201);

    const put = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/sources',
      headers: ADMIN,
      payload: {
        tenantId: DEMO_TENANT_ID,
        title: 'Warranty terms',
        version: '2026-01',
        text: '# Warranty\n\nEvery panel carries a 25 year coating warranty.\n',
      },
    });
    expect(put.statusCode).toBe(201);
    const jobId = put.json<{ job: { id: string } }>().job.id;

    const job = await app.inject({
      method: 'GET',
      url: `/v1/knowledge/jobs/${jobId}?tenantId=${DEMO_TENANT_ID}`,
      headers: ADMIN,
    });
    expect(job.statusCode).toBe(200);

    const leads = await app.inject({
      method: 'GET',
      url: `/v1/leads?tenantId=${DEMO_TENANT_ID}`,
      headers: ADMIN,
    });
    expect(leads.statusCode).toBe(200);

    const events = (await trail(app)).slice().reverse();
    expect(events.map((event) => event.action)).toEqual([
      'catalogue.upload',
      'knowledge.source.write',
      'knowledge.job.read',
      'leads.read',
    ]);
    expect(events.every((event) => event.outcome === 'permitted')).toBe(true);
    expect(events.every((event) => event.actor.kind === 'admin')).toBe(true);
    // The actor's id is null, and that is a true statement about this deployment
    // rather than a gap: one shared admin token identifies nobody. Asserted so
    // that populating it later is a deliberate change to this test.
    expect(events.every((event) => event.actor.id === null)).toBe(true);

    const [catalogue, source, readJob, leadRead] = events as [
      AuditEvent,
      AuditEvent,
      AuditEvent,
      AuditEvent,
    ];
    expect(catalogue.target).toEqual({ kind: 'catalogue', id: null });
    expect(catalogue.detail).toEqual({
      accepted: 4,
      rejected: 0,
      catalogueSize: 4,
      replaced: true,
      dryRun: false,
    });
    expect(source.target.kind).toBe('knowledge_source');
    expect(source.detail['chunks']).toBeGreaterThan(0);
    expect(source.detail['replaced']).toBe(false);
    expect(readJob.target).toEqual({ kind: 'ingestion_job', id: jobId });
    expect(leadRead.target).toEqual({ kind: 'lead_list', id: null });
    expect(leadRead.detail).toEqual({ leads: 0 });
  });

  it('records a refused credential, under no tenant, with the attempt and nothing else', async () => {
    const { app, dir } = await h();

    const refused = await app.inject({
      method: 'POST',
      url: '/v1/catalog/products',
      headers: { authorization: 'Bearer not-the-admin-token' },
      payload: { tenantId: DEMO_TENANT_ID, csv: csv(PANEL_500) },
    });
    expect(refused.statusCode).toBe(401);

    const events = await storedEvents(dir);
    expect(events).toHaveLength(1);
    const [event] = events as [AuditEvent];
    expect(event.action).toBe('catalogue.upload');
    expect(event.outcome).toBe('denied');
    expect(event.reason).toBe('bad_credential');
    // Null, not guessed: the credential was refused before the body was read, so
    // no tenant was ever named. Filing it under one would be inventing a fact.
    expect(event.tenantId).toBeNull();
    expect(event.target).toEqual({ kind: 'catalogue', id: null });
    expect(event.detail).toEqual({});
    expect(event.requestId).not.toBeNull();

    // It is not in any tenant's trail: an unscoped refusal is not one
    // installer's business, and it is not served by their read.
    expect(await trail(app)).toEqual([]);
  });

  it('records a body the route could not use as failed rather than permitted', async () => {
    const { app } = await h();

    // An unterminated quote: an untrustworthy file, so nothing is stored.
    const broken = await app.inject({
      method: 'POST',
      url: '/v1/catalog/products',
      headers: ADMIN,
      payload: { tenantId: DEMO_TENANT_ID, csv: 'Category,Model\nPanel,"SB-430\n' },
    });
    expect(broken.statusCode).toBe(200);

    const [event] = await trail(app);
    expect(event?.outcome).toBe('failed');
    expect(event?.reason).toBe('invalid_request');
    expect(event?.detail['accepted']).toBe(0);
  });

  it('records an unknown tenant named by a credential that is otherwise fine', async () => {
    const { app, dir } = await h();

    const nowhere = await app.inject({
      method: 'POST',
      url: '/v1/catalog/products',
      headers: ADMIN,
      payload: { tenantId: 't_nobody', csv: CATALOGUE },
    });
    expect(nowhere.statusCode).toBe(404);

    // The credential was good and the tenant was not, so this is a `failed` and
    // not a `denied` -- and it is filed under no tenant, because `t_nobody` is
    // not one this deployment has and inventing a home for the record would be
    // exactly the kind of guess an audit trail must not make.
    const events = await storedEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('failed');
    expect(events[0]?.reason).toBe('unknown_tenant');
    expect(events[0]?.tenantId).toBeNull();

    // And the demo tenant's own trail is untouched, on disk and through the route.
    expect(await trail(app)).toEqual([]);
  });
});

describe('what an event never contains', () => {
  it('copies no document text, no catalogue row and no visitor detail', async () => {
    const { app, dir } = await h();

    const documentText = 'MARKER-DOCUMENT-TEXT warranty terms for the estate';
    const model = 'MARKER-MODEL-447';
    const email = 'marker.visitor@example.test';

    await app.inject({
      method: 'POST',
      url: '/v1/knowledge/sources',
      headers: ADMIN,
      payload: {
        tenantId: DEMO_TENANT_ID,
        title: 'MARKER-DOCUMENT-TITLE',
        version: '2026-01',
        text: `# Warranty\n\n${documentText}\n`,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/catalog/products',
      headers: ADMIN,
      payload: { tenantId: DEMO_TENANT_ID, csv: csv({ ...PANEL_500, Model: model }) },
    });

    const { sessionId, token } = await openSession(app);
    await app.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, consent: true, email, summary: 'MARKER-SUMMARY' },
    });
    await app.inject({ method: 'GET', url: '/v1/leads?tenantId=t_demo0001', headers: ADMIN });

    const raw = await readFile(
      join(dir, 'audit', `${encodeURIComponent(DEMO_TENANT_ID)}.jsonl`),
      'utf8',
    );
    // The document, its title, the catalogue row and the visitor's address: each
    // one is somewhere else, and the audit trail is not somewhere else.
    expect(raw).not.toContain('MARKER-DOCUMENT-TEXT');
    expect(raw).not.toContain('MARKER-DOCUMENT-TITLE');
    expect(raw).not.toContain(model);
    expect(raw).not.toContain(email);
    expect(raw).not.toContain('MARKER-SUMMARY');

    // And the same bytes still say something useful: the acts are there.
    expect(raw).toContain('knowledge.source.write');
    expect(raw).toContain('catalogue.upload');
    expect(raw).toContain('leads.read');
  });

  it('has no field a string could travel in, outside ids and closed vocabularies', async () => {
    const { app, dir } = await h();

    await app.inject({
      method: 'POST',
      url: '/v1/catalog/products',
      headers: ADMIN,
      payload: { tenantId: DEMO_TENANT_ID, csv: CATALOGUE },
    });

    const events = await storedEvents(dir);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      // The type is the guarantee, restated as a runtime check on the stored
      // bytes: `detail` is where someone would reach for a string, and it cannot
      // hold one.
      for (const value of Object.values(event.detail)) {
        expect(['number', 'boolean']).toContain(typeof value);
      }
      // Everything else that is a string is either a server-minted id, a
      // timestamp, a request id, or a member of one of the schemas' enums.
      expect(event.id.startsWith('aud_')).toBe(true);
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
    }
  });
});

describe('the assistant’s own tool calls', () => {
  it('records an effectful call and says nothing about a read', async () => {
    const provider = new ScriptedProvider(() => [
      { type: 'tool_started', call: { name: 'search_catalogue', args: {} } },
      {
        type: 'tool_started',
        call: {
          name: 'create_lead',
          args: {
            consent: true,
            name: 'Ada',
            email: 'ada@example.test',
            summary: 'Wants a survey',
          },
        },
      },
      { type: 'text', text: 'Thanks -- I have passed that on.' },
    ]);
    const { app } = await h(provider);
    const { sessionId, token } = await openSession(app);

    const stream = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'Yes, please call me.' },
    });
    expect(stream.statusCode).toBe(200);

    const events = await trail(app);
    expect(events.map((event) => event.action)).toEqual(['agent.tool.invoke']);
    const [event] = events as [AuditEvent, ...AuditEvent[]];
    expect(event.actor.kind).toBe('system');
    expect(event.target).toEqual({ kind: 'tool', id: 'create_lead' });
    expect(event.outcome).toBe('permitted');
    // Which conversation it happened in, and no more about the person than that.
    expect(event.sessionId).toBe(sessionId);
    expect(JSON.stringify(event)).not.toContain('ada@example.test');
    expect(JSON.stringify(event)).not.toContain('Ada');
  });

  it('records a tool that declined, and the reason it is not a refusal of the caller', async () => {
    const provider = new ScriptedProvider(() => [
      {
        type: 'tool_started',
        // No consent: the tool refuses, which is a fact about the call rather
        // than about the caller's credentials.
        call: { name: 'create_lead', args: { name: 'Ada' } },
      },
      { type: 'text', text: 'I need their agreement first.' },
    ]);
    const { app } = await h(provider);
    const { sessionId, token } = await openSession(app);

    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'Sign them up.' },
    });

    const [event] = await trail(app);
    expect(event?.action).toBe('agent.tool.invoke');
    expect(event?.outcome).toBe('failed');
    expect(event?.reason).toBe('refused');
  });
});
