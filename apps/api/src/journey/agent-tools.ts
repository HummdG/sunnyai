/**
 * The quote journey as the assistant's tools.
 *
 * The model phrases questions and proposes answers; it never decides what comes
 * next or what anything costs. `get_quote_journey` names the next question (and
 * the sentence to confirm a mapped roof with), `save_answers` takes several
 * answers at once through the questionnaire's validators, and
 * `get_quote_options` builds the quote from stored state -- the same operations
 * the HTTP routes run (journey/service.ts).
 */

import type { PricingSource } from '@sunny/quote-engine';

import type { ToolContext, ToolResult } from '../agent/tools.js';
import { optionLabel } from '../questionnaire.js';

import type { Proposal } from './extract.js';
import { JOURNEY_KEYS } from './journey.js';
import {
  createQuote,
  journeyView,
  submitAnswers,
  sunscanRoofLookup,
  toQuoteCard,
  type JourneyDeps,
} from './service.js';

/** Where the quote tools find the tenant's pricing; set on the tool context by the chat route. */
export interface QuoteToolContext {
  pricing: PricingSource;
}

function depsFor(ctx: ToolContext): JourneyDeps | null {
  if (!ctx.quote) return null;
  return {
    store: ctx.store,
    pricing: ctx.quote.pricing,
    roof: sunscanRoofLookup(ctx.sunscan),
    now: () => Date.now(),
  };
}

const NOT_ENABLED: ToolResult = {
  ok: false,
  data: { enabled: false },
  summary: 'Quotes are not available on this deployment.',
};

/**
 * Keep the turn's working answers in step with what the journey stored, so the
 * end-of-turn write (agent.ts) neither re-adds an answer a correction removed
 * nor misses one the journey added.
 */
function mirror(ctx: ToolContext, answers: Record<string, string>): void {
  for (const key of Object.keys(ctx.answers)) {
    if (!(key in answers)) delete ctx.answers[key];
  }
  Object.assign(ctx.answers, answers);
}

/** Record the assessment a tool started as this session's roof. */
export async function linkAssessmentFromTool(
  ctx: ToolContext,
  assessmentId: string,
): Promise<void> {
  ctx.answers[JOURNEY_KEYS.assessmentId] = assessmentId;
  if (ctx.quote) {
    await ctx.store.mergeAnswers(ctx.tenant.id, ctx.sessionId, {
      [JOURNEY_KEYS.assessmentId]: assessmentId,
    });
  }
}

/**
 * Options as offered in chat. Reading a bill needs an upload the chat does not
 * have, so that route is not offered here (the visitor can type kWh instead).
 */
function chatOptions(options: readonly string[] | null): readonly string[] | null {
  return options ? options.filter((o) => o !== 'bill_ocr') : null;
}

/** Visitor-facing labels for the offered options, keyed by value. */
function labelsFor(options: readonly string[] | null): Record<string, string> | null {
  const offered = chatOptions(options);
  return offered ? Object.fromEntries(offered.map((o) => [o, optionLabel(o)])) : null;
}

