/**
 * Percentiles over a set of measured durations.
 *
 * ## Nearest rank, and why not interpolation
 *
 * There is more than one way to turn a list of numbers into "the p95", and they
 * disagree with each other. This uses the **nearest-rank** definition: sort the
 * values, take the ⌈p·n⌉-th of them, and report that value. No two measurements
 * are blended, so the number reported is always a latency that actually
 * happened.
 *
 * The alternative — linear interpolation between the two neighbouring values —
 * is what many libraries do by default, and it produces a number no request
 * ever took. On a dashboard that difference matters: an installer asking "why
 * was it slow at 2pm" can be shown the actual slow call under nearest rank, and
 * cannot be under interpolation, because the reported figure corresponds to
 * nothing in the log.
 *
 * The cost is that the answer is coarser. With 40 calls, p95 is simply the 38th
 * slowest, and it moves in visible steps as calls are added. That is the honest
 * shape of an estimate from 40 samples, and pretending otherwise with a smooth
 * interpolated curve would be the more misleading of the two.
 *
 * ## The named percentiles
 *
 * p50 is the median: half of calls were faster. p95 is the tail — read it as
 * "one call in twenty was slower than this", which is the figure a person
 * experiences as "it is sometimes slow". Their difference is the spread, which
 * is why both are reported rather than an average: a mean of 800 ms can be
 * eight-hundred-every-time or mostly-200-with-a-few-3-second-outliers, and those
 * are different problems with different fixes.
 */

/**
 * The p-th percentile of `values`, by nearest rank.
 *
 * @param values Measurements, in any order. Not mutated.
 * @param p A fraction between 0 and 1 inclusive (0.5 is the median, 0.95 the
 *   95th percentile).
 * @returns The selected measurement, or `null` when there is nothing to measure.
 *
 * Returns `null` rather than `0` for an empty input, matching the house rule the
 * dashboard contract already follows: a percentile over no calls is unknown, not
 * zero. A zero would read as "instant" and drag an average of the real figures
 * toward a speed nothing achieved.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError(`percentile: p must be between 0 and 1, received ${p}`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest rank: the ⌈p·n⌉-th value, 1-based, clamped into the array. The clamp
  // is what makes p=0 report the minimum and p=1 the maximum rather than running
  // off either end (⌈0·n⌉ is 0, and ⌈p·n⌉ never exceeds n, but a p like 0.999
  // against a small n still needs the upper end held).
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index] ?? null;
}
