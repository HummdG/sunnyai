import {
  ApiError,
  badRequestFromZod,
  chatRequestSchema,
  leadRequestSchema,
  publicWidgetIdSchema,
  qualificationAnswerSchema,
  sessionRequestSchema,
  STATUS_FOR_CODE,
  type ChatStreamEvent,
  type QualificationAnswerResponse,
} from '@sunny/contracts';
import { Readable } from 'node:stream';

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { runTurn } from './agent/agent.js';
import { QUESTIONS, validateAnswer } from './agent/tools.js';
import {
  ProviderUnavailableError,
  UnconfiguredProvider,
  type ChatProvider,
} from './agent/provider.js';
import { capabilityReport, type ServerConfig } from './config.js';
import {
  clientAddress,
  createRateLimiter,
  type RateLimiter,
  type RateLimitRule,
} from './ratelimit.js';
import { issueSessionToken, SESSION_TTL_MS, verifySessionToken } from './sessions.js';
import { newId, type Store } from './store.js';
import type { TenantRegistry } from './tenants.js';

export interface ServerDeps {
  config: ServerConfig;
  store: Store;
  tenants: TenantRegistry;
  /** Defaults to the unconfigured provider when no key is set. */
  provider?: ChatProvider;
  /** Injected so tests can drive the clock and read bucket counts. */
  rateLimiter?: RateLimiter;
  now?: () => number;
}

