import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  AuditEvent,
  IngestionJob,
  LeadConsent,
  Product,
  RecommendationWant,
} from '@sunny/contracts';

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
  /**
   * What the visitor agreed to and where -- the wording's version, the surface
   * and the session's origin. See `packages/contracts/src/consent.ts`.
   *
   * Optional because rows written before this field existed are still on disk and
   * are still readable, and because back-filling them at load time would mean
   * *inventing* provenance for a person who agreed to something we can no longer
   * name. Absence therefore means "unknown", which is a fact; a fabricated
   * default would not be. Every lead written now carries one, and a test asserts
   * that from both directions rather than leaving it to habit.
   */
  consent?: LeadConsent;
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

/**
 * What a retention sweep removed.
 *
 * Counts rather than a list of visitors: the audit event for the sweep needs to
 * say that it happened and how much, and naming the people whose data reached the
 * end of its window would put a second copy of exactly that data into the audit
 * trail -- the thing `packages/contracts/src/audit.ts` exists to prevent.
 */
export interface PurgeResult {
  leads: number;
  conversations: number;
  /**
   * One entry per tenant that had at least one record removed, sorted by id.
   *
   * Broken down rather than a bare list of ids because the audit event the sweep
   * writes is per tenant -- an installer asking "did retention run against my
   * data, and how much went" is asking about their own deployment. And these are
   * ids and counts only: the audit event records how much reached the end of its
   * window, never *who*, because naming the visitors would put a second copy of
   * exactly the data the sweep just removed into the trail. See
   * `packages/contracts/src/audit.ts`.
   */
  tenants: Array<{ tenantId: string; leads: number; conversations: number }>;
}

export interface DeletedConversation {
  /** The conversation's own id, or null when this session had none to erase. */
  conversationId: string | null;
  /** The leads that were filed from it and went with it. */
  leads: LeadRecord[];
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
   * Erase one lead, scoped to the tenant that is allowed to see it.
   *
   * Returns the row that was removed, or null when there was none -- and null is
   * deliberately the answer for another tenant's lead too. "There is no such row
   * here" and "that row exists but is not yours" are the same response on purpose:
   * a route that told them apart would let one installer probe another's lead ids.
   *
   * A rewrite of the tenant's file rather than a tombstone, because this is the
   * one operation whose *point* is that the data is gone. An append-only file with
   * a "deleted" marker would leave the visitor's name and phone on disk, which is
   * the thing the request was about.
   */
  deleteLead(tenantId: string, leadId: string): Promise<LeadRecord | null>;
  /**
   * Erase one conversation -- the transcript and the standing answers, which is
   * what a qualification record is -- together with the leads that conversation
   * filed.
   *
   * Returns what went, so a caller can report it: the conversation's id (null when
   * there was none, which is why the return is not a bare list of leads), and the
   * leads themselves. Naming the erased conversation is the point -- a deletion is
   * the one operation a caller cannot verify by looking afterwards, and a blank
   * success body cannot be told apart from a request that did nothing.
   *
   * The two are erased together and cannot come apart: an enquiry left behind
   * after the conversation it came from was erased is a row the visitor asked us
   * not to have, minus the context that made it useful.
   */
  deleteConversation(tenantId: string, sessionId: string): Promise<DeletedConversation>;
  /**
   * Remove every record older than `cutoffMs`, across all tenants.
   *
   * Deliberately not tenant-scoped: retention is a policy of the deployment, not
   * of one installer, and a sweep that had to be run once per tenant would be a
   * policy nobody runs. Returns what went, because a deletion with no record of
   * itself is what the audit trail is for -- see `retention.purge`.
   */
  purgeExpired(cutoffMs: number): Promise<PurgeResult>;
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
  /**
   * Append one audit event.
   *
   * Append-only, and there is deliberately no update and no delete: a log that
   * can be edited answers a different question from the one it exists for. The
   * event is taken whole -- it carries its own `tenantId`, which may be null for
   * an attempt refused before a tenant could be named, so a writer cannot file an
   * event under a tenant the event does not claim.
   */
  appendAuditEvent(event: AuditEvent): Promise<void>;
  /**
   * A tenant's audit events, newest first.
   *
   * Scoped by the tenant like every other read here, and it is the same
   * argument: an audit trail is the record of what was done to one installer's
   * data, so a read that could cross tenants would hand one installer the
   * history of another's. Events with no tenant are not returned by any tenant's
   * read -- they are not that tenant's to see.
   */
  listAuditEvents(tenantId: string, limit?: number): Promise<AuditEvent[]>;
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
  /**
   * The in-flight or finished load, rather than a `#loaded` boolean.
   *
   * The boot-time retention sweep and the first request reach `#ensure` together,
   * and a boolean is read across an `await`: both callers saw `false`, both read
   * the same files, and every lead landed in memory twice -- and therefore back
   * on disk twice at the next rewrite, since a rewrite writes what is in memory.
   * Memoising the promise makes the second caller await the first one's load
   * instead of repeating it.
   */
  #loading: Promise<void> | null = null;

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

