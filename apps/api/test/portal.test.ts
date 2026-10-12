import { generateKeyPairSync, createSign } from 'node:crypto';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import { MemoryVoiceUsage } from '../src/channels/voice/usage.js';
import { createFirebaseVerifier } from '../src/auth/firebase.js';
import { stripeSignatureHeader, verifyStripeSignature } from '../src/billing/signature.js';
import type { ServerConfig } from '../src/config.js';
import { hasEntitlement, PAYMENT_GRACE_DAYS } from '../src/entitlements.js';
import { csvField, driveFolderId, type KnowledgeSyncConnector } from '../src/routes/portal.js';
import { loadPortalConfig, type PortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';
const WHSEC = 'whsec_test_portal';
const PRICES = {
  base: 'price_base',
  email: 'price_email',
  voice: 'price_voice',
  suite: 'price_suite',
};

function makeConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-portal',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: false,
      trustProxyHops: 0,
      rules: {
        session: { limit: 1000, windowMs: 60_000 },
        chat: { limit: 1000, windowMs: 60_000 },
        leads: { limit: 1000, windowMs: 60_000 },
        qualification: { limit: 1000, windowMs: 60_000 },
        catalogue: { limit: 1000, windowMs: 60_000 },
        knowledge: { limit: 1000, windowMs: 60_000 },
      },
      maxKeys: 1000,
    },
  } as unknown as ServerConfig;
}

function portalConfig(over: Partial<PortalConfig> = {}): PortalConfig {
  return {
    ...loadPortalConfig({}, 'test'),
    devAuth: true,
    driveServiceAccountEmail: 'bot-sync@sunny.iam.gserviceaccount.com',
    stripe: { secretKey: 'sk_test_x', webhookSecret: WHSEC, prices: PRICES },
    ...over,
  };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(
  options: {
    voiceUsage?: MemoryVoiceUsage;
    portal?: Partial<PortalConfig>;
    knowledgeSync?: KnowledgeSyncConnector;
    now?: () => number;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-portal-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: makeConfig(),
    store,
    tenants,
    now: options.now ?? (() => NOW),
    portal: portalConfig(options.portal),
    ...(options.knowledgeSync ? { knowledgeSync: options.knowledgeSync } : {}),
    ...(options.voiceUsage ? { voice: { usage: options.voiceUsage } } : {}),
  });
  await app.ready();
  return { app, store, tenants, dir };
}

