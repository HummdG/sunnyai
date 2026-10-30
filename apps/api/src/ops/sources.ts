import type { PlanKey } from '../entitlements.js';

/**
 * The staff dashboard's outside sources: live infrastructure from Cloud
 * Monitoring, and what the platform actually costs, from the GCP billing
 * export and the providers' own usage APIs.
 *
 * ## Actual spend, not estimates
 *
 * The repository still holds no model price, and this file does not add one.
 * Gemini runs through Vertex AI, so its real cost is a line in the project's
 * GCP bill; the billing export to BigQuery is where that line is read from.
 * Twilio reports its own charges per usage category. Postmark has no billing
 * API, so its figure is the one exception: sent count times the plan rate the
 * operator configures, labelled as such on the page.
 *
 * ## Every source fails soft
 *
 * Each read returns `{ available: false, reason }` rather than throwing, and the
 * page shows the reason in place of the panel. A dashboard that goes blank
 * because Twilio timed out is a dashboard nobody trusts during the incident it
 * exists for.
 *
 * ## Credentials
 *
 * Google APIs are called with the Cloud Run service account's token from the
 * metadata server -- the same identity the API already runs as, granted
 * read-only roles in `infrastructure/terraform/ops.tf`. Off Google Cloud there
 * is no metadata server, so locally the Google sources report themselves
 * unavailable rather than reaching for someone's personal credentials.
 */

export type Source<T> =
  { available: true; data: T; at: string } | { available: false; reason: string };

export interface OpsConfig {
  project: string | null;
  /** Cloud Run service names to chart (`OPS_CLOUD_RUN_SERVICES`). */
  runServices: string[];
  /** `project.dataset.table` of the detailed billing export (`OPS_BILLING_TABLE`). */
  billingTable: string | null;
  /** Monthly budget in the billing currency (`OPS_MONTHLY_BUDGET`). */
  monthlyBudget: number | null;
  twilio: { accountSid: string; authToken: string } | null;
  postmark: { serverToken: string; pricePer1k: number | null } | null;
  stripeSecretKey: string | null;
  /** Price id → plan, to name the plans revenue comes from. */
  stripePrices: Partial<Record<PlanKey, string>>;
}

