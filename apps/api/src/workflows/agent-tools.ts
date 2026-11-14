/**
 * The installer's workflows as the assistant's tools.
 *
 * The server decides what is asked; the model only words it. `start_workflow`
 * opens one of the workflows that apply on this page (or the short discovery
 * chat), `get_workflow_step` names the one question to ask next,
 * `save_workflow_answers` stores what the visitor said through the same
 * validators as the quote journey, and `pause_workflow` sets a workflow aside
 * with its answers kept. Every change to the visitor's place among the
 * workflows is written to `ctx.session` and saved straight away.
 */

import type { Workflow } from '@sunny/contracts';

import type { ToolContext, ToolResult } from '../agent/tools.js';
import { startRoofAssessment } from '../agent/roof-assessment.js';
import { DISCOVERY } from '../flow/banks.js';
import { lookUpHome } from '../homedata/index.js';
import { resolveFlow, type ResolvedFlow } from '../flow/resolve.js';
import { chatOptions, depsFor, labelsFor, mirror, offerReplies } from '../journey/agent-tools.js';
import type { Proposal } from '../journey/extract.js';
import { quoteKind } from '../journey/quote-kinds.js';
import {
  loadJourney,
  submitAnswers,
  sunscanRoofLookup,
  type JourneyDeps,
} from '../journey/service.js';

import {
  DISCOVERY_ID,
  available,
  cloneSession,
  pause,
  start,
  suggest,
  type WorkflowSession,
} from './session.js';
import { unasked, workflowStatus, type WorkflowView } from './status.js';
import { resolvedFlowFor } from './tenant.js';

const DISCOVERY_NAME = 'Finding the right help';
const DISCOVERY_DESCRIPTION =
  'A couple of quick questions to find out what the visitor is looking into, then the right workflow.';

/** What is running: a workflow from the set, or the discovery questions. */
type Running =
  | { kind: 'workflow'; workflow: Workflow; flow: ResolvedFlow }
  | { kind: 'discovery'; flow: ResolvedFlow };

function discoveryFlow(): ResolvedFlow {
  return resolveFlow(null, DISCOVERY);
}

function running(ctx: ToolContext): Running | null {
  const id = ctx.session.active?.workflowId;
  if (!id) return null;
  if (id === DISCOVERY_ID) return { kind: 'discovery', flow: discoveryFlow() };
  const workflow = ctx.workflows.workflows.find((w) => w.id === id);
  return workflow ? { kind: 'workflow', workflow, flow: resolvedFlowFor(workflow) } : null;
}

function refOf(r: Running): { id: string; name: string } {
  return r.kind === 'workflow'
    ? { id: r.workflow.id, name: r.workflow.name }
    : { id: DISCOVERY_ID, name: DISCOVERY_NAME };
}

function isSolarQuote(r: Running): boolean {
  return (
    r.kind === 'workflow' &&
    r.workflow.outcome.kind === 'quote' &&
    r.workflow.outcome.engine === 'solar'
  );
}

/** A workflow that ends in a quote Sunny builds in chat (solar, heat pump or battery). */
function isQuote(r: Running): boolean {
  return r.kind === 'workflow' && r.workflow.outcome.kind === 'quote';
}

/** A quote other than solar (heat pump, battery): its address is not a roof to measure. */
function isNonSolarQuote(r: Running): boolean {
  return isQuote(r) && !isSolarQuote(r);
}

/** Discovery can be offered once, when the installer has it on. */
function discoveryOpen(ctx: ToolContext): boolean {
  return ctx.workflows.discovery.enabled && ctx.session.discovery.status === 'none';
}

/** What the visitor can start on this page, with discovery when it is still open. */
function startable(ctx: ToolContext): Array<{ id: string; name: string; description: string }> {
  const list = available(ctx.workflows, ctx.pagePath).map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
  }));
  if (discoveryOpen(ctx)) {
    list.push({ id: DISCOVERY_ID, name: DISCOVERY_NAME, description: DISCOVERY_DESCRIPTION });
  }
  return list;
}

