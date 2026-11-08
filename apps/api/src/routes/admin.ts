import { ApiError, type DashboardUsage } from '@sunny/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Auditor } from '../audit.js';
import { createAuthenticator, type VerifiedIdentity } from '../auth/index.js';
import { lastDays, type OpsDay, type OpsErrorEvent, type OpsLedger } from '../ops/ledger.js';
import {
  daysInMonth,
  monthKeys,
  type BillingSnapshot,
  type MonitoringSnapshot,
  type OpsSources,
  type PostmarkSnapshot,
  type RevenueSnapshot,
  type Source,
} from '../ops/sources.js';
import {
  detectIssues,
  sourceIssues,
  sortIssues,
  tenantRows,
  tenantSeries,
  usageReport,
  type Issue,
  type TenantRow,
  type UsagePoint,
  type UsageReport,
  type UsageTotals,
} from '../ops/report.js';
import { counterByDimension, counterTotal } from '../ops/telemetry.js';
import type { Store } from '../store.js';
import type { TenantRegistry } from '../tenants.js';
import { summariseUsage } from '../usage.js';
import type { PortalConfig } from './portal-config.js';

/**
 * The staff dashboard's API: how the whole platform is doing, for Sunny's own
 * developers (`/admin` on the website).
 *
 * ## Who may read it
 *
 * A signed-in person whose verified email is in `SUNNY_STAFF_EMAILS`, checked
 * on every request against the same session the installer portal uses. Anyone
 * else signed in is told `not_found` -- the same answer as a route that does
 * not exist, so the dashboard cannot be discovered by probing it -- and anyone
 * not signed in is told `unauthorized`, as every portal route does.
 *
 * Not the admin token. That token is a deployment-wide secret meant for
 * scripts, and the reason no UI was ever built over it is that it would have
 * to live in a browser. Staff sign in as themselves, so the audit trail can say
 * which of them looked.
 *
 * ## Read-only
 *
 * Every route here is a GET. The dashboard shows what is wrong; fixing it is
 * done with the tools that already have their own checks (the portal, the
 * Cloud Console, Stripe), not with a second, more powerful path into them.
 */

export interface AdminDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
  ledger: OpsLedger;
  /** Cloud Monitoring, the billing export and the providers (ops/sources.ts). */
  sources: OpsSources;
  auditor: Auditor;
  fetch?: typeof fetch;
}

const daysSchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((n) => [7, 30, 90].includes(n), 'must be 7, 30 or 90')
    .optional(),
});

export interface AdminOverview {
  generatedAt: string;
  issues: Issue[];
  kpis: {
    tenants: number;
    payingTenants: number;
    activeTenants7d: number;
    turnsToday: number;
    turns7d: number;
    leads7d: number;
    errorsToday: number;
    /** Model time-to-first-chunk p95 over 7 days, ms (a bucket bound), or null. */
    ttfbP95: number | null;
  };
  /** The last 7 days, for sparklines. */
  week: UsagePoint[];
  health: HealthSummary;
  costs: CostSummary;
}

export interface HealthSummary {
  available: boolean;
  reason?: string;
  requests24h: number;
  /** 5xx share of the last 24 hours' requests, or null with none. */
  errorRate24h: number | null;
  /** The busiest service's request p95 in the last full hour, ms. */
  p95LastHourMs: number | null;
  uptimePassing: number;
  uptimeChecks: number;
}

export interface CostSummary {
  available: boolean;
  reason?: string;
  currency: string | null;
  monthToDate: number | null;
  forecast: number | null;
  budget: number | null;
  mrr: number | null;
  mrrCurrency: string | null;
}

export interface AdminHealth {
  monitoring: Source<MonitoringSnapshot>;
  /** Error-level log lines over 7 days, by what was being done. */
  errorsBySource: Record<string, number>;
  /** The in-app limiter's refusals over 7 days, by scope. */
  rateLimited: Record<string, number>;
  /** Distinct errors over 7 days, most frequent first. */
  topErrors: Array<{ source: string; code: string; count: number; lastAt: string; sample: string }>;
}

export interface TenantCost {
  tenantId: string;
  companyName: string;
  tokens: number;
  /** This tenant's share of the month's Vertex AI spend, by tokens. */
  model: number | null;
}

export interface AdminCosts {
  month: string;
  budget: number | null;
  gcp: Source<BillingSnapshot>;
  postmark: Source<PostmarkSnapshot>;
  stripe: Source<RevenueSnapshot>;
  /** Apportioned, not billed: actual spend split by each installer's usage. */
  perTenant: { modelCurrency: string | null; rows: TenantCost[] };
  /**
   * Revenue against the month's forecast cost, when every figure is in one
   * currency. Null with the reason otherwise; converting would need a rate
   * this file does not have.
   */
  margin:
    | { currency: string; revenue: number; cost: number; margin: number; included: string[] }
    | { currency: null; reason: string };
}

