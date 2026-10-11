import type { DashboardUsage, ModelLatency, ModelUsage } from '@sunny/contracts';

import { percentile } from './latency.js';
import type { ModelCall } from './store.js';

/**
 * Turn the window's raw model calls into the dashboard's `usage` block.
 *
 * Kept out of the metrics route because the route is a wiring layer -- it
 * authenticates, resolves the window and reads the store -- while this is pure
 * arithmetic over an array, which makes it the part worth testing directly and
 * the part most likely to grow (costs, per-day breakdowns) without the route
 * growing with it.
 *
 * The input is the calls *already filtered to the window*: this function has no
 * notion of time, which is exactly the separation that keeps a second definition
 * of "in the window" from appearing here and disagreeing with the route's.
 */

/** The two percentiles §12 names. Named here so the pair cannot drift apart. */
const P50 = 0.5;
const P95 = 0.95;

/**
 * Separator for the group key.
 *
 * A NUL is used rather than a hyphen or a colon because it cannot occur in a
 * provider or model identifier, so two different `(provider, model)` pairs can
 * never collide into one group by having their names straddle the delimiter. The
 * parts are kept alongside the key anyway, so this is belt and braces rather
 * than the only thing holding the grouping together.
 */
const GROUP_SEPARATOR = '\u0000';

function latencyOf(calls: readonly ModelCall[]): ModelLatency {
  return {
    ttfbMsP50: percentile(
      calls.map((call) => call.ttfbMs),
      P50,
    ),
    ttfbMsP95: percentile(
      calls.map((call) => call.ttfbMs),
      P95,
    ),
    totalMsP50: percentile(
      calls.map((call) => call.totalMs),
      P50,
    ),
    totalMsP95: percentile(
      calls.map((call) => call.totalMs),
      P95,
    ),
  };
}

/** A model identifier compares as text, with "no model named" sorting first. */
function compareModel(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/**
 * Sum the tokens of the calls that reported any.
 *
 * Calls that reported none contribute nothing, and that is on purpose: absent is
 * not zero, so treating it as zero here would be the same arithmetic while
 * quietly asserting something untrue. `callsWithTokens` is what records how much
 * of the total was actually reported.
 */
function sumTokens(calls: readonly ModelCall[]): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const call of calls) {
    if (!call.usage) continue;
    inputTokens += call.usage.inputTokens;
    outputTokens += call.usage.outputTokens;
  }
  return { inputTokens, outputTokens };
}

export function summariseUsage(calls: readonly ModelCall[]): DashboardUsage {
  const groups = new Map<string, { provider: string; model: string | null; calls: ModelCall[] }>();
  for (const call of calls) {
    const key = `${call.provider}${GROUP_SEPARATOR}${call.model ?? ''}`;
    const existing = groups.get(key);
    if (existing) existing.calls.push(call);
    else groups.set(key, { provider: call.provider, model: call.model, calls: [call] });
  }

  const byModel: ModelUsage[] = [...groups.values()].map((group) => {
    const withTokens = group.calls.filter((call) => call.usage !== undefined);
    const { inputTokens, outputTokens } = sumTokens(group.calls);
    return {
      provider: group.provider,
      model: group.model,
      calls: group.calls.length,
      callsWithTokens: withTokens.length,
      inputTokens,
      outputTokens,
      latency: latencyOf(group.calls),
    };
  });

  // Most-used model first. The ties are broken by name rather than left to
  // insertion order: two responses over the same window must list the same rows
  // in the same order, and a `Map`'s order depends on the store's, which is not
  // a thing a reader should have to reproduce to compare two reports.
  byModel.sort(
    (a, b) =>
      b.calls - a.calls ||
      (a.provider === b.provider ? 0 : a.provider < b.provider ? -1 : 1) ||
      compareModel(a.model, b.model),
  );

  const withTokens = calls.filter((call) => call.usage !== undefined);
  const { inputTokens, outputTokens } = sumTokens(calls);

  return {
    calls: calls.length,
    callsWithTokens: withTokens.length,
    inputTokens,
    outputTokens,
    latency: latencyOf(calls),
    byModel,
  };
}
