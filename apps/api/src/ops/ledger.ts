import { mkdir, readFile, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FieldValue, type Firestore } from '@google-cloud/firestore';

/**
 * Where the operations telemetry lands: daily counters and recent errors, read
 * by the staff dashboard (`routes/admin.ts`).
 *
 * ## Counters, not events
 *
 * The dashboard asks "how many turns, tokens, leads, failures, per day and per
 * installer", and answering that from the conversations themselves means
 * scanning every tenant's every turn -- which is what `/v1/dashboard/metrics`
 * did, and what stops being affordable well before the business is large. So
 * the telemetry recorder (`telemetry.ts`) adds to one document per day per
 * scope instead: `_all` for the platform, and one per tenant. A 90-day chart is
 * then at most 90 × (tenants + 1) small documents, read by one range query.
 *
 * Counter names are opaque strings here (`turns@chat`, `tokens_in@<model>`,
 * `ttfb_ms#3`). Their vocabulary lives in `telemetry.ts`, so this file stays a
 * dumb place to add numbers to.
 *
 * ## Errors are sampled, and kept for 30 days
 *
 * One document per distinct error per flush, with a `count`, rather than one
 * per occurrence: an outage that fails every request would otherwise write as
 * many error records as it had requests, at the moment the store is least able
 * to take them. `expireAt` is what the Firestore TTL policy in
 * `infrastructure/terraform/ops.tf` deletes on.
 */

/** One scope's counters for one UTC day. `tenantId` null is the platform total. */
export interface OpsDay {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  tenantId: string | null;
  counts: Record<string, number>;
}

export interface OpsErrorEvent {
  id: string;
  /** ISO time of the first occurrence in the batch. */
  at: string;
  /** What was being done: the log message (`chat turn failed`), never content. */
  source: string;
  /** The error's code or class name. */
  code: string;
  /** The error message, redacted and truncated by the recorder. */
  message: string;
  tenantId: string | null;
  requestId: string | null;
  /** Occurrences folded into this record. */
  count: number;
}

export interface OpsLedger {
  /** Add `counts` to each scope's day. Increments, so concurrent instances sum. */
  add(days: readonly OpsDay[]): Promise<void>;
  appendErrors(events: readonly OpsErrorEvent[]): Promise<void>;
  /** Every scope's counters for the days `from`..`to` inclusive. */
  days(from: string, to: string): Promise<OpsDay[]>;
  /** The most recent errors, newest first, no older than `sinceIso`. */
  errors(sinceIso: string, limit: number): Promise<OpsErrorEvent[]>;
}

export const ERROR_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day of a timestamp, as `YYYY-MM-DD`. */
export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The `n` UTC days ending with the one containing `now`, oldest first. */
export function lastDays(now: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => dayKey(now - (n - 1 - i) * DAY_MS));
}

const PLATFORM = '_all';

function scopeId(day: OpsDay): string {
  return `${day.day}_${day.tenantId === null ? PLATFORM : encodeURIComponent(day.tenantId)}`;
}

/** Sum two counter maps into a new one. */
export function mergeCounts(
  into: Record<string, number>,
  from: Readonly<Record<string, number>>,
): Record<string, number> {
  const out = { ...into };
  for (const [key, n] of Object.entries(from)) out[key] = (out[key] ?? 0) + n;
  return out;
}

