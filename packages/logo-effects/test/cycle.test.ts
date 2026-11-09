import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LogoEffect } from '@sunny/contracts';

import { EFFECT_PERIOD_MS, createCycle, pickNextEffect } from '../src/index.js';

/** A seeded generator, so a failing draw can be replayed. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('pickNextEffect', () => {
  it('is null when nothing is enabled', () => {
    expect(pickNextEffect([], null, Math.random)).toBeNull();
    expect(pickNextEffect([], 'comet', Math.random)).toBeNull();
  });

  it('repeats the only effect there is', () => {
    expect(pickNextEffect(['comet'], 'comet', Math.random)).toBe('comet');
  });

  it('never repeats the last effect when there is a choice, and reaches every other', () => {
    const enabled: LogoEffect[] = ['comet', 'shimmer', 'rings'];
    const random = seeded(42);
    const seen = new Set<LogoEffect>();
    for (let i = 0; i < 1000; i++) {
      const next = pickNextEffect(enabled, 'shimmer', random);
      expect(next).not.toBe('shimmer');
      seen.add(next!);
    }
    expect([...seen].sort()).toEqual(['comet', 'rings']);
  });

  it('picks from everything enabled when there is no last effect', () => {
    const random = seeded(7);
    const seen = new Set<LogoEffect | null>();
    for (let i = 0; i < 200; i++) seen.add(pickNextEffect(['comet', 'march'], null, random));
    expect([...seen].sort()).toEqual(['comet', 'march']);
  });

  it('copes with a generator that returns exactly 1', () => {
    expect(pickNextEffect(['comet', 'march'], 'comet', () => 0.999999999)).toBe('march');
  });
});

describe('createCycle', () => {
  type Frame = [LogoEffect | null, number];
  let frames: Frame[];
  const render = (effect: LogoEffect | null, periodMs: number) => frames.push([effect, periodMs]);
  const last = () => frames.at(-1);

  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
  });
  afterEach(() => vi.useRealTimers());

  it('starts still, and animates as soon as it is busy', () => {
    const cycle = createCycle({ effects: ['comet'], render });
    expect(last()).toEqual([null, 0]);
    cycle.setBusy(true);
    expect(last()).toEqual(['comet', 1600]);
  });

  it('plays one pass on its own when asked, then settles', () => {
    const cycle = createCycle({ effects: ['comet'], render });
    cycle.playOnce();
    expect(last()).toEqual(['comet', 1600]);
    vi.advanceTimersByTime(1599);
    expect(last()![0]).toBe('comet');
    vi.advanceTimersByTime(1);
    expect(last()).toEqual([null, 0]);
    vi.advanceTimersByTime(10_000);
    expect(last()).toEqual([null, 0]);
  });

  it('a single pass carries on if the assistant becomes busy during it', () => {
    const cycle = createCycle({ effects: ['comet'], render });
    cycle.playOnce();
    vi.advanceTimersByTime(800);
    cycle.setBusy(true);
    vi.advanceTimersByTime(1600);
    expect(last()![0]).toBe('comet');
  });

  it.each(['reduced', 'off'] as const)('plays no single pass at %s motion', (motion) => {
    const cycle = createCycle({ effects: ['comet', 'shimmer'], render });
    cycle.setMotion(motion);
    const count = frames.length;
    cycle.playOnce();
    expect(frames.length).toBe(count);
  });

  it('a single pass never interrupts one already playing', () => {
    const cycle = createCycle({ effects: ['comet', 'march'], render, random: () => 0 });
    cycle.setBusy(true);
    const count = frames.length;
    cycle.playOnce();
    expect(frames.length).toBe(count);
  });

  it('finishes the current pass before settling', () => {
    const cycle = createCycle({ effects: ['comet'], render });
    cycle.setBusy(true);
    vi.advanceTimersByTime(500);
    cycle.setBusy(false);
    expect(last()![0]).toBe('comet');
    vi.advanceTimersByTime(1099);
    expect(last()![0]).toBe('comet');
    vi.advanceTimersByTime(1);
    expect(last()).toEqual([null, 0]);
  });

  it('keeps the current effect when busy returns before the pass ends', () => {
    const cycle = createCycle({ effects: ['comet', 'march'], render, random: () => 0 });
    cycle.setBusy(true);
    cycle.setBusy(false);
    vi.advanceTimersByTime(800);
    cycle.setBusy(true);
    const count = frames.length;
    vi.advanceTimersByTime(800);
    expect(frames.length).toBe(count);
    expect(last()![0]).toBe('comet');
  });

  it('switches effect at the end of the first period after 4 s busy', () => {
    const cycle = createCycle({ effects: ['comet', 'march'], render, random: () => 0 });
    cycle.setBusy(true);
    expect(last()![0]).toBe('comet');
    // Periods end at 1600, 3200 and 4800: the switch waits for 4800.
    vi.advanceTimersByTime(4799);
    expect(last()![0]).toBe('comet');
    vi.advanceTimersByTime(1);
    expect(last()).toEqual(['march', 900]);
    // The 4 s count restarts with the new effect: 900 * 5 = 4500 is the first end past it.
    vi.advanceTimersByTime(4499);
    expect(last()![0]).toBe('march');
    vi.advanceTimersByTime(1);
    expect(last()![0]).toBe('comet');
  });

  it('shows still forever when no effects are enabled', () => {
    const cycle = createCycle({ effects: [], render });
    cycle.setBusy(true);
    vi.advanceTimersByTime(10_000);
    expect(frames).toEqual([[null, 0]]);
  });

  it('plays only a slow shimmer under reduced motion', () => {
    const cycle = createCycle({ effects: ['comet', 'shimmer'], render, random: () => 0 });
    cycle.setMotion('reduced');
    cycle.setBusy(true);
    expect(last()).toEqual(['shimmer', 3000]);
    vi.advanceTimersByTime(12_000);
    expect(frames.every(([e]) => e === null || e === 'shimmer')).toBe(true);
  });

  it('stays still under reduced motion without shimmer', () => {
    const cycle = createCycle({ effects: ['comet'], render });
    cycle.setMotion('reduced');
    cycle.setBusy(true);
    expect(last()).toEqual([null, 0]);
  });

  it('settles at the end of the pass when motion is turned off, then stays still', () => {
    const cycle = createCycle({ effects: ['comet'], render });
    cycle.setBusy(true);
    vi.advanceTimersByTime(400);
    cycle.setMotion('off');
    expect(last()![0]).toBe('comet');
    vi.advanceTimersByTime(1200);
    expect(last()).toEqual([null, 0]);
    cycle.setBusy(false);
    cycle.setBusy(true);
    vi.advanceTimersByTime(5000);
    expect(last()).toEqual([null, 0]);
  });

  it('moves a running effect to reduced motion at the end of its pass', () => {
    const cycle = createCycle({ effects: ['comet', 'shimmer'], render, random: () => 0 });
    cycle.setBusy(true);
    cycle.setMotion('reduced');
    vi.advanceTimersByTime(EFFECT_PERIOD_MS.comet);
    expect(last()).toEqual(['shimmer', 3000]);
  });

  it('starts animating when motion comes back on while busy', () => {
    const cycle = createCycle({ effects: ['comet'], render });
    cycle.setMotion('off');
    cycle.setBusy(true);
    expect(last()).toEqual([null, 0]);
    cycle.setMotion('full');
    expect(last()).toEqual(['comet', 1600]);
  });

  it('does nothing after destroy', () => {
    const cycle = createCycle({ effects: ['comet'], render });
    cycle.setBusy(true);
    cycle.destroy();
    const count = frames.length;
    cycle.setBusy(false);
    cycle.setBusy(true);
    vi.advanceTimersByTime(10_000);
    expect(frames.length).toBe(count);
  });
});
