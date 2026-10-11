import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry } from '../src/tenants.js';
import {
  UnconfiguredProvider,
  type ChatChunk,
  type ChatProvider,
  type ChatTurnRequest,
} from '../src/agent/provider.js';
import type { ServerConfig } from '../src/config.js';
import { ScriptedProvider } from './scripted-provider.js';
import type { FastifyInstance } from 'fastify';

/**
 * The vertical slice, end to end, inside one process.
 *
 * The model boundary is scripted and everything else is real: a real Fastify
 * server, the real session tokens, the real tool layer, the real store on disk,
 * the real SSE encoding. What that buys is a genuine test of the *seam* -- which
 * is where the bugs live -- without a network or a credential.
 *
 * It is not evidence that Gemini answers well, and it is not presented as such.
 * The live path is exercised by `scripts/smoke-api.mjs` with
 * `SMOKE_EXPECT_CHAT=1`, which needs a key and is recorded as unverified in
 * docs/STATUS.md until one is supplied.
 */

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test',
    allowedOrigins: ['http://localhost:4173'],
    sessionSecret: 'test-secret-not-used-in-production',
    // Set, so the catalogue-upload route is reachable: an unset token turns that
    // route into a refusal, which is a case of its own below.
    adminToken: 'test-admin-token',
    logLevel: 'silent',
    // No sandbox tenant: these suites build the registry they mean to test.
    sandboxTenant: false,
    // Long enough that the sweep the server starts on boot cannot reach a fixture.
    leadRetentionDays: 730,
    // Enabled but effectively unlimited, so every other test still runs the
    // limiter's real code path while only the tests that deliberately set a small
    // limit can trip it. Written out rather than left to `loadConfig`, so the
    // suite does not change behaviour because of an env var on the machine.
    rateLimit: {
      enabled: true,
      trustProxyHops: 0,
      rules: {
        session: { limit: 100_000, windowMs: 60_000 },
        chat: { limit: 100_000, windowMs: 60_000 },
        leads: { limit: 100_000, windowMs: 60_000 },
        qualification: { limit: 100_000, windowMs: 60_000 },
        catalogue: { limit: 100_000, windowMs: 60_000 },
        knowledge: { limit: 100_000, windowMs: 60_000 },
      },
      maxKeys: 10_000,
    },
    ...overrides,
  };
}

interface Harness {
  app: FastifyInstance;
  store: FileStore;
  dir: string;
}

async function harness(provider?: ChatProvider, config = makeConfig()): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
  const store = new FileStore(dir);
  const app = buildServer({
    config,
    store,
    tenants: new TenantRegistry(),
    ...(provider ? { provider } : {}),
    now: () => 1_700_000_000_000,
  });
  await app.ready();
  return { app, store, dir };
}

async function openSession(app: FastifyInstance): Promise<{ sessionId: string; token: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/widget/session',
    payload: { publicId: 'w_demo000001', origin: 'http://localhost:4173' },
  });
  const body = response.json<{ sessionId: string; sessionToken: string }>();
  return { sessionId: body.sessionId, token: body.sessionToken };
}

/**
 * Read the lead list the way the installer's dashboard will: with the
 * deployment's admin token and an explicit tenant id.
 *
 * `GET /v1/leads` is admin-only, on purpose -- a visitor token is refused with a
 * 401 and no body (D-35). Several tests below file a lead through the visitor
 * route and then check what was actually stored, and those checks have to use
 * the credential that can see the store rather than the one that wrote to it.
 */
