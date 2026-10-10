import { describe, expect, it } from 'vitest';

import {
  SunnyAnimator,
  PRIORITY,
  Scheduler,
  SEQUENCES,
  SEQUENCE_BY_ID,
  GROUPS,
  INTENSITIES,
  bestInGroup,
  isEligible,
  sequencesForState,
} from '@sunny/animation-engine';
import type { Intensity, Sequence } from '@sunny/animation-engine';
import { defaultRig, PROP_IDS, RAY, toViewBox } from '@sunny/character';
import type { PropRig, SunnyRig } from '@sunny/character';

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
      // Every state has sequences of its own now. `relaxing` used to be the
      // exception -- it borrowed the idle layer, which is exactly what A04
      // fixed -- and the exemption is gone rather than left in place, because an
      // exemption that outlives the gap it was written for is how a state ends
      // up silently empty again.
      expect(options.length, `${state} has nothing to render`).toBeGreaterThan(0);
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

  it('gives the playing state a move of its own', () => {
    // `play_started` used to move the machine into `playing` and change nothing
    // on screen, because the playing state borrowed the resting layer. A game
    // could start and Sunny would carry on breathing as though nothing had
    // happened.
    const a = new SunnyAnimator(defaultRig(), { seed: 3 });
    a.dispatch({ type: 'play_started' }, 0);
    expect(a.state).toBe('playing');
    expect(a.frame(0).sequenceId).toMatch(/^play-/);
  });

  it('picks the play move the tenant’s motion setting allows', () => {
    const cases: ReadonlyArray<[Intensity, string]> = [
      ['minimal', 'play-shuffle'],
      ['balanced', 'play-run'],
      ['playful', 'play-dance'],
    ];
    for (const [intensity, id] of cases) {
      const a = new SunnyAnimator(defaultRig(), { intensity, seed: 3 });
      a.dispatch({ type: 'play_started' }, 0);
      expect(a.frame(0).sequenceId, `at ${intensity}`).toBe(id);
    }
  });

  it('cannot run two play moves at once', () => {
    // A07 asks for "no animation collisions", and it holds structurally rather
    // than by tuning the durations: the three moves are variants of one group,
    // and a second instance of a group already running is refused.
    const scheduler = new Scheduler('playful', false);
    expect(scheduler.request('play', 'playing', 0)).toBe(true);
    expect(scheduler.request('play-shuffle', 'playing', 0)).toBe(false);
    expect(scheduler.active.filter((i) => i.sequence.group === 'play')).toHaveLength(1);
  });

  it('stops playing after a burst and gives the frame back to resting', () => {
    // A game lasts minutes; the move is a burst at the start of it. Once the
    // burst is over, what the visitor is looking at is the resting layer under
    // the board, and nothing of the move may be left on screen.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 3 });
    a.dispatch({ type: 'play_started' }, 0);
    expect(a.frame(0).sequenceId).toBe('play-dance');

    // Past the dance's own 1.3 s, and long before the seeded blink cadence.
    const after = a.frame(1_400);
    expect(after.sequenceId).toBe('idle-breathe');
    expect(after.rig.props).toEqual([]);
  });

  it('keeps blinking while a game is on', () => {
    // The blink layer is asked for in `playing` too. A read-only game lasts
    // minutes, the move is over after about a second, and a character that never
    // blinked for the length of it would read as switched off.
    const a = new SunnyAnimator(defaultRig(), { seed: 3 });
    a.dispatch({ type: 'play_started' }, 0);
    const drawn = new Set<string | null>();
    for (let i = 0; i <= 400; i++) drawn.add(a.frame(i * 50).sequenceId);
    expect([...drawn]).toContain('blink');
  });

  it('gets the deckchair out when the visitor closes the chat', () => {
    // A04. `dismissed` moved the machine to `relaxing`, and the relaxing state
    // borrowed the idle layer -- so closing the panel, the one moment the
    // launcher is alone on screen, changed nothing about the character.
    const a = new SunnyAnimator(defaultRig(), { seed: 3 });
    a.dispatch({ type: 'attention' }, 0);
    a.frame(0);
    a.dispatch({ type: 'dismissed' }, 400);
    expect(a.state).toBe('relaxing');
    const frame = a.frame(400);
    expect(frame.sequenceId).toBe('relax-sunbathe');
    expect(frame.rig.props.map((p) => p.id)).toContain('deckchair');
  });

  it('picks the break the tenant’s motion setting and visitor’s motion preference allow', () => {
    const cases: ReadonlyArray<[Intensity, boolean, string]> = [
      ['minimal', false, 'relax-settle'],
      ['balanced', false, 'relax-sunbathe'],
      ['playful', false, 'relax-doze'],
      ['playful', true, 'relax-still'],
    ];
    for (const [intensity, reducedMotion, id] of cases) {
      const a = new SunnyAnimator(defaultRig(), { intensity, seed: 3 });
      a.dispatch({ type: 'dismissed' }, 0);
      // The preference arrives with the frame, not the constructor: the widget
      // re-reads the media query every frame, and the scheduler takes the
      // reduced-motion flag from the context.
      expect(
        a.frame(0, { reducedMotion }).sequenceId,
        `at ${intensity}, reduced ${reducedMotion}`,
      ).toBe(id);
    }
  });

  it('stops the break as soon as the visitor does anything', () => {
    // A04's "stops immediately on user interaction". The chair is not ended by
    // its clock but by the visitor: any event that moves the machine out of
    // `relaxing` retires the instance on the next frame, whatever it has left of
    // its nine seconds to run.
    const a = new SunnyAnimator(defaultRig(), { seed: 3 });
    a.dispatch({ type: 'dismissed' }, 0);
    a.frame(0);
    expect(a.frame(600).rig.props.map((p) => p.id)).toContain('deckchair');

    // The visitor clicks the launcher again, still well inside the sequence.
    a.dispatch({ type: 'attention' }, 700);
    expect(a.state).toBe('listening');
    expect(a.frame(700).rig.props).toEqual([]);
  });

  it('plants the chair on the ground while she settles into it', () => {
    // Props are drawn in the body's frame, so a prop inherits the body's motion.
    // The chair is given back the transform her body was given to sit down, so
    // its own origin must land back on the body centre in the viewBox -- and
    // stay there while she breathes, which is the part a naive negation would
    // get wrong.
    const sequence = SEQUENCE_BY_ID.get('relax-sunbathe')!;
    for (const t of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const rig = sequence.pose(base, t);
      const chair = rig.props.find((p) => p.id === 'deckchair')!;
      const a = (rig.rotation * Math.PI) / 180;
      const x = rig.x + chair.x * Math.cos(a) - chair.y * Math.sin(a);
      const y = rig.y + chair.x * Math.sin(a) + chair.y * Math.cos(a);
      expect(x, `chair x at t=${t}`).toBeCloseTo(base.x, 6);
      expect(y, `chair y at t=${t}`).toBeCloseTo(base.y, 6);
      // And it does not lean with her either, once it is unfolded.
      expect(rig.rotation + chair.rotation, `chair lean at t=${t}`).toBeCloseTo(0, 6);
    }
  });

  it('leaves nothing out when the break is over', () => {
    // The chair arrives by unfolding and leaves by folding, so the end of the
    // moment is the rest pose. A frame that stopped mid-fold would leave a chair
    // standing on screen with nobody in it. Asserted as "nothing visible" rather
    // than "no props", because a faded-to-nothing prop is already dropped from
    // the markup and the array is the sequence's business, not the renderer's.
    const sequence = SEQUENCE_BY_ID.get('relax-doze')!;
    for (const t of [0, 1]) {
      const rig = sequence.pose(base, t);
      for (const p of rig.props) {
        expect(p.opacity, `${p.id} at t=${t}`).toBeLessThanOrEqual(0.001);
      }
    }
    expect(sequence.pose(base, 1).rotation).toBeCloseTo(base.rotation, 6);
  });
});