async function saveSession(ctx: ToolContext, session: WorkflowSession): Promise<void> {
  ctx.session = session;
  await ctx.store.saveWorkflowState(ctx.tenant.id, ctx.sessionId, session);
}

/**
 * The journey operations, run against the running flow. A workflow does not
 * need the quote's pricing to ask its questions, so it runs without one (the
 * roof's panel size then falls back to a standard panel).
 */
function depsOn(ctx: ToolContext, flow: ResolvedFlow): JourneyDeps {
  const base: JourneyDeps = depsFor(ctx) ?? {
    store: ctx.store,
    pricing: { forTenant: () => Promise.resolve(null) },
    roof: sunscanRoofLookup(ctx.sunscan),
    now: () => Date.now(),
    tenant: () => ctx.tenant,
  };
  return { ...base, flow: () => flow };
}

interface Step {
  view: WorkflowView;
  roofPending: boolean;
  roof: Awaited<ReturnType<typeof loadJourney>>['roof'];
}

async function stepOf(ctx: ToolContext, deps: JourneyDeps, r: Running): Promise<Step> {
  const { answers, roof, pending } = await loadJourney(deps, ctx.tenant.id, ctx.sessionId);
  if (r.kind === 'workflow') {
    // Quoted once this session holds a quote from the workflow's own engine.
    const outcome = r.workflow.outcome;
    const quoted =
      outcome.kind === 'quote' &&
      (await ctx.store.listQuotes(ctx.tenant.id, ctx.sessionId)).some(
        (q) => quoteKind(q) === outcome.engine,
      );
    return {
      view: workflowStatus(r.workflow, answers, roof, { roofPending: pending, quoted }),
      roofPending: pending && roof === null,
      roof,
    };
  }
  // Discovery: its own short bank, finished once nothing is left to ask.
  const missing = r.flow.required(answers);
  const left = unasked(r.flow, answers);
  const ready = missing.length === 0 && left.length === 0;
  const nextQuestionId = left[0] ?? null;
  const next = nextQuestionId ? r.flow.question(nextQuestionId) : undefined;
  return {
    view: {
      workflowId: DISCOVERY_ID,
      stage: ready ? 'done' : 'questions',
      nextQuestionId,
      prompt: next?.prompt ?? null,
      options: next?.options ?? null,
      multi: next?.multi ?? false,
      optional: next?.optional === true,
      missing,
      ready,
      journey: null,
    },
    roofPending: false,
    roof: null,
  };
}

/** Offer the step's answers as buttons and describe it for the model. */
function present(ctx: ToolContext, r: Running, step: Step): Record<string, unknown> {
  const { view } = step;
  const readyForQuote = isQuote(r) && view.ready;
  const offered = readyForQuote ? null : view.options;
  offerReplies(ctx, view.nextQuestionId, offered, view.multi, {
    flow: r.flow,
    optional: view.optional,
  });
  const { journey: _journey, ...rest } = view;
  return {
    workflow: refOf(r),
    active: refOf(r).id,
    ...rest,
    ask: view.prompt,
    options: chatOptions(view.options),
    optionLabels: labelsFor(ctx, view.nextQuestionId, view.options, r.flow),
    selectAllThatApply: view.multi,
    outstanding: view.missing,
    readyForQuote,
    readyForLead: view.stage === 'ready_for_lead',
    // A quote the answers rule out offers the solar workflow, when it runs here.
    ...(view.stage === 'not_suitable' ? notSuitable(ctx) : {}),
    ...(isSolarQuote(r)
      ? {
          roofStillBeingMeasured: step.roofPending,
          roof: step.roof && {
            facing: step.roof.facing,
            pitchDeg: step.roof.pitchDeg,
            panelsThatFit: step.roof.maxPanelCount,
            confidence: step.roof.confidence,
          },
        }
      : {}),
  };
}

