import { describe, expect, it } from 'vitest';

import {
  SunnyAnimator,
  PRIORITY,
  SEQUENCES,
  SEQUENCE_BY_ID,
  GROUPS,
  INTENSITIES,
  bestInGroup,
  isEligible,
  sequencesForState,
} from '@sunny/animation-engine';
import type { Sequence } from '@sunny/animation-engine';
import { defaultRig, PROP_IDS } from '@sunny/character';

/**
 * Groups that are deliberately not required to offer a variant at every
 * intensity. `blink` is a reflex rather than a moment -- it is either drawn or
 * it is not, and no tenant setting should invent a blink cadence -- and `idle`
 * at an intensity of `off` is the base pose by definition, which is exactly what
 * `idle-still` is.
 */
const EXEMPT_GROUPS: readonly string[] = ['blink', 'idle'];

const base = defaultRig();

describe('sequences', () => {
  it('has unique ids', () => {
    const ids = SEQUENCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares a reduced-motion fallback that exists, or explicitly declares none', () => {
    for (const s of SEQUENCES) {
      if (s.reducedMotionFallback === null) continue;
      const fallback = SEQUENCE_BY_ID.get(s.reducedMotionFallback);
      expect(fallback, `${s.id} -> ${s.reducedMotionFallback}`).toBeDefined();
      // A fallback that needs a fallback is a loop waiting to happen.
      expect(fallback!.reducedMotionFallback, `${s.id} fallback chain`).toBeNull();
    }
  });

  it('names only props the character package can actually draw', () => {
    for (const s of SEQUENCES) {
      for (const asset of s.assets) {
        expect(PROP_IDS, `${s.id} declares ${asset}`).toContain(asset);
      }
    }
  });

  it('never produces a prop the sequence did not declare', () => {
    // This is the leak test the scheduler design is built around: a prop can
    // only appear if `assets` says it can, so an unaudited prop cannot reach a
    // tenant's page through a sequence nobody reviewed.
    for (const s of SEQUENCES) {
      const declared = new Set<string>(s.assets);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const rig = s.pose(base, t);
        for (const prop of rig.props) {
          if (prop.opacity <= 0.001) continue;
          expect(declared, `${s.id} at t=${t} drew ${prop.id}`).toContain(prop.id);
        }
      }
    }
  });

  it('is pure: the same t gives the same rig', () => {
    for (const s of SEQUENCES) {
      for (const t of [0, 0.1, 0.37, 0.5, 0.83, 1]) {
        expect(s.pose(base, t), `${s.id} at t=${t}`).toEqual(s.pose(base, t));
      }
    }
  });

  it('never mutates the rig it was handed', () => {
    // Structural cleanup depends on this. If a sequence could write into its
    // base, a prop would survive the sequence that introduced it.
    for (const s of SEQUENCES) {
      const before = structuredClone(base);
      s.pose(base, 0.4);
      s.pose(base, 1);
      expect(base, `${s.id} mutated its base`).toEqual(before);
    }
  });

  it('returns a structurally complete rig at every progress value', () => {
    const required: Array<keyof ReturnType<Sequence['pose']>> = [
      'x',
      'y',
      'rotation',
      'scale',
      'squash',
      'stretch',
      'faceTilt',
      'eyes',
      'brows',
      'smile',
      'rays',
      'props',
      'theme',
    ];
    for (const s of SEQUENCES) {
      for (const t of [0, 0.5, 1]) {
        const rig = s.pose(base, t);
        for (const key of required) {
          expect(rig[key], `${s.id} at t=${t} is missing ${key}`).toBeDefined();
        }
        expect(rig.rays).toHaveLength(base.rays.length);
      }
    }
  });

  it('keeps every pose inside the drawing area', () => {
    // A pose that flies off the viewBox renders as a clipped character. The
    // viewBox is 160 units wide with the body radius declared as 46; allowing
    // the root to move 8 units and rays to grow 40% keeps everything on canvas.
    for (const s of SEQUENCES) {
      for (let t = 0; t <= 1; t += 0.05) {
        const rig = s.pose(base, t);
        expect(Math.abs(rig.x - base.x), `${s.id} at t=${t} x`).toBeLessThan(10);
        expect(Math.abs(rig.y - base.y), `${s.id} at t=${t} y`).toBeLessThan(10);
        for (const ray of rig.rays) {
          expect(ray.lengthScale, `${s.id} at t=${t} ray`).toBeLessThan(1.6);
          expect(ray.lengthScale).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it('offers something to render in every state', () => {
    const states = [
      'idle',
      'listening',
      'thinking',
      'speaking',
      'guiding',
      'celebrating',
      'confused',
      'relaxing',
      'playing',
      'error',
    ] as const;
    for (const state of states) {
      const options = sequencesForState(state);
      // `playing` and `relaxing` deliberately borrow the idle layer.
      expect(options.length || state === 'playing' || state === 'relaxing').toBeTruthy();
    }
  });
});

describe('SunnyAnimator', () => {
  it('replays identically for the same inputs', () => {
    const run = () => {
      const a = new SunnyAnimator(defaultRig(), { seed: 7 });
      const frames = [];
      for (let i = 0; i < 40; i++) {
        const now = i * 50;
        if (i === 5) a.dispatch({ type: 'turn_started' }, now);
        if (i === 20) a.dispatch({ type: 'celebrate' }, now);
        frames.push(a.frame(now).rig);
      }
      return frames;
    };
    expect(run()).toEqual(run());
  });

  it('shows the base pose when paused', () => {
    const a = new SunnyAnimator(defaultRig(), { seed: 1 });
    const result = a.frame(0, { paused: true });
    expect(result.rig).toEqual(base);
    expect(result.sequenceId).toBeNull();
  });

  it('runs a cheaper layer when the tab is hidden', () => {
    const a = new SunnyAnimator(defaultRig(), { seed: 1 });
    a.dispatch({ type: 'celebrate' }, 0);
    const result = a.frame(100, { hidden: true });
    expect(result.rig).toEqual(base);
  });

  it('honours an intensity of off by showing nothing but the base', () => {
    const a = new SunnyAnimator(defaultRig(), { intensity: 'off' });
    const result = a.frame(200);
    expect(result.rig).toEqual(base);
  });

  it('substitutes the reduced-motion fallback rather than dropping the beat', () => {
    const a = new SunnyAnimator(defaultRig(), { seed: 3 });
    a.dispatch({ type: 'celebrate' }, 0);
    const result = a.frame(100, { reducedMotion: true });
    expect(result.sequenceId).toBe('celebrate-still');
  });

  it('blinks while speaking, because a blink is not owned by the idle state', () => {
    const a = new SunnyAnimator(defaultRig(), { seed: 5 });
    a.dispatch({ type: 'turn_started' }, 0);
    a.dispatch({ type: 'speaking_started' }, 10);
    let blinked = false;
    for (let i = 0; i < 400; i++) {
      const r = a.frame(20 + i * 50);
      if (r.sequenceId === 'blink' || r.yields.includes('blink')) blinked = true;
    }
    expect(blinked).toBe(true);
  });

  it('steps aside from the conversation when a success lands', () => {
    const a = new SunnyAnimator(defaultRig(), { seed: 11 });
    a.dispatch({ type: 'turn_started' }, 0);
    a.dispatch({ type: 'speaking_started' }, 10);
    a.dispatch({ type: 'celebrate' }, 20);
    const r = a.frame(60);
    // Asserted by group, not by variant: which celebration plays is the
    // intensity setting's business, and pinning the id here would make the
    // tenant's setting a test failure rather than a configuration.
    expect(SEQUENCE_BY_ID.get(r.sequenceId!)?.group).toBe('celebrate');
  });

  it('orders its priority bands the way the brief specifies', () => {
    // The brief is explicit: direct interaction > accessibility and error >
    // chat and guidance > success > user-invoked play > idle. Written as a
    // descending chain so a future sequence slotted into the wrong band fails
    // here rather than silently outranking an apology.
    const bands = [
      PRIORITY.interaction,
      PRIORITY.accessibility,
      PRIORITY.chat,
      PRIORITY.success,
      PRIORITY.play,
      PRIORITY.idle,
    ];
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i - 1], `band ${i}`).toBeGreaterThan(bands[i]!);
    }
  });

  it('never lets a celebration outrank a recovery', () => {
    // Success is the band *below* chat, so both error and confusion must
    // outrank it. This is the ordering that stops a party from burying a
    // "something went wrong" message.
    for (const id of ['celebrate-spin', 'celebrate-bounce', 'celebrate-still']) {
      const s = SEQUENCE_BY_ID.get(id)!;
      expect(s.priority).toBeLessThan(PRIORITY.accessibility);
    }
    expect(SEQUENCE_BY_ID.get('error-deflate')!.priority).toBe(PRIORITY.accessibility);
    expect(SEQUENCE_BY_ID.get('confused-tilt')!.priority).toBe(PRIORITY.accessibility);
  });

  it('picks a celebration the tenant actually allows', () => {
    const spin = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 2 });
    spin.dispatch({ type: 'celebrate' }, 0);
    expect(spin.frame(40).sequenceId).toBe('celebrate-spin');

    const bounce = new SunnyAnimator(defaultRig(), { intensity: 'balanced', seed: 2 });
    bounce.dispatch({ type: 'celebrate' }, 0);
    expect(bounce.frame(40).sequenceId).toBe('celebrate-bounce');

    const still = new SunnyAnimator(defaultRig(), { intensity: 'minimal', seed: 2 });
    still.dispatch({ type: 'celebrate' }, 0);
    expect(still.frame(40).sequenceId).toBe('celebrate-still');
  });

  it('has a variant for every behavioural moment at every intensity', () => {
    // The bug this guards against: a moment whose only variant sat above the
    // tenant's intensity floor, so the behaviour silently never played. Turning
    // the character down must weaken a moment, never delete it.
    const moments = GROUPS.filter((g) => !EXEMPT_GROUPS.includes(g));
    expect(moments.length).toBeGreaterThan(0);

    // Every intensity except `off`, which is the one setting that is *meant* to
    // remove behaviour. Anything below it is a floor, and a floor that deletes a
    // moment is the failure this test exists to prevent.
    const onIntensities = INTENSITIES.filter((i) => i !== 'off');
    expect(onIntensities.length).toBe(3);

    for (const group of moments) {
      for (const intensity of onIntensities) {
        const chosen = bestInGroup(group, intensity);
        expect(
          chosen,
          `no "${group}" variant available at intensity "${intensity}"`,
        ).not.toBeNull();
        expect(isEligible(chosen!, intensity)).toBe(true);
      }
    }

    // And `off` really is off: at that setting, no moment moves, whichever one
    // is requested. This is asserted as *absence of motion* rather than as a
    // null result, because a variant declaring `intensity: 'off'` is permitted
    // to exist -- it is the held pose the visitor asked for -- but it must hold
    // that pose for as long as it plays. A fade is motion, so a sequence that
    // fades belongs at `minimal`.
    for (const group of GROUPS) {
      const animator = new SunnyAnimator(defaultRig(), { intensity: 'off', seed: 5 });
      animator.play(group, 0);
      const held = animator.frame(0).rig;
      for (const t of [200, 600, 1400, 3000]) {
        expect(animator.frame(t).rig, `"${group}" moved at intensity "off" (t=${t})`).toEqual(held);
      }
    }
  });

  it('wears the sunglasses when it lands a recommendation', () => {
    const animator = new SunnyAnimator(defaultRig(), { intensity: 'balanced', seed: 3 });
    animator.dispatch({ type: 'impress' }, 0);
    const frame = animator.frame(700);
    expect(frame.sequenceId).toBe('cool-shades');
    expect(frame.rig.props.map((p) => p.id)).toContain('sunglasses');
    // Lenses actually over the face, not off the top of the head.
    const glasses = frame.rig.props.find((p) => p.id === 'sunglasses')!;
    expect(Math.abs(glasses.y - -5.1)).toBeLessThan(12);
    expect(glasses.opacity).toBeGreaterThan(0.5);
  });

  it('lets the idle loop actually advance instead of freezing at t = 0', () => {
    // The ambient layer used to be rebuilt every frame, which pinned a looping
    // sequence at its first pose. Nothing would have thrown; Sunny would simply
    // have stood still forever.
    const a = new SunnyAnimator(defaultRig(), { seed: 4 });
    const early = a.frame(0).rig;
    const later = a.frame(1_500).rig;
    expect(later).not.toEqual(early);
  });

  it('lands the eureka when the answer arrives', () => {
    // `thinking` -> `speaking` is the answer arriving, which is the eureka's
    // entire reason to exist. It has to beat the ambient speaking pulse to be
    // seen at all, which is why the group sits inside the chat band but above
    // it -- at the success band it lost every frame of its own states.
    const a = new SunnyAnimator(defaultRig(), { seed: 4 });
    a.dispatch({ type: 'turn_started' }, 0);
    expect(SEQUENCE_BY_ID.get(a.frame(100).sequenceId!)?.group).toBe('think');

    a.dispatch({ type: 'speaking_started' }, 200);
    expect(SEQUENCE_BY_ID.get(a.frame(260).sequenceId!)?.group).toBe('eureka');
  });

  it('does not invent a eureka for an answer nobody worked out', () => {
    // A host that streams a greeting, or a turn resumed from history, goes
    // straight to speaking. Nothing was worked out, so there is no idea to land,
    // and a spark here would be the character lying about its own state.
    const a = new SunnyAnimator(defaultRig(), { seed: 4 });
    a.dispatch({ type: 'speaking_started' }, 0);
    expect(SEQUENCE_BY_ID.get(a.frame(60).sequenceId!)?.group).not.toBe('eureka');
  });

  it('gives a reduced-motion visitor the eureka rather than somebody else’s still', () => {
    // The fallback pointed at `celebrate-still`, so a visitor who had asked for
    // less motion got a different moment from the one they asked for.
    const a = new SunnyAnimator(defaultRig(), { seed: 4, reducedMotion: true });
    a.dispatch({ type: 'turn_started' }, 0);
    a.dispatch({ type: 'speaking_started' }, 200);
    expect(a.frame(260, { reducedMotion: true }).sequenceId).toBe('eureka-still');
  });

  it('drops a moment that is outranked for its whole life, until reset ends it', () => {
    // A requested sequence expires on its own clock -- from the request, not
    // from the first frame that draws it -- so one queued behind a longer,
    // higher-priority moment is never drawn at all rather than being shown late.
    // That is the priority system working, but it happens in silence, and the
    // animation lab's gallery is a caller that needs the opposite: each click is
    // a separate demonstration, so it clears the stage first.
    const a = new SunnyAnimator(defaultRig(), { seed: 4 });
    a.play('charge', 0); // 2.6 s, in the chat band
    a.play('celebrate', 0); // success band: never wins while the panel plays

    for (let i = 1; i <= 140; i++) a.frame((i * 1000) / 30);
    // Past the celebration's own 1.4 s, and it was never drawn once.
    expect(a.lastFrame?.sequenceId).not.toMatch(/^celebrate/);

    a.reset();
    a.play('celebrate', 4_700);
    expect(a.frame(4_700).sequenceId).toMatch(/^celebrate/);
  });
});