/**
 * A05: the balloon, and the tap that starts it and ends it.
 *
 * Two things are being tested here that nothing else in this suite can reach.
 * The first is the *input channel*: a pointer gesture is the only moment in the
 * vocabulary the visitor starts directly, so `tap` is the one place where a
 * position from outside the engine becomes a position inside it. The second is
 * the *anchor*: the burst is the only moment that is drawn somewhere the moment
 * itself did not choose, and getting that wrong is invisible in a snapshot --
 * every pose would still be deterministic and every prop still declared.
 */
describe('A05, the balloon', () => {
  const base = defaultRig();

  /** The balloon in a frame, or a failure that says which frame it was. */
  function balloonIn(rig: SunnyRig, where: string): PropRig {
    const found = rig.props.find((p) => p.id === 'balloon');
    expect(found, `no balloon in ${where}`).toBeDefined();
    return found as PropRig;
  }

  it('gives her a balloon when the visitor taps her', () => {
    const a = new SunnyAnimator(defaultRig(), { intensity: 'balanced', seed: 3 });
    a.frame(0);
    expect(a.tap({ x: 100, y: 100 }, 0)).toBe(true);

    const frame = a.frame(0);
    expect(SEQUENCE_BY_ID.get(frame.sequenceId!)?.group).toBe('balloon');
    expect(frame.rig.props.map((p) => p.id)).toContain('balloon');
  });

  it('ignores a tap that lands on neither the balloon nor the body', () => {
    // A character that reacts to being touched anywhere is one that cannot be
    // *not* touched. The rays are part of the drawing but not of the silhouette,
    // so (100, 12) -- straight up, at the tip of the topmost ray -- is a miss.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'balanced', seed: 3 });
    a.frame(0);
    expect(a.tap({ x: 8, y: 8 }, 0)).toBe(false);
    expect(a.tap({ x: 100, y: 12 }, 0)).toBe(false);
    expect(a.tap({ x: 100, y: 190 }, 0)).toBe(false);
    expect(a.frame(0).rig.props).toEqual([]);
  });

  it('offers no toy while she is busy', () => {
    // The balloon is only for the states where she is otherwise unoccupied. A
    // tap mid-answer is not a request for a balloon, and the scheduler refuses it
    // rather than the caller deciding.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'balanced', seed: 3 });
    a.dispatch({ type: 'turn_started' }, 0);
    expect(a.state).toBe('thinking');
    a.frame(0);
    expect(a.tap({ x: 100, y: 100 }, 0)).toBe(false);
    expect(a.frame(0).rig.props).toEqual([]);
  });

  it('hit-tests against the frame that was actually drawn', () => {
    // The balloon travels, so "where it is" is only a fact about a particular
    // frame. A tap where it was when it was released, half a second later, has to
    // miss -- otherwise the hit test is against a position the visitor never saw.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'balanced', seed: 3 });
    a.frame(0);
    a.tap({ x: 100, y: 100 }, 0);

    const early = a.frame(200).rig;
    const start = balloonIn(early, 'the release');
    const atRelease = toViewBox(early, start);

    // Later in the flight the balloon has left that point behind.
    const late = a.frame(2_000).rig;
    const now = balloonIn(late, 'the hover');
    expect(Math.hypot(now.x - start.x, now.y - start.y)).toBeGreaterThan(25);

    expect(a.tap(atRelease, 2_000)).toBe(false);
    expect(a.tap(toViewBox(late, now), 2_000)).toBe(true);
  });

  it('bursts the balloon where it was tapped, and takes the float away with it', () => {
    const a = new SunnyAnimator(defaultRig(), { intensity: 'balanced', seed: 3 });
    a.frame(0);
    a.tap({ x: 100, y: 100 }, 0);

    const rig = a.frame(2_000).rig;
    const balloon = balloonIn(rig, 'the hover');
    const at = toViewBox(rig, balloon);

    expect(a.tap(at, 2_000)).toBe(true);
    const popped = a.frame(2_120).rig;

    // The float is gone: the shards replaced it rather than playing over it.
    expect(popped.props.map((p) => p.id)).not.toContain('balloon');
    expect(popped.props.length).toBeGreaterThan(0);
    expect(SEQUENCE_BY_ID.get(a.lastFrame!.sequenceId!)?.group).toBe('pop');

    // And the burst is centred on the point that was tapped. Read back through
    // the transform the renderer applies, so this is a claim about the picture
    // rather than about the numbers in the body frame.
    for (const shard of popped.props) {
      const world = toViewBox(popped, shard);
      const distance = Math.hypot(world.x - at.x, world.y - at.y);
      expect(distance, `a shard landed ${distance.toFixed(1)} from the tap`).toBeLessThanOrEqual(
        27,
      );
    }
  });

  it('anchors the burst in the picture, not in the body', () => {
    // The failure this catches: placing the shards at the anchor *in the body's
    // frame*, which looks right on a character standing still and slides the
    // whole burst across the screen the moment she leans. The anchor is sixty
    // units from the body centre and the body is rotated and scaled, so a burst
    // that travelled with her would be most of a ray length away from the tap.
    const sequence = SEQUENCE_BY_ID.get('pop-shower')!;
    const anchor = { point: { x: 150, y: 50 } };

    const tilted = defaultRig();
    tilted.x = 90;
    tilted.y = 108;
    tilted.rotation = 25;
    tilted.scale = 1.2;

    for (const [name, start] of [
      ['upright', base],
      ['tilted', tilted],
    ] as const) {
      const posed = sequence.pose(start, 0.4, anchor);
      expect(posed.props.length, name).toBeGreaterThan(0);
      for (const shard of posed.props) {
        const world = toViewBox(posed, shard);
        const distance = Math.hypot(world.x - anchor.point.x, world.y - anchor.point.y);
        expect(
          distance,
          `${name}: a shard landed ${distance.toFixed(1)} from the anchor`,
        ).toBeLessThanOrEqual(35);
      }
    }
  });

  it('starts the burst at the balloon’s own resting place when nothing anchored it', () => {
    // The gallery's `Play` asks for the moment with no input at all. There is
    // exactly one position that is not an invention, and that is where the
    // balloon would have been -- so a pop played cold is a burst in the same
    // place, which is what makes it a demonstration of the same moment.
    const sequence = SEQUENCE_BY_ID.get('pop-flinch')!;
    const anchored = sequence.pose(base, 0.3, {
      point: toViewBox(base, { x: 34, y: -62 }),
    });
    const cold = sequence.pose(base, 0.3);
    expect(cold.props).toEqual(anchored.props);
  });

  it('leaves nothing behind when the balloon is released', () => {
    for (const id of ['balloon-rise', 'balloon-sway', 'balloon-wander']) {
      const sequence = SEQUENCE_BY_ID.get(id)!;
      for (const prop of sequence.pose(base, 1).props) {
        expect(prop.opacity, `${id} at t=1 still draws ${prop.id}`).toBeLessThanOrEqual(0.001);
      }
    }
  });

  it('stops the float as soon as anything else happens', () => {
    // A05's "stops immediately on interaction", and the same mechanism A04 uses:
    // the float declares the states it belongs to, so any event that moves the
    // machine out of them retires it on the next frame. The visitor asking a
    // question does not get a balloon drifting past the answer.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'balanced', seed: 3 });
    a.frame(0);
    a.tap({ x: 100, y: 100 }, 0);
    expect(a.frame(200).rig.props.map((p) => p.id)).toContain('balloon');

    a.dispatch({ type: 'turn_started' }, 300);
    expect(a.state).toBe('thinking');
    expect(a.frame(300).rig.props.map((p) => p.id)).not.toContain('balloon');
  });

  it('holds a still balloon for a visitor who asked for less motion', () => {
    // There is an honest still of this moment -- a balloon at rest is an
    // ordinary thing to see -- so the reduced-motion fallback is a balloon rather
    // than nothing. What the visitor does not get is a balloon that travels.
    const a = new SunnyAnimator(defaultRig(), {
      intensity: 'balanced',
      seed: 3,
      reducedMotion: true,
    });
    a.frame(0, { reducedMotion: true });
    expect(a.tap({ x: 100, y: 100 }, 0)).toBe(true);

    const held = a.frame(0, { reducedMotion: true }).rig;
    expect(a.lastFrame?.sequenceId).toBe('balloon-still');
    expect(held.props.map((p) => p.id)).toContain('balloon');
    expect(a.frame(900, { reducedMotion: true }).rig).toEqual(held);

    // Popping it resolves to nothing at all, which is the honest account of a
    // burst with the motion removed: the balloon is simply gone.
    const at = toViewBox(held, balloonIn(held, 'the still'));
    expect(a.tap(at, 900)).toBe(true);
    const after = a.frame(960, { reducedMotion: true });
    expect(after.rig.props.map((p) => p.id)).not.toContain('balloon');
    expect(SEQUENCE_BY_ID.get(after.sequenceId!)?.group).not.toBe('pop');
  });

  it('keeps a whole balloon at an intensity of off, and takes it away when tapped', () => {
    // `off` is the setting that removes behaviour, and the balloon is the one
    // moment where a held pose is still the moment: the visitor gets a balloon
    // that does not move, and tapping it removes it without anything moving
    // either. That is the difference between this and `relax-still`, which shows
    // nothing at all because there is no honest still of a chair arriving.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'off', seed: 3 });
    a.frame(0);
    expect(a.tap({ x: 100, y: 100 }, 0)).toBe(true);

    const held = a.frame(0).rig;
    expect(a.lastFrame?.sequenceId).toBe('balloon-still');
    expect(a.frame(3_000).rig).toEqual(held);

    const at = toViewBox(held, balloonIn(held, 'the still'));
    expect(a.tap(at, 3_000)).toBe(true);
    expect(a.frame(3_000).rig).toEqual(base);
  });
});

