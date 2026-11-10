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

import type { Workflow } from '@sunny/contracts';
import type { PricingSource } from '@sunny/quote-engine';

import type { ToolContext, ToolResult } from '../agent/tools.js';
import { SKIPPED, type ResolvedFlow } from '../flow/resolve.js';
import { optionLabel } from '../questionnaire.js';
import { DISCOVERY_ID, available, complete } from '../workflows/session.js';

import type { Proposal } from './extract.js';
import { createHeatPumpQuote, publishedHeatPumpPricing } from './heat-pump/service.js';
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
  /** Pins the brand assets a new quote's PDF prints (see JourneyDeps). */
  pinBrandAssets?: (tenantId: string, ids: string[]) => Promise<void>;
  log?: { warn: (object: object, message: string) => void };
}

export function depsFor(ctx: ToolContext): JourneyDeps | null {
  if (!ctx.quote) return null;
  return {
    store: ctx.store,
    pricing: ctx.quote.pricing,
    roof: sunscanRoofLookup(ctx.sunscan),
    now: () => Date.now(),
    // The turn's flow, so the journey and the tools agree on what is asked.
    flow: () => ctx.flow,
    tenant: () => ctx.tenant,
    ...(ctx.quote.pinBrandAssets ? { pinBrandAssets: ctx.quote.pinBrandAssets } : {}),
    ...(ctx.quote.log ? { log: ctx.quote.log } : {}),
  };
}

function isSolarQuote(w: Workflow): boolean {
  return w.enabled && w.outcome.kind === 'quote' && w.outcome.engine === 'solar';
}

/** The quote engines Sunny can price in chat. */
type PricedEngine = 'solar' | 'heat_pump';

function pricedEngine(w: Workflow): PricedEngine | null {
  if (w.outcome.kind !== 'quote') return null;
  return w.outcome.engine === 'solar' || w.outcome.engine === 'heat_pump' ? w.outcome.engine : null;
}

/**
 * What a quote may be built for now: the running workflow, when it is an
 * enabled quote Sunny can price (solar or heat pump), or, with nothing running
 * (or only discovery), a solar quote when one applies on this page. Else the
 * refusal.
 */
function quoteTarget(
  ctx: ToolContext,
):
  | { ok: true; engine: 'solar'; workflow: Workflow | null }
  | { ok: true; engine: 'heat_pump'; workflow: Workflow }
  | { ok: false; refusal: ToolResult } {
  const activeId = ctx.session.active?.workflowId;
  const running = activeId && activeId !== DISCOVERY_ID ? activeId : null;
  const active = running ? ctx.workflows.workflows.find((w) => w.id === running) : undefined;
  const engine = active ? pricedEngine(active) : null;
  // A workflow that ends in a lead (or an engine with no quote yet) is not priced here.
  if (active && !engine) {
    return {
      ok: false,
      refusal: {
        ok: false,
        data: { outcome: 'lead', workflow: { id: active.id, name: active.name } },
        summary: 'This one ends with the team getting in touch, not a quote.',
      },
    };
  }
  if (active && active.enabled && engine === 'heat_pump') {
    return { ok: true, engine, workflow: active };
  }
  const allowed = running
    ? active !== undefined && isSolarQuote(active)
    : available(ctx.workflows, ctx.pagePath).some(isSolarQuote);
  if (allowed) return { ok: true, engine: 'solar', workflow: active ?? null };
  return {
    ok: false,
    refusal: {
      ok: false,
      data: { quotesOffered: false },
      summary:
        engine === 'heat_pump'
          ? 'Heat pump quotes are not offered here right now.'
          : 'Solar quotes are not offered here right now.',
    },
  };
}

export const NOT_ENABLED: ToolResult = {
  ok: false,
  data: { enabled: false },
  summary: 'Quotes are not available on this deployment.',
};

/**
 * Keep the turn's working answers in step with what the journey stored, so the
 * end-of-turn write (agent.ts) neither re-adds an answer a correction removed
 * nor misses one the journey added.
 */
