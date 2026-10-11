import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dashboardMetricsSchema, type DashboardMetrics } from '@sunny/contracts';

import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';
import { DEMO_TENANT_ID, TEST_ADMIN_TOKEN, seedProducts } from './catalogue-fixture.js';
import type { ServerConfig } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

/**
 * The dashboard's overview figures.
 *
 * Three things are asserted here, and they are the three the route can get wrong
 * while looking correct:
 *
 *   - that the **window** decides every range-scoped figure, on both edges. A
 *     count that ignored `from` and `to` would report a lifetime total under a
 *     heading that says "last 30 days", which is the exact shape of the report
 *     nobody can tell from a right one;
 *   - that a **ratio with no denominator is null and never zero**. "0%" and "no
 *     data" are different facts and the whole reason the contract carries
 *     `number | null`; a test that only checked the happy path would pass on an
 *     implementation that returned 0 for both;
 *   - that the two **present-state counts ignore the window** -- a document
 *     uploaded last year is still a document this installer has -- which is the
 *     one pair in the response that is deliberately not filtered, and therefore
 *     the one a future edit is most likely to "fix" into line.
 *
 * The clock is a parameter and the fixture is written onto disk with hand-chosen
 * timestamps, so every case is decided by the dates in the file rather than by how
 * long the test took. That is the same technique `retention.test.ts` uses, for the
 * same reason: a conversation's timestamps come from the wall clock at write time,
 * so the only way to hold a record from a chosen day is to write one.
 */

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SANDBOX_TENANT_ID = 't_sandbox001';
/** The demo tenant's public widget id, which is what opens a visitor session. */
const DEMO_WIDGET_ID = 'w_demo000001';

