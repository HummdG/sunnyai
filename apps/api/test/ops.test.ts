import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import type { ServerConfig } from '../src/config.js';
import { FileOpsLedger, MemoryOpsLedger, type OpsDay, type OpsLedger } from '../src/ops/ledger.js';
import { detectIssues, sourceIssues, tenantRows, usageReport } from '../src/ops/report.js';
import {
  createBillingSource,
  createMonitoringSource,
  createPostmarkSource,
  createStripeSource,
  hourStarts,
  loadOpsConfig,
} from '../src/ops/sources.js';
import {
  bucketOf,
  createTelemetry,
  instrumentStore,
  loggerHooks,
  redact,
  timingPercentile,
} from '../src/ops/telemetry.js';
import { loadPortalConfig, parseStaffEmails } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, TenantRegistry, type Tenant } from '../src/tenants.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const TODAY = '2026-10-12';
const SECRET = 'ops-test-secret';
const STAFF = 'dev@sunny.test';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-ops-'));
  dirs.push(dir);
  return dir;
}

describe('telemetry', () => {
  it('counts into the platform and the tenant, and writes on flush', async () => {
    const ledger = new MemoryOpsLedger();
    const t = createTelemetry({ ledger, now: () => NOW, flushMs: 0 });
    t.count('turns', 1, { tenantId: 't_a', dim: 'chat' });
    t.count('turns', 2, { tenantId: 't_a', dim: 'chat' });
    t.count('rate_limited', 1, { dim: 'chat' });
    expect(await ledger.days(TODAY, TODAY)).toEqual([]);

    await t.flush();
    const days = await ledger.days(TODAY, TODAY);
    const platform = days.find((d) => d.tenantId === null)!;
    const tenant = days.find((d) => d.tenantId === 't_a')!;
    expect(platform.counts).toEqual({ 'turns@chat': 3, 'rate_limited@chat': 1 });
    expect(tenant.counts).toEqual({ 'turns@chat': 3 });

    // A second flush adds rather than replaces.
    t.count('turns', 1, { tenantId: 't_a', dim: 'chat' });
    await t.flush();
    const again = await ledger.days(TODAY, TODAY);
    expect(again.find((d) => d.tenantId === 't_a')!.counts['turns@chat']).toBe(4);
  });

  it('folds repeated errors into one sampled record and redacts it', async () => {
    const ledger = new MemoryOpsLedger();
    const t = createTelemetry({ ledger, now: () => NOW, flushMs: 0 });
    for (let i = 0; i < 3; i++) {
      t.error({
        source: 'chat turn failed',
        code: 'ETIMEDOUT',
        message: 'reply to jo@example.com or +44 7700 900123 failed',
        tenantId: 't_a',
      });
    }
    await t.flush();
    const [event] = await ledger.errors('2026-01-01', 10);
    expect(event).toMatchObject({ source: 'chat turn failed', code: 'ETIMEDOUT', count: 3 });
    expect(event!.message).toBe('reply to [email] or [number] failed');
    const platform = (await ledger.days(TODAY, TODAY)).find((d) => d.tenantId === null)!;
    expect(platform.counts['errors@chat turn failed']).toBe(3);
  });

  it('keeps counts it could not write, for the next flush', async () => {
    const real = new MemoryOpsLedger();
    let fail = true;
    const flaky: OpsLedger = {
      add: (days) => (fail ? Promise.reject(new Error('down')) : real.add(days)),
      appendErrors: (e) => real.appendErrors(e),
      days: (a, b) => real.days(a, b),
      errors: (a, b) => real.errors(a, b),
    };
    const failures: unknown[] = [];
    const t = createTelemetry({
      ledger: flaky,
      now: () => NOW,
      flushMs: 0,
      onFailure: (e) => failures.push(e),
    });
    t.count('leads', 2, { tenantId: 't_a' });
    await t.flush();
    expect(failures).toHaveLength(1);
    fail = false;
    t.count('leads', 1, { tenantId: 't_a' });
    await t.flush();
    const tenant = (await real.days(TODAY, TODAY)).find((d) => d.tenantId === 't_a')!;
    expect(tenant.counts['leads']).toBe(3);
  });

  it('reads percentiles back from histogram buckets', () => {
    expect(bucketOf(90)).toBe(0);
    expect(bucketOf(100)).toBe(0);
    expect(bucketOf(101)).toBe(1);
    expect(bucketOf(99_999)).toBe(9);
    const counts = { 'ttfb_ms#0': 50, 'ttfb_ms#3': 45, 'ttfb_ms#9': 5 };
    expect(timingPercentile(counts, 'ttfb_ms', 0.5)).toBe(100);
    expect(timingPercentile(counts, 'ttfb_ms', 0.95)).toBe(1000);
    expect(timingPercentile(counts, 'ttfb_ms', 0.99)).toBe(Infinity);
    expect(timingPercentile({}, 'ttfb_ms', 0.5)).toBeNull();
  });

  it('redacts emails and phone numbers and caps the length', () => {
    expect(redact('a@b.co said hi')).toBe('[email] said hi');
    expect(redact('x'.repeat(400))).toHaveLength(300);
  });

  it('copies error log lines and counts rate limit warnings', async () => {
    const ledger = new MemoryOpsLedger();
    const t = createTelemetry({ ledger, now: () => NOW, flushMs: 0 });
    const hooks = loggerHooks(t);
    const written: unknown[][] = [];
    const method = (...args: unknown[]) => void written.push(args);
    const logger = { bindings: () => ({ reqId: 'req-1' }) };
    hooks.logMethod.call(logger, [{ err: new Error('boom') }, 'unhandled error'], method, 50);
    hooks.logMethod.call(logger, [{ scope: 'chat' }, 'rate limit exceeded'], method, 40);
    hooks.logMethod.call(logger, ['just info'], method, 30);
    expect(written).toHaveLength(3);
    await t.flush();
    const [event] = await ledger.errors('2026-01-01', 10);
    expect(event).toMatchObject({ source: 'unhandled error', code: 'Error', requestId: 'req-1' });
    const platform = (await ledger.days(TODAY, TODAY)).find((d) => d.tenantId === null)!;
    expect(platform.counts).toMatchObject({ 'errors@unhandled error': 1, 'rate_limited@chat': 1 });
  });
});