export function loadOpsConfig(
  env: Record<string, string | undefined>,
  stripe: { secretKey: string | null; prices: Partial<Record<PlanKey, string>> },
): OpsConfig {
  const value = (name: string): string | null => {
    const raw = env[name]?.trim();
    return raw ? raw : null;
  };
  const number = (name: string): number | null => {
    const raw = value(name);
    if (raw === null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number, not "${raw}"`);
    return n;
  };
  const table = value('OPS_BILLING_TABLE');
  // The table name goes into SQL text (BigQuery cannot parameterise it), so it
  // is held to the shape of a table id and nothing else.
  if (
    table !== null &&
    !/^[a-z][a-z0-9-]{4,61}[a-z0-9]\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(table)
  ) {
    throw new Error(`OPS_BILLING_TABLE must be project.dataset.table, not "${table}"`);
  }
  const sid = value('TWILIO_ACCOUNT_SID');
  const token = value('TWILIO_AUTH_TOKEN');
  const postmark = value('SUNNY_POSTMARK_SERVER_TOKEN');
  return {
    project: value('GOOGLE_CLOUD_PROJECT'),
    runServices: (value('OPS_CLOUD_RUN_SERVICES') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    billingTable: table,
    monthlyBudget: number('OPS_MONTHLY_BUDGET'),
    twilio: sid && token ? { accountSid: sid, authToken: token } : null,
    postmark: postmark
      ? { serverToken: postmark, pricePer1k: number('OPS_POSTMARK_PRICE_PER_1K') }
      : null,
    stripeSecretKey: stripe.secretKey,
    stripePrices: stripe.prices,
  };
}

// ── plumbing ────────────────────────────────────────────────────────────────

/** Remember a source's last answer for `ttlMs`; a failed read is retried next time. */
export function cachedSource<T>(
  ttlMs: number,
  now: () => number,
  read: () => Promise<Source<T>>,
): () => Promise<Source<T>> {
  let last: { at: number; value: Promise<Source<T>> } | null = null;
  return () => {
    const t = now();
    if (!last || t - last.at > ttlMs) {
      const value = read().catch((error: unknown): Source<T> => ({
        available: false,
        reason: error instanceof Error ? error.message : 'The read failed.',
      }));
      last = { at: t, value };
      void value.then((v) => {
        if (!v.available && last?.value === value) last = null;
      });
    }
    return last.value;
  };
}

export function unavailable<T>(reason: string): Source<T> {
  return { available: false, reason };
}

const METADATA_TOKEN =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/** The service account's access token, from the metadata server, cached until near expiry. */
export function metadataTokens(fetchImpl: typeof fetch, now: () => number): () => Promise<string> {
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && cached.until > now()) return cached.token;
    let response: Response;
    try {
      response = await fetchImpl(METADATA_TOKEN, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      throw new Error('Not running on Google Cloud, so there is no service account to read with.');
    }
    if (!response.ok) throw new Error(`The metadata server refused a token (${response.status}).`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, until: now() + (body.expires_in - 60) * 1000 };
    return body.access_token;
  };
}

async function getJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  what: string,
): Promise<T> {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { message?: string } | string; message?: string; Message?: string }) | null;
  if (!response.ok || body === null) {
    const detail =
      typeof body?.error === 'string'
        ? body.error
        : (body?.error?.message ?? body?.message ?? body?.Message ?? `HTTP ${response.status}`);
    throw new Error(`${what} refused the request: ${detail}`);
  }
  return body;
}

// ── Cloud Monitoring ────────────────────────────────────────────────────────

export interface ServiceHealth {
  name: string;
  /** Per hour, oldest first, aligned with `MonitoringSnapshot.hours`. */
  requests: number[];
  errors5xx: number[];
  /** Request latency p95 per hour, ms; null for an hour with no requests. */
  p95Ms: Array<number | null>;
  instances: number[];
}

export interface MonitoringSnapshot {
  /** ISO hour starts, the last 24. */
  hours: string[];
  services: ServiceHealth[];
  /** Uptime checks by display name: passing in the last ten minutes, or null if unknown. */
  uptime: Array<{ name: string; passing: boolean | null }>;
  /** Requests the load balancer answered 429 (Cloud Armor's rate limit), per hour. */
  edgeRateLimited: number[];
}

interface TimeSeries {
  metric?: { labels?: Record<string, string> };
  resource?: { labels?: Record<string, string> };
  points?: Array<{
    interval: { startTime?: string; endTime: string };
    value: { int64Value?: string; doubleValue?: number; boolValue?: boolean };
  }>;
}

const HOUR_MS = 60 * 60 * 1000;

export function hourStarts(now: number, n: number): string[] {
  const top = Math.floor(now / HOUR_MS) * HOUR_MS;
  return Array.from({ length: n }, (_, i) => new Date(top - (n - 1 - i) * HOUR_MS).toISOString());
}

/** One series' points placed on the hour grid; a missing hour is `empty`. */
function onGrid<E>(series: TimeSeries | undefined, hours: string[], empty: E): Array<number | E> {
  const byHour = new Map<string, number>();
  for (const point of series?.points ?? []) {
    // A point's interval ends at the end of its alignment period.
    const end = Date.parse(point.interval.endTime);
    const hour = new Date(Math.floor((end - 1) / HOUR_MS) * HOUR_MS).toISOString();
    const v = point.value;
    byHour.set(hour, v.int64Value !== undefined ? Number(v.int64Value) : (v.doubleValue ?? 0));
  }
  return hours.map((h) => byHour.get(h) ?? empty);
}

export function createMonitoringSource(options: {
  config: OpsConfig;
  token: () => Promise<string>;
  fetch: typeof fetch;
  now: () => number;
}): () => Promise<Source<MonitoringSnapshot>> {
  const { config, token, now } = options;
  const fetchImpl = options.fetch;
  return cachedSource(60_000, now, async () => {
    if (!config.project) return unavailable('GOOGLE_CLOUD_PROJECT is not set.');
    if (config.runServices.length === 0) return unavailable('OPS_CLOUD_RUN_SERVICES is not set.');
    const bearer = await token();
    const t = now();
    const hours = hourStarts(t, 24);
    const start = hours[0]!;
    const end = new Date(Date.parse(hours[23]!) + HOUR_MS).toISOString();

    const list = async (params: Record<string, string>): Promise<TimeSeries[]> => {
      const query = new URLSearchParams({
        'interval.startTime': start,
        'interval.endTime': end,
        'aggregation.alignmentPeriod': '3600s',
        ...params,
      });
      const body = await getJson<{ timeSeries?: TimeSeries[] }>(
        fetchImpl,
        `https://monitoring.googleapis.com/v3/projects/${config.project}/timeSeries?${query}`,
        { headers: { authorization: `Bearer ${bearer}` } },
        'Cloud Monitoring',
      );
      return body.timeSeries ?? [];
    };
    const services = config.runServices.map((s) => `"${s.replace(/"/g, '')}"`).join(', ');
    const run = `resource.type = "cloud_run_revision" AND resource.label.service_name = one_of(${services})`;
    const byService = {
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      'aggregation.groupByFields': 'resource.label.service_name',
    };

    const [requests, errors, latency, instances, uptime, edge] = await Promise.all([
      list({
        filter: `metric.type = "run.googleapis.com/request_count" AND ${run}`,
        'aggregation.perSeriesAligner': 'ALIGN_SUM',
        ...byService,
      }),
      list({
        filter: `metric.type = "run.googleapis.com/request_count" AND ${run} AND metric.label.response_code_class = "5xx"`,
        'aggregation.perSeriesAligner': 'ALIGN_SUM',
        ...byService,
      }),
      list({
        filter: `metric.type = "run.googleapis.com/request_latencies" AND ${run}`,
        'aggregation.perSeriesAligner': 'ALIGN_DELTA',
        'aggregation.crossSeriesReducer': 'REDUCE_PERCENTILE_95',
        'aggregation.groupByFields': 'resource.label.service_name',
      }),
      list({
        filter: `metric.type = "run.googleapis.com/container/instance_count" AND ${run}`,
        'aggregation.perSeriesAligner': 'ALIGN_MAX',
        ...byService,
      }),
      // The last ten minutes only: "is it up now" is the question.
      (async () => {
        const query = new URLSearchParams({
          filter: 'metric.type = "monitoring.googleapis.com/uptime_check/check_passed"',
          'interval.startTime': new Date(t - 10 * 60 * 1000).toISOString(),
          'interval.endTime': new Date(t).toISOString(),
          'aggregation.alignmentPeriod': '600s',
          'aggregation.perSeriesAligner': 'ALIGN_FRACTION_TRUE',
          'aggregation.crossSeriesReducer': 'REDUCE_MIN',
          'aggregation.groupByFields': 'metric.label.check_id',
        });
        const body = await getJson<{ timeSeries?: TimeSeries[] }>(
          fetchImpl,
          `https://monitoring.googleapis.com/v3/projects/${config.project}/timeSeries?${query}`,
          { headers: { authorization: `Bearer ${bearer}` } },
          'Cloud Monitoring',
        );
        return body.timeSeries ?? [];
      })(),
      list({
        filter:
          'metric.type = "loadbalancing.googleapis.com/https/request_count" AND metric.label.response_code = 429',
        'aggregation.perSeriesAligner': 'ALIGN_SUM',
        'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      }),
    ]);

    const find = (series: TimeSeries[], name: string) =>
      series.find((s) => s.resource?.labels?.['service_name'] === name);

    return {
      available: true,
      at: new Date(t).toISOString(),
      data: {
        hours,
        services: config.runServices.map((name) => ({
          name,
          requests: onGrid(find(requests, name), hours, 0),
          errors5xx: onGrid(find(errors, name), hours, 0),
          p95Ms: onGrid(find(latency, name), hours, null).map((v) =>
            v === null ? null : Math.round(v),
          ),
          instances: onGrid(find(instances, name), hours, 0),
        })),
        uptime: uptime.map((s) => {
          const point = s.points?.[0]?.value.doubleValue;
          return {
            name: s.metric?.labels?.['check_id'] ?? 'uptime check',
            passing: point === undefined ? null : point >= 1,
          };
        }),
        edgeRateLimited: onGrid(edge[0], hours, 0),
      },
    };
  });
}

