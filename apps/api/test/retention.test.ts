import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditEventSchema, type AuditEvent } from '@sunny/contracts';

import { createAuditor } from '../src/audit.js';
import { startRetention } from '../src/retention.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT_ID } from './catalogue-fixture.js';

/**
 * The retention sweep, driven by a clock we control rather than by a wait.
 *
 * Deletion and retention are the two ends of one promise: deletion is the visitor
 * asking, retention is the deployment asking itself. They live in separate files
 * because they are separate subjects -- `consent.test.ts` covers a *caller* asking
 * for an erasure, and this covers a *timer* removing what nobody asked about. The
 * failure modes barely overlap, and a suite that mixed them would test neither
 * well.
 *
 * The file is in two halves, and the split is the point. The **rule** -- which
 * records fall out of a window, and measured by which field -- is
 * `store.purgeExpired`, so it is driven directly and its counts are asserted
 * exactly. The **sweep** -- a timer, a boot run and the record each writes -- is
 * `startRetention`, so it is driven through a real sweep that starts its own work
 * and is waited for. Driving the rule through `purgeOnce` would have meant racing
 * the boot run the sweep fires on the way out: a test whose fixture is decided by
 * which of two concurrent purges wins proves nothing about either.
 *
 * Three things are asserted here:
 *
 *   - that the window is measured against the right field of each record. An
 *     enquiry was made once, so its age is `createdAt`; a conversation is still
 *     being written while the visitor is in it, so its age is `updatedAt` -- and
 *     getting that pair the wrong way round removes transcripts people are
 *     reading, which no count in the response would reveal;
 *   - that the stored bytes really go. The counts are checked against the disk
 *     rather than against themselves, because a sweep that returns "2 removed"
 *     while leaving both rows in place is the exact shape of this bug;
 *   - that the record of the sweep never becomes a second copy of what it removed.
 *
 * The clock is a parameter and the fixture is written by hand onto disk, so every
 * case is decided by the timestamps in it rather than by how long the test took.
 */

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
/** The demo installer, and the sandbox one, so "per tenant" has two tenants. */
const SANDBOX_TENANT_ID = 't_sandbox001';
/** A year, which is short enough that `3 * DAY` is comfortably inside it. */
const YEAR_MS = 365 * DAY;
/** The cutoff a one-year window puts on `NOW`, which is what the rule is given. */
const CUTOFF_MS = NOW - YEAR_MS;

function iso(at: number): string {
  return new Date(at).toISOString();
}

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
});

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-retention-'));
  dirs.push(dir);
  return dir;
}

/** An enquiry row in the shape the store writes and reads. */
function lead(overrides: {
  id: string;
  tenantId?: string;
  sessionId?: string;
  createdAt: string;
  email?: string;
}): Record<string, unknown> {
  return {
    id: overrides.id,
    tenantId: overrides.tenantId ?? DEMO_TENANT_ID,
    sessionId: overrides.sessionId ?? 'sess_retention0',
    conversationId: null,
    name: 'Ada',
    email: overrides.email ?? 'ada@example.test',
    phone: null,
    postcode: null,
    summary: 'Enquiry',
    score: null,
    createdAt: overrides.createdAt,
  };
}

/** One appended line of a transcript, in the shape the store appends. */
function conversationLine(overrides: {
  id: string;
  tenantId?: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}): Record<string, unknown> {
  return {
    id: overrides.id,
    tenantId: overrides.tenantId ?? DEMO_TENANT_ID,
    sessionId: overrides.sessionId,
    turns: [],
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
  };
}

/**
 * A store over a directory whose files were written before it ever looked.
 *
 * Rows are planted on disk rather than saved through the store because a
 * conversation's timestamps come from the wall clock at write time: the only way
 * to hold a record that is two years old is to have written it two years ago, or
 * to write it by hand. Hand-writing also keeps the fixture readable -- what each
 * case turns on is visible in the file it plants.
 */