describe('the instrumented store', () => {
  it('counts turns, tokens and leads written through it, and stays the same store', async () => {
    const ledger = new MemoryOpsLedger();
    const t = createTelemetry({ ledger, now: () => NOW, flushMs: 0 });
    const real = new FileStore(await tempDir());
    const store = instrumentStore(real, t);
    expect(store instanceof FileStore).toBe(true);

    const at = new Date(NOW).toISOString();
    await store.appendTurn('t_a', 's_1', { role: 'user', text: 'hi', at, channel: 'email' });
    await store.appendTurn('t_a', 's_1', {
      role: 'assistant',
      text: 'hello',
      at,
      channel: 'email',
      call: {
        model: 'gemini-3.8-flash',
        provider: 'gemini',
        ttfbMs: 400,
        totalMs: 1500,
        usage: { inputTokens: 1200, outputTokens: 80 },
      },
    });
    await t.flush();
    const tenant = (await ledger.days(TODAY, TODAY)).find((d) => d.tenantId === 't_a')!;
    expect(tenant.counts).toEqual({
      'messages@email': 1,
      'turns@email': 1,
      'model_calls@gemini-3.8-flash': 1,
      'tokens_in@gemini-3.8-flash': 1200,
      'tokens_out@gemini-3.8-flash': 80,
      'ttfb_ms#2': 1,
      'turn_ms#4': 1,
    });
    // And the write really happened.
    expect((await real.getConversation('t_a', 's_1'))?.turns).toHaveLength(2);
  });
});

describe('the file ledger', () => {
  it('sums counters across writes and returns errors newest first', async () => {
    const ledger = new FileOpsLedger(await tempDir());
    await ledger.add([{ day: TODAY, tenantId: null, counts: { turns: 1 } }]);
    await ledger.add([{ day: TODAY, tenantId: null, counts: { turns: 2 } }]);
    expect(await ledger.days(TODAY, TODAY)).toEqual([
      { day: TODAY, tenantId: null, counts: { turns: 3 } },
    ]);
    const base = {
      source: 's',
      code: 'c',
      message: 'm',
      tenantId: null,
      requestId: null,
      count: 1,
    };
    await ledger.appendErrors([
      { ...base, id: 'a', at: '2026-10-10T00:00:00.000Z' },
      { ...base, id: 'b', at: '2026-10-12T00:00:00.000Z' },
    ]);
    expect((await ledger.errors('2026-10-11', 10)).map((e) => e.id)).toEqual(['b']);
  });
});