  #ensure(): Promise<void> {
    this.#loading ??= this.#load().catch((error: unknown) => {
      // A failure is not cached: the next caller gets to try again rather than
      // every later request inheriting this one's error for the process's life.
      this.#loading = null;
      throw error;
    });
    return this.#loading;
  }

  async #load(): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    await this.#loadLeads();
    await this.#loadJobs();
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
    await appendFile(this.#leadFile(lead.tenantId), `${JSON.stringify(lead)}\n`, 'utf8');
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

  #leadFile(tenantId: string): string {
    return join(this.#dir, 'leads', `${encodeURIComponent(tenantId)}.jsonl`);
  }

  /**
   * The tail of the queue of operations that rewrite a file.
   *
   * Every rewrite is a read-modify-write: it snapshots the in-memory rows, writes
   * a whole new file and swaps it in. Two of them overlapping can therefore lose
   * one outright -- a snapshot taken before an erasure and swapped in after it
   * puts the erased row *back*, undoing a visitor's request -- and they also
   * collide on the single scratch name `#replaceFile` uses, which fails one of
   * them with an error the caller would read as "the deletion did not happen".
   *
   * That pairing is not hypothetical, which is what makes this worth the ten
   * lines: the retention sweep runs at boot and on a timer, so it overlaps the
   * requests being served at the same moment by construction. Appends are
   * deliberately outside the queue -- an append has nothing to lose, and putting
   * one behind a long rewrite would make the visitor's own message wait on a
   * background sweep.
   */
  #rewrites: Promise<unknown> = Promise.resolve();

  /**
   * Run `work` after every rewrite already queued, and queue those after it.
   *
   * The chain is continued on both settle paths, so one failed deletion does not
   * cancel the deletion behind it; the caller still gets the rejection.
   */
  #exclusively<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#rewrites.then(work, work);
    this.#rewrites = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Replace a file's contents, by writing a sibling and renaming over it.
   *
   * Every deletion here is a rewrite, and a rewrite that truncates first has a
   * window in which a crash loses the records that were meant to *survive* -- so
   * the new file is written complete and moved into place, which is atomic on
   * both platforms this runs on.
   *
   * The scratch name is fixed rather than unique, and that is safe only because
   * every caller reaches here through `#exclusively`: two rewrites of one file
   * cannot be in flight together. A unique name would trade this for orphaned
   * scratch files that nothing ever collects.
   */
  async #replaceFile(file: string, contents: string): Promise<void> {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, contents, 'utf8');
    await rename(tmp, file);
  }

  /**
   * Replace a JSONL file with these rows.
   *
   * An emptied file is removed rather than left as a zero-byte one, so "this
   * tenant has nothing" has one representation instead of two.
   */
  async #rewrite(file: string, rows: readonly unknown[]): Promise<void> {
    if (rows.length === 0) {
      await rm(file, { force: true });
      return;
    }
    await this.#replaceFile(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
  }

  /** This tenant's rows as they currently stand in memory. */
  #leadsOf(tenantId: string): LeadRecord[] {
    return this.#leads.filter((l) => l.tenantId === tenantId);
  }

  deleteLead(tenantId: string, leadId: string): Promise<LeadRecord | null> {
    return this.#exclusively(() => this.#deleteLead(tenantId, leadId));
  }

  async #deleteLead(tenantId: string, leadId: string): Promise<LeadRecord | null> {
    await this.#ensure();
    const index = this.#leads.findIndex((l) => l.tenantId === tenantId && l.id === leadId);
    // Null for another tenant's id as well as for one that never existed: telling
    // the two apart is what would let a caller probe for ids that are not theirs.
    if (index < 0) return null;
    const removed = this.#leads.splice(index, 1)[0]!;
    await this.#rewrite(this.#leadFile(tenantId), this.#leadsOf(tenantId));
    return removed;
  }

  deleteConversation(tenantId: string, sessionId: string): Promise<DeletedConversation> {
    return this.#exclusively(() => this.#deleteConversation(tenantId, sessionId));
  }

  async #deleteConversation(tenantId: string, sessionId: string): Promise<DeletedConversation> {
    await this.#ensure();
    const conversations = await this.#readConversations(tenantId);
    const target = conversations.find((c) => c.sessionId === sessionId);

    // The transcript is erased when there is one, and this session's leads are
    // erased either way. Returning early on a missing transcript would leave the
    // enquiry of a visitor who never opened the assistant -- which is every
    // visitor the form route serves -- in place, while answering that their
    // record had been deleted. `conversationId` is null then, and the caller
    // counts that as no conversation rather than guessing at one.
    if (target) {
      await this.#rewrite(
        this.#conversationFile(tenantId),
        conversations.filter((c) => c.sessionId !== sessionId),
      );
      this.#conversationCache.delete(`${tenantId}:${sessionId}`);
    }

    const orphaned = this.#leads.filter(
      (l) => l.tenantId === tenantId && l.sessionId === sessionId,
    );
    if (orphaned.length > 0) {
      this.#leads = this.#leads.filter(
        (l) => !(l.tenantId === tenantId && l.sessionId === sessionId),
      );
      await this.#rewrite(this.#leadFile(tenantId), this.#leadsOf(tenantId));
    }
    return { conversationId: target?.id ?? null, leads: orphaned };
  }

  purgeExpired(cutoffMs: number): Promise<PurgeResult> {
    return this.#exclusively(() => this.#purgeExpired(cutoffMs));
  }

  async #purgeExpired(cutoffMs: number): Promise<PurgeResult> {
    await this.#ensure();
    /** Per tenant, because the audit event the caller writes is per tenant. */
    const counts = new Map<string, { leads: number; conversations: number }>();
    const bump = (tenantId: string, field: 'leads' | 'conversations', by: number): void => {
      const entry = counts.get(tenantId) ?? { leads: 0, conversations: 0 };
      entry[field] += by;
      counts.set(tenantId, entry);
    };

    // Leads by `createdAt`: the enquiry was made once, and nobody has touched the
    // row since, so its age is not in question.
    //
    // `Date.parse` gives NaN for a timestamp that will not parse, and every
    // comparison with NaN is false -- so an undateable row is *kept*. That is the
    // direction a deletion should fail in.
    const expiredLeads = this.#leads.filter((l) => Date.parse(l.createdAt) < cutoffMs);
    if (expiredLeads.length > 0) {
      this.#leads = this.#leads.filter((l) => Date.parse(l.createdAt) >= cutoffMs);
      for (const lead of expiredLeads) bump(lead.tenantId, 'leads', 1);
      for (const tenantId of new Set(expiredLeads.map((l) => l.tenantId))) {
        await this.#rewrite(this.#leadFile(tenantId), this.#leadsOf(tenantId));
      }
    }

    // Conversations by `updatedAt` rather than `createdAt`: a conversation is
    // still being written while the visitor is in it, and expiring one on the day
    // it opened would delete a transcript somebody is looking at.
    let conversations = 0;
    let names: string[] = [];
    try {
      names = await readdir(join(this.#dir, 'conversations'));
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const tenantId = decodeURIComponent(name.slice(0, -'.jsonl'.length));
      const all = await this.#readConversations(tenantId);
      const keep = all.filter((c) => Date.parse(c.updatedAt) >= cutoffMs);
      if (keep.length === all.length) continue;

      // Per session rather than per line: the file holds one line per append, and
      // a session that ran to twenty turns is one conversation, not twenty.
      const kept = new Set(keep.map((c) => c.sessionId));
      const gone = all.filter((c) => !kept.has(c.sessionId));
      conversations += gone.length;
      bump(tenantId, 'conversations', gone.length);
      await this.#rewrite(this.#conversationFile(tenantId), keep);
      for (const removed of gone) {
        this.#conversationCache.delete(`${tenantId}:${removed.sessionId}`);
      }
    }

    const tenants = [...counts.entries()]
      .map(([tenantId, entry]) => ({ tenantId, ...entry }))
      .sort((a, b) => a.tenantId.localeCompare(b.tenantId));
    return { leads: expiredLeads.length, conversations, tenants };
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
    // Through the atomic replace, like every other deletion here: the sources that
    // remain are the records this call exists to protect, and a truncate-then-write
    // would lose all of them to a crash at the wrong instant.
    await this.#replaceFile(this.#knowledgeFile(tenantId), JSON.stringify(remaining));
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

  get #auditDir(): string {
    return join(this.#dir, 'audit');
  }

  /**
   * Where one audit event is filed.
   *
   * A null tenant -- an attempt refused before the caller could name one -- goes
   * to a file whose name says so rather than to some arbitrary tenant's. Filing
   * it under a tenant would be inventing a fact, and dropping it would lose the
   * refusals, which are the half of an audit trail that a security review is
   * usually about.
   */
  #auditFile(tenantId: string | null): string {
    const name = tenantId === null ? '_unscoped.jsonl' : `${encodeURIComponent(tenantId)}.jsonl`;
    return join(this.#auditDir, name);
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    await this.#ensure();
    await mkdir(this.#auditDir, { recursive: true });
    // Append-only, like leads and unlike the catalogue: this is a record that
    // something happened, and a rewrite would make it possible to lose one.
    await appendFile(this.#auditFile(event.tenantId), `${JSON.stringify(event)}\n`, 'utf8');
  }

  async listAuditEvents(tenantId: string, limit = 100): Promise<AuditEvent[]> {
    await this.#ensure();
    let raw: string;
    try {
      raw = await readFile(this.#auditFile(tenantId), 'utf8');
    } catch {
      return [];
    }

    const rows: AuditEvent[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const parsed = JSON.parse(line) as AuditEvent;
        // The defence every reader in this file makes: a line naming another
        // tenant is not evidence that this tenant owns it. Here it also catches
        // the unscoped file being read by mistake, whose events have no tenant.
        if (parsed.tenantId !== tenantId) continue;
        rows.push(parsed);
      } catch {
        // A torn final line is what a crash mid-append looks like.
      }
    }
    // Newest first: an audit trail is read from the recent end.
    return rows.slice(-limit).reverse();
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
        // A leftover half of an interrupted rewrite: it holds rows that are either
        // already in the real file or deliberately gone from it, so reading it
        // would resurrect a deleted lead.
        if (!name.endsWith('.jsonl')) continue;
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
