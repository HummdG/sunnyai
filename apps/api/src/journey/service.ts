/**
 * The quote journey's operations, shared by the HTTP routes (routes/quote.ts)
 * and the assistant's tools (journey/agent-tools.ts), so a visitor answering by
 * buttons and a visitor answering in conversation move through the same states.
 */

import { proposalEmailConfigured } from '../proposal/mailer.js';
import { randomUUID } from 'node:crypto';

import type { QuoteCard } from '@sunny/contracts';
import type { PricingSource } from '@sunny/quote-engine';
import { toRoofAssessmentSummary, type SunScanService } from '@sunny/sunscan-adapter';

import { getPublishedPriceList } from '../catalogue/price-list-service.js';
import { effectsFor } from '../flow/effects.js';
import { resolveFlow, type ResolvedFlow } from '../flow/resolve.js';
import { reasonsFor } from '../proposal/reasons.js';
import { snapshotAssetIds, snapshotFor } from '../proposal/snapshot.js';
import { warrantiesFor } from '../proposal/warranties.js';
import type { Store } from '../store.js';
import type { Tenant } from '../tenants.js';

import { applyProposals, extractAnswers, type AppliedAnswers, type Proposal } from './extract.js';
import {
  JOURNEY_KEYS,
  journeyStatus,
  prefillFromRoof,
  quoteAnswers,
  rejectRoof,
  type JourneyView,
} from './journey.js';
import { isSolarRecord, type HeatPumpQuoteRecord, type StoredQuote } from './heat-pump/record.js';
import { buildQuote, type QuoteRecord } from './quote.js';
import { mapRoof, type MappedRoof, type RoofAssessmentSummary } from './roof.js';

/** What the roof assessment for a session looks like right now. */
export type RoofLookup =
  | { state: 'none' }
  | { state: 'pending' }
  | { state: 'failed' }
  | { state: 'ready'; summary: RoofAssessmentSummary };

export type RoofLookupFn = (
  tenantId: string,
  sessionId: string,
  assessmentId: string,
) => Promise<RoofLookup>;

export interface JourneyDeps {
  store: Store;
  pricing: PricingSource;
  roof: RoofLookupFn;
  now: () => number;
  /**
   * The conversation a tenant's journey follows, read per call so a flow the
   * installer saves applies from the next request. Absent means Sunny's own.
   */
  flow?: (tenantId: string) => ResolvedFlow;
  /** The tenant, for the quotation snapshot a new quote carries. */
  tenant?: (tenantId: string) => Tenant | null | undefined;
  /**
   * Keep the brand assets a new quote's PDF prints safe from pruning
   * (branding/meta.ts `pinBrandAssets`). Absent: nothing is pinned.
   */
  pinBrandAssets?: (tenantId: string, ids: string[]) => Promise<void>;
  /** Where non-fatal problems are noted. Absent: they are not logged. */
  log?: { warn: (object: object, message: string) => void };
}

function flowOf(deps: JourneyDeps, tenantId: string): ResolvedFlow {
  return deps.flow?.(tenantId) ?? resolveFlow(null);
}

/** The roof lookup backed by the SunScan service (routes/sunscan.ts). */
export function sunscanRoofLookup(service: SunScanService | null | undefined): RoofLookupFn {
  return async (tenantId, sessionId, assessmentId) => {
    if (!service) return { state: 'none' };
    const record = await service.getAssessment(tenantId, assessmentId);
    // Another session's assessment reads as absent, like the SunScan routes.
    if (!record || record.sessionId !== sessionId) return { state: 'none' };
    if (record.status === 'queued' || record.status === 'running') return { state: 'pending' };
    const summary = toRoofAssessmentSummary(record);
    return summary ? { state: 'ready', summary } : { state: 'failed' };
  };
}

export interface JourneyState {
  answers: Record<string, string>;
  roof: MappedRoof | null;
  pending: boolean;
}

async function basePanel(deps: JourneyDeps, tenantId: string) {
  const pricing = await deps.pricing.forTenant(tenantId);
  return pricing?.catalogue.panels.find((p) => p.isBase) ?? { widthMm: 1134, heightMm: 1762 };
}

/**
 * The session's standing answers with the roof folded in: a finished
 * assessment pre-fills what it measured (stored, so it happens once).
 */