export interface AdminTenantDetail {
  tenant: TenantRow & {
    publicId: string;
    domains: readonly string[];
    sync: Record<string, { status: string; at: string; error: string | null }>;
    members: Record<string, number>;
  };
  series: UsagePoint[];
  totals: UsageTotals;
  /** Exact per-model latency from this installer's own turns (30 days). */
  models: DashboardUsage;
  errors: OpsErrorEvent[];
}

/** Ledger reads are shared by the pages for this long. */
const CACHE_MS = 30_000;

export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const { store, tenants, portal, now, ledger, auditor, sources } = deps;
  const staff = new Set((portal.staffEmails ?? []).map((e) => e.toLowerCase()));
  const auth = createAuthenticator({
    portal,
    sessionSecret: deps.sessionSecret,
    now,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    store,
  });

  /** Signed in, and on the staff list -- or the same 404 as no such route. */
  async function requireStaff(request: FastifyRequest): Promise<VerifiedIdentity> {
    const identity = await auth.identify(request.headers.authorization);
    const email = identity.email?.toLowerCase();
    if (!email || !staff.has(email)) throw new ApiError('not_found', 'Not found.');
    return identity;
  }

  let cached: { at: number; key: string; rows: Promise<OpsDay[]> } | null = null;
  /** The last 90 days of counters, every scope. The pages slice what they need. */
  function rows(): Promise<OpsDay[]> {
    const t = now();
    const days = lastDays(t, 90);
    const key = `${days[0]}..${days[89]}`;
    if (!cached || cached.key !== key || t - cached.at > CACHE_MS) {
      const read = ledger.days(days[0]!, days[89]!);
      cached = { at: t, key, rows: read };
      // A failed read is not cached: the next request tries again.
      read.catch(() => {
        if (cached?.rows === read) cached = null;
      });
    }
    return cached.rows;
  }

  function parseDays(query: unknown, fallback: number): number {
    const parsed = daysSchema.safeParse(query);
    if (!parsed.success) throw new ApiError('bad_request', 'days must be 7, 30 or 90.');
    return parsed.data.days ?? fallback;
  }

  app.get('/v1/admin/overview', async (request): Promise<AdminOverview> => {
    await requireStaff(request);
    const t = now();
    const all = await rows();
    const week = usageReport(all, t, 7);
    const today = week.series[week.series.length - 1]!;
    const list = tenants.all;
    const active = new Set(
      all
        .filter(
          (r) =>
            r.tenantId !== null && r.day >= week.range.from && counterTotal(r.counts, 'turns') > 0,
        )
        .map((r) => r.tenantId),
    );
    const [monitoring, billing, stripe] = await Promise.all([
      sources.monitoring(),
      sources.billing(),
      sources.stripe(),
    ]);
    return {
      generatedAt: new Date(t).toISOString(),
      issues: sortIssues([
        ...detectIssues({ rows: all, tenants: list, now: t }),
        ...sourceIssues(sourceView(monitoring, billing, sources.monthlyBudget)),
      ]),
      kpis: {
        tenants: list.length,
        payingTenants: list.filter((x) => x.billing?.status === 'active').length,
        activeTenants7d: active.size,
        turnsToday: today.turns,
        turns7d: week.totals.turns,
        leads7d: week.totals.leads,
        errorsToday: today.errors,
        ttfbP95: week.totals.latency.ttfbP95,
      },
      week: week.series,
      health: healthSummary(monitoring),
      costs: {
        available: billing.available,
        ...(billing.available ? {} : { reason: billing.reason }),
        currency: billing.available ? billing.data.currency : null,
        monthToDate: billing.available ? billing.data.monthToDate : null,
        forecast: billing.available ? billing.data.forecast : null,
        budget: sources.monthlyBudget,
        mrr: stripe.available ? stripe.data.mrr : null,
        mrrCurrency: stripe.available ? stripe.data.currency : null,
      },
    };
  });

  app.get('/v1/admin/health', async (request): Promise<AdminHealth> => {
    await requireStaff(request);
    const t = now();
    const all = await rows();
    const from = lastDays(t, 7)[0]!;
    const counts: Record<string, number> = {};
    for (const r of all) {
      if (r.tenantId !== null || r.day < from) continue;
      for (const [k, n] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + n;
    }
    const [monitoring, errors] = await Promise.all([
      sources.monitoring(),
      ledger.errors(`${from}T00:00:00.000Z`, 500),
    ]);
    const grouped = new Map<string, AdminHealth['topErrors'][number]>();
    for (const e of errors) {
      const key = `${e.source}|${e.code}`;
      const row = grouped.get(key);
      if (row) {
        row.count += e.count;
        if (e.at > row.lastAt) row.lastAt = e.at;
      } else {
        grouped.set(key, {
          source: e.source,
          code: e.code,
          count: e.count,
          lastAt: e.at,
          sample: e.message,
        });
      }
    }
    return {
      monitoring,
      errorsBySource: counterByDimension(counts, 'errors'),
      rateLimited: counterByDimension(counts, 'rate_limited'),
      topErrors: [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 25),
    };
  });

  app.get('/v1/admin/costs', async (request): Promise<AdminCosts> => {
    await requireStaff(request);
    const t = now();
    const [gcp, postmark, stripe, all] = await Promise.all([
      sources.billing(),
      sources.postmark(),
      sources.stripe(),
      rows(),
    ]);
    return {
      month: monthKeys(t).iso,
      budget: sources.monthlyBudget,
      gcp,
      postmark,
      stripe,
      perTenant: apportion(all, t, gcp),
      margin: margin(t, gcp, postmark, stripe),
    };
  });

  /** Split the month's actual model spend across installers by their usage. */
  function apportion(
    all: OpsDay[],
    t: number,
    gcp: Source<BillingSnapshot>,
  ): AdminCosts['perTenant'] {
    const month = monthKeys(t).iso;
    const usage = new Map<string, number>();
    for (const r of all) {
      if (r.tenantId === null || !r.day.startsWith(month)) continue;
      usage.set(
        r.tenantId,
        (usage.get(r.tenantId) ?? 0) +
          counterTotal(r.counts, 'tokens_in') +
          counterTotal(r.counts, 'tokens_out'),
      );
    }
    const totalTokens = [...usage.values()].reduce((a, u) => a + u, 0);
    const modelSpend = gcp.available
      ? gcp.data.byService
          .filter((s) => /vertex ai|gemini|generative language/i.test(s.service))
          .reduce((a, s) => a + s.monthToDate, 0)
      : null;
    const share = (spend: number | null, part: number, whole: number) =>
      spend === null || whole === 0 ? null : Math.round((spend * part * 100) / whole) / 100;
    return {
      modelCurrency: gcp.available ? gcp.data.currency : null,
      rows: tenants.all
        .map((tenant) => {
          const tokens = usage.get(tenant.id) ?? 0;
          return {
            tenantId: tenant.id,
            companyName: tenant.config.companyName,
            tokens,
            model: share(modelSpend, tokens, totalTokens),
          };
        })
        .filter((r) => r.tokens > 0)
        .sort((a, b) => (b.model ?? 0) - (a.model ?? 0) || b.tokens - a.tokens),
    };
  }

  app.get('/v1/admin/usage', async (request): Promise<UsageReport> => {
    await requireStaff(request);
    return usageReport(await rows(), now(), parseDays(request.query, 30));
  });

  app.get('/v1/admin/tenants', async (request): Promise<{ days: number; tenants: TenantRow[] }> => {
    await requireStaff(request);
    const days = parseDays(request.query, 30);
    return { days, tenants: tenantRows(tenants.all, await rows(), now(), days) };
  });

  app.get('/v1/admin/tenants/:tenantId', async (request): Promise<AdminTenantDetail> => {
    const identity = await requireStaff(request);
    const { tenantId } = request.params as { tenantId: string };
    const tenant = tenants.byId(tenantId);
    if (!tenant) throw new ApiError('not_found', 'No such installer.');
    const t = now();
    const all = await rows();
    const [row] = tenantRows([tenant], all, t, 30);
    const from = t - 30 * 24 * 60 * 60 * 1000;
    const [conversations, members, errors] = await Promise.all([
      store.listConversations(tenantId),
      store.listMembers(tenantId),
      ledger.errors(new Date(from).toISOString(), 500),
    ]);
    const calls = conversations.flatMap((c) =>
      c.turns.flatMap((turn) => {
        const at = Date.parse(turn.at);
        return turn.call && at >= from && at <= t ? [turn.call] : [];
      }),
    );
    const roles: Record<string, number> = {};
    for (const m of members) roles[m.role] = (roles[m.role] ?? 0) + 1;

    await auditor.record({
      tenantId,
      actor: 'staff',
      actorId: identity.uid,
      action: 'ops.tenant.read',
      target: { kind: 'tenant', id: null },
      outcome: 'permitted',
      requestId: request.id,
    });

    return {
      tenant: {
        ...row!,
        publicId: tenant.publicId,
        domains: tenant.domains ?? [],
        sync: Object.fromEntries(
          Object.entries(tenant.sync ?? {}).map(([kind, s]) => [
            kind,
            { status: s.status, at: s.at, error: s.error },
          ]),
        ),
        members: roles,
      },
      ...tenantSeries(all, tenantId, t, 30),
      models: summariseUsage(calls),
      errors: errors.filter((e) => e.tenantId === tenantId).slice(0, 50),
    };
  });

  app.get(
    '/v1/admin/errors',
    async (
      request,
    ): Promise<{ since: string; project: string | null; errors: OpsErrorEvent[] }> => {
      await requireStaff(request);
      const days = parseDays(request.query, 7);
      const since = `${lastDays(now(), days)[0]}T00:00:00.000Z`;
      return { since, project: sources.project, errors: await ledger.errors(since, 500) };
    },
  );
}

