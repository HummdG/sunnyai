import { ADDON_KEYS, hasEntitlement, type AddonKey } from '../entitlements.js';
import type { Tenant } from '../tenants.js';
import { lastDays, mergeCounts, type OpsDay } from './ledger.js';
import {
  counterByDimension,
  counterTotal,
  TIMING_BOUNDS_MS,
  timingPercentile,
} from './telemetry.js';

/**
 * The staff dashboard's figures, computed from the daily counters.
 *
 * Pure functions of their inputs, so every number the dashboard shows is one a
 * test can pin without a server, a clock or a store.
 */

export interface UsagePoint {
  day: string;
  turns: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  leads: number;
  voiceMinutes: number;
  errors: number;
  ingestFailed: number;
  sunscanFailed: number;
  rateLimited: number;
  /** Installers with at least one assistant turn that day. */
  activeTenants: number;
}

export interface ModelRow {
  model: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * What a latency past the last bucket is sent as. JSON has no `Infinity` (it
 * would arrive as null, which means "nothing measured"), so it is one past the
 * last bound, and the dashboard reads anything above that bound as "over".
 */
export const OVER_LAST_BUCKET_MS = TIMING_BOUNDS_MS[TIMING_BOUNDS_MS.length - 1]! + 1;

function sendable(ms: number | null): number | null {
  return ms === Infinity ? OVER_LAST_BUCKET_MS : ms;
}

export interface LatencySummary {
  /** Bucket bounds in ms (see `TIMING_BOUNDS_MS`); null when nothing was measured. */
  ttfbP50: number | null;
  ttfbP95: number | null;
  turnP50: number | null;
  turnP95: number | null;
}

export interface UsageTotals {
  turns: number;
  turnsByChannel: Record<string, number>;
  messages: number;
  escalations: number;
  leads: number;
  voiceSessions: number;
  voiceMinutes: number;
  ingestOk: number;
  ingestFailed: number;
  sunscanOk: number;
  sunscanFailed: number;
  errors: number;
  errorsBySource: Record<string, number>;
  rateLimited: number;
  byModel: ModelRow[];
  latency: LatencySummary;
}

export interface UsageReport {
  range: { from: string; to: string; days: number };
  series: UsagePoint[];
  totals: UsageTotals;
}

/** The platform's counters for each day, an empty map for a day nothing was recorded. */
function platformByDay(rows: readonly OpsDay[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const row of rows) {
    if (row.tenantId !== null) continue;
    out.set(row.day, mergeCounts(out.get(row.day) ?? {}, row.counts));
  }
  return out;
}

function sumAll(maps: Iterable<Readonly<Record<string, number>>>): Record<string, number> {
  let out: Record<string, number> = {};
  for (const m of maps) out = mergeCounts(out, m);
  return out;
}

function minutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}

