import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { IngestionJob, Product, RecommendationWant } from '@sunny/contracts';

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

/**
 * One of an installer's own documents, as stored.
 *
 * `text` is kept whole rather than as chunks. The chunks are derived -- they
 * change when the chunker changes, and a stored derivation is a second copy of
 * the document that can disagree with the first. Deriving them on read is what
 * makes "the index reflects the stored document" true by construction.
 */
export interface KnowledgeSourceRecord {
  id: string;
  tenantId: string;
  title: string;
  url: string | null;
  version: string;
  text: string;
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
  /** The submitting page's idempotency key, when it sent one. See `saveLead`. */
  clientLeadId?: string;
}

/**
 * What became of a lead submission.
 *
 * - `created`: written. There was no such key.
 * - `replayed`: the key was already on file and the submission matches it, so
 *   the row that stands was returned untouched.
 * - `conflict`: the key was already on file and this submission differs, which is
 *   the caller reusing a key rather than retrying; nothing was written, because
 *   there is no honest way to pick between the two.
 */
export type LeadOutcome = 'created' | 'replayed' | 'conflict';

export interface LeadResult {
  /** The row standing after the call: the one written, or the one matched. */
  lead: LeadRecord;
  outcome: LeadOutcome;
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
   *
   * `remove` is the correction's other half. When a visitor changes an answer,
   * the answers that depended on it may no longer apply, and a merge alone can
   * only ever add -- so the keys to delete are named here in the same write, and
   * a correction stays one atomic amendment rather than a merge and a cleanup
   * that a failure could come between. The decision of *which* keys is the
   * questionnaire's (`reconcile`); this only carries it out.
   */
  mergeAnswers(
    tenantId: string,
    sessionId: string,
    answers: Record<string, string>,
    remove?: readonly string[],
  ): Promise<Conversation>;
  /**
   * File a lead, once.
   *
   * Idempotent on `clientLeadId` when the caller sends one, in the same spirit as
   * `appendTurn`'s `clientMessageId`: a page that cannot tell whether a POST that
   * timed out reached us must be able to send it again without the installer
   * ending up ringing the visitor twice. The key is kept on the row, so the
   * recognition survives a restart -- an in-memory index of keys would forget
   * exactly the submissions most likely to be retried.
   *
   * The returned `outcome` separates a genuine retry from a caller reusing one key
   * for two different submissions; the caller decides what the second one means.
   */
  saveLead(lead: LeadRecord): Promise<LeadResult>;
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
  /**
   * This tenant's documents.
   *
   * Tenant-scoped for the same reason the catalogue is, and one step further: a
   * document is what the assistant answers *from*, so a read that could cross
   * tenants would not merely show one installer another's prices -- it would put
   * another installer's warranty terms in a customer's transcript.
   */
  listKnowledgeSources(tenantId: string): Promise<KnowledgeSourceRecord[]>;
  getKnowledgeSource(tenantId: string, sourceId: string): Promise<KnowledgeSourceRecord | null>;
  /**
   * Create or replace one source, by id.
   *
   * Upsert rather than insert-or-throw, because re-uploading a document that
   * changed is the normal case: the warranty was revised, the version string
   * moves, and the index has to follow. A caller that wants a *new* source
   * omits the id, so a replace can never be an accident of an id colliding.
   */
  putKnowledgeSource(source: KnowledgeSourceRecord): Promise<KnowledgeSourceRecord[]>;
  /**
   * Remove one source, and answer whether there was one.
   *
   * Deleting is a distinct operation rather than an upsert with empty text: a
   * document an installer withdraws must stop being quotable, and a stored empty
   * document would still be a source the assistant believes it has.
   */
  deleteKnowledgeSource(tenantId: string, sourceId: string): Promise<boolean>;
  saveIngestionJob(job: IngestionJob): Promise<IngestionJob>;
  getIngestionJob(tenantId: string, jobId: string): Promise<IngestionJob | null>;
  /** Diagnostics for `/healthz`; must never throw. */
  health(): Promise<{ ok: boolean; detail: string }>;
}

