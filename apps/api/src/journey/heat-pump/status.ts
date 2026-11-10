/**
 * Where a visitor is in a heat pump workflow. No roof and no SunScan: the
 * estimate needs the home's answers and a postcode read from the address.
 */

import type { Workflow } from '@sunny/contracts';

import { SKIPPED, type ResolvedFlow } from '../../flow/resolve.js';
import { QUESTIONS } from '../../questionnaire.js';
import { unasked, type WorkflowView } from '../../workflows/status.js';
import { resolvedFlowFor } from '../../workflows/tenant.js';
import { JOURNEY_KEYS, postcodeFrom } from '../journey.js';

const ADDRESS_PROMPT = 'What is the address, including the postcode, you would like a quote for?';
const POSTCODE_PROMPT = 'What is the full address of the property, including the postcode?';

/** The postcode the estimate uses: the one stored for the session, else the address's. */
export function heatPumpPostcode(answers: Record<string, string>): string | null {
  return answers[JOURNEY_KEYS.postcode] ?? postcodeFrom(answers['address']);
}

export function hpStatus(
  workflow: Workflow,
  answers: Record<string, string>,
  opts: { quoted?: boolean } = {},
): WorkflowView {
  const flow = resolvedFlowFor(workflow);
  // The bedrooms stand in for a floor area. An installer who removed the floor
  // area question still has the bedrooms asked.
  const probe =
    flow.question('hp_floor_area') || answers['hp_floor_area'] !== undefined
      ? answers
      : { ...answers, hp_floor_area: SKIPPED };
  return addressQuoteStatus(workflow, flow, answers, probe, opts);
}

/**
 * Where a visitor is in a quote workflow that needs a postcode from the
 * address and nothing else from outside (heat pump, battery). `probe` is the
 * answers as the flow should judge them (a stand-in question opened when the
 * question it stands in for was removed).
 */
export function addressQuoteStatus(
  workflow: Workflow,
  flow: ResolvedFlow,
  answers: Record<string, string>,
  probe: Record<string, string>,
  opts: { quoted?: boolean } = {},
): WorkflowView {
  const missing = flow.required(probe);
  const left = unasked(flow, probe);
  const postcode = heatPumpPostcode(answers);
  const needsPostcode = postcode === null && answers['address'] !== undefined;
  if (needsPostcode) missing.push('postcode');

  // An address without a postcode is asked again, once the rest is in.
  const nextQuestionId = left[0] ?? (needsPostcode ? 'address' : null);
  const next = nextQuestionId ? flow.question(nextQuestionId) : undefined;
  let prompt = next?.prompt ?? null;
  if (nextQuestionId === 'address') {
    if (needsPostcode && left.length === 0) prompt = POSTCODE_PROMPT;
    else if (prompt === QUESTIONS.address!.prompt) prompt = ADDRESS_PROMPT;
  }

  const ready = missing.length === 0 && left.length === 0 && postcode !== null;
  return {
    workflowId: workflow.id,
    stage: opts.quoted ? 'quoted' : ready ? 'quote_ready' : 'questions',
    nextQuestionId,
    prompt,
    options: next?.options ?? null,
    multi: next?.multi ?? false,
    optional: next?.optional === true,
    missing,
    ready,
    journey: null,
  };
}