function day(dayKey: string, tenantId: string | null, counts: Record<string, number>): OpsDay {
  return { day: dayKey, tenantId, counts };
}

describe('the reports', () => {
  it('fills every calendar day, quiet ones included', () => {
    const report = usageReport(
      [day(TODAY, null, { 'turns@chat': 4 }), day(TODAY, 't_a', { 'turns@chat': 4 })],
      NOW,
      7,
    );
    expect(report.series).toHaveLength(7);
    expect(report.range).toEqual({ from: '2026-10-06', to: TODAY, days: 7 });
    expect(report.series[6]).toMatchObject({ day: TODAY, turns: 4, activeTenants: 1 });
    expect(report.series[0]).toMatchObject({ turns: 0, activeTenants: 0 });
  });

  it('lists every installer, busiest first, with its flags', () => {
    const quiet: Tenant = {
      ...DEMO_TENANT,
      id: 't_quiet',
      config: { ...DEMO_TENANT.config, companyName: 'Quiet Solar' },
      billing: {
        status: 'past_due',
        subscriptionId: 'sub_1',
        graceUntil: '2026-10-01T00:00:00.000Z',
        lastEventAt: null,
      },
    };
    const rows = tenantRows(
      [quiet, DEMO_TENANT],
      [day(TODAY, DEMO_TENANT.id, { 'turns@chat': 3 })],
      NOW,
      30,
    );
    expect(rows.map((r) => r.id)).toEqual([DEMO_TENANT.id, 't_quiet']);
    expect(rows[0]).toMatchObject({ turns: 3, lastActiveDay: TODAY });
    expect(rows[1]!.flags).toContain('grace_ended');
  });

  it('raises an error spike against the week before, not a fixed number', () => {
    const week = ['06', '07', '08', '09', '10', '11'].map((d) =>
      day(`2026-10-${d}`, null, { 'errors@unhandled error': 5 }),
    );
    const calm = detectIssues({
      rows: [...week, day(TODAY, null, { 'errors@x': 9 })],
      tenants: [],
      now: NOW,
    });
    expect(calm.map((i) => i.code)).not.toContain('errors_spike');
    const spike = detectIssues({
      rows: [...week, day(TODAY, null, { 'errors@x': 40 })],
      tenants: [],
      now: NOW,
    });
    expect(spike.map((i) => i.code)).toContain('errors_spike');
  });

  it('notices a silent day only when traffic is normally there', () => {
    const busy = ['05', '06', '07', '08', '09', '10', '11'].map((d) =>
      day(`2026-10-${d}`, null, { 'turns@chat': 100 }),
    );
    expect(detectIssues({ rows: busy, tenants: [], now: NOW })[0]).toMatchObject({
      code: 'no_traffic',
      severity: 'critical',
    });
    expect(detectIssues({ rows: [], tenants: [], now: NOW })).toEqual([]);
  });
});

describe('the staff allowlist', () => {
  it('parses, lowercases and refuses a malformed entry', () => {
    expect(parseStaffEmails(' A@Sunny.test , b@sunny.test,')).toEqual([
      'a@sunny.test',
      'b@sunny.test',
    ]);
    expect(parseStaffEmails(null)).toEqual([]);
    expect(() => parseStaffEmails('not-an-email')).toThrow(/SUNNY_STAFF_EMAILS/);
  });
});

