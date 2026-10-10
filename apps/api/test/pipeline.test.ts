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

/** A provider that replays a fixed script, including tool calls. */
class ScriptedProvider implements ChatProvider {
  readonly kind = 'scripted';
  readonly model = 'scripted-1';
  #script: (request: ChatTurnRequest) => ChatChunk[];
  #lastRequest: ChatTurnRequest | null = null;

  constructor(script: (request: ChatTurnRequest) => ChatChunk[]) {
    this.#script = script;
  }

  get lastRequest(): ChatTurnRequest | null {
    return this.#lastRequest;
  }

  async *stream(request: ChatTurnRequest): AsyncIterable<ChatChunk> {
    this.#lastRequest = request;
    for (const chunk of this.#script(request)) {
      if (chunk.type === 'tool_started') {
        yield chunk;
        // The real provider executes tools as it streams; the script must too,
        // or the test would not cover the tool layer at all.
        const declaration = request.tools.find((t) => t.name === chunk.call.name);
        if (declaration) {
          try {
            const result = await request.execute(chunk.call);
            yield { type: 'tool_finished', call: chunk.call, ok: true, result };
          } catch (error) {
            yield {
              type: 'tool_finished',
              call: chunk.call,
              ok: false,
              result: error instanceof Error ? error.message : String(error),
            };
          }
        }
      } else {
        yield chunk;
      }
    }
  }
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test',
    allowedOrigins: ['http://localhost:4173'],
    sessionSecret: 'test-secret-not-used-in-production',
    logLevel: 'silent',
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
    enabled?: boolean;
  }): ServerConfig {
    return makeConfig({
      rateLimit: {
        enabled: overrides.enabled ?? true,
        trustProxyHops: 0,
        rules: {
          session: { limit: overrides.session ?? 100_000, windowMs: 60_000 },
          chat: { limit: overrides.chat ?? 100_000, windowMs: 60_000 },
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
