import { randomBytes } from 'node:crypto';

import { ApiError } from '@sunny/contracts';
import { toRoofAssessmentSummary, type SunScanService } from '@sunny/sunscan-adapter';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  createAuthenticator,
  requireMembership,
  roleAtLeast,
  verifySignInProof,
} from '../auth/index.js';
import { issueInviteToken, verifyInviteToken } from '../auth/invite.js';
import {
  issueSessionToken,
  SESSION_PREFIX,
  SessionError,
  verifySessionToken,
} from '../auth/session.js';
import type { VerifiedIdentity } from '../auth/firebase.js';
import { issueDevToken } from '../auth/dev.js';
import { createCheckoutSession, createPortalSession } from '../billing/stripe-api.js';
import { SignatureError, verifyStripeSignature } from '../billing/signature.js';
import { applyStripeEvent, type StripeEvent } from '../billing/webhook.js';
import { ADDON_KEYS, hasEntitlement } from '../entitlements.js';
import {
  LEAD_STATUSES,
  MEMBER_ROLES,
  type Conversation,
  type LeadRecord,
  type Membership,
  type Store,
} from '../store.js';
import { JOURNEY_KEYS } from '../journey/journey.js';
import { ONBOARDING_STEPS, type Tenant, type TenantRegistry } from '../tenants.js';
import type { VoiceUsageLedger } from '../channels/voice/usage.js';
import type { PortalConfig } from './portal-config.js';

/**
 * The installer portal API (Blueprint §3.1, §5; plan §6.3–6.4).
 *
 * Everything under `/v1/portal/tenants/:tenantId` is behind a signed-in
 * identity and a membership of that tenant, checked on every request. The
 * tenant id is taken from the path and then *authorised*, never trusted: a
 * member of one installer asking for another's id gets the same 404 as an id
 * that does not exist.
 */

/**
 * How the portal reaches the knowledge pipeline. The ingestion workstream
 * provides it; without one, connecting a source records it as pending and the
 * portal says so rather than pretending a sync ran.
 */
export interface KnowledgeSyncConnector {
  syncWebsite?: (tenant: Tenant, url: string) => Promise<{ jobId: string | null }>;
  syncDrive?: (tenant: Tenant, folderId: string) => Promise<{ jobId: string | null }>;
}

export interface PortalDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
  knowledgeSync?: KnowledgeSyncConnector;
  /** The voice add-on's minutes ledger, for usage against quota on the billing page. */
  voiceUsage?: VoiceUsageLedger;
  /** The SunScan service, for the installer's 3D view of a lead's roof. */
  sunscan?: SunScanService | null;
  fetch?: typeof fetch;
}

const PLAN_KEYS = ['base', 'email', 'voice', 'suite'] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, 'must be a domain like example.co.uk');

const signupSchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  websiteUrl: z.string().trim().url().max(500).optional(),
});

const settingsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(120),
    tagline: z.string().trim().max(200).nullable(),
    greeting: z.string().trim().min(1).max(300),
    primaryColor: hex,
    position: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']),
    suggestions: z.array(z.string().trim().min(1).max(120)).max(6),
    websiteUrl: z.string().trim().url().max(500).nullable(),
    domains: z.array(domain).max(20),
    supportContact: z.object({
      phone: z.string().trim().max(40).optional(),
      email: z.string().trim().email().max(200).optional(),
      hours: z.string().trim().max(200).optional(),
    }),
    onboardingStep: z.enum(ONBOARDING_STEPS),
    email: z
      .object({
        provider: z.enum(['gmail', 'outlook', 'forwarding']),
        inboundAddress: z.string().trim().email().max(200),
        autoSend: z.boolean(),
        signatureName: z.string().trim().max(120),
      })
      .partial(),
    voice: z.object({
      voiceName: z.string().trim().max(80).optional(),
      maxCallSeconds: z.number().int().min(30).max(300).default(300),
      concurrency: z.number().int().min(1).max(10).default(2),
      bookingUrl: z.string().trim().url().max(500).optional(),
      disclosure: z.string().trim().min(10).max(400).optional(),
    }),
  })
  .partial();

const driveSchema = z.object({ folder: z.string().trim().min(1).max(500) });
const websiteSchema = z.object({ url: z.string().trim().url().max(500) });
const leadStatusSchema = z.object({ status: z.enum(LEAD_STATUSES) });
const memberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(MEMBER_ROLES),
});
const removeMemberSchema = z.object({ email: z.string().trim().toLowerCase().email() });
const planSchema = z.object({ plan: z.enum(PLAN_KEYS) });
const devLoginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
const sessionSchema = z.object({ idToken: z.string().min(10).max(8192) });
const inviteAcceptSchema = z.object({ token: z.string().min(10).max(2048) });

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiError(
      'bad_request',
      `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`,
    );
  }
  return result.data as z.infer<S>;
}

function randomId(prefix: string, length = 14): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  return prefix + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** A Drive folder id from either the id or a folder URL. */
export function driveFolderId(input: string): string | null {
  const fromUrl = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(input);
  if (fromUrl) return fromUrl[1]!;
  return /^[A-Za-z0-9_-]{10,}$/.test(input) ? input : null;
}