/** The solar workflow to suggest instead, when it is available on this page. */
function notSuitable(ctx: ToolContext): Record<string, unknown> {
  const solar = available(ctx.workflows, ctx.pagePath).find(
    (w) => w.outcome.kind === 'quote' && w.outcome.engine === 'solar',
  );
  return { notSuitable: true, ...(solar ? { suggestWorkflowId: solar.id } : {}) };
}

function summaryOf(r: Running, view: WorkflowView): string {
  if (view.stage === 'not_suitable') return view.prompt ?? 'This quote does not suit the home.';
  if (view.ready && isQuote(r)) return 'Everything needed for a quote is in.';
  if (view.stage === 'ready_for_lead' && !view.nextQuestionId) {
    return 'Everything this needs is in. Ask for their details to pass on.';
  }
  return `Next: ${view.prompt ?? view.nextQuestionId ?? 'nothing'}`;
}

function nothingRunning(ctx: ToolContext): ToolResult {
  return {
    ok: true,
    data: { workflow: null, active: null, available: startable(ctx) },
    summary: 'Nothing is running. These can be started.',
  };
}

async function currentStep(ctx: ToolContext): Promise<ToolResult> {
  const r = running(ctx);
  if (!r) return nothingRunning(ctx);
  const deps = depsOn(ctx, r.flow);
  const step = await stepOf(ctx, deps, r);
  return { ok: true, data: present(ctx, r, step), summary: summaryOf(r, step.view) };
}

/**
 * The current step, as `get_workflow_step` gives it, buttons included. The
 * turn calls it itself when the model left a running workflow's question
 * without its buttons (an FAQ answered mid-workflow).
 */
export const offerCurrentStep = currentStep;

/**
 * The running workflow (or discovery) and its current step, for the turn's
 * `<workflow_state>`. Read the same way the tools read it (roof included), and
 * pushes nothing to the visitor.
 */
export async function activeStep(
  ctx: ToolContext,
): Promise<{ workflow: { id: string; name: string }; step: WorkflowView } | null> {
  const r = running(ctx);
  if (!r) return null;
  const step = await stepOf(ctx, depsOn(ctx, r.flow), r);
  return { workflow: refOf(r), step: step.view };
}

function refuse(ctx: ToolContext, reason: string): ToolResult {
  return {
    ok: false,
    data: { workflow: null, reason, available: startable(ctx) },
    summary: reason,
  };
}

/**
 * Starting a real workflow closes discovery rather than parking it: discovery
 * is not something to resume. It counts as done when the visitor said what
 * they are interested in, else as skipped.
 */
function closeDiscovery(ctx: ToolContext, s: WorkflowSession): WorkflowSession {
  const copy = cloneSession(s);
  const wasAsking = copy.active?.workflowId === DISCOVERY_ID;
  if (wasAsking) copy.active = null;
  copy.paused = copy.paused.filter((p) => p.workflowId !== DISCOVERY_ID);
  if (wasAsking || copy.discovery.status === 'asking') {
    copy.discovery.status = ctx.answers['disc_interest'] ? 'done' : 'skipped';
  }
  return copy;
}

/**
 * Measure an address the journey just accepted, as start_sunscan_assessment
 * would. Null when no address was accepted, SunScan is off, or the workflow is
 * a quote other than solar (it has no roof to measure).
 */
async function measureNewAddress(
  ctx: ToolContext,
  r: Running,
  result: Awaited<ReturnType<typeof submitAnswers>>,
): Promise<Awaited<ReturnType<typeof startRoofAssessment>> | null> {
  const address = result.accepted.find((a) => a.questionId === 'address');
  return address && ctx.sunscan && !isNonSolarQuote(r)
    ? startRoofAssessment(ctx, result.answers['address'] ?? address.value)
    : null;
}

/**
 * Look the home up as soon as a quote workflow takes its address: Google's
 * roof for solar, the energy certificates for a heat pump. What it finds is
 * saved as answers, so the questions it answers are never asked. Returns the
 * sentence for the assistant to say once, or null when nothing was found.
 */
