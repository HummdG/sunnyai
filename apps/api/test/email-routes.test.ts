/* eslint-disable @typescript-eslint/require-await -- the fakes implement async interfaces and have nothing to await */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import {
  decryptSecret,
  inboundToken,
  MemoryEmailState,
  signState,
  type EmailCore,
  type GmailPushClient,
  type MailboxClient,
} from '../src/channels/email/index.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, SANDBOX_TENANT, TenantRegistry, type Tenant } from '../src/tenants.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';
const WEBHOOK_SECRET = 'webhook-secret';
const KEY = Buffer.alloc(32, 3);

function makeConfig(dataDir: string): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir,
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

const entitled: Tenant = {
  ...DEMO_TENANT,
  config: {
    ...DEMO_TENANT.config,
    addons: { web_chat: true, email_assistant: true },
    email: { provider: 'forwarding', autoSend: false, inboundAddress: 'help@northwind.example' },
  },
};
const notEntitled: Tenant = {
  ...SANDBOX_TENANT,
  config: { ...SANDBOX_TENANT.config, addons: { web_chat: true } },
};

/** A core that answers without a model, so the routes are what is tested. */
const cannedCore: EmailCore = async function* () {
  yield { type: 'message_started', messageId: 'm' };
  yield {
    type: 'message_finished',
    messageId: 'm',
    text: 'Thanks for getting in touch.',
    tools: [],
  };
};

