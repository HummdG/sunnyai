import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONSENT_VERSION,
  consentWording,
  type AuditEvent,
  type AuditEventsResponse,
  type DeletionResponse,
  type LeadResponse,
} from '@sunny/contracts';

import { buildServer } from '../src/server.js';
import { SESSION_TTL_MS, issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry } from '../src/tenants.js';
import { DEMO_TENANT_ID, TEST_ADMIN_TOKEN } from './catalogue-fixture.js';
import { ScriptedProvider } from './scripted-provider.js';
import type { ServerConfig } from '../src/config.js';
import type { ChatProvider } from '../src/agent/provider.js';
import type { FastifyInstance } from 'fastify';

/** What `app.inject` hands back, named once so the helpers below stay readable. */
type Injected = Awaited<ReturnType<FastifyInstance['inject']>>;

/**
 * Consent provenance, retention's other half, and deletion.
 *
 * Three things are asserted here, and they are the three the plan's §4 puts in
 * one sentence ("consent provenance, source, timestamps, retention, deletion"):
 *
 *   - what a stored lead says about **how the visitor agreed**, and the fact that
 *     every word of it is the server's rather than the caller's -- the wording
 *     version, the surface, and the origin signed into the session;
 *   - that **deletion** really removes the bytes, from both the enquiry and the
 *     transcript, and answers honestly about what went;
 *   - that the **trail survives the data it describes**, without becoming a second
 *     copy of it. That last one is the reason the file reads the stored JSONL
 *     rather than only the API: a response can be shaped, and the point is what is
 *     actually on disk.
 *
 * Retention itself has its own file (`retention.test.ts`), because a sweep driven
 * by a clock is a different kind of subject from a request driven by a caller.
 */

const ORIGIN = 'http://localhost:4173';
/** A second origin this deployment allows, for the test about where a value comes from. */
const OTHER_ORIGIN = 'http://localhost:4174';
const SECRET = 'test-secret-not-used-in-production';
const DEMO_PUBLIC_ID = 'w_demo000001';
const NOW = 1_700_000_000_000;

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-consent',
    allowedOrigins: [ORIGIN],
    sessionSecret: SECRET,
    adminToken: TEST_ADMIN_TOKEN,
    logLevel: 'silent',
    sandboxTenant: false,
    // Long enough that the sweep the server starts on boot cannot reach a fixture:
    // this file is about consent and deletion, and retention has its own.
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

async function h(provider?: ChatProvider, overrides: Partial<ServerConfig> = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-consent-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const app = buildServer({
    config: makeConfig(overrides),
    store,
    tenants: new TenantRegistry(),
    ...(provider ? { provider } : {}),
    now: () => NOW,
  });
  await app.ready();
  return { app, store, dir };
}

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

/**
 * Open a widget session, naming the page origin the route requires.
 *
 * There is no omitted-origin variant here: `sessionRequestSchema` requires one,
 * so a session that named nowhere cannot be opened through this API at all. That
 * state is reached only by a token signed before the field existed, and it is
 * tested through a minted token instead of being faked through the route.
 */
async function openSession(
  app: FastifyInstance,
  origin: string = ORIGIN,
): Promise<{ sessionId: string; token: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/widget/session',
    payload: { publicId: DEMO_PUBLIC_ID, origin },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json<{ sessionId: string; sessionToken: string }>();
  return { sessionId: body.sessionId, token: body.sessionToken };
}

