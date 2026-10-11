import { describe, expect, it } from 'vitest';

import { percentile } from '../src/latency.js';

/**
 * The percentile helper, pinned to its definition.
 *
 * This exists because "the p95" is ambiguous: nearest rank and linear
 * interpolation are both called p95 and they give different numbers, so an
 * implementation silently swapping one for the other would keep every
 * higher-level test passing while changing what the dashboard reports. The
 * assertions below name the exact rank each percentile must select, which is the
 * property that distinguishes the two definitions.
 */

describe('percentile — nearest rank', () => {
  it('selects a value that is in the input, never an interpolation between two', () => {
    // 1..10. Interpolated p95 would be 9.55, a latency nothing measured; nearest
    // rank gives the 10th value, which is a call that actually happened.
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.95)).toBe(10);
    expect(percentile(values, 0.5)).toBe(5);
    expect(values).toContain(percentile(values, 0.95));
  });

  it('takes the ⌈p·n⌉-th value, so the tail jumps where the definition says', () => {
    // Twenty values: ⌈0.5·20⌉ = 10 and ⌈0.95·20⌉ = 19, both exact ranks.
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(percentile(values, 0.5)).toBe(10);
    expect(percentile(values, 0.95)).toBe(19);
    // Three values: ⌈0.95·3⌉ = 3, the maximum -- the tail of a small sample.
    expect(percentile([100, 200, 300], 0.95)).toBe(300);
  });

  it('is order-independent, because it sorts a copy', () => {
    expect(percentile([300, 100, 200], 0.5)).toBe(200);
    expect(percentile([200, 300, 100], 0.5)).toBe(200);
  });

  it('does not mutate its input', () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });

  it('clamps p=0 to the minimum and p=1 to the maximum', () => {
    const values = [5, 1, 9];
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 1)).toBe(9);
  });

  it('returns null for no measurements rather than a zero', () => {
    // The contract's rule, at its source: no calls is "cannot say", and a 0 here
    // would read as an instantaneous answer and pull averages toward it.
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([], 0.95)).toBeNull();
  });

  it('rejects a p outside [0, 1] instead of silently clamping it', () => {
    expect(() => percentile([1], 1.5)).toThrow(RangeError);
    expect(() => percentile([1], -0.1)).toThrow(RangeError);
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError);
  });

  it('handles a single measurement at every percentile', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.95)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });
});
