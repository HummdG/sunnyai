import { Firestore } from '@google-cloud/firestore';

import type { DocumentReference } from '@google-cloud/firestore';

import { newId, sameSubmission } from './store.js';
import type {
  AppendResult,
  Conversation,
  ConversationTurn,
  DeletedConversation,
  KnowledgeSourceRecord,
  LeadRecord,
  LeadResult,
  LeadStatus,
  Membership,
  PurgeResult,
  Store,
} from './store.js';
import type { AssessmentRecord as SunScanAssessmentRecord } from '@sunny/sunscan-adapter';

import type { CatalogueState } from './catalogue/types.js';
import type { QuoteRecord } from './journey/quote.js';
import type { Tenant } from './tenants.js';
import type { AuditEvent, IngestionJob, Product, RecommendationWant } from '@sunny/contracts';

/**
 * The production store: Firestore, behind the same `Store` interface the file
 * store implements.
 *
 * `store.ts` says the interface exists so this swap is "a new implementation of
 * these two methods rather than a rewrite of the routes", and that is what this
 * file is. Nothing in `server.ts` changed to accommodate it, and the contract
 * test suite runs against both, so "the two stores answer the same questions the
 * same way" is a property the test run checks rather than a claim this comment
 * makes.
 *
 * ## The tenant boundary is the path
 *
 * Every tenant-owned record lives under `tenants/{tenantId}/…`, and no method
 * takes a collection path from its caller. So a read that crossed tenants is not
 * something this file has to remember *not* to do -- there is no query in it that
 * could name two tenants, because the tenant is a path segment
 * (`#tenantDoc`). The file store makes the same argument with one file per
 * tenant; here it is the collection path. The `tenantId` field is written on
 * every row as well, and reads still verify it, but that check is the second
 * line of defence and not the boundary itself.
 *
 * The one read that is deliberately not tenant-scoped is `purgeExpired`, which
 * is a policy of the deployment rather than of one installer. It uses a
 * collection-group query and takes each row's tenant from its path, exactly as
 * the file store takes it from the file it read the line out of.
 *
 * ## What the shapes are, and why they are not the file store's
 *
 *   - **A conversation is a document and its turns are a subcollection.** The
 *     file store appends a whole new copy of the conversation per turn and takes
 *     the last line. Firestore has no cheap equivalent, and a growing array field
 *     would hit the 1 MiB document limit inside a long conversation -- with the
 *     failure landing on the visitor who talked the most. Turns are their own
 *     documents instead, so a conversation's size is not bounded by a document's.
 *   - **`_seq` orders turns, and `_ord` orders rows a caller supplied.** Firestore
 *     has no "as I inserted them" order: a query over two rows written in the same
 *     millisecond returns them in whatever order the backend likes. Every list
 *     this store returns to a caller would then be free to shuffle between two
 *     reads, which is visible in the API. So insertion order is *stored*, in a
 *     field whose leading underscore marks it as the store's own rather than part
 *     of the contract, and stripped again on the way out.
 *   - **Lists are sorted in memory, not by the query.** A Firestore `orderBy`
 *     silently *excludes* documents that lack the field being ordered by, so a row
 *     written without one would be invisible rather than merely last. The
 *     collections here are a tenant's own and small; sorting them in the process
 *     costs nothing measurable and removes that failure mode entirely.
 *   - **Timestamps stay ISO strings.** They are what the contracts say and what
 *     the file store wrote, so a record read back from either store has the same
 *     shape. Comparisons parse them rather than comparing strings, so a value
 *     written with an offset is ordered by the instant it names.
 *
 * ## Two properties that are *not* proved by the tests here
 *
 * Both are recorded in `docs/firestore.md` as well, because both are the kind of
 * thing that passes locally and fails on the deployment that matters:
 *
 *   1. **The emulator does not check indexes.** A query needing a composite index
 *      is refused by real Firestore and *allowed* by the emulator, so a green
 *      test run says nothing about whether the deployment has the indexes it
 *      needs. Every query here is therefore written to need only single-field
 *      indexes, which Firestore maintains automatically. The rule that makes that
 *      true is that **no query both filters and orders**: `where` alone and
 *      `orderBy` alone each use one automatic index, and it is the pair that
 *      demands a composite one -- so where a caller's order and a filter are both
 *      wanted, they are two reads or one in-memory sort rather than one query.
 *      That is a property of this *source*, which the emulator cannot be asked to
 *      check, so the guard is `test/firestore-indexes.test.ts`: it parses the file
 *      and fails when a `where` and an `orderBy` land on the same query.
 *   2. **Deleting a document does not delete its subcollections.** Firestore
 *      leaves them behind. Here that would mean a visitor's transcript surviving
 *      the erasure they asked for, so every deletion in this file that removes a
 *      conversation removes its turns in the same operation -- see
 *      `#deleteConversation`.
 */