/** The stored lead rows for a tenant, straight off disk. */
async function storedLeads(
  dir: string,
  tenantId = DEMO_TENANT_ID,
): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(
    join(dir, 'leads', `${encodeURIComponent(tenantId)}.jsonl`),
    'utf8',
  ).catch(() => '');
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function trail(app: FastifyInstance, tenantId = DEMO_TENANT_ID): Promise<AuditEvent[]> {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/audit/events?tenantId=${tenantId}`,
    headers: ADMIN,
  });
  expect(response.statusCode).toBe(200);
  return response.json<AuditEventsResponse>().events as AuditEvent[];
}

function fileLead(
  app: FastifyInstance,
  token: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
): Promise<Injected> {
  return app.inject({
    method: 'POST',
    url: '/v1/leads',
    headers: { authorization: `Bearer ${token}` },
    payload: { sessionId, consent: true, email: 'visitor@example.test', ...extra },
  });
}

describe('what a lead says about the agreement', () => {
  it('names the wording, the surface and the signed origin of a form submission', async () => {
    const { app, dir } = await h();
    const { sessionId, token } = await openSession(app);

    const filed = await fileLead(app, token, sessionId);
    expect(filed.statusCode).toBe(201);

    const [stored] = await storedLeads(dir);
    expect(stored?.['consent']).toEqual({
      version: CONSENT_VERSION,
      surface: 'form',
      origin: ORIGIN,
    });
  });

  it('names the widget surface for a lead the assistant files', async () => {
    const provider = new ScriptedProvider(() => [
      {
        type: 'tool_started',
        call: {
          name: 'create_lead',
          args: { consent: true, name: 'Ada', email: 'ada@example.test' },
        },
      },
      { type: 'text', text: 'Passed on.' },
    ]);
    const { app, dir } = await h(provider);
    const { sessionId, token } = await openSession(app);

    const stream = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'Please call me.' },
    });
    expect(stream.statusCode).toBe(200);

    // The tool reaches the visitor only through the widget, so the surface is a
    // constant here rather than something the model could claim -- and the origin
    // still comes from the session rather than from the turn.
    const [stored] = await storedLeads(dir);
    expect(stored?.['consent']).toEqual({
      version: CONSENT_VERSION,
      surface: 'widget',
      origin: ORIGIN,
    });
  });

  it('takes the origin from the signed session, not from a header on the request', async () => {
    // Both origins are allowed, so the request itself clears the CORS hook and the
    // only thing left that could explain the stored value is where it was read.
    const { app, dir } = await h(undefined, { allowedOrigins: [ORIGIN, OTHER_ORIGIN] });
    const { sessionId, token } = await openSession(app);

    const filed = await app.inject({
      method: 'POST',
      url: '/v1/leads',
      // A header the caller controls, naming somewhere else. It is not read, and
      // this is what says so: a provenance field an attacker can fill in is worth
      // less than no field at all, because it reads as evidence.
      headers: { authorization: `Bearer ${token}`, origin: OTHER_ORIGIN },
      payload: { sessionId, consent: true, email: 'visitor@example.test' },
    });
    expect(filed.statusCode).toBe(201);

    const [stored] = await storedLeads(dir);
    expect((stored?.['consent'] as { origin: string }).origin).toBe(ORIGIN);
  });

  it('records a null origin for a session that named none', async () => {
    const { app, dir } = await h();
    // A token in the shape an earlier release signed: no `origin` claim at all.
    // Minted rather than faked, so this exercises `verifySessionToken`'s real
    // acceptance of the field's absence -- a visitor mid-conversation across a
    // deploy is the case that keeps it optional.
    const sessionId = 'sess_noorigin0';
    const token = issueSessionToken(
      { sessionId, tenantId: DEMO_TENANT_ID, expiresAt: NOW + SESSION_TTL_MS },
      SECRET,
    );

    const filed = await fileLead(app, token, sessionId);
    expect(filed.statusCode).toBe(201);

    // Null, not absent and not a guess: the session recorded that the page named
    // no origin, and inventing one here would be the invented provenance the
    // whole design is arranged to avoid.
    const [stored] = await storedLeads(dir);
    expect((stored?.['consent'] as { origin: string | null }).origin).toBeNull();
  });

  it('reads back a row written before the field existed without inventing one for it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-consent-'));
    dirs.push(dir);
    // A row in the shape a previous release wrote: no `consent` key at all. Written
    // before the server is built, so the load at first use is what reads it.
    await mkdir(join(dir, 'leads'), { recursive: true });
    await writeFile(
      join(dir, 'leads', `${encodeURIComponent(DEMO_TENANT_ID)}.jsonl`),
      `${JSON.stringify({
        id: 'lead_old000000000001',
        tenantId: DEMO_TENANT_ID,
        sessionId: 'sess_older',
        conversationId: null,
        name: 'Ada',
        email: 'ada@example.test',
        phone: null,
        postcode: null,
        summary: 'Enquiry from an earlier release',
        score: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      })}\n`,
      'utf8',
    );

    const app = buildServer({
      config: makeConfig(),
      store: new FileStore(dir),
      tenants: new TenantRegistry(),
      now: () => NOW,
    });
    await app.ready();

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/leads?tenantId=${DEMO_TENANT_ID}`,
      headers: ADMIN,
    });
    expect(listed.statusCode).toBe(200);
    const { leads } = listed.json<{ leads: Array<Record<string, unknown>> }>();
    expect(leads).toHaveLength(1);
    // Absent, which is the honest answer: we cannot name what that visitor agreed
    // to, and a default would be a fabricated one.
    expect(leads[0]?.['consent']).toBeUndefined();
  });

  it('serves the wording the version names, and refuses to invent one for an unknown version', () => {
    const wording = consentWording(CONSENT_VERSION);
    expect(wording).toBeTypeOf('string');
    // Long enough to be a sentence somebody actually read, rather than a label.
    expect((wording ?? '').length).toBeGreaterThan(40);
    expect(wording).toContain('installer');
    // A stored row naming a version this build does not have must not come back
    // with some other version's wording attached to it.
    expect(consentWording('1999-01-01')).toBeNull();
  });
});

