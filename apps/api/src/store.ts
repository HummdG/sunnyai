import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Product, RecommendationWant } from '@sunny/contracts';

/**
 * Persistence, behind an interface.
 *
 * The first vertical slice writes newline-delimited JSON to disk. That is a real
 * store -- conversations survive a restart and can be read back -- but it is not
 * the production store, and the interface exists so the swap to Firestore is a
 * new implementation of these two methods rather than a rewrite of the routes.
 *
 * Two properties are load-bearing and must survive that swap:
 *   - appends are idempotent on `clientMessageId`, so a retried request cannot
 *     double-post a visitor's message into the transcript;
 *   - every record carries `tenantId`, and reads are scoped by it. A store that
 *     can return another tenant's transcript is a cross-tenant leak, so the
 *     scoping belongs in the interface rather than in every caller.
 */

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /** Present on user turns: the client's idempotency key. */
  clientMessageId?: string;
  /** Tool calls the assistant made while producing this turn. */
  tools?: string[];
  /**
   * Qualification answers known at the end of this turn, as structured data.
   *
   * Recorded here rather than re-derived from the assistant's prose: parsing a
   * sentence back into an answer is how a resumed session ends up re-asking a
   * question, or worse, recording the wrong one.
   */
  answers?: Record<string, string>;
}

export interface Conversation {
  id: string;
  tenantId: string;
  sessionId: string;
  turns: ConversationTurn[];
  /**
   * Qualification answers, independent of any turn.
   *
   * This is the standing map -- the current best answer to everything asked so
   * far -- and it is *last write wins*. Both paths maintain it: a turn writes
   * the map it ended with, and `POST /v1/qualification/answer` writes the single
   * answer it was given. That is deliberate. Keeping the route's answers
   * somewhere else, so that two maps had to be merged on read, would mean
   * choosing a winner between "the visitor told the chat X" and "the visitor
   * told the form Y" with nothing to decide it by except which code path ran
   * last -- and the answer the visitor gave most recently is the one that
   * should win.
   *
   * Absent on conversations written before the field existed. Readers fall back
   * to the per-turn maps, so an old record still resumes correctly.
   */
  answers?: Record<string, string>;
  /**
   * The recommendation constraints standing on this session.
   *
   * Stored rather than re-derived because "cheaper" is a comparison against the
   * last set, and a set of options cannot be compared to anything unless what it
   * was built from is still on hand. Keeping it here, beside the answers, means
   * a refinement that says nothing about batteries cannot drop the battery the
   * visitor asked for four turns ago -- the merge happens against stored state
   * instead of against the model's recollection of the conversation.
   */
  want?: RecommendationWant;
  createdAt: string;
  updatedAt: string;
}

export interface LeadRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  conversationId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
  summary: string;
  score: number | null;
  createdAt: string;
}

export interface AppendResult {
  conversation: Conversation;
  /** False when the turn was already present and nothing was written. */
  appended: boolean;
}

export interface Store {
  readonly kind: string;
  getConversation(tenantId: string, sessionId: string): Promise<Conversation | null>;
  appendTurn(tenantId: string, sessionId: string, turn: ConversationTurn): Promise<AppendResult>;
  /**
   * Merge answers into the conversation's standing map, creating the
   * conversation if this is the first thing that has happened in it.
   *
   * A merge rather than a replace: the qualification route knows about one
   * answer and must not blank the rest. Returns the conversation as it now
   * stands, so a caller can report what is still outstanding without a second
   * read that could race.
   */
  mergeAnswers(
    tenantId: string,
    sessionId: string,
    answers: Record<string, string>,
  ): Promise<Conversation>;
  saveLead(lead: LeadRecord): Promise<LeadRecord>;
  listLeads(tenantId: string, limit?: number): Promise<LeadRecord[]>;
  /**
   * This tenant's catalogue.
   *
   * Tenant-scoped like everything else, and the scope is the whole point: a
   * price list is the installer's commercial data, and a catalogue read that
   * could cross tenants would put one installer's trade prices in front of
   * another's customers.
   */
  listProducts(tenantId: string): Promise<Product[]>;
  /**
   * Replace this tenant's catalogue, or append to it.
   *
   * Replace is the default because the file an installer uploads *is* their
   * price list: importing a second version on top of the first would leave two
   * prices for one panel, and nothing in a row says which is current. Returns
   * the catalogue as it now stands.
   */
  saveProducts(
    tenantId: string,
    products: readonly Product[],
    mode: 'replace' | 'append',
  ): Promise<Product[]>;
  /** The constraints standing on this session's recommendations. */
  getWant(tenantId: string, sessionId: string): Promise<RecommendationWant>;
  saveWant(
    tenantId: string,
    sessionId: string,
    want: RecommendationWant,
  ): Promise<RecommendationWant>;
  /** Diagnostics for `/healthz`; must never throw. */
  health(): Promise<{ ok: boolean; detail: string }>;
}

