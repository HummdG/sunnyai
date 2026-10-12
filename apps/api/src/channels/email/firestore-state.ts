import { Firestore } from '@google-cloud/firestore';

import type { FirestoreStoreOptions } from '../../firestore-store.js';
import { emptyState, MemoryEmailState, type TenantState } from './state.js';

/**
 * The email add-on's state in Firestore: one document per tenant in
 * `emailState`, every mutation a transaction so two instances handling a retry
 * and the original delivery cannot both claim the same message.
 *
 * Production runs on Cloud Run, whose filesystem does not survive an instance,
 * so the file store is for local development only; `routes/email.ts` picks this
 * one whenever the deployment's main store is Firestore.
 */
export class FirestoreEmailState extends MemoryEmailState {
  readonly #db: Firestore;

  constructor(options: FirestoreStoreOptions) {
    super();
    this.#db = new Firestore({
      projectId: options.project,
      databaseId: options.databaseId ?? '(default)',
      ...(options.emulatorHost ? { host: options.emulatorHost, ssl: false } : {}),
      ignoreUndefinedProperties: true,
    });
  }

  #doc(tenantId: string) {
    return this.#db.collection('emailState').doc(encodeURIComponent(tenantId));
  }

  protected override async load(tenantId: string): Promise<TenantState> {
    const snapshot = await this.#doc(tenantId).get();
    return withDefaults(snapshot.exists ? snapshot.data() : undefined);
  }

  protected override async mutate<T>(
    tenantId: string,
    apply: (state: TenantState) => T,
  ): Promise<T> {
    const ref = this.#doc(tenantId);
    return this.#db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const state = withDefaults(snapshot.exists ? snapshot.data() : undefined);
      const result = apply(state);
      tx.set(ref, { ...state, mailbox: state.watch?.mailbox ?? null });
      return result;
    });
  }

  override async tenantForMailbox(mailbox: string): Promise<string | null> {
    const query = await this.#db
      .collection('emailState')
      .where('mailbox', '==', mailbox.trim().toLowerCase())
      .limit(1)
      .get();
    const doc = query.docs[0];
    return doc ? decodeURIComponent(doc.id) : null;
  }
}

function withDefaults(data: Record<string, unknown> | undefined): TenantState {
  return { ...emptyState(), ...(data as Partial<TenantState> | undefined) };
}