const as = (email: string) => ({ authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}` });

async function signUp(app: FastifyInstance, email: string, companyName = 'Brightside Solar') {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/portal/tenants',
    headers: as(email),
    payload: { companyName },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ tenant: { id: string; publicId: string } }>().tenant;
}

describe('portal sign-in', () => {
  it('refuses requests without a sign-in', async () => {
    const { app } = await setup();
    const response = await app.inject({ method: 'GET', url: '/v1/portal/me' });
    expect(response.statusCode).toBe(401);
  });

  it('issues dev tokens only when dev auth is on', async () => {
    const on = await setup();
    const ok = await on.app.inject({
      method: 'POST',
      url: '/v1/portal/dev-login',
      payload: { email: 'Owner@Example.com' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ magicLink: string }>().magicLink).toContain('/sign-in?token=');

    const off = await setup({ portal: { devAuth: false } });
    const refused = await off.app.inject({
      method: 'POST',
      url: '/v1/portal/dev-login',
      payload: { email: 'owner@example.com' },
    });
    expect(refused.statusCode).toBe(403);
    // And a dev token minted elsewhere is not accepted either.
    const me = await off.app.inject({ method: 'GET', url: '/v1/portal/me', headers: as('a@b.co') });
    expect(me.statusCode).toBe(401);
  });

  it('never enables dev auth in production', () => {
    expect(loadPortalConfig({ SUNNY_DEV_AUTH: '1' }, 'production').devAuth).toBe(false);
    expect(loadPortalConfig({ SUNNY_DEV_AUTH: '1' }, 'development').devAuth).toBe(true);
  });
});

describe('Firebase ID-token verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fakeFetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ k1: pem }), {
        headers: { 'cache-control': 'public, max-age=3600' },
      }),
    )) as typeof fetch;

  function token(payload: Record<string, unknown>, kid = 'k1'): string {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
    const body = b64(payload);
    const signer = createSign('RSA-SHA256');
    signer.update(`${head}.${body}`);
    return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`;
  }

  const nowS = Math.floor(NOW / 1000);
  const good = {
    aud: 'sunny-test',
    iss: 'https://securetoken.google.com/sunny-test',
    sub: 'uid_123',
    iat: nowS - 10,
    exp: nowS + 3600,
    auth_time: nowS - 10,
    email: 'Owner@Example.com',
    email_verified: true,
  };
  const verify = createFirebaseVerifier({
    projectId: 'sunny-test',
    fetch: fakeFetch,
    now: () => NOW,
  });

  it('accepts a valid token', async () => {
    await expect(verify(token(good))).resolves.toEqual({
      uid: 'uid_123',
      email: 'owner@example.com',
      emailVerified: true,
    });
  });

  it.each([
    ['wrong audience', { ...good, aud: 'other' }],
    ['wrong issuer', { ...good, iss: 'https://securetoken.google.com/other' }],
    ['expired', { ...good, exp: nowS - 1 }],
    ['issued in the future', { ...good, iat: nowS + 3600 }],
    ['missing subject', { ...good, sub: '' }],
  ])('rejects a token that is %s', async (reason, payload) => {
    await expect(verify(token(payload))).rejects.toThrow(reason);
  });

  it('rejects an unknown key and a tampered signature', async () => {
    await expect(verify(token(good, 'other-kid'))).rejects.toThrow('unknown signing key');
    const t = token(good);
    const [h, , s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...good, sub: 'attacker' })).toString('base64url');
    await expect(verify(`${h}.${forged}.${s}`)).rejects.toThrow('bad signature');
  });
});