export function newId(prefix: string): string {
  // `crypto.randomUUID` is available on every supported Node. The prefix makes
  // an id recognisable in a log or a support ticket without a lookup table.
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/** A store backed by one append-only file per collection, under `dataDir`. */
export class FileStore implements Store {
  readonly kind = 'file-jsonl';
  #dir: string;
  #conversationCache = new Map<string, Conversation>();
  #leads: LeadRecord[] = [];
  /** Loaded per tenant, on first read: a big catalogue is not loaded at boot. */
  #products = new Map<string, Product[]>();
  #loaded = false;

  constructor(dataDir: string) {
    this.#dir = dataDir;
  }

  get #catalogueDir(): string {
    return join(this.#dir, 'catalogue');
  }

  #catalogueFile(tenantId: string): string {
    return join(this.#catalogueDir, `${encodeURIComponent(tenantId)}.json`);
  }

  async #readProducts(tenantId: string): Promise<Product[]> {
    try {
      const raw = await readFile(this.#catalogueFile(tenantId), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Defensive for the same reason the conversation reader is: a file that
      // names another tenant is not evidence that this tenant owns those rows.
      return parsed.filter(
        (row): row is Product =>
          typeof row === 'object' && row !== null && (row as Product).tenantId === tenantId,
      );
    } catch {
      return [];
    }
  }

  async #ensure(): Promise<void> {
    if (this.#loaded) return;
    await mkdir(this.#dir, { recursive: true });
    await this.#loadLeads();
    this.#loaded = true;
  }

  /**
   * One file per tenant, with sessions as lines inside it. Partitioning by
   * tenant rather than by session is what makes the cross-tenant read in
   * `#readConversations` impossible to get wrong: the file boundary *is* the
   * tenant boundary.
   */
  #conversationFile(tenantId: string): string {
    // Both ids are constrained by the contract schemas (no slashes, no dots),
    // so they are safe as path segments; the encode is belt and braces.
    return join(this.#dir, 'conversations', `${encodeURIComponent(tenantId)}.jsonl`);
  }

  async getConversation(tenantId: string, sessionId: string): Promise<Conversation | null> {
    await this.#ensure();
    const cached = this.#conversationCache.get(`${tenantId}:${sessionId}`);
    if (cached) return cached;
    const all = await this.#readConversations(tenantId);
    const found = all.find((c) => c.sessionId === sessionId) ?? null;
    if (found) this.#conversationCache.set(`${tenantId}:${sessionId}`, found);
    return found;
  }

  async appendTurn(
    tenantId: string,
    sessionId: string,
    turn: ConversationTurn,
  ): Promise<AppendResult> {
    await this.#ensure();
    const existing = await this.getConversation(tenantId, sessionId);

    // Idempotency: a retried POST with the same clientMessageId is a no-op. The
    // alternative -- trusting the network -- means a flaky connection silently
    // duplicates the visitor's question in the transcript.
    if (
      turn.clientMessageId !== undefined &&
      existing?.turns.some((t) => t.clientMessageId === turn.clientMessageId)
    ) {
      return { conversation: existing, appended: false };
    }

    const now = new Date().toISOString();
    const conversation: Conversation = existing
      ? { ...existing, turns: [...existing.turns, turn], updatedAt: now }
      : {
          id: newId('conv'),
          tenantId,
          sessionId,
          turns: [turn],
          createdAt: now,
          updatedAt: now,
        };

    await mkdir(join(this.#dir, 'conversations'), { recursive: true });
    await appendFile(this.#conversationFile(tenantId), `${JSON.stringify(conversation)}\n`, 'utf8');
    this.#conversationCache.set(`${tenantId}:${sessionId}`, conversation);
    return { conversation, appended: true };
  }

  async mergeAnswers(
    tenantId: string,
    sessionId: string,
    answers: Record<string, string>,
  ): Promise<Conversation> {
    await this.#ensure();
    const existing = await this.getConversation(tenantId, sessionId);
    const now = new Date().toISOString();
    // Spread `existing` first so `turns` and `createdAt` survive; this write is
    // an amendment to the conversation, not a replacement of it.
    const conversation: Conversation = existing
      ? { ...existing, answers: { ...existing.answers, ...answers }, updatedAt: now }
      : {
          id: newId('conv'),
          tenantId,
          sessionId,
          turns: [],
          answers: { ...answers },
          createdAt: now,
          updatedAt: now,
        };

    await mkdir(join(this.#dir, 'conversations'), { recursive: true });
    await appendFile(this.#conversationFile(tenantId), `${JSON.stringify(conversation)}\n`, 'utf8');
    this.#conversationCache.set(`${tenantId}:${sessionId}`, conversation);
    return conversation;
  }

  async saveLead(lead: LeadRecord): Promise<LeadRecord> {
    await this.#ensure();
    await mkdir(join(this.#dir, 'leads'), { recursive: true });
    await appendFile(
      join(this.#dir, 'leads', `${encodeURIComponent(lead.tenantId)}.jsonl`),
      `${JSON.stringify(lead)}\n`,
      'utf8',
    );
    this.#leads.push(lead);
    return lead;
  }

  async listLeads(tenantId: string, limit = 50): Promise<LeadRecord[]> {
    await this.#ensure();
    return this.#leads
      .filter((l) => l.tenantId === tenantId)
      .slice(-limit)
      .reverse();
  }

  async listProducts(tenantId: string): Promise<Product[]> {
    await this.#ensure();
    const cached = this.#products.get(tenantId);
    if (cached) return [...cached];
    const loaded = await this.#readProducts(tenantId);
    this.#products.set(tenantId, loaded);
    return [...loaded];
  }

  async saveProducts(
    tenantId: string,
    products: readonly Product[],
    mode: 'replace' | 'append',
  ): Promise<Product[]> {
    await this.#ensure();
    const merged =
      mode === 'append' ? [...(await this.listProducts(tenantId)), ...products] : [...products];

    // A whole-file rewrite rather than an append, unlike leads: a catalogue is a
    // state, not a log, and a replace has to be able to *remove* a price. An
    // append-only file would need tombstones to express that, which is a
    // database's job and not this store's.
    await mkdir(this.#catalogueDir, { recursive: true });
    await writeFile(this.#catalogueFile(tenantId), JSON.stringify(merged), 'utf8');
    this.#products.set(tenantId, merged);
    return [...merged];
  }

  async getWant(tenantId: string, sessionId: string): Promise<RecommendationWant> {
    const conversation = await this.getConversation(tenantId, sessionId);
    return conversation?.want ?? {};
  }

  async saveWant(
    tenantId: string,
    sessionId: string,
    want: RecommendationWant,
  ): Promise<RecommendationWant> {
    await this.#ensure();
    const existing = await this.getConversation(tenantId, sessionId);
    const now = new Date().toISOString();
    // A replacement, not a merge: the caller has already merged the standing
    // constraints with the refinement, and merging again here would make the
    // stored result depend on which layer did it.
    const conversation: Conversation = existing
      ? { ...existing, want: { ...want }, updatedAt: now }
      : {
          id: newId('conv'),
          tenantId,
          sessionId,
          turns: [],
          want: { ...want },
          createdAt: now,
          updatedAt: now,
        };

    await mkdir(join(this.#dir, 'conversations'), { recursive: true });
    await appendFile(this.#conversationFile(tenantId), `${JSON.stringify(conversation)}\n`, 'utf8');
    this.#conversationCache.set(`${tenantId}:${sessionId}`, conversation);
    return conversation.want ?? {};
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      await mkdir(this.#dir, { recursive: true });
      return { ok: true, detail: `writing to ${this.#dir}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The last write wins, so re-reading a file replays it and keeps the tail. */
  async #readConversations(tenantId: string): Promise<Conversation[]> {
    const dir = join(this.#dir, 'conversations');
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const file = `${encodeURIComponent(tenantId)}.jsonl`;
    if (!names.includes(file)) return [];
    const raw = await readFile(join(dir, file), 'utf8');
    const bySession = new Map<string, Conversation>();
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const parsed = JSON.parse(line) as Conversation;
        // Defensive: a file written by another tenant id must never be served.
        if (parsed.tenantId !== tenantId) continue;
        bySession.set(parsed.sessionId, parsed);
      } catch {
        // A truncated final line is what a crash mid-append looks like. Skip it
        // rather than failing the whole read.
      }
    }
    return [...bySession.values()];
  }

  async #loadLeads(): Promise<void> {
    const dir = join(this.#dir, 'leads');
    try {
      for (const name of await readdir(dir)) {
        const raw = await readFile(join(dir, name), 'utf8');
        for (const line of raw.split('\n')) {
          if (line.trim() === '') continue;
          try {
            this.#leads.push(JSON.parse(line) as LeadRecord);
          } catch {
            /* skip a torn line */
          }
        }
      }
    } catch {
      /* no leads yet */
    }
  }
}
