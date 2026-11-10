/**
 * Where a visitor is in one workflow: the next question, and whether the
 * workflow has what it needs to finish (a quote, or a lead).
 */

import type { Workflow } from '@sunny/contracts';

import { journeyStatus, type JourneyStage, type JourneyView } from '../journey/journey.js';
import type { MappedRoof } from '../journey/roof.js';

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
  const nextQuestionId = flow.next(answers);
  const next = nextQuestionId ? flow.question(nextQuestionId) : undefined;
  const ready = missing.length === 0;
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