describe('A10, the arcade spin', () => {
  const variants = ['arcade-tuck', 'arcade-roll', 'arcade-spin'] as const;

  it('returns to the exact default pose, which is the row’s acceptance', () => {
    // The plan's acceptance for A10 is "returns to exact default pose", and the
    // word that has teeth is *exact*. A pose is a pure function of progress, so
    // the claim is about t = 1 and `toEqual` is a fair way to hold it -- but only
    // because nothing in these three sequences is built on a value that is
    // merely *close* to zero at the end. `sin(pi)` is 1.2e-16; three of those
    // added up is a rig that renders identically and compares differently, which
    // is why this section has its own helpers rather than reusing `bump`.
    for (const id of variants) {
      const sequence = SEQUENCE_BY_ID.get(id)!;
      expect(sequence.pose(defaultRig(), 1), `${id} at t=1`).toEqual(base);
      expect(sequence.pose(defaultRig(), 0), `${id} at t=0`).toEqual(base);
    }
  });

  it('folds the rays in and turns the body, which is what makes it a roll', () => {
    // The move has to read as a roll and not as a wobble. Two things carry that:
    // the body rotates (a spin) and the rays shorten towards the body so the
    // eight arms gather into one disc. A rotating character still showing eight
    // splayed rays is a sun wobbling, not a sun rolling.
    const spin = SEQUENCE_BY_ID.get('arcade-spin')!;
    let mostTurned = 0;
    let shortestRay = 1;
    for (let t = 0; t <= 1; t += 0.02) {
      const rig = spin.pose(base, t);
      mostTurned = Math.max(mostTurned, Math.abs(rig.rotation));
      shortestRay = Math.min(shortestRay, ...rig.rays.map((ray) => ray.lengthScale));
    }
    // Both whole revolutions happen inside the sequence, so the body passes
    // through every angle -- if the turn were capped the maximum would be low.
    expect(mostTurned).toBeGreaterThan(180);
    // Folded, not vanished: the rays stay well inside the drawing area, which is
    // the same bound the whole-file invariant applies at every t.
    expect(shortestRay).toBeGreaterThan(0.5);
    expect(shortestRay).toBeLessThan(0.75);
  });

  it('turns a whole number of revolutions, so the last frame is the first', () => {
    // Two revolutions rather than "about two": a value that ends at 719 degrees
    // is a character that has been left a degree off true, which is the same
    // class of bug as a leaked prop and just as invisible.
    const spin = SEQUENCE_BY_ID.get('arcade-spin')!;
    expect(spin.pose(base, 1).rotation).toBe(0);
    expect(SEQUENCE_BY_ID.get('arcade-roll')!.pose(base, 1).rotation).toBe(0);
  });

  it('spins where it stands: the cue does not move the machine out of the game', () => {
    // The reason `spin` is a cue rather than a transition. A wave cleared
    // happens in the middle of a game; a state change to `celebrating` would
    // settle her back to `idle` four seconds later with the fleet still coming,
    // and the visitor would be playing alone.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 3 });
    a.dispatch({ type: 'play_started' }, 0);
    expect(a.state).toBe('playing');

    // Five seconds in, which is when a wave actually clears: the opening burst
    // is a second and a bit, and the fleet takes many ticks to shoot down.
    a.dispatch({ type: 'spin' }, 5_000);
    expect(a.state, 'the cue must not move the machine').toBe('playing');
    expect(SEQUENCE_BY_ID.get(a.frame(5_000).sequenceId!)?.group).toBe('arcade');

    // And the game is still on. Four seconds later she is still in `playing`,
    // which is exactly what the `celebrating` route would have taken away.
    a.frame(9_500);
    expect(a.state).toBe('playing');
  });

  it('defers to a burst that is still running, because they share a band', () => {
    // The brief puts both of these in `user-invoked play`: a game starting and a
    // wave cleared are the same kind of moment, so they share a priority and the
    // scheduler keeps whichever was asked for first -- the play burst. Stated
    // here rather than left to insertion order to decide unobserved, even though
    // the product cannot reach it: a wave takes far longer to clear than the
    // burst lasts.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 3 });
    a.dispatch({ type: 'play_started' }, 0);
    a.dispatch({ type: 'spin' }, 100);
    expect(a.frame(100).sequenceId).toBe('play-dance');
  });

  it('picks the spin the tenant’s motion setting allows', () => {
    const cases: ReadonlyArray<[Intensity, string]> = [
      ['minimal', 'arcade-tuck'],
      ['balanced', 'arcade-roll'],
      ['playful', 'arcade-spin'],
    ];
    for (const [intensity, id] of cases) {
      const a = new SunnyAnimator(defaultRig(), { intensity, seed: 3 });
      a.dispatch({ type: 'spin' }, 0);
      expect(a.frame(0).sequenceId, `at ${intensity}`).toBe(id);
    }
  });

  it('gives a reduced-motion visitor the tuck instead of the spin', () => {
    // Not the resting pose: there is no honest still of a mid-roll, but there is
    // one of "something small just happened", so the fallback is the quietest
    // variant rather than nothing at all.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 3 });
    a.dispatch({ type: 'spin' }, 0);
    const frame = a.frame(0, { reducedMotion: true });
    expect(frame.sequenceId).toBe('arcade-tuck');
    // And the fallback is what moved, not the spin: at the same moment the
    // playful variant would have her at a different angle entirely.
    expect(frame.rig.rotation).toBe(0);
  });

  it('is refused where a spin would be rude', () => {
    // The arcade group lists `playing`, `celebrating` and `idle` and nothing
    // else, so the cue is dropped in the middle of a conversation rather than
    // interrupting the visitor's answer with a somersault.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 3 });
    a.dispatch({ type: 'turn_started' }, 0);
    a.dispatch({ type: 'speaking_started' }, 10);
    a.dispatch({ type: 'spin' }, 20);
    expect(a.state).toBe('speaking');

    // Never once, over the whole of the spin's own duration.
    const drawn = new Set<string | null>();
    for (let i = 0; i <= 26; i++) drawn.add(a.frame(20 + i * 50).sequenceId);
    for (const id of drawn) {
      expect(SEQUENCE_BY_ID.get(id ?? '')?.group, `${id} took the frame`).not.toBe('arcade');
    }
  });

  it('lets the fleet getting through reach the character', () => {
    // The arcade has dispatched `impress` on a loss since A08 and the playing
    // row has no entry for it, so the event fell on the floor: the visitor lost
    // and Sunny did nothing. It stays off that row deliberately -- a reaction
    // that moved her out of `playing` would also move her out on every *point*
    // in the pong and the board, which dispatch one apiece -- so the arcade ends
    // the game before it reacts, which is what it has actually happened.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 3 });
    a.dispatch({ type: 'play_started' }, 0);
    expect(a.state).toBe('playing');

    a.dispatch({ type: 'play_finished' }, 1_000);
    a.dispatch({ type: 'impress' }, 1_000);
    expect(a.state).toBe('celebrating');
    expect(SEQUENCE_BY_ID.get(a.frame(1_000).sequenceId!)?.group).toBe('cool');
  });

  it('cannot run two spins at once', () => {
    // Same structural guard the play moves rely on: a second wave cleared while
    // the first spin is still playing is refused rather than layered.
    const scheduler = new Scheduler('playful', false);
    expect(scheduler.request('arcade', 'playing', 0)).toBe(true);
    expect(scheduler.request('arcade-roll', 'playing', 0)).toBe(false);
    expect(scheduler.active.filter((i) => i.sequence.group === 'arcade')).toHaveLength(1);
  });
});