function assessmentIdOf(lead: LeadRecord): string | null {
  const record = lead as LeadRecord & { assessmentId?: unknown; sunscanAssessmentId?: unknown };
  const id = record.sunscanAssessmentId ?? record.assessmentId;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** Defuse spreadsheet formulas and quote a CSV field. */
export function csvField(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The conversation's channel, intent and safety escalation. The core records
 * these per turn (a conversation can turn from a sales question into a support
 * one); the inbox shows the latest intent, and any escalation in the thread.
 */
function conversationChannel(c: Conversation): 'chat' | 'voice' | 'email' {
  return c.channel ?? c.turns.find((t) => t.channel)?.channel ?? 'chat';
}

function conversationIntent(c: Conversation): 'sales' | 'support' | null {
  for (let i = c.turns.length - 1; i >= 0; i--) {
    const intent = c.turns[i]?.intent;
    if (intent) return intent;
  }
  return c.intent ?? null;
}

function conversationEscalation(
  c: Conversation,
): { kind: 'safety'; reason: string; at: string } | null {
  if (c.escalation) return c.escalation;
  const index = c.turns.findIndex((t) => t.escalation === 'safety');
  if (index === -1) return null;
  const turn = c.turns[index]!;
  // The visitor's own words are the reason: the turn that raised it, or the
  // visitor message just before the assistant turn that flagged it.
  const said =
    turn.role === 'user'
      ? turn
      : ([...c.turns.slice(0, index)].reverse().find((t) => t.role === 'user') ?? turn);
  const reason = said.text.length > 160 ? `${said.text.slice(0, 159)}…` : said.text;
  return { kind: 'safety', reason, at: turn.at };
}

function preview(c: Conversation): string {
  const lastUser = [...c.turns].reverse().find((t) => t.role === 'user');
  const text = (lastUser ?? c.turns[c.turns.length - 1])?.text ?? '';
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

function placeholderWarnings(
  source: unknown,
): Array<{ kind: string; text: string; section: string | null }> {
  const warnings = (source as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings
    .filter((w): w is Record<string, unknown> => typeof w === 'object' && w !== null)
    .map((w) => ({
      kind: typeof w['kind'] === 'string' ? w['kind'] : 'warning',
      text: typeof w['text'] === 'string' ? w['text'] : '',
      section: typeof w['section'] === 'string' ? w['section'] : null,
    }));
}

/** Whether each add-on's channel is actually connected, beside whether it is paid for. */
function connections(tenant: Tenant) {
  const email = tenant.config.email;
  const voice = tenant.config.voice;
  return {
    web_chat: { connected: (tenant.domains ?? []).length > 0, detail: 'Widget domain registered' },
    email_assistant: {
      connected: Boolean(
        email && (email.provider === 'forwarding' ? email.inboundAddress : email.tokenRef),
      ),
      detail: email
        ? email.provider === 'forwarding'
          ? `Forwarding${email.inboundAddress ? ` to ${email.inboundAddress}` : ' (no address yet)'}`
          : `${email.provider === 'gmail' ? 'Gmail' : 'Outlook'} ${email.tokenRef ? 'connected' : 'not connected'}`
        : 'No inbox connected',
      autoSend: email?.autoSend ?? false,
    },
    voice_widget: {
      connected: true,
      detail: 'Nothing to connect: a microphone button appears in the widget',
    },
    phone_agent: {
      connected: (voice?.twilioNumbers ?? []).length > 0,
      detail:
        (voice?.twilioNumbers ?? []).length > 0
          ? `Number ${voice!.twilioNumbers!.join(', ')}`
          : 'No phone number assigned',
    },
  };
}

function installSnippet(portal: PortalConfig, tenant: Tenant): string {
  return (
    `<script src="${portal.widgetScriptUrl}"\n` +
    `  data-widget-id="${tenant.publicId}"\n` +
    `  data-api-url="${portal.publicApiUrl}"\n` +
    `  async></script>`
  );
}

/** The tenant as the portal shows it: no internal-only fields beyond what an installer may see. */
function tenantView(tenant: Tenant, portal: PortalConfig, role: Membership['role'], now: number) {
  return {
    id: tenant.id,
    publicId: tenant.publicId,
    role,
    companyName: tenant.config.companyName,
    tagline: tenant.config.tagline,
    greeting: tenant.config.greeting,
    primaryColor: tenant.config.primaryColor,
    position: tenant.config.position,
    suggestions: tenant.config.suggestions,
    supportContact: tenant.config.supportContact ?? null,
    websiteUrl: tenant.websiteUrl ?? null,
    gdriveFolderId: tenant.gdriveFolderId ?? null,
    domains: tenant.domains ?? [],
    onboarding: tenant.onboarding ?? { step: 'live', completedAt: null },
    addons: Object.fromEntries(ADDON_KEYS.map((key) => [key, hasEntitlement(tenant, key, now)])),
    billing: tenant.billing ?? null,
    email: tenant.config.email ?? null,
    voice: tenant.config.voice ?? null,
    connections: connections(tenant),
    installSnippet: installSnippet(portal, tenant),
  };
}

export function registerPortalRoutes(app: FastifyInstance, deps: PortalDeps): void {
  const { store, tenants, portal, now } = deps;

  /**
   * The roof assessment behind a lead: on the lead itself when the SunScan
   * integration put it there, otherwise the one the visitor's quote journey ran
   * in the same conversation.
   */
  async function leadAssessmentId(tenantId: string, lead: LeadRecord): Promise<string | null> {
    const direct = assessmentIdOf(lead);
    if (direct) return direct;
    const conversation = await store.getConversation(tenantId, lead.sessionId);
    const fromJourney = conversation?.answers?.[JOURNEY_KEYS.assessmentId];
    return typeof fromJourney === 'string' && fromJourney !== '' ? fromJourney : null;
  }
  const auth = createAuthenticator({
    portal,
    sessionSecret: deps.sessionSecret,
    now,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    store: deps.store,
  });

  async function identify(request: FastifyRequest): Promise<VerifiedIdentity> {
    return await auth.identify(request.headers.authorization);
  }

  /** Authenticate, authorise for the path's tenant, and load it. */
  async function member(
    request: FastifyRequest,
    minimum: Membership['role'],
  ): Promise<{ identity: VerifiedIdentity; membership: Membership; tenant: Tenant }> {
    const identity = await identify(request);
    const { tenantId } = request.params as { tenantId: string };
    const membership = await requireMembership(store, identity, tenantId, minimum);
    const tenant = tenants.byId(tenantId);
    if (!tenant) throw new ApiError('not_found', 'No such installer.');
    return { identity, membership, tenant };
  }

  // ── sign-in ──────────────────────────────────────────────────────────────

  app.get('/v1/portal/auth-config', () =>
    Promise.resolve({ devAuth: portal.devAuth, firebaseProjectId: portal.firebaseProjectId }),
  );

  app.post('/v1/portal/dev-login', (request) => {
    if (!portal.devAuth) {
      throw new ApiError('not_enabled', 'Development sign-in is disabled on this deployment.');
    }
    const { email } = parse(devLoginSchema, request.body);
    const token = issueDevToken(deps.sessionSecret, email, now());
    return Promise.resolve({
      token,
      // What a real magic link would carry; dev mode hands it straight back.
      magicLink: `${portal.dashboardUrl}/sign-in?token=${encodeURIComponent(token)}`,
    });
  });

  // ── portal sessions (the website's HttpOnly cookie carries these) ────────

  /**
   * Trade a sign-in proof (a Firebase ID token, or a dev token where dev
   * sign-in is on) for a short-lived Sunny session. Only a verified email gets
   * one: the authenticator refuses unverified Firebase accounts.
   */
  app.post('/v1/portal/session', async (request) => {
    const { idToken } = parse(sessionSchema, request.body);
    const identity = await verifySignInProof(auth, idToken);
    if (!identity.email) throw new ApiError('unauthorized', 'A verified email is required.');
    const { token, claims } = issueSessionToken(
      deps.sessionSecret,
      { uid: identity.uid, email: identity.email },
      now(),
    );
    return { token, expiresAt: claims.exp, user: { uid: claims.uid, email: claims.email } };
  });

  /** Re-issue a live session before it expires, keeping its original sign-in time. */
  app.post('/v1/portal/session/refresh', async (request) => {
    const raw = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1]?.trim() ?? '';
    if (!raw.startsWith(SESSION_PREFIX)) {
      throw new ApiError('unauthorized', 'Sign in to use the portal.');
    }
    let claims;
    try {
      claims = verifySessionToken(deps.sessionSecret, raw, now());
    } catch (error) {
      throw new ApiError(
        'unauthorized',
        error instanceof SessionError ? `Your session ended: ${error.message}.` : 'Sign in again.',
      );
    }
    if (claims.iat < (await store.getSessionEpoch(claims.email))) {
      throw new ApiError('unauthorized', 'Your session ended: this session was signed out.');
    }
    const next = issueSessionToken(deps.sessionSecret, claims, now(), claims.auth);
    return {
      token: next.token,
      expiresAt: next.claims.exp,
      user: { uid: claims.uid, email: claims.email },
    };
  });

  /** Sign out everywhere: every session issued before now is refused. */
  app.post('/v1/portal/sessions/revoke', async (request) => {
    const identity = await identify(request);
    if (!identity.email) throw new ApiError('unauthorized', 'Sign in to use the portal.');
    // One millisecond on, so the token used for this request is itself revoked.
    await store.revokeSessions(identity.email, now() + 1);
    return { revoked: true };
  });

  // ── team invitations ─────────────────────────────────────────────────────

  /** Public preview of an invitation, for the accept page. Reveals no more than the link holder knows. */
  // The token travels in the query/body rather than the path: it is longer
  // than the router's path-parameter limit.
  app.get('/v1/portal/invite', async (request) => {
    const raw = (request.query as { token?: unknown }).token;
    const token = typeof raw === 'string' ? raw : '';
    const invite = readInvite(token);
    const tenant = tenants.byId(invite.tenantId);
    const pending = tenant
      ? (await store.listMembers(tenant.id)).find((m) => m.email === invite.email)
      : undefined;
    if (!tenant || !pending) throw new ApiError('not_found', 'This invitation is no longer valid.');
    return {
      companyName: tenant.config.companyName,
      email: invite.email,
      role: pending.role,
      accepted: pending.userId !== null,
    };
  });

  /** Accept: the signed-in person must be the invited email. */
  app.post('/v1/portal/invite/accept', async (request) => {
    const identity = await identify(request);
    const { token } = parse(inviteAcceptSchema, request.body);
    const invite = readInvite(token);
    if (!identity.email || identity.email !== invite.email) {
      throw new ApiError(
        'forbidden',
        `This invitation is for ${invite.email}. Sign in with that address to accept it.`,
      );
    }
    const membership = await requireMembership(store, identity, invite.tenantId, 'viewer');
    return { tenantId: membership.tenantId, role: membership.role };
  });

  function readInvite(token: string) {
    try {
      return verifyInviteToken(deps.sessionSecret, token, now());
    } catch {
      throw new ApiError('not_found', 'This invitation is no longer valid.');
    }
  }

  app.get('/v1/portal/me', async (request) => {
    const identity = await identify(request);
    const memberships = identity.email ? await store.listMembershipsByEmail(identity.email) : [];
    return {
      user: { uid: identity.uid, email: identity.email },
      tenants: memberships
        .map((m) => {
          const tenant = tenants.byId(m.tenantId);
          return tenant
            ? { id: tenant.id, companyName: tenant.config.companyName, role: m.role }
            : null;
        })
        .filter((row) => row !== null),
    };
  });

  // ── sign-up: a new installer and its owner ───────────────────────────────

  app.post('/v1/portal/tenants', async (request, reply) => {
    const identity = await identify(request);
    if (!identity.email) throw new ApiError('forbidden', 'A verified email is required.');
    const body = parse(signupSchema, request.body);
    const at = new Date(now()).toISOString();
    const publicId = randomId('w_');
    const tenant: Tenant = {
      id: randomId('t_'),
      publicId,
      sunscanSlug: null,
      sunscanUrl: null,
      websiteUrl: body.websiteUrl ?? null,
      gdriveFolderId: null,
      stripeCustomerId: null,
      domains: [],
      config: {
        publicId,
        companyName: body.companyName,
        tagline: 'Ask me anything about solar for your home',
        primaryColor: '#FF7900',
        position: 'bottom-right',
        greeting: `Hi, I'm Sunny from ${body.companyName}. Ask me about solar for your home, or about your system.`,
        suggestions: [
          'How much could I save?',
          'Is my roof suitable?',
          'Do you offer batteries?',
          'I need help with my system',
        ],
        intensity: 'balanced',
        voiceEnabled: false,
        // The base package starts as a trial; billing switches the rest.
        addons: { web_chat: true },
      },
      billing: { status: 'trialing', subscriptionId: null, graceUntil: null, lastEventAt: null },
      onboarding: { step: 'website', completedAt: null },
      createdAt: at,
    };
    const saved = await tenants.save(tenant);
    await store.putMembership({
      tenantId: saved.id,
      email: identity.email,
      userId: identity.uid,
      role: 'owner',
      invitedBy: null,
      createdAt: at,
    });
    reply.code(201);
    return { tenant: tenantView(saved, portal, 'owner', now()) };
  });

  // ── one installer ────────────────────────────────────────────────────────

  app.get('/v1/portal/tenants/:tenantId', async (request) => {
    const { membership, tenant } = await member(request, 'viewer');
    return { tenant: tenantView(tenant, portal, membership.role, now()) };
  });

  app.post('/v1/portal/tenants/:tenantId/settings', async (request) => {
    const { membership, tenant } = await member(request, 'admin');
    const body = parse(settingsSchema, request.body);
    const config = { ...tenant.config };
    if (body.companyName !== undefined) config.companyName = body.companyName;
    if (body.tagline !== undefined) config.tagline = body.tagline;
    if (body.greeting !== undefined) config.greeting = body.greeting;
    if (body.primaryColor !== undefined) config.primaryColor = body.primaryColor.toUpperCase();
    if (body.position !== undefined) config.position = body.position;
    if (body.suggestions !== undefined) config.suggestions = body.suggestions;
    if (body.supportContact !== undefined) {
      const contact = Object.fromEntries(
        Object.entries(body.supportContact).filter(([, v]) => v !== undefined && v !== ''),
      );
      config.supportContact = contact;
    }
    if (body.email !== undefined) {
      // Merged over what is there: the OAuth token reference is written by the
      // connect flow (routes/email.ts), never by a form, and a partial update
      // must not reset auto-send.
      const current = tenant.config.email ?? { provider: 'forwarding' as const, autoSend: false };
      const { signatureName, ...rest } = body.email;
      const merged = { ...current, ...rest };
      if (signatureName !== undefined) {
        if (signatureName === '') delete merged.signatureName;
        else merged.signatureName = signatureName;
      }
      config.email = merged;
    }
    if (body.voice !== undefined) {
      // Numbers are assigned when a Twilio number is provisioned, not typed in.
      config.voice = {
        ...body.voice,
        ...(tenant.config.voice?.twilioNumbers
          ? { twilioNumbers: tenant.config.voice.twilioNumbers }
          : {}),
      };
    }
    const next: Tenant = { ...tenant, config };
    if (body.websiteUrl !== undefined) next.websiteUrl = body.websiteUrl;
    if (body.domains !== undefined) next.domains = [...new Set(body.domains)];
    // The site the installer connects is where the widget will live, so its
    // host is registered as a widget domain too (without the "www." so the bare
    // domain and its subdomains both match). Explicit domains are kept.
    const siteHost = hostOf(next.websiteUrl);
    if (siteHost && !(next.domains ?? []).includes(siteHost)) {
      next.domains = [...(next.domains ?? []), siteHost];
    }
    if (body.onboardingStep !== undefined) {
      next.onboarding = {
        step: body.onboardingStep,
        completedAt:
          body.onboardingStep === 'live'
            ? (tenant.onboarding?.completedAt ?? new Date(now()).toISOString())
            : (tenant.onboarding?.completedAt ?? null),
      };
    }
    const saved = await tenants.save(next);
    return { tenant: tenantView(saved, portal, membership.role, now()) };
  });

  app.get('/v1/portal/tenants/:tenantId/overview', async (request) => {
    const { tenant } = await member(request, 'viewer');
    const [conversations, leads, statuses, sources] = await Promise.all([
      store.listConversations(tenant.id),
      store.listAllLeads(tenant.id),
      store.listLeadStatuses(tenant.id),
      store.listKnowledgeSources(tenant.id),
    ]);
    const since = now() - 30 * 86_400_000;
    const byChannel = { chat: 0, voice: 0, email: 0 };
    const byIntent = { sales: 0, support: 0, unclassified: 0 };
    let escalations = 0;
    for (const c of conversations) {
      byChannel[conversationChannel(c)] += 1;
      const intent = conversationIntent(c);
      byIntent[intent ?? 'unclassified'] += 1;
      if (conversationEscalation(c)) escalations += 1;
    }
    const placeholders = sources.reduce((n, s) => n + placeholderWarnings(s).length, 0);
    const warnings: Array<{ id: string; text: string; href: string }> = [];
    const contact = tenant.config.supportContact;
    if (!contact?.phone) {
      warnings.push({
        id: 'support-contact',
        text: 'Add your installer phone number. Sunny gives it to customers who need help, including anyone reporting a safety issue.',
        href: '/dashboard/settings',
      });
    }
    if (!tenant.websiteUrl) {
      warnings.push({
        id: 'website',
        text: 'Connect your website so Sunny can answer from it.',
        href: '/dashboard/knowledge',
      });
    }
    if ((tenant.domains ?? []).length === 0) {
      warnings.push({
        id: 'domains',
        text: 'Add the domain your website runs on, so the widget only works there.',
        href: '/dashboard/settings',
      });
    }
    if (placeholders > 0) {
      warnings.push({
        id: 'knowledge-placeholders',
        text: `${placeholders} unfinished item${placeholders === 1 ? '' : 's'} in your knowledge base (placeholders or to-dos).`,
        href: '/dashboard/knowledge',
      });
    }
    return {
      conversations: {
        total: conversations.length,
        last30Days: conversations.filter((c) => Date.parse(c.createdAt) >= since).length,
        byChannel,
        byIntent,
        escalations,
      },
      leads: {
        total: leads.length,
        new: leads.filter((l) => (statuses[l.id] ?? 'new') === 'new').length,
        last30Days: leads.filter((l) => Date.parse(l.createdAt) >= since).length,
      },
      knowledge: { sources: sources.length, placeholders },
      warnings,
    };
  });

  // ── unified inbox ────────────────────────────────────────────────────────

  app.get('/v1/portal/tenants/:tenantId/inbox', async (request) => {
    const { tenant } = await member(request, 'viewer');
    const query = request.query as { channel?: string; intent?: string; escalated?: string };
    const [conversations, leads, statuses] = await Promise.all([
      store.listConversations(tenant.id),
      store.listAllLeads(tenant.id),
      store.listLeadStatuses(tenant.id),
    ]);
    const leadBySession = new Map<string, LeadRecord>();
    for (const lead of leads) leadBySession.set(lead.sessionId, lead);
    const rows = conversations
      .filter((c) => !query.channel || conversationChannel(c) === query.channel)
      .filter((c) => !query.intent || conversationIntent(c) === query.intent)
      .filter((c) => query.escalated !== '1' || conversationEscalation(c) !== null)
      .map((c) => {
        const lead = leadBySession.get(c.sessionId);
        return {
          id: c.id,
          channel: conversationChannel(c),
          intent: conversationIntent(c),
          escalation: conversationEscalation(c),
          startedAt: c.createdAt,
          updatedAt: c.updatedAt,
          messages: c.turns.length,
          preview: preview(c),
          lead: lead ? { id: lead.id, name: lead.name, status: statuses[lead.id] ?? 'new' } : null,
        };
      })
      // Safety escalations first, then the most recent.
      .sort((a, b) => {
        if (Boolean(a.escalation) !== Boolean(b.escalation)) return a.escalation ? -1 : 1;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
    return { conversations: rows };
  });

  app.get('/v1/portal/tenants/:tenantId/inbox/:conversationId', async (request) => {
    const { tenant } = await member(request, 'viewer');
    const { conversationId } = request.params as { conversationId: string };
    const conversation = (await store.listConversations(tenant.id)).find(
      (c) => c.id === conversationId,
    );
    if (!conversation) throw new ApiError('not_found', 'No such conversation.');
    return {
      conversation: {
        id: conversation.id,
        sessionId: conversation.sessionId,
        channel: conversationChannel(conversation),
        intent: conversationIntent(conversation),
        escalation: conversationEscalation(conversation),
        startedAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        answers: conversation.answers ?? {},
        turns: conversation.turns.map((t) => ({
          role: t.role,
          text: t.text,
          at: t.at,
          escalation: t.escalation === 'safety',
        })),
      },
    };
  });

  // ── leads ────────────────────────────────────────────────────────────────

  async function leadRows(tenantId: string) {
    const [leads, statuses] = await Promise.all([
      store.listAllLeads(tenantId),
      store.listLeadStatuses(tenantId),
    ]);
    const rows = await Promise.all(
      leads.map(async (lead) => ({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        postcode: lead.postcode,
        summary: lead.summary,
        createdAt: lead.createdAt,
        conversationId: lead.conversationId,
        status: statuses[lead.id] ?? 'new',
        // The lead's own link, or the roof the visitor's quote journey measured.
        assessmentId: await leadAssessmentId(tenantId, lead),
      })),
    );
    return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  app.get('/v1/portal/tenants/:tenantId/leads', async (request) => {
    const { tenant } = await member(request, 'viewer');
    return { leads: await leadRows(tenant.id) };
  });

  /**
   * The quote a lead was given in the chat (the quote journey), for the lead's
   * page: the options shown, the recommended one, line items and the
   * "indicative" basis. Prefers the quote the visitor attached to their lead;
   * otherwise the latest quote from the same conversation.
   */
  app.get('/v1/portal/tenants/:tenantId/leads/:leadId/quote', async (request) => {
    const { tenant } = await member(request, 'viewer');
    const { leadId } = request.params as { leadId: string };
    const lead = (await store.listAllLeads(tenant.id)).find((l) => l.id === leadId);
    if (!lead) throw new ApiError('not_found', 'No such lead.');
    const quotes = await store.listQuotes(tenant.id, lead.sessionId);
    const quote = quotes.filter((q) => q.leadId === lead.id).at(-1) ?? quotes.at(-1) ?? null;
    return { quote };
  });

  /**
   * The roof assessment behind a lead, as the installer sees it: the summary
   * (planes, usable area, confidence) rather than the raw record. The visitor
   * route (`/v1/sunscan/assessments/:id`) answers only the visitor's session.
   */
  app.get('/v1/portal/tenants/:tenantId/leads/:leadId/assessment', async (request) => {
    const { tenant } = await member(request, 'viewer');
    const { leadId } = request.params as { leadId: string };
    const lead = (await store.listAllLeads(tenant.id)).find((l) => l.id === leadId);
    if (!lead) throw new ApiError('not_found', 'No such lead.');
    const assessmentId = await leadAssessmentId(tenant.id, lead);
    if (!assessmentId) return { assessment: null, status: null };
    const record = await store.getSunScanAssessment(tenant.id, assessmentId);
    if (!record) return { assessment: null, status: null };
    return {
      assessment: toRoofAssessmentSummary(record),
      status: record.status,
      // The 3D view needs the model description; the GLB is the download.
      modelAvailable: deps.sunscan != null && record.artefacts.includes('spec.json'),
    };
  });

  /**
   * The lead's 3D model, for the installer: the model description the viewer
   * rebuilds the house from, and the binary glTF for download. Tenant-scoped
   * through the lead -- an assessment id alone opens nothing -- and any miss
   * (no lead, no assessment, another installer's, not built yet) is the same
   * `not_found`.
   */
  for (const [name, type] of [
    ['spec.json', 'application/json; charset=utf-8'],
    ['model.glb', 'model/gltf-binary'],
  ] as const) {
    app.get(
      `/v1/portal/tenants/:tenantId/leads/:leadId/assessment/${name}`,
      async (request, reply) => {
        const { tenant } = await member(request, 'viewer');
        const { leadId } = request.params as { leadId: string };
        const lead = (await store.listAllLeads(tenant.id)).find((l) => l.id === leadId);
        const assessmentId = lead ? await leadAssessmentId(tenant.id, lead) : null;
        const record = assessmentId
          ? await store.getSunScanAssessment(tenant.id, assessmentId)
          : null;
        const bytes =
          record && deps.sunscan && record.artefacts.includes(name)
            ? await deps.sunscan.getArtefact(tenant.id, record.id, name)
            : null;
        if (!bytes) throw new ApiError('not_found', 'No 3D model for this lead.');
        void reply
          .header('content-type', type)
          .header('cache-control', 'private, max-age=3600')
          .header(
            'content-disposition',
            name === 'model.glb' ? 'attachment; filename="roof-model.glb"' : 'inline',
          );
        return reply.send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      },
    );
  }

  app.get('/v1/portal/tenants/:tenantId/leads.csv', async (request, reply) => {
    const { tenant } = await member(request, 'sales');
    const rows = await leadRows(tenant.id);
    const header = ['created', 'status', 'name', 'email', 'phone', 'postcode', 'summary'];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [r.createdAt, r.status, r.name, r.email, r.phone, r.postcode, r.summary]
          .map(csvField)
          .join(','),
      ),
    ];
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="sunny-leads.csv"`);
    return `${lines.join('\n')}\n`;
  });

  app.post('/v1/portal/tenants/:tenantId/leads/:leadId/status', async (request) => {
    const { tenant } = await member(request, 'sales');
    const { leadId } = request.params as { leadId: string };
    const { status } = parse(leadStatusSchema, request.body);
    const leads = await store.listAllLeads(tenant.id);
    if (!leads.some((l) => l.id === leadId)) throw new ApiError('not_found', 'No such lead.');
    await store.setLeadStatus(tenant.id, leadId, status);
    return { id: leadId, status };
  });

  // ── knowledge sources ────────────────────────────────────────────────────

  app.get('/v1/portal/tenants/:tenantId/knowledge', async (request) => {
    const { tenant } = await member(request, 'viewer');
    const sources = await store.listKnowledgeSources(tenant.id);
    // A sync recorded as running is checked against its job, so the page shows
    // how far it has got, and whether it finished or failed -- the tenant
    // record alone only knows that one was started.
    const connection = async (kind: 'website' | 'drive', configured: string | null) => {
      if (!configured)
        return {
          status: 'disconnected' as const,
          target: null,
          at: null,
          error: null,
          progress: null,
        };
      const sync = tenant.sync?.[kind];
      const job =
        sync?.status === 'syncing' && sync.jobId
          ? await store.getIngestionJob(tenant.id, sync.jobId)
          : null;
      const status =
        job?.status === 'succeeded'
          ? ('connected' as const)
          : job?.status === 'failed'
            ? ('failed' as const)
            : (sync?.status ?? 'pending');
      const failure =
        job?.status === 'failed' ? job.issues.find((i) => i.severity === 'error') : null;
      return {
        status,
        target: configured,
        at: job?.finishedAt || sync?.at || null,
        error: failure ? (failure.detail ?? failure.message) : (sync?.error ?? null),
        progress:
          job && (job.status === 'running' || job.status === 'queued')
            ? (job.progress ?? { phase: 'reading' as const, done: 0, total: null })
            : null,
      };
    };
    return {
      website: await connection('website', tenant.websiteUrl ?? null),
      drive: {
        ...(await connection('drive', tenant.gdriveFolderId ?? null)),
        serviceAccountEmail: portal.driveServiceAccountEmail,
      },
      syncAvailable: {
        website: Boolean(deps.knowledgeSync?.syncWebsite),
        drive: Boolean(deps.knowledgeSync?.syncDrive),
      },
      sources: sources.map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        updatedAt: s.updatedAt,
        characters: s.text.length,
        warnings: placeholderWarnings(s),
      })),
    };
  });

  async function startSync(tenant: Tenant, kind: 'website' | 'drive'): Promise<Tenant> {
    const at = new Date(now()).toISOString();
    const target = kind === 'website' ? tenant.websiteUrl : tenant.gdriveFolderId;
    const sync =
      kind === 'website' ? deps.knowledgeSync?.syncWebsite : deps.knowledgeSync?.syncDrive;
    let state: NonNullable<Tenant['sync']>['website'];
    if (!target) throw new ApiError('bad_request', `No ${kind} is connected yet.`);
    if (!sync) {
      state = { status: 'pending', at, jobId: null, error: null };
    } else {
      try {
        const { jobId } = await sync(tenant, target);
        state = { status: 'syncing', at, jobId, error: null };
      } catch (error) {
        state = {
          status: 'failed',
          at,
          jobId: null,
          error: error instanceof Error ? error.message : 'The sync could not start.',
        };
      }
    }
    return await tenants.save({ ...tenant, sync: { ...tenant.sync, [kind]: state } });
  }

  app.post('/v1/portal/tenants/:tenantId/knowledge/website', async (request) => {
    const { tenant } = await member(request, 'admin');
    const { url } = parse(websiteSchema, request.body);
    // Connecting the website also registers it as the widget's domain.
    const host = hostOf(url);
    const domains =
      host && !(tenant.domains ?? []).includes(host)
        ? [...(tenant.domains ?? []), host]
        : (tenant.domains ?? []);
    const saved = await startSync({ ...tenant, websiteUrl: url, domains }, 'website');
    return { website: saved.sync?.website ?? null };
  });

  app.post('/v1/portal/tenants/:tenantId/knowledge/drive', async (request) => {
    const { tenant } = await member(request, 'admin');
    const { folder } = parse(driveSchema, request.body);
    const folderId = driveFolderId(folder);
    if (!folderId) {
      throw new ApiError(
        'bad_request',
        'That does not look like a Google Drive folder link or id.',
      );
    }
    const saved = await startSync({ ...tenant, gdriveFolderId: folderId }, 'drive');
    return { drive: saved.sync?.drive ?? null, folderId };
  });

  app.post('/v1/portal/tenants/:tenantId/knowledge/sync', async (request) => {
    const { tenant } = await member(request, 'admin');
    let current = tenant;
    if (current.websiteUrl) current = await startSync(current, 'website');
    if (current.gdriveFolderId) current = await startSync(current, 'drive');
    return { sync: current.sync ?? {} };
  });

  // ── team ─────────────────────────────────────────────────────────────────

  app.get('/v1/portal/tenants/:tenantId/members', async (request) => {
    const { tenant } = await member(request, 'viewer');
    const members = await store.listMembers(tenant.id);
    return {
      members: members
        .map((m) => ({
          email: m.email,
          role: m.role,
          joined: m.userId !== null,
          since: m.createdAt,
        }))
        .sort((a, b) => MEMBER_ROLES.indexOf(b.role) - MEMBER_ROLES.indexOf(a.role)),
    };
  });

  app.post('/v1/portal/tenants/:tenantId/members', async (request, reply) => {
    const { identity, membership, tenant } = await member(request, 'admin');
    const body = parse(memberSchema, request.body);
    if (body.role === 'owner' && membership.role !== 'owner') {
      throw new ApiError('forbidden', 'Only an owner can add another owner.');
    }
    const existing = (await store.listMembers(tenant.id)).find((m) => m.email === body.email);
    if (existing && existing.role === 'owner' && membership.role !== 'owner') {
      throw new ApiError('forbidden', 'Only an owner can change an owner.');
    }
    await store.putMembership({
      tenantId: tenant.id,
      email: body.email,
      userId: existing?.userId ?? null,
      role: body.role,
      invitedBy: identity.email,
      createdAt: existing?.createdAt ?? new Date(now()).toISOString(),
    });
    reply.code(existing ? 200 : 201);
    const invite = issueInviteToken(
      deps.sessionSecret,
      { tenantId: tenant.id, email: body.email },
      now(),
    );
    return {
      email: body.email,
      role: body.role,
      // Share this link with the colleague; it works once they sign in with
      // the invited address (or it simply resolves to their membership).
      inviteUrl: `${portal.dashboardUrl}/invite/${encodeURIComponent(invite)}`,
    };
  });

  app.post('/v1/portal/tenants/:tenantId/members/remove', async (request) => {
    const { membership, tenant } = await member(request, 'admin');
    const { email } = parse(removeMemberSchema, request.body);
    const members = await store.listMembers(tenant.id);
    const target = members.find((m) => m.email === email);
    if (!target) throw new ApiError('not_found', 'No such member.');
    if (target.role === 'owner') {
      if (membership.role !== 'owner')
        throw new ApiError('forbidden', 'Only an owner can remove an owner.');
      if (members.filter((m) => m.role === 'owner').length === 1) {
        throw new ApiError('bad_request', 'An installer needs at least one owner.');
      }
    }
    await store.deleteMembership(tenant.id, email);
    return { removed: email };
  });

  // ── billing ──────────────────────────────────────────────────────────────

  app.get('/v1/portal/tenants/:tenantId/billing', async (request) => {
    const { tenant } = await member(request, 'viewer');
    return {
      stripeConfigured: portal.stripe.secretKey !== null,
      plans: PLAN_KEYS.map((key) => ({ key, available: Boolean(portal.stripe.prices[key]) })),
      addons: Object.fromEntries(
        ADDON_KEYS.map((key) => [key, hasEntitlement(tenant, key, now())]),
      ),
      billing: tenant.billing ?? null,
      hasCustomer: Boolean(tenant.stripeCustomerId),
      connections: connections(tenant),
      voice: {
        numbers: tenant.config.voice?.twilioNumbers ?? [],
        minutesUsed: deps.voiceUsage
          ? Math.ceil((await deps.voiceUsage.secondsThisMonth(tenant.id, now())) / 60)
          : null,
        // One pool for web voice and the phone: the ledger counts both together.
        minutesQuota:
          tenant.addonConfig?.voice_widget?.monthlyQuota === undefined &&
          tenant.addonConfig?.phone_agent?.monthlyQuota === undefined
            ? null
            : (tenant.addonConfig?.voice_widget?.monthlyQuota ?? 0) +
              (tenant.addonConfig?.phone_agent?.monthlyQuota ?? 0),
      },
    };
  });

  app.post('/v1/portal/tenants/:tenantId/billing/checkout', async (request) => {
    const { identity, tenant } = await member(request, 'owner');
    const { plan } = parse(planSchema, request.body);
    const priceId = portal.stripe.prices[plan];
    if (!portal.stripe.secretKey || !priceId) {
      throw new ApiError('not_enabled', 'Billing is not configured on this deployment yet.');
    }
    return await createCheckoutSession({
      secretKey: portal.stripe.secretKey,
      tenantId: tenant.id,
      plan,
      priceId,
      customerId: tenant.stripeCustomerId ?? null,
      customerEmail: identity.email,
      successUrl: `${portal.dashboardUrl}/dashboard/billing?checkout=success`,
      cancelUrl: `${portal.dashboardUrl}/dashboard/billing?checkout=cancelled`,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
  });

  app.post('/v1/portal/tenants/:tenantId/billing/portal', async (request) => {
    const { tenant } = await member(request, 'owner');
    if (!portal.stripe.secretKey) {
      throw new ApiError('not_enabled', 'Billing is not configured on this deployment yet.');
    }
    if (!tenant.stripeCustomerId) {
      throw new ApiError('bad_request', 'There is no subscription to manage yet.');
    }
    return await createPortalSession({
      secretKey: portal.stripe.secretKey,
      customerId: tenant.stripeCustomerId,
      returnUrl: `${portal.dashboardUrl}/dashboard/billing`,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
  });

  // The webhook needs the raw body for its signature, so it lives in its own
  // encapsulated scope whose JSON parser keeps the text.
  void app.register((scope, _options, done) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    );
    scope.post('/v1/billing/webhook', { bodyLimit: 1024 * 1024 }, async (request) => {
      const secret = portal.stripe.webhookSecret;
      if (!secret) throw new ApiError('not_enabled', 'Billing webhooks are not configured.');
      const raw = typeof request.body === 'string' ? request.body : '';
      try {
        verifyStripeSignature(
          raw,
          request.headers['stripe-signature'] as string | undefined,
          secret,
          now(),
        );
      } catch (error) {
        if (error instanceof SignatureError) throw new ApiError('bad_request', error.message);
        throw error;
      }
      let event: StripeEvent;
      try {
        event = JSON.parse(raw) as StripeEvent;
      } catch {
        throw new ApiError('bad_request', 'The event is not JSON.');
      }
      if (!event?.id || !event.type || !event.data?.object) {
        throw new ApiError('bad_request', 'The event is not a Stripe event.');
      }
      const outcome = await applyStripeEvent(event, {
        store,
        tenants,
        stripe: portal.stripe,
        now,
      });
      request.log.info({ eventId: event.id, type: event.type, outcome }, 'stripe webhook');
      return { received: true, outcome };
    });
    done();
  });
}

/** Roles in order, for a client that wants to render a picker. */
export const PORTAL_ROLES = MEMBER_ROLES;
export { roleAtLeast };

/** The registrable host of a website URL, without a leading "www.". */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}
