/**
 * The staff dashboard's types. Mirrors `apps/api/src/routes/admin.ts` and
 * `apps/api/src/ops/report.ts`, the way `portal-api.ts` mirrors the portal
 * routes; calls go through the same `api()` and the same proxy.
 */

export type IssueSeverity = 'critical' | 'warning' | 'info';
export type AdminPage = 'health' | 'usage' | 'tenants' | 'costs' | 'errors';

export interface Issue {
  severity: IssueSeverity;
  code: string;
  title: string;
  detail: string;
  tenantId?: string;
  page: AdminPage;
}

export interface UsagePoint {
  day: string;
  turns: number;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  leads: number;
  errors: number;
  ingestFailed: number;
  sunscanFailed: number;
  rateLimited: number;
  activeTenants: number;
}

export interface ModelRow {
  model: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

export interface UsageTotals {
  turns: number;
  turnsByChannel: Record<string, number>;
  messages: number;
  escalations: number;
  leads: number;
  ingestOk: number;
  ingestFailed: number;
  sunscanOk: number;
  sunscanFailed: number;
  errors: number;
  errorsBySource: Record<string, number>;
  rateLimited: number;
  byModel: ModelRow[];
  /** Bucket bounds in ms; `null` is "nothing measured", and 32001 is "over 32 s". */
  latency: {
    ttfbP50: number | null;
    ttfbP95: number | null;
    turnP50: number | null;
    turnP95: number | null;
  };
}

export interface UsageReport {
  range: { from: string; to: string; days: number };
  series: UsagePoint[];
  totals: UsageTotals;
}

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
    ttfbP95: number | null;
  };
  week: UsagePoint[];
  health: {
    available: boolean;
    reason?: string;
    requests24h: number;
    errorRate24h: number | null;
    p95LastHourMs: number | null;
    uptimePassing: number;
    uptimeChecks: number;
  };
  costs: {
    available: boolean;
    reason?: string;
    currency: string | null;
    monthToDate: number | null;
    forecast: number | null;
    budget: number | null;
    mrr: number | null;
    mrrCurrency: string | null;
  };
}

/** A figure from outside the API, or why it could not be read. */
export type Source<T> =
  { available: true; data: T; at: string } | { available: false; reason: string };

export interface ServiceHealth {
  name: string;
  requests: number[];
  errors5xx: number[];
  p95Ms: Array<number | null>;
  instances: number[];
}

export interface AdminHealth {
  monitoring: Source<{
    hours: string[];
    services: ServiceHealth[];
    uptime: Array<{ name: string; passing: boolean | null }>;
    edgeRateLimited: number[];
  }>;
  errorsBySource: Record<string, number>;
  rateLimited: Record<string, number>;
  topErrors: Array<{ source: string; code: string; count: number; lastAt: string; sample: string }>;
}

export interface AdminCosts {
  month: string;
  budget: number | null;
  gcp: Source<{
    currency: string;
    month: string;
    monthToDate: number;
    lastMonth: number;
    forecast: number;
    lastDay: string | null;
    byService: Array<{ service: string; monthToDate: number; lastMonth: number }>;
    topSkus: Array<{ service: string; sku: string; cost: number }>;
    daily: Array<{ day: string; byService: Record<string, number> }>;
  }>;
  postmark: Source<{
    sent: number;
    bounced: number;
    spamComplaints: number;
    costFromPlanRate: number | null;
  }>;
  stripe: Source<{
    currency: string;
    mrr: number;
    active: number;
    trialing: number;
    pastDue: number;
    canceledThisMonth: number;
    byPlan: Array<{ plan: string; subscriptions: number; mrr: number }>;
  }>;
  perTenant: {
    modelCurrency: string | null;
    rows: Array<{
      tenantId: string;
      companyName: string;
      tokens: number;
      model: number | null;
    }>;
  };
  margin:
    | { currency: string; revenue: number; cost: number; margin: number; included: string[] }
    | { currency: null; reason: string };
}

/** "£1,234.50", or the currency code where there is no symbol. */
export function money(amount: number | null, currency: string | null): string {
  if (amount === null || currency === null) return '–';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** "1.2%". */
export function percent(fraction: number | null): string {
  return fraction === null ? '–' : `${(fraction * 100).toFixed(fraction < 0.01 ? 2 : 1)}%`;
}

export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'none';

export interface TenantRow {
  id: string;
  companyName: string;
  createdAt: string | null;
  billingStatus: BillingStatus;
  graceUntil: string | null;
  addons: string[];
  onboardingStep: string;
  turns: number;
  leads: number;
  tokens: number;
  errors: number;
  lastActiveDay: string | null;
  flags: string[];
}

export interface OpsError {
  id: string;
  at: string;
  source: string;
  code: string;
  message: string;
  tenantId: string | null;
  requestId: string | null;
  count: number;
}

export interface ModelLatency {
  ttfbMsP50: number | null;
  ttfbMsP95: number | null;
  totalMsP50: number | null;
  totalMsP95: number | null;
}

export interface TenantDetail {
  tenant: TenantRow & {
    publicId: string;
    domains: string[];
    sync: Record<string, { status: string; at: string; error: string | null }>;
    members: Record<string, number>;
  };
  series: UsagePoint[];
  totals: UsageTotals;
  models: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    byModel: Array<{
      provider: string;
      model: string | null;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      latency: ModelLatency;
    }>;
  };
  errors: OpsError[];
}

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

/** 1,284 / 12.9K / 4.2M. */
export function compact(n: number): string {
  if (Math.abs(n) < 1000) return n.toLocaleString('en-GB');
  return new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(
    n,
  );
}

/** A latency bucket bound for people: "1 s", "250 ms", "over 32 s", or a dash. */
export function latencyText(ms: number | null): string {
  if (ms === null) return '–';
  if (ms > 32_000) return 'over 32 s';
  if (ms >= 1000) return `${ms / 1000} s`;
  return `${ms} ms`;
}

/** "12 Oct" from `2026-10-12`. */
export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export const FLAG_TEXT: Record<string, string> = {
  past_due: 'Payment failed',
  grace_ended: 'Grace period over',
  website_sync_failed: 'Website sync failing',
  drive_sync_failed: 'Drive sync failing',
  onboarding: 'Still onboarding',
};