async function storeWith(files: {
  leads?: Record<string, Record<string, unknown>[]>;
  conversations?: Record<string, Record<string, unknown>[]>;
}): Promise<{ store: FileStore; dir: string }> {
  const dir = await tempDir();

  for (const [tenantId, rows] of Object.entries(files.leads ?? {})) {
    await mkdir(join(dir, 'leads'), { recursive: true });
    await writeFile(
      join(dir, 'leads', `${encodeURIComponent(tenantId)}.jsonl`),
      rows.map((row) => `${JSON.stringify(row)}\n`).join(''),
      'utf8',
    );
  }
  for (const [tenantId, rows] of Object.entries(files.conversations ?? {})) {
    await mkdir(join(dir, 'conversations'), { recursive: true });
    await writeFile(
      join(dir, 'conversations', `${encodeURIComponent(tenantId)}.jsonl`),
      rows.map((row) => `${JSON.stringify(row)}\n`).join(''),
      'utf8',
    );
  }
  return { store: new FileStore(dir), dir };
}

/** The sweep a deployment would run, with the clock and the window pinned. */
function sweepOver(store: FileStore, retentionMs = YEAR_MS) {
  const auditor = createAuditor({ store, now: () => NOW });
  return startRetention({ store, auditor, retentionMs, now: () => NOW });
}

/**
 * Wait until `check` says so, or fail with what was last seen.
 *
 * The boot run `startRetention` fires is deliberately fire-and-forget, so the only
 * honest way to test it is to wait for its *effect* -- and waiting for the effect
 * is also what makes this a test of the boot run rather than of a call the test
 * made itself.
 */