/** Whether `email` may open the staff dashboard. For `/v1/portal/me`. */
export function isStaff(portal: PortalConfig, email: string | null | undefined): boolean {
  if (!email) return false;
  return (portal.staffEmails ?? []).some((e) => e.toLowerCase() === email.toLowerCase());
}

function sourceView(
  monitoring: Source<MonitoringSnapshot>,
  billing: Source<BillingSnapshot>,
  monthlyBudget: number | null,
): Parameters<typeof sourceIssues>[0] {
  // Only the two sources every deployment is expected to have. Postmark and
  // Stripe say on the Costs page when they are not connected; an add-on a
  // deployment does not sell is not an issue.
  const unavailable: Array<{ source: string; reason: string }> = [];
  if (!monitoring.available) {
    unavailable.push({ source: 'Cloud Monitoring', reason: monitoring.reason });
  }
  if (!billing.available) {
    unavailable.push({ source: 'Google Cloud billing', reason: billing.reason });
  }
  return {
    monitoring: monitoring.available ? monitoring.data : null,
    billing: billing.available ? billing.data : null,
    monthlyBudget,
    unavailable,
  };
}

export function healthSummary(monitoring: Source<MonitoringSnapshot>): HealthSummary {
  if (!monitoring.available) {
    return {
      available: false,
      reason: monitoring.reason,
      requests24h: 0,
      errorRate24h: null,
      p95LastHourMs: null,
      uptimePassing: 0,
      uptimeChecks: 0,
    };
  }
  const { services, uptime } = monitoring.data;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const requests = sum(services.map((s) => sum(s.requests)));
  const errors = sum(services.map((s) => sum(s.errors5xx)));
  const busiest = [...services].sort((a, b) => sum(b.requests) - sum(a.requests))[0];
  return {
    available: true,
    requests24h: requests,
    errorRate24h: requests === 0 ? null : errors / requests,
    p95LastHourMs: busiest?.p95Ms[busiest.p95Ms.length - 2] ?? null,
    uptimePassing: uptime.filter((u) => u.passing === true).length,
    uptimeChecks: uptime.length,
  };
}