export async function loadJourney(
  deps: JourneyDeps,
  tenantId: string,
  sessionId: string,
): Promise<JourneyState> {
  let answers = (await deps.store.getConversation(tenantId, sessionId))?.answers ?? {};
  const assessmentId = answers[JOURNEY_KEYS.assessmentId];
  if (!assessmentId) return { answers, roof: null, pending: false };
  const lookup = await deps.roof(tenantId, sessionId, assessmentId);
  if (lookup.state === 'pending') return { answers, roof: null, pending: true };
  if (lookup.state !== 'ready') return { answers, roof: null, pending: false };
  const roof = mapRoof(lookup.summary, await basePanel(deps, tenantId));
  const patch = prefillFromRoof(answers, roof);
  if (Object.entries(patch).some(([k, v]) => answers[k] !== v)) {
    answers = (await deps.store.mergeAnswers(tenantId, sessionId, patch)).answers ?? answers;
  }
  return { answers, roof, pending: false };
}

export async function journeyView(
  deps: JourneyDeps,
  tenantId: string,
  sessionId: string,
): Promise<JourneyView> {
  const { answers, roof, pending } = await loadJourney(deps, tenantId, sessionId);
  const quoted = (await deps.store.listQuotes(tenantId, sessionId)).some(isSolarRecord);
  return journeyStatus(answers, roof, { roofPending: pending, quoted }, flowOf(deps, tenantId));
}

/** Link an assessment to the session, if it is this session's. */
export async function linkAssessment(
  deps: JourneyDeps,
  tenantId: string,
  sessionId: string,
  assessmentId: string,
): Promise<boolean> {
  const lookup = await deps.roof(tenantId, sessionId, assessmentId);
  if (lookup.state === 'none') return false;
  await deps.store.mergeAnswers(tenantId, sessionId, { [JOURNEY_KEYS.assessmentId]: assessmentId });
  return true;
}

export interface SubmitResult extends AppliedAnswers {
  removed: string[];
  journey: JourneyView;
}

/**
 * Apply answers -- structured ones and/or the visitor's own words -- validate,
 * reconcile, store, and report what happened and what to ask next.
 */
export async function submitAnswers(
  deps: JourneyDeps,
  tenantId: string,
  sessionId: string,
  input: {
    proposals?: readonly Proposal[];
    text?: string;
    /**
     * The question the visitor's words answer, when the caller knows better
     * than the quote journey (a workflow asking an optional question).
     */
    current?: string | null;
  },
): Promise<SubmitResult> {
  const flow = flowOf(deps, tenantId);
  const before = await loadJourney(deps, tenantId, sessionId);
  const current =
    input.current !== undefined
      ? input.current
      : journeyStatus(before.answers, before.roof, { roofPending: before.pending }, flow)
          .nextQuestionId;
  const proposals: Proposal[] = [
    ...(input.proposals ?? []),
    ...(input.text ? extractAnswers(input.text, current, flow) : []),
  ];
  // An explicit answer wins over one read from the same message.
  const unique = proposals.filter(
    (p, i) => proposals.findIndex((q) => q.questionId === p.questionId) === i,
  );

  let result = applyProposals(before.answers, unique, flow);
  if (result.answers['roof_confirmed'] === 'no') {
    // "That's not my roof": stop trusting the mapping and ask the roof questions.
    result = { ...result, answers: flow.reconcile(rejectRoof(result.answers)).answers };
  }
  const removed = Object.keys(before.answers).filter((k) => !(k in result.answers));
  const patch = Object.fromEntries(
    Object.entries(result.answers).filter(([k, v]) => before.answers[k] !== v),
  );
  if (Object.keys(patch).length > 0 || removed.length > 0) {
    await deps.store.mergeAnswers(tenantId, sessionId, patch, removed);
  }
  return {
    ...result,
    removed,
    journey: await journeyView(deps, tenantId, sessionId),
  };
}

/**
 * The catalogue's warranty years for the quote's items, fixed now. A catalogue
 * that cannot be read leaves the quote without warranties rather than failing it.
 */
async function warrantiesNow(
  store: Store,
  tenantId: string,
  quote: QuoteRecord,
): Promise<Record<string, number>> {
  try {
    const [list, products] = await Promise.all([
      getPublishedPriceList(store, tenantId),
      store.listProducts(tenantId),
    ]);
    return warrantiesFor(
      quote.options.flatMap((o) => o.lineItems),
      list,
      products,
    );
  } catch {
    return {};
  }
}

export type CreateQuoteResult =
  { ok: true; quote: QuoteRecord } | { ok: false; missing: string[]; next: string | null };

