import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * What the email add-on has to remember between messages, per tenant.
 *
 * Kept apart from the conversation store on purpose: none of it is a visitor's
 * words. It is bookkeeping -- which inbound messages were already handled (so a
 * provider's retry does not draft twice), how many automatic replies a sender
 * has had today (Blueprint §5: at most three), the month's usage counters, the
 * encrypted mailbox token, the Gmail watch cursor, and which draft answers which
 * thread (so the installer's inbox can link to it).
 */

export type EmailOutcome = 'drafted' | 'sent' | 'skipped' | 'failed';

export interface ProcessedRecord {
  /** The inbound message's key (provider id or RFC 5322 Message-ID). */
  key: string;
  outcome: EmailOutcome | 'processing';
  reason: string | null;
  sessionId: string | null;
  draftId: string | null;
  at: string;
}

export interface ThreadLink {
  sessionId: string;
  provider: 'gmail' | 'outlook' | 'none';
  draftId: string | null;
  /** Where a person opens the draft, when the provider has such a link. */
  webLink: string | null;
  sentMessageId: string | null;
  outcome: EmailOutcome;
  subject: string;
  at: string;
  /** The reply text, so the inbox can show it (and a forwarded-only tenant can copy it). */
  draftText: string;
  /** Notes for the reviewer: why it was not auto-sent, escalations, suspicions. */
  notes: string[];
}

export interface EmailUsage {
  processed: number;
  drafts: number;
  autoSends: number;
  skipped: number;
}

export interface StoredToken {
  provider: 'gmail' | 'outlook';
  /** AES-256-GCM ciphertext of the refresh token (see `crypto.ts`). */
  ciphertext: string;
  /** The mailbox the token belongs to. */
  mailbox: string | null;
  scopes: string[];
  connectedAt: string;
}

export interface GmailWatch {
  mailbox: string;
  historyId: string;
  expiration: string | null;
}

export interface EmailStateStore {
  /**
   * Claim an inbound message for processing. Returns the existing record when it
   * was claimed before (a retry, or a duplicate delivery), and null when this
   * caller now owns it.
   */
  claim(tenantId: string, key: string, at: string): Promise<ProcessedRecord | null>;
  finish(tenantId: string, record: ProcessedRecord): Promise<void>;
  autoRepliesToday(tenantId: string, sender: string, day: string): Promise<number>;
  recordAutoReply(tenantId: string, sender: string, day: string): Promise<void>;
  /** Inbound messages from one sender today, auto or not, for the abuse ceiling. */
  messagesToday(tenantId: string, sender: string, day: string): Promise<number>;
  recordMessage(tenantId: string, sender: string, day: string): Promise<void>;
  addUsage(tenantId: string, month: string, delta: Partial<EmailUsage>): Promise<void>;
  usage(tenantId: string, month: string): Promise<EmailUsage>;
  putToken(tenantId: string, token: StoredToken): Promise<void>;
  getToken(tenantId: string): Promise<StoredToken | null>;
  deleteToken(tenantId: string): Promise<void>;
  putWatch(tenantId: string, watch: GmailWatch): Promise<void>;
  getWatch(tenantId: string): Promise<GmailWatch | null>;
  /** The tenant whose Gmail watch reports for this mailbox, from a push. */
  tenantForMailbox(mailbox: string): Promise<string | null>;
  putThread(tenantId: string, link: ThreadLink): Promise<void>;
  getThread(tenantId: string, sessionId: string): Promise<ThreadLink | null>;
}

export interface TenantState {
  processed: Record<string, ProcessedRecord>;
  /** `${day}|${sender}` → count */
  autoReplies: Record<string, number>;
  messages: Record<string, number>;
  usage: Record<string, EmailUsage>;
  token: StoredToken | null;
  watch: GmailWatch | null;
  threads: Record<string, ThreadLink>;
}

const EMPTY_USAGE: EmailUsage = { processed: 0, drafts: 0, autoSends: 0, skipped: 0 };

export function emptyState(): TenantState {
  return {
    processed: {},
    autoReplies: {},
    messages: {},
    usage: {},
    token: null,
    watch: null,
    threads: {},
  };
}

/** Sender addresses compare case-insensitively. */
function senderKey(day: string, sender: string): string {
  return `${day}|${sender.trim().toLowerCase()}`;
}

/** Days of per-sender counters kept; older ones are dropped on write. */
const COUNTER_DAYS = 3;
/** Processed-message records kept per tenant; the oldest go first. */
const MAX_PROCESSED = 5000;

function prune(state: TenantState, today: string): void {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - COUNTER_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const map of [state.autoReplies, state.messages]) {
    for (const key of Object.keys(map)) if (key.slice(0, 10) < cutoff) delete map[key];
  }
  const keys = Object.keys(state.processed);
  if (keys.length > MAX_PROCESSED) {
    const oldest = keys
      .map((k) => [k, state.processed[k]!.at] as const)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .slice(0, keys.length - MAX_PROCESSED);
    for (const [k] of oldest) delete state.processed[k];
  }
}

/**
 * The in-memory implementation, and the base the file one persists. Every
 * mutation runs through `mutate`, which the file store overrides to read, apply
 * and write atomically under a per-tenant lock.
 */
export class MemoryEmailState implements EmailStateStore {
  protected states = new Map<string, TenantState>();

  protected load(tenantId: string): Promise<TenantState> {
    let state = this.states.get(tenantId);
    if (!state) {
      state = emptyState();
      this.states.set(tenantId, state);
    }
    return Promise.resolve(state);
  }

  protected async mutate<T>(tenantId: string, apply: (state: TenantState) => T): Promise<T> {
    return apply(await this.load(tenantId));
  }

  async claim(tenantId: string, key: string, at: string): Promise<ProcessedRecord | null> {
    return this.mutate(tenantId, (state) => {
      const existing = state.processed[key];
      if (existing) return { ...existing };
      state.processed[key] = {
        key,
        outcome: 'processing',
        reason: null,
        sessionId: null,
        draftId: null,
        at,
      };
      return null;
    });
  }

  async finish(tenantId: string, record: ProcessedRecord): Promise<void> {
    await this.mutate(tenantId, (state) => {
      state.processed[record.key] = { ...record };
    });
  }

  async autoRepliesToday(tenantId: string, sender: string, day: string): Promise<number> {
    return (await this.load(tenantId)).autoReplies[senderKey(day, sender)] ?? 0;
  }

  async recordAutoReply(tenantId: string, sender: string, day: string): Promise<void> {
    await this.mutate(tenantId, (state) => {
      const key = senderKey(day, sender);
      state.autoReplies[key] = (state.autoReplies[key] ?? 0) + 1;
      prune(state, day);
    });
  }

  async messagesToday(tenantId: string, sender: string, day: string): Promise<number> {
    return (await this.load(tenantId)).messages[senderKey(day, sender)] ?? 0;
  }

  async recordMessage(tenantId: string, sender: string, day: string): Promise<void> {
    await this.mutate(tenantId, (state) => {
      const key = senderKey(day, sender);
      state.messages[key] = (state.messages[key] ?? 0) + 1;
      prune(state, day);
    });
  }

  async addUsage(tenantId: string, month: string, delta: Partial<EmailUsage>): Promise<void> {
    await this.mutate(tenantId, (state) => {
      const current = { ...EMPTY_USAGE, ...state.usage[month] };
      for (const [field, value] of Object.entries(delta) as [keyof EmailUsage, number][]) {
        current[field] += value;
      }
      state.usage[month] = current;
    });
  }

  async usage(tenantId: string, month: string): Promise<EmailUsage> {
    return { ...EMPTY_USAGE, ...(await this.load(tenantId)).usage[month] };
  }

  async putToken(tenantId: string, token: StoredToken): Promise<void> {
    await this.mutate(tenantId, (state) => {
      state.token = { ...token };
    });
  }

  async getToken(tenantId: string): Promise<StoredToken | null> {
    const token = (await this.load(tenantId)).token;
    return token ? { ...token } : null;
  }

  async deleteToken(tenantId: string): Promise<void> {
    await this.mutate(tenantId, (state) => {
      state.token = null;
      state.watch = null;
    });
  }

  async putWatch(tenantId: string, watch: GmailWatch): Promise<void> {
    await this.mutate(tenantId, (state) => {
      state.watch = { ...watch, mailbox: watch.mailbox.toLowerCase() };
    });
  }

  async getWatch(tenantId: string): Promise<GmailWatch | null> {
    const watch = (await this.load(tenantId)).watch;
    return watch ? { ...watch } : null;
  }

  async tenantForMailbox(mailbox: string): Promise<string | null> {
    const wanted = mailbox.trim().toLowerCase();
    for (const tenantId of await this.tenantIds()) {
      const watch = (await this.load(tenantId)).watch;
      if (watch?.mailbox === wanted) return tenantId;
    }
    return null;
  }

  protected tenantIds(): Promise<string[]> {
    return Promise.resolve([...this.states.keys()]);
  }

  async putThread(tenantId: string, link: ThreadLink): Promise<void> {
    await this.mutate(tenantId, (state) => {
      state.threads[link.sessionId] = { ...link };
    });
  }

  async getThread(tenantId: string, sessionId: string): Promise<ThreadLink | null> {
    const link = (await this.load(tenantId)).threads[sessionId];
    return link ? { ...link } : null;
  }
}

/**
 * One JSON file per tenant under `<dataDir>/email/`, written by temp file and
 * rename so a crash mid-write leaves the previous state rather than half a file.
 * Writes for one tenant are serialised, so two webhooks racing on the same
 * tenant cannot both claim the same message.
 */
export class FileEmailState extends MemoryEmailState {
  readonly #dir: string;
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    super();
    this.#dir = join(dataDir, 'email');
  }

  #file(tenantId: string): string {
    return join(this.#dir, `${tenantId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }

  protected override async load(tenantId: string): Promise<TenantState> {
    const cached = this.states.get(tenantId);
    if (cached) return cached;
    let state = emptyState();
    try {
      state = {
        ...emptyState(),
        ...(JSON.parse(await readFile(this.#file(tenantId), 'utf8')) as TenantState),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.states.set(tenantId, state);
    return state;
  }

  protected override async mutate<T>(
    tenantId: string,
    apply: (state: TenantState) => T,
  ): Promise<T> {
    const previous = this.#locks.get(tenantId) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const state = await this.load(tenantId);
        const result = apply(state);
        await mkdir(this.#dir, { recursive: true });
        const file = this.#file(tenantId);
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(state), 'utf8');
        await rename(temp, file);
        return result;
      });
    this.#locks.set(tenantId, run);
    return run;
  }

  protected override async tenantIds(): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    try {
      const names = await readdir(this.#dir);
      return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
    } catch {
      return [...this.states.keys()];
    }
  }
}