export const QUOTE_TOOLS = [
  {
    name: 'get_quote_journey' as const,
    description:
      'Where the visitor is in getting a quote, and the ONE question to ask next (with its ' +
      'exact wording -- for a measured roof, a sentence for the visitor to confirm). Ask that ' +
      'question next, in your own warm words but without changing its meaning.',
    parameters: { type: 'object', properties: {}, required: [] },
    required: [],
    async run(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const deps = depsFor(ctx);
      if (!deps) return NOT_ENABLED;
      const view = await journeyView(deps, ctx.tenant.id, ctx.sessionId);
      return {
        ok: true,
        data: {
          stage: view.stage,
          nextQuestionId: view.nextQuestionId,
          ask: view.prompt,
          options: chatOptions(view.options),
          optionLabels: labelsFor(view.options),
          selectAllThatApply: view.multi,
          roofStillBeingMeasured: view.roofPending,
          roof: view.roof && {
            facing: view.roof.facing,
            pitchDeg: view.roof.pitchDeg,
            panelsThatFit: view.roof.maxPanelCount,
            confidence: view.roof.confidence,
          },
          outstanding: view.missing,
          readyForQuote: view.canQuote,
        },
        summary: view.canQuote
          ? 'Everything needed for a quote is in.'
          : `Next: ${view.prompt ?? view.nextQuestionId ?? 'nothing'}`,
      };
    },
  },
  {
    name: 'save_answers' as const,
    description:
      'Save every questionnaire answer the visitor just gave -- several at once if they gave ' +
      'several. Use the option values from get_quote_journey / get_questionnaire. Also pass ' +
      "the visitor's message so nothing they volunteered is missed. Invalid answers are " +
      'refused with the allowed values; a correction replaces the earlier answer.',
    parameters: {
      type: 'object',
      properties: {
        answers: {
          type: 'array',
          items: {
            type: 'object',
            properties: { questionId: { type: 'string' }, value: { type: 'string' } },
            required: ['questionId', 'value'],
          },
        },
        visitorMessage: { type: 'string' },
      },
      required: [],
    },
    required: [],
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const deps = depsFor(ctx);
      if (!deps) return NOT_ENABLED;
      const raw = Array.isArray(args['answers']) ? (args['answers'] as unknown[]) : [];
      const proposals: Proposal[] = raw
        .filter(
          (a): a is { questionId: string; value: string } =>
            typeof a === 'object' &&
            a !== null &&
            typeof (a as Record<string, unknown>)['questionId'] === 'string' &&
            typeof (a as Record<string, unknown>)['value'] === 'string',
        )
        .slice(0, 20)
        .map((a) => ({ questionId: a.questionId, value: a.value }));
      const message = typeof args['visitorMessage'] === 'string' ? args['visitorMessage'] : '';
      const result = await submitAnswers(deps, ctx.tenant.id, ctx.sessionId, {
        proposals,
        ...(message ? { text: message.slice(0, 500) } : {}),
      });
      mirror(ctx, result.answers);
      return {
        ok: result.rejected.length === 0,
        data: {
          saved: result.accepted,
          refused: result.rejected.map((r) => ({ questionId: r.questionId, reason: r.reason })),
          removedBecauseOfCorrection: result.removed.filter((k) => !k.startsWith('journey_')),
          nextQuestionId: result.journey.nextQuestionId,
          ask: result.journey.prompt,
          options: chatOptions(result.journey.options),
          optionLabels: labelsFor(result.journey.options),
          readyForQuote: result.journey.canQuote,
        },
        summary:
          `Saved ${result.accepted.map((a) => a.questionId).join(', ') || 'nothing'}.` +
          (result.journey.canQuote ? ' Ready for a quote.' : ''),
      };
    },
  },
  {
    name: 'get_quote_options' as const,
    description:
      'Build the quote once get_quote_journey says readyForQuote: three system options with ' +
      "the installer's prices, generation and savings. The widget shows them as cards, so " +
      'summarise in a sentence or two, recommend the highlighted one, and say the figures are ' +
      'indicative and subject to a survey. Never quote a figure that is not in this result.',
    parameters: { type: 'object', properties: {}, required: [] },
    required: [],
    async run(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const deps = depsFor(ctx);
      if (!deps) return NOT_ENABLED;
      const result = await createQuote(deps, ctx.tenant.id, ctx.sessionId);
      if (!result.ok) {
        return {
          ok: false,
          data: { readyForQuote: false, outstanding: result.missing, nextQuestionId: result.next },
          summary: 'A few more answers are needed first.',
        };
      }
      const quote = result.quote;
      ctx.events.push({ kind: 'quote', detail: { quote: toQuoteCard(quote) } });
      return {
        ok: true,
        data: {
          quoteId: quote.id,
          priced: quote.priced,
          options: quote.options.map((o) => ({
            label: o.label,
            recommended: o.isRecommended,
            panels: o.panelCount,
            kWp: o.systemKwp,
            battery: o.batteryType,
            price: o.priceGbp,
            priceLabel: o.priceLabel,
            yearlyGenerationKwh: o.annualGenerationKwh,
            yearlySavingsGbp: o.annualSavingsGbp,
            paybackYears: o.paybackYears,
          })),
          disclaimer: quote.disclaimer,
          warnings: quote.warnings,
        },
        summary: `Presented ${quote.options.length} options (indicative, subject to survey).`,
      };
    },
  },
];
