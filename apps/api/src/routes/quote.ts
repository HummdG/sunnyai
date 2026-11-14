/**
 * The quote journey over HTTP: what to ask next, answers in (several at once),
 * three priced options out, and a quote attached to the visitor's lead once
 * they have consented.
 *
 *   GET  /v1/quote/journey            where the session is, and what to ask
 *   POST /v1/quote/journey/answers    answers and/or the visitor's own words
 *   POST /v1/quote/options            build and store a quote from stored state
 *   GET  /v1/quote/:id                one of this session's quotes
 *   POST /v1/quote/:id/lead           attach the quote to this session's lead
 *
 * Every route is session-authenticated and tenant-scoped: the tenant and the
 * session come from the signed session token, and a quote or assessment from
 * another session reads as not found. Prices come from the tenant's pricing on
 * the server; nothing a client sends is priced. The operations themselves are
 * in journey/service.ts, shared with the assistant's tools.
 */

import { ApiError } from '@sunny/contracts';
import type { PricingSource } from '@sunny/quote-engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { pinBrandAssets } from '../branding/meta.js';
import type { HomeData } from '../homedata/index.js';
import { roofPicture, type RoofPicture } from '../homedata/roof-image.js';
import { parseGoogleRoof } from '../homedata/solar.js';
import { JOURNEY_KEYS } from '../journey/journey.js';
import { chosenPackage } from '../journey/choose.js';
import { createBatteryQuote, publishedBatteryPricing } from '../journey/battery/service.js';
import { BATTERY_NOT_SUITABLE, batteryNotSuitable } from '../journey/battery/status.js';
import { hasProposal, isSolarRecord, type StoredQuote } from '../journey/quote-kinds.js';
import { createHeatPumpQuote, publishedHeatPumpPricing } from '../journey/heat-pump/service.js';
import type { QuoteRecord } from '../journey/quote.js';
import {
  createQuote,
  journeyView,
  linkAssessment,
  submitAnswers,
  type JourneyDeps,
  type RoofLookupFn,
} from '../journey/service.js';
import { verifySessionToken } from '../sessions.js';
import type { Store } from '../store.js';
import type { TenantRegistry } from '../tenants.js';
import { sessionFlowForTenant, workflowsForTenant } from '../workflows/tenant.js';

export { sunscanRoofLookup, type RoofLookup } from '../journey/service.js';

export interface QuoteRouteDeps {
  store: Store;
  tenants: TenantRegistry;
  sessionSecret: string;
  now: () => number;
  pricing: PricingSource;
  /** The assessment `assessmentId`, if it belongs to this tenant and session. */
  roof: RoofLookupFn;
  /** Google's roof data, for the aerial photo of the visitor's house. */
  homeData?: HomeData | null;
}

const answersRequestSchema = z.object({
  sessionId: z.string().min(1).max(200),
  /** Answers already structured (the widget's buttons, the model's proposals). */
  answers: z
    .array(z.object({ questionId: z.string().min(1).max(60), value: z.string().min(1).max(500) }))
    .max(20)
    .optional(),
  /** The visitor's own words, read deterministically for further answers. */
  text: z.string().max(500).optional(),
  /** An assessment the page started (POST /v1/sunscan/assessments). */
  assessmentId: z.string().min(1).max(120).optional(),
});

const sessionOnlySchema = z.object({ sessionId: z.string().min(1).max(200) });
const chooseSchema = z.object({
  sessionId: z.string().min(1).max(200),
  optionId: z.string().min(1).max(60),
});
const attachLeadSchema = z.object({
  sessionId: z.string().min(1).max(200),
  leadId: z.string().min(1).max(200),
});

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : undefined;
}

function badRequest(error: z.ZodError): ApiError {
  return new ApiError('bad_request', error.issues[0]?.message ?? 'Invalid request.');
}

