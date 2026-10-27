import { ApiError } from '@sunny/contracts';
import type { KnowledgeIndex } from '@sunny/knowledge';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { runTurn } from '../agent/agent.js';
import { NotEntitledError, isEntitled } from '../agent/channels.js';
import type { ChatProvider } from '../agent/provider.js';
import type { PassageSearch } from '../agent/retrieval.js';
import { createAuthenticator, requireMembership } from '../auth/index.js';
import {
  authorizeUrl,
  decryptSecret,
  driveFilesFromEnv,
  EmailAssistant,
  encryptSecret,
  exchangeCode,
  FileEmailState,
  GmailClient,
  inboundToken,
  LeadFollowUp,
  loadEmailConfig,
  mailboxFromState,
  parseMultipartFields,
  parsePostmark,
  parseSendGrid,
  refreshingToken,
  registerEmailTools,
  safeEqual,
  signState,
  verifyState,
  type DriveFiles,
  type EmailAddonConfig,
  type EmailCore,
  type EmailResult,
  type EmailStateStore,
  type GmailPushClient,
  type InboundEmail,
  type MailboxClient,
  type MailProvider,
} from '../channels/email/index.js';
import type { FirestoreConfig } from '../config.js';
import type { LeadRecord, MemberRole, Store } from '../store.js';
import type { EmailChannelConfig, Tenant, TenantRegistry } from '../tenants.js';
import type { PortalConfig } from './portal-config.js';

/**
 * The Email Assistant add-on's HTTP surface (Blueprint §5 Add-On 2, §7 phase 3).
 *
 *   POST /v1/webhooks/inbound-email                 Postmark / SendGrid, basic auth;
 *                                                   tenant from the receiving address
 *   POST /v1/webhooks/inbound-email/:tenantId/:token per-tenant secret URL
 *   POST /v1/webhooks/gmail-push?token=…            Gmail watch notifications (Pub/Sub)
 *   GET  /v1/email/oauth/callback                   mailbox connection (OAuth)
 *   /v1/portal/tenants/:tenantId/email/…            the installer's settings
 *
 * It also hands back the follow-up drafter for website leads (followup.ts),
 * which the chat and lead routes call when a visitor leaves their email.
 *
 * The tenant is always decided by the route -- the receiving address, the
 * secret URL, or the watched mailbox -- and never by anything an email says.
 */

/** Test seams: anything here replaces the deployment default. */
export interface EmailOverrides {
  config?: Partial<EmailAddonConfig>;
  state?: EmailStateStore;
  core?: EmailCore;
  mailbox?: (tenant: Tenant) => Promise<(MailboxClient & Partial<GmailPushClient>) | null>;
  driveFiles?: (tenant: Tenant) => DriveFiles | null;
  /** The transport for OAuth token exchange and provider calls. */
  fetch?: typeof fetch;
}

export interface EmailRouteDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  dataDir: string;
  firestore?: FirestoreConfig;
  now: () => number;
  getProvider: () => Promise<ChatProvider>;
  loadKnowledge: (tenantId: string) => Promise<KnowledgeIndex>;
  search?: PassageSearch;
  overrides?: EmailOverrides;
}

/** Inbound bodies are capped: an email with a larger body is not a person writing. */
const INBOUND_BODY_LIMIT = 10 * 1024 * 1024;

/** What the rest of the server may ask of the email add-on. */
export interface EmailHooks {
  /**
   * Draft the follow-up email for a website lead. Resolves when it is drafted
   * (or skipped); never rejects, because a lead is saved whether or not its
   * email could be written.
   */
  followUpLead(tenant: Tenant, lead: LeadRecord, latestMessage?: string): Promise<void>;
}