export function mirror(ctx: ToolContext, answers: Record<string, string>): void {
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
export function chatOptions(options: readonly string[] | null): readonly string[] | null {
  return options ? options.filter((o) => o !== 'bill_ocr') : null;
}

/**
 * The question Sunny is about to ask, with its answers as buttons the visitor can tap (`replies` is empty for a
 * question answered in their own words, which clears any buttons left from the last one). The last one a turn
 * emits is the question it ends on.
 */
export function offerReplies(
  ctx: ToolContext,
  questionId: string | null,
  options: readonly string[] | null,
  multi: boolean,
  opts: { flow?: ResolvedFlow; optional?: boolean } = {},
): void {
  const offered = chatOptions(options) ?? [];
  const label = labelOf(opts.flow ?? ctx.flow, questionId);
  const replies = offered.map((value) => ({ value, label: label(value) }));
  // An optional question can be passed over with one tap.
  if (opts.optional && questionId) replies.push({ value: SKIPPED, label: 'Skip' });
  ctx.events.push({ kind: 'quick_replies', detail: { questionId, multi, replies } });
}

/** How an answer to a question reads to the visitor: the installer's label, else Sunny's. */
function labelOf(flow: ResolvedFlow, questionId: string | null): (value: string) => string {
  const question = questionId ? flow.question(questionId) : undefined;
  return question ? (value) => question.label(value) : optionLabel;
}

/** Visitor-facing labels for the offered options, keyed by value. */
export function labelsFor(
  ctx: ToolContext,
  questionId: string | null,
  options: readonly string[] | null,
  flow: ResolvedFlow = ctx.flow,
): Record<string, string> | null {
  const offered = chatOptions(options);
  const label = labelOf(flow, questionId);
  return offered ? Object.fromEntries(offered.map((o) => [o, label(o)])) : null;
}

function notReady(result: { missing: string[]; next: string | null }): ToolResult {
  return {
    ok: false,
    data: { readyForQuote: false, outstanding: result.missing, nextQuestionId: result.next },
    summary: 'A few more answers are needed first.',
  };
}

/** The workflow that asked for a quote is finished: never re-quoted, never resumed. */
async function completeQuoted(ctx: ToolContext, quoteId: string): Promise<void> {
  if (ctx.session.active && ctx.session.active.workflowId !== DISCOVERY_ID) {
    ctx.session = complete(ctx.session, new Date().toISOString(), { quoteId });
    await ctx.store.saveWorkflowState(ctx.tenant.id, ctx.sessionId, ctx.session);
  }
}

async function heatPumpOptions(
  ctx: ToolContext,
  deps: JourneyDeps,
  workflow: Workflow,
): Promise<ToolResult> {
  const result = await createHeatPumpQuote(
    { ...deps, heatPumpPricing: publishedHeatPumpPricing(deps.store) },
    ctx.tenant.id,
    ctx.sessionId,
    workflow,
  );
  if (!result.ok) return notReady(result);
  const quote = result.quote;
  ctx.events.push({ kind: 'quote', detail: { quote: toQuoteCard(quote) } });
  await completeQuoted(ctx, quote.id);
  return {
    ok: true,
    data: {
      quoteId: quote.id,
      kind: 'heat_pump',
      priced: quote.priced,
      recommendedKw: quote.estimate.recommendedKw,
      grantEligible: quote.estimate.bus.eligible,
      grantNotes: quote.estimate.bus.reasons,
      options: quote.options.map((o) => ({
        label: o.label,
        recommended: o.isRecommended,
        kW: o.outputKw,
        price: o.priceGbp,
        grant: o.grantGbp,
        priceAfterGrant: o.priceAfterGrantGbp,
        priceLabel: o.priceLabel,
        yearlyRunningCostGbp: o.runningCostGbp,
        yearlyCurrentCostGbp: o.currentCostGbp,
        yearlySavingsGbp: o.annualSavingsGbp,
      })),
      assumptions: quote.estimate.assumptions,
      disclaimer: quote.disclaimer,
      warnings: quote.warnings,
    },
    summary:
      `Presented ${quote.options.length} heat pump options. The figures are indicative and ` +
      'subject to a survey, and the Boiler Upgrade Scheme grant is shown separately from the price.',
  };
}

export const QUOTE_TOOLS = [
  {
    name: 'get_quote_journey' as const,
    description:
      'Where the visitor is in getting a quote, and the ONE question to ask next (with its ' +
      'exact wording -- for a measured roof, a sentence for the visitor to confirm). Ask that ' +
      'question next, in your own warm words but without changing its meaning. When it has ' +
      'options, the visitor sees them as buttons under your message: do not list them.',
    parameters: { type: 'object', properties: {}, required: [] },
    required: [],
    async run(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const deps = depsFor(ctx);
      if (!deps) return NOT_ENABLED;
      const view = await journeyView(deps, ctx.tenant.id, ctx.sessionId);
      offerReplies(ctx, view.nextQuestionId, view.canQuote ? null : view.options, view.multi);
      return {
        ok: true,
        data: {
          stage: view.stage,
          nextQuestionId: view.nextQuestionId,
          ask: view.prompt,
          options: chatOptions(view.options),
          optionLabels: labelsFor(ctx, view.nextQuestionId, view.options),
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
      offerReplies(
        ctx,
        result.journey.nextQuestionId,
        result.journey.canQuote ? null : result.journey.options,
        result.journey.multi,
      );
      return {
        ok: result.rejected.length === 0,
        data: {
          saved: result.accepted,
          refused: result.rejected.map((r) => ({ questionId: r.questionId, reason: r.reason })),
          removedBecauseOfCorrection: result.removed.filter((k) => !k.startsWith('journey_')),
          nextQuestionId: result.journey.nextQuestionId,
          ask: result.journey.prompt,
          options: chatOptions(result.journey.options),
          optionLabels: labelsFor(ctx, result.journey.nextQuestionId, result.journey.options),
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
      'Build the quote once get_workflow_step or save_workflow_answers says readyForQuote: ' +
      "up to three options with the installer's prices and savings (solar panels, or a heat " +
      'pump with the Boiler Upgrade Scheme grant shown separately). The widget ' +
      'shows them as cards, so summarise in a sentence or two, recommend the highlighted one, ' +
      'and say the figures are indicative and subject to a survey. Never quote a figure that ' +
      'is not in this result.',
    parameters: { type: 'object', properties: {}, required: [] },
    required: [],
    async run(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const deps = depsFor(ctx);
      if (!deps) return NOT_ENABLED;
      const target = quoteTarget(ctx);
      if (!target.ok) return target.refusal;
      if (target.engine === 'heat_pump') return heatPumpOptions(ctx, deps, target.workflow);
      const result = await createQuote(deps, ctx.tenant.id, ctx.sessionId);
      if (!result.ok) return notReady(result);
      const quote = result.quote;
      ctx.events.push({ kind: 'quote', detail: { quote: toQuoteCard(quote) } });
      await completeQuoted(ctx, quote.id);
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