/** A quote as the visitor's page sees it: no tenant id. */
export function publicQuote(
  record: QuoteRecord,
): Omit<QuoteRecord, 'tenantId'> & { proposalAvailable: boolean };
export function publicQuote(
  record: StoredQuote,
): Omit<StoredQuote, 'tenantId'> & { proposalAvailable: boolean };
export function publicQuote(
  record: StoredQuote,
): Omit<StoredQuote, 'tenantId'> & { proposalAvailable: boolean } {
  const { tenantId: _tenantId, ...rest } = record;
  // GET /v1/quote/:id/proposal.pdf renders the kinds that have a PDF
  // (routes/proposal.ts): a solar proposal or a heat pump estimate.
  return { ...rest, proposalAvailable: hasProposal(record) };
}

export function registerQuoteRoutes(app: FastifyInstance, deps: QuoteRouteDeps): void {
  const journey: JourneyDeps = {
    store: deps.store,
    pricing: deps.pricing,
    roof: deps.roof,
    now: deps.now,
    // The widget's quote journey is Sunny's chat: it follows the installer's
    // solar workflow once workflows are saved, else the stored conversation.
    flow: (tenantId) => sessionFlowForTenant(deps.tenants.byId(tenantId)),
    tenant: (tenantId) => deps.tenants.byId(tenantId),
    pinBrandAssets: (tenantId, ids) => pinBrandAssets(deps.tenants, tenantId, ids),
    log: app.log,
  };

  function caller(request: FastifyRequest, sessionId?: string) {
    const claims = verifySessionToken(bearer(request), deps.sessionSecret, deps.now());
    if (!claims) throw new ApiError('unauthorized', 'A valid session token is required.');
    if (sessionId !== undefined && sessionId !== claims.sessionId) {
      throw new ApiError('forbidden', 'That session token is for a different session.');
    }
    if (!deps.tenants.byId(claims.tenantId)) {
      throw new ApiError('not_found', 'Unknown tenant for this session.');
    }
    return { tenantId: claims.tenantId, sessionId: claims.sessionId };
  }

  app.get('/v1/quote/journey', async (request) => {
    const who = caller(request);
    return journeyView(journey, who.tenantId, who.sessionId);
  });

  /**
   * The visitor's house from above, with Google's panels on each roof face
   * (homedata/roof-image.ts). 404 when there is nothing to show: no Google
   * roof for the session's address, or no imagery for it.
   */
  app.get('/v1/quote/roof-picture', async (request, reply) => {
    const who = caller(request);
    const answers = (await deps.store.getConversation(who.tenantId, who.sessionId))?.answers ?? {};
    const roof = parseGoogleRoof(answers[JOURNEY_KEYS.homeSolar]);
    let picture: RoofPicture | null = null;
    try {
      picture = await roofPicture(deps.homeData?.solar, roof, deps.now());
    } catch (error) {
      request.log.warn({ err: error }, 'roof picture failed; the chat carries on without it');
    }
    if (!picture) throw new ApiError('not_found', 'No roof picture for this address.');
    void reply.header('cache-control', 'private, max-age=3600');
    return picture;
  });

  app.post('/v1/quote/journey/answers', async (request) => {
    const body = answersRequestSchema.safeParse(request.body);
    if (!body.success) throw badRequest(body.error);
    const who = caller(request, body.data.sessionId);
    if (
      body.data.assessmentId &&
      !(await linkAssessment(journey, who.tenantId, who.sessionId, body.data.assessmentId))
    ) {
      throw new ApiError('not_found', 'No such assessment.');
    }
    const result = await submitAnswers(journey, who.tenantId, who.sessionId, {
      ...(body.data.answers ? { proposals: body.data.answers } : {}),
      ...(body.data.text ? { text: body.data.text } : {}),
    });
    return {
      accepted: result.accepted,
      rejected: result.rejected,
      removed: result.removed,
      journey: result.journey,
    };
  });

  app.post('/v1/quote/options', async (request, reply) => {
    const body = sessionOnlySchema.safeParse(request.body);
    if (!body.success) throw badRequest(body.error);
    const who = caller(request, body.data.sessionId);
    // The session's running workflow decides the engine: an enabled heat pump
    // or battery workflow gets its own quote, anything else the solar quote it
    // always had.
    const active = (await deps.store.getWorkflowState(who.tenantId, who.sessionId)).active;
    const workflow = active
      ? workflowsForTenant(deps.tenants.byId(who.tenantId)).set.workflows.find(
          (w) => w.id === active.workflowId,
        )
      : undefined;
    const engine =
      workflow?.enabled === true && workflow.outcome.kind === 'quote'
        ? workflow.outcome.engine
        : 'solar';
    // A home without solar is not quoted a battery retrofit, and is told why.
    if (engine === 'battery') {
      const answers =
        (await deps.store.getConversation(who.tenantId, who.sessionId))?.answers ?? {};
      if (batteryNotSuitable(answers)) throw new ApiError('bad_request', BATTERY_NOT_SUITABLE);
    }
    const result =
      engine === 'heat_pump'
        ? await createHeatPumpQuote(
            { ...journey, heatPumpPricing: publishedHeatPumpPricing(deps.store) },
            who.tenantId,
            who.sessionId,
            workflow!,
          )
        : engine === 'battery'
          ? await createBatteryQuote(
              { ...journey, batteryPricing: publishedBatteryPricing(deps.store) },
              who.tenantId,
              who.sessionId,
              workflow!,
            )
          : await createQuote(journey, who.tenantId, who.sessionId);
    if (!result.ok) {
      throw new ApiError('bad_request', 'Not every answer the quote needs is in yet.', {
        missing: result.missing.join(','),
        next: result.next ?? '',
      });
    }
    void reply.code(201);
    return publicQuote(result.quote);
  });

  async function owned(tenantId: string, sessionId: string, id: string): Promise<StoredQuote> {
    const record = await deps.store.getQuote(tenantId, id);
    if (!record || record.sessionId !== sessionId) {
      throw new ApiError('not_found', 'No such quote.');
    }
    return record;
  }

  app.get('/v1/quote/:id', async (request) => {
    const who = caller(request);
    const { id } = request.params as { id: string };
    return publicQuote(await owned(who.tenantId, who.sessionId, id));
  });

  /**
   * "Choose this package": records the visitor's pick on their own quote (a lead
   * that carries the quote shows it) and returns the savings timeline the 3D
   * simulation plays. Choosing again replaces the earlier choice.
   */
  app.post('/v1/quote/:id/choose', async (request) => {
    const body = chooseSchema.safeParse(request.body);
    if (!body.success) throw badRequest(body.error);
    const who = caller(request, body.data.sessionId);
    const { id } = request.params as { id: string };
    const quote = await owned(who.tenantId, who.sessionId, id);
    if (!isSolarRecord(quote)) {
      // Only a solar quote has a savings timeline to play: for any other kind
      // the choice is saved and the option returned as is.
      const options: readonly { id: string }[] = quote.options;
      const option = options.find((o) => o.id === body.data.optionId);
      if (!option) throw new ApiError('not_found', 'No such option on this quote.');
      const chosenAt = new Date(deps.now()).toISOString();
      await deps.store.saveQuote({ ...quote, chosenOptionId: option.id, chosenAt });
      return { chosen: option };
    }
    const option = quote.options.find((o) => o.id === body.data.optionId);
    if (!option) throw new ApiError('not_found', 'No such option on this quote.');
    const chosen: QuoteRecord = {
      ...quote,
      chosenOptionId: option.id,
      chosenAt: new Date(deps.now()).toISOString(),
    };
    await deps.store.saveQuote(chosen);
    return chosenPackage(chosen, option);
  });

  /**
   * The consent gate: a quote joins a lead only once that lead exists, and a
   * lead only exists if the visitor agreed to be contacted (the leads route and
   * `create_lead` both refuse without consent). The lead must be this session's.
   */
  app.post('/v1/quote/:id/lead', async (request) => {
    const body = attachLeadSchema.safeParse(request.body);
    if (!body.success) throw badRequest(body.error);
    const who = caller(request, body.data.sessionId);
    const { id } = request.params as { id: string };
    const quote = await owned(who.tenantId, who.sessionId, id);
    const lead = (await deps.store.listAllLeads(who.tenantId)).find(
      (l) => l.id === body.data.leadId && l.sessionId === who.sessionId,
    );
    if (!lead) throw new ApiError('not_found', 'No such lead for this session.');
    const attached: StoredQuote = { ...quote, leadId: lead.id };
    await deps.store.saveQuote(attached);
    return publicQuote(attached);
  });
}
