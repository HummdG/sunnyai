import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import { issueInviteToken, verifyInviteToken } from '../src/auth/invite.js';
import {
  issueSessionToken,
  MAX_SESSION_MS,
  SESSION_TTL_MS,
  verifySessionToken,
} from '../src/auth/session.js';
import { createFirebaseVerifier } from '../src/auth/firebase.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig, type PortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { defaultTenants, TenantRegistry } from '../src/tenants.js';

/**
 * Portal sessions: the website trades a sign-in proof for a short-lived Sunny
 * session (kept in an HttpOnly cookie by the Next.js app), refreshes it, and
 * can sign out everywhere. Plus team invitation links.
 */

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';

function config(nodeEnv: ServerConfig['nodeEnv'] = 'test'): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv,
    gemini: undefined,
    dataDir: '.data-test-session',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: { enabled: false, trustProxyHops: 0, rules: {}, maxKeys: 1000 },
  } as unknown as ServerConfig;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(options: { portal?: Partial<PortalConfig>; now?: () => number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-session-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  let clock = NOW;
  const app = buildServer({
    config: config(),
    store,
    tenants,
    now: options.now ?? (() => clock),
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true, ...options.portal },
  });
  await app.ready();
  return {
    app,
    store,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const devProof = (email: string, now = NOW) => issueDevToken(SECRET, email, now);

async function startSession(app: Awaited<ReturnType<typeof setup>>['app'], email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/portal/session',
    payload: { idToken: devProof(email) },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string; expiresAt: number; user: { email: string } }>();
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('session tokens', () => {
  it('round-trips, and refuses tampering, expiry and other secrets', () => {
    const { token, claims } = issueSessionToken(SECRET, { uid: 'u1', email: 'A@B.test' }, NOW);
    expect(claims.email).toBe('a@b.test');
    expect(claims.exp).toBe(NOW + SESSION_TTL_MS);
    expect(verifySessionToken(SECRET, token, NOW + 1000).uid).toBe('u1');
    expect(() => verifySessionToken('another-secret', token, NOW)).toThrow(/signature/);
    expect(() => verifySessionToken(SECRET, token, NOW + SESSION_TTL_MS)).toThrow(/expired/);
    const [prefix, body, sig] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...claims, email: 'boss@b.test' })).toString(
      'base64url',
    );
    expect(() => verifySessionToken(SECRET, `${prefix}.${forgedBody}.${sig}`, NOW)).toThrow(
      /signature/,
    );
    expect(() => verifySessionToken(SECRET, `${prefix}.${body}`, NOW)).toThrow(/malformed/);
  });

  it('cannot be refreshed past the absolute session limit', () => {
    const authAt = NOW - MAX_SESSION_MS + 10 * 60 * 1000;
    const { claims } = issueSessionToken(SECRET, { uid: 'u', email: 'a@b.test' }, NOW, authAt);
    expect(claims.exp).toBe(authAt + MAX_SESSION_MS);
  });
});