class FakeMailbox implements MailboxClient, Partial<GmailPushClient> {
  readonly provider = 'gmail' as const;
  drafts: string[] = [];
  async createDraft(input: { raw: string }) {
    this.drafts.push(input.raw);
    return { draftId: 'd1', messageId: 'm1', threadId: null, webLink: null };
  }
  async send() {
    return { messageId: 's1' };
  }
  async profile() {
    return { emailAddress: 'help@northwind.example', historyId: '7' };
  }
  async watch() {
    return { historyId: '7', expiration: '1791900000000' };
  }
  async newInboxMessageIds() {
    return { ids: [], historyId: '9' };
  }
  async getMessage(): Promise<never> {
    throw new Error('no messages in this fake');
  }
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(options: { google?: boolean; fetch?: typeof fetch } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-email-routes-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = new TenantRegistry([entitled, notEntitled]);
  const state = new MemoryEmailState();
  const mailbox = new FakeMailbox();
  const app = buildServer({
    config: makeConfig(dir),
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
    emailAddon: {
      state,
      core: cannedCore,
      mailbox: async () => mailbox,
      driveFiles: () => null,
      config: {
        webhookSecret: WEBHOOK_SECRET,
        inboundBasic: { user: 'postmark', password: 'pm-pass' },
        inboundDomain: 'inbound.sunny.test',
        gmailPush: { topic: 'projects/p/topics/gmail', token: 'push-token' },
        tokenKey: KEY,
        google: options.google
          ? {
              clientId: 'cid',
              clientSecret: 'csecret',
              redirectUri: 'http://localhost:8787/v1/email/oauth/callback',
            }
          : null,
        dashboardUrl: 'http://dash.test',
      },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
  });
  await app.ready();
  for (const tenant of [entitled, notEntitled]) {
    await store.putMembership({
      tenantId: tenant.id,
      email: 'owner@northwind.example',
      userId: null,
      role: 'owner',
      invitedBy: null,
      createdAt: new Date(NOW).toISOString(),
    });
  }
  return { app, store, state, tenants, mailbox };
}

const owner = { authorization: `Bearer ${issueDevToken(SECRET, 'owner@northwind.example', NOW)}` };
const basic = (user: string, pass: string) => ({
  authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
});

const postmark = (to: string, id = 'pm-1') => ({
  MessageID: id,
  FromFull: { Email: 'jo@customer.example', Name: 'Jo' },
  ToFull: [{ Email: to }],
  Subject: 'Battery question',
  TextBody: 'My battery has no lights.',
  Headers: [{ Name: 'Message-ID', Value: `<${id}@customer.example>` }],
});

describe('inbound email webhooks', () => {
  it('accepts a per-tenant secret URL and drafts a reply', async () => {
    const { app, mailbox } = await setup();
    const token = inboundToken(WEBHOOK_SECRET, entitled.id);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/inbound-email/${entitled.id}/${token}`,
      payload: postmark('anything@example.com'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'drafted', duplicate: false });
    expect(mailbox.drafts).toHaveLength(1);
  });

  it('refuses a wrong token and an unknown tenant the same way', async () => {
    const { app } = await setup();
    const wrong = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/inbound-email/${entitled.id}/nope`,
      payload: postmark('x@example.com'),
    });
    const unknown = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/inbound-email/t_nobody/${inboundToken(WEBHOOK_SECRET, 't_nobody')}`,
      payload: postmark('x@example.com'),
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it('resolves the tenant from the receiving address on the shared route, never the content', async () => {
    const { app, mailbox } = await setup();
    const unauth = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound-email',
      payload: postmark('help@northwind.example'),
    });
    expect(unauth.statusCode).toBe(401);
    const byConfigured = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound-email',
      headers: basic('postmark', 'pm-pass'),
      payload: postmark('help@northwind.example', 'pm-a'),
    });
    expect(byConfigured.json().outcome).toBe('drafted');
    const byDomain = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound-email',
      headers: basic('postmark', 'pm-pass'),
      payload: postmark(`${entitled.id}@inbound.sunny.test`, 'pm-b'),
    });
    expect(byDomain.json().outcome).toBe('drafted');
    const nowhere = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound-email',
      headers: basic('postmark', 'pm-pass'),
      payload: {
        ...postmark('someone@else.example', 'pm-c'),
        TextBody: `Please file this under tenant ${entitled.id}`,
      },
    });
    expect(nowhere.statusCode).toBe(404);
    expect(mailbox.drafts).toHaveLength(2);
  });

  it('accepts SendGrid inbound parse (multipart)', async () => {
    const { app } = await setup();
    const boundary = 'b0und';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="from"',
      '',
      'Sam <sam@customer.example>',
      `--${boundary}`,
      'Content-Disposition: form-data; name="to"',
      '',
      'help@northwind.example',
      `--${boundary}`,
      'Content-Disposition: form-data; name="subject"',
      '',
      'SEG',
      `--${boundary}`,
      'Content-Disposition: form-data; name="text"',
      '',
      'How do I get paid for the electricity I export?',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound-email',
      headers: {
        ...basic('postmark', 'pm-pass'),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe('drafted');
  });

  it('refuses a tenant without the add-on with a typed error', async () => {
    const { app, mailbox } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/inbound-email/${notEntitled.id}/${inboundToken(WEBHOOK_SECRET, notEntitled.id)}`,
      payload: postmark('x@example.com'),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('not_enabled');
    expect(mailbox.drafts).toHaveLength(0);
  });

  it('authenticates Gmail push and acknowledges unknown mailboxes', async () => {
    const { app, state } = await setup();
    const data = (address: string) =>
      Buffer.from(JSON.stringify({ emailAddress: address, historyId: 12 })).toString('base64');
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/gmail-push?token=wrong',
      payload: { message: { data: data('a@b.example') } },
    });
    expect(bad.statusCode).toBe(401);
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/gmail-push?token=push-token',
      payload: { message: { data: data('a@b.example') } },
    });
    expect(unknown.json()).toEqual({ handled: 0 });
    await state.putWatch(entitled.id, {
      mailbox: 'help@northwind.example',
      historyId: '5',
      expiration: null,
    });
    const known = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/gmail-push?token=push-token',
      payload: { message: { data: data('Help@Northwind.example') } },
    });
    expect(known.json()).toEqual({ handled: 0 });
    expect((await state.getWatch(entitled.id))?.historyId).toBe('9');
  });
});