describe('sign-up and tenancy', () => {
  it('creates a tenant with its owner, and serves its widget config', async () => {
    const { app } = await setup();
    const tenant = await signUp(app, 'owner@brightside.test');
    expect(tenant.id).toMatch(/^t_[a-z0-9]+$/);
    expect(tenant.publicId).toMatch(/^w_[a-z0-9]{10,40}$/);

    const me = await app.inject({
      method: 'GET',
      url: '/v1/portal/me',
      headers: as('owner@brightside.test'),
    });
    expect(me.json<{ tenants: unknown[] }>().tenants).toEqual([
      { id: tenant.id, companyName: 'Brightside Solar', role: 'owner' },
    ]);

    // The new installer's widget works straight away, and its config leaks no
    // server-only settings.
    const config = await app.inject({ method: 'GET', url: `/v1/widget/config/${tenant.publicId}` });
    expect(config.statusCode).toBe(200);
    const body = config.json<Record<string, unknown>>();
    expect(body['companyName']).toBe('Brightside Solar');
    expect(JSON.stringify(body)).not.toContain('addons');
  });

  it('persists tenants across a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-portal-'));
    dirs.push(dir);
    const first = await TenantRegistry.load(new FileStore(dir), defaultTenants(false));
    await first.save({ ...first.all[0]!, id: 't_persisted01', publicId: 'w_persisted001' });
    const second = await TenantRegistry.load(new FileStore(dir), defaultTenants(false));
    expect(second.byId('t_persisted01')?.publicId).toBe('w_persisted001');
    expect(second.byId('t_demo0001')).not.toBeNull();
  });

  it('keeps every portal route closed to other installers', async () => {
    const { app } = await setup();
    const a = await signUp(app, 'owner@a.test', 'A Solar');
    await signUp(app, 'owner@b.test', 'B Solar');
    const routes: Array<[string, string, unknown?]> = [
      ['GET', ''],
      ['POST', '/settings', { companyName: 'Hijacked' }],
      ['GET', '/overview'],
      ['GET', '/inbox'],
      ['GET', '/inbox/c_x'],
      ['GET', '/leads'],
      ['GET', '/leads.csv'],
      ['POST', '/leads/l_x/status', { status: 'won' }],
      ['GET', '/knowledge'],
      ['POST', '/knowledge/website', { url: 'https://evil.test' }],
      ['POST', '/knowledge/drive', { folder: 'abcdefghijkl' }],
      ['POST', '/knowledge/sync'],
      ['GET', '/members'],
      ['POST', '/members', { email: 'x@b.test', role: 'owner' }],
      ['POST', '/members/remove', { email: 'owner@a.test' }],
      ['GET', '/billing'],
      ['POST', '/billing/checkout', { plan: 'suite' }],
      ['POST', '/billing/portal'],
    ];
    for (const [method, path, payload] of routes) {
      const response = await app.inject({
        method: method as 'GET' | 'POST',
        url: `/v1/portal/tenants/${a.id}${path}`,
        headers: as('owner@b.test'),
        ...(payload ? { payload: payload as Record<string, unknown> } : {}),
      });
      expect(response.statusCode, `${method} ${path}`).toBe(404);
    }
    const unchanged = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${a.id}`,
      headers: as('owner@a.test'),
    });
    expect(unchanged.json<{ tenant: { companyName: string } }>().tenant.companyName).toBe(
      'A Solar',
    );
  });
});

describe('roles', () => {
  it('lets a viewer read but not change settings, and sales update leads', async () => {
    const { app, store } = await setup();
    const t = await signUp(app, 'owner@r.test');
    for (const [email, role] of [
      ['viewer@r.test', 'viewer'],
      ['sales@r.test', 'sales'],
    ] as const) {
      const invite = await app.inject({
        method: 'POST',
        url: `/v1/portal/tenants/${t.id}/members`,
        headers: as('owner@r.test'),
        payload: { email, role },
      });
      expect(invite.statusCode).toBe(201);
    }
    const read = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}`,
      headers: as('viewer@r.test'),
    });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${t.id}/settings`,
      headers: as('viewer@r.test'),
      payload: { companyName: 'Nope' },
    });
    expect(write.statusCode).toBe(403);

    await store.saveLead({
      id: 'lead_role1',
      tenantId: t.id,
      sessionId: 's_role',
      conversationId: null,
      name: 'Ada',
      email: 'ada@example.test',
      phone: null,
      postcode: 'SW1A 1AA',
      summary: 'Wants a battery',
      score: null,
      createdAt: new Date(NOW).toISOString(),
    });
    const viewerStatus = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${t.id}/leads/lead_role1/status`,
      headers: as('viewer@r.test'),
      payload: { status: 'contacted' },
    });
    expect(viewerStatus.statusCode).toBe(403);
    const salesStatus = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${t.id}/leads/lead_role1/status`,
      headers: as('sales@r.test'),
      payload: { status: 'contacted' },
    });
    expect(salesStatus.statusCode).toBe(200);
    const leads = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}/leads`,
      headers: as('viewer@r.test'),
    });
    expect(leads.json<{ leads: Array<{ status: string }> }>().leads[0]?.status).toBe('contacted');
  });

  it('protects owners: only an owner adds an owner, and the last owner stays', async () => {
    const { app } = await setup();
    const t = await signUp(app, 'owner@o.test');
    await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${t.id}/members`,
      headers: as('owner@o.test'),
      payload: { email: 'admin@o.test', role: 'admin' },
    });
    const escalate = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${t.id}/members`,
      headers: as('admin@o.test'),
      payload: { email: 'admin@o.test', role: 'owner' },
    });
    expect(escalate.statusCode).toBe(403);
    const removeOwner = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${t.id}/members/remove`,
      headers: as('owner@o.test'),
      payload: { email: 'owner@o.test' },
    });
    expect(removeOwner.statusCode).toBe(400);
  });
});

describe('settings, overview and inbox', () => {
  it('saves the installer phone and clears the setup warning', async () => {
    const { app } = await setup();
    const t = await signUp(app, 'owner@s.test');
    const before = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}/overview`,
      headers: as('owner@s.test'),
    });
    expect(before.json<{ warnings: Array<{ id: string }> }>().warnings.map((w) => w.id)).toContain(
      'support-contact',
    );
    const save = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${t.id}/settings`,
      headers: as('owner@s.test'),
      payload: {
        supportContact: { phone: '01632 960123', hours: 'Mon–Fri 9–5' },
        domains: ['Brightside.co.uk'],
        primaryColor: '#7c4dff',
        onboardingStep: 'live',
      },
    });
    expect(save.statusCode).toBe(200);
    const tenant = save.json<{ tenant: Record<string, unknown> }>().tenant;
    expect(tenant['supportContact']).toEqual({ phone: '01632 960123', hours: 'Mon–Fri 9–5' });
    expect(tenant['domains']).toEqual(['brightside.co.uk']);
    expect(tenant['primaryColor']).toBe('#7C4DFF');
    expect((tenant['onboarding'] as { completedAt: string | null }).completedAt).not.toBeNull();
    const after = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}/overview`,
      headers: as('owner@s.test'),
    });
    expect(
      after.json<{ warnings: Array<{ id: string }> }>().warnings.map((w) => w.id),
    ).not.toContain('support-contact');
  });

  it('rejects invalid settings', async () => {
    const { app } = await setup();
    const t = await signUp(app, 'owner@v.test');
    for (const payload of [
      { primaryColor: 'red' },
      { domains: ['not a domain'] },
      { greeting: '' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/portal/tenants/${t.id}/settings`,
        headers: as('owner@v.test'),
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('lists safety escalations first, with intent and channel filters', async () => {
    const { app, store, dir } = await setup();
    const t = await signUp(app, 'owner@i.test');
    const turn = (text: string, at: number) => ({
      role: 'user' as const,
      text,
      at: new Date(at).toISOString(),
    });
    await store.appendTurn(t.id, 's_sales', turn('How much is a battery?', NOW - 1000));
    await store.appendTurn(
      t.id,
      's_safety',
      turn('There is a burning smell from my inverter', NOW - 5000),
    );
    // The core marks intent and escalation on the conversation; here the
    // classified records are appended as the store would write them (the last
    // line for a session wins).
    const sales = await store.getConversation(t.id, 's_sales');
    const safety = await store.getConversation(t.id, 's_safety');
    const file = join(dir, 'conversations', `${encodeURIComponent(t.id)}.jsonl`);
    await appendFile(
      file,
      `${JSON.stringify({ ...sales, intent: 'sales' })}
`,
    );
    await appendFile(
      file,
      `${JSON.stringify({
        ...safety,
        intent: 'support',
        escalation: { kind: 'safety', reason: 'burning smell', at: new Date(NOW).toISOString() },
      })}
`,
    );

    const inbox = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}/inbox`,
      headers: as('owner@i.test'),
    });
    const rows = inbox.json<{ conversations: Array<{ intent: string; escalation: unknown }> }>()
      .conversations;
    expect(rows.map((r) => r.intent)).toEqual(['support', 'sales']);
    expect(rows[0]?.escalation).not.toBeNull();

    const escalated = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}/inbox?escalated=1`,
      headers: as('owner@i.test'),
    });
    expect(escalated.json<{ conversations: unknown[] }>().conversations).toHaveLength(1);
    const support = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}/inbox?intent=sales&channel=chat`,
      headers: as('owner@i.test'),
    });
    expect(support.json<{ conversations: unknown[] }>().conversations).toHaveLength(1);
  });

  it('reads intent and safety escalations recorded on turns', async () => {
    const { app, store } = await setup();
    const t = await signUp(app, 'owner@turns.test');
    await store.appendTurn(t.id, 's_turn_sales', {
      role: 'user',
      text: 'Do you fit batteries?',
      at: new Date(NOW - 60_000).toISOString(),
      intent: 'sales',
    });
    await store.appendTurn(t.id, 's_turn_smoke', {
      role: 'user',
      text: 'My inverter is smoking',
      at: new Date(NOW - 120_000).toISOString(),
      channel: 'chat',
    });
    await store.appendTurn(t.id, 's_turn_smoke', {
      role: 'assistant',
      text: 'Please switch off at the isolator and call us now.',
      at: new Date(NOW - 119_000).toISOString(),
      intent: 'support',
      escalation: 'safety',
    });
    const inbox = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}/inbox`,
      headers: as('owner@turns.test'),
    });
    const rows = inbox.json<{
      conversations: Array<{ intent: string; escalation: { reason: string } | null }>;
    }>().conversations;
    expect(rows[0]).toMatchObject({
      intent: 'support',
      escalation: { reason: 'My inverter is smoking' },
    });
    expect(rows[1]).toMatchObject({ intent: 'sales', escalation: null });
    const overview = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}/overview`,
      headers: as('owner@turns.test'),
    });
    expect(
      overview.json<{ conversations: { escalations: number } }>().conversations.escalations,
    ).toBe(1);
  });

  it('exports leads as CSV with formulas defused', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+44 7700 900123')).toBe("'+44 7700 900123");
    expect(csvField('plain')).toBe('plain');
    expect(csvField(null)).toBe('');
  });
});

