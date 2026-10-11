import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileStore } from '../src/store.js';
import type { Store, Conversation, KnowledgeSourceRecord, LeadRecord } from '../src/store.js';
import { productSchema } from '@sunny/contracts';
import type { AuditEvent, IngestionJob, Product } from '@sunny/contracts';

/**
 * The `Store` contract, asserted once and run against every implementation.
 *
 * `store.ts` claims the swap from the file store to Firestore is "a new
 * implementation of these two methods rather than a rewrite of the routes", and
 * the only way that claim is worth anything is if the two are held to the same
 * behaviour by the same code. So this file holds the behaviour and
 * `store-contract.test.ts` runs it twice. A rule that only one of the stores
 * satisfies shows up as a failure naming that store.
 *
 * What is deliberately *not* here: anything about files, document ids, queries or
 * `_seq` fields. Those are how each store keeps its promises rather than what it
 * promises, and a test that reached for them would pin one implementation's
 * internals and let the other drift out from under the claim. The one exception
 * is `seedConversation`, which exists because the retention sweep can only
 * be tested against a record whose age the store did not choose -- see its note.
 *
 * ## The rules that carry the most weight
 *
 *   - **Tenant scoping, on every read.** The plan's §5 acceptance is tenant
 *     isolation, and it is a property of the store rather than of a route: a store
 *     that can return another installer's transcript is a cross-tenant leak no
 *     amount of route code can undo. Every read below is asked for a second
 *     tenant's session or id as well as its own.
 *   - **Idempotency.** A retried POST must not double-post a visitor's message or
 *     file a second enquiry. The key is what the caller sent, and the recognition
 *     has to survive a restart, so it is the stored row that decides.
 *   - **Erasure means erasure.** `deleteConversation` is the one operation a
 *     caller cannot verify by looking afterwards -- a blank success is
 *     indistinguishable from a request that did nothing -- so the tests check the
 *     transcript is gone from a *fresh read* rather than trusting the return
 *     value. Firestore does not cascade a delete into subcollections, which is
 *     exactly the mistake this catches.
 */

/** The clock the fixtures are written against, so no test depends on its duration. */
const NOW = Date.parse('2026-10-11T12:00:00.000Z');

/** An ISO instant `days` from the pinned clock; negative is in the past. */
function at(days: number): string {
  return new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString();
}

function lead(tenantId: string, over: Partial<LeadRecord> = {}): LeadRecord {
  return {
    id: `lead_${Math.random().toString(36).slice(2, 12)}`,
    tenantId,
    sessionId: 's_fixed',
    conversationId: null,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '07700 900123',
    postcode: 'BS1 4DJ',
    summary: 'Wants panels on a south-facing roof',
    score: null,
    createdAt: at(0),
    ...over,
  };
}

/**
 * A stored product, built through the contract's own schema.
 *
 * The one fixture that has to be, because `Product` is mostly defaulted fields
 * and a hand-written object would have to restate every default the schema
 * already carries -- and could state one of them wrongly. Parsing is also what
 * makes these rows *valid* rather than merely well-typed, so a store test cannot
 * pass on a row the API could never have produced.
 */
function product(tenantId: string, id: string, over: Partial<Product> = {}): Product {
  return productSchema.parse({
    id,
    tenantId,
    category: 'panel',
    manufacturer: 'Example Energy',
    model: `Model ${id}`,
    powerW: 430,
    priceMinor: 12_000,
    currency: 'GBP',
    priceStatus: 'verified',
    warrantyYears: 25,
    sourceVersion: '2026-01',
    createdAt: at(0),
    ...over,
  });
}

function source(
  tenantId: string,
  id: string,
  over: Partial<KnowledgeSourceRecord> = {},
): KnowledgeSourceRecord {
  return {
    id,
    tenantId,
    title: `Warranty ${id}`,
    url: null,
    version: '2026-01',
    text: 'Panels are warranted for twenty-five years.',
    createdAt: at(0),
    updatedAt: at(0),
    ...over,
  };
}

