import { randomUUID } from 'node:crypto';

import type { Store } from '../store.js';
import { dayKey, mergeCounts, type OpsDay, type OpsErrorEvent, type OpsLedger } from './ledger.js';

/**
 * Operations telemetry: what the platform did, counted per day and per
 * installer, for the staff dashboard.
 *
 * ## Counted at the boundaries, not in the features
 *
 * Every chat and email turn is written through `store.appendTurn`, every
 * lead through `store.saveLead`, every ingestion job and roof assessment through
 * their own `save`. So the counting happens there, in `instrumentStore`, rather
 * than in a line added to each feature: a channel added next quarter is counted
 * the day it writes its first turn, without anybody remembering to.
 *
 * Errors are counted the same way, from the other boundary every failure already
 * crosses: the log. `loggerHooks` sees every `error`-level line the API writes
 * (`unhandled error`, `chat turn failed`, `knowledge sync crashed`, ...) and
 * records it, so a failure somebody bothered to log is a failure the dashboard
 * shows.
 *
 * ## Off the request path
 *
 * `count` and `error` only touch memory. A timer flushes the totals every
 * `flushMs` as increments, so a busy minute is a handful of writes rather than
 * one per request, and a slow or failing ledger never slows a visitor's reply.
 * The cost is that a crash loses at most one interval of counts -- acceptable
 * for a dashboard, and why nothing here is used for billing.
 */

/**
 * The counters, closed for the same reason the audit vocabulary is: a counter
 * that can be named anything is one nobody can chart. A counter may carry one
 * dimension after `@` (a channel, a model, an error source).
 */
export const COUNTERS = [
  /** Assistant replies, `@channel`. */
  'turns',
  /** Visitor messages, `@channel`. */
  'messages',
  /** Model calls behind assistant turns, `@model`. */
  'model_calls',
  'tokens_in',
  'tokens_out',
  /** Safety escalations answered without the model. */
  'escalations',
  /** New leads (a replayed submission is not counted again). */
  'leads',
  /** Knowledge ingestion jobs that finished, `@upload|website|drive`. */
  'ingest_ok',
  'ingest_failed',
  /** Roof assessments that finished. */
  'sunscan_ok',
  'sunscan_failed',
  /** Error-level log lines, `@source`. */
  'errors',
  /** Requests the in-app rate limiter refused, `@scope`. */
  'rate_limited',
] as const;
export type Counter = (typeof COUNTERS)[number];

/** Durations recorded as histograms, so percentiles survive being summed. */
export const TIMINGS = [
  /** Model time to first chunk. */
  'ttfb_ms',
  /** Whole assistant turn, tools included. */
  'turn_ms',
] as const;
export type Timing = (typeof TIMINGS)[number];

/**
 * Bucket upper bounds, in ms. A percentile read back from these is the bound of
 * the bucket it falls in -- coarse, but honest in the same way the nearest-rank
 * percentile in `latency.ts` is: it never reports a speed faster than reality.
 * Durations past the last bound land in an overflow bucket.
 */
export const TIMING_BOUNDS_MS = [100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000] as const;

export function bucketOf(ms: number): number {
  const index = TIMING_BOUNDS_MS.findIndex((bound) => ms <= bound);
  return index === -1 ? TIMING_BOUNDS_MS.length : index;
}

/**
 * The p-th percentile of a timing from summed counters, as a bucket bound in ms.
 * Null when nothing was measured; the overflow bucket reports as `Infinity`,
 * which the dashboard shows as "over 32 s" rather than inventing a figure.
 */
export function timingPercentile(
  counts: Readonly<Record<string, number>>,
  timing: Timing,
  p: number,
): number | null {
  const buckets = Array.from(
    { length: TIMING_BOUNDS_MS.length + 1 },
    (_, i) => counts[`${timing}#${i}`] ?? 0,
  );
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil(p * total));
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    seen += buckets[i]!;
    if (seen >= rank) return TIMING_BOUNDS_MS[i] ?? Infinity;
  }
  return Infinity;
}

/** A counter's total across its dimensions: `turns` sums `turns@chat`, `turns@email`, ... */
export function counterTotal(counts: Readonly<Record<string, number>>, counter: Counter): number {
  let total = 0;
  for (const [key, n] of Object.entries(counts)) {
    if (key === counter || key.startsWith(`${counter}@`)) total += n;
  }
  return total;
}

/** A counter split by its dimension: `{ chat: 12, email: 3 }`. */
export function counterByDimension(
  counts: Readonly<Record<string, number>>,
  counter: Counter,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(counts)) {
    if (key.startsWith(`${counter}@`)) out[key.slice(counter.length + 1)] = n;
  }
  return out;
}