export function registerEmailRoutes(app: FastifyInstance, deps: EmailRouteDeps): EmailHooks {
  const { store, tenants, now } = deps;
  const overrides = deps.overrides ?? {};
  const fetchImpl = overrides.fetch ?? fetch;
  const config: EmailAddonConfig = {
    ...loadEmailConfig(process.env, deps.sessionSecret),
    ...overrides.config,
  };

  // Production state lives beside the main store: Firestore on Cloud Run, a
  // file locally. Loaded lazily so a deployment that never uses the add-on
  // never opens a Firestore client for it.
  let statePromise: Promise<EmailStateStore> | null = overrides.state
    ? Promise.resolve(overrides.state)
    : null;
  const getState = (): Promise<EmailStateStore> => {
    statePromise ??= deps.firestore
      ? import('../channels/email/firestore-state.js').then(
          (m) =>
            new m.FirestoreEmailState({
              project: deps.firestore!.project,
              databaseId: deps.firestore!.databaseId,
              emulatorHost: deps.firestore!.emulatorHost ?? null,
            }),
        )
      : Promise.resolve(new FileEmailState(deps.dataDir));
    return statePromise;
  };

  registerEmailTools();

  const core: EmailCore =
    overrides.core ??
    async function* (input) {
      const provider = await deps.getProvider();
      yield* runTurn({
        ...input,
        provider,
        store,
        sunscanConnected: input.tenant.sunscanUrl !== null,
        channel: 'email',
        ...(deps.search ? { search: deps.search } : {}),
      });
    };

  const assistantPromise = (async () => {
    const state = await getState();
    const driveFiles = overrides.driveFiles ?? driveFilesFromEnv(process.env, fetchImpl);
    return new EmailAssistant({
      store,
      state,
      config,
      core,
      loadKnowledge: deps.loadKnowledge,
      mailbox: overrides.mailbox ?? mailboxFromState(state, config, fetchImpl),
      ...(driveFiles ? { driveFiles } : {}),
      now,
    });
  })();
  // A rejected promise nobody awaited yet would be reported as unhandled.
  assistantPromise.catch(() => undefined);

  const followUpPromise = (async () => {
    const state = await getState();
    return new LeadFollowUp({
      store,
      state,
      mailbox: overrides.mailbox ?? mailboxFromState(state, config, fetchImpl),
      provider: deps.getProvider,
      now,
    });
  })();
  followUpPromise.catch(() => undefined);

  async function handle(tenant: Tenant, email: InboundEmail): Promise<EmailResult> {
    const assistant = await assistantPromise;
    try {
      return await assistant.handleInbound(tenant, email);
    } catch (error) {
      if (error instanceof NotEntitledError) throw new ApiError('not_enabled', error.message);
      throw error;
    }
  }

  function publicResult(result: EmailResult) {
    // The provider's response names nothing a webhook sender should learn about
    // the installer beyond what happened to its own message.
    return {
      outcome: result.outcome,
      duplicate: result.duplicate,
      reason: result.reason,
    };
  }

  function parseInbound(request: FastifyRequest): InboundEmail {
    const type = String(request.headers['content-type'] ?? '').toLowerCase();
    try {
      if (type.startsWith('multipart/form-data')) {
        return parseSendGrid(parseMultipartFields(request.body as Buffer, type));
      }
      if (type.startsWith('application/x-www-form-urlencoded')) {
        return parseSendGrid(Object.fromEntries(new URLSearchParams(String(request.body))));
      }
      return parsePostmark(request.body);
    } catch (error) {
      throw new ApiError(
        'bad_request',
        error instanceof Error ? `Unreadable email: ${error.message}` : 'Unreadable email.',
      );
    }
  }

  /** The tenant an address belongs to: its configured inbound address, or `<id>@inbound domain`. */
  function tenantForRecipients(recipients: readonly string[]): Tenant | null {
    for (const recipient of recipients) {
      const address = recipient.trim().toLowerCase();
      for (const tenant of tenants.all) {
        if (tenant.config.email?.inboundAddress?.trim().toLowerCase() === address) return tenant;
      }
      if (config.inboundDomain) {
        const [local, domain] = address.split('@');
        if (domain === config.inboundDomain.toLowerCase() && local) {
          const tenant =
            tenants.all.find(
              (t) => t.id.toLowerCase() === local || t.publicId.toLowerCase() === local,
            ) ?? null;
          if (tenant) return tenant;
        }
      }
    }
    return null;
  }

  // ── inbound webhooks ─────────────────────────────────────────────────────

  void app.register((scope, _options, done) => {
    scope.addContentTypeParser(
      'multipart/form-data',
      { parseAs: 'buffer', bodyLimit: INBOUND_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: INBOUND_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );

    scope.post('/v1/webhooks/inbound-email', { bodyLimit: INBOUND_BODY_LIMIT }, async (request) => {
      if (!config.inboundBasic) {
        throw new ApiError(
          'not_enabled',
          'The shared inbound route is not configured (SUNNY_EMAIL_INBOUND_USER / _PASSWORD).',
        );
      }
      const match = /^Basic\s+(.+)$/i.exec(String(request.headers.authorization ?? ''));
      const decoded = match ? Buffer.from(match[1]!, 'base64').toString('utf8') : '';
      const expected = `${config.inboundBasic.user}:${config.inboundBasic.password}`;
      if (!safeEqual(decoded, expected)) {
        throw new ApiError('unauthorized', 'Webhook credentials are required.');
      }
      const email = parseInbound(request);
      const tenant = tenantForRecipients(email.recipients);
      if (!tenant) throw new ApiError('not_found', 'No installer receives mail at that address.');
      return publicResult(await handle(tenant, email));
    });

    scope.post<{ Params: { tenantId: string; token: string } }>(
      '/v1/webhooks/inbound-email/:tenantId/:token',
      { bodyLimit: INBOUND_BODY_LIMIT },
      async (request) => {
        const { tenantId, token } = request.params;
        // The same refusal for an unknown tenant and a wrong token, so the URL
        // cannot be used to discover which tenant ids exist.
        const tenant = tenants.byId(tenantId);
        if (!tenant || !safeEqual(token, inboundToken(config.webhookSecret, tenantId))) {
          throw new ApiError('unauthorized', 'Unknown inbound address.');
        }
        return publicResult(await handle(tenant, parseInbound(request)));
      },
    );

    scope.post<{ Querystring: { token?: string } }>('/v1/webhooks/gmail-push', async (request) => {
      if (!config.gmailPush) {
        throw new ApiError('not_enabled', 'Gmail push is not configured on this deployment.');
      }
      if (!safeEqual(String(request.query.token ?? ''), config.gmailPush.token)) {
        throw new ApiError('unauthorized', 'A valid push token is required.');
      }
      const body = request.body as { message?: { data?: string } } | null;
      let notice: { emailAddress?: string; historyId?: string | number } = {};
      try {
        notice = JSON.parse(
          Buffer.from(body?.message?.data ?? '', 'base64').toString('utf8'),
        ) as typeof notice;
      } catch {
        throw new ApiError('bad_request', 'The push message is not readable.');
      }
      if (typeof notice.emailAddress !== 'string' || notice.historyId === undefined) {
        throw new ApiError('bad_request', 'The push message names no mailbox.');
      }
      const state = await getState();
      const tenantId = await state.tenantForMailbox(notice.emailAddress);
      const tenant = tenantId ? tenants.byId(tenantId) : null;
      // Acknowledged either way: Pub/Sub redelivers anything not acknowledged,
      // and a mailbox nobody watches any more will never be handled.
      if (!tenant) return { handled: 0 };
      const assistant = await assistantPromise;
      try {
        const results = await assistant.handlePush(tenant, String(notice.historyId));
        return { handled: results.length };
      } catch (error) {
        if (error instanceof NotEntitledError) return { handled: 0 };
        throw error;
      }
    });
    done();
  });

  // ── the installer's settings ─────────────────────────────────────────────

  const auth = createAuthenticator({
    portal: deps.portal,
    sessionSecret: deps.sessionSecret,
    now,
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    store,
  });

  async function member(
    request: FastifyRequest<{ Params: { tenantId: string } }>,
    minimum: MemberRole,
  ): Promise<Tenant> {
    const identity = await auth.identify(request.headers.authorization);
    await requireMembership(store, identity, request.params.tenantId, minimum);
    const tenant = tenants.byId(request.params.tenantId);
    if (!tenant) throw new ApiError('not_found', 'No such installer.');
    if (!isEntitled(tenant, 'email')) {
      throw new ApiError('not_enabled', new NotEntitledError('email').message);
    }
    return tenant;
  }

  function inboundUrl(tenantId: string): string {
    return `${config.publicApiUrl}/v1/webhooks/inbound-email/${encodeURIComponent(tenantId)}/${inboundToken(config.webhookSecret, tenantId)}`;
  }

  app.get<{ Params: { tenantId: string } }>(
    '/v1/portal/tenants/:tenantId/email',
    async (request) => {
      const tenant = await member(request, 'viewer');
      const state = await getState();
      const token = await state.getToken(tenant.id);
      const watch = await state.getWatch(tenant.id);
      const month = new Date(now()).toISOString().slice(0, 7);
      return {
        provider: tenant.config.email?.provider ?? token?.provider ?? 'forwarding',
        connected: token !== null,
        mailbox: token?.mailbox ?? null,
        autoSend: tenant.config.email?.autoSend === true,
        autoReplyCapPerSender: config.autoReplyCapPerSender,
        autoSendThreshold: config.autoSendThreshold,
        inboundAddress:
          tenant.config.email?.inboundAddress ??
          (config.inboundDomain ? `${tenant.id}@${config.inboundDomain}` : null),
        // Only for the installer: anyone holding this URL can deliver mail as if
        // to their inbox, which is why it is shown here and nowhere else.
        inboundWebhookUrl: inboundUrl(tenant.id),
        gmailWatch: watch ? { historyId: watch.historyId, expiration: watch.expiration } : null,
        oauthAvailable: {
          gmail: config.google !== null && config.tokenKey !== null,
          outlook: config.microsoft !== null && config.tokenKey !== null,
        },
        usage: { month, ...(await state.usage(tenant.id, month)) },
      };
    },
  );

  app.post<{ Params: { tenantId: string }; Body: { autoSend?: unknown; provider?: unknown } }>(
    '/v1/portal/tenants/:tenantId/email/settings',
    async (request) => {
      const tenant = await member(request, 'admin');
      const body = request.body ?? {};
      if (body.autoSend !== undefined && typeof body.autoSend !== 'boolean') {
        throw new ApiError('bad_request', 'autoSend must be true or false.');
      }
      const provider = settingsProvider(body.provider);
      const current: EmailChannelConfig = tenant.config.email ?? {
        provider: 'forwarding',
        autoSend: false,
      };
      const next: EmailChannelConfig = {
        ...current,
        ...(typeof body.autoSend === 'boolean' ? { autoSend: body.autoSend } : {}),
        ...(provider ? { provider } : {}),
      };
      await tenants.save({ ...tenant, config: { ...tenant.config, email: next } });
      return { email: next };
    },
  );

  app.post<{ Params: { tenantId: string }; Body: { provider?: unknown } }>(
    '/v1/portal/tenants/:tenantId/email/connect',
    async (request) => {
      const tenant = await member(request, 'admin');
      const provider = (request.body?.provider ?? 'gmail') as MailProvider;
      if (provider !== 'gmail' && provider !== 'outlook') {
        throw new ApiError('bad_request', 'provider must be gmail or outlook.');
      }
      const client = provider === 'gmail' ? config.google : config.microsoft;
      if (!client || !config.tokenKey) {
        throw new ApiError(
          'not_enabled',
          `Connecting ${provider === 'gmail' ? 'Gmail' : 'Outlook'} is not configured on this deployment.`,
        );
      }
      const state = signState(deps.sessionSecret, {
        tenantId: tenant.id,
        provider,
        returnTo: '/settings/email',
        exp: now() + 10 * 60 * 1000,
      });
      return { url: authorizeUrl(provider, client, state) };
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/v1/email/oauth/callback',
    async (request, reply) => {
      const back = (query: string) =>
        reply.redirect(`${config.dashboardUrl}/dashboard/settings/email?${query}`);
      const state = verifyState(deps.sessionSecret, String(request.query.state ?? ''), now());
      if (!state) return back('email=invalid_state');
      if (request.query.error || !request.query.code) return back('email=denied');
      const tenant = tenants.byId(state.tenantId);
      if (!tenant || !isEntitled(tenant, 'email')) return back('email=not_enabled');
      const client = state.provider === 'gmail' ? config.google : config.microsoft;
      if (!client || !config.tokenKey) return back('email=not_configured');
      let grant;
      try {
        grant = await exchangeCode(state.provider, client, request.query.code, fetchImpl);
      } catch {
        return back('email=exchange_failed');
      }
      if (!grant.refreshToken) return back('email=no_refresh_token');
      let mailbox: string | null = null;
      if (state.provider === 'gmail') {
        try {
          const gmail = new GmailClient(() => Promise.resolve(grant.accessToken), fetchImpl);
          mailbox = (await gmail.profile()).emailAddress.toLowerCase();
        } catch {
          mailbox = null;
        }
      }
      const emailState = await getState();
      await emailState.putToken(tenant.id, {
        provider: state.provider,
        ciphertext: encryptSecret(config.tokenKey, grant.refreshToken),
        mailbox,
        scopes: grant.scopes,
        connectedAt: new Date(now()).toISOString(),
      });
      const saved = await tenants.save({
        ...tenant,
        config: {
          ...tenant.config,
          email: {
            ...(tenant.config.email ?? { autoSend: false }),
            provider: state.provider,
            // A reference to where the token is, never the token.
            tokenRef: `email-state:${tenant.id}`,
          },
        },
      });
      // A connected Gmail is watched at once: without the watch, no new mail
      // ever reaches Sunny, and the dashboard had no other way to start one.
      if (state.provider === 'gmail' && config.gmailPush) {
        try {
          await startWatch(saved);
        } catch {
          return back('email=connected_not_watching');
        }
      }
      return back('email=connected');
    },
  );

  app.post<{ Params: { tenantId: string } }>(
    '/v1/portal/tenants/:tenantId/email/disconnect',
    async (request) => {
      const tenant = await member(request, 'admin');
      await (await getState()).deleteToken(tenant.id);
      const { tokenRef: _tokenRef, ...rest } = tenant.config.email ?? {
        provider: 'forwarding' as const,
        autoSend: false,
      };
      await tenants.save({
        ...tenant,
        config: { ...tenant.config, email: { ...rest, autoSend: false } },
      });
      return { connected: false };
    },
  );

  /** Ask Gmail to tell the push topic about new mail in the tenant's connected mailbox. */
  async function startWatch(tenant: Tenant) {
    if (!config.gmailPush) {
      throw new ApiError('not_enabled', 'Gmail push is not configured on this deployment.');
    }
    const state = await getState();
    const token = await state.getToken(tenant.id);
    if (token?.provider !== 'gmail' || !config.google || !config.tokenKey) {
      throw new ApiError('bad_request', 'Connect a Gmail mailbox first.');
    }
    const gmail =
      (overrides.mailbox ? await overrides.mailbox(tenant) : null) ??
      new GmailClient(
        refreshingToken(
          'gmail',
          config.google,
          decryptSecret(config.tokenKey, token.ciphertext),
          fetchImpl,
        ),
        fetchImpl,
      );
    if (!gmail.watch || !gmail.profile)
      throw new ApiError('bad_request', 'This mailbox cannot be watched.');
    const profile = await gmail.profile();
    const watch = await gmail.watch(config.gmailPush.topic);
    await state.putWatch(tenant.id, {
      mailbox: profile.emailAddress,
      historyId: watch.historyId,
      expiration: watch.expiration,
    });
    return { watching: profile.emailAddress.toLowerCase(), expiration: watch.expiration };
  }

  app.post<{ Params: { tenantId: string } }>(
    '/v1/portal/tenants/:tenantId/email/watch',
    async (request) => startWatch(await member(request, 'admin')),
  );

  app.get<{ Params: { tenantId: string; sessionId: string } }>(
    '/v1/portal/tenants/:tenantId/email/threads/:sessionId',
    async (request) => {
      const tenant = await member(request, 'viewer');
      const link = await (await getState()).getThread(tenant.id, request.params.sessionId);
      if (!link) throw new ApiError('not_found', 'No email draft for that conversation.');
      return link;
    },
  );

  return {
    async followUpLead(tenant, lead, latestMessage) {
      try {
        const followUp = await followUpPromise;
        await followUp.draft({ tenant, lead, ...(latestMessage ? { latestMessage } : {}) });
      } catch (error) {
        app.log.error({ err: error, leadId: lead.id }, 'lead follow-up email failed');
      }
    },
  };
}

const PROVIDERS: readonly EmailChannelConfig['provider'][] = ['gmail', 'outlook', 'forwarding'];

/** The provider a settings request named, validated; undefined when it named none. */
function settingsProvider(value: unknown): EmailChannelConfig['provider'] | undefined {
  if (value === undefined) return undefined;
  const found = PROVIDERS.find((p) => p === value);
  if (!found) throw new ApiError('bad_request', 'provider must be gmail, outlook or forwarding.');
  return found;
}
