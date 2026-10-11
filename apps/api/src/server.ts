import {
  ApiError,
  badRequestFromZod,
  catalogueUploadRequestSchema,
  chatRequestSchema,
  leadRequestSchema,
  publicWidgetIdSchema,
  qualificationAnswerSchema,
  recommendationRequestSchema,
  sessionRequestSchema,
  knowledgeSourceRequestSchema,
  STATUS_FOR_CODE,
  type AuditAction,
  type AuditEventsResponse,
  type AuditOutcome,
  type AuditReason,
  type AuditTarget,
  type CatalogueIssue,
  type CatalogueResponse,
  type CatalogueUploadResponse,
  type ChatStreamEvent,
  type IngestionJob,
  type KnowledgeIssue,
  type KnowledgeJobResponse,
  type KnowledgeSourceResponse,
  type QualificationAnswerResponse,
} from '@sunny/contracts';
import { chunkWithReport } from '@sunny/knowledge';
import { importProducts, importRecords, mergeWant, parseCsv, recommend } from '@sunny/solar-rules';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { runTurn } from './agent/agent.js';
import {
  ProviderUnavailableError,
  UnconfiguredProvider,
  type ChatProvider,
} from './agent/provider.js';
import { createAuditor, type Auditor } from './audit.js';
import { capabilityReport, type ServerConfig } from './config.js';
import { createKnowledgeLoader } from './knowledge.js';
import {
  clientAddress,
  createRateLimiter,
  type RateLimiter,
  type RateLimitRule,
} from './ratelimit.js';
import { explain, nextQuestion, reconcile, validateAnswer } from './questionnaire.js';
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

  // Built once per server, so the chunk cache survives across requests and a
  // turn does not re-split a two-megabyte document every time it looks something
  // up. It holds no state that can go stale: the loader keys its cache on the
  // sources' own `updatedAt`, so an edit or a delete is visible on the next turn
  // with nothing to invalidate by hand.
  const loadKnowledgeIndex = createKnowledgeLoader(store);

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

  // ─── the audit trail ───────────────────────────────────────────────────────
  //
  // Privileged acts are recorded as they happen, in `store.appendAuditEvent`,
  // with the shape and the reasoning in `packages/contracts/src/audit.ts`. What
  // lives here is the plumbing that makes a call site one line.
  //
  // Note what is *not* recorded: a `not_enabled` refusal. On a deployment with no
  // `SUNNY_ADMIN_TOKEN` these routes do not exist, so there is no privileged act
  // to have been refused, and turning every probe of a disabled feature into a row
  // would fill the trail with the one thing in it that means nothing.

  const auditor = createAuditor({
    store,
    now,
    // Loud, and not fatal. The act has already happened by the time most of
    // these are written, so refusing the request would be a lie in the other
    // direction -- but a log that stops being written in silence is worse than
    // no log at all, which is why this is an error line and not a debug one.
    onFailure: (error) => app.log.error({ err: error }, 'audit event could not be stored'),
  });

  /**
   * The auditor as one request sees it: the same store and clock, with the
   * request id bound in, so no call site has to remember to carry it.
   */
  function auditFor(request: FastifyRequest): Auditor {
    return {
      record: (entry) => auditor.record({ ...entry, requestId: String(request.id) }),
    };
  }

  /**
   * One line per event at the call site.
   *
   * `actor` is stated once here rather than at thirteen sites, and it is `admin`
   * for every route that uses this: the credential these routes are behind is the
   * deployment's admin token. The assistant's own tool calls go through
   * `auditFor` directly, because their actor is `system` and their tenant and
   * session come from the conversation rather than from a query string.
   */
  function auditChannel(
    request: FastifyRequest,
    action: AuditAction,
    target: AuditTarget,
  ): (
    outcome: AuditOutcome,
    extra?: {
      tenantId?: string | null;
      reason?: AuditReason;
      sessionId?: string | null;
      /**
       * For the one act whose target id is not known until after the work: a
       * named source or job that had to be looked up before it could be recorded.
       */
      target?: AuditTarget;
      detail?: Record<string, number | boolean>;
    },
  ) => Promise<void> {
    const audit = auditFor(request);
    return (outcome, extra = {}) =>
      audit.record({
        tenantId: extra.tenantId ?? null,
        actor: 'admin',
        action,
        target: extra.target ?? target,
        outcome,
        ...(extra.reason ? { reason: extra.reason } : {}),
        sessionId: extra.sessionId ?? null,
        ...(extra.detail ? { detail: extra.detail } : {}),
      });
  }

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
      // No `tenantId`: see the note on `widgetSessionSchema`. The token above
      // carries the tenant in its signature, which is where it belongs.
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
    // The assistant's effectful tool calls are audited, the same as any other
    // privileged act: `create_lead` and `request_callback` file a record, and
    // "which conversation was the callback promised in" is a question the trail
    // should be able to answer. Reads are not -- see `EFFECTFUL_TOOL_NAMES`.
    const audit = auditFor(request);

    async function* frames(): AsyncGenerator<string> {
      const frame = (event: ChatStreamEvent): string => `data: ${JSON.stringify(event)}\n\n`;
      try {
        // Loaded inside the stream rather than before it, so a store that cannot
        // be read produces the same `error` frame as any other turn failure
        // instead of a bare 500 the widget's transport has no case for.
        const knowledge = await loadKnowledgeIndex(tenantSnapshot.id);
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
          knowledge,
          audit,
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

    const tenant = tenants.all.find((t) => t.id === claims.tenantId);
    if (!tenant) throw new ApiError('not_found', 'Unknown tenant for this session.');

    // The answers standing before this one, so the verdict can see them. Read
    // before the merge, because the question is whether this answer is acceptable
    // *given* what the visitor has already said -- not given itself.
    const before = (await store.getConversation(claims.tenantId, claims.sessionId))?.answers ?? {};

    const verdict = validateAnswer(body.data.questionId, body.data.value, before);
    if (!verdict.ok) {
      // `bad_request` rather than a silent 200: a page that believes it recorded
      // an answer it did not will show the visitor a completed form and a gap the
      // installer never sees. The message carries the vocabulary to use instead --
      // and it is the same sentence the model is given when `save_answer` refuses,
      // so a host page and the assistant do not describe one refusal two ways.
      throw new ApiError('bad_request', explain(verdict));
    }

    const reconciled = reconcile({ ...before, [verdict.questionId]: verdict.value });
    const conversation = await store.mergeAnswers(
      claims.tenantId,
      claims.sessionId,
      { [verdict.questionId]: verdict.value },
      reconciled.dropped.map((entry) => entry.questionId),
    );

    const answers = conversation.answers ?? {};

    // Derived from the question set itself, in its declared order, and skipping
    // questions this visitor's answers have ruled out -- so a page following the
    // suggestion is never sent to ask for a kWh figure from someone who just said
    // they would give a monthly cost. A suggestion for the page's next step rather
    // than a rule it must follow; `null` once nothing applies and is unanswered.
    const payload: QualificationAnswerResponse = {
      questionId: verdict.questionId,
      answers,
      nextQuestionId: nextQuestion(answers),
      // A correction is the one write that can take an answer away, so it is the
      // one that has anything to report here. Every other response carries [].
      removedAnswers: reconciled.dropped.map(({ questionId, value, ruledOutBy }) => ({
        questionId,
        value,
        ruledOutBy: { questionId: ruledOutBy.questionId, value: ruledOutBy.value },
      })),
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
    const result = await store.saveLead({
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
      clientLeadId: body.data.clientLeadId,
    });

    if (result.outcome === 'conflict') {
      // The key names a submission we already hold, but the details differ, so
      // this is the page reusing a key rather than retrying one submission. The
      // alternative -- writing a second row, or silently answering with the
      // first -- either duplicates the enquiry or loses the visitor's correction
      // while telling them it was sent.
      throw new ApiError(
        'bad_request',
        'That clientLeadId was already used for a different submission. Use a new one.',
        { clientLeadId: 'already used with different details' },
      );
    }

    // 200 on a replay rather than 201: nothing was created, and the status is the
    // cheapest place to say so. The body repeats the first answer -- same
    // `leadId`, same `createdAt` -- so a caller that reads only the body cannot
    // tell the two apart, which is what makes a blind retry safe.
    reply.code(result.outcome === 'created' ? 201 : 200);
    return {
      leadId: result.lead.id,
      createdAt: result.lead.createdAt,
      duplicate: result.outcome === 'replayed',
    };
  });

  /**
   * The installer's own list of enquiries.
   *
   * This used to take a **visitor** session token and return the whole tenant's
   * leads, which meant any browser that opened a widget session on an installer's
   * site could read every other visitor's name, email and phone number. The token
   * was scoped to the tenant, so it kept two installers apart and no test
   * complained -- the exposure was strictly *within* one installer, which is the
   * direction a cross-tenant suite cannot see.
   *
   * So the credential is the installer's, not the visitor's, and the tenant is a
   * caller's choice exactly as it is on `GET /v1/knowledge/jobs/:id`: one
   * deployment-wide admin token means the caller names the tenant rather than
   * being pinned to one. That is blocker 4 (dashboard authentication) and it is
   * recorded rather than papered over -- what has changed here is that the wrong
   * kind of caller can no longer read the data at all.
   *
   * A visitor does not need this read: `POST /v1/leads` hands back the `leadId`
   * of the enquiry it just filed, which is the whole of what a host page's form
   * needs to know.
   */
  app.get('/v1/leads', async (request) => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'The lead list is disabled on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    const audit = auditChannel(request, 'leads.read', { kind: 'lead_list', id: null });
    if (!tokensMatch(bearer(request), config.adminToken)) {
      await audit('denied', { reason: 'bad_credential' });
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }

    const { tenantId } = request.query as { tenantId?: string };
    if (!tenantId) throw new ApiError('bad_request', 'A tenantId is required.');
    if (!tenants.all.some((tenant) => tenant.id === tenantId)) {
      await audit('failed', { reason: 'unknown_tenant' });
      throw new ApiError('not_found', 'Unknown tenant.');
    }

    const leads = await store.listLeads(tenantId);
    // The count and not the enquiries. A row of names and numbers in the audit
    // trail would be a second place every visitor's details live, which is the
    // one thing this record exists not to be -- and "twelve were read out" is the
    // fact a review wants anyway.
    await audit('permitted', { tenantId, detail: { leads: leads.length } });
    return { leads };
  });

  // ─── catalogue ─────────────────────────────────────────────────────────────
  //
  // Two routes with two different credentials, and the difference is the point.
  // Reading the catalogue is a visitor-facing act: the session token names the
  // tenant, exactly as it does for a lead. Writing it is an installer-facing act
  // — it is their commercial data, and the only route in this API that changes
  // what every future visitor is shown — so it needs an admin token, and the
  // tenant comes from the body because the caller is the installer rather than a
  // visitor who must not be able to name one.

  app.get('/v1/catalog/products', async (request) => {
    const claims = verifySessionToken(bearer(request), config.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');

    // The tenant id comes out of every row before the response is built. The
    // token already says which tenant this is, so the field carried nothing the
    // reader could use -- and it is the key every catalogue row is stored under,
    // which is not a thing to hand to an unauthenticated browser. See
    // `publicProductSchema`; `scripts/verify-isolation.ts` checks for it in this
    // response on a running deployment.
    const products = (await store.listProducts(claims.tenantId)).map(
      ({ tenantId: _tenantId, ...product }) => product,
    );
    const payload: CatalogueResponse = {
      products,
      currencies: [
        ...new Set(
          products
            .map((product) => product.currency)
            .filter((currency): currency is string => currency !== null),
        ),
      ],
      categories: [...new Set(products.map((product) => product.category))],
    };
    return payload;
  });

  app.post('/v1/catalog/products', { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'Catalogue uploads are disabled on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    const audit = auditChannel(request, 'catalogue.upload', { kind: 'catalogue', id: null });
    if (!tokensMatch(bearer(request), config.adminToken)) {
      await audit('denied', { reason: 'bad_credential' });
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }
    enforceRateLimit(
      request,
      reply,
      'catalogue',
      clientAddress({
        socketAddress: request.raw.socket.remoteAddress,
        forwardedFor: request.headers['x-forwarded-for'],
        trustedHops: config.rateLimit.trustProxyHops,
      }),
      config.rateLimit.rules.catalogue,
    );

    const body = catalogueUploadRequestSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);

    const tenant = tenants.all.find((t) => t.id === body.data.tenantId);
    if (!tenant) {
      await audit('failed', { reason: 'unknown_tenant' });
      throw new ApiError('not_found', 'Unknown tenant.');
    }

    // An append has to know what it is appending to, both to detect a duplicate
    // the tenant already holds and to report the size afterwards.
    const existing = body.data.mode === 'append' ? await store.listProducts(tenant.id) : [];

    const options = {
      tenantId: tenant.id,
      now: new Date(now()).toISOString(),
      nextId: () => newId('prd'),
      existing,
    };
    let imported: ReturnType<typeof importProducts>;
    let structural: CatalogueIssue[];
    let totalRows: number;
    if (body.data.csv !== undefined) {
      const parsed = parseCsv(body.data.csv);
      imported = importProducts(parsed.rows, options);
      // A parse-level failure is not a bad row, it is an untrustworthy file: an
      // unterminated quote means the rest of the file is inside one cell, and a
      // truncated download is the likeliest way to get one. Importing the rows
      // that happened to survive would store half a price list.
      structural = parsed.issues;
      totalRows = parsed.rows.length;
    } else {
      imported = importRecords(body.data.records ?? [], options);
      structural = [];
      totalRows = body.data.records?.length ?? 0;
    }

    const issues = [...structural, ...imported.issues];
    const failed = structural.some((issue) => issue.severity === 'error');
    const accepted = failed ? 0 : imported.products.length;

    let catalogueSize: number;
    if (body.data.dryRun || failed) {
      catalogueSize = existing.length + accepted;
    } else {
      const saved = await store.saveProducts(tenant.id, imported.products, body.data.mode);
      catalogueSize = saved.length;
    }

    // What the price list was before and after, in counts and flags -- never a
    // row. `accepted` is what was stored, `rejected` what was not, and `replaced`
    // says which of the two ways the catalogue changed, all three of which a
    // reviewer needs to reconstruct the act without reading the catalogue itself.
    const detail = {
      accepted,
      rejected: Math.max(0, totalRows - accepted),
      catalogueSize,
      replaced: body.data.mode === 'replace',
      dryRun: body.data.dryRun,
    };
    if (failed) {
      // The file was untrustworthy and nothing was stored. Recorded as `failed`
      // rather than omitted: an installer whose upload silently did nothing is
      // exactly the support call this trail should be able to answer.
      await audit('failed', { tenantId: tenant.id, reason: 'invalid_request', detail });
    } else {
      await audit('permitted', { tenantId: tenant.id, detail });
    }

    // The report is the answer, so every outcome here is a 200 with a body an
    // installer can read: a file that imported 98 of 100 rows is not an HTTP
    // error, it is a file with two problems in it, and the two are told apart by
    // `severity` rather than by a status code. `dryRun` is the one that is
    // genuinely a different outcome, and it says so in the body.
    const payload: CatalogueUploadResponse = {
      accepted,
      rejected: Math.max(0, totalRows - accepted),
      products: failed ? [] : imported.products,
      issues,
      catalogueSize,
      mode: body.data.mode,
      dryRun: body.data.dryRun,
    };
    reply.code(body.data.dryRun || failed ? 200 : 201);
    return payload;
  });

  // ─── knowledge ─────────────────────────────────────────────────────────────

  /**
   * Onboard one of the installer's own documents.
   *
   * An installer's document is their commercial and legal copy -- warranty terms
   * they are bound by, areas they will not travel to -- so this is the same kind
   * of route as the catalogue upload: behind the admin token, addressed by the
   * tenant the caller names, and refusing entirely rather than half-working when
   * no token is configured.
   *
   * A document that produces no passages is **not stored**. Storing it would
   * leave a source the assistant believes it has and can never quote from, which
   * is worse than refusing: the installer would see their document listed and
   * conclude the assistant knows it. The job says `failed` and carries the
   * reason, and the response's `source` is null so there is nothing to mistake.
   */
  app.post('/v1/knowledge/sources', { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'Knowledge ingestion is disabled on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    const audit = auditChannel(request, 'knowledge.source.write', {
      kind: 'knowledge_source',
      id: null,
    });
    if (!tokensMatch(bearer(request), config.adminToken)) {
      await audit('denied', { reason: 'bad_credential' });
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }
    enforceRateLimit(
      request,
      reply,
      'knowledge',
      clientAddress({
        socketAddress: request.raw.socket.remoteAddress,
        forwardedFor: request.headers['x-forwarded-for'],
        trustedHops: config.rateLimit.trustProxyHops,
      }),
      config.rateLimit.rules.knowledge,
    );

    const body = knowledgeSourceRequestSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);

    const tenant = tenants.all.find((t) => t.id === body.data.tenantId);
    if (!tenant) {
      await audit('failed', { reason: 'unknown_tenant' });
      throw new ApiError('not_found', 'Unknown tenant.');
    }

    // A named source must exist. Creating it instead would turn a typo in an id
    // into a second copy of a document the installer thought they were replacing.
    const existing = body.data.sourceId
      ? await store.getKnowledgeSource(tenant.id, body.data.sourceId)
      : null;
    if (body.data.sourceId && !existing) {
      await audit('failed', {
        tenantId: tenant.id,
        reason: 'not_found',
        detail: {},
      });
      throw new ApiError('not_found', 'No such knowledge source for this installer.');
    }

    const at = new Date(now()).toISOString();
    const sourceId = existing?.id ?? newId('ks');
    const { chunks, emptySections } = chunkWithReport({
      id: sourceId,
      title: body.data.title,
      url: body.data.url ?? null,
      version: body.data.version,
      text: body.data.text,
    });

    const issues: KnowledgeIssue[] = [];
    if (emptySections > 0) {
      issues.push({
        code: 'empty-section',
        severity: 'warning',
        message: `${emptySections} heading(s) in this document had no text under them.`,
        detail: 'They were kept out of the index and are not quotable. Check the conversion.',
      });
    }

    if (chunks.length === 0) {
      issues.unshift({
        code: 'empty-document',
        severity: 'error',
        message: 'This document contained no text that could be indexed.',
        detail: 'Nothing was stored. The assistant would have nothing to quote from.',
      });
      const job: IngestionJob = {
        id: newId('job'),
        tenantId: tenant.id,
        sourceId: null,
        status: 'failed',
        documents: 1,
        chunks: 0,
        issues,
        startedAt: at,
        finishedAt: new Date(now()).toISOString(),
      };
      await store.saveIngestionJob(job);
      // Nothing was stored, so the act failed -- but the caller was entitled to
      // attempt it and the refusal is the installer's own document being empty
      // rather than anything about them. `refused` says exactly that.
      await audit('failed', {
        tenantId: tenant.id,
        reason: 'refused',
        detail: { characters: body.data.text.length, chunks: 0 },
      });
      const failed: KnowledgeSourceResponse = { source: null, job };
      reply.code(200);
      return failed;
    }

    const saved = await store.putKnowledgeSource({
      id: sourceId,
      tenantId: tenant.id,
      title: body.data.title,
      url: body.data.url ?? null,
      version: body.data.version,
      text: body.data.text,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    });
    const record = saved.find((row) => row.id === sourceId);

    const job: IngestionJob = {
      id: newId('job'),
      tenantId: tenant.id,
      sourceId,
      status: 'succeeded',
      documents: 1,
      chunks: chunks.length,
      issues,
      startedAt: at,
      finishedAt: new Date(now()).toISOString(),
    };
    await store.saveIngestionJob(job);

    // The length, the passage count and whether this replaced something. Not the
    // title, and never the text: a document's size is an audit fact and its first
    // line is the installer's commercial copy.
    await audit('permitted', {
      tenantId: tenant.id,
      detail: {
        characters: body.data.text.length,
        chunks: chunks.length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
        replaced: existing !== null,
      },
    });

    const payload: KnowledgeSourceResponse = {
      source: {
        id: sourceId,
        tenantId: tenant.id,
        title: body.data.title,
        url: body.data.url ?? null,
        version: body.data.version,
        characters: body.data.text.length,
        chunkCount: chunks.length,
        createdAt: record?.createdAt ?? at,
        updatedAt: at,
      },
      job,
    };
    reply.code(existing ? 200 : 201);
    return payload;
  });

  /**
   * What happened to one ingestion job.
   *
   * Ingestion completes inside the request above, so this is not yet a polling
   * endpoint -- it is the read half of a pair whose other half is meant to
   * outlive the request once crawling a site or a Drive folder is in scope. It
   * is built now because the client contract should not have to change then, and
   * because "which job was that" is already a question worth being able to ask.
   *
   * The tenant is named by the caller, exactly as the upload names it, and the
   * read is scoped by that name: a job id from one installer, asked for under
   * another installer's tenant, is a 404 rather than a leak.
   */
  app.get('/v1/knowledge/jobs/:id', async (request) => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'Knowledge ingestion is disabled on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    const audit = auditChannel(request, 'knowledge.job.read', { kind: 'ingestion_job', id: null });
    if (!tokensMatch(bearer(request), config.adminToken)) {
      await audit('denied', { reason: 'bad_credential' });
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }

    const params = request.params as { id?: string };
    const query = request.query as { tenantId?: string };
    const tenantId = query.tenantId ?? '';
    if (!params.id || !tenantId) {
      throw new ApiError('bad_request', 'A job id and a tenantId are required.');
    }
    if (!tenants.all.some((t) => t.id === tenantId)) {
      await audit('failed', { reason: 'unknown_tenant' });
      throw new ApiError('not_found', 'Unknown tenant.');
    }

    const job = await store.getIngestionJob(tenantId, params.id);
    if (!job) {
      // A job id from another installer and a job id that never existed are the
      // same answer here on purpose, so the trail records the same thing: the
      // read was refused, and the id is not repeated because it may well name
      // somebody else's record.
      await audit('failed', { tenantId, reason: 'not_found' });
      throw new ApiError('not_found', 'No such ingestion job.');
    }

    await audit('permitted', {
      tenantId,
      target: { kind: 'ingestion_job', id: job.id },
      detail: { chunks: job.chunks, documents: job.documents },
    });
    const payload: KnowledgeJobResponse = { job };
    return payload;
  });

  // ─── audit ─────────────────────────────────────────────────────────────────
  //
  // The trail is readable by the credential it is written about, and by nothing
  // else. It is the record of what was done to one installer's data, so a read
  // that could cross tenants would hand one installer the history of another's --
  // the same argument the catalogue and knowledge reads make, and the same one
  // that made the lead list admin-only rather than visitor-scoped.

  /**
   * A tenant's audit events, newest first.
   *
   * `tenantId` is stripped from every event on the way out, exactly as the
   * catalogue strips it from a product row and for the same reason: the caller
   * named the tenant in the query, so the field carries nothing they can use, and
   * it is the key these rows are stored under. Events with no tenant -- refused
   * attempts that never got as far as naming one -- are not returned by any
   * tenant's read. They are on disk for an operator doing forensics, and there is
   * deliberately no route over them yet: a cross-tenant view of refusals belongs
   * to the dashboard, and that is blocker 4.
   */
  app.get('/v1/audit/events', async (request) => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'The audit trail is disabled on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    if (!tokensMatch(bearer(request), config.adminToken)) {
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }

    const query = request.query as { tenantId?: string; limit?: string };
    const tenantId = query.tenantId ?? '';
    if (!tenantId) throw new ApiError('bad_request', 'A tenantId is required.');
    if (!tenants.all.some((tenant) => tenant.id === tenantId)) {
      throw new ApiError('not_found', 'Unknown tenant.');
    }

    // Clamped rather than refused: a caller asking for more than the cap gets the
    // cap, which is a bound on one response rather than a judgement about the
    // request. The default is what a dashboard opens with.
    const requested = Number.parseInt(query.limit ?? '', 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 50;

    const events = (await store.listAuditEvents(tenantId, limit)).map(
      ({ tenantId: _tenantId, ...event }) => event,
    );
    const payload: AuditEventsResponse = { events };
    return payload;
  });

  // ─── recommendations ───────────────────────────────────────────────────────

  /**
   * Options, assembled from the installer's own catalogue.
   *
   * The refinement lives here rather than in the tool so that both doors — a
   * visitor clicking "cheaper", and the model deciding to refine — go through
   * the same merge against the same stored constraints. The response carries the
   * merged want, so a caller can see what was actually in force rather than what
   * it asked for.
   */
  app.post('/v1/recommendations', async (request, reply) => {
    const claims = verifySessionToken(bearer(request), config.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');

    // Limited by the chat rule: this spends CPU rather than tokens, and the
    // subject is authenticated either way, so a separate budget would be a
    // second number to get wrong for no gain.
    enforceRateLimit(
      request,
      reply,
      'recommendations',
      claims.sessionId,
      config.rateLimit.rules.chat,
    );

    const body = recommendationRequestSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);
    if (body.data.sessionId !== claims.sessionId) {
      throw new ApiError('forbidden', 'That session token is for a different session.');
    }

    const [products, conversation, standing] = await Promise.all([
      store.listProducts(claims.tenantId),
      store.getConversation(claims.tenantId, claims.sessionId),
      store.getWant(claims.tenantId, claims.sessionId),
    ]);

    const want = mergeWant(standing, body.data.want ?? {});
    const response = recommend({
      products,
      answers: conversation?.answers ?? {},
      want,
      now: new Date(now()).toISOString(),
    });
    await store.saveWant(claims.tenantId, claims.sessionId, want);
    return response;
  });

  /**
   * The options currently in force for this session, without refining anything.
   *
   * This exists because the widget arrives at a recommendation by two doors --
   * the visitor typing, and the model calling the tool -- and neither of them can
   * hand the browser the option set: the stream event carries identifiers on
   * purpose, and a tool result belongs to the model, not the page. Reopening a
   * conversation is the same problem: the visitor should see the options they
   * were already given rather than an empty frame.
   *
   * So the widget reads them back. It is a read: no want is merged, nothing is
   * saved, and because the engine is a pure function of the stored constraints
   * and the catalogue, calling it twice with nothing changed returns the same
   * answer. The session token is the whole address -- the token *is* the session
   * -- so there is no `sessionId` parameter here to disagree with it.
   */
  app.get('/v1/recommendations', async (request, reply) => {
    const claims = verifySessionToken(bearer(request), config.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');

    enforceRateLimit(
      request,
      reply,
      'recommendations',
      claims.sessionId,
      config.rateLimit.rules.chat,
    );

    const [products, conversation, want] = await Promise.all([
      store.listProducts(claims.tenantId),
      store.getConversation(claims.tenantId, claims.sessionId),
      store.getWant(claims.tenantId, claims.sessionId),
    ]);

    return recommend({
      products,
      answers: conversation?.answers ?? {},
      want,
      now: new Date(now()).toISOString(),
    });
  });

  return app;
}

/**
 * Compare a presented token with the configured one in constant time.
 *
 * `timingSafeEqual` throws on unequal lengths, so the length check has to come
 * first — which leaks the length and nothing else, the usual and accepted
 * trade. What this buys is that a wrong token cannot be narrowed down one byte
 * at a time by watching how long the comparison took.
 */
function tokensMatch(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
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
