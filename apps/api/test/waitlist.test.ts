import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WAITLIST_CONSENT_VERSION, type WaitlistEntry } from '@sunny/contracts';

import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry } from '../src/tenants.js';
import { TEST_ADMIN_TOKEN } from './catalogue-fixture.js';
import type { ServerConfig } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

/**
 * The home page's waitlist (`POST /v1/waitlist`) and the operator's view of it.
 *
 * What matters: nothing is stored without the consent box; the answer does not
 * reveal whether an address was already listed; only Sunny's own site may post
 * in production; and the list is readable and editable with the admin token
 * alone.
 */

const SITE = 'https://sunny.example';
const NOW = 1_700_000_000_000;
const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-waitlist',
    allowedOrigins: [SITE],
    sessionSecret: 'test-secret-not-used-in-production',
    adminToken: TEST_ADMIN_TOKEN,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: true,
      trustProxyHops: 0,
      rules: {
        session: { limit: 100, windowMs: 60_000 },
        chat: { limit: 100, windowMs: 60_000 },
        leads: { limit: 3, windowMs: 60_000 },
        qualification: { limit: 100, windowMs: 60_000 },
        catalogue: { limit: 100, windowMs: 60_000 },
        knowledge: { limit: 100, windowMs: 60_000 },
      },
      maxKeys: 10_000,
    },
    ...overrides,
  };
}

let dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs = [];
});

async function h(
  overrides: Partial<ServerConfig> = {},
): Promise<{ app: FastifyInstance; store: FileStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-waitlist-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const app = buildServer({
    config: makeConfig(overrides),
    store,
    tenants: new TenantRegistry(),
    now: () => NOW,
  });
  await app.ready();
  return { app, store };
}

function join_(app: FastifyInstance, payload: unknown, origin: string | null = SITE) {
  return app.inject({
    method: 'POST',
    url: '/v1/waitlist',
    headers: origin ? { origin } : {},
    payload: payload as Record<string, unknown>,
  });
}

describe('POST /v1/waitlist', () => {
  it('stores the address, the company and what they agreed to', async () => {
    const { app, store } = await h();
    const res = await join_(app, {
      email: '  Jo@Bright-Roofs.co.uk ',
      company: 'Bright Roofs',
      consent: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await store.listWaitlist()).toEqual<WaitlistEntry[]>([
      {
        email: 'jo@bright-roofs.co.uk',
        company: 'Bright Roofs',
        joinedAt: new Date(NOW).toISOString(),
        consentVersion: WAITLIST_CONSENT_VERSION,
        origin: SITE,
      },
    ]);
  });

  it('stores nothing without the consent box, or with a bad address', async () => {
    const { app, store } = await h();
    expect((await join_(app, { email: 'jo@example.com' })).statusCode).toBe(400);
    expect((await join_(app, { email: 'jo@example.com', consent: false })).statusCode).toBe(400);
    expect((await join_(app, { email: 'not an email', consent: true })).statusCode).toBe(400);
    expect(await store.listWaitlist()).toEqual([]);
  });

  it('answers the same for an address already on the list, and keeps the first entry', async () => {
    const { app, store } = await h();
    const a = await join_(app, { email: 'jo@example.com', company: 'First', consent: true });
    const b = await join_(app, { email: 'JO@example.com', company: 'Second', consent: true });
    expect([a.statusCode, a.body]).toEqual([b.statusCode, b.body]);
    const entries = await store.listWaitlist();
    expect(entries.map((e) => e.company)).toEqual(['First']);
  });

  it('in production, only accepts Sunny’s own site', async () => {
    const { app, store } = await h({ nodeEnv: 'production' });
    expect((await join_(app, { email: 'a@example.com', consent: true }, null)).statusCode).toBe(
      403,
    );
    expect((await join_(app, { email: 'a@example.com', consent: true })).statusCode).toBe(200);
    expect((await store.listWaitlist()).map((e) => e.email)).toEqual(['a@example.com']);
  });

  it('is rate limited per address', async () => {
    const { app } = await h();
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      codes.push((await join_(app, { email: `p${i}@example.com`, consent: true })).statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});

describe('the operator’s waitlist', () => {
  it('reads and removes entries with the admin token only', async () => {
    const { app } = await h();
    await join_(app, { email: 'jo@example.com', consent: true });

    expect((await app.inject({ method: 'GET', url: '/v1/waitlist' })).statusCode).toBe(401);
    const list = await app.inject({ method: 'GET', url: '/v1/waitlist', headers: ADMIN });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ entries: WaitlistEntry[] }>().entries.map((e) => e.email)).toEqual([
      'jo@example.com',
    ]);

    const denied = await app.inject({
      method: 'DELETE',
      url: '/v1/waitlist',
      payload: { email: 'jo@example.com' },
    });
    expect(denied.statusCode).toBe(401);
    const removed = await app.inject({
      method: 'DELETE',
      url: '/v1/waitlist',
      headers: ADMIN,
      payload: { email: 'Jo@Example.com' },
    });
    expect(removed.json()).toEqual({ removed: true });
    const after = await app.inject({ method: 'GET', url: '/v1/waitlist', headers: ADMIN });
    expect(after.json<{ entries: WaitlistEntry[] }>().entries).toEqual([]);
  });

  it('is switched off when the deployment has no admin token', async () => {
    const { app } = await h({ adminToken: null });
    const res = await app.inject({ method: 'GET', url: '/v1/waitlist', headers: ADMIN });
    expect(res.statusCode).not.toBe(200);
  });
});