export interface ErrorReport {
  source: string;
  code: string;
  message: string;
  tenantId?: string | null;
  requestId?: string | null;
}

export interface Telemetry {
  count(counter: Counter, n?: number, options?: { tenantId?: string | null; dim?: string }): void;
  timing(timing: Timing, ms: number, tenantId?: string | null): void;
  error(report: ErrorReport): void;
  /** Write what is buffered. Safe to call at any time; never throws. */
  flush(): Promise<void>;
  /** Stop the timer and flush once more. */
  stop(): Promise<void>;
}

export interface TelemetryOptions {
  ledger: OpsLedger;
  now: () => number;
  /** How often buffered counts are written. 0 disables the timer (tests flush by hand). */
  flushMs?: number;
  /** Distinct errors kept per flush; the rest are counted but not stored. */
  maxErrorsPerFlush?: number;
  /** Where a failed write goes. Wire it to the log -- but not at error level. */
  onFailure?: (error: unknown) => void;
}

/** Emails, then anything shaped like a phone number, then the length. */
export function redact(message: string): string {
  return message
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[number]')
    .slice(0, 300);
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
  const { ledger, now } = options;
  const maxErrors = options.maxErrorsPerFlush ?? 50;
  /** `day|tenant` → counters. The empty tenant is the platform. */
  let counts = new Map<string, OpsDay>();
  let errors = new Map<string, OpsErrorEvent>();
  let flushing: Promise<void> | null = null;

  function add(key: string, n: number, tenantId: string | null | undefined): void {
    const day = dayKey(now());
    for (const scope of tenantId ? [null, tenantId] : [null]) {
      const id = `${day}|${scope ?? ''}`;
      const entry = counts.get(id) ?? { day, tenantId: scope, counts: {} };
      entry.counts[key] = (entry.counts[key] ?? 0) + n;
      counts.set(id, entry);
    }
  }

  async function flush(): Promise<void> {
    // One flush at a time: the timer and `stop` can arrive together.
    if (flushing) return flushing;
    const days = [...counts.values()];
    const events = [...errors.values()];
    counts = new Map();
    errors = new Map();
    if (days.length === 0 && events.length === 0) return;
    flushing = (async () => {
      try {
        await ledger.add(days);
        await ledger.appendErrors(events);
      } catch (error) {
        // Put the counts back so the next flush retries them. Errors are not
        // retried: they are samples, and a ledger that cannot take them now is
        // itself the error the operator will see in the log.
        for (const day of days) {
          const id = `${day.day}|${day.tenantId ?? ''}`;
          const current = counts.get(id);
          counts.set(id, {
            ...day,
            counts: mergeCounts(day.counts, current?.counts ?? {}),
          });
        }
        options.onFailure?.(error);
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  const timer =
    (options.flushMs ?? 15_000) > 0
      ? setInterval(() => void flush(), options.flushMs ?? 15_000)
      : null;
  timer?.unref();

  return {
    count(counter, n = 1, opts = {}) {
      if (n === 0 || !Number.isFinite(n)) return;
      add(opts.dim ? `${counter}@${opts.dim}` : counter, n, opts.tenantId);
    },
    timing(timing, ms, tenantId) {
      if (!Number.isFinite(ms) || ms < 0) return;
      add(`${timing}#${bucketOf(ms)}`, 1, tenantId);
    },
    error(report) {
      add(`errors@${report.source}`, 1, report.tenantId);
      const key = `${report.source}|${report.code}|${report.tenantId ?? ''}`;
      const existing = errors.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      if (errors.size >= maxErrors) return;
      errors.set(key, {
        id: `err_${randomUUID()}`,
        at: new Date(now()).toISOString(),
        source: report.source.slice(0, 120),
        code: report.code.slice(0, 80),
        message: redact(report.message),
        tenantId: report.tenantId ?? null,
        requestId: report.requestId ?? null,
        count: 1,
      });
    },
    flush,
    async stop() {
      if (timer) clearInterval(timer);
      // Twice: the first may only join a flush already in flight, which took
      // its snapshot before whatever was counted since.
      await flush();
      await flush();
    },
  };
}

/** Records nothing. The default where no ledger is wired. */
export const NO_TELEMETRY: Telemetry = {
  count: () => undefined,
  timing: () => undefined,
  error: () => undefined,
  flush: () => Promise.resolve(),
  stop: () => Promise.resolve(),
};

/**
 * The store, counting what is written through it.
 *
 * A `Proxy` rather than a wrapper class because `Store` has some hundred-odd
 * methods and four of them are interesting; a hand-written delegate would be
 * four methods of meaning buried in a hundred of forwarding. Every method is
 * bound to the real store, so private fields and `instanceof FirestoreStore`
 * (which the email add-on and the ops ledger use to find the database) still work.
 *
 * Counting happens only after the write succeeded, and a counting mistake can
 * never fail the write: the counter calls touch nothing but memory.
 */
export function instrumentStore<S extends Store>(store: S, telemetry: Telemetry): S {
  const counted: Partial<Store> = {
    async appendTurn(tenantId, sessionId, turn) {
      const result = await store.appendTurn(tenantId, sessionId, turn);
      const channel = turn.channel ?? 'chat';
      if (turn.role === 'user') {
        telemetry.count('messages', 1, { tenantId, dim: channel });
        return result;
      }
      telemetry.count('turns', 1, { tenantId, dim: channel });
      if (turn.escalation) telemetry.count('escalations', 1, { tenantId });
      const call = turn.call;
      if (call) {
        const model = call.model ?? call.provider;
        telemetry.count('model_calls', 1, { tenantId, dim: model });
        if (call.usage) {
          telemetry.count('tokens_in', call.usage.inputTokens, { tenantId, dim: model });
          telemetry.count('tokens_out', call.usage.outputTokens, { tenantId, dim: model });
        }
        telemetry.timing('ttfb_ms', call.ttfbMs, tenantId);
        telemetry.timing('turn_ms', call.totalMs, tenantId);
      }
      return result;
    },
    async saveLead(lead) {
      const result = await store.saveLead(lead);
      if (result.outcome === 'created') telemetry.count('leads', 1, { tenantId: lead.tenantId });
      return result;
    },
    async saveIngestionJob(job) {
      const saved = await store.saveIngestionJob(job);
      if (job.status === 'succeeded' || job.status === 'failed') {
        telemetry.count(job.status === 'succeeded' ? 'ingest_ok' : 'ingest_failed', 1, {
          tenantId: job.tenantId,
          dim: job.kind ?? 'upload',
        });
      }
      return saved;
    },
    async saveSunScanAssessment(record) {
      await store.saveSunScanAssessment(record);
      if (record.status === 'failed') {
        telemetry.count('sunscan_failed', 1, { tenantId: record.tenantId });
      } else if (record.status === 'succeeded' || record.status === 'low-confidence') {
        telemetry.count('sunscan_ok', 1, { tenantId: record.tenantId });
      }
    },
  };
  return new Proxy(store, {
    get(target, property) {
      if (typeof property === 'string' && property in counted) {
        return counted[property as keyof Store];
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/** An error's `code` (`ETIMEDOUT`, an `ApiError` code) or class name. */
function errorCode(err: { code?: unknown; name?: unknown } | undefined): string {
  if (typeof err?.code === 'string' || typeof err?.code === 'number') return String(err.code);
  return typeof err?.name === 'string' ? err.name : 'error';
}

/** pino's numeric levels. */
const WARN = 40;
const ERROR = 50;

/**
 * pino `hooks` that copy error-level log lines into telemetry, and count the
 * rate limiter's refusals from its warning.
 *
 * The line is still written exactly as before; this only reads it. The request
 * id comes from the child logger's bindings, which is where Fastify puts it.
 */
export function loggerHooks(telemetry: Telemetry): {
  logMethod: (
    this: { bindings?: () => Record<string, unknown> },
    args: unknown[],
    method: (...args: unknown[]) => void,
    level: number,
  ) => void;
} {
  return {
    logMethod(args, method, level) {
      try {
        if (level >= WARN) {
          const [first, second] = args;
          const object =
            typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {};
          const message =
            typeof first === 'string' ? first : typeof second === 'string' ? second : '';
          if (level >= ERROR) {
            const err = (object['err'] ?? object['error']) as
              { message?: unknown; code?: unknown; name?: unknown } | undefined;
            const bindings = this.bindings?.() ?? {};
            telemetry.error({
              source: message || 'error',
              code: errorCode(err),
              message: typeof err?.message === 'string' ? err.message : message,
              tenantId: typeof object['tenantId'] === 'string' ? object['tenantId'] : null,
              requestId: typeof bindings['reqId'] === 'string' ? bindings['reqId'] : null,
            });
          } else if (message === 'rate limit exceeded') {
            const scope = typeof object['scope'] === 'string' ? object['scope'] : 'unknown';
            telemetry.count('rate_limited', 1, { dim: scope });
          }
        }
      } catch {
        // Telemetry must never be the reason a log line goes missing.
      }
      method.apply(this, args);
    },
  };
}
