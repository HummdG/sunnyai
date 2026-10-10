import { describe, expect, it } from 'vitest';

import { SunnyMachine } from '@sunny/animation-engine';
import { STATES } from '@sunny/animation-engine';

describe('SunnyMachine', () => {
  it('starts idle', () => {
    expect(new SunnyMachine().state).toBe('idle');
  });

  it('can reach every declared state', () => {
    // A state nobody can enter is either a typo or dead weight; both are worth
    // failing on, because an unreachable state is an animation that never plays.
    const reached = new Set(SunnyMachine.allReachable());
    const unreachable = STATES.filter((s) => !reached.has(s));
    expect(unreachable).toEqual([]);
  });

  it('leaves the resting state only on a real event', () => {
    const m = new SunnyMachine('idle', 0);
    expect(m.send({ type: 'turn_finished' }, 10).changed).toBe(false);
    expect(m.state).toBe('idle');
  });

  it('walks a whole visit: attention, think, speak, settle', () => {
    const m = new SunnyMachine('idle', 0);
    m.send({ type: 'attention' }, 100);
    expect(m.state).toBe('listening');
    m.send({ type: 'turn_started' }, 200);
    expect(m.state).toBe('thinking');
    m.send({ type: 'speaking_started' }, 300);
    expect(m.state).toBe('speaking');
    m.send({ type: 'turn_finished' }, 400);
    expect(m.state).toBe('idle');
  });

  it('keeps the most urgent reaction even when it arrives mid-sentence', () => {
    const m = new SunnyMachine('idle', 0);
    m.send({ type: 'turn_started' }, 0);
    m.send({ type: 'speaking_started' }, 10);
    m.send({ type: 'turn_failed' }, 20);
    expect(m.state).toBe('error');
  });

  it('settles a transient state once its budget is spent', () => {
    const m = new SunnyMachine('idle', 0);
    m.send({ type: 'celebrate' }, 0);
    expect(m.state).toBe('celebrating');
    expect(m.tick(3_999).changed).toBe(false);
    expect(m.tick(4_000).changed).toBe(true);
    expect(m.state).toBe('idle');
  });

  it('treats a stalled turn as a failure rather than hanging forever', () => {
    const m = new SunnyMachine('idle', 0);
    m.send({ type: 'turn_started' }, 0);
    expect(m.state).toBe('thinking');
    m.tick(45_000);
    expect(m.state).toBe('error');
  });

  it('ignores an unknown event instead of throwing', () => {
    const m = new SunnyMachine('idle', 0);
    // The table has no entry for this move; the character must stay standing.
    expect(() => m.send({ type: 'dismissed' }, 0)).not.toThrow();
    expect(m.state).toBe('relaxing');
  });
});
