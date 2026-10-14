import { describe, expect, it } from 'vitest';

import {
  GESTURES,
  SEQUENCE_BY_ID,
  SunnyAnimator,
  lookupKindForTool,
  machineEventForStreamEvent,
  type MachineEvent,
  type RenderResult,
} from '@sunny/animation-engine';
import { defaultRig, type SunnyRig } from '@sunny/character';

/** One display frame at 60 Hz. */
const FRAME = 1000 / 60;

function animator(): SunnyAnimator {
  return new SunnyAnimator(defaultRig(), { intensity: 'playful', seed: 7 });
}

/** Run frames from `from` to `to`, collecting every result. */
function run(a: SunnyAnimator, from: number, to: number): RenderResult[] {
  const out: RenderResult[] = [];
  for (let t = from; t <= to; t += FRAME) out.push(a.frame(t));
  return out;
}

const groupOf = (id: string | null): string | undefined =>
  id === null ? undefined : SEQUENCE_BY_ID.get(id)?.group;

describe('the stream drives the acting', () => {
  it('starts speaking on the first words of the answer', () => {
    expect(machineEventForStreamEvent({ type: 'text_delta' })).toEqual({
      type: 'speaking_started',
    });
  });

  it('gets out a prop that fits the tool, and points only for the pointing tool', () => {
    expect(lookupKindForTool('retrieve_knowledge')).toBe('book');
    expect(lookupKindForTool('get_questionnaire')).toBe('book');
    expect(lookupKindForTool('search_catalogue')).toBe('magnifier');
    expect(lookupKindForTool('start_sunscan_assessment')).toBe('magnifier');
    expect(lookupKindForTool('calculate_approved_estimate')).toBe('laptop');
    expect(lookupKindForTool('something_new')).toBe('laptop');
    expect(
      machineEventForStreamEvent({ type: 'tool_started', tool: 'retrieve_knowledge' }),
    ).toEqual({ type: 'lookup', kind: 'book' });
    expect(
      machineEventForStreamEvent({ type: 'tool_started', tool: 'suggest_page_action' }),
    ).toEqual({ type: 'guiding_started' });
    expect(machineEventForStreamEvent({ type: 'tool_finished', tool: 'search_catalogue' })).toEqual(
      { type: 'lookup_finished' },
    );
  });
});

describe('the director', () => {
  it('reads a book while the knowledge base is searched, and puts it away after', () => {
    const a = animator();
    a.frame(0);
    a.dispatch({ type: 'turn_started' }, 0);
    a.dispatch({ type: 'lookup', kind: 'book' }, 100);
    const reading = run(a, 100, 1_500).at(-1)!;
    expect(reading.sequenceId).toBe('lookup-book');
    expect(reading.rig.props.map((p) => p.id)).toContain('book');

    a.dispatch({ type: 'lookup_finished' }, 1_600);
    const after = run(a, 1_600, 2_400).at(-1)!;
    expect(groupOf(after.sequenceId)).toBe('think');
    expect(after.rig.props.filter((p) => p.id === 'book' && p.opacity > 0.001)).toEqual([]);
  });

  it('swaps one prop for another when a second tool starts', () => {
    const a = animator();
    a.frame(0);
    a.dispatch({ type: 'turn_started' }, 0);
    a.dispatch({ type: 'lookup', kind: 'magnifier' }, 0);
    run(a, 0, 800);
    a.dispatch({ type: 'lookup', kind: 'laptop' }, 800);
    const now = run(a, 800, 1_800).at(-1)!;
    expect(now.sequenceId).toBe('lookup-laptop');
    expect(now.rig.props.filter((p) => p.opacity > 0.5).map((p) => p.id)).toEqual(['laptop']);
  });

  it('talks with its hands while answering, and never repeats a gesture back to back', () => {
    const a = animator();
    a.frame(0);
    a.dispatch({ type: 'turn_started' }, 0);
    a.dispatch({ type: 'speaking_started' }, 500);
    const played: string[] = [];
    for (const result of run(a, 500, 30_000)) {
      const id = result.sequenceId;
      if (id && (GESTURES as readonly string[]).includes(id) && played.at(-1) !== id) {
        played.push(id);
      }
    }
    expect(new Set(played).size).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
  });

  it('fidgets after a quiet spell, then gets the deckchair out, and gets up when someone types', () => {
    const a = animator();
    const results = run(a, 0, 50_000);
    const fidgets = results.filter(
      (r) => groupOf(r.sequenceId) === 'fidget' || groupOf(r.sequenceId) === 'balloon',
    );
    expect(fidgets.length).toBeGreaterThan(0);
    // Nothing before twenty seconds.
    expect(
      results.slice(0, Math.floor(19_000 / FRAME)).some((r) => groupOf(r.sequenceId) === 'fidget'),
    ).toBe(false);

    expect(a.state).toBe('relaxing');
    const lounging = results.at(-1)!;
    expect(lounging.sequenceId).toBe('lounge-deckchair');
    expect(lounging.rig.props.map((p) => p.id)).toContain('deckchair');

    a.dispatch({ type: 'user_typing' }, 50_100);
    expect(a.state).toBe('listening');
    const up = run(a, 50_100, 51_000).at(-1)!;
    expect(up.rig.props.filter((p) => p.opacity > 0.001)).toEqual([]);
  });

  it('nods when an answer is finished', () => {
    const a = animator();
    a.frame(0);
    a.dispatch({ type: 'turn_started' }, 0);
    a.dispatch({ type: 'speaking_started' }, 200);
    run(a, 0, 1_000);
    a.dispatch({ type: 'turn_finished' }, 1_000);
    expect(a.frame(1_050).sequenceId).toBe('settle-nod');
  });

  it('stays out of the way when a host drives every moment itself', () => {
    const a = new SunnyAnimator(defaultRig(), { director: false, seed: 7 });
    run(a, 0, 50_000);
    expect(a.state).toBe('idle');
  });
});