export function totalsOf(counts: Readonly<Record<string, number>>): UsageTotals {
  const calls = counterByDimension(counts, 'model_calls');
  const tokensIn = counterByDimension(counts, 'tokens_in');
  const tokensOut = counterByDimension(counts, 'tokens_out');
  const models = new Set([...Object.keys(calls), ...Object.keys(tokensIn)]);
  const byModel = [...models]
    .map((model) => ({
      model,
      calls: calls[model] ?? 0,
      tokensIn: tokensIn[model] ?? 0,
      tokensOut: tokensOut[model] ?? 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));
  return {
    turns: counterTotal(counts, 'turns'),
    turnsByChannel: counterByDimension(counts, 'turns'),
    messages: counterTotal(counts, 'messages'),
    escalations: counterTotal(counts, 'escalations'),
    leads: counterTotal(counts, 'leads'),
    voiceSessions: counterTotal(counts, 'voice_sessions'),
    voiceMinutes: minutes(counterTotal(counts, 'voice_seconds')),
    ingestOk: counterTotal(counts, 'ingest_ok'),
    ingestFailed: counterTotal(counts, 'ingest_failed'),
    sunscanOk: counterTotal(counts, 'sunscan_ok'),
    sunscanFailed: counterTotal(counts, 'sunscan_failed'),
    errors: counterTotal(counts, 'errors'),
    errorsBySource: counterByDimension(counts, 'errors'),
    rateLimited: counterTotal(counts, 'rate_limited'),
    byModel,
    latency: {
      ttfbP50: sendable(timingPercentile(counts, 'ttfb_ms', 0.5)),
      ttfbP95: sendable(timingPercentile(counts, 'ttfb_ms', 0.95)),
      turnP50: sendable(timingPercentile(counts, 'turn_ms', 0.5)),
      turnP95: sendable(timingPercentile(counts, 'turn_ms', 0.95)),
    },
  };
}

function pointOf(
  day: string,
  counts: Readonly<Record<string, number>>,
  activeTenants: number,
): UsagePoint {
  return {
    day,
    turns: counterTotal(counts, 'turns'),
    messages: counterTotal(counts, 'messages'),
    tokensIn: counterTotal(counts, 'tokens_in'),
    tokensOut: counterTotal(counts, 'tokens_out'),
    leads: counterTotal(counts, 'leads'),
    voiceMinutes: minutes(counterTotal(counts, 'voice_seconds')),
    errors: counterTotal(counts, 'errors'),
    ingestFailed: counterTotal(counts, 'ingest_failed'),
    sunscanFailed: counterTotal(counts, 'sunscan_failed'),
    rateLimited: counterTotal(counts, 'rate_limited'),
    activeTenants,
  };
}

/**
 * The platform's usage over the `days` days ending today, one point per day --
 * including the days nothing happened, so a chart's x axis is the calendar and
 * not the subset of it that had traffic.
 */
export function usageReport(rows: readonly OpsDay[], now: number, days: number): UsageReport {
  const calendar = lastDays(now, days);
  const platform = platformByDay(rows);
  const active = new Map<string, number>();
  for (const row of rows) {
    if (row.tenantId !== null && counterTotal(row.counts, 'turns') > 0) {
      active.set(row.day, (active.get(row.day) ?? 0) + 1);
    }
  }
  return {
    range: { from: calendar[0]!, to: calendar[calendar.length - 1]!, days },
    series: calendar.map((day) => pointOf(day, platform.get(day) ?? {}, active.get(day) ?? 0)),
    totals: totalsOf(sumAll(calendar.map((day) => platform.get(day) ?? {}))),
  };
}

/** One tenant's daily series, for the drill-down. */
export function tenantSeries(
  rows: readonly OpsDay[],
  tenantId: string,
  now: number,
  days: number,
): { series: UsagePoint[]; totals: UsageTotals } {
  const calendar = lastDays(now, days);
  const mine = new Map<string, Record<string, number>>();
  for (const row of rows) {
    if (row.tenantId === tenantId)
      mine.set(row.day, mergeCounts(mine.get(row.day) ?? {}, row.counts));
  }
  return {
    series: calendar.map((day) => {
      const counts = mine.get(day) ?? {};
      return pointOf(day, counts, counterTotal(counts, 'turns') > 0 ? 1 : 0);
    }),
    totals: totalsOf(sumAll(calendar.map((day) => mine.get(day) ?? {}))),
  };
}

// ── installers ──────────────────────────────────────────────────────────────

export interface TenantRow {
  id: string;
  companyName: string;
  createdAt: string | null;
  billingStatus: NonNullable<Tenant['billing']>['status'];
  graceUntil: string | null;
  /** Add-ons the tenant may use right now. */
  addons: AddonKey[];
  onboardingStep: string;
  turns: number;
  leads: number;
  tokens: number;
  voiceMinutes: number;
  errors: number;
  /** The last day in the window with an assistant turn, or null. */
  lastActiveDay: string | null;
  /** Short codes for what needs a look; see `tenantFlags`. */
  flags: string[];
}

export function tenantFlags(tenant: Tenant, now: number): string[] {
  const flags: string[] = [];
  const billing = tenant.billing;
  if (billing?.status === 'past_due') {
    const lapsed = billing.graceUntil !== null && Date.parse(billing.graceUntil) < now;
    flags.push(lapsed ? 'grace_ended' : 'past_due');
  }
  for (const kind of ['website', 'drive'] as const) {
    if (tenant.sync?.[kind]?.status === 'failed') flags.push(`${kind}_sync_failed`);
  }
  if ((tenant.onboarding?.step ?? 'live') !== 'live') flags.push('onboarding');
  return flags;
}

/** Every installer with its usage over the window, busiest first. */
export function tenantRows(
  tenants: readonly Tenant[],
  rows: readonly OpsDay[],
  now: number,
  days: number,
): TenantRow[] {
  const from = lastDays(now, days)[0]!;
  const byTenant = new Map<string, { counts: Record<string, number>; lastActive: string | null }>();
  for (const row of rows) {
    if (row.tenantId === null || row.day < from) continue;
    const entry = byTenant.get(row.tenantId) ?? { counts: {}, lastActive: null };
    entry.counts = mergeCounts(entry.counts, row.counts);
    if (counterTotal(row.counts, 'turns') > 0 && (entry.lastActive ?? '') < row.day) {
      entry.lastActive = row.day;
    }
    byTenant.set(row.tenantId, entry);
  }
  return tenants
    .map((tenant) => {
      const usage = byTenant.get(tenant.id) ?? { counts: {}, lastActive: null };
      const c = usage.counts;
      return {
        id: tenant.id,
        companyName: tenant.config.companyName,
        createdAt: tenant.createdAt ?? null,
        billingStatus: tenant.billing?.status ?? 'none',
        graceUntil: tenant.billing?.graceUntil ?? null,
        addons: ADDON_KEYS.filter((key) => hasEntitlement(tenant, key, now)),
        onboardingStep: tenant.onboarding?.step ?? 'live',
        turns: counterTotal(c, 'turns'),
        leads: counterTotal(c, 'leads'),
        tokens: counterTotal(c, 'tokens_in') + counterTotal(c, 'tokens_out'),
        voiceMinutes: minutes(counterTotal(c, 'voice_seconds')),
        errors: counterTotal(c, 'errors'),
        lastActiveDay: usage.lastActive,
        flags: tenantFlags(tenant, now),
      };
    })
    .sort((a, b) => b.turns - a.turns || a.companyName.localeCompare(b.companyName));
}

// ── issues ──────────────────────────────────────────────────────────────────

export type IssueSeverity = 'critical' | 'warning' | 'info';

export interface Issue {
  severity: IssueSeverity;
  /** Stable, so the dashboard can key on it and a test can assert it. */
  code: string;
  title: string;
  detail: string;
  /** The installer it is about, when it is about one. */
  tenantId?: string;
  /** Which admin page explains it. */
  page: 'health' | 'usage' | 'tenants' | 'costs' | 'errors';
}

/** Every threshold the issue rules use, in one place. */
export const ISSUE_THRESHOLDS = {
  /** Errors today at least this many times the trailing daily average... */
  errorSpikeRatio: 2,
  /** ...and at least this many, so a quiet day's two errors are not a spike. */
  errorSpikeMin: 20,
  /** `chat turn failed` lines in a day. */
  chatFailuresWarn: 5,
  /** Model time-to-first-chunk p95 today, ms (a bucket bound). */
  ttfbP95WarnMs: 8000,
  /** Trailing daily turns above which a silent day is suspicious. */
  silentDayMinAverage: 20,
  rateLimitedWarn: 500,
} as const;

const SEVERITY_ORDER: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * What needs a person's attention, from the counters and the tenant records.
 *
 * "Today" is compared with the seven days before it rather than with a fixed
 * number wherever traffic decides what normal is, so the rules do not need
 * retuning as the business grows. The live-infrastructure rules (5xx rate,
 * uptime) and the cost rules join these from their own sources in the route.
 */
export function detectIssues(input: {
  rows: readonly OpsDay[];
  tenants: readonly Tenant[];
  now: number;
}): Issue[] {
  const { rows, tenants, now } = input;
  const t = ISSUE_THRESHOLDS;
  const issues: Issue[] = [];
  const calendar = lastDays(now, 8);
  const today = calendar[7]!;
  const platform = platformByDay(rows);
  const todays = platform.get(today) ?? {};
  const prior = calendar.slice(0, 7).map((day) => platform.get(day) ?? {});
  const average = (counter: Parameters<typeof counterTotal>[1]) =>
    prior.reduce((sum, counts) => sum + counterTotal(counts, counter), 0) / prior.length;

  const errorsToday = counterTotal(todays, 'errors');
  const errorsAverage = average('errors');
  if (errorsToday >= t.errorSpikeMin && errorsToday >= errorsAverage * t.errorSpikeRatio) {
    issues.push({
      severity: 'warning',
      code: 'errors_spike',
      title: 'Errors are up today',
      detail: `${errorsToday} errors today against ${Math.round(errorsAverage)} a day over the last week.`,
      page: 'errors',
    });
  }

  const chatFailures = counterByDimension(todays, 'errors')['chat turn failed'] ?? 0;
  if (chatFailures >= t.chatFailuresWarn) {
    issues.push({
      severity: chatFailures >= t.chatFailuresWarn * 10 ? 'critical' : 'warning',
      code: 'chat_failures',
      title: 'Chat replies are failing',
      detail: `${chatFailures} chat turns failed today. Visitors saw an error instead of a reply.`,
      page: 'errors',
    });
  }

  const ttfbP95 = timingPercentile(todays, 'ttfb_ms', 0.95);
  if (ttfbP95 !== null && ttfbP95 > t.ttfbP95WarnMs) {
    issues.push({
      severity: 'warning',
      code: 'model_slow',
      title: 'The model is slow to start replying',
      detail: `95% of replies today started within ${Number.isFinite(ttfbP95) ? `${ttfbP95 / 1000} s` : 'over 32 s'}.`,
      page: 'usage',
    });
  }

  const turnsAverage = average('turns');
  // Only once the day is well under way: at 00:05 every day looks silent.
  const hourOfDay = new Date(now).getUTCHours();
  if (
    counterTotal(todays, 'turns') === 0 &&
    turnsAverage >= t.silentDayMinAverage &&
    hourOfDay >= 6
  ) {
    issues.push({
      severity: 'critical',
      code: 'no_traffic',
      title: 'No chat replies today',
      detail: `Normally about ${Math.round(turnsAverage)} a day. Check the widget and the model are reachable.`,
      page: 'health',
    });
  }

  const ingestFailed = counterTotal(todays, 'ingest_failed');
  if (ingestFailed > 0) {
    issues.push({
      severity: 'info',
      code: 'ingest_failed',
      title: 'Knowledge imports failed',
      detail: `${ingestFailed} knowledge ${ingestFailed === 1 ? 'job' : 'jobs'} failed today.`,
      page: 'usage',
    });
  }

  const sunscanFailed = counterTotal(todays, 'sunscan_failed');
  if (sunscanFailed > 0) {
    issues.push({
      severity: 'warning',
      code: 'sunscan_failed',
      title: 'Roof scans failed',
      detail: `${sunscanFailed} roof ${sunscanFailed === 1 ? 'scan' : 'scans'} failed today.`,
      page: 'usage',
    });
  }

  const rateLimited = counterTotal(todays, 'rate_limited');
  if (rateLimited >= t.rateLimitedWarn) {
    issues.push({
      severity: 'info',
      code: 'rate_limited',
      title: 'Many requests were rate limited',
      detail: `${rateLimited} requests refused by the API's own limiter today.`,
      page: 'health',
    });
  }

  for (const tenant of tenants) {
    const name = tenant.config.companyName;
    for (const flag of tenantFlags(tenant, now)) {
      if (flag === 'grace_ended') {
        issues.push({
          severity: 'warning',
          code: 'grace_ended',
          title: `${name}: payment grace period over`,
          detail: 'Their add-ons are switched off until the payment goes through.',
          tenantId: tenant.id,
          page: 'tenants',
        });
      } else if (flag === 'past_due') {
        issues.push({
          severity: 'info',
          code: 'past_due',
          title: `${name}: payment failed`,
          detail: `Add-ons stay on until ${tenant.billing?.graceUntil?.slice(0, 10) ?? 'the grace period ends'}.`,
          tenantId: tenant.id,
          page: 'tenants',
        });
      } else if (flag.endsWith('_sync_failed')) {
        const kind = flag.startsWith('website') ? 'website' : 'drive';
        issues.push({
          severity: 'info',
          code: flag,
          title: `${name}: ${kind === 'website' ? 'website' : 'Google Drive'} sync failing`,
          detail: tenant.sync?.[kind]?.error ?? 'The last sync did not complete.',
          tenantId: tenant.id,
          page: 'tenants',
        });
      }
    }
  }

  return sortIssues(issues);
}

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code),
  );
}