describe('the admin routes', () => {
  async function setup() {
    const dir = await tempDir();
    const store = new FileStore(dir);
    const ledger = new MemoryOpsLedger();
    const app = buildServer({
      config: {
        port: 0,
        host: '127.0.0.1',
        nodeEnv: 'test',
        gemini: undefined,
        dataDir: dir,
        allowedOrigins: [],
        sessionSecret: SECRET,
        adminToken: null,
        logLevel: 'silent',
        sandboxTenant: false,
        leadRetentionDays: 730,
        rateLimit: { enabled: false, trustProxyHops: 0, rules: {}, maxKeys: 10 },
      } as unknown as ServerConfig,
      store,
      tenants: new TenantRegistry([DEMO_TENANT]),
      now: () => NOW,
      portal: { ...loadPortalConfig({}, 'test'), devAuth: true, staffEmails: [STAFF] },
      opsLedger: ledger,
    });
    await app.ready();
    return { app, store, ledger };
  }
  const as = (email: string) => ({
    authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}`,
  });

  it('serves staff the platform figures and tells /me who is staff', async () => {
    const { app, ledger } = await setup();
    await ledger.add([
      day(TODAY, null, { 'turns@chat': 5, leads: 1 }),
      day(TODAY, DEMO_TENANT.id, { 'turns@chat': 5, leads: 1 }),
    ]);

    const overview = await app.inject({
      method: 'GET',
      url: '/v1/admin/overview',
      headers: as(STAFF),
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      kpis: { turnsToday: 5, leads7d: 1, activeTenants7d: 1, tenants: 1 },
    });

    const usage = await app.inject({
      method: 'GET',
      url: '/v1/admin/usage?days=90',
      headers: as(STAFF),
    });
    expect(usage.json<{ series: unknown[] }>().series).toHaveLength(90);
    const bad = await app.inject({
      method: 'GET',
      url: '/v1/admin/usage?days=12',
      headers: as(STAFF),
    });
    expect(bad.statusCode).toBe(400);

    const me = await app.inject({ method: 'GET', url: '/v1/portal/me', headers: as(STAFF) });
    expect(me.json()).toMatchObject({ staff: true });
    const notMe = await app.inject({
      method: 'GET',
      url: '/v1/portal/me',
      headers: as('x@y.test'),
    });
    expect(notMe.json()).toMatchObject({ staff: false });
    await app.close();
  });

  it('records which staff member opened an installer, by their sign-in uid', async () => {
    const { app, store } = await setup();
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/admin/tenants/${DEMO_TENANT.id}`,
      headers: as(STAFF),
    });
    expect(detail.statusCode).toBe(200);
    const [event] = await store.listAuditEvents(DEMO_TENANT.id);
    expect(event).toMatchObject({ action: 'ops.tenant.read', actor: { kind: 'staff' } });
    // Dev sign-in's uid is `dev:<email>`; a Firebase uid is opaque. Either way
    // it is the uid the session carries, not a field the route made up.
    expect(event!.actor.id).toBe(`dev:${STAFF}`);
    await app.close();
  });
});