/**
 * The slideshow test. A whole conversation, frame by frame at 60 Hz, and no
 * frame may jump: the body, the head and each hand must travel a bounded
 * distance per frame. A cut between two poses -- the bug the compositor was
 * written for -- shows up here as one huge step.
 */
describe('continuity', () => {
  const SCRIPT: Array<[number, MachineEvent]> = [
    [500, { type: 'attention' }],
    [1_500, { type: 'user_typing' }],
    [2_500, { type: 'user_typing' }],
    [3_000, { type: 'turn_started' }],
    [4_200, { type: 'lookup', kind: 'book' }],
    [7_000, { type: 'lookup', kind: 'laptop' }],
    [9_000, { type: 'lookup_finished' }],
    [9_400, { type: 'speaking_started' }],
    [16_000, { type: 'celebrate' }],
    [21_000, { type: 'turn_started' }],
    [22_000, { type: 'turn_failed' }],
    [31_000, { type: 'user_typing' }],
    [32_000, { type: 'turn_started' }],
    [33_000, { type: 'speaking_started' }],
    [38_000, { type: 'turn_finished' }],
  ];
  const END = 90_000;

  function step(a: SunnyRig, b: SunnyRig): { body: number; turn: number; hand: number } {
    const body = Math.hypot(b.x - a.x, b.y - a.y);
    // Angles compared the short way round: 359 to 0 degrees is one degree.
    const dr = b.rotation - a.rotation;
    const turn = Math.abs(dr - 360 * Math.round(dr / 360)) + Math.abs(b.faceTilt - a.faceTilt);
    let hand = 0;
    for (const side of ['left', 'right'] as const) {
      const p = a.limbs.arms[side];
      const q = b.limbs.arms[side];
      // A hand only counts while it is out in both frames: a hand growing
      // from a tucked arm has nowhere to have been.
      if ((p.morph ?? 1) > 0.9 && (q.morph ?? 1) > 0.9) {
        hand = Math.max(hand, Math.hypot(q.hand.x - p.hand.x, q.hand.y - p.hand.y));
      }
    }
    return { body, turn, hand };
  }

  it('never cuts: every frame of a whole conversation is a small step from the last', () => {
    const a = animator();
    let previous: SunnyRig | null = null;
    let next = 0;
    let worst = { body: 0, turn: 0, hand: 0 };
    for (let t = 0; t <= END; t += FRAME) {
      while (next < SCRIPT.length && SCRIPT[next]![0] <= t) a.dispatch(SCRIPT[next++]![1], t);
      const { rig } = a.frame(t);
      if (previous) {
        const s = step(previous, rig);
        worst = {
          body: Math.max(worst.body, s.body),
          turn: Math.max(worst.turn, s.turn),
          hand: Math.max(worst.hand, s.hand),
        };
      }
      previous = rig;
    }
    // The bounds sit above the fastest real motion (a celebration spin turns
    // about 14 degrees a frame at its peak; a hand travels about 13 units in
    // the quickest blend) and well below a cut, which moves a hand ~50 units
    // (hip to chin) or the body 20 (sitting down) in one frame.
    expect(worst.body, 'body jumped').toBeLessThan(6);
    expect(worst.turn, 'rotation jumped').toBeLessThan(20);
    expect(worst.hand, 'a hand jumped').toBeLessThan(18);
  });

  it('is never frozen for long: something moves at least every second and a half', () => {
    const a = animator();
    let next = 0;
    let last = '';
    let stillSince = 0;
    let longest = 0;
    for (let t = 0; t <= END; t += FRAME) {
      while (next < SCRIPT.length && SCRIPT[next]![0] <= t) a.dispatch(SCRIPT[next++]![1], t);
      const drawn = JSON.stringify(a.frame(t).rig);
      if (drawn !== last) {
        longest = Math.max(longest, t - stillSince);
        stillSince = t;
        last = drawn;
      }
    }
    longest = Math.max(longest, END - stillSince);
    expect(longest).toBeLessThan(1_500);
  });
});