describe('a visitor erasing their own conversation', () => {
  it('erases the transcript, the answers and the enquiry filed from it', async () => {
    const { app, dir } = await h();
    const { sessionId, token } = await openSession(app);

    const answered = await app.inject({
      method: 'POST',
      url: '/v1/qualification/answer',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, questionId: 'roof_direction', value: 'south' },
    });
    expect(answered.statusCode).toBe(200);

    const filed = await fileLead(app, token, sessionId);
    expect(filed.statusCode).toBe(201);

    const before = await app.inject({
      method: 'GET',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    const conversationId = before.json<{ conversationId: string | null }>().conversationId;
    expect(conversationId).not.toBeNull();

    const erased = await app.inject({
      method: 'DELETE',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(erased.statusCode).toBe(200);
    expect(erased.json<DeletionResponse>()).toEqual({
      deleted: true,
      leadId: null,
      conversationId,
      leadsDeleted: 1,
    });

    // The read is empty afterwards, and empty in the way that says there is no
    // conversation -- not the same conversation with its contents hidden.
    const after = await app.inject({
      method: 'GET',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.json<{ conversationId: string | null; turns: unknown[] }>()).toEqual({
      conversationId: null,
      turns: [],
    });

    // And on disk, which is the assertion a response cannot dress up: the leads
    // file is gone rather than emptied, so "this visitor has nothing" has one
    // representation instead of two.
    await expect(
      readFile(join(dir, 'leads', `${encodeURIComponent(DEMO_TENANT_ID)}.jsonl`), 'utf8'),
    ).rejects.toThrow();
  });

  it('answers a second erase rather than refusing it', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);
    expect((await fileLead(app, token, sessionId)).statusCode).toBe(201);

    const first = await app.inject({
      method: 'DELETE',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: 'DELETE',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(first.statusCode).toBe(200);
    // 200 rather than 404: a visitor asking us to erase what we hold about them is
    // answered either way, and a 404 would make them work out whether the first
    // call landed instead of telling them.
    expect(second.statusCode).toBe(200);
    expect(second.json<DeletionResponse>()).toEqual({
      deleted: true,
      leadId: null,
      conversationId: null,
      leadsDeleted: 0,
    });
  });

  it('records the erasure and keeps the visitor out of the record', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);
    expect(
      (
        await fileLead(app, token, sessionId, {
          email: 'erased-marker@example.test',
          name: 'Mx Marker',
        })
      ).statusCode,
    ).toBe(201);

    await app.inject({
      method: 'DELETE',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });

    const events = await trail(app);
    const erased = events.filter((event) => event.action === 'conversation.delete');
    expect(erased).toHaveLength(1);
    const [event] = erased as [AuditEvent, ...AuditEvent[]];
    expect(event.outcome).toBe('permitted');
    expect(event.target.kind).toBe('conversation');
    // Zero conversations and one enquiry, and that pairing is the point: filing
    // an enquiry does not open a transcript, so this visitor's only record is the
    // enquiry. Answering them with the enquiry still in place is the failure this
    // counts against -- the transcript-and-enquiry case is the test above.
    expect(event.detail).toEqual({ conversations: 0, leads: 1 });
    expect(event.sessionId).toBe(sessionId);

    // The point of the file, restated at the one moment it is easiest to get
    // wrong: the record of the erasure must not contain what was erased, or the
    // visitor's request would have been answered by moving their details
    // somewhere else.
    expect(JSON.stringify(events)).not.toContain('erased-marker@example.test');
    expect(JSON.stringify(events)).not.toContain('Mx Marker');
  });

  it('refuses a caller with no session token', async () => {
    const { app } = await h();
    const response = await app.inject({ method: 'DELETE', url: '/v1/conversation' });
    expect(response.statusCode).toBe(401);
  });
});

describe('an installer erasing one enquiry', () => {
  /** Two enquiries from one conversation, which is what makes the rule testable. */
  async function fileTwo(
    app: FastifyInstance,
    token: string,
    sessionId: string,
  ): Promise<[string, string]> {
    const first = await fileLead(app, token, sessionId, { email: 'first@example.test' });
    const second = await fileLead(app, token, sessionId, { email: 'second@example.test' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    return [first.json<LeadResponse>().leadId, second.json<LeadResponse>().leadId];
  }

  /** A conversation for the session, so "the transcript went too" can be checked. */
  async function answer(app: FastifyInstance, token: string, sessionId: string): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/qualification/answer',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, questionId: 'roof_direction', value: 'south' },
    });
    expect(response.statusCode).toBe(200);
  }

  const erase = (app: FastifyInstance, leadId: string): Promise<Injected> =>
    app.inject({
      method: 'DELETE',
      url: `/v1/leads/${leadId}?tenantId=${DEMO_TENANT_ID}`,
      headers: ADMIN,
    });

  it('erases one enquiry and leaves its neighbour and the conversation alone', async () => {
    const { app, store, dir } = await h();
    const { sessionId, token } = await openSession(app);
    await answer(app, token, sessionId);
    const [first] = await fileTwo(app, token, sessionId);

    const erased = await erase(app, first);
    expect(erased.statusCode).toBe(200);
    // Erasing one record is not a request to erase the other, so the conversation
    // stays and no second enquiry goes with it.
    expect(erased.json<DeletionResponse>()).toEqual({
      deleted: true,
      leadId: first,
      conversationId: null,
      leadsDeleted: 0,
    });
    expect(await storedLeads(dir)).toHaveLength(1);
    expect(await store.getConversation(DEMO_TENANT_ID, sessionId)).not.toBeNull();
  });

  it('takes the conversation with the last enquiry from it', async () => {
    const { app, store } = await h();
    const { sessionId, token } = await openSession(app);
    await answer(app, token, sessionId);
    const [first, second] = await fileTwo(app, token, sessionId);
    const conversation = await store.getConversation(DEMO_TENANT_ID, sessionId);
    expect(conversation).not.toBeNull();

    expect((await erase(app, first)).json<DeletionResponse>().conversationId).toBeNull();

    const last = await erase(app, second);
    expect(last.statusCode).toBe(200);
    // The transcript is the visitor's answers, so it goes with the last enquiry
    // rather than staying behind with nothing left to justify it.
    expect(last.json<DeletionResponse>()).toEqual({
      deleted: true,
      leadId: second,
      conversationId: conversation?.id ?? null,
      leadsDeleted: 0,
    });
    expect(await store.getConversation(DEMO_TENANT_ID, sessionId)).toBeNull();
  });

  it('reports 404 for the same id afterwards, rather than erasing something else', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);
    const [first] = await fileTwo(app, token, sessionId);

    expect((await erase(app, first)).statusCode).toBe(200);
    // The "last one out" rule keys on a row that no longer exists, and a rule with
    // nothing to match on is exactly where a wrong answer would be silent.
    expect((await erase(app, first)).statusCode).toBe(404);
  });

  it('answers 404 for an enquiry it does not hold, and says so in the trail', async () => {
    const { app } = await h();
    const response = await erase(app, 'lead_neverexisted');
    expect(response.statusCode).toBe(404);

    const events = (await trail(app)).filter((event) => event.action === 'leads.delete');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('failed');
    expect(events[0]?.reason).toBe('not_found');
  });

  it('does not exist at all without an admin token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-consent-'));
    dirs.push(dir);
    const app = buildServer({
      config: makeConfig({ adminToken: null }),
      store: new FileStore(dir),
      tenants: new TenantRegistry(),
      now: () => NOW,
    });
    await app.ready();

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/leads/lead_whatever?tenantId=${DEMO_TENANT_ID}`,
    });
    // `not_enabled` rather than `unauthorized`: there is no credential to present,
    // which is a different thing from one being rejected.
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_enabled');
  });
});