// ── issues from the live sources ────────────────────────────────────────────

/** Thresholds for the infrastructure and cost rules. */
export const SOURCE_THRESHOLDS = {
  /** 5xx share of requests in the last full hour... */
  errorRateWarn: 0.01,
  errorRateCritical: 0.05,
  /** ...once there were at least this many requests to be a share of. */
  errorRateMinRequests: 50,
  /** Request latency p95 in the last hour, ms. */
  latencyP95WarnMs: 5000,
  /** A day's spend against the seven before it. */
  spendSpikeRatio: 2,
  /** Edge 429s in an hour. */
  edgeRateLimitedWarn: 1000,
} as const;

/** The shapes `sources.ts` returns, as much of them as the rules read. */
export interface SourceView {
  monitoring: {
    services: Array<{
      name: string;
      requests: number[];
      errors5xx: number[];
      p95Ms: Array<number | null>;
    }>;
    uptime: Array<{ name: string; passing: boolean | null }>;
    edgeRateLimited: number[];
  } | null;
  billing: {
    currency: string;
    monthToDate: number;
    forecast: number;
    daily: Array<{ day: string; byService: Record<string, number> }>;
  } | null;
  monthlyBudget: number | null;
  /** Sources that could not be read, with why. */
  unavailable: Array<{ source: string; reason: string }>;
}

