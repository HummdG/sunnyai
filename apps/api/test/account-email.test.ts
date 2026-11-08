import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  accountEmailBodies,
  accountEmailContent,
  accountMailFromEnv,
  AccountLinkError,
  brandedActionLink,
  buildAccountMime,
  createAccountMailer,
  type AccountMailer,
  type LinkRequest,
} from '../src/auth/account-email.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const SITE = 'https://heysunny.co.uk';
const OOB =
  'https://heysunny-prod.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABC123&apiKey=key1&continueUrl=https%3A%2F%2Fheysunny.co.uk%2Fsign-in%3Freset%3D1&lang=en';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('account email links', () => {
  it("moves Firebase's link onto the website, keeping every parameter", () => {
    const link = new URL(brandedActionLink(OOB, SITE));
    expect(link.origin + link.pathname).toBe('https://heysunny.co.uk/auth/action');
    expect(Object.fromEntries(link.searchParams)).toEqual({
      mode: 'resetPassword',
      oobCode: 'ABC123',
      apiKey: 'key1',
      continueUrl: 'https://heysunny.co.uk/sign-in?reset=1',
      lang: 'en',
    });
  });

  it('refuses a link with no action code', () => {
    expect(() =>
      brandedActionLink('https://x.firebaseapp.com/__/auth/action?mode=x', SITE),
    ).toThrow(/action code/);
  });

  it('is configured only with every setting', () => {
    const env = {
      SUNNY_ACCOUNT_MAIL_SERVICE_ACCOUNT: 'api@p.iam.gserviceaccount.com',
      SUNNY_ACCOUNT_MAIL_MAILBOX: 'hummd@heysunny.co.uk',
      SUNNY_ACCOUNT_MAIL_FROM: 'HeySunny <support@heysunny.co.uk>',
    };
    expect(accountMailFromEnv(env, 'p', `${SITE}/`)).toMatchObject({ siteUrl: SITE });
    expect(accountMailFromEnv(env, null, SITE)).toBeNull();
    expect(accountMailFromEnv({ ...env, SUNNY_ACCOUNT_MAIL_FROM: ' ' }, 'p', SITE)).toBeNull();
  });
});

describe('account email content', () => {
  it('writes every kind without em dashes, and escapes the link in HTML', () => {
    for (const kind of ['verifyEmail', 'resetPassword', 'signIn', 'changeEmail'] as const) {
      const content = accountEmailContent(kind);
      const { text, html } = accountEmailBodies(content, `${SITE}/auth/action?a=1&b=2`, SITE);
      expect(`${text}${html}`).not.toContain('—');
      expect(text).toContain(`${SITE}/auth/action?a=1&b=2`);
      expect(html).toContain('a=1&#38;b=2');
      expect(html).toContain(`${SITE}/brand/sunny-logo-128.png`);
    }
  });

  it('builds a text-and-HTML message with no header injection', () => {
    const raw = buildAccountMime({
      from: 'HeySunny <support@heysunny.co.uk>',
      to: 'jo@example.com\r\nBcc: x@evil.test',
      subject: 'Reset your HeySunny password',
      text: 'hello',
      html: '<p>hello</p>',
    });
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="sunny_');
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(raw).not.toMatch(/^Bcc:/m);
  });
});

