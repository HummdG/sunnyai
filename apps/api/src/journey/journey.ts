/**
 * The quote journey: address → 3D roof → questionnaire → quote → consent → lead.
 *
 * A deterministic state machine over the standing answers map (the same map
 * `save_answer` and `POST /v1/qualification/answer` write). The model never
 * decides what comes next: it phrases the question this module names and
 * proposes answers, which `questionnaire.ts` validates. Everything here is pure
 * so it can be tested without a server.
 *
 * Journey-only keys are stored in the same map with a `journey_` prefix -- the
 * assessment id and the derived postcode -- so a resumed session carries them.
 */

import type { QuoteAnswers, QuoteUsage, TenantPricing } from '@sunny/quote-engine';

import { nextQuestion, QUESTIONS, reconcile } from '../questionnaire.js';

import { confirmationPrompt, FACING_TO_DIRECTION, type MappedRoof } from './roof.js';

export const JOURNEY_KEYS = {
  assessmentId: 'journey_assessment_id',
  postcode: 'journey_postcode',
  /** The visitor said the mapped roof is wrong; the mapping stays untrusted. */
  roofRejected: 'journey_roof_rejected',
} as const;

export type JourneyStage =
  | 'address' // nothing to assess yet
  | 'roof_pending' // the 3D assessment is running; questions continue meanwhile
  | 'questions' // questionnaire answers outstanding
  | 'quote_ready' // every answer the quote needs is in
  | 'quoted'; // a quote has been presented

export interface JourneyView {
  stage: JourneyStage;
  /** The next question to ask, or null when nothing is outstanding. */
  nextQuestionId: string | null;
  /** The sentence to ask it with (the confirmation reads the mapped roof). */
  prompt: string | null;
  /** Options the visitor can pick from, when the question has them. */
  options: readonly string[] | null;
  /** True for "select all that apply". */
  multi: boolean;
  roof: MappedRoof | null;
  roofPending: boolean;
  postcode: string | null;
  /** Answers a quote still needs (empty when `canQuote`). */
  missing: string[];
  canQuote: boolean;
}

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** The postcode in an address line, normalised, or null. */
export function postcodeFrom(address: string | undefined): string | null {
  const match = address ? UK_POSTCODE.exec(address) : null;
  return match ? `${match[1]!.toUpperCase()} ${match[2]!.toUpperCase()}` : null;
}

/**
 * The answers a finished roof assessment implies. Confidence comes from the
 * assessment; a visitor who already said the roof is wrong keeps `low`.
 */
export function prefillFromRoof(
  answers: Record<string, string>,
  roof: MappedRoof,
): Record<string, string> {
  const patch: Record<string, string> = { [JOURNEY_KEYS.assessmentId]: roof.assessmentId };
  if (roof.postcode && !answers[JOURNEY_KEYS.postcode]) {
    patch[JOURNEY_KEYS.postcode] = roof.postcode;
  }
  const rejected =
    answers[JOURNEY_KEYS.roofRejected] === 'yes' || answers['roof_confirmed'] === 'no';
  if (
    !answers['roof_confidence'] ||
    (!rejected && answers['roof_confidence'] !== roof.confidence)
  ) {
    patch['roof_confidence'] = rejected ? 'low' : roof.confidence;
  }
  return patch;
}

/**
 * What a "no, that's not right" to the roof confirmation means: the mapping is
 * no longer trusted, so SunScan's fallback roof questions open. The direction is
 * left for the visitor to give; nothing is guessed.
 */
export function rejectRoof(answers: Record<string, string>): Record<string, string> {
  // `roof_confirmed` no longer applies at low confidence, so reconcile drops it;
  // the journey key is what remembers the visitor's "no".
  return reconcile({
    ...answers,
    roof_confirmed: 'no',
    roof_confidence: 'low',
    [JOURNEY_KEYS.roofRejected]: 'yes',
  }).answers;
}

/** Questionnaire answers that are needed before a quote, beyond the questions themselves. */
function questionnaireComplete(answers: Record<string, string>): string[] {
  const missing: string[] = [];
  let probe: Record<string, string> = { ...answers };
  // Walk the outstanding questions in order; everything outstanding is missing.
  for (let i = 0; i < Object.keys(QUESTIONS).length; i++) {
    const next = nextQuestion(probe);
    if (next === null) break;
    missing.push(next);
    probe = { ...probe, [next]: '__probe__' };
  }
  return missing;
}