// ── GCP billing export (BigQuery) ───────────────────────────────────────────

export interface BillingSnapshot {
  currency: string;
  month: string;
  monthToDate: number;
  lastMonth: number;
  /** Month-to-date over the days the export has reached, times the days in the month. */
  forecast: number;
  /** The last day the export has data for; it runs about a day behind. */
  lastDay: string | null;
  byService: Array<{ service: string; monthToDate: number; lastMonth: number }>;
  topSkus: Array<{ service: string; sku: string; cost: number }>;
  /** Last 30 days, per day per service. */
  daily: Array<{ day: string; byService: Record<string, number> }>;
}

interface QueryResponse {
  jobComplete?: boolean;
  rows?: Array<{ f: Array<{ v: string | null }> }>;
}

/** `YYYY-MM` and `YYYYMM` (the export's `invoice.month`) for a timestamp's month. */
export function monthKeys(at: number): { iso: string; invoice: string; lastInvoice: string } {
  const d = new Date(at);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m - 1, 1));
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    iso: `${y}-${pad(m + 1)}`,
    invoice: `${y}${pad(m + 1)}`,
    lastInvoice: `${last.getUTCFullYear()}${pad(last.getUTCMonth() + 1)}`,
  };
}

export function daysInMonth(at: number): number {
  const d = new Date(at);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Net of credits (free tier, discounts), which is what the invoice charges. */
const NET_COST = 'SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0))';

export function createBillingSource(options: {
  config: OpsConfig;
  token: () => Promise<string>;
  fetch: typeof fetch;
  now: () => number;
}): () => Promise<Source<BillingSnapshot>> {
  const { config, token, now } = options;
  const fetchImpl = options.fetch;
  return cachedSource(60 * 60 * 1000, now, async () => {
    if (!config.project) return unavailable('GOOGLE_CLOUD_PROJECT is not set.');
    if (!config.billingTable) {
      return unavailable(
        'OPS_BILLING_TABLE is not set. Turn on the billing export to BigQuery (README_DEPLOY.md).',
      );
    }
    const bearer = await token();
    const t = now();
    const months = monthKeys(t);
    const from = new Date(t - 30 * 24 * HOUR_MS).toISOString().slice(0, 10);
    const table = `\`${config.billingTable}\``;

    const query = async (sql: string, params: Record<string, string>): Promise<string[][]> => {
      const body = await getJson<QueryResponse>(
        fetchImpl,
        `https://bigquery.googleapis.com/bigquery/v2/projects/${config.project}/queries`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            query: sql,
            useLegacySql: false,
            timeoutMs: 30_000,
            parameterMode: 'NAMED',
            queryParameters: Object.entries(params).map(([name, value]) => ({
              name,
              parameterType: { type: 'STRING' },
              parameterValue: { value },
            })),
          }),
        },
        'BigQuery',
      );
      if (body.jobComplete === false) throw new Error('The billing query is still running.');
      return (body.rows ?? []).map((row) => row.f.map((cell) => cell.v ?? ''));
    };

    const scope = { project: config.project };
    const [services, skus, daily] = await Promise.all([
      query(
        `SELECT invoice.month, service.description, ${NET_COST}, ANY_VALUE(currency)
         FROM ${table}
         WHERE project.id = @project AND invoice.month IN (@this, @last)
         GROUP BY 1, 2`,
        { ...scope, this: months.invoice, last: months.lastInvoice },
      ),
      query(
        `SELECT service.description, sku.description, ${NET_COST} AS net
         FROM ${table}
         WHERE project.id = @project AND invoice.month = @this
         GROUP BY 1, 2 ORDER BY net DESC LIMIT 15`,
        { ...scope, this: months.invoice },
      ),
      query(
        `SELECT CAST(DATE(usage_start_time) AS STRING), service.description, ${NET_COST}
         FROM ${table}
         WHERE project.id = @project AND DATE(usage_start_time) >= DATE(@from)
         GROUP BY 1, 2`,
        { ...scope, from },
      ),
    ]);

    let currency = 'GBP';
    const perService = new Map<string, { monthToDate: number; lastMonth: number }>();
    for (const [month, service, cost, cur] of services) {
      if (cur) currency = cur;
      const row = perService.get(service!) ?? { monthToDate: 0, lastMonth: 0 };
      if (month === months.invoice) row.monthToDate += Number(cost);
      else row.lastMonth += Number(cost);
      perService.set(service!, row);
    }
    const byDay = new Map<string, Record<string, number>>();
    for (const [day, service, cost] of daily) {
      const entry = byDay.get(day!) ?? {};
      entry[service!] = (entry[service!] ?? 0) + Number(cost);
      byDay.set(day!, entry);
    }
    const monthToDate = [...perService.values()].reduce((s, r) => s + r.monthToDate, 0);
    const daysThisMonth = [...byDay.keys()].filter((d) => d.startsWith(months.iso)).sort();
    const lastDay = [...byDay.keys()].sort().at(-1) ?? null;
    const reached = daysThisMonth.length;
    return {
      available: true,
      at: new Date(t).toISOString(),
      data: {
        currency,
        month: months.iso,
        monthToDate: round2(monthToDate),
        lastMonth: round2([...perService.values()].reduce((s, r) => s + r.lastMonth, 0)),
        forecast: round2(reached === 0 ? monthToDate : (monthToDate / reached) * daysInMonth(t)),
        lastDay,
        byService: [...perService.entries()]
          .map(([service, r]) => ({
            service,
            monthToDate: round2(r.monthToDate),
            lastMonth: round2(r.lastMonth),
          }))
          .filter((r) => r.monthToDate !== 0 || r.lastMonth !== 0)
          .sort((a, b) => b.monthToDate - a.monthToDate),
        topSkus: skus
          .map(([service, sku, cost]) => ({
            service: service!,
            sku: sku!,
            cost: round2(Number(cost)),
          }))
          .filter((r) => r.cost > 0),
        daily: [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, byService]) => ({
            day,
            byService: Object.fromEntries(
              Object.entries(byService).map(([k, v]) => [k, round2(v)]),
            ),
          })),
      },
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Twilio ──────────────────────────────────────────────────────────────────