async function lookUpNewAddress(
  ctx: ToolContext,
  r: Running,
  result: Awaited<ReturnType<typeof submitAnswers>>,
): Promise<string | null> {
  const address = result.accepted.find((a) => a.questionId === 'address');
  if (!address || !ctx.homeData || r.kind !== 'workflow') return null;
  const outcome = r.workflow.outcome;
  if (outcome.kind !== 'quote') return null;
  const found = await lookUpHome(
    ctx.homeData,
    outcome.engine,
    result.answers['address'] ?? address.value,
    result.answers,
    { warn: (object, message) => ctx.quote?.log?.warn(object, message) },
  );
  if (Object.keys(found.patch).length > 0 || found.removed.length > 0) {
    const updated = await ctx.store.mergeAnswers(
      ctx.tenant.id,
      ctx.sessionId,
      found.patch,
      found.removed,
    );
    const answers = updated.answers ?? { ...result.answers, ...found.patch };
    for (const key of found.removed) delete answers[key];
    mirror(ctx, answers);
  }
  return found.found;
}

/** An address in the visitor's words, when the running flow asks for one and has none yet. */
function volunteeredAddress(ctx: ToolContext, flow: ResolvedFlow, message: string): string | null {
  return flow.question('address') && !ctx.answers['address'] ? addressIn(message) : null;
}

/**
 * Store an address the visitor gave in the message that started the workflow
 * (a "solar quote for 164 Norwich Drive, NR4 7TJ"), and start measuring it, so
 * the workflow never asks for it.
 */
async function captureOpeningAddress(
  ctx: ToolContext,
  r: Running,
): Promise<{
  roofAssessment: Awaited<ReturnType<typeof startRoofAssessment>> | null;
  homeRecords: string | null;
}> {
  const address = volunteeredAddress(ctx, r.flow, ctx.visitorMessage ?? '');
  if (!address) return { roofAssessment: null, homeRecords: null };
  const result = await submitAnswers(depsOn(ctx, r.flow), ctx.tenant.id, ctx.sessionId, {
    proposals: [{ questionId: 'address', value: address }],
  });
  mirror(ctx, result.answers);
  const homeRecords = await lookUpNewAddress(ctx, r, result);
  return { roofAssessment: await measureNewAddress(ctx, r, result), homeRecords };
}

function parseProposals(args: Record<string, unknown>): Proposal[] {
  const raw = Array.isArray(args['answers']) ? (args['answers'] as unknown[]) : [];
  return raw
    .filter(
      (a): a is { questionId: string; value: string } =>
        typeof a === 'object' &&
        a !== null &&
        typeof (a as Record<string, unknown>)['questionId'] === 'string' &&
        typeof (a as Record<string, unknown>)['value'] === 'string',
    )
    .slice(0, 20)
    .map((a) => ({ questionId: a.questionId, value: a.value }));
}

/** A house number ("164", "12a") or a house name ("Rose Cottage") opening an address. */
const HOUSE =
  /\b(?:\d+[a-z]?,?\s+[A-Za-z]|[A-Z][a-z]+\s+(?:Cottage|House|Farm|Lodge|Barn|Manor|Hall|Court|Mill|Villa|Bungalow)\b)/;

/** A street-type word, which a numbered address names before its postcode. */
const STREET =
  /\b(?:road|rd|street|st|lane|ln|drive|dr|avenue|ave|close|way|crescent|court|place|grove|gardens|terrace|hill|park|row|mews|walk)\b/i;

const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

/**
 * A UK address in the visitor's own words: from the house number or name up
 * to and including the postcode. Null without a postcode, or without a house.
 */
export function addressIn(message: string): string | null {
  const text = message.replace(/\s+/g, ' ').trim().slice(0, 300);
  const postcode = POSTCODE.exec(text);
  if (!postcode) return null;
  const upTo = text.slice(0, postcode.index + postcode[0].length);
  // A house number, or a house name, must come before the postcode: a bare
  // postcode ("my postcode is NR4 7TJ") is not an address to measure.
  const start = HOUSE.exec(upTo);
  if (!start) return null;
  const address = upTo.slice(start.index).trim();
  // A bare number before a word is only a house number when a street follows
  // ("164 Norwich Drive"), not a count ("I have 4 bedrooms").
  if (/^\d/.test(address) && !STREET.test(address.slice(0, -postcode[0].length))) return null;
  return address.length > postcode[0].length + 3 ? address : null;
}

