import { DocumentReference, Firestore, Transaction } from '@google-cloud/firestore';
import { describe, expect, it, vi } from 'vitest';

import { FirestoreStore } from '../src/firestore-store.js';
import { fileStoreHarness, storeContract } from './store-contract.js';
import type { Conversation } from '../src/store.js';
import type { StoreHarness } from './store-contract.js';

/**
 * The two stores, held to the same contract.
 *
 * The file store's half of this runs everywhere -- it needs nothing but a
 * temporary directory. The Firestore half needs an emulator, and the emulator
 * needs a JRE, so it runs only when the environment names one:
 *
 * ```
 * npm run test:firestore      # boots the emulator, sets the variables, runs this
 * ```
 *
 * **Skipped is not passed.** Without `SUNNY_FIRESTORE_EMULATOR` the Firestore
 * suite is reported as skipped, with the reason in the suite's own name, because
 * a green tick over tests that did not run is the failure this project is most
 * exposed to: the whole point of this file is that the production store has been
 * exercised, and an unnoticed skip would make the claim behind it false.
 *
 * The emulator address is read from `SUNNY_FIRESTORE_EMULATOR` rather than from
 * the conventional `FIRESTORE_EMULATOR_HOST` that the client library honours:
 * `config.ts` makes the same choice for the same reason. An ambient variable
 * should not be enough to point a process at a throwaway database.
 */

const EMULATOR = process.env.SUNNY_FIRESTORE_EMULATOR;
const PROJECT = process.env.SUNNY_FIRESTORE_PROJECT ?? 'demo-sunny';

/** A client of its own, for writing fixtures and for reading what `Store` hides. */
function adminClient(): Firestore {
  return new Firestore({
    projectId: PROJECT,
    databaseId: '(default)',
    host: EMULATOR,
    ssl: false,
  });
}

storeContract('FileStore', fileStoreHarness);

/**
 * A harness per test: its own tenant ids, and a client of its own for the two
 * things `Store` deliberately does not expose -- writing a record with a chosen
 * timestamp, and proving a subcollection is empty.
 */
function firestoreHarness(): StoreHarness {
  const scope = `t_${Math.random().toString(36).slice(2, 10)}`;
  const admin = adminClient();
  const tenants = new Set<string>();

  return {
    store: new FirestoreStore({ project: PROJECT, emulatorHost: EMULATOR }),
    tenant(label) {
      const id = `${scope}_${label}`;
      tenants.add(id);
      return id;
    },
    async seedConversation(tenantId, sessionId, when) {
      tenants.add(tenantId);
      const ref = admin
        .collection('tenants')
        .doc(encodeURIComponent(tenantId))
        .collection('conversations')
        .doc(`s_${encodeURIComponent(sessionId)}`);
      const conversation: Omit<Conversation, 'turns'> = {
        id: `conv_${sessionId}`,
        tenantId,
        sessionId,
        createdAt: when,
        updatedAt: when,
      };
      await ref.set(conversation);
      await ref
        .collection('turns')
        .doc('turn_seeded')
        .set({ role: 'user', text: 'from before the window', at: when, _seq: 1 });
    },
    async cleanup() {
      // `recursiveDelete` is the client's own: Firestore has no cascade, so this
      // is not a convenience -- it is the same fact the store has to handle in
      // `deleteConversation` and `purgeExpired`, reached from the other side.
      for (const id of tenants) {
        await admin
          .recursiveDelete(admin.collection('tenants').doc(encodeURIComponent(id)))
          .catch(() => undefined);
      }
    },
  };
}

storeContract('FirestoreStore', firestoreHarness, {
  skip: EMULATOR ? undefined : 'set SUNNY_FIRESTORE_EMULATOR — `npm run test:firestore` boots one',
});