describe('knowledge connections', () => {
  it('parses Drive folder links and ids', () => {
    expect(
      driveFolderId('https://drive.google.com/drive/folders/1AbC_def-GHIjkl?usp=sharing'),
    ).toBe('1AbC_def-GHIjkl');
    expect(driveFolderId('1AbC_def-GHIjkl')).toBe('1AbC_def-GHIjkl');
    expect(driveFolderId('not a folder')).toBeNull();
  });

  it('records a pending sync without a connector, and starts one with it', async () => {
    // An empty connector: the server now wires the knowledge pipeline by default,
    // so "no way to sync" has to be said explicitly.
    const without = await setup({ knowledgeSync: {} });
    const t1 = await signUp(without.app, 'owner@k.test');
    const pending = await without.app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${t1.id}/knowledge/website`,
      headers: as('owner@k.test'),
      payload: { url: 'https://brightside.test' },
    });
    expect(pending.json<{ website: { status: string } }>().website.status).toBe('pending');
    // Connecting the website registers it as the widget's domain, so the
    // installer's site can open sessions without anyone editing server config.
    const registered = await without.app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t1.id}`,
      headers: as('owner@k.test'),
    });
    expect(registered.json<{ tenant: { domains: string[] } }>().tenant.domains).toContain(
      'brightside.test',
    );

    const calls: string[] = [];
    const withSync = await setup({
      knowledgeSync: {
        syncDrive: (_tenant, folderId) => {
          calls.push(folderId);
          return Promise.resolve({ jobId: 'job_1' });
        },
      },
    });
    const t2 = await signUp(withSync.app, 'owner@k2.test');
    const drive = await withSync.app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${t2.id}/knowledge/drive`,
      headers: as('owner@k2.test'),
      payload: { folder: 'https://drive.google.com/drive/folders/1AbC_def-GHIjkl' },
    });
    expect(drive.json<{ drive: { status: string; jobId: string } }>().drive).toMatchObject({
      status: 'syncing',
      jobId: 'job_1',
    });
    expect(calls).toEqual(['1AbC_def-GHIjkl']);
    const view = await withSync.app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t2.id}/knowledge`,
      headers: as('owner@k2.test'),
    });
    expect(view.json<{ drive: { serviceAccountEmail: string } }>().drive.serviceAccountEmail).toBe(
      'bot-sync@sunny.iam.gserviceaccount.com',
    );
  });
});

