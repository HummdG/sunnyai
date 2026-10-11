import { describe, expect, it } from 'vitest';

import { dashboardUsageSchema } from '@sunny/contracts';

import { summariseUsage } from '../src/usage.js';
import type { ModelCall } from '../src/store.js';

/**
 * The usage summary, tested as arithmetic rather than through HTTP.
 *
 * The route-level cases in `dashboard.test.ts` cover the window and the
 * visitor-wire strip; what is left is the part that is pure grouping and
 * sorting, where the edge cases are cheap to state directly -- an empty set, a
 * provider that reports no tokens, a model named by no provider, and ties that
 * must resolve the same way every time.
 */

function call(overrides: Partial<ModelCall> = {}): ModelCall {
  return {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    ttfbMs: 100,
    totalMs: 400,
    ...overrides,
  };
}

describe('summariseUsage', () => {
  it('is zeros and nulls over no calls, and parses against the contract', () => {
    const usage = summariseUsage([]);
    expect(usage).toEqual({
      calls: 0,
      callsWithTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      latency: { ttfbMsP50: null, ttfbMsP95: null, totalMsP50: null, totalMsP95: null },
      byModel: [],
    });
    expect(dashboardUsageSchema.safeParse(usage).success).toBe(true);
  });

  it('separates a group by provider as well as model', () => {
    // The same model name from two providers is two different things being
    // measured; merging them would average a live model with a scripted one.
    const usage = summariseUsage([
      call({ provider: 'gemini' }),
      call({ provider: 'scripted' }),
      call({ provider: 'scripted' }),
    ]);

    expect(usage.calls).toBe(3);
    expect(usage.byModel.map((row) => [row.provider, row.calls])).toEqual([
      ['scripted', 2],
      ['gemini', 1],
    ]);
  });

  it('sums only reported tokens, and counts how many calls reported them', () => {
    // The ambiguity a sum alone cannot express: 0 output tokens because the
    // provider said nothing, versus 0 because it said zero. `callsWithTokens`
    // is what tells them apart.
    const usage = summariseUsage([
      call({ usage: { inputTokens: 10, outputTokens: 4 } }),
      call({ usage: { inputTokens: 0, outputTokens: 0 } }),
      call({ usage: undefined }),
    ]);

    expect(usage.calls).toBe(3);
    expect(usage.callsWithTokens).toBe(2);
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(4);
    expect(usage.byModel[0]).toMatchObject({
      calls: 3,
      callsWithTokens: 2,
      inputTokens: 10,
      outputTokens: 4,
    });
  });

  it('keeps a model the provider did not name as its own group', () => {
    const usage = summariseUsage([call({ model: null }), call()]);
    expect(usage.calls).toBe(2);
    expect(usage.byModel.map((row) => row.model)).toEqual([null, 'gemini-2.5-flash']);
  });

  it('orders equal-count rows by provider then model, with no model first', () => {
    // Every group has one call, so the count cannot break the tie and the
    // remaining keys must. The order is total, which is what makes two responses
    // over the same window comparable row by row.
    const usage = summariseUsage([
      call({ provider: 'gemini', model: 'z-model' }),
      call({ provider: 'gemini', model: 'a-model' }),
      call({ provider: 'gemini', model: null }),
      call({ provider: 'anthropic', model: 'x-model' }),
    ]);

    expect(usage.byModel.map((row) => [row.provider, row.model])).toEqual([
      ['anthropic', 'x-model'],
      ['gemini', null],
      ['gemini', 'a-model'],
      ['gemini', 'z-model'],
    ]);
  });

  it('does not let two names collide into one group across the key separator', () => {
    // A provider ending where the next model begins would merge two groups under
    // a naive string join. The NUL separator cannot occur in either identifier.
    const usage = summariseUsage([
      call({ provider: 'gem', model: 'ini-x' }),
      call({ provider: 'gem\u0000ini', model: 'x' }),
    ]);

    // Two distinct pairs, so two groups -- whether they merge or not, the call
    // total is 2, but a merged group would report one row and this asserts two.
    expect(usage.byModel).toHaveLength(2);
    expect(usage.calls).toBe(2);
  });

  it('reports the window percentiles over every model together', () => {
    const usage = summariseUsage([
      call({ model: 'flash', ttfbMs: 10, totalMs: 100 }),
      call({ model: 'pro', ttfbMs: 20, totalMs: 200 }),
      call({ model: 'pro', ttfbMs: 30, totalMs: 300 }),
      call({ model: 'pro', ttfbMs: 40, totalMs: 400 }),
    ]);

    // Nearest rank over [10, 20, 30, 40]: p50 is the 2nd, p95 is the 4th.
    expect(usage.latency).toEqual({
      ttfbMsP50: 20,
      ttfbMsP95: 40,
      totalMsP50: 200,
      totalMsP95: 400,
    });
    // ...and each group over its own calls.
    expect(usage.byModel.find((row) => row.model === 'flash')?.latency.ttfbMsP50).toBe(10);
    expect(usage.byModel.find((row) => row.model === 'pro')?.latency.ttfbMsP50).toBe(30);
  });
});
