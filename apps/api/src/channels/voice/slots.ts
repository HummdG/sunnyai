import type { Firestore } from '@google-cloud/firestore';

/**
 * Concurrent voice sessions per tenant (Blueprint §5 channel matrix:
 * "concurrency cap").
 *
 * The cap has to hold across every API instance: Cloud Run scales out, and an
 * in-memory count per instance would let N instances each admit `cap` calls.
 * A slot is therefore a lease: claimed atomically, kept alive by a heartbeat
 * while the call runs, released when it ends, and ignored once it expires, so
 * an instance that crashes mid-call cannot hold a tenant's slots forever.
 */
export interface VoiceLease {
  /** Push the expiry forward; call well inside `LEASE_TTL_MS`. */
  heartbeat(): Promise<void>;
  /** Give the slot back. Idempotent. */
  release(): Promise<void>;
}

export interface VoiceSlots {
  /** Live (unexpired) sessions for `tenantId` right now. */
  count(tenantId: string, now: number): Promise<number>;
  /**
   * Claim a slot for `sessionId` if fewer than `cap` are live. Atomic: two
   * instances racing for the last slot cannot both win. Returns null when full.
   */
  acquire(
    tenantId: string,
    sessionId: string,
    cap: number,
    now: number,
  ): Promise<VoiceLease | null>;
}

/** A lease lives this long without a heartbeat. */
export const LEASE_TTL_MS = 60_000;
/** Heartbeat interval: three chances before a live call's lease could lapse. */
export const HEARTBEAT_MS = 20_000;

type Leases = Record<string, number>;

function live(leases: Leases, now: number): Leases {
  return Object.fromEntries(Object.entries(leases).filter(([, expiresAt]) => expiresAt > now));
}

/** Single-instance slots: development, tests, and one-instance deployments. */
export class MemoryVoiceSlots implements VoiceSlots {
  readonly #byTenant = new Map<string, Leases>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  count(tenantId: string, now: number): Promise<number> {
    return Promise.resolve(Object.keys(live(this.#byTenant.get(tenantId) ?? {}, now)).length);
  }

  acquire(
    tenantId: string,
    sessionId: string,
    cap: number,
    now: number,
  ): Promise<VoiceLease | null> {
    const leases = live(this.#byTenant.get(tenantId) ?? {}, now);
    if (!(sessionId in leases) && Object.keys(leases).length >= cap) return Promise.resolve(null);
    leases[sessionId] = now + LEASE_TTL_MS;
    this.#byTenant.set(tenantId, leases);
    return Promise.resolve({
      heartbeat: () => {
        const current = this.#byTenant.get(tenantId);
        if (current && (current[sessionId] ?? 0) > this.#now()) {
          current[sessionId] = this.#now() + LEASE_TTL_MS;
        }
        return Promise.resolve();
      },
      release: () => {
        const current = this.#byTenant.get(tenantId);
        if (current) delete current[sessionId];
        return Promise.resolve();
      },
    });
  }
}

/**
 * Multi-instance slots in Firestore: one document per tenant holding a map of
 * session id → lease expiry, changed only inside transactions. Keeping the
 * whole set in one document makes the cap check and the claim a single
 * serialisable read-modify-write, which a query over separate lease documents
 * would not guarantee as simply.
 */
export class FirestoreVoiceSlots implements VoiceSlots {
  readonly #db: Firestore;
  readonly #now: () => number;

  constructor(db: Firestore, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  #doc(tenantId: string) {
    return this.#db.collection('voiceSlots').doc(encodeURIComponent(tenantId));
  }

  async count(tenantId: string, now: number): Promise<number> {
    const snap = await this.#doc(tenantId).get();
    const leases = (snap.get('leases') as Leases | undefined) ?? {};
    return Object.keys(live(leases, now)).length;
  }

  async acquire(
    tenantId: string,
    sessionId: string,
    cap: number,
    now: number,
  ): Promise<VoiceLease | null> {
    const ref = this.#doc(tenantId);
    const won = await this.#db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const leases = live((snap.get('leases') as Leases | undefined) ?? {}, now);
      if (!(sessionId in leases) && Object.keys(leases).length >= cap) return false;
      leases[sessionId] = now + LEASE_TTL_MS;
      // Expired entries are dropped on every write, so the map stays small.
      tx.set(ref, { tenantId, leases });
      return true;
    });
    if (!won) return null;
    let released = false;
    return {
      heartbeat: async () => {
        if (released) return;
        await this.#db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const leases = (snap.get('leases') as Leases | undefined) ?? {};
          // A lease that already lapsed is not resurrected: another call may
          // have taken the slot in the meantime.
          if (!((leases[sessionId] ?? 0) > this.#now())) return;
          tx.set(ref, {
            tenantId,
            leases: { ...live(leases, this.#now()), [sessionId]: this.#now() + LEASE_TTL_MS },
          });
        });
      },
      release: async () => {
        if (released) return;
        released = true;
        await this.#db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const leases = live((snap.get('leases') as Leases | undefined) ?? {}, this.#now());
          delete leases[sessionId];
          tx.set(ref, { tenantId, leases });
        });
      },
    };
  }
}
