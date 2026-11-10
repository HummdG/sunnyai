/**
 * Where a visitor is in a battery workflow. A battery quote is a retrofit for a
 * home that already has solar: a home without solar is not suitable, and is
 * pointed at a solar and battery quote instead. No roof and no SunScan.
 */

import type { Workflow } from '@sunny/contracts';

import { SKIPPED } from '../../flow/resolve.js';
import type { WorkflowView } from '../../workflows/status.js';
import { resolvedFlowFor } from '../../workflows/tenant.js';
import { addressQuoteStatus } from '../heat-pump/status.js';

export const BATTERY_NOT_SUITABLE =
  'A battery quote is for homes that already have solar panels. I can work out a solar and battery quote instead.';

/** Whether the answers rule a battery retrofit out: the home has no solar. */
export function batteryNotSuitable(answers: Record<string, string>): boolean {
  return answers['existing_system'] === 'none';
}

export function batteryStatus(
  workflow: Workflow,
  answers: Record<string, string>,
  opts: { quoted?: boolean } = {},
): WorkflowView {
  const flow = resolvedFlowFor(workflow);
  if (!opts.quoted && batteryNotSuitable(answers)) {
    return {
      workflowId: workflow.id,
      stage: 'not_suitable',
      nextQuestionId: null,
      prompt: BATTERY_NOT_SUITABLE,
      options: null,
      multi: false,
      optional: false,
      missing: [],
      ready: false,
      journey: null,
    };
  }
  // The panel count stands in for the system size. An installer who removed
  // the size question still has the panels asked.
  const probe =
    flow.question('bat_pv_kwp') || answers['bat_pv_kwp'] !== undefined
      ? answers
      : { ...answers, bat_pv_kwp: SKIPPED };
  return addressQuoteStatus(workflow, flow, answers, probe, opts);
}