async function leadsFiledFor(app: FastifyInstance, tenantId = 't_demo0001'): Promise<unknown[]> {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/leads?tenantId=${tenantId}`,
    headers: { authorization: 'Bearer test-admin-token' },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ leads: unknown[] }>().leads;
}

function parseSse(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n\n')
    .map((frame) => frame.split('\n').find((l) => l.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
});

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

// Wrap the helper so every harness's directory is cleaned up.
async function h(provider?: ChatProvider, config = makeConfig()): Promise<Harness> {
  const result = await harness(provider, config);
  dirs.push(result.dir);
  return result;
}

describe('the vertical slice', () => {
  it('serves a widget config that a page can render', async () => {
    const { app } = await h();
    const response = await app.inject({ method: 'GET', url: '/v1/widget/config/w_demo000001' });
    expect(response.statusCode).toBe(200);
    const config = response.json();
    expect(config.companyName).toBe('Northwind Solar');
    expect(config.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
    // The tenant's internal identity must not be discoverable from the page.
    expect(response.body).not.toContain('t_demo0001');
    expect(response.body).not.toContain('demo-solar');
  });

  it('streams a reply and persists both halves of the turn', async () => {
    const provider = new ScriptedProvider(() => [
      { type: 'text', text: 'On a south-facing roof like yours, ' },
      { type: 'text', text: 'most homes save £600–£900 a year.' },
      { type: 'usage', inputTokens: 120, outputTokens: 22 },
    ]);
    const { app } = await h(provider);
    const { sessionId, token } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'How much could I save?' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');

    const events = parseSse(response.body);
    expect(events.map((e) => e['type'])).toEqual([
      'message_started',
      'text_delta',
      'text_delta',
      'message_finished',
      'done',
    ]);
    const finished = events.find((e) => e['type'] === 'message_finished')!;
    expect(finished['text']).toBe(
      'On a south-facing roof like yours, most homes save £600–£900 a year.',
    );

    // The transcript is readable afterwards, and it is a complete turn.
    const conversation = await app.inject({
      method: 'GET',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    const turns = conversation.json().turns as Array<{ role: string; text: string }>;
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: 'user', text: 'How much could I save?' });
    expect(turns[1]!.text).toContain('£600–£900');
  });

  it('does not duplicate the transcript when a request is retried', async () => {
    const provider = new ScriptedProvider(() => [{ type: 'text', text: 'Hello.' }]);
    const { app } = await h(provider);
    const { sessionId, token } = await openSession(app);
    const payload = { sessionId, clientMessageId: 'same-id', text: 'Hello?' };

    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    const conversation = await app.inject({
      method: 'GET',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    // The user's message appears once. A duplicated question is the visible
    // symptom of a retry that was not treated as idempotent.
    const userTurns = (conversation.json().turns as Array<{ role: string }>).filter(
      (t) => t.role === 'user',
    );
    expect(userTurns).toHaveLength(1);
  });

  it('runs a tool, persists its answer, and forwards the page action to the widget', async () => {
    const provider = new ScriptedProvider(() => [
      {
        type: 'tool_started',
        call: { name: 'suggest_page_action', args: { action: 'highlight', target: 'pricing' } },
      },
      {
        type: 'tool_started',
        call: { name: 'save_answer', args: { questionId: 'motivation', value: 'reduce_bills' } },
      },
      {
        type: 'tool_started',
        call: {
          name: 'save_answer',
          args: { questionId: 'motivation', value: 'not-a-real-option' },
        },
      },
      { type: 'text', text: 'Here is the pricing section.' },
    ]);
    const { app } = await h(provider);
    const { sessionId, token } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'Where is the pricing?' },
    });

    const events = parseSse(response.body);
    const types = events.map((e) => e['type']);
    expect(types).toContain('tool_started');
    expect(types).toContain('tool_finished');

    const action = events.find((e) => e['type'] === 'page_action_suggested');
    expect(action).toMatchObject({ action: 'highlight', target: 'pricing' });

    // The invalid option must have been refused by the tool layer, not accepted
    // because the model asked for it.
    const finished = events.filter((e) => e['type'] === 'tool_finished');
    expect(finished.every((e) => e['ok'] === true)).toBe(true);

    // Only the valid answer is recorded.
    const conversation = await app.inject({
      method: 'GET',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    const assistant = (
      conversation.json().turns as Array<{ role: string; answers?: Record<string, string> }>
    ).find((t) => t.role === 'assistant');
    expect(assistant?.answers).toEqual({ motivation: 'reduce_bills' });
  });

  it('refuses a tool the deployment did not offer', async () => {
    // A model naming a tool it was never given must not reach an implementation.
    const provider = new ScriptedProvider(() => [
      { type: 'tool_started', call: { name: 'delete_everything', args: {} } },
      { type: 'text', text: 'Done.' },
    ]);
    const { app } = await h(provider);
    const { sessionId, token } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'hello' },
    });

    const events = parseSse(response.body);
    // The unknown tool produces no tool events at all: it was never executable.
    expect(events.some((e) => e['type'] === 'tool_started')).toBe(false);
    expect(events.some((e) => e['type'] === 'message_finished')).toBe(true);
  });

  it('needs consent before it will file a lead', async () => {
    const provider = new ScriptedProvider(() => [
      {
        type: 'tool_started',
        call: { name: 'create_lead', args: { name: 'Sam', email: 'sam@example.com' } },
      },
      {
        type: 'tool_started',
        call: {
          name: 'create_lead',
          args: { name: 'Sam', email: 'sam@example.com', consent: true },
        },
      },
      { type: 'text', text: 'Passed on.' },
    ]);
    const { app, store } = await h(provider);
    const { sessionId, token } = await openSession(app);

    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'call me' },
    });

    const leads = await store.listLeads('t_demo0001');
    // Two calls, one lead: the first had no consent and was refused.
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ tenantId: 't_demo0001', email: 'sam@example.com' });
  });

  it("scopes a tenant's leads to that tenant", async () => {
    const provider = new ScriptedProvider(() => [
      {
        type: 'tool_started',
        call: { name: 'create_lead', args: { consent: true, email: 'a@b.c' } },
      },
      { type: 'text', text: 'ok' },
    ]);
    const { app, store } = await h(provider);
    const { sessionId, token } = await openSession(app);

    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'hi' },
    });

    expect(await store.listLeads('some-other-tenant')).toHaveLength(0);
  });

  it('refuses to simulate an assistant it has no credentials for', async () => {
    const { app } = await h(new UnconfiguredProvider('no key'));
    const { sessionId, token } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'hello' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('not_enabled');
  });

  it('says so on /healthz when the assistant is unavailable', async () => {
    const { app } = await h();
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json().capabilities.chat.available).toBe(false);
    expect(health.json().capabilities.chat.reason).toContain('GEMINI_API_KEY');
  });

  it('tells an operator on /healthz what this deployment does with enquiries', async () => {
    const { app } = await h();
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    // The window and whether a sweep is enforcing it, served rather than only
    // logged: an installer asking "how long do you keep this" should not have to
    // read a boot log, and a window nothing carries out is a policy rather than a
    // practice.
    expect(health.json().capabilities.retention).toEqual({ windowDays: 730, sweeping: true });
  });

  it('refuses a session token that was not issued here', async () => {
    const { app } = await h();
    const { sessionId } = await openSession(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${sessionId}.deadbeef` },
      payload: { sessionId, clientMessageId: 'c1', text: 'hi' },
    });
    expect(response.statusCode).toBe(401);
  });

  it("will not let one session spend another session's token", async () => {
    const provider = new ScriptedProvider(() => [{ type: 'text', text: 'ok' }]);
    const { app } = await h(provider);
    const first = await openSession(app);
    const second = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${second.token}` },
      payload: { sessionId: first.sessionId, clientMessageId: 'c1', text: 'hi' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('only accepts a session from an allowed origin', async () => {
    const { app } = await h();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/widget/session',
      payload: { publicId: 'w_demo000001', origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('forbidden');
  });

  it('tells the model it may not invent a price', async () => {
    const provider = new ScriptedProvider(() => [{ type: 'text', text: 'ok' }]);
    const { app } = await h(provider);
    const { sessionId, token } = await openSession(app);

    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'how much?' },
    });

    const instruction = provider.lastRequest?.systemInstruction ?? '';
    expect(instruction).toContain('Never invent a price');
    expect(instruction).toContain('Never claim to be human');
    // And it is told, in the same breath, that no knowledge is connected.
    expect(instruction).toContain('no knowledge sources connected');
  });
});

/**
 * Rate limiting, exercised through the real routes.
 *
 * The unit tests in ratelimit.test.ts cover the counter; these cover the wiring,
 * which is where a limiter usually goes wrong -- applied to the wrong route,
 * applied after the expensive work, or silently returning 200 because the error
 * never reached the error handler.
 */
describe('rate limiting', () => {
  // Subclasses the scripted provider so the counting override is a plain method.
  // Written as an `async *` generator it would need an `await` to satisfy
  // `require-await`, which would mean inventing one purely to please the linter.
  class CountingProvider extends ScriptedProvider {
    calls = 0;

    constructor() {
      super(() => [{ type: 'text', text: 'hello' }]);
    }

    override stream(request: ChatTurnRequest): AsyncIterable<ChatChunk> {
      this.calls += 1;
      return super.stream(request);
    }
  }

  function limitedConfig(overrides: {
    session?: number;
    chat?: number;
    leads?: number;
    qualification?: number;
    enabled?: boolean;
  }): ServerConfig {
    return makeConfig({
      rateLimit: {
        enabled: overrides.enabled ?? true,
        trustProxyHops: 0,
        rules: {
          session: { limit: overrides.session ?? 100_000, windowMs: 60_000 },
          chat: { limit: overrides.chat ?? 100_000, windowMs: 60_000 },
          leads: { limit: overrides.leads ?? 100_000, windowMs: 60_000 },
          qualification: { limit: 100_000, windowMs: 60_000 },
          catalogue: { limit: 100_000, windowMs: 60_000 },
          knowledge: { limit: 100_000, windowMs: 60_000 },
        },
        maxKeys: 10_000,
      },
    });
  }

  it('refuses session creation past the limit, with a retry hint', async () => {
    const { app } = await h(undefined, limitedConfig({ session: 2 }));
    const open = () =>
      app.inject({
        method: 'POST',
        url: '/v1/widget/session',
        payload: { publicId: 'w_demo000001', origin: 'http://localhost:4173' },
      });

    expect((await open()).statusCode).toBe(200);
    expect((await open()).statusCode).toBe(200);

    const refused = await open();
    expect(refused.statusCode).toBe(429);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('rate_limited');
    // The header is asserted rather than assumed: it is set on the reply before
    // the error handler throws, and that it survives is exactly the kind of
    // framework detail worth pinning.
    expect(refused.headers['retry-after']).toBe('60');
  });

  it('stops calling the model once a session is over budget', async () => {
    const provider = new CountingProvider();
    const { app } = await h(provider, limitedConfig({ chat: 2 }));
    const { sessionId, token } = await openSession(app);

    const ask = (clientMessageId: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: { authorization: `Bearer ${token}` },
        payload: { sessionId, clientMessageId, text: 'hello' },
      });

    expect((await ask('c1')).statusCode).toBe(200);
    expect((await ask('c2')).statusCode).toBe(200);

    const refused = await ask('c3');
    expect(refused.statusCode).toBe(429);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('rate_limited');

    // The point of limiting this route at all: the third request must not have
    // cost a token. If the check sat after the provider call it would still have
    // returned 429 to the visitor while billing for the turn.
    expect(provider.calls).toBe(2);
  });

  it('gives each session its own chat budget', async () => {
    const { app } = await h(new CountingProvider(), limitedConfig({ chat: 1 }));
    const first = await openSession(app);
    const second = await openSession(app);

    const ask = (id: { sessionId: string; token: string }, clientMessageId: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: { authorization: `Bearer ${id.token}` },
        payload: { sessionId: id.sessionId, clientMessageId, text: 'hello' },
      });

    expect((await ask(first, 'c1')).statusCode).toBe(200);
    expect((await ask(first, 'c2')).statusCode).toBe(429);
    // One visitor exhausting their budget must not lock out another.
    expect((await ask(second, 'c1')).statusCode).toBe(200);
  });

  it('does not limit at all when the limiter is switched off', async () => {
    const provider = new CountingProvider();
    const { app } = await h(provider, limitedConfig({ chat: 1, enabled: false }));
    const { sessionId, token } = await openSession(app);

    for (const id of ['c1', 'c2', 'c3', 'c4']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/stream',
        headers: { authorization: `Bearer ${token}` },
        payload: { sessionId, clientMessageId: id, text: 'hello' },
      });
      expect(response.statusCode).toBe(200);
    }
    expect(provider.calls).toBe(4);
  });

  it('does not spend a session budget on a refused chat request', async () => {
    // A request that fails authorisation must not consume the budget of the
    // session it names, or an attacker could exhaust a victim's allowance by
    // replaying their session id without a token.
    const { app } = await h(new CountingProvider(), limitedConfig({ chat: 1 }));
    const { sessionId, token } = await openSession(app);

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      payload: { sessionId, clientMessageId: 'c0', text: 'hello' },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'hello' },
    });
    expect(allowed.statusCode).toBe(200);
  });
});

/**
 * Lead creation from a host page.
 *
 * The interesting properties are not "it saves a row". They are that a caller
 * cannot file a lead without consent, cannot file one for a tenant it does not
 * belong to, and cannot file one with no way to contact anybody -- each of which
 * turns a successful-looking 201 into a record the installer cannot lawfully
 * hold or act on.
 */
describe('POST /v1/leads', () => {
  it('saves a consented lead and returns its id', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, consent: true, name: 'Sam', email: 'sam@example.test' },
    });

    expect(response.statusCode).toBe(201);
    const { leadId } = response.json<{ leadId: string }>();
    expect(leadId).toMatch(/^lead_/);

    // Read back the way the installer does, not the way the visitor does. The
    // visitor's own token cannot read this list at all: it used to, and the list
    // it returned named every visitor who had ever enquired. See the note on the
    // route and the test below that pins the refusal.
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/leads?tenantId=t_demo0001',
      headers: { authorization: 'Bearer test-admin-token' },
    });
    expect(listed.statusCode).toBe(200);
    const { leads } = listed.json<{ leads: Array<{ id: string; email: string | null }> }>();
    expect(leads.map((l) => l.id)).toContain(leadId);
    expect(leads.find((l) => l.id === leadId)?.email).toBe('sam@example.test');
  });

  it('refuses the lead list to a visitor, and to an admin with no tenant', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    await app.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, consent: true, email: 'sam@example.test' },
    });

    // A visitor token is a credential for one conversation, and the enquiry list
    // carries other people's contact details. This is the assertion that would
    // have failed before the route was gated.
    const asVisitor = await app.inject({
      method: 'GET',
      url: '/v1/leads?tenantId=t_demo0001',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asVisitor.statusCode).toBe(401);
    expect(asVisitor.body).not.toContain('sam@example.test');

    // Anonymous is refused too, and the refusal is about the credential rather
    // than about the missing query: naming a tenant does not earn a read.
    const anonymous = await app.inject({ method: 'GET', url: '/v1/leads?tenantId=t_demo0001' });
    expect(anonymous.statusCode).toBe(401);

    // With the right credential the tenant is still required, and still checked:
    // an id that names no tenant is a 404 rather than an empty list, which would
    // read as "this installer has no enquiries".
    const noTenant = await app.inject({
      method: 'GET',
      url: '/v1/leads',
      headers: { authorization: 'Bearer test-admin-token' },
    });
    expect(noTenant.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'GET',
      url: '/v1/leads?tenantId=t_nosuchtenant',
      headers: { authorization: 'Bearer test-admin-token' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('refuses a lead with no consent', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    for (const payload of [
      { sessionId, email: 'sam@example.test' },
      { sessionId, consent: false, email: 'sam@example.test' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/leads',
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(response.statusCode).toBe(400);
    }

    // Nothing was written, which is the part that matters: a 400 that still
    // stored the row would be the worst of both.
    expect(await leadsFiledFor(app)).toHaveLength(0);
  });

  it('refuses a lead nobody can be contacted about', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, consent: true, name: 'Sam' },
    });
    expect(response.statusCode).toBe(400);
    expect(
      response.json<{ error: { details?: Record<string, string> } }>().error.details,
    ).toBeTruthy();
  });

  it('refuses a token for another session', async () => {
    const { app } = await h();
    const { token } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: 'sess_someoneelse', consent: true, email: 'sam@example.test' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses an unauthenticated submission', async () => {
    const { app } = await h();
    const { sessionId } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/leads',
      payload: { sessionId, consent: true, email: 'sam@example.test' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not let the caller choose the tenant', async () => {
    // The tenant comes from the verified token. A body field naming one must be
    // ignored, or a caller could file a lead against another installer.
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sessionId,
        consent: true,
        email: 'sam@example.test',
        tenantId: 't_someoneelse',
      },
    });
    expect(response.statusCode).toBe(201);

    // Visible to our own tenant, which it would not be if another id had won.
    expect(await leadsFiledFor(app)).toHaveLength(1);
  });

  it('stops a script filing leads in a loop', async () => {
    const config = makeConfig({
      rateLimit: {
        enabled: true,
        trustProxyHops: 0,
        rules: {
          session: { limit: 100_000, windowMs: 60_000 },
          chat: { limit: 100_000, windowMs: 60_000 },
          leads: { limit: 2, windowMs: 60_000 },
          qualification: { limit: 100_000, windowMs: 60_000 },
          catalogue: { limit: 100_000, windowMs: 60_000 },
          knowledge: { limit: 100_000, windowMs: 60_000 },
        },
        maxKeys: 10_000,
      },
    });
    const { app } = await h(undefined, config);
    const { sessionId, token } = await openSession(app);

    const submit = (n: number) =>
      app.inject({
        method: 'POST',
        url: '/v1/leads',
        headers: { authorization: `Bearer ${token}` },
        payload: { sessionId, consent: true, email: `sam${n}@example.test` },
      });

    expect((await submit(1)).statusCode).toBe(201);
    expect((await submit(2)).statusCode).toBe(201);
    expect((await submit(3)).statusCode).toBe(429);
  });

  it('answers a replayed submission with the lead it already has', async () => {
    // The double-click, over the real route: the same form submitted twice must
    // not become two enquiries for the installer to ring round.
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const submit = () =>
      app.inject({
        method: 'POST',
        url: '/v1/leads',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          sessionId,
          consent: true,
          email: 'sam@example.test',
          clientLeadId: 'form-2f1c9b',
        },
      });

    const first = await submit();
    expect(first.statusCode).toBe(201);
    const created = first.json<{ leadId: string; duplicate: boolean }>();
    expect(created.duplicate).toBe(false);

    const replayed = await submit();
    // 200 rather than 201: nothing was created, and the status is the cheapest
    // place to say so. The body repeats the first answer, so a caller that only
    // reads the body cannot tell a replay from the original -- which is the point
    // of the key -- while `duplicate` lets a page that wants to say "we already
    // have this" do so.
    expect(replayed.statusCode).toBe(200);
    const repeat = replayed.json<{ leadId: string; duplicate: boolean }>();
    expect(repeat.duplicate).toBe(true);
    expect(repeat.leadId).toBe(created.leadId);

    expect(await leadsFiledFor(app)).toHaveLength(1);
  });

  it('refuses a key that comes back with different details', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const submit = (phone: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/leads',
        headers: { authorization: `Bearer ${token}` },
        payload: { sessionId, consent: true, email: 'sam@example.test', phone, clientLeadId: 'k1' },
      });

    expect((await submit('07700 900111')).statusCode).toBe(201);
    const conflicted = await submit('07700 900222');
    expect(conflicted.statusCode).toBe(400);

    const leads = (await leadsFiledFor(app)) as Array<{ phone: string | null }>;
    // The first number stands. Succeeding here would have told the page the
    // second one had been sent when it had not.
    expect(leads).toHaveLength(1);
    expect(leads[0]?.phone).toBe('07700 900111');
  });
});

/**
 * Qualification answers submitted by the host page.
 *
 * The property under test is not "the answer is stored". It is that an answer
 * arrives without the API inventing dialogue: the standing map changes and the
 * transcript does not. A synthetic user turn would be indistinguishable from the
 * visitor having typed it, and the model reads the transcript as fact.
 */
describe('POST /v1/qualification/answer', () => {
  const submit = (
    app: Awaited<ReturnType<typeof h>>['app'],
    token: string,
    sessionId: string,
    questionId: string,
    value: string,
  ) =>
    app.inject({
      method: 'POST',
      url: '/v1/qualification/answer',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, questionId, value },
    });

  it('stores an answer and returns the standing map', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const response = await submit(app, token, sessionId, 'roof_direction', 'south');
    expect(response.statusCode).toBe(200);

    const body = response.json<{
      questionId: string;
      answers: Record<string, string>;
      nextQuestionId: string | null;
    }>();
    expect(body.questionId).toBe('roof_direction');
    expect(body.answers['roof_direction']).toBe('south');
    expect(body.nextQuestionId).toBe('address');
  });

  it('does not write the answer into the transcript', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    await submit(app, token, sessionId, 'property_type', 'detached');

    const conversation = await app.inject({
      method: 'GET',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    const turns = conversation.json<{ turns: Array<{ text: string }> }>().turns;
    // The whole point of D-11: nothing appears in the transcript, so nothing can
    // be mistaken for something the visitor said.
    expect(turns).toHaveLength(0);
  });

  it('merges rather than replaces, and advances the suggestion', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    await submit(app, token, sessionId, 'address', '1 Test Street');
    const second = await submit(app, token, sessionId, 'roof_direction', 'west');

    const body = second.json<{ answers: Record<string, string>; nextQuestionId: string | null }>();
    expect(body.answers['address']).toBe('1 Test Street');
    expect(body.answers['roof_direction']).toBe('west');
    // `address` is now answered, so the suggestion moves on rather than repeating.
    expect(body.nextQuestionId).toBe('roof_confidence');
  });

  it('rejects a value that is not one of the options, naming them', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const response = await submit(app, token, sessionId, 'roof_direction', 'sideways');
    expect(response.statusCode).toBe(400);

    const error = response.json<{ error: { code: string; message: string } }>().error;
    expect(error.code).toBe('bad_request');
    expect(error.message).toContain('south');
  });

  it('rejects a question that does not exist, naming the real ones', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const response = await submit(app, token, sessionId, 'roof_vibe', 'good');
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('roof_size');
  });

  it('suggests the follow-up the usage answer actually opened', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    // Answer the whole usage step up to and including the source, so the only
    // thing between this response and the end of the step is which follow-up
    // applies. `annual_kwh` belongs to a typed or uploaded bill; a monthly cost
    // is a different question, and the earlier build asked every visitor the kWh
    // one.
    for (const [questionId, value] of [
      ['address', '1 Test Street'],
      ['roof_confidence', 'high'],
      ['roof_size', 'medium'],
      ['roof_direction', 'south'],
      ['roof_shading', 'none'],
      ['property_type', 'detached'],
      ['ownership', 'own'],
    ] as const) {
      await submit(app, token, sessionId, questionId, value);
    }

    const response = await submit(app, token, sessionId, 'usage_source', 'monthly_cost');
    expect(response.statusCode).toBe(200);
    const body = response.json<{ nextQuestionId: string | null }>();
    expect(body.nextQuestionId).toBe('monthly_cost');
  });

  it('refuses an answer the visitor’s own earlier answer ruled out', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    await submit(app, token, sessionId, 'usage_source', 'household');

    const response = await submit(app, token, sessionId, 'annual_kwh', '4200');
    expect(response.statusCode).toBe(400);
    const message = response.json<{ error: { message: string } }>().error.message;
    // The page has to be able to act on this, so the message names the answer
    // that stands in the way and what it would have to be.
    expect(message).toContain('usage_source');
    expect(message).toContain('household');
  });

  it('accepts an answer given before the question it depends on', async () => {
    // A host page is free to ask in its own order, and the contracts say so. An
    // answer ahead of its gate contradicts nothing, so it is stored; only an
    // answer the visitor’s own earlier choice rules out is refused.
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const response = await submit(app, token, sessionId, 'annual_kwh', '4200');
    expect(response.statusCode).toBe(200);
    expect(response.json<{ answers: Record<string, string> }>().answers['annual_kwh']).toBe('4200');
  });

  it('refuses a figure that is not a number', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const response = await submit(app, token, sessionId, 'annual_kwh', 'quite a lot');
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { message: string } }>().error.message).toContain('kWh');
  });

  it('refuses a token for another session', async () => {
    const { app } = await h();
    const { token } = await openSession(app);

    const response = await submit(app, token, 'sess_someoneelse', 'address', '1 Test Street');
    expect(response.statusCode).toBe(403);
  });

  it('refuses an unauthenticated submission', async () => {
    const { app } = await h();
    const { sessionId } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/qualification/answer',
      payload: { sessionId, questionId: 'address', value: '1 Test Street' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts a free-text answer to a question that has no options', async () => {
    // `address` and `annual_kwh` are open questions. A validator that insisted on
    // a known option would reject the two answers the installer needs most.
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const response = await submit(app, token, sessionId, 'annual_kwh', '4200');
    expect(response.statusCode).toBe(200);
    expect(response.json<{ answers: Record<string, string> }>().answers['annual_kwh']).toBe('4200');
  });

  it('stops a script filling the store', async () => {
    const config = makeConfig({
      rateLimit: {
        enabled: true,
        trustProxyHops: 0,
        rules: {
          session: { limit: 100_000, windowMs: 60_000 },
          chat: { limit: 100_000, windowMs: 60_000 },
          leads: { limit: 100_000, windowMs: 60_000 },
          qualification: { limit: 2, windowMs: 60_000 },
          catalogue: { limit: 100_000, windowMs: 60_000 },
          knowledge: { limit: 100_000, windowMs: 60_000 },
        },
        maxKeys: 10_000,
      },
    });
    const { app } = await h(undefined, config);
    const { sessionId, token } = await openSession(app);

    expect((await submit(app, token, sessionId, 'annual_kwh', '1')).statusCode).toBe(200);
    expect((await submit(app, token, sessionId, 'annual_kwh', '2')).statusCode).toBe(200);
    expect((await submit(app, token, sessionId, 'annual_kwh', '3')).statusCode).toBe(429);
  });

  /**
   * Correcting an answer, which is the half a merge cannot do.
   *
   * The standing map only ever grew, so a visitor who changed a gate answer left
   * the answers that depended on it behind -- `{usage_source: 'household',
   * monthly_cost: '150'}`, a figure their own later answer had withdrawn, sitting
   * there indistinguishable from a live one and riding into the lead. These pin
   * that a correction takes the orphan with it, and says so.
   */
  describe('correcting an answer', () => {
    interface CorrectionBody {
      answers: Record<string, string>;
      removedAnswers: Array<{
        questionId: string;
        value: string;
        ruledOutBy: { questionId: string; value: string };
      }>;
    }

    it('takes away the answer the correction ruled out, and names it', async () => {
      const { app } = await h();
      const { sessionId, token } = await openSession(app);

      await submit(app, token, sessionId, 'usage_source', 'monthly_cost');
      await submit(app, token, sessionId, 'monthly_cost', '150');
      const corrected = await submit(app, token, sessionId, 'usage_source', 'household');

      expect(corrected.statusCode).toBe(200);
      const body = corrected.json<CorrectionBody>();
      expect(body.answers).toEqual({ usage_source: 'household' });
      expect(body.removedAnswers).toEqual([
        {
          questionId: 'monthly_cost',
          value: '150',
          ruledOutBy: { questionId: 'usage_source', value: 'household' },
        },
      ]);
    });

    it('has taken it out of the store, not just out of the response', async () => {
      const { app, store } = await h();
      const { sessionId, token } = await openSession(app);

      await submit(app, token, sessionId, 'usage_source', 'monthly_cost');
      await submit(app, token, sessionId, 'monthly_cost', '150');
      await submit(app, token, sessionId, 'usage_source', 'household');

      // Read the persisted conversation, not the route's own response: a response
      // that under-reports while the store keeps the orphan is exactly the failure
      // mode being guarded against, so the assertion cannot be made against the
      // response alone.
      const conversation = await store.getConversation('t_demo0001', sessionId);
      expect(conversation?.answers).toEqual({ usage_source: 'household' });
    });

    it('reports nothing removed when the correction orphaned nothing', async () => {
      const { app } = await h();
      const { sessionId, token } = await openSession(app);

      // `roof_direction` gates nothing and is not a gate, so changing it takes
      // nothing with it -- and the field is present as an empty array rather than
      // omitted, so a page can read it without a null check.
      await submit(app, token, sessionId, 'roof_direction', 'south');
      const corrected = await submit(app, token, sessionId, 'roof_direction', 'west');

      const body = corrected.json<CorrectionBody>();
      expect(body.answers['roof_direction']).toBe('west');
      expect(body.removedAnswers).toEqual([]);
    });

    it('keeps an answer that was given ahead of its gate, until the gate is answered against it', async () => {
      const { app } = await h();
      const { sessionId, token } = await openSession(app);

      // Answered in the page's own order: the kWh figure first. Pending, not
      // conflicting, so it stands -- and stays standing through an unrelated
      // write.
      await submit(app, token, sessionId, 'annual_kwh', '4200');
      const other = await submit(app, token, sessionId, 'roof_direction', 'west');
      expect(other.json<CorrectionBody>().answers['annual_kwh']).toBe('4200');

      // Then the gate is answered the other way, and the figure it settled
      // against goes.
      const gate = await submit(app, token, sessionId, 'usage_source', 'household');
      const body = gate.json<CorrectionBody>();
      expect(body.answers['annual_kwh']).toBeUndefined();
      expect(body.removedAnswers.map((entry) => entry.questionId)).toEqual(['annual_kwh']);
    });
  });
});

/**
 * A page-submitted answer has to reach the model, not just the store.
 *
 * Otherwise the assistant re-asks a question the visitor already answered on the
 * form, which is the specific failure the answers map exists to prevent.
 */
describe('qualification answers reach the conversation', () => {
  it('gives the tool context the answers submitted by the route', async () => {
    const captured: unknown[] = [];
    const provider = new ScriptedProvider((request) => {
      // Wrap `execute` so the tool result is inspectable. `save_answer` reports
      // how many answers the context already held, which is the only place that
      // number is visible from outside the turn.
      const original = request.execute;
      request.execute = async (call) => {
        const result = await original(call);
        captured.push(result);
        return result;
      };
      return [
        {
          type: 'tool_started',
          call: {
            id: 'call_1',
            name: 'save_answer',
            args: { questionId: 'annual_kwh', value: '4200' },
          },
        },
        { type: 'text', text: 'Noted.' },
      ];
    });

    const { app } = await h(provider);
    const { sessionId, token } = await openSession(app);

    // One answer via the route, the way a host-page form would submit it.
    await app.inject({
      method: 'POST',
      url: '/v1/qualification/answer',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, questionId: 'roof_direction', value: 'north' },
    });

    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'I use about 4200 kWh' },
    });

    // Two, not one: the context saw the route's answer as well as the turn's.
    expect(captured[0]).toMatchObject({ answered: 2 });
  });

  it('keeps both answers after the turn, and records only the turn on the turn', async () => {
    const provider = new ScriptedProvider(() => [
      {
        type: 'tool_started',
        call: {
          id: 'call_1',
          name: 'save_answer',
          args: { questionId: 'annual_kwh', value: '4200' },
        },
      },
      { type: 'text', text: 'Noted.' },
    ]);

    const { app } = await h(provider);
    const { sessionId, token } = await openSession(app);

    await app.inject({
      method: 'POST',
      url: '/v1/qualification/answer',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, questionId: 'roof_direction', value: 'north' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'I use about 4200 kWh' },
    });

    const conversation = await app.inject({
      method: 'GET',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    const turns = conversation.json<{
      turns: Array<{ role: string; answers?: Record<string, string> }>;
    }>().turns;
    const assistant = turns.find((t) => t.role === 'assistant');

    // The per-turn map is the audit trail: it says what *this* turn changed.
    expect(assistant?.answers).toEqual({ annual_kwh: '4200' });
  });

  it('records several answers from one turn, so the assistant need not ask twice', async () => {
    // §7.3: "conversational collection should extract multiple supplied answers
    // without asking twice". The mechanism is that a turn may call `save_answer`
    // more than once -- the provider executes each call as it streams -- and every
    // answer it sets lands in the store and on the turn's own map. What is *not*
    // proven here is the extraction itself: that a real model finds two answers in
    // one sentence is a model behaviour, and there is no credential in this
    // environment to observe it (blocker 1). This pins the plumbing it would land
    // on, so a credential is the only thing missing.
    const captured: unknown[] = [];
    const provider = new ScriptedProvider((request) => {
      const original = request.execute;
      request.execute = async (call) => {
        const result = await original(call);
        captured.push(result);
        return result;
      };
      return [
        {
          type: 'tool_started',
          call: {
            id: 'call_1',
            name: 'save_answer',
            args: { questionId: 'usage_source', value: 'manual_kwh' },
          },
        },
        {
          type: 'tool_started',
          call: {
            id: 'call_2',
            name: 'save_answer',
            args: { questionId: 'annual_kwh', value: '4200' },
          },
        },
        { type: 'text', text: 'Got both of those.' },
      ];
    });

    const { app, store } = await h(provider);
    const { sessionId, token } = await openSession(app);

    const turn = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'I enter kWh; about 4200 a year' },
    });

    // Both tools ran, and the second saw the first's answer -- it could not have
    // been accepted otherwise, `annual_kwh` being gated on the usage source.
    const finished = parseSse(turn.body).filter((frame) => frame['type'] === 'tool_finished');
    expect(finished.map((frame) => frame['tool'])).toEqual(['save_answer', 'save_answer']);
    expect(finished.every((frame) => frame['ok'] === true)).toBe(true);
    expect(captured.map((result) => (result as { note: string }).note)).toEqual([
      'Saved usage_source = manual_kwh.',
      'Saved annual_kwh = 4200.',
    ]);

    const conversation = await store.getConversation('t_demo0001', sessionId);
    expect(conversation?.answers).toEqual({ usage_source: 'manual_kwh', annual_kwh: '4200' });

    // And the turn's audit map carries both, not just the last one.
    const read = await app.inject({
      method: 'GET',
      url: '/v1/conversation',
      headers: { authorization: `Bearer ${token}` },
    });
    const assistant = read
      .json<{ turns: Array<{ role: string; answers?: Record<string, string> }> }>()
      .turns.find((entry) => entry.role === 'assistant');
    expect(assistant?.answers).toEqual({ usage_source: 'manual_kwh', annual_kwh: '4200' });
  });

  it('persists an answer a correction inside the turn took away', async () => {
    // A correction made in chat has to reach the store the same way one made by
    // the route does. The tool deletes the stranded answer from the context, so
    // the turn's "what changed" diff has to notice a key that vanished as well as
    // ones that appeared -- otherwise the store keeps an answer the visitor has
    // just withdrawn, and only the chat path does.
    const provider = new ScriptedProvider(() => [
      {
        type: 'tool_started',
        call: {
          id: 'call_1',
          name: 'save_answer',
          args: { questionId: 'usage_source', value: 'household' },
        },
      },
      { type: 'text', text: 'Changed that to a household estimate.' },
    ]);

    const { app, store } = await h(provider);
    const { sessionId, token } = await openSession(app);

    // Two answers the visitor gave earlier, through the route.
    for (const [questionId, value] of [
      ['usage_source', 'monthly_cost'],
      ['monthly_cost', '150'],
    ] as const) {
      await app.inject({
        method: 'POST',
        url: '/v1/qualification/answer',
        headers: { authorization: `Bearer ${token}` },
        payload: { sessionId, questionId, value },
      });
    }

    await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'Actually, just use household size' },
    });

    const conversation = await store.getConversation('t_demo0001', sessionId);
    expect(conversation?.answers).toEqual({ usage_source: 'household' });
  });
});

/**
 * The standing answer map, at the store rather than through a route.
 *
 * Tested directly because the property that matters is one a route test cannot
 * see: that a conversation's answers survive a restart. The store is an
 * append-only file, so "the answers are still there" means the last line written
 * for that session carried them -- a race or a partial write would show up here
 * and nowhere else.
 */
describe('store: mergeAnswers', () => {
  it('creates a conversation when the visitor answers before ever chatting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    const conversation = await store.mergeAnswers('t_demo0001', 'sess_a', {
      roof_direction: 'south',
    });
    // A form submission happens before any turn, so there is no conversation to
    // amend. Refusing to create one would silently drop the first few answers.
    expect(conversation.turns).toEqual([]);
    expect(conversation.answers).toEqual({ roof_direction: 'south' });
  });

  it('merges without blanking earlier answers, and survives a reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    await store.mergeAnswers('t_demo0001', 'sess_a', { address: '1 Test Street' });
    await store.mergeAnswers('t_demo0001', 'sess_a', { roof_direction: 'west' });

    // A fresh instance over the same directory: nothing is in memory.
    const reloaded = new FileStore(dir);
    const conversation = await reloaded.getConversation('t_demo0001', 'sess_a');
    expect(conversation?.answers).toEqual({
      address: '1 Test Street',
      roof_direction: 'west',
    });
  });

  it('does not lose turns when an answer is amended', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    await store.appendTurn('t_demo0001', 'sess_a', {
      role: 'user',
      text: 'hello',
      at: new Date().toISOString(),
      clientMessageId: 'c1',
    });
    await store.mergeAnswers('t_demo0001', 'sess_a', { address: '1 Test Street' });

    const reloaded = new FileStore(dir);
    const conversation = await reloaded.getConversation('t_demo0001', 'sess_a');
    // The conversation record is rewritten whole on each change, so a merge that
    // built a fresh object instead of spreading the existing one would drop the
    // transcript here -- the failure mode worth a test.
    expect(conversation?.turns).toHaveLength(1);
    expect(conversation?.answers).toEqual({ address: '1 Test Street' });
  });

  it('keeps tenants apart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    await store.mergeAnswers('t_demo0001', 'sess_a', { address: 'mine' });
    expect(await store.getConversation('t_other', 'sess_a')).toBeNull();
  });

  it('removes the answers a correction names, in the same write as the merge', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    await store.mergeAnswers('t_demo0001', 'sess_a', {
      usage_source: 'monthly_cost',
      monthly_cost: '150',
    });
    const conversation = await store.mergeAnswers(
      't_demo0001',
      'sess_a',
      { usage_source: 'household' },
      ['monthly_cost'],
    );

    expect(conversation.answers).toEqual({ usage_source: 'household' });
    // And on disk, not only in the returned object.
    const reloaded = new FileStore(dir);
    expect((await reloaded.getConversation('t_demo0001', 'sess_a'))?.answers).toEqual({
      usage_source: 'household',
    });
  });

  it('lets a removal win when a key is both set and removed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    // The route never does this -- the reconciler cannot name the answer just
    // given -- but a store whose result depends on the order of a spread is a
    // trap for the next caller, so the precedence is pinned rather than left to
    // whoever reads the implementation.
    const conversation = await store.mergeAnswers('t_demo0001', 'sess_a', { monthly_cost: '150' }, [
      'monthly_cost',
    ]);
    expect(conversation.answers).toEqual({});
  });

  it('removes nothing and creates the conversation when asked for an empty removal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    const conversation = await store.mergeAnswers('t_demo0001', 'sess_a', {}, []);
    expect(conversation.answers).toEqual({});
    expect(conversation.turns).toEqual([]);
  });
});

/**
 * Store: the lead idempotency key.
 *
 * The property is not "a lead is written". It is that a submission the caller
 * has already made cannot become two rows in the installer's list, while two
 * genuinely different submissions still can -- and that the difference is the
 * caller's key rather than anything the store infers from the content.
 */
describe('store: saveLead', () => {
  const lead = (over: Record<string, unknown> = {}) => ({
    id: `lead_${Math.random().toString(16).slice(2, 10)}`,
    tenantId: 't_demo0001',
    sessionId: 'sess_a',
    conversationId: null,
    name: 'Sam',
    email: 'sam@example.test',
    phone: null,
    postcode: null,
    summary: 'Enquiry from the website assistant',
    score: null,
    createdAt: new Date().toISOString(),
    ...over,
  });

  it('writes the first submission and replays the second', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    const first = await store.saveLead(lead({ clientLeadId: 'form-1' }));
    const second = await store.saveLead(lead({ clientLeadId: 'form-1' }));

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('replayed');
    // The row that stands is the first one, not the retry's copy: a replay must
    // not restamp the record with a new id or a new time.
    expect(second.lead.id).toBe(first.lead.id);
    expect(second.lead.createdAt).toBe(first.lead.createdAt);
    expect(await store.listLeads('t_demo0001')).toHaveLength(1);
  });

  it('writes both submissions when the caller sends two keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    const one = await store.saveLead(lead({ clientLeadId: 'form-1' }));
    const two = await store.saveLead(lead({ clientLeadId: 'form-2' }));

    // Two moments the visitor pressed submit are two enquiries, even with the
    // same details typed in -- which is exactly why nothing here compares fields
    // to decide whether two submissions are one.
    expect([one.outcome, two.outcome]).toEqual(['created', 'created']);
    expect(await store.listLeads('t_demo0001')).toHaveLength(2);
  });

  it('writes both submissions when the caller sends no key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    await store.saveLead(lead());
    await store.saveLead(lead());

    // The protection is opt-in, like `clientMessageId` on a turn, and for the
    // same reason: a caller that does not claim two requests are one has not
    // said anything the store may act on.
    expect(await store.listLeads('t_demo0001')).toHaveLength(2);
  });

  it('keeps one tenant’s keys from swallowing another’s submission', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    const mine = await store.saveLead(lead({ clientLeadId: 'form-1' }));
    const theirs = await store.saveLead(lead({ clientLeadId: 'form-1', tenantId: 't_other' }));

    // Two installers' pages minting the same key -- a naive counter, or a fixed
    // string in a template -- must not have one installer's visitor vanish
    // because the other's page used the same value.
    expect(theirs.outcome).toBe('created');
    expect(theirs.lead.id).not.toBe(mine.lead.id);
    expect(await store.listLeads('t_other')).toHaveLength(1);
  });

  it('refuses a replayed key that carries a different submission', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    await store.saveLead(lead({ clientLeadId: 'form-1', phone: null }));
    const changed = await store.saveLead(lead({ clientLeadId: 'form-1', phone: '07700 900123' }));

    // Reusing a key for different details is a bug in the caller, and the one
    // answer that is wrong is a silent success: the visitor's phone number would
    // be dropped and the page would say the enquiry had been sent. Reported
    // instead, with nothing written.
    expect(changed.outcome).toBe('conflict');
    expect(await store.listLeads('t_demo0001')).toHaveLength(1);
    expect((await store.listLeads('t_demo0001'))[0]?.phone).toBeNull();
  });

  it('recognises a replayed key after a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-'));
    const store = new FileStore(dir);

    const first = await store.saveLead(lead({ clientLeadId: 'form-1' }));
    // A fresh instance over the same directory: the key lives on the row, so the
    // dedupe survives the restart that loses the in-memory list.
    const reloaded = new FileStore(dir);
    const replayed = await reloaded.saveLead(lead({ clientLeadId: 'form-1' }));

    expect(replayed.outcome).toBe('replayed');
    expect(replayed.lead.id).toBe(first.lead.id);
    expect(await reloaded.listLeads('t_demo0001')).toHaveLength(1);
  });
});
