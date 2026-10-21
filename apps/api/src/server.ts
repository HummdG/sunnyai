import {
  ApiError,
  badRequestFromZod,
  catalogueUploadRequestSchema,
  chatRequestSchema,
  CONSENT_VERSION,
  dashboardMetricsQuerySchema,
  leadRequestSchema,
  publicWidgetIdSchema,
  qualificationAnswerSchema,
  recommendationRequestSchema,
  sessionRequestSchema,
  knowledgeSourceRequestSchema,
  STATUS_FOR_CODE,
  WAITLIST_CONSENT_VERSION,
  waitlistRemoveSchema,
  waitlistRequestSchema,
  type WaitlistResponse,
  type AuditAction,
  type AuditEventsResponse,
  type AuditOutcome,
  type AuditReason,
  type AuditTarget,
  type CatalogueIssue,
  type CatalogueResponse,
  type CatalogueUploadResponse,
  type ChatStreamEvent,
  type DashboardMetrics,
  type IngestionJob,
  type KnowledgeIssue,
  type KnowledgeJobResponse,
  type KnowledgeSourceResponse,
  type QualificationAnswerResponse,
} from '@sunny/contracts';
import { chunkWithReport, findPlaceholders, scanForPii } from '@sunny/knowledge';
import { importProducts, importRecords, mergeWant, parseCsv, recommend } from '@sunny/solar-rules';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import { runTurn } from './agent/agent.js';
import { NotEntitledError, isEntitled } from './agent/channels.js';
import type { PassageSearch } from './agent/retrieval.js';
import { detectSafetyConcern } from './agent/support.js';
import { verifyTurnstile } from './turnstile.js';
import {
  ProviderUnavailableError,
  UnconfiguredProvider,
  type ChatProvider,
} from './agent/provider.js';
import { createAuditor, type Auditor } from './audit.js';
import {
  DEFAULT_CHAT_IP_RULE,
  DEFAULT_MAX_INPUT_CHARS,
  capabilityReport,
  type ServerConfig,
} from './config.js';
import { createKnowledgeLoader } from './knowledge.js';
import {
  clientAddress,
  createRateLimiter,
  type RateLimiter,
  type RateLimitRule,
} from './ratelimit.js';
import { explain, nextQuestion, reconcile, validateAnswer } from './questionnaire.js';
import { startRetention } from './retention.js';
import { issueSessionToken, SESSION_TTL_MS, verifySessionToken } from './sessions.js';
import { newId, type DeletedConversation, type ModelCall, type Store } from './store.js';
import type { TenantRegistry } from './tenants.js';
import { summariseUsage } from './usage.js';
import { FileVoiceUsage } from './channels/voice/usage.js';
import { registerPortalRoutes, type KnowledgeSyncConnector } from './routes/portal.js';
import { registerCataloguePortalRoutes } from './routes/catalogue-portal.js';
import { registerEmailRoutes, type EmailOverrides } from './routes/email.js';
import type { SunScanService } from '@sunny/sunscan-adapter';
import { registerVoiceRoutes, type VoiceRouteDeps } from './routes/voice.js';
import {
  createDefaultSunScan,
  registerSunScanRoutes,
  taskVerifierFromEnv,
} from './routes/sunscan.js';
import { registerQuoteRoutes, sunscanRoofLookup } from './routes/quote.js';
import { registerProposalRoutes } from './routes/proposal.js';
import { mailerFromEnv, type ProposalMailer } from './proposal/mailer.js';
import { catalogueBackedPricing } from './journey/catalogue-pricing.js';
import type { PricingSource } from '@sunny/quote-engine';
import { sha256 } from './ingest/prepare.js';
import {
  registerKnowledgeIngestRoutes,
  type KnowledgePipelineOptions,
} from './routes/knowledge-ingest.js';
import { loadPortalConfig, type PortalConfig } from './routes/portal-config.js';