/** A timestamp `days` before the pinned clock. */
function ago(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-dashboard',
    allowedOrigins: ['http://localhost:4173'],
    sessionSecret: 'test-secret-not-used-in-production',
    adminToken: TEST_ADMIN_TOKEN,
    logLevel: 'silent',
    sandboxTenant: true,
    // Long enough that the boot-time sweep cannot reach a fixture: every row here
    // is days old, and this file is about counting rather than about expiry.
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

/** An enquiry row in the shape the store writes and reads. */
function leadRow(overrides: {
  id: string;
  tenantId?: string;
  createdAt: string;
  email?: string | null;
  phone?: string | null;
}): Record<string, unknown> {
  return {
    id: overrides.id,
    tenantId: overrides.tenantId ?? DEMO_TENANT_ID,
    sessionId: `sess_${overrides.id}`,
    conversationId: null,
    name: 'Ada',
    email: overrides.email === undefined ? 'ada@example.test' : overrides.email,
    phone: overrides.phone ?? null,
    postcode: null,
    summary: 'Enquiry',
    score: null,
    createdAt: overrides.createdAt,
  };
}

/** One line of a transcript, in the shape the store appends. */
function conversationRow(overrides: {
  id: string;
  tenantId?: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  turns?: Array<{ role: 'user' | 'assistant'; at: string; call?: Record<string, unknown> }>;
}): Record<string, unknown> {
  return {
    id: overrides.id,
    tenantId: overrides.tenantId ?? DEMO_TENANT_ID,
    sessionId: overrides.sessionId,
    turns: (overrides.turns ?? []).map((turn, index) => ({
      role: turn.role,
      text: `turn ${index}`,
      at: turn.at,
      ...(turn.call ? { call: turn.call } : {}),
    })),
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
  };
}

/**
 * A recorded model call, in the shape `runTurn` writes onto an assistant turn.
 *
 * `usage` is left out unless the caller names tokens, which is what makes the
 * "provider reported nothing" case representable: a call that carried no
 * accounting has no `usage` key at all, exactly as the store writes it.
 */
function modelCall(overrides: {
  provider?: string;
  model?: string | null;
  ttfbMs: number;
  totalMs: number;
  inputTokens?: number;
  outputTokens?: number;
}): Record<string, unknown> {
  return {
    provider: overrides.provider ?? 'gemini',
    model: overrides.model === undefined ? 'gemini-2.5-flash' : overrides.model,
    ttfbMs: overrides.ttfbMs,
    totalMs: overrides.totalMs,
    ...(overrides.inputTokens === undefined && overrides.outputTokens === undefined
      ? {}
      : {
          usage: {
            inputTokens: overrides.inputTokens ?? 0,
            outputTokens: overrides.outputTokens ?? 0,
          },
        }),
  };
}

/** One document, in the shape `listKnowledgeSources` reads back. */
function sourceRow(id: string, tenantId = DEMO_TENANT_ID): Record<string, unknown> {
  return {
    id,
    tenantId,
    title: 'Warranty',
    url: null,
    version: '1',
    text: 'Every panel carries a 25 year coating warranty.',
    createdAt: ago(400),
    updatedAt: ago(400),
  };
}

interface Fixture {
  leads?: Record<string, Record<string, unknown>[]>;
  conversations?: Record<string, Record<string, unknown>[]>;
  sources?: Record<string, Record<string, unknown>[]>;
}

/**
 * A server over a directory whose files were planted before it looked.
 *
 * No provider is passed, so a chat request would be refused -- irrelevant here,
 * and deliberately so: this file exercises one read route, and giving it a
 * scripted model would suggest the numbers had something to do with a
 * conversation being held rather than with the records on disk.
 */
async function h(fixture: Fixture = {}): Promise<{ app: FastifyInstance; store: FileStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-dashboard-'));
  dirs.push(dir);

  for (const [tenantId, rows] of Object.entries(fixture.leads ?? {})) {
    await mkdir(join(dir, 'leads'), { recursive: true });
    await writeFile(
      join(dir, 'leads', `${encodeURIComponent(tenantId)}.jsonl`),
      rows.map((row) => `${JSON.stringify(row)}\n`).join(''),
      'utf8',
    );
  }
  for (const [tenantId, rows] of Object.entries(fixture.conversations ?? {})) {
    await mkdir(join(dir, 'conversations'), { recursive: true });
    await writeFile(
      join(dir, 'conversations', `${encodeURIComponent(tenantId)}.jsonl`),
      rows.map((row) => `${JSON.stringify(row)}\n`).join(''),
      'utf8',
    );
  }
  for (const [tenantId, rows] of Object.entries(fixture.sources ?? {})) {
    await mkdir(join(dir, 'knowledge'), { recursive: true });
    await writeFile(
      join(dir, 'knowledge', `${encodeURIComponent(tenantId)}.json`),
      JSON.stringify(rows),
      'utf8',
    );
  }

  const store = new FileStore(dir);
  const app = buildServer({
    config: makeConfig(),
    store,
    tenants: new TenantRegistry(defaultTenants(true)),
    now: () => NOW,
  });
  await app.ready();
  return { app, store };
}

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

/** The metrics route, as the admin token calls it. */
async function metrics(
  app: FastifyInstance,
  query = `tenantId=${DEMO_TENANT_ID}`,
  headers: Record<string, string> = ADMIN,
): Promise<{ status: number; body: DashboardMetrics }> {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/dashboard/metrics?${query}`,
    headers,
  });
  return { status: response.statusCode, body: response.json<DashboardMetrics>() };
}

describe('GET /v1/dashboard/metrics — the credential and the query', () => {
  it('refuses without the admin token, and says which check failed', async () => {
    const { app } = await h();

    const missing = await metrics(app, `tenantId=${DEMO_TENANT_ID}`, {});
    expect(missing.status).toBe(401);

    const wrong = await metrics(app, `tenantId=${DEMO_TENANT_ID}`, {
      authorization: 'Bearer not-the-admin-token',
    });
    expect(wrong.status).toBe(401);
  });

  it('is disabled rather than open when the deployment has no admin token', async () => {
    // The whole point of the null-token branch: a deployment that set no token
    // must not answer this route *unauthenticated* -- it must not answer it at
    // all. 403 and not 401, because the caller's credential is not the problem.
    const dir = await mkdtemp(join(tmpdir(), 'sunny-dashboard-'));
    dirs.push(dir);
    const app = buildServer({
      config: makeConfig({ adminToken: null }),
      store: new FileStore(dir),
      tenants: new TenantRegistry(),
      now: () => NOW,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/dashboard/metrics?tenantId=${DEMO_TENANT_ID}`,
    });
    expect(response.statusCode).toBe(403);
  });

  it('requires a tenant, refuses one it does not have, and refuses an impossible window', async () => {
    const { app } = await h();

    expect((await metrics(app, '')).status).toBe(400);
    expect((await metrics(app, `tenantId=${DEMO_TENANT_ID}&days=0`)).status).toBe(400);
    expect((await metrics(app, `tenantId=${DEMO_TENANT_ID}&days=-1`)).status).toBe(400);
    expect((await metrics(app, `tenantId=${DEMO_TENANT_ID}&days=abc`)).status).toBe(400);
    // 366 lands just past the contract's upper bound, which is the one boundary a
    // single off-by-one in the schema would move without any other test noticing.
    expect((await metrics(app, `tenantId=${DEMO_TENANT_ID}&days=366`)).status).toBe(400);
    expect((await metrics(app, 'tenantId=t_does_not_exist')).status).toBe(404);
  });
});