export const WORKFLOW_TOOLS = [
  {
    name: 'start_workflow' as const,
    description:
      'Start one of the workflows that apply on this page, by id (or "discovery" for a couple ' +
      'of questions to find out what the visitor wants). Starting another sets the running one ' +
      'aside with its answers kept, and starting a paused one resumes it. Returns the first ' +
      'question to ask, like get_workflow_step.',
    parameters: {
      type: 'object',
      properties: { workflowId: { type: 'string' } },
      required: ['workflowId'],
    },
    required: ['workflowId'],
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const id = typeof args['workflowId'] === 'string' ? args['workflowId'].trim() : '';
      const now = new Date().toISOString();

      if (id === DISCOVERY_ID) {
        if (!discoveryOpen(ctx)) {
          return refuse(ctx, 'Discovery is not available now. Pick one of these instead.');
        }
        const started = start(ctx.session, DISCOVERY_ID, now);
        const session = cloneSession(started.session);
        session.discovery.status = 'asking';
        await saveSession(ctx, session);
        const step = await currentStep(ctx);
        return {
          ...step,
          data: {
            ...(step.data as Record<string, unknown>),
            pausedOther: started.pausedOther,
            resumed: false,
          },
        };
      }

      const workflow = available(ctx.workflows, ctx.pagePath).find((w) => w.id === id);
      if (!workflow) {
        return refuse(ctx, 'That workflow is not available on this page. Pick one of these.');
      }
      const fromDiscovery = ctx.session.active?.workflowId === DISCOVERY_ID;
      const started = start(closeDiscovery(ctx, ctx.session), workflow.id, now);
      await saveSession(ctx, started.session);
      // The rest of this turn (labels, a lead filed now) runs on this workflow.
      ctx.flow = resolvedFlowFor(workflow);
      const { roofAssessment, homeRecords } = await captureOpeningAddress(ctx, {
        kind: 'workflow',
        workflow,
        flow: ctx.flow,
      });
      const step = await currentStep(ctx);
      return {
        ...step,
        data: {
          ...(step.data as Record<string, unknown>),
          pausedOther: fromDiscovery ? null : started.pausedOther,
          resumed: started.resumed,
          ...(roofAssessment
            ? { roofAssessment: { ok: roofAssessment.ok, ...(roofAssessment.data as object) } }
            : {}),
          ...(homeRecords ? { sayFirst: homeRecords } : {}),
        },
      };
    },
  },
  {
    name: 'get_workflow_step' as const,
    description:
      'Where the visitor is in the running workflow, and the ONE question to ask next, with its ' +
      'exact wording. Ask it in your own warm words without changing its meaning. When it has ' +
      'options, the visitor sees them as buttons under your message: do not list them. With ' +
      'nothing running, it lists the workflows that can be started.',
    parameters: { type: 'object', properties: {}, required: [] },
    required: [],
    async run(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      return currentStep(ctx);
    },
  },
  {
    name: 'save_workflow_answers' as const,
    description:
      'Save every answer the visitor just gave to the running workflow, several at once if they ' +
      "gave several, using the option values from get_workflow_step. Also pass the visitor's " +
      'message so nothing they volunteered is missed. Invalid answers are refused with the ' +
      'allowed values; a correction replaces the earlier answer. Returns the next question.',
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
      const r = running(ctx);
      if (!r) {
        return {
          ...nothingRunning(ctx),
          ok: false,
          summary: 'Nothing is running to save answers to. Start a workflow first.',
        };
      }
      const deps = depsOn(ctx, r.flow);
      const message = typeof args['visitorMessage'] === 'string' ? args['visitorMessage'] : '';
      const proposals = parseProposals(args);
      // An address the visitor volunteered (the answer reader leaves addresses alone).
      const volunteered = proposals.some((p) => p.questionId === 'address')
        ? null
        : volunteeredAddress(ctx, r.flow, message);
      if (volunteered) proposals.push({ questionId: 'address', value: volunteered });
      // The visitor's words answer the question this workflow just asked, which
      // can be an optional one the quote journey alone would not name.
      const asked = message ? (await stepOf(ctx, deps, r)).view.nextQuestionId : null;
      const result = await submitAnswers(deps, ctx.tenant.id, ctx.sessionId, {
        proposals,
        ...(message ? { current: asked } : {}),
        ...(message ? { text: message.slice(0, 500) } : {}),
      });
      mirror(ctx, result.answers);

      // A new address is looked up and measured straight away.
      const homeRecords = await lookUpNewAddress(ctx, r, result);
      const roofAssessment = await measureNewAddress(ctx, r, result);

      const step = await stepOf(ctx, deps, r);
      let suggestion: { workflowId: string; name: string } | null = null;
      if (r.kind === 'discovery' && step.view.ready) {
        const found = suggest(ctx.workflows, ctx.answers, ctx.pagePath);
        const session = cloneSession(ctx.session);
        session.active = null;
        session.discovery = { status: 'done', suggestedWorkflowId: found?.id ?? null };
        await saveSession(ctx, session);
        suggestion = found ? { workflowId: found.id, name: found.name } : null;
      }

      const data = present(ctx, r, step);
      const saved = result.accepted.map((a) => a.questionId).join(', ') || 'nothing';
      return {
        ok: result.rejected.length === 0,
        data: {
          ...data,
          saved: result.accepted,
          refused: result.rejected.map((x) => ({ questionId: x.questionId, reason: x.reason })),
          removedBecauseOfCorrection: result.removed.filter((k) => !k.startsWith('journey_')),
          ...(roofAssessment
            ? { roofAssessment: { ok: roofAssessment.ok, ...(roofAssessment.data as object) } }
            : {}),
          ...(homeRecords ? { sayFirst: homeRecords } : {}),
          ...(r.kind === 'discovery' ? { suggest: suggestion } : {}),
          // Finished discovery is no longer running.
          ...(r.kind === 'discovery' && step.view.ready ? { active: null } : {}),
        },
        summary:
          `Saved ${saved}.` +
          (data['readyForQuote'] === true ? ' Ready for a quote.' : '') +
          (data['readyForLead'] === true ? ' Ready to pass on to the team.' : '') +
          (step.view.stage === 'not_suitable' ? ` ${summaryOf(r, step.view)}` : '') +
          (r.kind === 'discovery' && step.view.ready
            ? suggestion
              ? ` Suggest: ${suggestion.name}.`
              : ' Nothing to suggest yet.'
            : ''),
      };
    },
  },
  {
    name: 'pause_workflow' as const,
    description:
      'Set the running workflow aside when the visitor wants to stop or talk about something ' +
      'else. Their answers are kept, and starting it again later carries on where it stopped.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: [],
    },
    required: [],
    async run(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const r = running(ctx);
      const active = ctx.session.active;
      if (!active) {
        return {
          ok: false,
          data: { workflow: null, paused: null },
          summary: 'Nothing is running.',
        };
      }
      if (active.workflowId === DISCOVERY_ID) {
        // Discovery is not resumed later: stopping it ends it.
        const session = cloneSession(ctx.session);
        session.active = null;
        session.discovery.status = ctx.answers['disc_interest'] ? 'done' : 'skipped';
        await saveSession(ctx, session);
      } else {
        await saveSession(ctx, pause(ctx.session, new Date().toISOString()));
      }
      return {
        ok: true,
        data: {
          workflow: r ? refOf(r) : { id: active.workflowId, name: active.workflowId },
          paused: active.workflowId,
          answersKept: true,
        },
        summary: 'Paused. Answers kept.',
      };
    },
  },
];
