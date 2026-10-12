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

import type { Store } from '../store.js';

import { applyProposals, extractAnswers, type AppliedAnswers, type Proposal } from './extract.js';
import {
  JOURNEY_KEYS,
  journeyStatus,
  prefillFromRoof,
  quoteAnswers,
  rejectRoof,
  type JourneyView,
} from './journey.js';
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
  const quoted = (await deps.store.listQuotes(tenantId, sessionId)).length > 0;
  return journeyStatus(answers, roof, { roofPending: pending, quoted });
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
  input: { proposals?: readonly Proposal[]; text?: string },
): Promise<SubmitResult> {
  const before = await loadJourney(deps, tenantId, sessionId);
  const current = journeyStatus(before.answers, before.roof, {
    roofPending: before.pending,
  }).nextQuestionId;
  const proposals: Proposal[] = [
    ...(input.proposals ?? []),
    ...(input.text ? extractAnswers(input.text, current) : []),
  ];
  // An explicit answer wins over one read from the same message.
  const unique = proposals.filter(
    (p, i) => proposals.findIndex((q) => q.questionId === p.questionId) === i,
  );

  let result = applyProposals(before.answers, unique);
  if (result.answers['roof_confirmed'] === 'no') {
    // "That's not my roof": stop trusting the mapping and ask the roof questions.
    result = { ...result, answers: rejectRoof(result.answers) };
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

export type CreateQuoteResult =
  { ok: true; quote: QuoteRecord } | { ok: false; missing: string[]; next: string | null };

export async function createQuote(
  deps: JourneyDeps,
  tenantId: string,
  sessionId: string,
): Promise<CreateQuoteResult> {
  const { answers, roof, pending } = await loadJourney(deps, tenantId, sessionId);
  const status = journeyStatus(answers, roof, { roofPending: pending });
  const pricing = await deps.pricing.forTenant(tenantId);
  const qa = status.canQuote ? quoteAnswers(answers, roof, pricing) : null;
  if (!qa) return { ok: false, missing: status.missing, next: status.nextQuestionId };
  const quote = buildQuote({
    id: `q_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    tenantId,
    sessionId,
    createdAt: new Date(deps.now()).toISOString(),
    answers: qa,
    roof,
    pricing,
  });
  await deps.store.saveQuote(quote);
  return { ok: true, quote };
}

/** The quote as the widget's option cards. */
export function toQuoteCard(
  quote: QuoteRecord,
  options: { emailAvailable?: boolean } = {},
): QuoteCard {
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