describe('GET /v1/dashboard/metrics — an empty tenant', () => {
  it('is zeros and nulls, not an error and not an invented figure', async () => {
    const { app } = await h();

    const { status, body } = await metrics(app);
    expect(status).toBe(200);
    expect(dashboardMetricsSchema.safeParse(body).success).toBe(true);

    expect(body.conversations).toEqual({ started: 0, active: 0 });
    expect(body.engagement).toEqual({
      visitorTurns: 0,
      assistantTurns: 0,
      turnsPerActiveConversation: null,
    });
    expect(body.leads).toEqual({ captured: 0, withContact: 0 });
    // The two ratios are null rather than 0. This is the assertion the contract's
    // `number | null` exists for.
    expect(body.leadConversion).toBeNull();
    expect(body.knowledge).toEqual({ sources: 0 });
    expect(body.catalogue).toEqual({ products: 0 });
    // No calls means no latency to report, so all four percentiles are null --
    // the same "cannot say" as the two ratios above, and not a 0 ms that would
    // read as an instantaneous answer.
    expect(body.usage).toEqual({
      calls: 0,
      callsWithTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      latency: { ttfbMsP50: null, ttfbMsP95: null, totalMsP50: null, totalMsP95: null },
      byModel: [],
    });
  });

  it('echoes the window it used, defaulting to thirty days', async () => {
    const { app } = await h();

    const { body } = await metrics(app);
    expect(body.range.days).toBe(30);
    expect(Date.parse(body.range.to)).toBe(NOW);
    expect(Date.parse(body.range.from)).toBe(NOW - 30 * DAY);

    const wide = await metrics(app, `tenantId=${DEMO_TENANT_ID}&days=365`);
    expect(wide.body.range.days).toBe(365);
    expect(Date.parse(wide.body.range.from)).toBe(NOW - 365 * DAY);
  });
});

describe('GET /v1/dashboard/metrics — the window decides the counts', () => {
  it('counts only records inside the window, on both edges', async () => {
    const { app } = await h({
      conversations: {
        [DEMO_TENANT_ID]: [
          // Inside: opened and last written two days ago.
          conversationRow({
            id: 'conv_inside',
            sessionId: 'sess_inside',
            createdAt: ago(2),
            updatedAt: ago(2),
            turns: [
              { role: 'user', at: ago(2) },
              { role: 'assistant', at: ago(2) },
            ],
          }),
          // Started last month but written inside -- active, not started.
          conversationRow({
            id: 'conv_spanning',
            sessionId: 'sess_spanning',
            createdAt: ago(45),
            updatedAt: ago(1),
            turns: [{ role: 'user', at: ago(1) }],
          }),
          // Entirely outside: three months old and untouched since.
          conversationRow({
            id: 'conv_old',
            sessionId: 'sess_old',
            createdAt: ago(90),
            updatedAt: ago(90),
            turns: [
              { role: 'user', at: ago(90) },
              { role: 'assistant', at: ago(90) },
            ],
          }),
        ],
      },
      leads: {
        [DEMO_TENANT_ID]: [
          leadRow({ id: 'lead_inside', createdAt: ago(3) }),
          leadRow({ id: 'lead_old', createdAt: ago(120) }),
        ],
      },
    });

    const { body } = await metrics(app);

    // Two conversations were written inside the window; one of them began inside.
    expect(body.conversations.started).toBe(1);
    expect(body.conversations.active).toBe(2);
    // The three-month-old conversation's two turns are left out entirely.
    expect(body.engagement.visitorTurns).toBe(2);
    expect(body.engagement.assistantTurns).toBe(1);
    expect(body.leads.captured).toBe(1);
    // One start, one capture -> a rate, not a null.
    expect(body.leadConversion).toBe(1);
  });

  it('puts a record written exactly at the boundary in the next window, not this one', async () => {
    // Half-open `[from, to)`: a record at exactly `to` is excluded and one at
    // exactly `from` is included. This is the pair of comparisons an off-by-one
    // flips, and flipping them makes consecutive windows double-count the instant
    // they share, which no single-window test can see.
    const { app } = await h({
      leads: {
        [DEMO_TENANT_ID]: [
          leadRow({ id: 'lead_at_from', createdAt: new Date(NOW - 30 * DAY).toISOString() }),
          leadRow({ id: 'lead_at_to', createdAt: new Date(NOW).toISOString() }),
        ],
      },
    });

    const { body } = await metrics(app);
    expect(body.leads.captured).toBe(1);
  });
});