function newestFirst(events: OpsErrorEvent[], sinceIso: string, limit: number): OpsErrorEvent[] {
  return events
    .filter((e) => e.at >= sinceIso)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

export class MemoryOpsLedger implements OpsLedger {
  readonly #days = new Map<string, OpsDay>();
  readonly #errors: OpsErrorEvent[] = [];

  add(days: readonly OpsDay[]): Promise<void> {
    for (const day of days) {
      const id = scopeId(day);
      const current = this.#days.get(id);
      this.#days.set(id, {
        day: day.day,
        tenantId: day.tenantId,
        counts: mergeCounts(current?.counts ?? {}, day.counts),
      });
    }
    return Promise.resolve();
  }

  appendErrors(events: readonly OpsErrorEvent[]): Promise<void> {
    this.#errors.push(...events);
    return Promise.resolve();
  }

  days(from: string, to: string): Promise<OpsDay[]> {
    return Promise.resolve(
      [...this.#days.values()].filter((d) => d.day >= from && d.day <= to).map((d) => ({ ...d })),
    );
  }

  errors(sinceIso: string, limit: number): Promise<OpsErrorEvent[]> {
    return Promise.resolve(newestFirst([...this.#errors], sinceIso, limit));
  }
}

/**
 * Development and single-instance: one JSON file of counters and a JSONL of
 * errors under the API's data directory, like the voice minutes ledger.
 * Writes are serialised in-process; two processes sharing a directory is not a
 * configuration this supports.
 */
export class FileOpsLedger implements OpsLedger {
  readonly #dir: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.#dir = join(dataDir, 'ops');
  }

  get #daysFile(): string {
    return join(this.#dir, 'daily.json');
  }

  get #errorsFile(): string {
    return join(this.#dir, 'errors.jsonl');
  }

  #exclusively<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #readDays(): Promise<Record<string, OpsDay>> {
    try {
      return JSON.parse(await readFile(this.#daysFile, 'utf8')) as Record<string, OpsDay>;
    } catch {
      return {};
    }
  }

  add(days: readonly OpsDay[]): Promise<void> {
    return this.#exclusively(async () => {
      const all = await this.#readDays();
      for (const day of days) {
        const id = scopeId(day);
        all[id] = {
          day: day.day,
          tenantId: day.tenantId,
          counts: mergeCounts(all[id]?.counts ?? {}, day.counts),
        };
      }
      await mkdir(this.#dir, { recursive: true });
      await writeFile(this.#daysFile, JSON.stringify(all), 'utf8');
    });
  }

  appendErrors(events: readonly OpsErrorEvent[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    return this.#exclusively(async () => {
      await mkdir(this.#dir, { recursive: true });
      await appendFile(
        this.#errorsFile,
        events.map((e) => `${JSON.stringify(e)}\n`).join(''),
        'utf8',
      );
    });
  }

  async days(from: string, to: string): Promise<OpsDay[]> {
    const all = await this.#readDays();
    return Object.values(all).filter((d) => d.day >= from && d.day <= to);
  }

  async errors(sinceIso: string, limit: number): Promise<OpsErrorEvent[]> {
    let text: string;
    try {
      text = await readFile(this.#errorsFile, 'utf8');
    } catch {
      return [];
    }
    const events: OpsErrorEvent[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as OpsErrorEvent);
      } catch {
        // A torn final line from a crash is skipped, not fatal.
      }
    }
    return newestFirst(events, sinceIso, limit);
  }
}

/**
 * Counter names carry model ids (`gemini-3.8-flash`), and a dot in a Firestore
 * field name is a path separator in every API that takes a field path. They are
 * stored percent-encoded, dots included, and decoded on the way out.
 */
function encodeKey(key: string): string {
  return encodeURIComponent(key).replace(/\./g, '%2E');
}

function decodeKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/**
 * The multi-instance ledger.
 *
 * - `ops_daily/{day}_{scope}`: `{ day, tenantId, c: { <encoded counter>: n } }`,
 *   added to with `FieldValue.increment`, so every API instance's flush sums
 *   into the same document without a transaction.
 * - `ops_errors/{id}`: one sampled error, with `expireAt` for the TTL policy.
 *
 * Neither read needs a composite index: `days` is a range on the single `day`
 * field, and `errors` orders on `at` with no filter, filtering the age in memory.
 */
export class FirestoreOpsLedger implements OpsLedger {
  readonly #db: Firestore;

  constructor(db: Firestore) {
    this.#db = db;
  }

  async add(days: readonly OpsDay[]): Promise<void> {
    // 500 writes is a Firestore batch's limit.
    for (let i = 0; i < days.length; i += 400) {
      const batch = this.#db.batch();
      for (const day of days.slice(i, i + 400)) {
        const c: Record<string, FieldValue> = {};
        for (const [key, n] of Object.entries(day.counts)) {
          c[encodeKey(key)] = FieldValue.increment(n);
        }
        batch.set(
          this.#db.collection('ops_daily').doc(scopeId(day)),
          { day: day.day, tenantId: day.tenantId, c },
          { merge: true },
        );
      }
      await batch.commit();
    }
  }

  async appendErrors(events: readonly OpsErrorEvent[]): Promise<void> {
    if (events.length === 0) return;
    const batch = this.#db.batch();
    for (const event of events) {
      batch.set(this.#db.collection('ops_errors').doc(event.id), {
        ...event,
        expireAt: new Date(Date.parse(event.at) + ERROR_RETENTION_DAYS * DAY_MS),
      });
    }
    await batch.commit();
  }

  async days(from: string, to: string): Promise<OpsDay[]> {
    const snap = await this.#db
      .collection('ops_daily')
      .where('day', '>=', from)
      .where('day', '<=', to)
      .get();
    return snap.docs.map((doc) => {
      const data = doc.data() as {
        day: string;
        tenantId: string | null;
        c?: Record<string, number>;
      };
      const counts: Record<string, number> = {};
      for (const [key, n] of Object.entries(data.c ?? {})) {
        if (typeof n === 'number') counts[decodeKey(key)] = n;
      }
      return { day: data.day, tenantId: data.tenantId ?? null, counts };
    });
  }

  async errors(sinceIso: string, limit: number): Promise<OpsErrorEvent[]> {
    const snap = await this.#db.collection('ops_errors').orderBy('at', 'desc').limit(limit).get();
    return snap.docs
      .map((doc) => {
        const { expireAt: _expireAt, ...event } = doc.data() as OpsErrorEvent & {
          expireAt?: unknown;
        };
        return event;
      })
      .filter((e) => e.at >= sinceIso);
  }
}