describe('Stripe billing', () => {
  it('verifies signatures and their age', () => {
    const body = '{"id":"evt_1"}';
    const header = stripeSignatureHeader(WHSEC, NOW / 1000, body);
    expect(() => verifyStripeSignature(body, header, WHSEC, NOW)).not.toThrow();
    expect(() => verifyStripeSignature(`${body} `, header, WHSEC, NOW)).toThrow('does not match');
    expect(() => verifyStripeSignature(body, header, 'whsec_other', NOW)).toThrow('does not match');
    expect(() => verifyStripeSignature(body, header, WHSEC, NOW + 10 * 60_000)).toThrow(
      'tolerance',
    );
    expect(() => verifyStripeSignature(body, undefined, WHSEC, NOW)).toThrow('missing');
  });

  async function deliver(app: FastifyInstance, event: Record<string, unknown>, at = NOW) {
    const raw = JSON.stringify(event);
    return await app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripeSignatureHeader(WHSEC, Math.floor(at / 1000), raw),
      },
      payload: raw,
    });
  }

  it('turns on a purchased add-on exactly once, and refuses forged deliveries', async () => {
    const { app, tenants } = await setup();
    const t = await signUp(app, 'owner@b.test');
    expect(hasEntitlement(tenants.byId(t.id)!, 'email_assistant', NOW)).toBe(false);

    const event = {
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      created: NOW / 1000,
      data: {
        object: {
          client_reference_id: t.id,
          customer: 'cus_123',
          subscription: 'sub_123',
          metadata: { tenant_id: t.id, plan: 'email' },
        },
      },
    };
    const first = await deliver(app, event);
    expect(first.json<{ outcome: string }>().outcome).toBe('applied');
    const again = await deliver(app, event);
    expect(again.json<{ outcome: string }>().outcome).toBe('duplicate');

    const tenant = tenants.byId(t.id)!;
    expect(hasEntitlement(tenant, 'email_assistant', NOW)).toBe(true);
    expect(hasEntitlement(tenant, 'web_chat', NOW)).toBe(true);
    expect(tenant.stripeCustomerId).toBe('cus_123');

    const forged = await app.inject({
      method: 'POST',
      url: '/v1/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' },
      payload: JSON.stringify({ ...event, id: 'evt_forged' }),
    });
    expect(forged.statusCode).toBe(400);
  });

  it('applies subscription changes in order, with a grace period on failed payment', async () => {
    let clock = NOW;
    const { app, tenants } = await setup({ now: () => clock });
    const t = await signUp(app, 'owner@g.test');
    const sub = (id: string, created: number, status: string, price: string) => ({
      id,
      type: 'customer.subscription.updated',
      created,
      data: {
        object: {
          id: 'sub_9',
          customer: 'cus_9',
          status,
          metadata: { tenant_id: t.id },
          items: { data: [{ price: { id: price } }] },
        },
      },
    });
    await deliver(app, sub('evt_a', NOW / 1000, 'active', 'price_suite'));
    expect(hasEntitlement(tenants.byId(t.id)!, 'phone_agent', clock)).toBe(true);

    // An older event arriving late cannot undo the newer state.
    const stale = await deliver(app, sub('evt_old', NOW / 1000 - 100, 'active', 'price_base'));
    expect(stale.json<{ outcome: string }>().outcome).toBe('stale');
    expect(hasEntitlement(tenants.byId(t.id)!, 'phone_agent', clock)).toBe(true);

    await deliver(app, {
      id: 'evt_fail',
      type: 'invoice.payment_failed',
      created: NOW / 1000 + 10,
      data: { object: { customer: 'cus_9', metadata: {} } },
    });
    expect(tenants.byId(t.id)!.billing?.status).toBe('past_due');
    clock = NOW + (PAYMENT_GRACE_DAYS - 1) * 86_400_000;
    expect(hasEntitlement(tenants.byId(t.id)!, 'phone_agent', clock)).toBe(true);
    clock = NOW + (PAYMENT_GRACE_DAYS + 1) * 86_400_000;
    expect(hasEntitlement(tenants.byId(t.id)!, 'phone_agent', clock)).toBe(false);
    expect(hasEntitlement(tenants.byId(t.id)!, 'web_chat', clock)).toBe(false);

    await deliver(
      app,
      {
        id: 'evt_paid',
        type: 'invoice.paid',
        created: NOW / 1000 + 20,
        data: { object: { customer: 'cus_9', metadata: {} } },
      },
      clock,
    );
    expect(hasEntitlement(tenants.byId(t.id)!, 'phone_agent', clock)).toBe(true);

    await deliver(
      app,
      {
        id: 'evt_del',
        type: 'customer.subscription.deleted',
        created: NOW / 1000 + 30,
        data: { object: { id: 'sub_9', customer: 'cus_9', metadata: { tenant_id: t.id } } },
      },
      clock,
    );
    for (const key of ['web_chat', 'email_assistant', 'voice_widget', 'phone_agent'] as const) {
      expect(hasEntitlement(tenants.byId(t.id)!, key, clock), key).toBe(false);
    }
  });

  it('reports voice minutes used against the monthly quota', async () => {
    const usage = new MemoryVoiceUsage();
    const { app, tenants } = await setup({ voiceUsage: usage });
    const t = await signUp(app, 'owner@voice.test');
    await usage.record({
      tenantId: t.id,
      sessionId: 'call_1',
      kind: 'phone',
      startedAt: new Date(NOW - 60_000).toISOString(),
      endedAt: new Date(NOW).toISOString(),
      seconds: 150,
      endReason: 'hangup',
    });
    const tenant = tenants.byId(t.id)!;
    await tenants.save({ ...tenant, addonConfig: { phone_agent: { monthlyQuota: 500 } } });
    const billing = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${t.id}/billing`,
      headers: as('owner@voice.test'),
    });
    expect(billing.json<{ voice: unknown }>().voice).toEqual({
      numbers: [],
      minutesUsed: 3,
      minutesQuota: 500,
    });
  });

  it('creates a Checkout session for the owner only', async () => {
    const posted: Array<{ url: string; body: string }> = [];
    const { app } = await setup();
    // Swap the global fetch for the Stripe call only.
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
      posted.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : '' });
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })),
      );
    }) as typeof fetch;
    try {
      const t = await signUp(app, 'owner@c.test');
      await app.inject({
        method: 'POST',
        url: `/v1/portal/tenants/${t.id}/members`,
        headers: as('owner@c.test'),
        payload: { email: 'admin@c.test', role: 'admin' },
      });
      const denied = await app.inject({
        method: 'POST',
        url: `/v1/portal/tenants/${t.id}/billing/checkout`,
        headers: as('admin@c.test'),
        payload: { plan: 'voice' },
      });
      expect(denied.statusCode).toBe(403);
      const ok = await app.inject({
        method: 'POST',
        url: `/v1/portal/tenants/${t.id}/billing/checkout`,
        headers: as('owner@c.test'),
        payload: { plan: 'voice' },
      });
      expect(ok.json<{ url: string }>().url).toBe('https://checkout.stripe.test/cs_1');
      expect(posted[0]?.url).toBe('https://api.stripe.com/v1/checkout/sessions');
      const params = new URLSearchParams(posted[0]!.body);
      expect(params.get('line_items[0][price]')).toBe('price_voice');
      expect(params.get('metadata[tenant_id]')).toBe(t.id);
      expect(params.get('subscription_data[metadata][plan]')).toBe('voice');
    } finally {
      globalThis.fetch = original;
    }
  });
});