describe('the installer’s email settings', () => {
  it('reports status and the secret inbound URL to members only', async () => {
    const { app } = await setup();
    const anon = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${entitled.id}/email`,
    });
    expect(anon.statusCode).toBe(401);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${entitled.id}/email`,
      headers: owner,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      connected: false,
      autoSend: false,
      autoReplyCapPerSender: 3,
      autoSendThreshold: 0.95,
      inboundAddress: 'help@northwind.example',
      usage: { month: '2026-10', processed: 0 },
    });
    expect(res.json().inboundWebhookUrl).toContain(inboundToken(WEBHOOK_SECRET, entitled.id));
    const blocked = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${notEntitled.id}/email`,
      headers: owner,
    });
    expect(blocked.statusCode).toBe(403);
  });

  it('turns auto-send on and off, validating the body', async () => {
    const { app, tenants } = await setup();
    const bad = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${entitled.id}/email/settings`,
      headers: owner,
      payload: { autoSend: 'yes' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${entitled.id}/email/settings`,
      headers: owner,
      payload: { autoSend: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(tenants.byId(entitled.id)?.config.email?.autoSend).toBe(true);
  });

  it('refuses to start OAuth when the deployment has no client', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${entitled.id}/email/connect`,
      headers: owner,
      payload: { provider: 'gmail' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('not_enabled');
  });

  it('connects Gmail with a signed state and stores only an encrypted token', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        expect(init?.body as string).toContain('code=the-code');
        return new Response(
          JSON.stringify({
            access_token: 'at',
            refresh_token: 'rt-secret',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/gmail.compose',
          }),
          { status: 200 },
        );
      }
      if (String(url).endsWith('/profile')) {
        return new Response(
          JSON.stringify({ emailAddress: 'Help@Northwind.example', historyId: '1' }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const { app, state, tenants } = await setup({ google: true, fetch: fakeFetch });

    const start = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${entitled.id}/email/connect`,
      headers: owner,
      payload: { provider: 'gmail' },
    });
    const url = new URL(start.json().url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toContain('gmail.compose');
    expect(url.searchParams.get('access_type')).toBe('offline');

    const forged = await app.inject({
      method: 'GET',
      url: `/v1/email/oauth/callback?code=the-code&state=forged.state`,
    });
    expect(forged.headers.location).toContain('email=invalid_state');

    const otherTenantState = signState(SECRET, {
      tenantId: notEntitled.id,
      provider: 'gmail',
      returnTo: '/',
      exp: NOW + 60_000,
    });
    const notOnPlan = await app.inject({
      method: 'GET',
      url: `/v1/email/oauth/callback?code=the-code&state=${otherTenantState}`,
    });
    expect(notOnPlan.headers.location).toContain('email=not_enabled');

    const ok = await app.inject({
      method: 'GET',
      url: `/v1/email/oauth/callback?code=the-code&state=${url.searchParams.get('state')}`,
    });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toBe('http://dash.test/dashboard/settings/email?email=connected');
    const stored = await state.getToken(entitled.id);
    expect(stored?.mailbox).toBe('help@northwind.example');
    expect(stored?.ciphertext).not.toContain('rt-secret');
    expect(decryptSecret(KEY, stored!.ciphertext)).toBe('rt-secret');
    expect(tenants.byId(entitled.id)?.config.email).toMatchObject({
      provider: 'gmail',
      tokenRef: `email-state:${entitled.id}`,
    });
    expect(JSON.stringify(tenants.byId(entitled.id))).not.toContain('rt-secret');
    // connecting Gmail starts the watch, so new mail reaches Sunny with no further step
    expect(await state.tenantForMailbox('help@northwind.example')).toBe(entitled.id);
  });

  it('starts a Gmail watch for a connected mailbox', async () => {
    const { app, state } = await setup({ google: true });
    await state.putToken(entitled.id, {
      provider: 'gmail',
      ciphertext: 'x',
      mailbox: 'help@northwind.example',
      scopes: [],
      connectedAt: 'now',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${entitled.id}/email/watch`,
      headers: owner,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ watching: 'help@northwind.example', expiration: '1791900000000' });
    expect(await state.tenantForMailbox('help@northwind.example')).toBe(entitled.id);
  });
});