export interface TwilioSnapshot {
  currency: string;
  thisMonth: number;
  lastMonth: number;
  byCategory: Array<{
    category: string;
    description: string;
    usage: number;
    unit: string;
    price: number;
  }>;
}

interface TwilioRecord {
  category: string;
  description: string;
  usage: string;
  usage_unit: string | null;
  price: string | number;
  price_unit: string;
}

export function createTwilioSource(options: {
  config: OpsConfig;
  fetch: typeof fetch;
  now: () => number;
}): () => Promise<Source<TwilioSnapshot>> {
  const { config, now } = options;
  return cachedSource(60 * 60 * 1000, now, async () => {
    if (!config.twilio) return unavailable('Twilio is not configured on this deployment.');
    const { accountSid, authToken } = config.twilio;
    const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
    const read = (period: 'ThisMonth' | 'LastMonth') =>
      getJson<{ usage_records: TwilioRecord[] }>(
        options.fetch,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Usage/Records/${period}.json?PageSize=1000`,
        { headers: { authorization: auth } },
        'Twilio',
      );
    const [current, previous] = await Promise.all([read('ThisMonth'), read('LastMonth')]);
    const total = (records: TwilioRecord[]) =>
      Number(records.find((r) => r.category === 'totalprice')?.price ?? 0);
    return {
      available: true,
      at: new Date(now()).toISOString(),
      data: {
        currency: (current.usage_records[0]?.price_unit ?? 'usd').toUpperCase(),
        thisMonth: round2(total(current.usage_records)),
        lastMonth: round2(total(previous.usage_records)),
        // Twilio nests categories (calls ⊃ calls-inbound); the leaves with a
        // price are the useful breakdown, and the totals are the headline.
        byCategory: current.usage_records
          .filter((r) => r.category !== 'totalprice' && Number(r.price) > 0)
          .map((r) => ({
            category: r.category,
            description: r.description,
            usage: Number(r.usage),
            unit: r.usage_unit ?? '',
            price: round2(Number(r.price)),
          }))
          .sort((a, b) => b.price - a.price)
          .slice(0, 12),
      },
    };
  });
}

// ── Postmark ────────────────────────────────────────────────────────────────

export interface PostmarkSnapshot {
  sent: number;
  bounced: number;
  spamComplaints: number;
  /** Sent × the configured plan rate, or null without one. Not from Postmark. */
  costFromPlanRate: number | null;
}

export function createPostmarkSource(options: {
  config: OpsConfig;
  fetch: typeof fetch;
  now: () => number;
}): () => Promise<Source<PostmarkSnapshot>> {
  const { config, now } = options;
  return cachedSource(60 * 60 * 1000, now, async () => {
    if (!config.postmark) return unavailable('Postmark is not configured on this deployment.');
    const t = now();
    const from = `${monthKeys(t).iso}-01`;
    const to = new Date(t).toISOString().slice(0, 10);
    const body = await getJson<{ Sent: number; Bounced: number; SpamComplaints: number }>(
      options.fetch,
      `https://api.postmarkapp.com/stats/outbound?fromdate=${from}&todate=${to}`,
      {
        headers: {
          accept: 'application/json',
          'X-Postmark-Server-Token': config.postmark.serverToken,
        },
      },
      'Postmark',
    );
    const rate = config.postmark.pricePer1k;
    return {
      available: true,
      at: new Date(t).toISOString(),
      data: {
        sent: body.Sent,
        bounced: body.Bounced,
        spamComplaints: body.SpamComplaints,
        costFromPlanRate: rate === null ? null : round2((body.Sent / 1000) * rate),
      },
    };
  });
}

