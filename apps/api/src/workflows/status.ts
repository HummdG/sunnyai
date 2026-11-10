/**
 * Where a visitor is in one workflow: the next question, and whether the
 * workflow has what it needs to finish (a quote, or a lead).
 */

import type { Workflow } from '@sunny/contracts';

import { journeyStatus, type JourneyStage, type JourneyView } from '../journey/journey.js';
import type { MappedRoof } from '../journey/roof.js';
import type { ResolvedFlow } from '../flow/resolve.js';

import { resolvedFlowFor } from './tenant.js';

export type WorkflowStage = JourneyStage | 'ready_for_lead' | 'done';

export interface WorkflowView {
  workflowId: string;
  stage: WorkflowStage;
  nextQuestionId: string | null;
  prompt: string | null;
  options: readonly string[] | null;
  multi: boolean;
  optional: boolean;
  missing: string[];
  ready: boolean;
  journey: JourneyView | null;
}

/**
 * The questions still to put to the visitor, in the flow's order, optional
 * ones included: an optional question is asked (with a Skip reply) rather than
 * dropped, and a skipped one (stored as 'skipped') counts as answered. Answers
 * Sunny sets itself are never asked.
 */
export function unasked(flow: ResolvedFlow, answers: Record<string, string>): string[] {
  return flow.outstanding(answers).filter((id) => !flow.bank.systemSet.has(id));
}

export function workflowStatus(
  workflow: Workflow,
  answers: Record<string, string>,
  roof: MappedRoof | null,
  opts: { roofPending?: boolean; quoted?: boolean } = {},
): WorkflowView {
  const flow = resolvedFlowFor(workflow);
  const { outcome } = workflow;

  if (outcome.kind === 'quote' && outcome.engine === 'solar') {
    const journey = journeyStatus(answers, roof, opts, flow);
    // The roof and postcode gates are the journey's. Once the quote could be
    // built, the optional questions left are still asked before it is.
    const optionalLeft = journey.canQuote
      ? unasked(flow, answers).filter((id) => flow.question(id)?.optional === true)
      : [];
    if (optionalLeft.length > 0) {
      const next = flow.question(optionalLeft[0]!)!;
      return {
        workflowId: workflow.id,
        stage: 'questions',
        nextQuestionId: next.id,
        prompt: next.prompt,
        options: next.options,
        multi: next.multi,
        optional: true,
        missing: journey.missing,
        ready: false,
        journey,
      };
    }
    const next = journey.nextQuestionId ? flow.question(journey.nextQuestionId) : undefined;
    return {
      workflowId: workflow.id,
      stage: journey.stage,
      nextQuestionId: journey.nextQuestionId,
      prompt: journey.prompt,
      options: journey.options,
      multi: journey.multi,
      optional: next?.optional === true,
      missing: journey.missing,
      ready: journey.canQuote,
      journey,
    };
  }

  // A lead outcome. The heat pump and battery engines have no quote of their
  // own yet (later phases), so until then they collect answers like a lead.
  const missing = flow.required(answers);
  const left = unasked(flow, answers);
  const nextQuestionId = left[0] ?? null;
  const next = nextQuestionId ? flow.question(nextQuestionId) : undefined;
  const ready = missing.length === 0 && left.length === 0;
  return {
    workflowId: workflow.id,
    stage: ready ? 'ready_for_lead' : 'questions',
    nextQuestionId,
    prompt: next?.prompt ?? null,
    options: next?.options ?? null,
    multi: next?.multi ?? false,
    optional: next?.optional === true,
    missing,
    ready,
    journey: null,
  };
}