export async function createQuote(
  deps: JourneyDeps,
  tenantId: string,
  sessionId: string,
): Promise<CreateQuoteResult> {
  // The flow in force now, whichever one the earlier answers were given under.
  const flow = flowOf(deps, tenantId);
  const { answers, roof, pending } = await loadJourney(deps, tenantId, sessionId);
  const status = journeyStatus(answers, roof, { roofPending: pending }, flow);
  const pricing = await deps.pricing.forTenant(tenantId);
  const qa = status.canQuote ? quoteAnswers(answers, roof, pricing, flow) : null;
  if (!qa) return { ok: false, missing: status.missing, next: status.nextQuestionId };
  // An installer's flow can change the quote: what the answers add, remove and
  // swap is priced from the same published list the pricing came from.
  const effects = flow.custom ? effectsFor(flow.stored, answers) : [];
  const custom = flow.custom
    ? { flow, effects, priceList: await getPublishedPriceList(deps.store, tenantId) }
    : {};
  const quote = buildQuote({
    id: `q_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    tenantId,
    sessionId,
    createdAt: new Date(deps.now()).toISOString(),
    answers: qa,
    roof,
    pricing,
    ...custom,
  });
  // Fixed now: the settings in force at this moment, and why each item is here.
  const tenant = deps.tenant?.(tenantId);
  if (tenant) {
    quote.quotation = snapshotFor(tenant, tenant.config.quotation, deps.log);
    const ids = snapshotAssetIds(quote.quotation);
    if (ids.length > 0 && deps.pinBrandAssets) {
      // A pin that fails must not cost the visitor their quote.
      await deps.pinBrandAssets(tenantId, ids).catch((error: unknown) => {
        deps.log?.warn({ err: error, tenantId }, 'could not pin brand assets for a new quote');
      });
    }
  }
  const reasons: Record<string, string> = {};
  for (const option of quote.options) {
    Object.assign(reasons, reasonsFor(effects, flow, answers, option));
  }
  quote.reasons = reasons;
  quote.warranties = await warrantiesNow(deps.store, tenantId, quote);
  await deps.store.saveQuote(quote);
  return { ok: true, quote };
}

/** The quote as the widget's option cards. */
export function toQuoteCard(
  quote: StoredQuote,
  options: { emailAvailable?: boolean } = {},
): QuoteCard {
  if (!isSolarRecord(quote)) return heatPumpCard(quote, options);
  return {
    quoteId: quote.id,
    priced: quote.priced,
    disclaimer: quote.disclaimer,
    // Every stored quote renders as a PDF proposal (routes/proposal.ts).
    proposalAvailable: true,
    emailAvailable: options.emailAvailable ?? proposalEmailConfigured(),
    options: quote.options.map((o) => ({
      id: o.id,
      label: o.label,
      isRecommended: o.isRecommended,
      headline: o.headline,
      panelCount: o.panelCount,
      systemKwp: o.systemKwp,
      batteryType: o.batteryType,
      batteryCapacityKwh: o.batteryCapacityKwh,
      priceGbp: o.priceGbp,
      priceLabel: o.priceLabel,
      annualGenerationKwh: o.annualGenerationKwh,
      annualSavingsGbp: o.annualSavingsGbp,
      paybackYears: o.paybackYears,
      aboveBudget: o.aboveBudget,
      roofLimited: o.roofLimited,
      ...(o.installerPriced.length > 0 ? { installerPriced: o.installerPriced } : {}),
      ...(o.sentinel
        ? {
            sentinel: {
              upliftPercent: o.sentinel.upliftPercent,
              annualSavingsGbp: o.sentinel.annualSavingsGbp,
              paybackYears: o.sentinel.paybackYears,
            },
          }
        : {}),
    })),
  };
}

/** A heat pump quote as cards. No PDF proposal yet, so none is offered. */
function heatPumpCard(
  quote: HeatPumpQuoteRecord,
  options: { emailAvailable?: boolean },
): QuoteCard {
  return {
    kind: 'heat_pump',
    quoteId: quote.id,
    priced: quote.priced,
    disclaimer: quote.disclaimer,
    proposalAvailable: false,
    emailAvailable: options.emailAvailable ?? proposalEmailConfigured(),
    options: quote.options.map((o) => ({
      id: o.id,
      label: o.label,
      isRecommended: o.isRecommended,
      headline: o.headline,
      outputKw: o.outputKw,
      priceGbp: o.priceGbp,
      grantGbp: o.grantGbp,
      priceAfterGrantGbp: o.priceAfterGrantGbp,
      priceLabel: o.priceLabel,
      runningCostGbp: o.runningCostGbp,
      currentCostGbp: o.currentCostGbp,
      annualSavingsGbp: o.annualSavingsGbp,
      ...(o.installerPriced ? { installerPriced: true } : {}),
    })),
  };
}