export interface ServerDeps {
  config: ServerConfig;
  store: Store;
  tenants: TenantRegistry;
  /**
   * The SunScan roof assessment service (routes/sunscan.ts). Absent builds the
   * default -- the vendored engine, records in `store`; null switches it off.
   */
  sunscan?: SunScanService | null;
  /**
   * Checks the Cloud Tasks OIDC token on `POST /internal/sunscan/run`. Absent
   * reads the environment (SUNSCAN_QUEUE=cloud-tasks); null switches it off.
   */
  sunscanTaskVerifier?: ((token: string) => Promise<boolean>) | null;
  /** Defaults to the unconfigured provider when no key is set. */
  provider?: ChatProvider;
  /** Injected so tests can drive the clock and read bucket counts. */
  rateLimiter?: RateLimiter;
  now?: () => number;
  /** Installer portal + billing settings; read from the environment when absent. */
  portal?: PortalConfig;
  /** How the portal starts knowledge syncs (provided by the ingestion pipeline). */
  knowledgeSync?: KnowledgeSyncConnector;
  /** Voice & Phone add-on overrides (Live connector, Twilio fetch, clocks); injected by tests. */
  voice?: Partial<VoiceRouteDeps>;
  /** Turnstile's siteverify transport; injected by tests. */
  turnstileFetch?: typeof fetch;
  /**
   * How a chat turn finds the installer's passages. Defaults to the lexical
   * search; the hybrid search (knowledge pipeline) is passed here.
   */
  passageSearch?: PassageSearch;
  /** The knowledge pipeline's swappable parts (fetcher, Drive client, embedder); tests inject fakes. */
  knowledge?: KnowledgePipelineOptions;
  /** Email Assistant add-on test seams (routes/email.ts). */
  emailAddon?: EmailOverrides;
  /** Outbound mail for emailed quotes; null disables it. Defaults to the environment. */
  proposalMailer?: ProposalMailer | null;
  /** The quote journey's pricing (tests); defaults to the demo fixture. */
  quotePricing?: PricingSource;
}

const SSE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Cloud Run buffers a proxied response unless it is told not to, which turns a
  // live stream into one delivery at the end.
  'x-accel-buffering': 'no',
};

/** A day in milliseconds, for turning the dashboard's `days` into a window. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The window the dashboard counts over when the caller names none.
 *
 * A month is what an installer opening an overview expects to see, and it is
 * deliberately a constant rather than a magic 30 in the route: the response echoes
 * the window it used, and the test that checks the default reads this name.
 */
const DEFAULT_DASHBOARD_DAYS = 30;