export interface FirestoreStoreOptions {
  /** The Google Cloud project the database lives in. */
  project: string;
  /** Defaults to `(default)`, the one database a project gets for free. */
  databaseId?: string;
  /**
   * The emulator's `host:port`, when there is one.
   *
   * Passed explicitly rather than read from `FIRESTORE_EMULATOR_HOST` so that a
   * process cannot be pointed at an emulator by the environment alone. The
   * failure that prevents is a deployment whose ambient environment says
   * "emulator" quietly writing a customer's enquiries into a throwaway database
   * -- and `null` here means real Firestore, which is the safe direction for the
   * default to fail in.
   */
  emulatorHost?: string | null;
}

/**
 * A document id, namespaced and escaped.
 *
 * `encodeURIComponent` is what keeps an id the contract allows from becoming a
 * path segment Firestore rejects: a `/` in a session id would otherwise split the
 * document path, which is not an error anywhere else in this file but here. The
 * prefix is not decoration -- Firestore rejects `.` and `..` as document ids
 * outright, and it makes an id visible in the console recognisable as a session
 * rather than a lead.
 */
function docId(prefix: string, key: string): string {
  return `${prefix}_${encodeURIComponent(key)}`;
}

/** The store's own fields, which are never part of a record handed back. */
const SEQ = '_seq';
const ORD = '_ord';

/** A turn as it is stored: the contract's shape plus the ordering field. */
type StoredTurn = ConversationTurn & { [SEQ]?: number };

/** A row whose position a caller chose, plus the ordering field. */
type Ordered<T> = T & { [ORD]?: number };

/**
 * A stored row with the store's own fields taken back off.
 *
 * Every read goes through here, so `_seq` and `_ord` cannot leak into a response
 * by being forgotten in one method -- and the contracts, which are strict about
 * their own shape, are what would notice.
 */
function stripStoreFields<T extends object>(row: T): Omit<T, typeof SEQ | typeof ORD> {
  const { [SEQ]: _seq, [ORD]: _ord, ...rest } = row as Record<string, unknown>;
  void _seq;
  void _ord;
  return rest as Omit<T, typeof SEQ | typeof ORD>;
}

/**
 * Whether a stored timestamp names an instant, for the retention sweep.
 *
 * The file store's reader keeps a row whose `createdAt` will not parse, and the
 * reason is worth restating because the direction matters: every comparison
 * against `NaN` is false, so an undateable row fails the "older than the cutoff"
 * test and survives. A deletion nobody asked for is worse than a retention rule
 * that missed one row.
 *
 * This store reaches the same place from the other side. A query comparing
 * strings would delete a row whose timestamp is empty or malformed -- `''` sorts
 * before any real date -- so the comparison is done on parsed instants and a row
 * that does not parse is kept.
 */
function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** A conversation's turns in the order they were appended, store fields removed. */
function orderedTurns(rows: StoredTurn[]): ConversationTurn[] {
  return [...rows]
    .sort((a, b) => (a[SEQ] ?? 0) - (b[SEQ] ?? 0))
    .map((row) => stripStoreFields(row) as ConversationTurn);
}

export class FirestoreStore implements Store {
  readonly kind = 'firestore';
  #db: Firestore;
  /** Kept because the client does not expose it, and `/healthz` should name it. */
  #project: string;