// ── Stripe ──────────────────────────────────────────────────────────────────

export interface RevenueSnapshot {
  currency: string;
  /** Monthly recurring revenue from active and past-due subscriptions. */
  mrr: number;
  active: number;
  trialing: number;
  pastDue: number;
  canceledThisMonth: number;
  byPlan: Array<{ plan: string; subscriptions: number; mrr: number }>;
}

interface StripeSubscription {
  id: string;
  status: string;
  canceled_at: number | null;
  items: {
    data: Array<{
      quantity?: number;
      price: {
        id: string;
        currency: string;
        unit_amount: number | null;
        recurring: { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number } | null;
      };
    }>;
  };
}

const PER_MONTH: Record<string, number> = { day: 30, week: 52 / 12, month: 1, year: 1 / 12 };

export function createStripeSource(options: {
  config: OpsConfig;
  fetch: typeof fetch;
  now: () => number;
}): () => Promise<Source<RevenueSnapshot>> {
  const { config, now } = options;
  return cachedSource(60 * 60 * 1000, now, async () => {
    if (!config.stripeSecretKey) return unavailable('Stripe is not configured on this deployment.');
    const subscriptions: StripeSubscription[] = [];
    let after: string | null = null;
    // Ten pages of a hundred is far past this business's size; the cap keeps a
    // runaway pagination from holding a dashboard request open.
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ status: 'all', limit: '100' });
      if (after) query.set('starting_after', after);
      const body: { data: StripeSubscription[]; has_more: boolean } = await getJson(
        options.fetch,
        `https://api.stripe.com/v1/subscriptions?${query}`,
        { headers: { authorization: `Bearer ${config.stripeSecretKey}` } },
        'Stripe',
      );
      subscriptions.push(...body.data);
      if (!body.has_more || body.data.length === 0) break;
      after = body.data[body.data.length - 1]!.id;
    }
    const planOf = new Map(Object.entries(config.stripePrices).map(([plan, id]) => [id, plan]));
    const t = now();
    const monthStart = Date.parse(`${monthKeys(t).iso}-01T00:00:00Z`) / 1000;
    let currency = 'GBP';
    let mrr = 0;
    const byPlan = new Map<string, { subscriptions: number; mrr: number }>();
    for (const sub of subscriptions) {
      if (sub.status !== 'active' && sub.status !== 'past_due') continue;
      for (const item of sub.items.data) {
        const price = item.price;
        if (!price.recurring || price.unit_amount === null) continue;
        currency = price.currency.toUpperCase();
        const monthly =
          (((price.unit_amount * (item.quantity ?? 1)) / 100) *
            (PER_MONTH[price.recurring.interval] ?? 1)) /
          price.recurring.interval_count;
        mrr += monthly;
        const plan = planOf.get(price.id) ?? 'other';
        const row = byPlan.get(plan) ?? { subscriptions: 0, mrr: 0 };
        row.subscriptions += 1;
        row.mrr += monthly;
        byPlan.set(plan, row);
      }
    }
    return {
      available: true,
      at: new Date(t).toISOString(),
      data: {
        currency,
        mrr: round2(mrr),
        active: subscriptions.filter((s) => s.status === 'active').length,
        trialing: subscriptions.filter((s) => s.status === 'trialing').length,
        pastDue: subscriptions.filter((s) => s.status === 'past_due').length,
        canceledThisMonth: subscriptions.filter(
          (s) => s.status === 'canceled' && (s.canceled_at ?? 0) >= monthStart,
        ).length,
        byPlan: [...byPlan.entries()]
          .map(([plan, r]) => ({ plan, subscriptions: r.subscriptions, mrr: round2(r.mrr) }))
          .sort((a, b) => b.mrr - a.mrr),
      },
    };
  });
}