export function buildServer(deps: ServerDeps): FastifyInstance {
  const { config, store, tenants } = deps;
  const now = deps.now ?? (() => Date.now());
  // Where the quote journey prices from: each installer's published price list
  // (catalogue, WS7). No published list → sizes and savings without prices.
  const quotePricing = deps.quotePricing ?? catalogueBackedPricing(store);
  const sunscan =
    deps.sunscan !== undefined ? deps.sunscan : createDefaultSunScan(store, config.dataDir);
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

  // The knowledge pipeline (website crawl, Drive sync, PII quarantine, hybrid
  // search). Its routes live in routes/knowledge-ingest.ts; its search is the
  // default `passageSearch` for chat turns below.
  const knowledgePipeline = registerKnowledgeIngestRoutes(
    app,
    {
      config,
      store,
      tenants,
      now,
      enforceRateLimit,
      isAdmin: (request) =>
        config.adminToken !== null && tokensMatch(bearer(request), config.adminToken),
    },
    deps.knowledge ?? {},
  );

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
  // is visible. Two lists decide an origin:
  //
  //  - `WIDGET_ALLOWED_ORIGINS`, the platform's own sites (dashboard, marketing,
  //    demo hosts). Empty means "echo any origin", a development convenience
  //    that production refuses (see the session route).
  //  - every installer's registered domains, read live from the tenant records.
  //    A new installer's site works the moment they register it in the portal,
  //    with no redeploy -- the static list alone made every sign-up a code change.
  //
  // CORS only decides whether a browser may call at all; *which* tenant a page
  // may speak for is decided per request by the session route.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    const allowed =
      config.allowedOrigins.length === 0 ||
      config.allowedOrigins.includes(origin) ||
      tenants.all.some((t) => originOnDomains(origin, t.domains ?? []))
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
      // PATCH, PUT and DELETE are the portal's catalogue routes (routes/catalogue-portal.ts);
      // every one of them still needs a signed-in installer.
      .header('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
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
    return {
      ...widgetConfig,
      maxInputChars: config.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS,
      ...(config.turnstile ? { turnstileSiteKey: config.turnstile.siteKey } : {}),
    };
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
    // A tenant without registered domains falls back to the platform list; in
    // production such a widget opens nowhere -- fail closed until the installer
    // registers their site in the portal.
    if (!tenant.domains || tenant.domains.length === 0) {
      if (config.nodeEnv === 'production') {
        throw new ApiError(
          'forbidden',
          'This assistant has no registered website yet. Add your domain in the Sunny portal.',
        );
      }
      if (config.allowedOrigins.length > 0 && origin && !config.allowedOrigins.includes(origin)) {
        throw new ApiError('forbidden', 'This origin is not allowed to open a session.');
      }
    }
    // The tenant's registered domains (Blueprint §4.6). Both the origin the page
    // reports and the browser's own Origin header must be on one of them, so a
    // script cannot simply claim to be the installer's site.
    if (tenant.domains && tenant.domains.length > 0) {
      const headerOrigin =
        typeof request.headers.origin === 'string' ? request.headers.origin : null;
      for (const candidate of [origin, headerOrigin]) {
        if (candidate !== null && !originOnDomains(candidate, tenant.domains)) {
          throw new ApiError('forbidden', 'This site is not registered for this assistant.');
        }
      }
    }
    // Before a session is issued, the visitor proves they are not a script
    // (Cloudflare Turnstile, when the deployment enables it).
    if (config.turnstile) {
      const check = await verifyTurnstile(
        body.data.turnstileToken,
        config.turnstile.secretKey,
        clientAddress({
          socketAddress: request.raw.socket.remoteAddress,
          forwardedFor: request.headers['x-forwarded-for'],
          trustedHops: config.rateLimit.trustProxyHops,
        }),
        deps.turnstileFetch,
      );
      if (!check.success) {
        request.log.warn({ codes: check.errorCodes }, 'turnstile check failed');
        throw new ApiError('forbidden', 'The visitor check failed. Please reload the page.');
      }
    }

    // A session token presented back to us resumes that session; otherwise this
    // is a fresh visitor. Only a token for *this* tenant resumes: a token for
    // another one is treated as no token at all rather than carried across.
    const resumedClaims = verifySessionToken(body.data.sessionToken, config.sessionSecret, now());
    const resuming = resumedClaims !== null && resumedClaims.tenantId === tenant.id;
    const sessionId = resuming ? resumedClaims.sessionId : newId('sess');

    // The accepted origin goes *into the token*, and this is what makes it usable
    // as consent provenance later. A lead is filed long after the session opened,
    // by a request that carries no origin of its own -- and a header on that later
    // request would be the caller's claim, not evidence about the page. Signed
    // here, the value is fixed for the life of the session and the caller can
    // carry it but cannot alter it. A resumed session keeps the origin it was
    // opened with, for the same reason: the page does not move.
    const acceptedOrigin = resuming ? (resumedClaims.origin ?? origin ?? null) : (origin ?? null);

    const expiresAt = now() + SESSION_TTL_MS;
    const sessionToken = issueSessionToken(
      { sessionId, tenantId: tenant.id, expiresAt, origin: acceptedOrigin },
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
    // And per address (Blueprint §4.6): fresh sessions do not buy more messages.
    enforceRateLimit(
      request,
      reply,
      'chat-ip',
      clientAddress({
        socketAddress: request.raw.socket.remoteAddress,
        forwardedFor: request.headers['x-forwarded-for'],
        trustedHops: config.rateLimit.trustProxyHops,
      }),
      config.rateLimit.rules.chatIp ?? DEFAULT_CHAT_IP_RULE,
    );

    // Blueprint §4.6: a hard ceiling on what one message can cost.
    const maxInputChars = config.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
    if (body.data.text.length > maxInputChars) {
      throw new ApiError(
        'bad_request',
        `Messages are limited to ${maxInputChars} characters. Please shorten yours.`,
      );
    }

    const tenant = tenants.all.find((t) => t.id === claims.tenantId);
    if (!tenant) throw new ApiError('not_found', 'Unknown tenant for this session.');
    if (!isEntitled(tenant, 'chat')) {
      throw new ApiError('not_enabled', new NotEntitledError('chat').message);
    }

    const chat = await getProvider();
    // A safety concern is answered by the server without a model, so it is
    // answered even on a deployment with no model configured.
    const safety = detectSafetyConcern(body.data.text);
    if (chat.kind === 'unconfigured' && !safety) {
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
    // The SunScan engine is vendored, so roof assessments are available wherever
    // the service is on; `tenant.sunscanUrl` belonged to the external-service design.
    const sunscanConnected = sunscan !== null;
    const userText = body.data.text;
    const clientMessageId = body.data.clientMessageId;
    // The assistant's effectful tool calls are audited, the same as any other
    // privileged act: `create_lead` and `request_callback` file a record, and
    // "which conversation was the callback promised in" is a question the trail
    // should be able to answer. Reads are not -- see `EFFECTFUL_TOOL_NAMES`.
    const audit = auditFor(request);
    // From the signed claims, so a lead filed by a tool records where the page was
    // without the tool having to ask -- and without the model being able to name it.
    const origin = claims.origin ?? null;

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
          ...(sunscan ? { sunscan } : {}),
          knowledge,
          audit,
          origin,
          channel: 'chat',
          search: deps.passageSearch ?? knowledgePipeline.retrieve.passageSearch,
          quote: { pricing: quotePricing },
          signal: abort.signal,
        })) {
          if (abort.signal.aborted) break;
          yield frame(event as ChatStreamEvent);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The assistant failed.';
        const code =
          error instanceof ProviderUnavailableError || error instanceof NotEntitledError
            ? 'not_enabled'
            : 'upstream_failed';
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
      // The turn record is the store's shape, and it carries operational
      // telemetry (`call`: which model answered, how long it took, how many
      // tokens) that is the *installer's* business, not the visitor's. This
      // route hands the array back to the visitor's own browser, so the field
      // is dropped here rather than at the store, where the dashboard still
      // needs it. Everything the widget reads -- `text`, `role`, `at`, `tools`,
      // `answers` -- is passed through untouched.
      turns: (conversation?.turns ?? []).map(({ call: _call, ...turn }) => turn),
    };
  });

  /**
   * A visitor erasing their own conversation.
   *
   * The plan's §4 asks for deletion, and the subject of the request has to be the
   * person the data is about: the credential is the visitor's own session token,
   * so a caller can only ever reach their own conversation. There is no `sessionId`
   * parameter, exactly as on the read above -- a body field that had to agree with
   * the token would be a second source of truth for the one value that decides
   * whose data this is.
   *
   * It erases the transcript, the standing answers and any enquiry filed from the
   * session, because the transcript *is* the qualification record: a visitor
   * describing their home, their postcode and their plans is the personal data the
   * request is about, and deleting the lead while keeping the conversation would
   * answer the request on a technicality.
   *
   * Idempotent, and 200 either way. "Erase what you have about me" asked by
   * someone we hold nothing about is answered, not refused; a 404 would make the
   * caller's job harder for no privacy gain, and the response says plainly what
   * was there.
   */
  app.delete('/v1/conversation', async (request, reply) => {
    const claims = verifySessionToken(bearer(request), config.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');

    // Keyed by session on the chat rule's numbers: this is an authenticated call
    // that costs no model tokens, but a leaked session token should not be an
    // unlimited write amplifier either.
    enforceRateLimit(
      request,
      reply,
      'conversation-delete',
      claims.sessionId,
      config.rateLimit.rules.chat,
    );

    const audit = auditChannel(request, 'conversation.delete', { kind: 'conversation', id: null });
    const erased = await store.deleteConversation(claims.tenantId, claims.sessionId);

    // Recorded even though the caller is the visitor acting on their own record,
    // and not only the privileged acts: an installer asking "why is this enquiry
    // gone from my list" is asking about precisely this event, and a deletion the
    // trail cannot explain is the one kind it most needs to.
    await audit('permitted', {
      tenantId: claims.tenantId,
      sessionId: claims.sessionId,
      target: { kind: 'conversation', id: erased.conversationId },
      detail: {
        conversations: erased.conversationId === null ? 0 : 1,
        leads: erased.leads.length,
      },
    });

    return {
      deleted: true,
      leadId: null,
      conversationId: erased.conversationId,
      leadsDeleted: erased.leads.length,
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
      // What the server observed about how this agreement was given, not what the
      // caller said about it: the wording version is ours, the surface is ours,
      // and the origin is the one signed into this session. See
      // `packages/contracts/src/consent.ts` and D-44.
      consent: { version: CONSENT_VERSION, surface: 'form', origin: claims.origin ?? null },
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
   * The home page's waitlist: an installer asking to hear when Sunny opens.
   *
   * Public, so it is guarded the way the other public writes are: limited per
   * client address, and in production only Sunny's own sites may post (the
   * platform list, `WIDGET_ALLOWED_ORIGINS`), not an installer's. Nothing is
   * stored without the consent box, and the answer is the same whether the
   * address was new or already listed, so the form cannot be used to find out
   * who has joined.
   */
  app.post('/v1/waitlist', async (request, reply): Promise<WaitlistResponse> => {
    // The leads limit, in a bucket of its own: the same kind of write (a durable
    // row from an anonymous page), so the same allowance, but a busy waitlist
    // must not use up a visitor's enquiries or the other way round.
    enforceRateLimit(
      request,
      reply,
      'waitlist',
      clientAddress({
        socketAddress: request.raw.socket.remoteAddress,
        forwardedFor: request.headers['x-forwarded-for'],
        trustedHops: config.rateLimit.trustProxyHops,
      }),
      config.rateLimit.rules.leads,
    );

    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : null;
    if (
      config.nodeEnv === 'production' &&
      (origin === null || !config.allowedOrigins.includes(origin))
    ) {
      throw new ApiError('forbidden', 'The waitlist can only be joined from the Sunny website.');
    }

    const body = waitlistRequestSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);

    await store.joinWaitlist({
      email: body.data.email,
      company: body.data.company || null,
      joinedAt: new Date(now()).toISOString(),
      consentVersion: WAITLIST_CONSENT_VERSION,
      origin,
    });
    return { ok: true };
  });

  /** The operator reading the waitlist out, to invite people. Admin token. */
  app.get('/v1/waitlist', async (request) => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'The waitlist is not readable on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    const audit = auditChannel(request, 'waitlist.read', { kind: 'waitlist', id: null });
    if (!tokensMatch(bearer(request), config.adminToken)) {
      await audit('denied', { reason: 'bad_credential' });
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }
    const entries = await store.listWaitlist();
    // The count, not the addresses, for the same reason as the lead list.
    await audit('permitted', { detail: { entries: entries.length } });
    return { entries };
  });

  /** Someone asked to be taken off the waitlist. Admin token; the email in the body. */
  app.delete('/v1/waitlist', async (request) => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'The waitlist is not editable on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    const audit = auditChannel(request, 'waitlist.delete', { kind: 'waitlist', id: null });
    if (!tokensMatch(bearer(request), config.adminToken)) {
      await audit('denied', { reason: 'bad_credential' });
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }
    const body = waitlistRemoveSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);
    const removed = await store.leaveWaitlist(body.data.email);
    await audit('permitted', { detail: { removed } });
    return { removed };
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

  /**
   * An installer erasing one enquiry.
   *
   * Same credential and same shape as the read above -- admin token, tenant named
   * in the query -- and for the same reason: the caller is the installer, not the
   * visitor, so the tenant is theirs to name and the stored row is theirs to
   * remove. A visitor's own erasure request goes to `DELETE /v1/conversation`,
   * which is the only way this API lets someone act on their own data.
   *
   * **The conversation goes with the last enquiry from it.** The transcript is the
   * visitor's answers, and a transcript kept after the enquiry it belonged to was
   * erased is personal data retained with nothing left to justify it. It is erased
   * only when no other enquiry shares that session, though: two submissions from
   * one conversation are two records, and erasing one is not a request to erase
   * the other.
   */
  app.delete('/v1/leads/:leadId', async (request, reply) => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'The lead list is disabled on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    const audit = auditChannel(request, 'leads.delete', { kind: 'lead_list', id: null });
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

    // Limited on the catalogue's numbers: an admin-token write, so the limit is
    // here to stop a leaked token becoming an unlimited delete loop rather than to
    // shape ordinary use.
    enforceRateLimit(
      request,
      reply,
      'leads-delete',
      clientAddress({
        socketAddress: request.raw.socket.remoteAddress,
        forwardedFor: request.headers['x-forwarded-for'],
        trustedHops: config.rateLimit.trustProxyHops,
      }),
      config.rateLimit.rules.catalogue,
    );

    const { leadId } = request.params as { leadId: string };
    const lead = await store.deleteLead(tenantId, leadId);
    if (!lead) {
      // Another tenant's id lands here too, and deliberately: `deleteLead` treats
      // "not here" and "not yours" as one answer, so this route cannot be used to
      // learn which lead ids another installer holds.
      await audit('failed', {
        tenantId,
        reason: 'not_found',
        target: { kind: 'lead_list', id: leadId },
      });
      throw new ApiError('not_found', 'No such lead.');
    }

    // Does any enquiry still share this conversation? Counted after the deletion,
    // so the row just removed cannot answer for itself.
    const remaining = await store.listLeads(tenantId);
    const lastOfItsConversation = !remaining.some((other) => other.sessionId === lead.sessionId);
    const erasedConversation: DeletedConversation = lastOfItsConversation
      ? await store.deleteConversation(tenantId, lead.sessionId)
      : { conversationId: null, leads: [] };

    await audit('permitted', {
      tenantId,
      target: { kind: 'lead_list', id: leadId },
      detail: {
        conversations: erasedConversation.conversationId === null ? 0 : 1,
        leads: 1 + erasedConversation.leads.length,
      },
    });

    return {
      deleted: true,
      leadId,
      conversationId: erasedConversation.conversationId,
      // Only the ones that went *with* the conversation. The lead named in the
      // path is reported by `leadId`, and counting it twice would make the two
      // fields disagree about the same row.
      leadsDeleted: erasedConversation.leads.length,
    };
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

    // Personal data never reaches the index (Blueprint §4.5): a document holding
    // someone's bank, card or identity details, or one customer's bill, is
    // refused outright; a private email or mobile is masked.
    const pii = scanForPii(body.data.text);
    if (pii.verdict === 'quarantine') {
      const job: IngestionJob = {
        id: newId('job'),
        tenantId: tenant.id,
        sourceId: null,
        status: 'failed',
        documents: 1,
        chunks: 0,
        issues: [
          {
            code: 'quarantined-pii',
            severity: 'error',
            message: 'This document was not indexed: it appears to contain personal data.',
            detail: pii.reason,
          },
        ],
        startedAt: at,
        finishedAt: new Date(now()).toISOString(),
        kind: 'upload',
      };
      await store.saveIngestionJob(job);
      await audit('failed', {
        tenantId: tenant.id,
        reason: 'refused',
        detail: { characters: body.data.text.length, chunks: 0 },
      });
      const quarantined: KnowledgeSourceResponse = { source: null, job };
      reply.code(200);
      return quarantined;
    }
    const text = pii.redacted;

    const { chunks, emptySections } = chunkWithReport({
      id: sourceId,
      title: body.data.title,
      url: body.data.url ?? null,
      version: body.data.version,
      text,
    });

    const issues: KnowledgeIssue[] = [];
    if (pii.verdict === 'redact') {
      issues.push({
        code: 'pii-redacted',
        severity: 'warning',
        message: 'Personal details were masked before indexing.',
        detail: pii.reason,
      });
    }
    // Unfilled template text: reported with its section so it can be fixed, and
    // masked at retrieval so it is never quoted (see `findPlaceholders`).
    const warnings = findPlaceholders(text);
    if (warnings.length > 0) {
      issues.push({
        code: 'placeholder',
        severity: 'warning',
        message: `This document has ${warnings.length} unfilled placeholder(s), e.g. "${warnings[0]!.text}".`,
        detail:
          'The assistant will never quote these; it says the detail has not been provided instead. Fill them in and upload again.',
      });
    }
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
      text,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      kind: 'upload',
      contentHash: sha256(text),
      warnings,
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
        characters: text.length,
        chunkCount: chunks.length,
        createdAt: record?.createdAt ?? at,
        updatedAt: at,
        kind: 'upload',
        warnings,
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

  // ─── dashboard ─────────────────────────────────────────────────────────────

  /**
   * The installer's overview figures.
   *
   * The plan's §6.4 gives the dashboard an "Overview (real conversations,
   * qualified leads, engagement, source health, usage)" and §12 asks for analytics
   * "based on events, with clear denominators and date ranges". This is the
   * overview's data half. It is *only* the data half: the dashboard *app* is
   * blocked on blocker 4 (dashboard authentication), and building a UI over an
   * admin-token API would put that token in a browser, which is the one place it
   * cannot be. So this route exists and is reachable exactly as `GET /v1/leads` is
   * -- by an operator holding the deployment's admin token -- and the surface that
   * would call it is not built.
   *
   * ## What it does and does not answer
   *
   * `packages/contracts/src/dashboard.ts` carries the field-by-field argument.
   * The short version: conversations and engagement are counted from records, the
   * lead figures are counted and honest about not being scored, and two of the
   * plan's five words are deliberately left unanswered rather than filled with a
   * plausible number -- **source health** is a count of documents and not a health
   * verdict (the real one needs Drive, which is blocked), and **usage** is absent
   * entirely because nothing meters it. A dashboard that invented a usage figure
   * would be wrong in the one way a person cannot check.
   *
   * ## Why it is not audited
   *
   * Every other admin route that hands over a *record* writes an audit event, and
   * `leads.read` is the clearest case: reading the list gives away every visitor's
   * name and phone, so it is recorded even though the plan says "changes". This
   * route exposes no visitor data at all -- only counts -- so there is nothing
   * here for a trail to explain, and adding an action would either bloat the closed
   * `AUDIT_ACTIONS` vocabulary with an event nobody investigates or make the one
   * list that is supposed to mean something mean less. The reasoning that made
   * `leads.read` an exception does not reach a route that cannot name a person.
   *
   * ## The window
   *
   * A rolling window ending at the instant the request is served, in UTC, half-open
   * `[from, to)`. `days` is bounded by the query contract (a bad value is a 400,
   * not a clamp) and defaults to {@link DEFAULT_DASHBOARD_DAYS}; the response echoes
   * whichever window was used in `range`, so a caller never has to guess. The
   * boundaries are the server's clock, not the caller's -- a client that wants
   * "October" in its own timezone can count to the instants given back.
   */
  app.get('/v1/dashboard/metrics', async (request) => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'The dashboard is disabled on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    if (!tokensMatch(bearer(request), config.adminToken)) {
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }

    const query = dashboardMetricsQuerySchema.safeParse(request.query);
    if (!query.success) throw badRequestFromZod(query.error);
    const { tenantId, days } = query.data;
    if (!tenants.all.some((tenant) => tenant.id === tenantId)) {
      throw new ApiError('not_found', 'Unknown tenant.');
    }

    const windowDays = days ?? DEFAULT_DASHBOARD_DAYS;
    const to = now();
    const from = to - windowDays * DAY_MS;

    /**
     * Whether a record's timestamp falls inside the window.
     *
     * Half-open on purpose: an enquiry filed at exactly `to` belongs to the next
     * window, which is what makes two consecutive windows partition a history
     * instead of double-counting the instant they share.
     *
     * An unparseable timestamp is *excluded*, and that direction is worth stating:
     * `Date.parse` gives NaN and every comparison with NaN is false, so a row this
     * test cannot date is left out of the window rather than arbitrarily included.
     * The retention sweep makes the opposite choice for the same reason in reverse
     * -- there, an undateable row is *kept*, because the operation is a deletion.
     */
    const inWindow = (at: string): boolean => {
      const ms = Date.parse(at);
      return Number.isFinite(ms) && ms >= from && ms < to;
    };

    const [conversations, leads, sources, products] = await Promise.all([
      store.listConversations(tenantId),
      store.listAllLeads(tenantId),
      store.listKnowledgeSources(tenantId),
      store.listProducts(tenantId),
    ]);

    const started = conversations.filter((conversation) => inWindow(conversation.createdAt));
    const active = conversations.filter((conversation) => inWindow(conversation.updatedAt));

    let visitorTurns = 0;
    let assistantTurns = 0;
    // Collected in the same nested scan rather than in a second pass: the turns
    // are already in hand, and a second scan would be a second place for the
    // window predicate to be applied -- two definitions free to disagree about
    // which calls the figures below are over.
    const calls: ModelCall[] = [];
    for (const conversation of conversations) {
      for (const turn of conversation.turns) {
        if (!inWindow(turn.at)) continue;
        if (turn.role === 'user') visitorTurns += 1;
        else assistantTurns += 1;
        // Only assistant turns ever carry one; older ones predate the field.
        if (turn.call) calls.push(turn.call);
      }
    }

    const captured = leads.filter((lead) => inWindow(lead.createdAt));
    const withContact = captured.filter((lead) => lead.email !== null || lead.phone !== null);

    /**
     * A ratio, or null when its denominator is zero.
     *
     * Rounded to three decimals so the JSON is a number a person can read rather
     * than a float tail; three is enough to tell 0.667 from 0.666 and more than a
     * dashboard ever shows.
     */
    const ratio = (numerator: number, denominator: number): number | null =>
      denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 1000;

    const metrics: DashboardMetrics = {
      range: {
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        days: windowDays,
      },
      conversations: { started: started.length, active: active.length },
      engagement: {
        visitorTurns,
        assistantTurns,
        turnsPerActiveConversation: ratio(visitorTurns + assistantTurns, active.length),
      },
      leads: { captured: captured.length, withContact: withContact.length },
      leadConversion: ratio(captured.length, started.length),
      // Present-state counts: these two are not filtered by the window, and the
      // contract says why. Returning the *whole* set's length here is what makes
      // the field mean what its name says.
      knowledge: { sources: sources.length },
      catalogue: { products: products.length },
      usage: summariseUsage(calls),
    };
    return metrics;
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

  // ─── retention ─────────────────────────────────────────────────────────────
  //
  // Started here rather than in `main.ts` so it shares the server's clock and
  // auditor, and stopped on close so a test process is not left with a live timer.
  // The rule and its reasoning are in `retention.ts`.
  const retention = startRetention({
    store,
    auditor,
    retentionMs: config.leadRetentionDays * 24 * 60 * 60 * 1000,
    now,
    onFailure: (error) => app.log.error({ err: error }, 'retention sweep failed'),
  });
  app.addHook('onClose', () => {
    retention.stop();
  });

  // SunScan roof assessments (routes/sunscan.ts).
  registerSunScanRoutes(app, {
    service: sunscan,
    sessionSecret: config.sessionSecret,
    now,
    taskVerifier:
      deps.sunscanTaskVerifier !== undefined
        ? deps.sunscanTaskVerifier
        : taskVerifierFromEnv(process.env),
  });

  // The quote journey: roof → questionnaire → priced options (routes/quote.ts).
  registerQuoteRoutes(app, {
    store,
    tenants,
    sessionSecret: config.sessionSecret,
    now,
    pricing: quotePricing,
    roof: sunscanRoofLookup(sunscan),
  });

  // The customer proposal PDF and "email me my quote" (routes/proposal.ts).
  registerProposalRoutes(app, {
    store,
    tenants,
    portal: deps.portal ?? loadPortalConfig(process.env, config.nodeEnv),
    sessionSecret: config.sessionSecret,
    now,
    mailer: deps.proposalMailer !== undefined ? deps.proposalMailer : mailerFromEnv(process.env),
  });

  // The Voice & Phone add-on (routes/voice.ts).
  registerVoiceRoutes(app, {
    store,
    tenants,
    sessionSecret: config.sessionSecret,
    allowedOrigins: config.allowedOrigins,
    originOnDomains,
    loadKnowledgeIndex,
    dataDir: config.dataDir,
    adminToken: config.adminToken,
    auditor,
    ...deps.voice,
  });

  // The installer portal and billing (routes/portal.ts).
  registerPortalRoutes(app, {
    store,
    tenants,
    portal: deps.portal ?? loadPortalConfig(process.env, config.nodeEnv),
    sessionSecret: config.sessionSecret,
    now,
    knowledgeSync: deps.knowledgeSync ?? knowledgePipeline.connector,
    voiceUsage: deps.voice?.usage ?? new FileVoiceUsage(config.dataDir),
    sunscan,
  });

  // The installer's product catalogue in the portal (routes/catalogue-portal.ts).
  registerCataloguePortalRoutes(app, {
    store,
    tenants,
    portal: deps.portal ?? loadPortalConfig(process.env, config.nodeEnv),
    sessionSecret: config.sessionSecret,
    now,
    adminToken: config.adminToken,
  });

  // The Email Assistant add-on (routes/email.ts).
  registerEmailRoutes(app, {
    store,
    tenants,
    portal: deps.portal ?? loadPortalConfig(process.env, config.nodeEnv),
    sessionSecret: config.sessionSecret,
    dataDir: config.dataDir,
    ...(config.firestore ? { firestore: config.firestore } : {}),
    now,
    getProvider,
    loadKnowledge: loadKnowledgeIndex,
    search: deps.passageSearch ?? knowledgePipeline.retrieve.passageSearch,
    ...(deps.emailAddon ? { overrides: deps.emailAddon } : {}),
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

/**
 * Whether an origin's host is one of the tenant's registered domains or a
 * subdomain of one. `https://www.example.co.uk` is on `example.co.uk`;
 * `https://example.co.uk.evil.test` is not.
 */
export function originOnDomains(origin: string, domains: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((domain) => {
    const d = domain.trim().toLowerCase().replace(/^\*\./, '');
    return d !== '' && (host === d || host.endsWith(`.${d}`));
  });
}