/**
 * The month's revenue against its forecast cost. Each provider's month so far is
 * run forward by the share of the month elapsed; GCP's forecast already is.
 */
export function margin(
  t: number,
  gcp: Source<BillingSnapshot>,
  postmark: Source<PostmarkSnapshot>,
  stripe: Source<RevenueSnapshot>,
): AdminCosts['margin'] {
  if (!stripe.available) {
    return { currency: null, reason: `Revenue is unavailable: ${stripe.reason}` };
  }
  if (!gcp.available) {
    return { currency: null, reason: `Google Cloud spend is unavailable: ${gcp.reason}` };
  }
  const currency = stripe.data.currency;
  const elapsed = new Date(t).getUTCDate() / daysInMonth(t);
  const parts: Array<{ name: string; currency: string; cost: number }> = [
    { name: 'Google Cloud', currency: gcp.data.currency, cost: gcp.data.forecast },
  ];
  if (postmark.available && postmark.data.costFromPlanRate !== null) {
    // The plan rate is configured in the revenue currency (OPS_POSTMARK_PRICE_PER_1K).
    parts.push({ name: 'Postmark', currency, cost: postmark.data.costFromPlanRate / elapsed });
  }
  const foreign = parts.filter((p) => p.currency !== currency);
  if (foreign.length > 0) {
    return {
      currency: null,
      reason: `Revenue is in ${currency} but ${foreign
        .map((p) => `${p.name} bills in ${p.currency}`)
        .join(', ')}.`,
    };
  }
  const cost = Math.round(parts.reduce((a, p) => a + p.cost, 0) * 100) / 100;
  return {
    currency,
    revenue: stripe.data.mrr,
    cost,
    margin: Math.round((stripe.data.mrr - cost) * 100) / 100,
    included: parts.map((p) => p.name),
  };
}
