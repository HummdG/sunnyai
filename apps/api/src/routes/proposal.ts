import { ApiError } from '@sunny/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createAuthenticator, requireMembership } from '../auth/index.js';
import type { QuoteRecord } from '../journey/quote.js';
import { proposalFilename, proposalPdf, type ProposalMailer } from '../proposal/index.js';
import { verifySessionToken } from '../sessions.js';
import type { LeadRecord, Store } from '../store.js';
import type { Tenant, TenantRegistry } from '../tenants.js';
import type { PortalConfig } from './portal-config.js';

/**
 * The customer proposal PDF (proposal/pdf.ts), three ways:
 *
 *   GET  /v1/quote/:id/proposal.pdf          the visitor's own quote (widget session)
 *   POST /v1/quote/:id/proposal/email        email it to the visitor, with consent
 *   GET  /v1/portal/tenants/:tenantId/leads/:leadId/quote/proposal.pdf
 *                                            the installer's copy (viewer and above)
 *
 * The visitor routes answer only the session that made the quote; the
 * installer route only a member of the quote's installer. Any miss is the same
 * `not_found`, so ids cannot be probed.
 */

export interface ProposalRouteDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
  /** Null when outbound email is not configured: the email route refuses. */
  mailer: ProposalMailer | null;
  fetch?: typeof fetch;
}

const emailSchema = z.object({
  email: z.string().trim().email().max(254),
  /** The visitor ticked "email my quote to me" -- nothing is sent without it. */
  consent: z.literal(true),
});

/** Per session, per day: enough to resend to a corrected address, not a spam relay. */
const EMAILS_PER_SESSION_PER_DAY = 3;

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : undefined;
}

function sendPdf(reply: FastifyReply, pdf: Buffer, filename: string): Buffer {
  void reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .header('cache-control', 'private, no-store');
  return pdf;
}

export function registerProposalRoutes(app: FastifyInstance, deps: ProposalRouteDeps): void {
  const { store, tenants, now } = deps;
  const auth = createAuthenticator({
    portal: deps.portal,
    sessionSecret: deps.sessionSecret,
    now,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    store,
  });
  const sent = new Map<string, number[]>();

  /** The visitor's quote: their session, their tenant, their quote. */
  async function visitorQuote(
    request: FastifyRequest,
  ): Promise<{ tenant: Tenant; quote: QuoteRecord; sessionId: string }> {
    const claims = verifySessionToken(bearer(request), deps.sessionSecret, now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');
    const tenant = tenants.byId(claims.tenantId);
    const { id } = request.params as { id: string };
    const quote = tenant ? await store.getQuote(tenant.id, id) : null;
    if (!tenant || !quote || quote.sessionId !== claims.sessionId) {
      throw new ApiError('not_found', 'No such quote.');
    }
    return { tenant, quote, sessionId: claims.sessionId };
  }

  async function leadFor(tenant: Tenant, quote: QuoteRecord): Promise<LeadRecord | null> {
    if (!quote.leadId) return null;
    return (await store.listAllLeads(tenant.id)).find((l) => l.id === quote.leadId) ?? null;
  }

  app.get('/v1/quote/:id/proposal.pdf', async (request, reply) => {
    const { tenant, quote } = await visitorQuote(request);
    const pdf = await proposalPdf(
      store,
      tenant,
      quote,
      await leadFor(tenant, quote),
      new Date(now()),
    );
    return sendPdf(reply, pdf, proposalFilename(tenant, quote));
  });

  app.post('/v1/quote/:id/proposal/email', async (request) => {
    if (!deps.mailer) {
      throw new ApiError('not_enabled', 'Emailing quotes is not set up on this deployment.');
    }
    const body = emailSchema.safeParse(request.body);
    if (!body.success) {
      throw new ApiError(
        'bad_request',
        body.error.issues.some((i) => i.path[0] === 'consent')
          ? 'Tick the box to agree to receive your quote by email.'
          : 'Enter a valid email address.',
      );
    }
    const { tenant, quote, sessionId } = await visitorQuote(request);
    const dayAgo = now() - 24 * 60 * 60 * 1000;
    const recent = (sent.get(sessionId) ?? []).filter((t) => t > dayAgo);
    if (recent.length >= EMAILS_PER_SESSION_PER_DAY) {
      throw new ApiError('rate_limited', 'Your quote has already been emailed a few times today.');
    }
    const pdf = await proposalPdf(
      store,
      tenant,
      quote,
      await leadFor(tenant, quote),
      new Date(now()),
    );
    const company = tenant.config.companyName;
    const contact = tenant.config.supportContact;
    await deps.mailer.send({
      to: body.data.email,
      replyTo: contact?.email ?? null,
      fromName: `${company} via Sunny.ai`,
      subject: `Your solar quote from ${company}`,
      text: [
        'Hello,',
        '',
        `Here is the solar proposal you asked for, from ${company}. It sets out the system we ` +
          'recommend, the other options you were shown, and what each should generate and save.',
        '',
        'Every figure is indicative and non-binding until we have surveyed your property.',
        '',
        contact?.phone || contact?.email
          ? `Any questions? Contact us on ${[contact.phone, contact.email].filter(Boolean).join(' or ')}.`
          : 'Any questions? Just reply to this email.',
        '',
        `The ${company} team`,
      ].join('\n'),
      attachment: { filename: proposalFilename(tenant, quote), data: pdf },
    });
    sent.set(sessionId, [...recent, now()]);
    return { sent: true };
  });

  app.get(
    '/v1/portal/tenants/:tenantId/leads/:leadId/quote/proposal.pdf',
    async (request, reply) => {
      const identity = await auth.identify(request.headers.authorization);
      const { tenantId, leadId } = request.params as { tenantId: string; leadId: string };
      await requireMembership(store, identity, tenantId, 'viewer');
      const tenant = tenants.byId(tenantId);
      if (!tenant) throw new ApiError('not_found', 'No such installer.');
      const lead = (await store.listAllLeads(tenant.id)).find((l) => l.id === leadId);
      if (!lead) throw new ApiError('not_found', 'No such lead.');
      // As the lead page does: the quote the visitor attached, else the latest
      // quote from the same conversation.
      const quotes = await store.listQuotes(tenant.id, lead.sessionId);
      const quote = quotes.filter((q) => q.leadId === lead.id).at(-1) ?? quotes.at(-1) ?? null;
      if (!quote) throw new ApiError('not_found', 'This lead has no quote.');
      const pdf = await proposalPdf(store, tenant, quote, lead, new Date(now()));
      return sendPdf(reply, pdf, proposalFilename(tenant, quote));
    },
  );
}