describe('the outside sources', () => {
  const config = {
    project: 'sunny-test',
    runServices: ['sunny-api-test'],
    billingTable: 'sunny-test.billing.gcp_billing_export_v1_X',
    monthlyBudget: 100,
    postmark: { serverToken: 'pm', pricePer1k: 1.25 },
    stripeSecretKey: 'sk_test',
    stripePrices: { base: 'price_base' },
  };
  const token = () => Promise.resolve('access');
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const row = (...v: string[]) => ({ f: v.map((x) => ({ v: x })) });

  it('reads the billing export into month, forecast and service totals', async () => {
    const queries: string[] = [];
    const fake: typeof fetch = (_url, init) => {
      const sql = (JSON.parse(init?.body as string) as { query: string }).query;
      queries.push(sql);
      if (sql.includes('invoice.month IN')) {
        return json({
          jobComplete: true,
          rows: [row('202610', 'Vertex AI', '30', 'GBP'), row('202609', 'Vertex AI', '50', 'GBP')],
        });
      }
      if (sql.includes('LIMIT 15')) {
        return json({ jobComplete: true, rows: [row('Vertex AI', 'Gemini input', '20')] });
      }
      return json({
        jobComplete: true,
        rows: [row('2026-10-10', 'Vertex AI', '10'), row('2026-10-11', 'Vertex AI', '20')],
      });
    };
    const result = await createBillingSource({ config, token, fetch: fake, now: () => NOW })();
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.data).toMatchObject({
      currency: 'GBP',
      month: '2026-10',
      monthToDate: 30,
      lastMonth: 50,
      // 30 over the 2 days the export has reached, times 31 days.
      forecast: 465,
      lastDay: '2026-10-11',
    });
    // Scoped to this project, so a billing account shared with staging cannot leak in.
    expect(queries.every((q) => q.includes('project.id = @project'))).toBe(true);
  });

  it('says why rather than throwing, and retries a failure next time', async () => {
    let calls = 0;
    const down: typeof fetch = () => {
      calls += 1;
      return json({ message: 'Authenticate' }, 401);
    };
    const read = createPostmarkSource({ config, fetch: down, now: () => NOW });
    expect(await read()).toEqual({
      available: false,
      reason: 'Postmark refused the request: Authenticate',
    });
    await read();
    // One request per read, read twice: the failure was not cached.
    expect(calls).toBe(2);
  });

  it('turns Stripe subscriptions into monthly revenue by plan', async () => {
    const sub = (
      status: string,
      amount: number,
      interval: 'month' | 'year',
      id = 'price_base',
    ) => ({
      id: `sub_${status}_${amount}`,
      status,
      canceled_at: status === 'canceled' ? NOW / 1000 : null,
      items: {
        data: [
          {
            quantity: 1,
            price: {
              id,
              currency: 'gbp',
              unit_amount: amount,
              recurring: { interval, interval_count: 1 },
            },
          },
        ],
      },
    });
    const fake: typeof fetch = () =>
      json({
        has_more: false,
        data: [
          sub('active', 19900, 'month'),
          sub('past_due', 120000, 'year', 'price_x'),
          sub('canceled', 19900, 'month'),
          sub('trialing', 19900, 'month'),
        ],
      });
    const result = await createStripeSource({ config, fetch: fake, now: () => NOW })();
    expect(result.available && result.data).toMatchObject({
      currency: 'GBP',
      mrr: 299,
      active: 1,
      pastDue: 1,
      trialing: 1,
      canceledThisMonth: 1,
      byPlan: [
        { plan: 'base', subscriptions: 1, mrr: 199 },
        { plan: 'other', subscriptions: 1, mrr: 100 },
      ],
    });
  });

  it('prices Postmark sends from the configured plan rate', async () => {
    const fake: typeof fetch = () => json({ Sent: 4000, Bounced: 3, SpamComplaints: 0 });
    const result = await createPostmarkSource({ config, fetch: fake, now: () => NOW })();
    expect(result.available && result.data).toEqual({
      sent: 4000,
      bounced: 3,
      spamComplaints: 0,
      costFromPlanRate: 5,
    });
  });

  it('places Cloud Monitoring points on the hour grid and raises issues from them', async () => {
    const hours = hourStarts(NOW, 24);
    const end = (h: string) => new Date(Date.parse(h) + 3_600_000).toISOString();
    const service = { resource: { labels: { service_name: 'sunny-api-test' } } };
    const at = (hour: string, value: object) => [{ interval: { endTime: end(hour) }, value }];
    const fake: typeof fetch = (url) => {
      const filter = new URL(url as string).searchParams.get('filter') ?? '';
      if (filter.includes('uptime_check')) {
        return json({
          timeSeries: [
            {
              metric: { labels: { check_id: 'api-up' } },
              points: at(hours[23]!, { doubleValue: 0.5 }),
            },
          ],
        });
      }
      if (filter.includes('5xx')) {
        return json({ timeSeries: [{ ...service, points: at(hours[22]!, { int64Value: '9' }) }] });
      }
      if (filter.includes('request_count') && filter.includes('cloud_run')) {
        return json({
          timeSeries: [{ ...service, points: at(hours[22]!, { int64Value: '100' }) }],
        });
      }
      return json({});
    };
    const result = await createMonitoringSource({ config, token, fetch: fake, now: () => NOW })();
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.data.services[0]!.requests[22]).toBe(100);
    expect(result.data.services[0]!.errors5xx[22]).toBe(9);
    expect(result.data.uptime).toEqual([{ name: 'api-up', passing: false }]);

    const issues = sourceIssues({
      monitoring: result.data,
      billing: null,
      monthlyBudget: null,
      unavailable: [],
    });
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ['error_rate:sunny-api-test', 'critical'],
      ['uptime:api-up', 'critical'],
    ]);
  });

  it('warns before the budget is spent, and again once it is', () => {
    const billing = { currency: 'GBP', monthToDate: 80, forecast: 160, daily: [] };
    const ahead = sourceIssues({ monitoring: null, billing, monthlyBudget: 100, unavailable: [] });
    expect(ahead.map((i) => i.code)).toEqual(['forecast_over_budget']);
    const over = sourceIssues({
      monitoring: null,
      billing: { ...billing, monthToDate: 120 },
      monthlyBudget: 100,
      unavailable: [],
    });
    expect(over.map((i) => [i.code, i.severity])).toEqual([['over_budget', 'critical']]);
  });

  it('refuses a billing table name that is not a table id', () => {
    expect(() =>
      loadOpsConfig({ OPS_BILLING_TABLE: 'x`; DROP' }, { secretKey: null, prices: {} }),
    ).toThrow(/OPS_BILLING_TABLE/);
  });
});
