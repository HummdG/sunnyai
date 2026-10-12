import { Firestore } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';

import {
  FirestoreVoiceSlots,
  LEASE_TTL_MS,
  MemoryVoiceSlots,
  type VoiceSlots,
} from '../src/channels/voice/slots.js';
import {
  FirestoreVoiceUsage,
  MemoryVoiceUsage,
  type VoiceUsageEntry,
  type VoiceUsageLedger,
} from '../src/channels/voice/usage.js';

/**
 * Voice concurrency and minutes have to hold across API instances (Cloud Run
 * scales out). The same behaviour is asserted against the in-memory
 * implementation and, when `SUNNY_FIRESTORE_EMULATOR` is set (`npm run
 * test:firestore -- run apps/api/test/voice-shared-counters.test.ts`), against
 * Firestore -- where "two instances" are two independent clients.
 */

const EMULATOR = process.env.SUNNY_FIRESTORE_EMULATOR;
const PROJECT = process.env.SUNNY_FIRESTORE_PROJECT ?? 'demo-sunny';

function client(): Firestore {
  return new Firestore({ projectId: PROJECT, databaseId: '(default)', host: EMULATOR, ssl: false });
}

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const uniqueTenant = () => `t_${Math.random().toString(36).slice(2, 10)}`;

interface Instances {
  a: VoiceSlots;
  b: VoiceSlots;
}

function slotContract(name: string, make: (now: () => number) => Instances, skip?: string): void {
  describe.skipIf(skip !== undefined)(`${name} voice slots`, () => {
    it('admits up to the cap and refuses the next session', async () => {
      const { a } = make(() => T0);
      const tenant = uniqueTenant();
      expect(await a.acquire(tenant, 's1', 2, T0)).not.toBeNull();
      expect(await a.acquire(tenant, 's2', 2, T0)).not.toBeNull();
      expect(await a.acquire(tenant, 's3', 2, T0)).toBeNull();
      expect(await a.count(tenant, T0)).toBe(2);
    });

    it('lets exactly one of two instances racing for the last slot win', async () => {
      const { a, b } = make(() => T0);
      const tenant = uniqueTenant();
      await a.acquire(tenant, 'held', 2, T0);
      const [one, two] = await Promise.all([
        a.acquire(tenant, 'from-a', 2, T0),
        b.acquire(tenant, 'from-b', 2, T0),
      ]);
      expect([one, two].filter((lease) => lease !== null)).toHaveLength(1);
      expect(await b.count(tenant, T0)).toBe(2);
    });

    it('frees a slot on release, seen by the other instance', async () => {
      const { a, b } = make(() => T0);
      const tenant = uniqueTenant();
      const lease = await a.acquire(tenant, 's1', 1, T0);
      expect(await b.acquire(tenant, 's2', 1, T0)).toBeNull();
      await lease!.release();
      await lease!.release(); // idempotent
      expect(await b.acquire(tenant, 's2', 1, T0)).not.toBeNull();
    });

    it('ignores the lease of an instance that died without releasing', async () => {
      let clock = T0;
      const { a, b } = make(() => clock);
      const tenant = uniqueTenant();
      await a.acquire(tenant, 'crashed', 1, T0);
      clock = T0 + LEASE_TTL_MS + 1;
      expect(await b.count(tenant, clock)).toBe(0);
      expect(await b.acquire(tenant, 'next', 1, clock)).not.toBeNull();
    });

    it('keeps a heartbeating lease alive past its first expiry', async () => {
      let clock = T0;
      const { a, b } = make(() => clock);
      const tenant = uniqueTenant();
      const lease = await a.acquire(tenant, 'long-call', 1, T0);
      clock = T0 + LEASE_TTL_MS - 1_000;
      await lease!.heartbeat();
      clock = T0 + LEASE_TTL_MS + 5_000;
      expect(await b.acquire(tenant, 'other', 1, clock)).toBeNull();
    });

    it('does not resurrect a lease that already lapsed', async () => {
      let clock = T0;
      const { a, b } = make(() => clock);
      const tenant = uniqueTenant();
      const lapsed = await a.acquire(tenant, 'slow', 1, T0);
      clock = T0 + LEASE_TTL_MS + 1;
      expect(await b.acquire(tenant, 'took-over', 1, clock)).not.toBeNull();
      await lapsed!.heartbeat();
      expect(await b.count(tenant, clock)).toBe(1);
    });
  });
}

function usageContract(
  name: string,
  make: () => [VoiceUsageLedger, VoiceUsageLedger],
  skip?: string,
): void {
  describe.skipIf(skip !== undefined)(`${name} voice minutes`, () => {
    const entry = (tenantId: string, at: number, seconds: number): VoiceUsageEntry => ({
      tenantId,
      sessionId: `s_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'phone',
      startedAt: new Date(at).toISOString(),
      endedAt: new Date(at + seconds * 1000).toISOString(),
      seconds,
      endReason: 'caller_hangup',
    });

    it('totals one month across instances, per tenant', async () => {
      const [a, b] = make();
      const tenant = uniqueTenant();
      const other = uniqueTenant();
      await Promise.all([
        a.record(entry(tenant, T0, 120)),
        b.record(entry(tenant, T0 + 60_000, 90)),
        b.record(entry(other, T0, 999)),
      ]);
      expect(await a.secondsThisMonth(tenant, T0)).toBe(210);
      expect(await b.secondsThisMonth(tenant, T0)).toBe(210);
    });

    it('starts each calendar month at zero', async () => {
      const [a] = make();
      const tenant = uniqueTenant();
      await a.record(entry(tenant, Date.UTC(2026, 8, 30, 23, 0), 300));
      expect(await a.secondsThisMonth(tenant, Date.UTC(2026, 9, 1, 1, 0))).toBe(0);
    });
  });
}

slotContract('memory', (now) => {
  const shared = new MemoryVoiceSlots(now);
  return { a: shared, b: shared };
});
usageContract('memory', () => {
  const shared = new MemoryVoiceUsage();
  return [shared, shared];
});

const SKIP = EMULATOR
  ? undefined
  : 'set SUNNY_FIRESTORE_EMULATOR — `npm run test:firestore` boots one';
slotContract(
  'Firestore',
  (now) => ({
    a: new FirestoreVoiceSlots(client(), now),
    b: new FirestoreVoiceSlots(client(), now),
  }),
  SKIP,
);
usageContract(
  'Firestore',
  () => [new FirestoreVoiceUsage(client()), new FirestoreVoiceUsage(client())],
  SKIP,
);