const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Cloud Run buffers a proxied response unless it is told not to, which turns a
  // live stream into one delivery at the end.
  'x-accel-buffering': 'no',
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { config, store, tenants } = deps;
  const now = deps.now ?? (() => Date.now());
  const limiter = deps.rateLimiter ?? createRateLimiter({ now, maxKeys: config.rateLimit.maxKeys });

  /**
   * Count one request against `key` and refuse it once the budget is spent.
   *
   * Disabled by config rather than by omitting the call, so "is the limiter on?"
   * is one env var and not something a reader has to reconstruct from which
   * routes happen to call this.
   */
  function enforceRateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    subject: string,
    rule: RateLimitRule,
  ): void {
    if (!config.rateLimit.enabled) return;
    const decision = limiter.check(`${scope}:${subject}`, rule);
    if (decision.allowed) return;

    // Set before throwing: Fastify keeps headers already on the reply when the
    // error handler sends, and `Retry-After` is the part of a 429 a well-behaved
    // client actually acts on. A test asserts it survives, because "Fastify keeps
    // them" is an assumption worth pinning rather than trusting.
    reply.header('retry-after', String(decision.retryAfterSec));
    request.log.warn(
      { scope, limit: decision.limit, windowMs: rule.windowMs },
      'rate limit exceeded',
    );
    throw new ApiError('rate_limited', 'Too many requests. Please wait a moment and try again.');
  }
  const provider =
    deps.provider ??
    (config.gemini
      ? undefined
      : new UnconfiguredProvider('GEMINI_API_KEY is not set on this deployment'));

  // A lazy import so an unconfigured deployment never loads the SDK at all.
  let providerPromise: Promise<ChatProvider> | undefined;
  const getProvider = async (): Promise<ChatProvider> => {
    if (provider) return provider;
    providerPromise ??= import('./agent/provider.js').then(
      (m) => new m.GeminiProvider({ config: config.gemini! }),
    );
    return providerPromise;
  };

  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            // Never log a query string or a header wholesale: a widget session
            // token is a bearer credential and would end up in the log sink.
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
    disableRequestLogging: config.nodeEnv === 'test',
    requestIdHeader: 'x-request-id',
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    let apiError: ApiError;
    if (error instanceof ApiError) {
      apiError = error;
    } else if (isFastifyValidationError(error)) {
      // Fastify's own schema validation, which we do not use for bodies but is
      // still reachable for a malformed URL or content type.
      apiError = new ApiError('bad_request', error.message);
    } else {
      // Everything else is a bug. It is logged in full and reported as a bare
      // 500: an unexpected error's message can name an internal path, a
      // collection or a column, and none of that belongs in a visitor's browser.
      apiError = new ApiError('internal', 'Something went wrong.');
    }

    if (apiError.code === 'internal') {
      request.log.error({ err: error }, 'unhandled error');
    }
    reply.code(STATUS_FOR_CODE[apiError.code]).send(apiError.toBody(String(request.id)));
  });

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(
        new ApiError('not_found', `No route for ${request.method} ${request.url}`).toBody(
          String(request.id),
        ),
      );
  });

  // ─── CORS ──────────────────────────────────────────────────────────────────
  //
  // Written by hand rather than pulled from @fastify/cors so the wildcard case
  // is visible: an empty allow-list echoes any origin, which is a development
  // convenience only, and `assertProductionReady` refuses to boot in production
  // without an explicit list.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    const allowed =
      config.allowedOrigins.length === 0
        ? origin
        : config.allowedOrigins.includes(origin)
          ? origin
          : null;

    if (!allowed) {
      reply
        .code(403)
        .send(new ApiError('forbidden', 'Origin not allowed').toBody(String(request.id)));
      return;
    }
    reply
      .header('access-control-allow-origin', allowed)
      .header('vary', 'origin')
      .header('access-control-allow-methods', 'GET,POST,OPTIONS')
      .header('access-control-allow-headers', 'content-type,authorization,x-request-id')
      .header('access-control-max-age', '600');
  });

  app.options('/*', async (_request, reply) => reply.code(204).send());

  // ─── health ────────────────────────────────────────────────────────────────

  app.get('/healthz', async () => {
    const database = await store.health();
    const capabilities = capabilityReport(config);
    return {
      ok: database.ok,
      version: '0.1.0',
      capabilities,
      store: { kind: store.kind, ok: database.ok, detail: database.detail },
      checkedAt: new Date(now()).toISOString(),
    };
  });

  // ─── widget config and session ─────────────────────────────────────────────

  app.get('/v1/widget/config/:publicId', async (request, reply) => {
    const parsed = publicWidgetIdSchema.safeParse(
      (request.params as { publicId: string }).publicId,
    );
    if (!parsed.success) throw badRequestFromZod(parsed.error);

    const widgetConfig = tenants.configFor(parsed.data);
    if (!widgetConfig) throw new ApiError('not_found', 'Unknown widget.');

    // Config is public and cacheable, but briefly: an installer changing its
    // colour expects it live, not after a CDN's hour.
    reply.header('cache-control', 'public, max-age=60');
    return widgetConfig;
  });

  app.post('/v1/widget/session', async (request, reply) => {
    // Keyed by client address, before any other work: this route costs nothing to
    // call and is the cheapest way to fill the store, so it is the one an
    // unattended script finds first.
    enforceRateLimit(
      request,
      reply,
      'session',
      clientAddress({
        socketAddress: request.raw.socket.remoteAddress,
        forwardedFor: request.headers['x-forwarded-for'],
        trustedHops: config.rateLimit.trustProxyHops,
      }),
      config.rateLimit.rules.session,
    );

    const body = sessionRequestSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);

    const tenant = tenants.byPublicId(body.data.publicId);
    if (!tenant) throw new ApiError('not_found', 'Unknown widget.');

    const origin = body.data.origin;
    if (config.allowedOrigins.length > 0 && origin && !config.allowedOrigins.includes(origin)) {
      throw new ApiError('forbidden', 'This origin is not allowed to open a session.');
    }

    // A session token presented back to us resumes that session; otherwise this
    // is a fresh visitor.
    const resumedClaims = verifySessionToken(body.data.sessionToken, config.sessionSecret, now());
    const sessionId =
      resumedClaims && resumedClaims.tenantId === tenant.id
        ? resumedClaims.sessionId
        : newId('sess');

    const expiresAt = now() + SESSION_TTL_MS;
    const sessionToken = issueSessionToken(
      { sessionId, tenantId: tenant.id, expiresAt },
      config.sessionSecret,
    );

    const conversation = await store.getConversation(tenant.id, sessionId);

    return {
      sessionId,
      sessionToken,
      tenantId: tenant.id,
      expiresAt: new Date(expiresAt).toISOString(),
      resumed: conversation !== null && conversation.turns.length > 0,
      greeting: tenant.config.greeting,
      suggestions: tenant.config.suggestions,
    };
  });

  // ─── chat ──────────────────────────────────────────────────────────────────

  app.post('/v1/chat/stream', async (request, reply) => {
    const claims = verifySessionToken(bearer(request), config.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');

    const body = chatRequestSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);
    if (body.data.sessionId !== claims.sessionId) {
      throw new ApiError('forbidden', 'That session token is for a different session.');
    }

    // Keyed by session, not by address: the caller is authenticated by this
    // point, so the precise subject is known, and visitors behind one NAT do not
    // exhaust each other's budget. Session creation -- the way to get more
    // sessions -- is itself limited by address above. Applied before the provider
    // is even resolved, so a caller over budget cannot cost a token.
    enforceRateLimit(request, reply, 'chat', claims.sessionId, config.rateLimit.rules.chat);

    const tenant = tenants.all.find((t) => t.id === claims.tenantId);
    if (!tenant) throw new ApiError('not_found', 'Unknown tenant for this session.');

    const chat = await getProvider();
    if (chat.kind === 'unconfigured') {
      // Refuse rather than simulate. The plan's rule, and the right one: a
      // visitor told the assistant is unavailable is honestly served, and an
      // operator sees the gap immediately.
      throw new ApiError(
        'not_enabled',
        'The assistant is not configured on this deployment (GEMINI_API_KEY is unset).',
      );
    }

    const existing = await store.getConversation(tenant.id, claims.sessionId);
    const history = existing?.turns ?? [];

    // The response is handed back to Fastify as a stream rather than written to
    // the raw socket. Fastify then owns the headers and the flush, which is what
    // keeps `inject` working in tests and what keeps the SSE headers from being
    // written twice.
    const abort = new AbortController();
    let finished = false;
    // A visitor closing the tab must stop the model, not just stop listening:
    // an abandoned stream keeps costing tokens and holds a Cloud Run request
    // open to its timeout. Listening on the *response* close rather than the
    // request is what distinguishes "they walked away" from "we are done".
    reply.raw.on('close', () => {
      if (!finished) abort.abort();
    });

    // Snapshotted before the generator. TypeScript's narrowing does not survive
    // into a closure that outlives the guards above, and re-narrowing inside
    // would be a claim about ordering that the code does not actually make.
    const tenantSnapshot = tenant;
    const sessionIdSnapshot = claims.sessionId;
    const sunscanConnected = tenant.sunscanUrl !== null;
    const userText = body.data.text;
    const clientMessageId = body.data.clientMessageId;

    async function* frames(): AsyncGenerator<string> {
      const frame = (event: ChatStreamEvent): string => `data: ${JSON.stringify(event)}\n\n`;
      try {
        for await (const event of runTurn({
          tenant: tenantSnapshot,
          provider: chat,
          store,
          sessionId: sessionIdSnapshot,
          conversationId: existing?.id ?? null,
          history,
          ...(existing?.answers ? { standingAnswers: existing.answers } : {}),
          message: userText,
          clientMessageId,
          sunscanConnected,
          signal: abort.signal,
        })) {
          if (abort.signal.aborted) break;
          yield frame(event as ChatStreamEvent);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The assistant failed.';
        const code = error instanceof ProviderUnavailableError ? 'not_enabled' : 'upstream_failed';
        request.log.error({ err: error }, 'chat turn failed');
        yield frame({ type: 'error', messageId: newId('msg'), code, message });
      } finally {
        finished = true;
        yield frame({ type: 'done', messageId: 'done' });
      }
    }

    return reply.headers(SSE_HEADERS).send(Readable.from(frames()));
  });

  // ─── conversation ──────────────────────────────────────────────────────────

  app.get('/v1/conversation', async (request) => {
    const claims = verifySessionToken(bearer(request), config.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');
    const conversation = await store.getConversation(claims.tenantId, claims.sessionId);
    return {
      conversationId: conversation?.id ?? null,
      turns: conversation?.turns ?? [],
    };
  });

  // ─── qualification ─────────────────────────────────────────────────────────

  /**
   * One answer, submitted by the host page rather than spoken in the chat.
   *
   * The answer goes onto the conversation's standing map and **not** into the
   * transcript as a fabricated user turn. Appending "Roof direction: south" as if
   * the visitor had typed it would put words in their mouth, and the model — which
   * reads the transcript as the conversation so far — would believe them. See
   * `docs/DECISIONS.md`, D-11.
   */
  app.post('/v1/qualification/answer', async (request, reply) => {
    const claims = verifySessionToken(bearer(request), config.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');

    // Keyed by address, like session creation: an unauthenticated-looking write
    // that grows a stored record, so a loop is a way to fill the store.
    enforceRateLimit(
      request,
      reply,
      'qualification',
      clientAddress({
        socketAddress: request.raw.socket.remoteAddress,
        forwardedFor: request.headers['x-forwarded-for'],
        trustedHops: config.rateLimit.trustProxyHops,
      }),
      config.rateLimit.rules.qualification,
    );

    const body = qualificationAnswerSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);
    if (body.data.sessionId !== claims.sessionId) {
      throw new ApiError('forbidden', 'That session token is for a different session.');
    }

    const verdict = validateAnswer(body.data.questionId, body.data.value);
    if (!verdict.ok) {
      // `bad_request` rather than a silent 200: a page that believes it recorded
      // an answer it did not will show the visitor a completed form and a gap the
      // installer never sees. The message carries the vocabulary to use instead.
      const detail = verdict.allowed
        ? `${verdict.error}: ${verdict.allowed.join(', ')}`
        : verdict.known
          ? `${verdict.error}: ${verdict.known.join(', ')}`
          : verdict.error;
      throw new ApiError('bad_request', detail);
    }

    const tenant = tenants.all.find((t) => t.id === claims.tenantId);
    if (!tenant) throw new ApiError('not_found', 'Unknown tenant for this session.');

    const conversation = await store.mergeAnswers(claims.tenantId, claims.sessionId, {
      [verdict.questionId]: verdict.value,
    });

    const answers = conversation.answers ?? {};
    const answered = new Set(Object.keys(answers));

    // Derived from the question set itself, in its declared order, so this cannot
    // drift from the journey the assistant asks. A suggestion for the page's next
    // step rather than a rule it must follow; `null` once nothing is outstanding.
    const payload: QualificationAnswerResponse = {
      questionId: verdict.questionId,
      answers,
      nextQuestionId: Object.keys(QUESTIONS).find((id) => !answered.has(id)) ?? null,
    };

    reply.code(200);
    return payload;
  });

  // ─── leads ─────────────────────────────────────────────────────────────────

  /**
   * Lead creation from a host page, as opposed to `create_lead` inside a turn.
   *
   * The consent rule is the same one the tool enforces, and for the same reason:
   * it is the visitor's agreement that makes holding the record legitimate, so it
   * is checked here rather than assumed from the shape of a form.
   */
  app.post('/v1/leads', async (request, reply) => {
    const claims = verifySessionToken(bearer(request), config.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');

    // Limited per address like session creation: this is an unauthenticated-looking
    // endpoint (the token is anonymous) that writes durable rows, which is exactly
    // what a spam script looks for.
    enforceRateLimit(
      request,
      reply,
      'leads',
      clientAddress({
        socketAddress: request.raw.socket.remoteAddress,
        forwardedFor: request.headers['x-forwarded-for'],
        trustedHops: config.rateLimit.trustProxyHops,
      }),
      config.rateLimit.rules.leads,
    );

    const body = leadRequestSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);
    if (body.data.sessionId !== claims.sessionId) {
      throw new ApiError('forbidden', 'That session token is for a different session.');
    }

    const tenant = tenants.all.find((t) => t.id === claims.tenantId);
    if (!tenant) throw new ApiError('not_found', 'Unknown tenant for this session.');

    const existing = await store.getConversation(claims.tenantId, claims.sessionId);
    const lead = await store.saveLead({
      id: newId('lead'),
      // From the verified token, never from the request body: a caller who could
      // name the tenant could file a lead against another installer.
      tenantId: claims.tenantId,
      sessionId: claims.sessionId,
      conversationId: existing?.id ?? null,
      name: body.data.name ?? null,
      email: body.data.email ?? null,
      phone: body.data.phone ?? null,
      postcode: body.data.postcode ?? null,
      summary: body.data.summary ?? 'Enquiry from the website assistant',
      // No score. Producing one would mean inventing a qualification model, and a
      // number the installer cannot interpret is worse than a blank.
      score: null,
      createdAt: new Date(now()).toISOString(),
    });

    reply.code(201);
    return { leadId: lead.id, createdAt: lead.createdAt };
  });

  app.get('/v1/leads', async (request) => {
    const claims = verifySessionToken(bearer(request), config.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');
    return { leads: await store.listLeads(claims.tenantId) };
  });

  return app;
}

/** Fastify attaches `validation` to the errors its own schema checks raise. */
function isFastifyValidationError(
  error: unknown,
): error is { message: string; validation: unknown } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    (error as { validation?: unknown }).validation !== undefined
  );
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : undefined;
}