  constructor(options: FirestoreStoreOptions) {
    this.#project = options.project;
    this.#db = new Firestore({
      projectId: options.project,
      databaseId: options.databaseId ?? '(default)',
      ...(options.emulatorHost ? { host: options.emulatorHost, ssl: false } : {}),
      // A `RecommendationWant` is entirely optional fields, so `undefined` is the
      // ordinary case rather than an edge: a caller who said "cheaper" and nothing
      // else produces an object whose other seven keys are absent. Without this
      // setting the client *rejects* such a write, and the store would have to
      // strip the keys by hand in a dozen places.
      ignoreUndefinedProperties: true,
    });
  }

  /** `tenants/{tenantId}` -- the root every tenant-owned record hangs off. */
  #tenantDoc(tenantId: string) {
    return this.#db.collection('tenants').doc(encodeURIComponent(tenantId));
  }

  /** The tenant a stored row belongs to, read back out of its own path. */
  #tenantOf(path: string): string {
    // `tenants/{tenantId}/{collection}/{id}`: the tenant is always the second
    // segment, which is what makes the sweep's per-tenant counts possible without
    // a second read.
    return decodeURIComponent(path.split('/')[1] ?? '');
  }

  #conversationRef(tenantId: string, sessionId: string) {
    return this.#tenantDoc(tenantId).collection('conversations').doc(docId('s', sessionId));
  }

  /** A conversation's turns, ordered the way they were appended. */
  async #readTurns(tenantId: string, sessionId: string): Promise<ConversationTurn[]> {
    const snap = await this.#conversationRef(tenantId, sessionId).collection('turns').get();
    return orderedTurns(snap.docs.map((doc) => doc.data() as StoredTurn));
  }

  #toConversation(data: Record<string, unknown>, turns: ConversationTurn[]): Conversation {
    return { ...(data as unknown as Conversation), turns };
  }

  async getConversation(tenantId: string, sessionId: string): Promise<Conversation | null> {
    const snap = await this.#conversationRef(tenantId, sessionId).get();
    if (!snap.exists) return null;
    const turns = await this.#readTurns(tenantId, sessionId);
    return this.#toConversation(snap.data() ?? {}, turns);
  }

  /**
   * Append one turn, once.
   *
   * The transaction is doing three jobs at once and all three are needed:
   *
   *   - **Idempotency.** The check is the file store's, against the turns that
   *     are actually there: a retried POST carrying a `clientMessageId` already
   *     on the conversation changes nothing. Reading the query and writing the
   *     conversation inside one transaction is what makes that check hold under
   *     concurrency -- two retries arriving together both read the same turns and
   *     both write the same conversation document, so Firestore makes one of them
   *     retry and see the other's turn.
   *   - **The next `_seq`.** Taken from the maximum already stored rather than
   *     from a counter the conversation would have to keep consistent with its
   *     own turns.
   *   - **The whole record in the answer.** The interface returns the conversation
   *     as it now stands, so the turns are read in full on every append. That is
   *     a read that grows with the conversation; it is what the interface asks
   *     for, and the alternative -- returning a partial record that every caller
   *     has to know not to trust -- would be a contract change, not an
   *     optimisation.
   */
  async appendTurn(
    tenantId: string,
    sessionId: string,
    turn: ConversationTurn,
  ): Promise<AppendResult> {
    const conversationRef = this.#conversationRef(tenantId, sessionId);
    const turns = conversationRef.collection('turns');

    return await this.#db.runTransaction<AppendResult>(async (transaction) => {
      const [snapshot, turnDocs] = await Promise.all([
        transaction.get(conversationRef),
        transaction.get(turns),
      ]);
      // Read as the stored record -- no `turns` -- so that writing it back cannot
      // put a permanently empty `turns` field beside the subcollection that holds
      // the real ones.
      const existing = snapshot.exists
        ? (snapshot.data() as unknown as Omit<Conversation, 'turns'>)
        : null;

      const stored = turnDocs.docs.map((doc) => doc.data() as StoredTurn);
      if (
        // `existing` is part of the condition rather than assumed: the transcript
        // returned below is built from it, and the two documents are written by
        // the same transaction, so a stored turn with nothing above it is a state
        // this store cannot produce.
        existing &&
        turn.clientMessageId !== undefined &&
        stored.some((row) => row.clientMessageId === turn.clientMessageId)
      ) {
        // The transcript is returned here for the same reason every other path
        // returns it: a caller reads `conversation.turns` without asking which
        // branch produced it. Returning the stored record instead handed back a
        // conversation whose `turns` were missing by construction -- the field is
        // not on the document, it *is* the subcollection.
        return {
          conversation: { ...existing, turns: orderedTurns(stored) },
          appended: false,
        };
      }

      const nextSeq = stored.reduce((max, row) => Math.max(max, row[SEQ] ?? 0), 0) + 1;
      const now = new Date().toISOString();
      const conversation: Omit<Conversation, 'turns'> = existing
        ? { ...existing, updatedAt: now }
        : {
            id: newId('conv'),
            tenantId,
            sessionId,
            createdAt: now,
            updatedAt: now,
          };
      // `turn` last so a stored field can never be overwritten by a caller's.
      transaction.set(turns.doc(newId('turn')), { ...turn, [SEQ]: nextSeq });
      transaction.set(conversationRef, conversation);

      const all = orderedTurns([...stored, { ...turn, [SEQ]: nextSeq }]);
      return { conversation: { ...conversation, turns: all }, appended: true };
    });
  }

  /**
   * Merge answers into the standing map, creating the conversation if needed.
   *
   * The whole document is written, not merged into, and that is the difference
   * that makes `remove` work: Firestore's `merge` recurses into maps, so a key
   * simply *absent* from the new map would be left standing rather than deleted.
   * A correction that dropped a dependent answer would then appear to have
   * worked while the old answer stayed on the record. Writing the record whole
   * is also what the file store does.
   */
  async mergeAnswers(
    tenantId: string,
    sessionId: string,
    answers: Record<string, string>,
    remove?: readonly string[],
  ): Promise<Conversation> {
    const conversationRef = this.#conversationRef(tenantId, sessionId);

    return await this.#db.runTransaction<Conversation>(async (transaction) => {
      const [snapshot, turnDocs] = await Promise.all([
        transaction.get(conversationRef),
        transaction.get(conversationRef.collection('turns')),
      ]);
      const existing = snapshot.exists
        ? (snapshot.data() as unknown as Omit<Conversation, 'turns'>)
        : null;

      const merged = { ...existing?.answers, ...answers };
      for (const key of remove ?? []) delete merged[key];

      const now = new Date().toISOString();
      const conversation = existing
        ? { ...existing, answers: merged, updatedAt: now }
        : {
            id: newId('conv'),
            tenantId,
            sessionId,
            answers: merged,
            createdAt: now,
            updatedAt: now,
          };
      transaction.set(conversationRef, conversation);
      // The answer to the caller carries the transcript, as the interface says it
      // does and as the file store's does: a store that returned a conversation
      // with its turns quietly missing would be a caller's bug waiting to happen.
      return {
        ...conversation,
        turns: orderedTurns(turnDocs.docs.map((doc) => doc.data() as StoredTurn)),
      };
    });
  }

  /**
   * File a lead, once.
   *
   * The document id is derived from the caller's key when there is one, so the
   * idempotency check is a point read of the row that would be a duplicate --
   * no query, and no index to declare. Two submissions arriving together both
   * read the same absent document and both write it, so Firestore serialises
   * them and the loser re-runs and finds the winner's row.
   */
  async saveLead(lead: LeadRecord): Promise<LeadResult> {
    const leads = this.#tenantDoc(lead.tenantId).collection('leads');
    const ref =
      lead.clientLeadId !== undefined
        ? leads.doc(docId('key', lead.clientLeadId))
        : leads.doc(docId('lead', lead.id));

    return await this.#db.runTransaction<LeadResult>(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const standing = snapshot.data() as unknown as LeadRecord;
        return {
          lead: standing,
          outcome: sameSubmission(standing, lead) ? 'replayed' : 'conflict',
        };
      }
      transaction.set(ref, lead);
      return { lead, outcome: 'created' };
    });
  }

  /**
   * The newest leads, for the reading path.
   *
   * This one orders in the query rather than in memory, because the limit has to
   * be applied by the database -- sorting in the process would mean reading every
   * lead this tenant has ever had in order to return fifty. It is safe only
   * because `createdAt` is a required field of the contract, so there is no row
   * for the ordering to exclude.
   *
   * The file store's version takes the last `limit` of its file, which is
   * insertion order; here it is `createdAt`. For rows this API wrote they are the
   * same order, since `createdAt` is the clock at insertion.
   */
  async listLeads(tenantId: string, limit = 50): Promise<LeadRecord[]> {
    const snap = await this.#tenantDoc(tenantId)
      .collection('leads')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((doc) => doc.data() as unknown as LeadRecord);
  }

  /** The counting path: every lead, oldest first, complete by construction. */
  async listAllLeads(tenantId: string): Promise<LeadRecord[]> {
    const snap = await this.#tenantDoc(tenantId)
      .collection('leads')
      .orderBy('createdAt', 'asc')
      .get();
    return snap.docs.map((doc) => doc.data() as unknown as LeadRecord);
  }

  async listConversations(tenantId: string): Promise<Conversation[]> {
    const snap = await this.#tenantDoc(tenantId).collection('conversations').get();
    // Read in parallel: the dashboard wants all of a tenant's conversations, and
    // a conversation without its turns is a record with the transcript missing.
    return Promise.all(
      snap.docs.map(async (doc) => {
        const turns = await doc.ref.collection('turns').get();
        return this.#toConversation(
          doc.data(),
          orderedTurns(turns.docs.map((turn) => turn.data() as StoredTurn)),
        );
      }),
    );
  }

  /**
   * Erase one lead.
   *
   * By the record's own id rather than by document id, because the document id
   * encodes the submission key when the caller sent one and the two are not the
   * same thing. The lookup is a single-field equality query, which Firestore
   * indexes without being asked.
   *
   * Null for another tenant's lead as well as for one that never existed, which
   * is the file store's answer too and for its reason: telling the two apart is
   * what would let one installer probe another's ids.
   */
  async deleteLead(tenantId: string, leadId: string): Promise<LeadRecord | null> {
    const leads = this.#tenantDoc(tenantId).collection('leads');
    return await this.#db.runTransaction<LeadRecord | null>(async (transaction) => {
      const found = await transaction.get(leads.where('id', '==', leadId).limit(1));
      const doc = found.docs[0];
      if (!doc) return null;
      const removed = doc.data() as unknown as LeadRecord;
      transaction.delete(doc.ref);
      return removed;
    });
  }

  /**
   * Erase one conversation, its turns, and the leads filed from it.
   *
   * **The turns are deleted explicitly, and this is the single most important
   * line in the file.** Firestore does not cascade a document deletion into its
   * subcollections; deleting the conversation alone would leave every turn of it
   * on the database, which is precisely the visitor data the request was about --
   * and the API would report the erasure as having happened. A test asserts the
   * turns are gone for this reason.
   *
   * A lead filed into this session while this runs can survive it: the transaction
   * locks the lead documents it read, not the collection. The file store has the
   * same race for the same reason, and it is recorded rather than papered over.
   */
  async deleteConversation(tenantId: string, sessionId: string): Promise<DeletedConversation> {
    const conversationRef = this.#conversationRef(tenantId, sessionId);
    const leads = this.#tenantDoc(tenantId).collection('leads');

    return await this.#db.runTransaction<DeletedConversation>(async (transaction) => {
      const [snapshot, turnDocs, leadDocs] = await Promise.all([
        transaction.get(conversationRef),
        transaction.get(conversationRef.collection('turns')),
        transaction.get(leads.where('sessionId', '==', sessionId)),
      ]);

      // The transcript is erased when there is one, and this session's leads are
      // erased either way -- the file store makes the same distinction, and for
      // the same reason: a visitor who used the form without ever opening the
      // assistant still has an enquiry to erase.
      const conversation = snapshot.exists ? (snapshot.data() as unknown as Conversation) : null;
      for (const doc of turnDocs.docs) transaction.delete(doc.ref);
      if (conversation) transaction.delete(conversationRef);
      for (const doc of leadDocs.docs) transaction.delete(doc.ref);

      return {
        conversationId: conversation?.id ?? null,
        leads: leadDocs.docs.map((doc) => doc.data() as unknown as LeadRecord),
      };
    });
  }

  /**
   * Remove every record past its window, across all tenants.
   *
   * The collection-group queries are the reason this method exists outside the
   * tenant-scoped shape of everything else: retention is the deployment's policy,
   * not one installer's, and a sweep that had to be run once per tenant would be a
   * policy nobody runs. Each row's tenant comes from its own path.
   *
   * Expired conversations are removed document by document rather than by a
   * delete-all, because their turns have to go too -- see `deleteConversation`.
   */
  async purgeExpired(cutoffMs: number): Promise<PurgeResult> {
    const counts = new Map<string, { leads: number; conversations: number }>();
    const bump = (tenantId: string, field: 'leads' | 'conversations', by: number): void => {
      const entry = counts.get(tenantId) ?? { leads: 0, conversations: 0 };
      entry[field] += by;
      counts.set(tenantId, entry);
    };

    let leads = 0;
    const expiredLeads = (await this.#db.collectionGroup('leads').get()).docs.filter((doc) => {
      const at = instant(doc.get('createdAt'));
      // Parsed rather than compared as strings, and kept when it will not parse:
      // the direction a deletion should fail in.
      return at !== null && at < cutoffMs;
    });
    if (expiredLeads.length > 0) {
      await this.#writeInChunks(expiredLeads.map((doc) => ({ delete: doc.ref })));
      for (const doc of expiredLeads) {
        leads += 1;
        bump(this.#tenantOf(doc.ref.path), 'leads', 1);
      }
    }

    let conversations = 0;
    const expired = (await this.#db.collectionGroup('conversations').get()).docs.filter((doc) => {
      const at = instant(doc.get('updatedAt'));
      return at !== null && at < cutoffMs;
    });
    const removals: Array<{ delete: DocumentReference }> = [];
    for (const doc of expired) {
      const turns = await doc.ref.collection('turns').get();
      for (const turn of turns.docs) removals.push({ delete: turn.ref });
      removals.push({ delete: doc.ref });
      conversations += 1;
      bump(this.#tenantOf(doc.ref.path), 'conversations', 1);
    }
    if (removals.length > 0) await this.#writeInChunks(removals);

    const tenants = [...counts.entries()]
      .map(([tenantId, entry]) => ({ tenantId, ...entry }))
      .sort((a, b) => a.tenantId.localeCompare(b.tenantId));
    return { leads, conversations, tenants };
  }

  /**
   * Apply a set of deletions in commits small enough to be accepted.
   *
   * A batch is capped at 500 writes and a transaction at the same, so a sweep
   * that found more than that has to send them in more than one commit. This is
   * the one place in the store where a change is not atomic, and it is
   * deliberate: the alternative is a sweep that silently stops working at the
   * size where it starts to matter. A commit that fails leaves the earlier ones
   * applied, which for a deletion is the harmless direction -- the next run
   * finishes the job.
   */
  async #writeInChunks(ops: Array<{ delete: DocumentReference }>): Promise<void> {
    const CHUNK = 400;
    for (let at = 0; at < ops.length; at += CHUNK) {
      const batch = this.#db.batch();
      for (const op of ops.slice(at, at + CHUNK)) batch.delete(op.delete);
      await batch.commit();
    }
  }

  async listProducts(tenantId: string): Promise<Product[]> {
    const snap = await this.#tenantDoc(tenantId).collection('products').get();
    return snap.docs
      .map((doc) => doc.data() as Ordered<Product>)
      .sort((a, b) => (a[ORD] ?? 0) - (b[ORD] ?? 0))
      .map((row) => stripStoreFields(row) as Product);
  }

  /**
   * Replace this tenant's catalogue, or append to it.
   *
   * The position each row was given is stored, because the catalogue's order is
   * the order the installer uploaded it in and the file store keeps exactly that.
   * A replace that only overwrote rows would leave a product the new list dropped
   * in the catalogue for ever, so rows that are no longer present are deleted in
   * the same commit.
   *
   * Rows are keyed by their own id, so an upload that names one id twice leaves
   * one row on the database where the file store would keep both. That is a
   * difference, it is in the direction of the id being an identity, and it is
   * recorded in `docs/firestore.md`.
   */
  async saveProducts(
    tenantId: string,
    products: readonly Product[],
    mode: 'replace' | 'append',
  ): Promise<Product[]> {
    const collection = this.#tenantDoc(tenantId).collection('products');
    // Read in *both* modes. `append` needs the rows already stored to keep them,
    // and `replace` needs them to know what the new list dropped -- the rows in
    // the database are the only place either answer exists, and reading them only
    // for `append` left a replaced catalogue's dropped products in place for ever.
    const before = await this.listProducts(tenantId);
    const stored = mode === 'append' ? [...before, ...products] : [...products];
    const keep = new Set(stored.map((product) => product.id));

    const batch = this.#db.batch();
    for (const [at, product] of stored.entries()) {
      batch.set(collection.doc(docId('p', product.id)), { ...product, [ORD]: at + 1 });
    }
    for (const product of before) {
      if (!keep.has(product.id)) batch.delete(collection.doc(docId('p', product.id)));
    }
    await batch.commit();
    return stored.map((product) => ({ ...product }));
  }

  async getWant(tenantId: string, sessionId: string): Promise<RecommendationWant> {
    const conversation = await this.getConversation(tenantId, sessionId);
    return conversation?.want ?? {};
  }

  /**
   * Record the constraints standing on a session's recommendations.
   *
   * A replacement rather than a merge, for the file store's reason: the caller
   * has already merged the standing constraints with the refinement, and merging
   * again here would make the stored result depend on which layer did it.
   */
  async saveWant(
    tenantId: string,
    sessionId: string,
    want: RecommendationWant,
  ): Promise<RecommendationWant> {
    const conversationRef = this.#conversationRef(tenantId, sessionId);
    return await this.#db.runTransaction<RecommendationWant>(async (transaction) => {
      const snapshot = await transaction.get(conversationRef);
      const existing = snapshot.exists
        ? (snapshot.data() as unknown as Omit<Conversation, 'turns'>)
        : null;
      const now = new Date().toISOString();
      const conversation = existing
        ? { ...existing, want: { ...want }, updatedAt: now }
        : {
            id: newId('conv'),
            tenantId,
            sessionId,
            want: { ...want },
            createdAt: now,
            updatedAt: now,
          };
      transaction.set(conversationRef, conversation);
      return conversation.want ?? {};
    });
  }

  /** This tenant's documents, in the order they were onboarded. */
  async listKnowledgeSources(tenantId: string): Promise<KnowledgeSourceRecord[]> {
    const snap = await this.#tenantDoc(tenantId).collection('knowledge').get();
    return snap.docs
      .map((doc) => doc.data() as Ordered<KnowledgeSourceRecord>)
      .sort((a, b) => (a[ORD] ?? 0) - (b[ORD] ?? 0))
      .map((row) => stripStoreFields(row) as KnowledgeSourceRecord);
  }

  async getKnowledgeSource(
    tenantId: string,
    sourceId: string,
  ): Promise<KnowledgeSourceRecord | null> {
    const snap = await this.#tenantDoc(tenantId)
      .collection('knowledge')
      .doc(docId('k', sourceId))
      .get();
    return snap.exists ? stripStoreFields(snap.data() as Ordered<KnowledgeSourceRecord>) : null;
  }

  /**
   * Create or replace one source, by id.
   *
   * Replacing keeps the source's position, which is what the file store does --
   * a revised warranty should not jump to the end of the installer's list of
   * documents because it was re-uploaded.
   */
  async putKnowledgeSource(source: KnowledgeSourceRecord): Promise<KnowledgeSourceRecord[]> {
    const collection = this.#tenantDoc(source.tenantId).collection('knowledge');
    const existing = await this.listKnowledgeSources(source.tenantId);
    const at = existing.findIndex((row) => row.id === source.id);
    const position = at === -1 ? existing.length + 1 : at + 1;
    await collection.doc(docId('k', source.id)).set({ ...source, [ORD]: position });
    const next =
      at === -1 ? [...existing, source] : existing.map((row, i) => (i === at ? source : row));
    return next.map((row) => ({ ...row }));
  }

  async deleteKnowledgeSource(tenantId: string, sourceId: string): Promise<boolean> {
    const ref = this.#tenantDoc(tenantId).collection('knowledge').doc(docId('k', sourceId));
    return await this.#db.runTransaction<boolean>(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      transaction.delete(ref);
      return true;
    });
  }

  async saveIngestionJob(job: IngestionJob): Promise<IngestionJob> {
    // Keyed by the job's own id, which the server mints. The file store appends
    // and reads back the *first* row with an id, so with unique ids -- which is
    // what `newId` gives -- the two agree; a job id written twice would here be a
    // correction where it is there a second row.
    await this.#tenantDoc(job.tenantId)
      .collection('jobs')
      .doc(docId('job', job.id))
      .set({ ...job });
    return job;
  }

  async getIngestionJob(tenantId: string, jobId: string): Promise<IngestionJob | null> {
    // The tenant is a path segment, so a job id from another installer is not
    // merely filtered out -- it is in a collection this call never names.
    const snap = await this.#tenantDoc(tenantId).collection('jobs').doc(docId('job', jobId)).get();
    return snap.exists ? (snap.data() as IngestionJob) : null;
  }

  /** Where an event with no tenant goes: a collection no tenant read can name. */
  #unscopedAudit() {
    return this.#db.collection('unscoped_audit');
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    const collection =
      event.tenantId === null
        ? this.#unscopedAudit()
        : this.#tenantDoc(event.tenantId).collection('audit');
    // Append-only, and the id is minted here rather than taken from the caller's
    // document id, so two events that arrive in the same millisecond cannot
    // overwrite one another.
    await collection.doc(newId('audit')).set({ ...event });
  }

  /**
   * A tenant's audit events, newest first.
   *
   * Ordered by `at`, which is an ISO instant written by the server's own clock, so
   * the string order is the time order. Ties -- two events in one millisecond --
   * come back in an order the backend chooses, where the file store would return
   * them in the order they were written.
   */
  async listAuditEvents(tenantId: string, limit = 100): Promise<AuditEvent[]> {
    const snap = await this.#tenantDoc(tenantId)
      .collection('audit')
      .orderBy('at', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((doc) => doc.data() as AuditEvent);
  }

  /** Diagnostics for `/healthz`; must never throw. */
  async saveSunScanAssessment(record: SunScanAssessmentRecord): Promise<void> {
    // The tenant is a path segment, so another installer's id names a document
    // in a collection this tenant's reads never touch. Overwritten as the job
    // moves on; the model files live in the artefact store, not here.
    await this.#tenantDoc(record.tenantId)
      .collection('sunscan_assessments')
      .doc(docId('ss', record.id))
      .set(JSON.parse(JSON.stringify(record)) as Record<string, unknown>);
  }

  async getSunScanAssessment(
    tenantId: string,
    id: string,
  ): Promise<SunScanAssessmentRecord | null> {
    const snap = await this.#tenantDoc(tenantId)
      .collection('sunscan_assessments')
      .doc(docId('ss', id))
      .get();
    return snap.exists ? (snap.data() as SunScanAssessmentRecord) : null;
  }

  // ── quotes (journey/quote.ts) ─────────────────────────────────────────────

  async saveQuote(record: QuoteRecord): Promise<void> {
    await this.#tenantDoc(record.tenantId)
      .collection('quotes')
      .doc(docId('q', record.id))
      .set(JSON.parse(JSON.stringify(record)) as Record<string, unknown>);
  }

  async getQuote(tenantId: string, id: string): Promise<QuoteRecord | null> {
    const snap = await this.#tenantDoc(tenantId).collection('quotes').doc(docId('q', id)).get();
    return snap.exists ? (snap.data() as QuoteRecord) : null;
  }

  async listQuotes(tenantId: string, sessionId: string): Promise<QuoteRecord[]> {
    const snap = await this.#tenantDoc(tenantId)
      .collection('quotes')
      .where('sessionId', '==', sessionId)
      .get();
    return snap.docs
      .map((doc) => doc.data() as QuoteRecord)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ── catalogue workspace (catalogue/types.ts) ─────────────────────────────
  //
  // Under the tenant's own document, beside `products` rather than in it: the
  // chat reads `products`, and nothing here may ever be in that collection.

  async getCatalogueState(tenantId: string): Promise<CatalogueState | null> {
    const snap = await this.#tenantDoc(tenantId).collection('catalogue_portal').doc('state').get();
    if (!snap.exists) return null;
    const state = snap.data() as CatalogueState;
    return state.tenantId === tenantId ? state : null;
  }

  async putCatalogueState(state: CatalogueState): Promise<void> {
    await this.#tenantDoc(state.tenantId)
      .collection('catalogue_portal')
      .doc('state')
      .set(JSON.parse(JSON.stringify(state)) as Record<string, unknown>);
  }

  async getCatalogueSnapshot(tenantId: string, version: number): Promise<Product[] | null> {
    const snap = await this.#tenantDoc(tenantId)
      .collection('catalogue_versions')
      .doc(`v${version}`)
      .get();
    if (!snap.exists) return null;
    const rows = (snap.data() as { products?: Product[] }).products ?? [];
    return rows.filter((row) => row.tenantId === tenantId);
  }

  async putCatalogueSnapshot(
    tenantId: string,
    version: number,
    products: readonly Product[],
  ): Promise<void> {
    await this.#tenantDoc(tenantId)
      .collection('catalogue_versions')
      .doc(`v${version}`)
      .set(JSON.parse(JSON.stringify({ version, products })) as Record<string, unknown>);
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      // A read of a document that is not expected to exist: the point is that the
      // round trip happened, which is the thing a misconfigured project or a
      // revoked credential breaks.
      await this.#db.doc('_meta/health').get();
      return { ok: true, detail: `firestore project ${this.#project}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  // ── installer portal ─────────────────────────────────────────────────────
  //
  // Tenant profiles live in their own collection rather than on the
  // `tenants/{id}` document that parents each tenant's data: that document is a
  // path segment every scoped read is built from, and keeping it free of fields
  // means no write to a profile can race a scoped write's transaction.

  #profiles() {
    return this.#db.collection('tenant_profiles');
  }

  async listTenants(): Promise<Tenant[]> {
    const snap = await this.#profiles().get();
    return snap.docs.map((doc) => doc.data() as Tenant);
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const snap = await this.#profiles().doc(docId('t', tenantId)).get();
    return snap.exists ? (snap.data() as Tenant) : null;
  }

  async putTenant(tenant: Tenant): Promise<Tenant> {
    // Firestore rejects `undefined`; a JSON round trip drops optional fields
    // that are absent, which is what the file store's serialisation does too.
    await this.#profiles()
      .doc(docId('t', tenant.id))
      .set(JSON.parse(JSON.stringify(tenant)) as Record<string, unknown>);
    return tenant;
  }

  #memberships() {
    return this.#db.collection('memberships');
  }

  #membershipId(tenantId: string, email: string): string {
    return docId('m', `${tenantId}:${email.toLowerCase()}`);
  }

  async listMembershipsByEmail(email: string): Promise<Membership[]> {
    const snap = await this.#memberships().where('email', '==', email.toLowerCase()).get();
    return snap.docs.map((doc) => doc.data() as Membership);
  }

  async listMembers(tenantId: string): Promise<Membership[]> {
    const snap = await this.#memberships().where('tenantId', '==', tenantId).get();
    return snap.docs.map((doc) => doc.data() as Membership);
  }

  async putMembership(membership: Membership): Promise<Membership> {
    const row = { ...membership, email: membership.email.toLowerCase() };
    await this.#memberships().doc(this.#membershipId(row.tenantId, row.email)).set(row);
    return row;
  }

  async deleteMembership(tenantId: string, email: string): Promise<boolean> {
    const ref = this.#memberships().doc(this.#membershipId(tenantId, email));
    return await this.#db.runTransaction<boolean>(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      transaction.delete(ref);
      return true;
    });
  }

  async setLeadStatus(tenantId: string, leadId: string, status: LeadStatus): Promise<void> {
    await this.#tenantDoc(tenantId)
      .collection('lead_status')
      .doc(docId('l', leadId))
      .set({ leadId, status });
  }

  async listLeadStatuses(tenantId: string): Promise<Record<string, LeadStatus>> {
    const snap = await this.#tenantDoc(tenantId).collection('lead_status').get();
    const out: Record<string, LeadStatus> = {};
    for (const doc of snap.docs) {
      const row = doc.data() as { leadId: string; status: LeadStatus };
      out[row.leadId] = row.status;
    }
    return out;
  }

  async claimStripeEvent(eventId: string): Promise<boolean> {
    try {
      // `create` fails if the document exists, which is the atomic
      // "first delivery wins" a webhook redelivered in parallel needs.
      await this.#db
        .collection('stripe_events')
        .doc(docId('e', eventId))
        .create({ eventId, at: new Date().toISOString() });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 6) return false; // ALREADY_EXISTS
      throw error;
    }
  }

  async releaseStripeEvent(eventId: string): Promise<void> {
    await this.#db.collection('stripe_events').doc(docId('e', eventId)).delete();
  }

  async getSessionEpoch(email: string): Promise<number> {
    const snap = await this.#db
      .collection('session_epochs')
      .doc(docId('u', email.toLowerCase()))
      .get();
    return snap.exists ? ((snap.data() as { at: number }).at ?? 0) : 0;
  }

  async revokeSessions(email: string, at: number): Promise<void> {
    const ref = this.#db.collection('session_epochs').doc(docId('u', email.toLowerCase()));
    await this.#db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const current = snap.exists ? ((snap.data() as { at: number }).at ?? 0) : 0;
      transaction.set(ref, { email: email.toLowerCase(), at: Math.max(current, at) });
    });
  }
}