// ── all of them ─────────────────────────────────────────────────────────────

export interface OpsSources {
  monitoring: () => Promise<Source<MonitoringSnapshot>>;
  billing: () => Promise<Source<BillingSnapshot>>;
  twilio: () => Promise<Source<TwilioSnapshot>>;
  postmark: () => Promise<Source<PostmarkSnapshot>>;
  stripe: () => Promise<Source<RevenueSnapshot>>;
  monthlyBudget: number | null;
  /** The GCP project, for links into Cloud Logging. */
  project: string | null;
}

export function createOpsSources(options: {
  config: OpsConfig;
  fetch?: typeof fetch;
  now: () => number;
}): OpsSources {
  const fetchImpl = options.fetch ?? fetch;
  const token = metadataTokens(fetchImpl, options.now);
  const shared = { config: options.config, fetch: fetchImpl, now: options.now };
  return {
    monitoring: createMonitoringSource({ ...shared, token }),
    billing: createBillingSource({ ...shared, token }),
    twilio: createTwilioSource(shared),
    postmark: createPostmarkSource(shared),
    stripe: createStripeSource(shared),
    monthlyBudget: options.config.monthlyBudget,
    project: options.config.project,
  };
}

/** Every source switched off, with one reason. For tests and unconfigured runs. */
export function noSources(reason = 'Not configured.'): OpsSources {
  const off = () => Promise.resolve(unavailable<never>(reason));
  return {
    monitoring: off,
    billing: off,
    twilio: off,
    postmark: off,
    stripe: off,
    monthlyBudget: null,
    project: null,
  };
}