if (EMULATOR) {
  describe('FirestoreStore specifics', () => {
    it('removes a purged conversation’s turns, not only the conversation', async () => {
      // Firestore does not cascade a document delete into its subcollections, so a
      // sweep that deleted the conversation alone would leave the visitor's
      // transcript on the database while reporting that it had been removed. This
      // assertion needs a client of its own because `Store` has no way to ask "are
      // there any turns here" -- which is itself why the store must delete them
      // explicitly rather than relying on the interface to have said so.
      const harness = firestoreHarness();
      const t = harness.tenant('sweep');
      await harness.seedConversation(t, 's_gone', '2019-01-01T00:00:00.000Z');
      await harness.store.purgeExpired(Date.parse('2020-01-01T00:00:00.000Z'));

      const turns = await adminClient()
        .collection('tenants')
        .doc(encodeURIComponent(t))
        .collection('conversations')
        .doc(`s_${encodeURIComponent('s_gone')}`)
        .collection('turns')
        .get();
      expect(turns.empty).toBe(true);
      await harness.cleanup();
    });

    it('appends a turn and merges answers without reading the earlier turns', async () => {
      // A turn is two to four writes, and each one re-reading the whole
      // transcript makes a conversation's cost grow with the square of its
      // length. Every read inside the transaction must be a single document.
      const harness = firestoreHarness();
      const t = harness.tenant('point-reads');
      const turn = (n: number) => ({
        role: 'user' as const,
        text: `turn ${n}`,
        at: new Date().toISOString(),
      });
      for (let n = 0; n < 3; n++) await harness.store.appendTurn(t, 's1', turn(n));

      const reads = vi.spyOn(Transaction.prototype, 'get');
      try {
        await harness.store.appendTurn(t, 's1', { ...turn(3), clientMessageId: 'm4' });
        await harness.store.appendTurn(t, 's1', turn(4));
        await harness.store.mergeAnswers(t, 's1', { roof: 'pitched' });
        expect(reads).toHaveBeenCalled();
        for (const [target] of reads.mock.calls) expect(target).toBeInstanceOf(DocumentReference);
      } finally {
        reads.mockRestore();
      }
      const read = await harness.store.getConversation(t, 's1');
      expect(read?.turns.map((row) => row.text)).toEqual([
        'turn 0',
        'turn 1',
        'turn 2',
        'turn 3',
        'turn 4',
      ]);
      expect(Object.keys(read!).some((key) => key.startsWith('_'))).toBe(false);
      await harness.cleanup();
    });

    it('continues a conversation written before turns were counted, once', async () => {
      // `seedConversation` writes the shape this store wrote before: a
      // conversation with no turn counter, and a turn under a random id. Both
      // the order and a retried message id must still be honoured.
      const harness = firestoreHarness();
      const t = harness.tenant('legacy');
      await harness.seedConversation(t, 's_old', new Date().toISOString());
      await adminClient()
        .collection('tenants')
        .doc(encodeURIComponent(t))
        .collection('conversations')
        .doc(`s_${encodeURIComponent('s_old')}`)
        .collection('turns')
        .doc('turn_legacy')
        .set({
          role: 'user',
          text: 'retried',
          at: new Date().toISOString(),
          clientMessageId: 'old-key',
          _seq: 2,
        });

      const again = await harness.store.appendTurn(t, 's_old', {
        role: 'user',
        text: 'retried',
        at: new Date().toISOString(),
        clientMessageId: 'old-key',
      });
      expect(again.appended).toBe(false);
      await harness.store.appendTurn(t, 's_old', {
        role: 'assistant',
        text: 'next',
        at: new Date().toISOString(),
      });
      const read = await harness.store.getConversation(t, 's_old');
      expect(read?.turns.map((row) => row.text)).toEqual([
        'from before the window',
        'retried',
        'next',
      ]);
      await harness.cleanup();
    });

    it('puts every tenant-owned record under its own tenant path', async () => {
      // The isolation the suite above checks behaviourally has a structure behind
      // it, and this is that structure: `tenants/{tenantId}/…`. It is asserted
      // because it is what makes a cross-tenant read impossible rather than merely
      // absent -- there is no query in the store that can name two tenants, and a
      // future edit that moved a collection to the top level would be a change to
      // the security model rather than a refactor.
      const admin = adminClient();
      const harness = firestoreHarness();
      const t = harness.tenant('shape');
      await harness.store.appendTurn(t, 's1', {
        role: 'user',
        text: 'hello',
        at: new Date().toISOString(),
      });
      await harness.store.saveLead({
        id: 'lead_shape',
        tenantId: t,
        sessionId: 's1',
        conversationId: null,
        name: null,
        email: null,
        phone: null,
        postcode: null,
        summary: 'shape check',
        score: null,
        createdAt: new Date().toISOString(),
      });

      const children = await admin
        .collection('tenants')
        .doc(encodeURIComponent(t))
        .listCollections();
      expect(children.map((child) => child.id).sort()).toEqual(['conversations', 'leads']);
      // Nothing of this tenant's is reachable from the top level.
      const topLevel = await admin.collection('leads').get();
      expect(topLevel.docs.filter((doc) => doc.get('tenantId') === t)).toEqual([]);
      await harness.cleanup();
    });
  });
}