function job(tenantId: string, id: string): IngestionJob {
  return {
    id,
    tenantId,
    sourceId: null,
    status: 'succeeded',
    documents: 1,
    chunks: 4,
    issues: [],
    startedAt: at(0),
    finishedAt: at(0),
  };
}

function event(tenantId: string | null, id: string, when: string): AuditEvent {
  return {
    id,
    tenantId,
    actor: { kind: 'admin', id: null },
    action: 'catalogue.upload',
    target: { kind: 'catalogue', id: null },
    outcome: 'permitted',
    reason: null,
    sessionId: null,
    requestId: null,
    detail: { rows: 3 },
    at: when,
  };
}

export interface StoreHarness {
  store: Store;
  /**
   * A tenant id no other test in this process shares.
   *
   * Declared as a property rather than a method, here and below: a test
   * destructures the harness (`const { store, tenant } = await harness()`), and a
   * method signature would be describing a function that expects its receiver --
   * `this` -- to travel with it. These do not use `this` at all, and the property
   * form says so to the reader as much as to the type checker.
   */
  tenant: (label: string) => string;
  /**
   * Write a conversation whose `updatedAt` is `when`, without going through the
   * store.
   *
   * The retention sweep deletes by age, and no store method takes the age of a
   * record -- every write is stamped from the clock at the moment it happens. So
   * the only way to hold a conversation from a chosen day is to write one, which
   * is the technique `retention.test.ts` and `dashboard.test.ts` already use for
   * the file store. Each harness writes it the way its own backend stores it.
   */
  seedConversation: (tenantId: string, sessionId: string, when: string) => Promise<void>;
  /** Whatever this backend needs torn down: a directory, or a tenant's rows. */
  cleanup: () => Promise<void>;
}