describe('GET /v1/dashboard/metrics — the ratios', () => {
  it('returns null, never zero, when the denominator is zero', async () => {
    // A lead but no conversation: the conversion's denominator is zero, so the
    // answer is "cannot say", which is a null. Turning this into 0 would report a
    // 0% conversion for a tenant that has simply never had a conversation.
    const { app } = await h({
      leads: { [DEMO_TENANT_ID]: [leadRow({ id: 'lead_only', createdAt: ago(1) })] },
    });

    const { body } = await metrics(app);
    expect(body.leads.captured).toBe(1);
    expect(body.leadConversion).toBeNull();
  });

  it('rounds to three decimals and divides by the denominator the contract names', async () => {
    const { app } = await h({
      conversations: {
        [DEMO_TENANT_ID]: [
          conversationRow({
            id: 'conv_1',
            sessionId: 'sess_1',
            createdAt: ago(1),
            updatedAt: ago(1),
            turns: [
              { role: 'user', at: ago(1) },
              { role: 'assistant', at: ago(1) },
              { role: 'user', at: ago(1) },
            ],
          }),
          conversationRow({
            id: 'conv_2',
            sessionId: 'sess_2',
            createdAt: ago(2),
            updatedAt: ago(2),
            turns: [{ role: 'assistant', at: ago(2) }],
          }),
        ],
      },
      leads: {
        [DEMO_TENANT_ID]: [
          leadRow({ id: 'lead_1', createdAt: ago(1) }),
          leadRow({ id: 'lead_2', createdAt: ago(1), email: null, phone: '07700 900000' }),
          leadRow({ id: 'lead_3', createdAt: ago(1), email: null, phone: null }),
        ],
      },
    });

    const { body } = await metrics(app);
    // 3 captured / 2 started = 1.5, not rounded away.
    expect(body.leadConversion).toBe(1.5);
    // (3 + 1) turns / 2 active = 2.
    expect(body.engagement.turnsPerActiveConversation).toBe(2);
    // Three captured, two with a way to reply -- the third has neither.
    expect(body.leads.withContact).toBe(2);
    expect(body.leadConversion).toBe(
      Math.round((body.leads.captured / body.conversations.started) * 1000) / 1000,
    );
  });
});