describe('A11, the plant', () => {
  const variants = ['bloom-seed', 'bloom-grow', 'bloom-showcase'] as const;
  /** How finely the moment is walked when a claim is about the whole of it. */
  const STEPS = 400;

  /** The props a sequence actually draws, and the first moment each is visible. */
  function drawnBy(id: string, visible = 0.05): Map<string, number> {
    const sequence = SEQUENCE_BY_ID.get(id)!;
    const first = new Map<string, number>();
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      for (const prop of sequence.pose(base, t).props) {
        if (prop.opacity > visible && !first.has(prop.id)) first.set(prop.id, t);
      }
    }
    return first;
  }

  it('tells the story in order, in one sequence rather than four moments', () => {
    // The row names four stages and the order is the whole of its interest. Four
    // sequences would be four chances to be interrupted between them -- a visitor
    // who looked away would have planted a seed and never seen a flower -- so the
    // requirement is that one sequence carries all of it, and this is where that
    // is checked rather than assumed.
    const first = drawnBy('bloom-showcase');
    const seed = first.get('seed');
    const sprout = first.get('sprout');
    const flower = first.get('flower');
    for (const [name, at] of [
      ['seed', seed],
      ['shoot', sprout],
      ['flower', flower],
    ] as const) {
      expect(at, `the ${name} is never drawn`).toBeDefined();
    }
    expect(seed!).toBeLessThan(sprout!);
    expect(sprout!).toBeLessThan(flower!);
  });

  it('buries the seed before the shoot breaks the ground', () => {
    // A deliberate gap rather than a cross-fade: the seed is *in* the ground by
    // the time anything comes up, because a seed and a shoot on screen together
    // is a seed beside a plant. The shoot then overlaps the flower on purpose --
    // that pair *is* the cross-fade, and the flower is meant to come out of it.
    const sequence = SEQUENCE_BY_ID.get('bloom-showcase')!;
    let lastSeed = 0;
    let firstSeed = 1;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      if (sequence.pose(base, t).props.some((p) => p.id === 'seed' && p.opacity > 0.05)) {
        lastSeed = t;
        firstSeed = Math.min(firstSeed, t);
      }
    }
    const sprout = drawnBy('bloom-showcase').get('sprout')!;
    expect(lastSeed).toBeLessThan(sprout);
    // And it is not a seed that never lands: it has to be going somewhere.
    expect(lastSeed - firstSeed).toBeGreaterThan(0.08);
  });

  it('stretches the rays for the shine, and is done before the bloom opens', () => {
    // The shine has no prop: the character is the light, so the stage is her rays
    // lengthening. It also has to be *over* by the time the flower is there, or
    // the light reads as decoration over the finished plant rather than as what
    // made it grow -- which is the reason this test is about the end of the shine
    // rather than only about its size.
    const sequence = SEQUENCE_BY_ID.get('bloom-showcase')!;
    let peak = 0;
    let last = 0;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const extra = sequence.pose(base, t).rays[0]!.lengthScale - 1;
      if (extra > 0.01) last = t;
      peak = Math.max(peak, extra);
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(last).toBeLessThan(drawnBy('bloom-showcase').get('flower')!);
  });

  it('draws every prop it declares, and nothing it does not', () => {
    // `assets` is the promise a sequence makes about what it paints. The whole-file
    // invariants check the two halves separately -- that every asset is a real prop
    // and that nothing undeclared is drawn -- so what is left to check is the
    // direction neither of them covers: a variant that declares a prop it never
    // draws, which is a cross-fade that has quietly stopped happening.
    for (const id of [...variants, 'bloom-still'] as const) {
      const sequence = SEQUENCE_BY_ID.get(id)!;
      expect([...drawnBy(id).keys()].sort(), `${id} draws`).toEqual([...sequence.assets].sort());
    }
  });

  it('plants it in the gap between her rays', () => {
    // The composition rule this row put on itself, and the one that took the
    // longest to get right: the plant is not drawn across a ray. She has eight,
    // and the two that own the lower right leave a 40-degree gap; a plant
    // anywhere else on that side is a stem through an orange triangle, which is
    // what the first attempt at this moment looked like.
    //
    // Measured rather than eyeballed, against the rays' real geometry: at the
    // radius a point sits at, a ray is this wide, and the point is clear if it is
    // further than that from the ray's axis.
    const halfWidthAt = (radius: number): number => {
      if (radius <= RAY.baseRadius || radius >= RAY.tipRadius) return 0;
      const along = (radius - RAY.baseRadius) / (RAY.tipRadius - RAY.baseRadius);
      return RAY.baseHalfWidth * (1 - along) + RAY.apexRadius * along;
    };
    const clearance = (x: number, y: number): number => {
      const radius = Math.hypot(x, y);
      if (radius >= RAY.tipRadius || radius <= RAY.baseRadius) return Infinity;
      const angle = (Math.atan2(x, -y) * 180) / Math.PI;
      return Math.min(
        ...RAY.anglesDeg.map((ray) => {
          const off = Math.abs(((angle - ray + 540) % 360) - 180);
          return radius * Math.sin((off * Math.PI) / 180) - halfWidthAt(radius);
        }),
      );
    };

    // The bloom's centre sits 30 units up the stem and its petals reach a further
    // 14, so the top of the flower is the highest point the artwork puts in the
    // gap; the leaf tips are the other extreme and are within 2.6 units of the
    // 131.5-degree ray at the lean this moment uses. Checked here at the two ends
    // of the plant that the rig can reason about -- the planting point and the top
    // of the bloom. Everything between them is inside that envelope, and the
    // baseline is what catches the artwork's own corners.
    const TOP_OF_BLOOM = 44;
    for (const id of [...variants, 'bloom-still'] as const) {
      const sequence = SEQUENCE_BY_ID.get(id)!;
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        for (const prop of sequence.pose(base, t).props) {
          if (prop.opacity <= 0.05) continue;
          expect(
            clearance(prop.x, prop.y),
            `${id} at t=${t}: ${prop.id} sits on a ray`,
          ).toBeGreaterThan(0);
          if (prop.id !== 'flower') continue;
          const lean = (prop.rotation * Math.PI) / 180;
          const top = {
            x: prop.x + Math.sin(lean) * TOP_OF_BLOOM * prop.scale,
            y: prop.y - Math.cos(lean) * TOP_OF_BLOOM * prop.scale,
          };
          expect(
            clearance(top.x, top.y),
            `${id} at t=${t}: the bloom's top sits on a ray`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('leaves the plant standing for a reduced-motion visitor', () => {
    // The same decision as A05's still and not A04's: there is no honest still of
    // a plant *growing*, but a flower standing beside her is an ordinary thing to
    // see, so asking for less motion costs the visitor the story and not the
    // plant. Three of the four stages are compressed into the one the row is
    // about, which is the honest thing to do with them.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 3 });
    a.play('bloom', 0);
    // For as long as the request lives, which is the clock of the variant the
    // setting picked rather than the still's own: a fallback runs on the length
    // of the moment it replaced, so the plant stands for the 6.2 s the showcase
    // would have taken.
    for (const now of [0, 3_000, 6_000]) {
      const frame = a.frame(now, { reducedMotion: true });
      expect(frame.sequenceId, `at ${now}`).toBe('bloom-still');
      expect(frame.rig.props.filter((p) => p.opacity > 0.001).map((p) => p.id)).toEqual(['flower']);
    }
    // And is then retired with the moment, which is what every finite moment does
    // with its props. Stated rather than left as a surprise: it is the *story* the
    // visitor is spared, not the picture.
    expect(a.frame(6_300, { reducedMotion: true }).sequenceId).toBe('idle-still');
    // And where it stands is where the growth puts it, which is what lets the
    // last stage be a cross-fade rather than two drawings sliding past each
    // other: the still and the grown flower share a planting point.
    const still = SEQUENCE_BY_ID.get('bloom-still')!.pose(base, 0).props[0]!;
    const grown = SEQUENCE_BY_ID.get('bloom-showcase')!
      .pose(defaultRig(), 0.7)
      .props.find((p) => p.id === 'flower')!;
    expect(still.x).toBe(grown.x);
    expect(still.y).toBe(grown.y);
  });

  it('picks the variant the tenant’s motion setting allows', () => {
    // `off` is not an absence here: the setting that removes the motion keeps the
    // plant, which is the same still a reduced-motion visitor gets.
    const cases: ReadonlyArray<[Intensity, string]> = [
      ['off', 'bloom-still'],
      ['minimal', 'bloom-seed'],
      ['balanced', 'bloom-grow'],
      ['playful', 'bloom-showcase'],
    ];
    for (const [intensity, id] of cases) {
      const a = new SunnyAnimator(defaultRig(), { intensity, seed: 3 });
      expect(a.play('bloom', 0), `asking at ${intensity}`).toBe(true);
      expect(a.frame(0).sequenceId, `at ${intensity}`).toBe(id);
    }
  });

  it('is refused where a plant would be out of place', () => {
    // The group lists `idle` and `playing`, the two states where she is not doing
    // anything else, so an application asking for the showcase in the middle of an
    // answer is dropped rather than layered over the visitor's answer.
    const a = new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 3 });
    a.dispatch({ type: 'turn_started' }, 0);
    a.dispatch({ type: 'speaking_started' }, 10);
    expect(a.state).toBe('speaking');
    expect(a.play('bloom', 20)).toBe(false);

    // Never once, over more than the whole of the longest variant's duration.
    const drawn = new Set<string | null>();
    for (let i = 0; i <= 140; i++) drawn.add(a.frame(20 + i * 50).sequenceId);
    for (const id of drawn) {
      expect(SEQUENCE_BY_ID.get(id ?? '')?.group, `${id} took the frame`).not.toBe('bloom');
    }
  });

  it('returns to the exact default pose, and leaves nothing behind', () => {
    // The row's acceptance is a finite moment that ends where it started. Exact,
    // not close: every field is written as `base.field + term` with a term that is
    // zero at both ends, so the comparison is `toEqual` rather than a tolerance --
    // and it covers the props too, which is the harder half, because a prop that
    // is merely nearly faded out is a flower that is still on screen.
    for (const id of variants) {
      const sequence = SEQUENCE_BY_ID.get(id)!;
      expect(sequence.pose(defaultRig(), 0), `${id} at t=0`).toEqual(base);
      expect(sequence.pose(defaultRig(), 1), `${id} at t=1`).toEqual(base);
      expect(sequence.pose(defaultRig(), 1).props, `${id} at t=1 leaves`).toHaveLength(0);
    }
  });

  it('cannot run two plantings at once', () => {
    // The same structural guard every other group relies on, checked here because
    // this group is the first one an application can ask for by name: two calls
    // from one page are far easier to make by accident than two identical machine
    // events.
    const scheduler = new Scheduler('playful', false);
    expect(scheduler.request('bloom', 'idle', 0)).toBe(true);
    expect(scheduler.request('bloom-grow', 'idle', 0)).toBe(false);
    expect(scheduler.active.filter((i) => i.sequence.group === 'bloom')).toHaveLength(1);
  });
});