describe('the mailer', () => {
  it('asks Firebase for the link without sending, then sends through Gmail as the mailbox', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const respond = (url: string): Response => {
      if (url.includes(':signJwt')) return Response.json({ signedJwt: 'jwt' });
      if (url.includes('oauth2.googleapis.com')) {
        return Response.json({ access_token: 'gmail-token', expires_in: 3600 });
      }
      if (url.includes('accounts:sendOobCode')) return Response.json({ oobLink: OOB });
      if (url.includes('gmail.googleapis.com')) return Response.json({ id: 'm1' });
      return new Response('unexpected', { status: 500 });
    };
    const fakeFetch = ((url: string, init?: RequestInit) => {
      const body = init?.body;
      calls.push({
        url,
        body: body instanceof URLSearchParams ? body.toString() : (body as string),
      });
      return Promise.resolve(respond(url));
    }) as typeof fetch;
    const mailer = createAccountMailer(
      {
        serviceAccount: 'api@p.iam.gserviceaccount.com',
        mailbox: 'hummd@heysunny.co.uk',
        from: 'HeySunny <support@heysunny.co.uk>',
        projectId: 'heysunny-prod',
        siteUrl: SITE,
      },
      { fetch: fakeFetch, runtimeToken: () => Promise.resolve('runtime') },
    );
    await mailer.send({
      kind: 'resetPassword',
      email: 'jo@example.com',
      continueUrl: `${SITE}/sign-in?reset=1`,
    });

    const oob = JSON.parse(calls.find((c) => c.url.includes('sendOobCode'))!.body);
    expect(oob).toMatchObject({ requestType: 'PASSWORD_RESET', returnOobLink: true });
    const jwt = JSON.parse(JSON.parse(calls.find((c) => c.url.includes('signJwt'))!.body).payload);
    expect(jwt).toMatchObject({
      sub: 'hummd@heysunny.co.uk',
      scope: 'https://www.googleapis.com/auth/gmail.send',
    });
    const raw = Buffer.from(
      JSON.parse(calls.find((c) => c.url.includes('gmail'))!.body).raw,
      'base64url',
    ).toString('utf8');
    expect(raw).toContain('From: HeySunny <support@heysunny.co.uk>');
    expect(raw).toContain('To: jo@example.com');
  });
});

function config(rateLimit = false): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-account-email',
    allowedOrigins: [],
    sessionSecret: 'test-secret-not-used-in-production',
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: rateLimit,
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

async function setup(mailer: AccountMailer | null, rateLimit = false) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-account-email-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: config(rateLimit),
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({ SUNNY_DASHBOARD_URL: SITE }, 'test') },
    accountMailer: mailer,
  });
  await app.ready();
  return app;
}

function recording(fail?: Error) {
  const sent: LinkRequest[] = [];
  const mailer: AccountMailer = {
    send: (request) => {
      sent.push(request);
      return fail ? Promise.reject(fail) : Promise.resolve();
    },
  };
  return { sent, mailer };
}

describe('POST /v1/auth/email', () => {
  const reset = {
    kind: 'resetPassword',
    email: 'Jo@Example.com',
    continueUrl: `${SITE}/sign-in?reset=1`,
  };

  it('sends a reset to the address given', async () => {
    const { sent, mailer } = recording();
    const app = await setup(mailer);
    const res = await app.inject({ method: 'POST', url: '/v1/auth/email', payload: reset });
    expect(res.statusCode).toBe(204);
    expect(sent).toEqual([
      { kind: 'resetPassword', email: 'jo@example.com', continueUrl: reset.continueUrl },
    ]);
  });

  it('says not_enabled when this deployment does not send its own', async () => {
    const app = await setup(null);
    const res = await app.inject({ method: 'POST', url: '/v1/auth/email', payload: reset });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_enabled');
  });

  it('refuses a continue URL off the website', async () => {
    const { sent, mailer } = recording();
    const app = await setup(mailer);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/email',
      payload: { ...reset, continueUrl: 'https://evil.test/' },
    });
    expect(res.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('answers an unknown address like a known one', async () => {
    const { mailer } = recording(new AccountLinkError('EMAIL_NOT_FOUND'));
    const app = await setup(mailer);
    const res = await app.inject({ method: 'POST', url: '/v1/auth/email', payload: reset });
    expect(res.statusCode).toBe(204);
  });

  it('needs a signed-in account to send a verification email', async () => {
    const { sent, mailer } = recording();
    const app = await setup(mailer);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/email',
      payload: { kind: 'verifyEmail', continueUrl: `${SITE}/verify-email` },
    });
    expect(res.statusCode).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('limits emails to one address', async () => {
    const { sent, mailer } = recording();
    const app = await setup(mailer, true);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push(
        (await app.inject({ method: 'POST', url: '/v1/auth/email', payload: reset })).statusCode,
      );
    }
    expect(codes).toEqual([204, 204, 204, 204, 204, 429]);
    expect(sent).toHaveLength(5);
  });
});