export function sourceIssues(view: SourceView): Issue[] {
  const t = SOURCE_THRESHOLDS;
  const issues: Issue[] = [];
  const monitoring = view.monitoring;
  if (monitoring) {
    for (const check of monitoring.uptime) {
      if (check.passing === false) {
        issues.push({
          severity: 'critical',
          code: `uptime:${check.name}`,
          title: `Uptime check failing: ${check.name}`,
          detail: 'Google’s uptime probe could not get a healthy answer in the last ten minutes.',
          page: 'health',
        });
      }
    }
    for (const service of monitoring.services) {
      // The last *full* hour: the current one has only just begun.
      const i = service.requests.length - 2;
      if (i < 0) continue;
      const requests = service.requests[i] ?? 0;
      const errors = service.errors5xx[i] ?? 0;
      if (requests >= t.errorRateMinRequests) {
        const rate = errors / requests;
        if (rate >= t.errorRateWarn) {
          issues.push({
            severity: rate >= t.errorRateCritical ? 'critical' : 'warning',
            code: `error_rate:${service.name}`,
            title: `${service.name} is returning server errors`,
            detail: `${(rate * 100).toFixed(1)}% of ${requests} requests failed with a 5xx in the last hour.`,
            page: 'health',
          });
        }
      }
      const p95 = service.p95Ms[i];
      if (p95 !== null && p95 !== undefined && p95 > t.latencyP95WarnMs) {
        issues.push({
          severity: 'warning',
          code: `latency:${service.name}`,
          title: `${service.name} is slow`,
          detail: `95% of requests in the last hour finished within ${(p95 / 1000).toFixed(1)} s.`,
          page: 'health',
        });
      }
    }
    const edge = monitoring.edgeRateLimited[monitoring.edgeRateLimited.length - 2] ?? 0;
    if (edge >= t.edgeRateLimitedWarn) {
      issues.push({
        severity: 'warning',
        code: 'edge_rate_limited',
        title: 'Cloud Armor is turning a lot of traffic away',
        detail: `${edge} requests got a 429 at the load balancer in the last hour. A flood, or a real customer behind one address.`,
        page: 'health',
      });
    }
  }

  const billing = view.billing;
  if (billing) {
    const money = (n: number) => `${billing.currency} ${n.toFixed(2)}`;
    const totals = billing.daily.map((d) => Object.values(d.byService).reduce((a, b) => a + b, 0));
    const latest = totals.at(-1);
    const prior = totals.slice(-8, -1);
    if (latest !== undefined && prior.length >= 3) {
      const average = prior.reduce((a, b) => a + b, 0) / prior.length;
      if (average > 1 && latest > average * t.spendSpikeRatio) {
        issues.push({
          severity: 'warning',
          code: 'spend_spike',
          title: 'Google Cloud spend jumped',
          detail: `${money(latest)} on ${billing.daily.at(-1)!.day} against ${money(average)} a day the week before.`,
          page: 'costs',
        });
      }
    }
    const budget = view.monthlyBudget;
    if (budget !== null && budget > 0) {
      if (billing.monthToDate > budget) {
        issues.push({
          severity: 'critical',
          code: 'over_budget',
          title: 'Over this month’s budget',
          detail: `${money(billing.monthToDate)} spent against a budget of ${money(budget)}.`,
          page: 'costs',
        });
      } else if (billing.forecast > budget) {
        issues.push({
          severity: 'warning',
          code: 'forecast_over_budget',
          title: 'On course to go over budget',
          detail: `Forecast ${money(billing.forecast)} for the month against ${money(budget)}.`,
          page: 'costs',
        });
      }
    }
  }

  for (const off of view.unavailable) {
    issues.push({
      severity: 'info',
      code: `source:${off.source}`,
      title: `${off.source} figures unavailable`,
      detail: off.reason,
      page: off.source === 'Cloud Monitoring' ? 'health' : 'costs',
    });
  }
  return sortIssues(issues);
}