async function until(check: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${description}`);
}

/** Every stored audit line, parsed as the contract's own schema. */
async function trail(dir: string): Promise<AuditEvent[]> {
  const events: AuditEvent[] = [];
  for (const name of [`${encodeURIComponent(DEMO_TENANT_ID)}.jsonl`, '_unscoped.jsonl']) {
    const raw = await readFile(join(dir, 'audit', name), 'utf8').catch(() => '');
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      events.push(auditEventSchema.parse(JSON.parse(line)));
    }
  }
  return events;
}

async function storedLeads(dir: string, tenantId = DEMO_TENANT_ID): Promise<string> {
  return readFile(join(dir, 'leads', `${encodeURIComponent(tenantId)}.jsonl`), 'utf8').catch(
    () => '',
  );
}

describe('the rule: what falls out of a window', () => {
  it('erases an enquiry past the cutoff and leaves one inside it', async () => {
    const { store, dir } = await storeWith({
      leads: {
        [DEMO_TENANT_ID]: [
          lead({ id: 'lead_stale00000000001', createdAt: iso(NOW - 3 * YEAR_MS) }),
          lead({
            id: 'lead_fresh00000000001',
            sessionId: 'sess_retention1',
            createdAt: iso(NOW - 3 * DAY),
          }),
        ],
      },
    });

    const purge = await store.purgeExpired(CUTOFF_MS);
    expect(purge).toEqual({
      leads: 1,
      conversations: 0,
      tenants: [{ tenantId: DEMO_TENANT_ID, leads: 1, conversations: 0 }],
    });

    // Off the disk, not merely off the list: a sweep that reported one removal
    // and left both lines in the file is the failure this reads the bytes for.
    const remaining = await storedLeads(dir);
    expect(remaining).not.toContain('lead_stale00000000001');
    expect(remaining).toContain('lead_fresh00000000001');
  });

  it('keeps a row whose date it cannot read', async () => {
    const { store, dir } = await storeWith({
      leads: {
        [DEMO_TENANT_ID]: [lead({ id: 'lead_undated00000001', createdAt: 'sometime last spring' })],
      },
    });

    const purge = await store.purgeExpired(CUTOFF_MS);
    // `Date.parse` gives NaN, every comparison with NaN is false, and so the row
    // fails the test for removal rather than passing it. Kept -- because the only
    // other way to read an unreadable date is as "old enough", and that would make
    // a corrupt timestamp the way to lose a record early.
    expect(purge.leads).toBe(0);
    expect(await storedLeads(dir)).toContain('lead_undated00000001');
  });

  it('takes a transcript by its last write, not by when it opened', async () => {
    const { store, dir } = await storeWith({
      conversations: {
        [DEMO_TENANT_ID]: [
          // Opened three years ago and answered an hour ago: somebody is in it.
          conversationLine({
            id: 'conv_oldbutlive000001',
            sessionId: 'sess_oldbutlive0',
            createdAt: iso(NOW - 3 * YEAR_MS),
            updatedAt: iso(NOW - 60 * 60 * 1000),
          }),
          // Opened yesterday and last written three years ago. Impossible as a
          // real history, which is the point: it isolates which field is read.
          conversationLine({
            id: 'conv_newbutstale0001',
            sessionId: 'sess_newbutstale0',
            createdAt: iso(NOW - DAY),
            updatedAt: iso(NOW - 3 * YEAR_MS),
          }),
        ],
      },
    });

    const purge = await store.purgeExpired(CUTOFF_MS);
    expect(purge.conversations).toBe(1);
    const remaining = await readFile(
      join(dir, 'conversations', `${encodeURIComponent(DEMO_TENANT_ID)}.jsonl`),
      'utf8',
    );
    expect(remaining).toContain('sess_oldbutlive0');
    expect(remaining).not.toContain('sess_newbutstale0');
  });

  it('counts a long transcript as one conversation, not one per turn', async () => {
    const { store, dir } = await storeWith({
      conversations: {
        [DEMO_TENANT_ID]: [1, 2, 3].map((turn) =>
          conversationLine({
            id: `conv_thirdturn00000${turn}`,
            sessionId: 'sess_twenty00000001',
            createdAt: iso(NOW - 3 * YEAR_MS),
            // The file holds one line per append, so a session that ran to twenty
            // turns is twenty lines. Counting lines would report twenty
            // conversations for one visitor's chat.
            updatedAt: iso(NOW - (3 * YEAR_MS - turn * 1000)),
          }),
        ),
      },
    });

    const purge = await store.purgeExpired(CUTOFF_MS);
    expect(purge.conversations).toBe(1);
    expect(purge.tenants).toEqual([{ tenantId: DEMO_TENANT_ID, leads: 0, conversations: 1 }]);
    // The whole file goes, every line of the session with it.
    expect(
      await readFile(
        join(dir, 'conversations', `${encodeURIComponent(DEMO_TENANT_ID)}.jsonl`),
        'utf8',
      ).catch(() => ''),
    ).toBe('');
  });
});

describe('two writers on one file', () => {
  it('does not lose one rewrite behind another happening at the same moment', async () => {
    const { store, dir } = await storeWith({
      leads: {
        [DEMO_TENANT_ID]: [
          lead({ id: 'lead_purgeme00000001', createdAt: iso(NOW - 3 * YEAR_MS) }),
          lead({ id: 'lead_eraseme0000001', createdAt: iso(NOW - 3 * DAY) }),
        ],
      },
    });

    // The pairing is not contrived. The sweep runs at boot and on a timer, so it
    // overlaps the requests being served by construction: an installer erasing a
    // record while the deployment is sweeping is an ordinary Tuesday.
    //
    // Two rewrites in flight at once share one scratch filename and one in-memory
    // snapshot, so before the store queued them this failed one of the two, or
    // swapped a snapshot taken before the erasure back over it -- putting a
    // visitor's deleted enquiry back on disk. Both halves are asserted below.
    const [, erased] = await Promise.all([
      store.purgeExpired(CUTOFF_MS),
      store.deleteLead(DEMO_TENANT_ID, 'lead_eraseme0000001'),
    ]);

    expect(erased?.id).toBe('lead_eraseme0000001');
    // Both removals stuck, in memory and on disk, and the emptied file is gone
    // rather than left behind holding one of them.
    expect(await store.listLeads(DEMO_TENANT_ID)).toEqual([]);
    expect(await storedLeads(dir)).toBe('');
  });
});

describe('the sweep: what a deployment does with the rule', () => {
  it('writes one event per installer at boot, and none for a sweep that removed nothing', async () => {
    const { store, dir } = await storeWith({
      leads: {
        [DEMO_TENANT_ID]: [
          lead({ id: 'lead_demostale000001', createdAt: iso(NOW - 3 * YEAR_MS) }),
          lead({ id: 'lead_demostale000002', createdAt: iso(NOW - 3 * YEAR_MS) }),
        ],
        [SANDBOX_TENANT_ID]: [
          lead({
            id: 'lead_sandstale000001',
            tenantId: SANDBOX_TENANT_ID,
            sessionId: 'sess_sandbox0000001',
            createdAt: iso(NOW - 3 * YEAR_MS),
          }),
        ],
      },
      conversations: {
        [SANDBOX_TENANT_ID]: [
          conversationLine({
            id: 'conv_sandstale000001',
            tenantId: SANDBOX_TENANT_ID,
            sessionId: 'sess_sandbox0000002',
            createdAt: iso(NOW - 3 * YEAR_MS),
            updatedAt: iso(NOW - 3 * YEAR_MS),
          }),
        ],
      },
    });

    const sweep = sweepOver(store);
    const sandboxFile = join(dir, 'audit', `${encodeURIComponent(SANDBOX_TENANT_ID)}.jsonl`);
    await until(async () => {
      const raw = await readFile(sandboxFile, 'utf8').catch(() => '');
      return raw.trim() !== '';
    }, 'the second installer’s sweep record');

    // One per installer, because the act was against that installer's records,
    // and each carrying their own count rather than a deployment-wide total.
    const sandbox = (await readFile(sandboxFile, 'utf8'))
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => auditEventSchema.parse(JSON.parse(line)));
    expect(sandbox).toHaveLength(1);
    expect(sandbox[0]).toMatchObject({
      tenantId: SANDBOX_TENANT_ID,
      actor: { kind: 'system', id: null },
      action: 'retention.purge',
      target: { kind: 'conversation', id: null },
      outcome: 'permitted',
      detail: { leads: 1, conversations: 1 },
    });

    const events = await trail(dir);
    expect(events.map((event) => event.tenantId)).toEqual([DEMO_TENANT_ID]);
    expect(events[0]).toMatchObject({
      actor: { kind: 'system', id: null },
      action: 'retention.purge',
      target: { kind: 'conversation', id: null },
      outcome: 'permitted',
      detail: { leads: 2, conversations: 0 },
    });

    // And a sweep with nothing left to remove is silent. Six lines a day saying
    // "retention ran, erased 0" is how a log becomes something people stop reading,
    // and a log nobody reads is not a record.
    const before = await trail(dir);
    await sweep.purgeOnce();
    expect(await trail(dir)).toEqual(before);

    // Stopping is idempotent: a caller that stops a stopped sweep is not an error,
    // which is what lets `onClose` call it without checking whether it still runs.
    sweep.stop();
    sweep.stop();
  });

  it('names no visitor in the record of removing them', async () => {
    const { store, dir } = await storeWith({
      leads: {
        [DEMO_TENANT_ID]: [
          lead({
            id: 'lead_marker000000001',
            createdAt: iso(NOW - 3 * YEAR_MS),
            email: 'erased-by-retention@example.test',
          }),
        ],
      },
    });

    const file = join(dir, 'audit', `${encodeURIComponent(DEMO_TENANT_ID)}.jsonl`);
    sweepOver(store);
    await until(async () => (await readFile(file, 'utf8').catch(() => '')) !== '', 'the record');

    const raw = await readFile(file, 'utf8');
    // The one thing this record must never become: a second copy of what it
    // removed. "Two enquiries reached the end of their window" is the fact a
    // review wants, and the addresses are the fact it must not have.
    expect(raw).toContain('retention.purge');
    expect(raw).not.toContain('erased-by-retention@example.test');
    expect(raw).not.toContain('lead_marker000000001');
  });

  it('does nothing at all when the window is disabled', async () => {
    const { store, dir } = await storeWith({
      leads: {
        [DEMO_TENANT_ID]: [
          lead({ id: 'lead_keptforever0001', createdAt: iso(NOW - 30 * YEAR_MS) }),
        ],
      },
    });

    // `SUNNY_LEAD_RETENTION_DAYS=0` is an operator saying "we keep these". The
    // other two readings -- sweep with a zero-length window, or sweep with the
    // default -- would both be the deployment deciding something the operator
    // deliberately decided against.
    const sweep = sweepOver(store, 0);
    const result = await sweep.purgeOnce();
    expect(result).toEqual({ leads: 0, conversations: 0, tenants: [] });
    expect(await storedLeads(dir)).toContain('lead_keptforever0001');
    // Nothing waiting in the background either, so the read below is not racing a
    // boot run: a disabled sweep writes no record at all, because one that removed
    // nothing did not happen.
    expect(await trail(dir)).toEqual([]);
    sweep.stop();
  });
});
