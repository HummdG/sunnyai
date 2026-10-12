import { describe, expect, it } from 'vitest';

import { FirestoreEmailState } from '../src/channels/email/firestore-state.js';
import { MemoryEmailState, type EmailStateStore } from '../src/channels/email/state.js';

/**
 * The per-sender auto-reply cap (Blueprint channel matrix: "max 3 auto-replies
 * per sender / day") must hold across API instances. Run against Firestore with
 * `npm run test:firestore -- run apps/api/test/email-shared-state.test.ts`.
 */

const EMULATOR = process.env.SUNNY_FIRESTORE_EMULATOR;
const PROJECT = process.env.SUNNY_FIRESTORE_PROJECT ?? 'demo-sunny';
const DAY = '2026-10-12';
const tenant = () => `t_${Math.random().toString(36).slice(2, 10)}`;

function contract(name: string, make: () => [EmailStateStore, EmailStateStore], skip?: string) {
  describe.skipIf(skip !== undefined)(`${name} auto-reply cap`, () => {
    it('allows exactly `cap` claims per sender per day', async () => {
      const [a] = make();
      const t = tenant();
      const results = [];
      for (let i = 0; i < 4; i++)
        results.push(await a.claimAutoReply(t, 'pat@example.com', DAY, 3));
      expect(results).toEqual([true, true, true, false]);
      expect(await a.claimAutoReply(t, 'sam@example.com', DAY, 3)).toBe(true);
      expect(await a.claimAutoReply(t, 'pat@example.com', '2026-10-13', 3)).toBe(true);
    });

    it('lets only one of two instances take the last auto-reply', async () => {
      const [a, b] = make();
      const t = tenant();
      await a.claimAutoReply(t, 'pat@example.com', DAY, 3);
      await a.claimAutoReply(t, 'pat@example.com', DAY, 3);
      const won = await Promise.all([
        a.claimAutoReply(t, 'pat@example.com', DAY, 3),
        b.claimAutoReply(t, 'pat@example.com', DAY, 3),
      ]);
      expect(won.filter(Boolean)).toHaveLength(1);
      expect(await b.autoRepliesToday(t, 'pat@example.com', DAY)).toBe(3);
    });

    it('gives a claim back when the send failed', async () => {
      const [a, b] = make();
      const t = tenant();
      for (let i = 0; i < 3; i++) await a.claimAutoReply(t, 'pat@example.com', DAY, 3);
      await a.releaseAutoReply(t, 'pat@example.com', DAY);
      expect(await b.claimAutoReply(t, 'pat@example.com', DAY, 3)).toBe(true);
    });
  });
}

contract('memory', () => {
  const shared = new MemoryEmailState();
  return [shared, shared];
});

contract(
  'Firestore',
  () => [
    new FirestoreEmailState({ project: PROJECT, emulatorHost: EMULATOR }),
    new FirestoreEmailState({ project: PROJECT, emulatorHost: EMULATOR }),
  ],
  EMULATOR ? undefined : 'set SUNNY_FIRESTORE_EMULATOR — `npm run test:firestore` boots one',
);