describe('POST /v1/portal/session', () => {
  it('exchanges a sign-in proof for a session that the portal accepts', async () => {
    const { app } = await setup();
    const session = await startSession(app, 'Owner@Bright.test');
    expect(session.token.startsWith('ses.')).toBe(true);
    expect(session.user.email).toBe('owner@bright.test');
    expect(session.expiresAt).toBe(NOW + SESSION_TTL_MS);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/portal/me',
      headers: bearer(session.token),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { email: string } }>().user.email).toBe('owner@bright.test');
  });

  it('refuses a forged or garbage proof', async () => {
    const { app } = await setup();
    for (const idToken of ['dev.not.real', 'eyJhbGciOiJSUzI1NiJ9.e30.c2ln', 'x'.repeat(40)]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/portal/session',
        payload: { idToken },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('will not mint a session from another session (refresh has its own route)', async () => {
    const { app } = await setup();
    const session = await startSession(app, 'a@b.test');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/portal/session',
      payload: { idToken: session.token },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses dev sign-in proofs when dev sign-in is off, as in production', async () => {
    const { app } = await setup({ portal: { devAuth: false } });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/portal/session',
      payload: { idToken: devProof('a@b.test') },
    });
    expect(response.statusCode).toBe(401);
    // And production refuses to turn it on whatever the variable says.
    expect(loadPortalConfig({ SUNNY_DEV_AUTH: '1' }, 'production').devAuth).toBe(false);
    expect(
      loadPortalConfig({ FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }, 'production')
        .firebaseEmulator,
    ).toBe(false);
  });

  it('expires: an hour-old session is refused, and refresh keeps it alive', async () => {
    const { app, advance } = await setup();
    const first = await startSession(app, 'a@b.test');
    advance(SESSION_TTL_MS - 5 * 60 * 1000);
    const refreshed = await app.inject({
      method: 'POST',
      url: '/v1/portal/session/refresh',
      headers: bearer(first.token),
    });
    expect(refreshed.statusCode).toBe(200);
    const second = refreshed.json<{ token: string; expiresAt: number }>();
    advance(10 * 60 * 1000);
    const old = await app.inject({
      method: 'GET',
      url: '/v1/portal/me',
      headers: bearer(first.token),
    });
    expect(old.statusCode).toBe(401);
    const fresh = await app.inject({
      method: 'GET',
      url: '/v1/portal/me',
      headers: bearer(second.token),
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('signs out everywhere', async () => {
    const { app, advance } = await setup();
    const laptop = await startSession(app, 'a@b.test');
    const phone = await startSession(app, 'a@b.test');
    advance(1000);
    const revoke = await app.inject({
      method: 'POST',
      url: '/v1/portal/sessions/revoke',
      headers: bearer(laptop.token),
    });
    expect(revoke.statusCode).toBe(200);
    for (const token of [laptop.token, phone.token]) {
      const me = await app.inject({ method: 'GET', url: '/v1/portal/me', headers: bearer(token) });
      expect(me.statusCode).toBe(401);
      const refresh = await app.inject({
        method: 'POST',
        url: '/v1/portal/session/refresh',
        headers: bearer(token),
      });
      expect(refresh.statusCode).toBe(401);
    }
    advance(1000);
    const again = await startSession(app, 'a@b.test');
    const me = await app.inject({
      method: 'GET',
      url: '/v1/portal/me',
      headers: bearer(again.token),
    });
    expect(me.statusCode).toBe(200);
  });
});

describe('Firebase emulator tokens', () => {
  const unsigned = (payload: Record<string, unknown>) =>
    `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(
      JSON.stringify(payload),
    ).toString('base64url')}.`;
  const claims = {
    aud: 'demo-sunny',
    iss: 'https://securetoken.google.com/demo-sunny',
    sub: 'emu-user',
    email: 'emu@b.test',
    email_verified: true,
    iat: Math.floor(NOW / 1000) - 10,
    exp: Math.floor(NOW / 1000) + 3600,
  };

  it('are accepted only in emulator mode, and their claims are still checked', async () => {
    const strict = createFirebaseVerifier({ projectId: 'demo-sunny', now: () => NOW });
    await expect(strict(unsigned(claims))).rejects.toThrow(/algorithm/);
    const emulator = createFirebaseVerifier({
      projectId: 'demo-sunny',
      emulator: true,
      now: () => NOW,
    });
    await expect(emulator(unsigned(claims))).resolves.toMatchObject({ email: 'emu@b.test' });
    await expect(emulator(unsigned({ ...claims, aud: 'other' }))).rejects.toThrow(/audience/);
  });

  it('cannot be switched on in production, whatever the environment says', () => {
    const env = {
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      FIREBASE_PROJECT_ID: 'demo-sunny',
    };
    expect(loadPortalConfig(env, 'development').firebaseEmulator).toBe(true);
    expect(loadPortalConfig(env, 'production').firebaseEmulator).toBe(false);
    expect(loadPortalConfig({}, 'development').firebaseEmulator).toBe(false);
  });
});

describe('team invitations', () => {
  it('invites by link; only the invited email can accept', async () => {
    const { app } = await setup();
    const owner = await startSession(app, 'owner@bright.test');
    const created = await app.inject({
      method: 'POST',
      url: '/v1/portal/tenants',
      headers: bearer(owner.token),
      payload: { companyName: 'Brightside Solar' },
    });
    const tenantId = created.json<{ tenant: { id: string } }>().tenant.id;
    const invite = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/members`,
      headers: bearer(owner.token),
      payload: { email: 'sam@bright.test', role: 'sales' },
    });
    expect(invite.statusCode).toBe(201);
    const url = invite.json<{ inviteUrl: string }>().inviteUrl;
    const token = decodeURIComponent(url.split('/invite/')[1] ?? '');
    expect(verifyInviteToken(SECRET, token, NOW).email).toBe('sam@bright.test');

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/portal/invite?token=${encodeURIComponent(token)}`,
    });
    expect(preview.json()).toMatchObject({
      companyName: 'Brightside Solar',
      email: 'sam@bright.test',
      role: 'sales',
      accepted: false,
    });

    const stranger = await startSession(app, 'eve@elsewhere.test');
    const refused = await app.inject({
      method: 'POST',
      url: '/v1/portal/invite/accept',
      headers: bearer(stranger.token),
      payload: { token },
    });
    expect(refused.statusCode).toBe(403);

    const sam = await startSession(app, 'sam@bright.test');
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/portal/invite/accept',
      headers: bearer(sam.token),
      payload: { token },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ tenantId, role: 'sales' });
  });

  it('rejects tampered, expired and unknown invitations', async () => {
    const { app } = await setup();
    const good = issueInviteToken(SECRET, { tenantId: 't_x', email: 'a@b.test' }, NOW);
    expect(() => verifyInviteToken('nope', good, NOW)).toThrow();
    expect(() => verifyInviteToken(SECRET, good, NOW + 15 * 24 * 3600 * 1000)).toThrow(/expired/);
    const unknown = await app.inject({
      method: 'GET',
      url: `/v1/portal/invite?token=${encodeURIComponent(good)}`,
    });
    expect(unknown.statusCode).toBe(404);
  });
});