export function storeContract(
  label: string,
  // A harness may be built synchronously or not; the file store has nothing to
  // await to open a directory, and saying `Promise` only would make its harness
  // an `async` function with no `await` in it -- a lie the linter is right to
  // object to.
  make: () => StoreHarness | Promise<StoreHarness>,
  options: { skip?: string } = {},
): void {
  // Skipped rather than silently passing, and the reason is the label a reader
  // sees in the report: a store nobody exercised must not look like one that
  // passed.
  const suite = options.skip ? describe.skip : describe;
  suite(options.skip ? `${label} (skipped: ${options.skip})` : label, () => {
    // Every harness a test opens is cleaned up after it, so the suite can be run
    // twice in a row and mean the same thing both times. The one thing that must
    // not leak is data, and the file store's leak would be a directory while
    // Firestore's would be another tenant's rows.
    const opened: StoreHarness[] = [];
    const harness = async (): Promise<StoreHarness> => {
      const created = await make();
      opened.push(created);
      return created;
    };
    afterEach(async () => {
      for (const used of opened.splice(0)) await used.cleanup();
    });

    it('reads back a conversation it appended to, with its turns in order', async () => {
      const { store, tenant } = await harness();
      const t = tenant('turns');
      const first = await store.appendTurn(t, 's1', {
        role: 'user',
        text: 'hello',
        at: at(0),
        clientMessageId: 'm1',
      });
      expect(first.appended).toBe(true);
      const second = await store.appendTurn(t, 's1', { role: 'assistant', text: 'hi', at: at(0) });
      expect(second.appended).toBe(true);

      const read = await store.getConversation(t, 's1');
      expect(read?.turns.map((turn) => turn.text)).toEqual(['hello', 'hi']);
      // The id and the creation time belong to the conversation, not to the turn
      // that happened to arrive second.
      expect(read?.id).toBe(first.conversation.id);
      expect(read?.createdAt).toBe(first.conversation.createdAt);
    });

    it('returns null for a session it has never seen', async () => {
      const { store, tenant } = await harness();
      expect(await store.getConversation(tenant('empty'), 's_none')).toBeNull();
    });

    it('does not append a turn twice for a repeated client message id', async () => {
      const { store, tenant } = await harness();
      const t = tenant('idem');
      const turn = { role: 'user' as const, text: 'hello', at: at(0), clientMessageId: 'same-key' };
      await store.appendTurn(t, 's1', turn);
      const again = await store.appendTurn(t, 's1', turn);
      expect(again.appended).toBe(false);
      expect(again.conversation.turns).toHaveLength(1);
    });

    it('merges answers into the standing map and removes the keys a correction drops', async () => {
      const { store, tenant } = await harness();
      const t = tenant('answers');
      await store.appendTurn(t, 's1', { role: 'user', text: 'hello', at: at(0) });
      const merged = await store.mergeAnswers(t, 's1', { roof: 'pitched', battery: 'yes' });
      expect(merged.answers).toEqual({ roof: 'pitched', battery: 'yes' });
      // The transcript survives an amendment to the answers.
      expect(merged.turns).toHaveLength(1);

      const corrected = await store.mergeAnswers(t, 's1', { roof: 'flat' }, ['battery']);
      expect(corrected.answers).toEqual({ roof: 'flat' });
      expect((await store.getConversation(t, 's1'))?.answers).toEqual({ roof: 'flat' });
    });

    it('creates the conversation when the first thing that happens is an answer', async () => {
      const { store, tenant } = await harness();
      const t = tenant('answers-first');
      const created = await store.mergeAnswers(t, 's_form', { timescale: 'soon' });
      expect(created.turns).toEqual([]);
      expect(created.sessionId).toBe('s_form');
      expect((await store.getConversation(t, 's_form'))?.answers).toEqual({ timescale: 'soon' });
    });

    it('round-trips the recommendation constraints, and reports none as empty', async () => {
      const { store, tenant } = await harness();
      const t = tenant('want');
      expect(await store.getWant(t, 's1')).toEqual({});
      await store.saveWant(t, 's1', { maxBudgetMajor: 8000, preferCheaper: true });
      expect(await store.getWant(t, 's1')).toEqual({ maxBudgetMajor: 8000, preferCheaper: true });
      // The second call replaces rather than merges, which is what the caller has
      // already done for itself.
      await store.saveWant(t, 's1', { currency: 'GBP' });
      expect(await store.getWant(t, 's1')).toEqual({ currency: 'GBP' });
    });

    it('files a lead once, and tells a retry apart from a reused key', async () => {
      const { store, tenant } = await harness();
      const t = tenant('leads');
      const first = await store.saveLead(lead(t, { clientLeadId: 'k1' }));
      expect(first.outcome).toBe('created');

      const retry = await store.saveLead(lead(t, { clientLeadId: 'k1' }));
      expect(retry.outcome).toBe('replayed');
      expect(retry.lead.id).toBe(first.lead.id);

      const different = await store.saveLead(
        lead(t, { clientLeadId: 'k1', email: 'other@example.com' }),
      );
      expect(different.outcome).toBe('conflict');
      // Nothing was written, because there is no honest way to pick a winner.
      expect(different.lead.id).toBe(first.lead.id);
      expect(await store.listAllLeads(t)).toHaveLength(1);
    });

    it('scopes the lead idempotency key to its tenant', async () => {
      const { store, tenant } = await harness();
      const a = tenant('key-a');
      const b = tenant('key-b');
      await store.saveLead(lead(a, { clientLeadId: 'shared' }));
      const other = await store.saveLead(lead(b, { clientLeadId: 'shared' }));
      // Two installers' pages minting the same key must not have one swallow the
      // other's visitor.
      expect(other.outcome).toBe('created');
      expect(await store.listAllLeads(b)).toHaveLength(1);
    });

    it('lists leads newest first, and counts them all', async () => {
      const { store, tenant } = await harness();
      const t = tenant('order');
      for (const [day, name] of [
        [-3, 'oldest'],
        [-2, 'middle'],
        [-1, 'newest'],
      ] as const) {
        await store.saveLead(lead(t, { name, createdAt: at(day) }));
      }
      expect((await store.listLeads(t)).map((row) => row.name)).toEqual([
        'newest',
        'middle',
        'oldest',
      ]);
      expect((await store.listLeads(t, 2)).map((row) => row.name)).toEqual(['newest', 'middle']);
      // The counting path is complete by construction, so `limit` cannot turn a
      // tenant's 38 enquiries into "50".
      expect(await store.listAllLeads(t)).toHaveLength(3);
    });

    it('erases a lead it owns, and answers null for one that is not its own', async () => {
      const { store, tenant } = await harness();
      const mine = tenant('delete-mine');
      const theirs = tenant('delete-theirs');
      const saved = await store.saveLead(lead(mine, {}));

      // Null for another tenant's lead as well as for one that never existed:
      // telling the two apart is what would let an installer probe ids.
      expect(await store.deleteLead(theirs, saved.lead.id)).toBeNull();
      expect(await store.listAllLeads(mine)).toHaveLength(1);

      const removed = await store.deleteLead(mine, saved.lead.id);
      expect(removed?.id).toBe(saved.lead.id);
      expect(await store.listAllLeads(mine)).toHaveLength(0);
      expect(await store.deleteLead(mine, saved.lead.id)).toBeNull();
    });

    it('lists every conversation of a tenant, each with its transcript', async () => {
      const { store, tenant } = await harness();
      const t = tenant('list-conv');
      await store.appendTurn(t, 's1', { role: 'user', text: 'one', at: at(0) });
      await store.appendTurn(t, 's2', { role: 'user', text: 'two', at: at(0) });
      await store.appendTurn(t, 's2', { role: 'assistant', text: 'two back', at: at(0) });

      const all = await store.listConversations(t);
      expect(all).toHaveLength(2);
      expect(all.find((row) => row.sessionId === 's2')?.turns).toHaveLength(2);
    });

    it('erases the transcript and the leads filed from the session, together', async () => {
      const { store, tenant } = await harness();
      const t = tenant('erase');
      await store.appendTurn(t, 's1', { role: 'user', text: 'hello', at: at(0) });
      const filed = await store.saveLead(lead(t, { sessionId: 's1' }));
      const surviving = await store.saveLead(lead(t, { sessionId: 's_other' }));

      const erased = await store.deleteConversation(t, 's1');
      expect(erased.conversationId).not.toBeNull();
      expect(erased.leads.map((row) => row.id)).toEqual([filed.lead.id]);

      // Read back rather than trusted: a deletion is the one operation a caller
      // cannot verify by looking afterwards.
      expect(await store.getConversation(t, 's1')).toBeNull();
      expect((await store.listAllLeads(t)).map((row) => row.id)).toEqual([surviving.lead.id]);
    });

    it('erases a session that has leads but never opened the assistant', async () => {
      const { store, tenant } = await harness();
      const t = tenant('erase-form-only');
      await store.saveLead(lead(t, { sessionId: 's_form' }));
      const erased = await store.deleteConversation(t, 's_form');
      // No conversation to name, and the enquiry is still gone -- which is every
      // visitor the form route serves.
      expect(erased.conversationId).toBeNull();
      expect(erased.leads).toHaveLength(1);
      expect(await store.listAllLeads(t)).toHaveLength(0);
    });

    it('sweeps only what is past its window, and counts it per tenant', async () => {
      const { store, tenant, seedConversation } = await harness();
      const t = tenant('purge');
      // Instants, not offsets from the pinned clock: the point of this cutoff is
      // that it is far enough in the past that no *other* test's rows are in
      // range, so the counts below are about this tenant alone, and a relative
      // date here would silently move with the clock.
      const before = '2019-01-01T00:00:00.000Z';
      const cutoff = Date.parse('2020-01-01T00:00:00.000Z');
      await store.saveLead(lead(t, { name: 'recent', createdAt: at(-1) }));
      await store.saveLead(lead(t, { name: 'ancient', createdAt: before }));
      // A record whose timestamp will not parse is *kept*: every comparison
      // against an unparseable date must fail in the direction of not deleting.
      // Both kinds of record, because they are swept by different code paths and
      // the file store's two filters were once written as `parse(x) < cutoff` and
      // its apparent negation `parse(x) >= cutoff` -- which are not complements
      // when the parse yields NaN, and so deleted the conversation this fixture
      // seeds while the lead's comment said the opposite.
      await store.saveLead(lead(t, { name: 'undateable', createdAt: 'not-a-date' }));
      await seedConversation(t, 's_old', before);
      await seedConversation(t, 's_undateable', 'not-a-date');

      const result = await store.purgeExpired(cutoff);

      const mine = result.tenants.find((row) => row.tenantId === t);
      expect(mine).toEqual({ tenantId: t, leads: 1, conversations: 1 });
      expect(await store.getConversation(t, 's_old')).toBeNull();
      // The transcript from the unreadable date survives, turns and all.
      expect((await store.getConversation(t, 's_undateable'))?.turns).toHaveLength(1);
      expect((await store.listAllLeads(t)).map((row) => row.name).sort()).toEqual([
        'recent',
        'undateable',
      ]);
    });

    it('replaces a catalogue, drops what the new list omits, and keeps its order', async () => {
      const { store, tenant } = await harness();
      const t = tenant('catalogue');
      await store.saveProducts(t, [product(t, 'a'), product(t, 'b'), product(t, 'c')], 'replace');
      const replaced = await store.saveProducts(t, [product(t, 'c'), product(t, 'a')], 'replace');
      expect(replaced.map((row) => row.id)).toEqual(['c', 'a']);
      expect((await store.listProducts(t)).map((row) => row.id)).toEqual(['c', 'a']);

      const appended = await store.saveProducts(t, [product(t, 'd')], 'append');
      expect(appended.map((row) => row.id)).toEqual(['c', 'a', 'd']);
      expect((await store.listProducts(t)).map((row) => row.id)).toEqual(['c', 'a', 'd']);
    });

    it('keeps every tenant’s catalogue to itself', async () => {
      const { store, tenant } = await harness();
      const mine = tenant('cat-mine');
      const theirs = tenant('cat-theirs');
      await store.saveProducts(mine, [product(mine, 'p1')], 'replace');
      await store.saveProducts(theirs, [product(theirs, 'p2')], 'replace');
      expect((await store.listProducts(mine)).map((row) => row.id)).toEqual(['p1']);
    });

    it('upserts a knowledge source in place and deletes one that is there', async () => {
      const { store, tenant } = await harness();
      const t = tenant('knowledge');
      await store.putKnowledgeSource(source(t, 'k1'));
      await store.putKnowledgeSource(source(t, 'k2'));
      const revised = await store.putKnowledgeSource(source(t, 'k1', { version: '2026-02' }));

      // A revised document does not jump to the end of the installer's list.
      expect(revised.map((row) => row.id)).toEqual(['k1', 'k2']);
      expect((await store.getKnowledgeSource(t, 'k1'))?.version).toBe('2026-02');
      expect(await store.getKnowledgeSource(t, 'nope')).toBeNull();

      expect(await store.deleteKnowledgeSource(t, 'k1')).toBe(true);
      expect(await store.deleteKnowledgeSource(t, 'k1')).toBe(false);
      expect((await store.listKnowledgeSources(t)).map((row) => row.id)).toEqual(['k2']);
    });

    it('keeps an ingestion job readable by the tenant that ran it, and not by another', async () => {
      const { store, tenant } = await harness();
      const mine = tenant('jobs-mine');
      const theirs = tenant('jobs-theirs');
      const saved = job(mine, 'job_1');
      await store.saveIngestionJob(saved);
      expect((await store.getIngestionJob(mine, 'job_1'))?.id).toBe('job_1');
      // Unscoped-by-id would hand another installer's job to a caller who had one.
      expect(await store.getIngestionJob(theirs, 'job_1')).toBeNull();
    });

    it('appends audit events and returns a tenant’s own, newest first', async () => {
      const { store, tenant } = await harness();
      const t = tenant('audit');
      await store.appendAuditEvent(event(t, 'e1', at(-2)));
      await store.appendAuditEvent(event(t, 'e2', at(-1)));
      // An event with no tenant -- a refusal before a tenant could be named -- is
      // not any tenant's to see.
      await store.appendAuditEvent(event(null, 'e0', at(-3)));

      expect((await store.listAuditEvents(t)).map((row) => row.id)).toEqual(['e2', 'e1']);
    });

    it('never returns another tenant’s rows from any read', async () => {
      const { store, tenant } = await harness();
      const a = tenant('iso-a');
      const b = tenant('iso-b');

      // One of everything, filed under A.
      await store.appendTurn(a, 's1', { role: 'user', text: 'secret', at: at(0) });
      await store.saveLead(lead(a, { sessionId: 's1' }));
      await store.saveWant(a, 's1', { maxBudgetMajor: 5000 });
      await store.saveProducts(a, [product(a, 'p1')], 'replace');
      await store.putKnowledgeSource(source(a, 'k1'));
      await store.saveIngestionJob(job(a, 'job_1'));
      await store.appendAuditEvent(event(a, 'e1', at(0)));

      // Asked for by the *same* ids A used, which is the case that would pass if
      // the tenant were a filter rather than the path.
      expect(await store.getConversation(b, 's1')).toBeNull();
      expect(await store.listConversations(b)).toEqual([]);
      expect(await store.listAllLeads(b)).toEqual([]);
      expect(await store.getWant(b, 's1')).toEqual({});
      expect(await store.listProducts(b)).toEqual([]);
      expect(await store.listKnowledgeSources(b)).toEqual([]);
      expect(await store.getKnowledgeSource(b, 'k1')).toBeNull();
      expect(await store.getIngestionJob(b, 'job_1')).toBeNull();
      expect(await store.listAuditEvents(b)).toEqual([]);
    });

    it('reports itself healthy', async () => {
      const { store } = await harness();
      expect((await store.health()).ok).toBe(true);
    });
  });
}

/**
 * A harness over the file store, in a directory of its own.
 *
 * A fresh directory per test is what makes the file store's isolation free: the
 * tenant ids need not be unique because the directory is.
 */
export async function fileStoreHarness(): Promise<StoreHarness> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-store-'));
  const store = new FileStore(dir);
  const scope = `t_${Math.random().toString(36).slice(2, 10)}`;
  return {
    store,
    tenant: (label) => `${scope}_${label}`,
    async seedConversation(tenantId, sessionId, when) {
      const file = join(dir, 'conversations', `${encodeURIComponent(tenantId)}.jsonl`);
      await mkdir(join(dir, 'conversations'), { recursive: true });
      const conversation: Conversation = {
        id: `conv_${sessionId}`,
        tenantId,
        sessionId,
        turns: [{ role: 'user', text: 'from before the window', at: when }],
        createdAt: when,
        updatedAt: when,
      };
      // Appended, not written: a tenant's conversation file holds one line per
      // append, so seeding a second conversation for the same tenant has to add a
      // line rather than replace the file -- otherwise the fixture would silently
      // hold one conversation where the test seeded two.
      await appendFile(file, `${JSON.stringify(conversation)}\n`, 'utf8');
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