export function journeyStatus(
  answers: Record<string, string>,
  roof: MappedRoof | null,
  options: { roofPending?: boolean; quoted?: boolean } = {},
): JourneyView {
  const postcode =
    answers[JOURNEY_KEYS.postcode] ?? roof?.postcode ?? postcodeFrom(answers['address']);
  const roofPending = options.roofPending === true && roof === null;

  // With no assessment and none running, the mapping is absent: SunScan treats
  // that as low confidence and asks the visitor about the roof.
  const effective =
    roof || roofPending || answers['roof_confidence']
      ? answers
      : {
          ...answers,
          roof_confidence: answers['address'] ? 'low' : (answers['roof_confidence'] ?? ''),
        };
  const clean = Object.fromEntries(Object.entries(effective).filter(([, v]) => v !== ''));

  const missing = questionnaireComplete(clean);
  // While the roof is still being assessed, its confidence is not known yet:
  // skip the roof step for now and keep asking everything else.
  const askable = roofPending
    ? missing.filter((id) => QUESTIONS[id]?.step !== 'roof' || id === 'roof_shading')
    : missing;
  if (!postcode && answers['address']) missing.unshift('postcode');

  const nextId = !answers['address']
    ? 'address'
    : (askable.find((id) => id !== 'postcode') ?? null);
  const question = nextId ? QUESTIONS[nextId] : undefined;
  let prompt = question?.prompt ?? null;
  if (nextId === 'roof_confirmed' && roof) prompt = confirmationPrompt(roof);
  if (nextId === 'address')
    prompt = 'What is the address, including the postcode, you would like a quote for?';
  if (!postcode && answers['address'] && nextId === null) {
    prompt = 'What is the postcode of the property?';
  }

  const canQuote = missing.length === 0 && !roofPending && postcode !== null;
  const stage: JourneyStage = !answers['address']
    ? 'address'
    : options.quoted
      ? 'quoted'
      : canQuote
        ? 'quote_ready'
        : roofPending
          ? 'roof_pending'
          : 'questions';

  return {
    stage,
    nextQuestionId: nextId ?? (!postcode && answers['address'] ? 'postcode' : null),
    prompt,
    options: question?.options ?? null,
    multi: question?.multi === true,
    roof,
    roofPending,
    postcode,
    missing,
    canQuote,
  };
}

/** Questionnaire budget ids → the most the visitor said they would spend. */
const BUDGET_MAX_GBP: Record<string, number> = {
  under_6k: 6000,
  '6k_10k': 10000,
  '10k_15k': 15000,
  '15k_plus': 30000,
  unsure: 30000,
};

/**
 * The questionnaire's budget answer as the id of one of the tenant's budget
 * bands: the band with that id when the tenant has one, else the band whose
 * upper bound matches, else none (the engine then uses its generous default).
 */
export function budgetBandFor(
  answer: string | undefined,
  pricing: TenantPricing | null,
): string | null {
  if (!answer || !pricing) return null;
  if (pricing.budgetBands.some((b) => b.id === answer)) return answer;
  const max = BUDGET_MAX_GBP[answer];
  if (max === undefined) return null;
  return pricing.budgetBands.find((b) => b.maxGbp === max)?.id ?? null;
}

/** Everything the engine needs from the answers, or null if anything is missing. */
export function quoteAnswers(
  answers: Record<string, string>,
  roof: MappedRoof | null,
  pricing: TenantPricing | null,
): QuoteAnswers | null {
  const view = journeyStatus(answers, roof);
  if (!view.canQuote || !view.postcode) return null;

  const usageSource = answers['usage_source'] ?? null;
  const usage: QuoteUsage = {
    // A bill upload is not something a chat can do; its kWh is typed instead.
    source: usageSource === 'bill_ocr' ? 'manual_kwh' : usageSource,
    annualKwh: numberOf(answers['annual_kwh']),
    unitRatePence: null,
    exportTariffPence: null,
    monthlyCostGbp: numberOf(answers['monthly_cost']),
    householdSize: numberOf(answers['household_size']),
  };

  const confidence = (answers['roof_confidence'] ?? 'low') as 'high' | 'medium' | 'low';
  const lifestyle = (answers['lifestyle'] ?? '').split(',').filter((tag) => tag && tag !== 'none');

  return {
    postcode: view.postcode,
    roof: {
      pitchDeg: roof?.pitchDeg ?? 35,
      mcsOrientationDeg: roof?.mcsOrientationDeg ?? 0,
      // No assessment: v1's siteContext default, refined by the size answer.
      maxPanelCount: roof ? roof.maxPanelCount : 20,
      roofType: roof?.roofType ?? 'pitched',
      confidence: roof ? confidence : 'low',
    },
    roofFallback: {
      sizeBand: answers['roof_size'] ?? null,
      direction:
        answers['roof_direction'] ?? (roof?.facing ? FACING_TO_DIRECTION[roof.facing] : null),
      shading: answers['roof_shading'] ?? null,
    },
    usage,
    tariffType: answers['tariff_type'] ?? null,
    lifestyle,
    motivation: answers['motivation'] ?? null,
    existing: answers['existing_system'] ?? null,
    budgetBandId: budgetBandFor(answers['budget_band'], pricing),
  };
}

function numberOf(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