export function newId(prefix: string): string {
  // `crypto.randomUUID` is available on every supported Node. The prefix makes
  // an id recognisable in a log or a support ticket without a lookup table.
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/**
 * Whether two leads carry the same enquiry, for deciding what a repeated key is.
 *
 * Only the fields the visitor supplied are compared. The rest of the record is
 * ours and differs by construction on every call -- a new `id`, a new
 * `createdAt` -- so including any of it would make every retry look like a
 * conflict and the whole key useless. `sessionId` is left out too: a page that
 * lost its session and resubmitted the same enquiry has still sent one enquiry,
 * and the row on file already says which session it arrived in.
 */
function sameSubmission(a: LeadRecord, b: LeadRecord): boolean {
  return (
    a.name === b.name &&
    a.email === b.email &&
    a.phone === b.phone &&
    a.postcode === b.postcode &&
    a.summary === b.summary
  );
}

/** A store backed by one append-only file per collection, under `dataDir`. */
export class FileStore implements Store {
  readonly kind = 'file-jsonl';
  #dir: string;
  #conversationCache = new Map<string, Conversation>();
  #leads: LeadRecord[] = [];
  /** Loaded per tenant, on first read: a big catalogue is not loaded at boot. */
  #products = new Map<string, Product[]>();
  /** Loaded per tenant, on first read, for the same reason. */
  #knowledge = new Map<string, KnowledgeSourceRecord[]>();
  #jobs: IngestionJob[] = [];
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
    await this.#loadJobs();
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
    remove?: readonly string[],
  ): Promise<Conversation> {
    await this.#ensure();
    const existing = await this.getConversation(tenantId, sessionId);
    const now = new Date().toISOString();
    // Merged first, then the named keys deleted: a key that is both set and
    // removed ends up gone, which is the only reading that makes sense -- the
    // "remove" list is the reconciler's verdict on the state after the merge,
    // and it never names the answer just given (that answer's own applicability
    // is `applies` or `pending`, never `conflicts`).
    const merged = { ...existing?.answers, ...answers };
    for (const key of remove ?? []) delete merged[key];
    // Spread `existing` first so `turns` and `createdAt` survive; this write is
    // an amendment to the conversation, not a replacement of it.
    const conversation: Conversation = existing
      ? { ...existing, answers: merged, updatedAt: now }
      : {
          id: newId('conv'),
          tenantId,
          sessionId,
          turns: [],
          answers: merged,
          createdAt: now,
          updatedAt: now,
        };

    await mkdir(join(this.#dir, 'conversations'), { recursive: true });
    await appendFile(this.#conversationFile(tenantId), `${JSON.stringify(conversation)}\n`, 'utf8');
    this.#conversationCache.set(`${tenantId}:${sessionId}`, conversation);
    return conversation;
  }

  async saveLead(lead: LeadRecord): Promise<LeadResult> {
    await this.#ensure();

    // Idempotency, in the same shape as `appendTurn`: a caller that names the
    // submission gets the row it already filed rather than a second one. Scoped
    // to the tenant, because two installers' pages minting the same key -- a
    // naive counter, a template constant -- must not have one swallow the
    // other's visitor.
    if (lead.clientLeadId !== undefined) {
      const standing = this.#leads.find(
        (l) => l.tenantId === lead.tenantId && l.clientLeadId === lead.clientLeadId,
      );
      if (standing) {
        return {
          lead: standing,
          // The same key with different details is not a retry, and choosing
          // between the two rows would silently drop whichever lost. Reported to
          // the caller instead.
          outcome: sameSubmission(standing, lead) ? 'replayed' : 'conflict',
        };
      }
    }

    await mkdir(join(this.#dir, 'leads'), { recursive: true });
    await appendFile(
      join(this.#dir, 'leads', `${encodeURIComponent(lead.tenantId)}.jsonl`),
      `${JSON.stringify(lead)}\n`,
      'utf8',
    );
    this.#leads.push(lead);
    return { lead, outcome: 'created' };
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

  get #knowledgeDir(): string {
    return join(this.#dir, 'knowledge');
  }

  #knowledgeFile(tenantId: string): string {
    return join(this.#knowledgeDir, `${encodeURIComponent(tenantId)}.json`);
  }

  #jobFile(tenantId: string): string {
    return join(this.#dir, 'knowledge-jobs', `${encodeURIComponent(tenantId)}.jsonl`);
  }

  async #readKnowledgeSources(tenantId: string): Promise<KnowledgeSourceRecord[]> {
    try {
      const raw = await readFile(this.#knowledgeFile(tenantId), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // The same defence the catalogue reader makes: a row naming another tenant
      // is not evidence that this tenant owns it.
      return parsed.filter(
        (row): row is KnowledgeSourceRecord =>
          typeof row === 'object' &&
          row !== null &&
          (row as KnowledgeSourceRecord).tenantId === tenantId,
      );
    } catch {
      return [];
    }
  }

  async listKnowledgeSources(tenantId: string): Promise<KnowledgeSourceRecord[]> {
    await this.#ensure();
    const cached = this.#knowledge.get(tenantId);
    if (cached) return [...cached];
    const loaded = await this.#readKnowledgeSources(tenantId);
    this.#knowledge.set(tenantId, loaded);
    return [...loaded];
  }

  async getKnowledgeSource(
    tenantId: string,
    sourceId: string,
  ): Promise<KnowledgeSourceRecord | null> {
    const sources = await this.listKnowledgeSources(tenantId);
    return sources.find((source) => source.id === sourceId) ?? null;
  }

  async putKnowledgeSource(source: KnowledgeSourceRecord): Promise<KnowledgeSourceRecord[]> {
    await this.#ensure();
    const existing = await this.listKnowledgeSources(source.tenantId);
    const index = existing.findIndex((row) => row.id === source.id);
    const merged =
      index === -1
        ? [...existing, { ...source }]
        : existing.map((row, at) => (at === index ? { ...source } : row));

    // A whole-file rewrite, like the catalogue and unlike the job log: sources
    // are a state an installer curates, and deleting one has to be expressible.
    await mkdir(this.#knowledgeDir, { recursive: true });
    await writeFile(this.#knowledgeFile(source.tenantId), JSON.stringify(merged), 'utf8');
    this.#knowledge.set(source.tenantId, merged);
    return [...merged];
  }

  async deleteKnowledgeSource(tenantId: string, sourceId: string): Promise<boolean> {
    await this.#ensure();
    const existing = await this.listKnowledgeSources(tenantId);
    const remaining = existing.filter((row) => row.id !== sourceId);
    if (remaining.length === existing.length) return false;

    await mkdir(this.#knowledgeDir, { recursive: true });
    await writeFile(this.#knowledgeFile(tenantId), JSON.stringify(remaining), 'utf8');
    this.#knowledge.set(tenantId, remaining);
    return true;
  }

  async saveIngestionJob(job: IngestionJob): Promise<IngestionJob> {
    await this.#ensure();
    await mkdir(join(this.#dir, 'knowledge-jobs'), { recursive: true });
    // Append-only, like leads: a job is a record that something happened, and a
    // failed run is worth keeping even when a later run of the same document
    // succeeded.
    await appendFile(this.#jobFile(job.tenantId), `${JSON.stringify(job)}\n`, 'utf8');
    this.#jobs.push(job);
    return job;
  }

  async getIngestionJob(tenantId: string, jobId: string): Promise<IngestionJob | null> {
    await this.#ensure();
    // Scoped by tenant *and* id: a job id is unguessable, but a read that is
    // only keyed by id would still hand another installer's job to a caller who
    // had one, which is exactly the cross-tenant read the plan forbids.
    return this.#jobs.find((job) => job.id === jobId && job.tenantId === tenantId) ?? null;
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

  async #loadJobs(): Promise<void> {
    const dir = join(this.#dir, 'knowledge-jobs');
    try {
      for (const name of await readdir(dir)) {
        const raw = await readFile(join(dir, name), 'utf8');
        for (const line of raw.split('\n')) {
          if (line.trim() === '') continue;
          try {
            this.#jobs.push(JSON.parse(line) as IngestionJob);
          } catch {
            /* skip a torn line */
          }
        }
      }
    } catch {
      /* no ingestion jobs yet */
    }
  }
}
