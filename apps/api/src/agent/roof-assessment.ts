/**
 * Measuring a visitor's roof from inside a conversation: what
 * `start_sunscan_assessment` does, shared with the workflow tools so an address
 * saved in a workflow starts the same assessment the same way.
 *
 * Kept apart from `tools.ts` so the workflow tools can call it without a
 * value-level import cycle through the tool surface.
 */

import { toRoofAssessmentSummary, type AssessmentRecord } from '@sunny/sunscan-adapter';

import { linkAssessmentFromTool } from '../journey/agent-tools.js';
import { JOURNEY_KEYS } from '../journey/journey.js';
import type { ToolContext, ToolResult } from './tools.js';

/** How long a turn waits for an assessment before handing it to the widget to poll. */
const SUNSCAN_WAIT_MS = 25_000;

/**
 * What the model is told about an assessment: the geometry and the engine's
 * own doubts, labelled indicative. No yield, no panel count, no price -- those
 * belong to `recommend_packages` and the installer's survey.
 */
export function sunscanResult(record: AssessmentRecord): ToolResult {
  const base = { assessmentId: record.id, status: record.status };
  if (record.status === 'queued' || record.status === 'running') {
    return {
      ok: true,
      data: {
        ...base,
        note: 'Still measuring; the result will appear in the chat when it is ready.',
      },
      summary: 'I have started measuring the roof; the result will appear here shortly.',
    };
  }
  if (record.status === 'failed' || !record.summary) {
    return {
      ok: false,
      data: { ...base, error: record.error },
      summary: record.error?.message ?? 'The roof could not be measured.',
    };
  }
  const s = record.summary;
  // The full RoofAssessmentSummary: the stable shape the quote journey reads
  // (usable area, per-plane geometry and capacity, main plane, flags).
  const data = toRoofAssessmentSummary(record) ?? { ...base, error: record.error };
  const where = s.bestFacing ? `, best facing ${s.bestFacing}` : '';
  const lead = s.reliable
    ? `I have measured the roof: about ${s.usableRoofAreaM2} m² usable, facing east to west${where}.`
    : `I have a rough roof measurement (low confidence): about ${s.usableRoofAreaM2} m² usable, facing east to west${where}.`;
  return { ok: true, data, summary: `${lead} ${s.label}.` };
}

/** One address however it is typed: case, commas and spacing aside. */
function sameAddress(a: string | undefined, b: string): boolean {
  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return a !== undefined && key(a) === key(b);
}

/** Start (or reuse) the roof assessment for an address the visitor gave. */
export async function startRoofAssessment(
  ctx: ToolContext,
  address: string | null,
): Promise<ToolResult> {
  if (!address) {
    return {
      ok: false,
      data: { error: 'address required' },
      summary: 'I need an address first.',
    };
  }
  if (!ctx.sunscanConnected || !ctx.sunscan) {
    return {
      ok: false,
      data: { connected: false, address },
      summary:
        'The roof assessment service is not connected in this environment, so I cannot run one.',
    };
  }
  // The model tends to call this again on later turns ("Yes, that looks
  // right"). The same address in the same conversation is the roof already
  // measured: reuse it, so the visitor sees one card, not a fresh one per
  // answer, and the house is not modelled (and paid for) again.
  const previousId = ctx.answers[JOURNEY_KEYS.assessmentId];
  const previous = previousId ? await ctx.sunscan.getAssessment(ctx.tenant.id, previousId) : null;
  if (
    previous &&
    previous.sessionId === ctx.sessionId &&
    previous.status !== 'failed' &&
    sameAddress(previous.target.address, address)
  ) {
    ctx.events.push({
      kind: 'sunscan',
      detail: {
        assessmentId: previous.id,
        status: previous.status,
        summary: previous.summary,
      },
    });
    return sunscanResult(previous);
  }
  const postcode = ctx.answers['postcode'] ?? null;
  const started = await ctx.sunscan.startAssessment(
    ctx.tenant.id,
    {
      address,
      ...(postcode && !address.toUpperCase().includes(postcode.toUpperCase()) ? { postcode } : {}),
    },
    { sessionId: ctx.sessionId },
  );
  // Most houses model in a few seconds. Waiting a little keeps the answer in
  // this turn; a slow one is reported as in progress and the widget polls.
  const record = (await ctx.sunscan.waitFor(ctx.tenant.id, started.id, SUNSCAN_WAIT_MS)) ?? started;
  // The quote journey picks the roof up from here (journey/service.ts).
  await linkAssessmentFromTool(ctx, record.id);
  ctx.events.push({
    kind: 'sunscan',
    detail: { assessmentId: record.id, status: record.status, summary: record.summary },
  });
  return sunscanResult(record);
}