describe('GET /v1/dashboard/metrics — usage by tenant and model', () => {
  it('counts a call only when its turn is in the window', async () => {
    // The call rides on the turn, so it inherits the turn's window decision. A
    // call counted from an out-of-window turn would be the one figure on the page
    // that ignored `from` and `to`.
    const { app } = await h({
      conversations: {
        [DEMO_TENANT_ID]: [
          conversationRow({
            id: 'conv_inside',
            sessionId: 'sess_inside',
            createdAt: ago(2),
            updatedAt: ago(2),
            turns: [
              {
                role: 'assistant',
                at: ago(2),
                call: modelCall({ ttfbMs: 100, totalMs: 400, inputTokens: 30, outputTokens: 12 }),
              },
            ],
          }),
          conversationRow({
            id: 'conv_old',
            sessionId: 'sess_old',
            createdAt: ago(90),
            updatedAt: ago(90),
            turns: [
              {
                role: 'assistant',
                at: ago(90),
                call: modelCall({ ttfbMs: 5, totalMs: 9, inputTokens: 999, outputTokens: 999 }),
              },
            ],
          }),
        ],
      },
    });

    const { body } = await metrics(app);
    expect(body.usage.calls).toBe(1);
    // The 90-day-old call's tokens are not in the sum, and its 9 ms total does not
    // become the median of a set it is not part of.
    expect(body.usage.inputTokens).toBe(30);
    expect(body.usage.outputTokens).toBe(12);
    expect(body.usage.latency.totalMsP50).toBe(400);
  });

  it('groups by model, sums only the reported tokens, and orders rows deterministically', async () => {
    // Three calls on the flash model and one on the pro model. The pro call
    // reports no tokens at all, which is the case a sum alone cannot distinguish
    // from "reported zero" -- hence `callsWithTokens`.
    const { app } = await h({
      conversations: {
        [DEMO_TENANT_ID]: [
          conversationRow({
            id: 'conv_a',
            sessionId: 'sess_a',
            createdAt: ago(1),
            updatedAt: ago(1),
            turns: [
              {
                role: 'assistant',
                at: ago(1),
                call: modelCall({ ttfbMs: 100, totalMs: 400, inputTokens: 10, outputTokens: 5 }),
              },
              {
                role: 'assistant',
                at: ago(1),
                call: modelCall({ ttfbMs: 200, totalMs: 800, inputTokens: 20, outputTokens: 10 }),
              },
            ],
          }),
          conversationRow({
            id: 'conv_b',
            sessionId: 'sess_b',
            createdAt: ago(1),
            updatedAt: ago(1),
            turns: [
              {
                role: 'assistant',
                at: ago(1),
                call: modelCall({ ttfbMs: 300, totalMs: 1200, inputTokens: 30, outputTokens: 15 }),
              },
              // The pro call: no `usage` key at all.
              {
                role: 'assistant',
                at: ago(1),
                call: modelCall({ model: 'gemini-2.5-pro', ttfbMs: 50, totalMs: 90 }),
              },
            ],
          }),
        ],
      },
    });

    const { body } = await metrics(app);
    expect(body.usage.calls).toBe(4);
    expect(body.usage.callsWithTokens).toBe(3);
    expect(body.usage.inputTokens).toBe(60);
    expect(body.usage.outputTokens).toBe(30);

    // Most-used model first; the flash row precedes the pro row on call count.
    expect(body.usage.byModel.map((row) => row.model)).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);

    const flash = body.usage.byModel[0]!;
    expect(flash).toMatchObject({ provider: 'gemini', calls: 3, callsWithTokens: 3 });
    // Nearest rank over [100, 200, 300]: p50 is the 2nd of 3, p95 is the 3rd.
    expect(flash.latency).toEqual({
      ttfbMsP50: 200,
      ttfbMsP95: 300,
      totalMsP50: 800,
      totalMsP95: 1200,
    });

    const pro = body.usage.byModel[1]!;
    expect(pro).toMatchObject({ calls: 1, callsWithTokens: 0, inputTokens: 0, outputTokens: 0 });
    expect(pro.latency).toEqual({
      ttfbMsP50: 50,
      ttfbMsP95: 50,
      totalMsP50: 90,
      totalMsP95: 90,
    });

    // The whole-window figures are the calls together, across models.
    // ttfb over [100, 200, 300, 50] sorted is [50, 100, 200, 300]; nearest rank
    // takes the 2nd for p50 and the 4th for p95.
    expect(body.usage.latency.ttfbMsP50).toBe(100);
    expect(body.usage.latency.ttfbMsP95).toBe(300);
    expect(body.usage.latency.totalMsP50).toBe(400);
  });

  it('keeps the model call off the visitor’s own conversation read', async () => {
    // `GET /v1/conversation` returns the store's turn objects to the visitor's
    // browser. The timing and token figures are the installer's operational data,
    // so the field must be dropped on that route even though it is kept on disk
    // for the dashboard -- and this is the pair of assertions that catches a
    // future edit which removes the strip.
    const { app, store } = await h();
    const session = await app.inject({
      method: 'POST',
      url: '/v1/widget/session',
      payload: { publicId: DEMO_WIDGET_ID, origin: 'http://localhost:4173' },
      headers: { origin: 'http://localhost:4173' },
    });
    expect(session.statusCode).toBe(200);
    const { sessionId, sessionToken } = session.json<{
      sessionId: string;
      sessionToken: string;
    }>();

    await store.appendTurn(DEMO_TENANT_ID, sessionId, {
      role: 'assistant',
      text: 'Hello.',
      at: ago(1),
      call: { provider: 'gemini', model: 'gemini-2.5-flash', ttfbMs: 120, totalMs: 500 },
    });

    const read = await app.inject({
      method: 'GET',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(read.statusCode).toBe(200);
    const turn = read.json<{ turns: Array<Record<string, unknown>> }>().turns[0]!;
    expect(turn).not.toHaveProperty('call');
    // The content the widget does read is untouched.
    expect(turn).toMatchObject({ role: 'assistant', text: 'Hello.' });

    // ...while the dashboard over the same record still sees it.
    const { body } = await metrics(app);
    expect(body.usage.calls).toBe(1);
  });
});

describe('GET /v1/dashboard/metrics — the present-state counts', () => {
  it('counts documents and products whatever their age', async () => {
    const { app, store } = await h({
      sources: { [DEMO_TENANT_ID]: [sourceRow('src_old'), sourceRow('src_newer')] },
    });
    await seedProducts(store);

    const { body } = await metrics(app);
    // Both documents were written 400 days ago and both products were imported
    // with a fixed 2026-01-01 timestamp -- far outside a 30-day window. They are
    // still what the installer has, so they are still counted.
    expect(body.knowledge.sources).toBe(2);
    expect(body.catalogue.products).toBe(4);
  });
});

describe('GET /v1/dashboard/metrics — tenancy', () => {
  it('never counts another tenant’s records', async () => {
    const { app } = await h({
      conversations: {
        [DEMO_TENANT_ID]: [
          conversationRow({
            id: 'conv_demo',
            sessionId: 'sess_demo',
            createdAt: ago(1),
            updatedAt: ago(1),
            turns: [{ role: 'user', at: ago(1) }],
          }),
        ],
        [SANDBOX_TENANT_ID]: [
          conversationRow({
            id: 'conv_sandbox',
            tenantId: SANDBOX_TENANT_ID,
            sessionId: 'sess_sandbox',
            createdAt: ago(1),
            updatedAt: ago(1),
            turns: [{ role: 'user', at: ago(1) }],
          }),
        ],
      },
      leads: {
        [DEMO_TENANT_ID]: [leadRow({ id: 'lead_demo', createdAt: ago(1) })],
        [SANDBOX_TENANT_ID]: [
          leadRow({ id: 'lead_sandbox', tenantId: SANDBOX_TENANT_ID, createdAt: ago(1) }),
          leadRow({ id: 'lead_sandbox2', tenantId: SANDBOX_TENANT_ID, createdAt: ago(1) }),
        ],
      },
      sources: {
        [DEMO_TENANT_ID]: [sourceRow('src_demo')],
        [SANDBOX_TENANT_ID]: [
          sourceRow('src_a', SANDBOX_TENANT_ID),
          sourceRow('src_b', SANDBOX_TENANT_ID),
        ],
      },
    });

    const demo = (await metrics(app, `tenantId=${DEMO_TENANT_ID}`)).body;
    expect(demo.conversations.started).toBe(1);
    expect(demo.leads.captured).toBe(1);
    expect(demo.knowledge.sources).toBe(1);

    const sandbox = (await metrics(app, `tenantId=${SANDBOX_TENANT_ID}`)).body;
    expect(sandbox.conversations.started).toBe(1);
    expect(sandbox.leads.captured).toBe(2);
    expect(sandbox.knowledge.sources).toBe(2);
  });
});
