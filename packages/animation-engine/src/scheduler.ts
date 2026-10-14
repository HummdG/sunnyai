import { cloneRig, type SunnyRig } from '@sunny/character';

import { BLEND_MS, Compositor, STATE_BLEND_MS } from './compositor.js';
import { SEQUENCE_BY_ID, bestInGroup, isEligible } from './sequences.js';
import {
  PRIORITY,
  type EngineContext,
  type Intensity,
  type MomentAnchor,
  type Sequence,
  type SunnyState,
} from './types.js';

/** A sequence that is currently playing. */
export interface Instance {
  sequence: Sequence;
  startedAt: number;
  /**
   * The anchor the moment was asked for with, if any. Carried on the instance
   * rather than read from the frame, because a moment outlives the input that
   * started it: the burst is still being drawn a fifth of a second after the
   * finger left.
   */
  anchor?: MomentAnchor;
}

export interface RenderResult {
  rig: SunnyRig;
  /** The sequence that produced `rig`, or null when the base pose is showing. */
  sequenceId: string | null;
  /** Sequences that lost this frame, strongest first. Useful in a debug overlay. */
  yields: string[];
  /** Overlay sequences (a blink) drawn on top of the winner this frame. */
  overlays: string[];
}

/**
 * The group whose ambient behaviour underlies each state: what Sunny does when
 * nothing more interesting is happening. States absent from this map show the
 * base pose alone, which is right for the brief reactive states (`confused`,
 * `error`) whose sequence *is* the whole behaviour.
 */
const AMBIENT_GROUP: Partial<Record<SunnyState, string>> = {
  idle: 'idle',
  relaxing: 'idle',
  // A game borrows the resting layer for the same reason the relaxing state
  // does: the play moves are short bursts at the start of the session, and what
  // the visitor is looking at for the rest of it is a character breathing
  // quietly beside a board. See A07 in `sequences.ts`.
  playing: 'idle',
  listening: 'idle',
  thinking: 'think',
  speaking: 'speak',
  guiding: 'guide',
  // The reactive states used to have no floor, so once their short moment was
  // over Sunny stood as a bare, unbreathing base pose for seconds (error: until
  // the next event). Each now has a quiet loop of its own underneath.
  celebrating: 'celebrate-glow',
  confused: 'ponder',
  error: 'droop',
};

/**
 * Chooses which sequence renders on a given frame.
 *
 * The rules, in the order they are applied:
 *
 *  1. Paused or hidden shows the base pose. Nothing runs, nothing is scheduled.
 *  2. A sequence below the tenant's intensity floor is never eligible -- the
 *     intensity setting is a ceiling on motion, not a suggestion.
 *  3. Under `prefers-reduced-motion` a sequence is replaced by its declared
 *     fallback, or dropped entirely when it declares none.
 *  4. Of what remains, the highest priority wins. A running sequence keeps the
 *     frame unless the challenger outranks it *and* the incumbent can be
 *     interrupted, or the incumbent has finished.
 */
export class Scheduler {
  #active: Instance[] = [];
  #intensity: Intensity;
  #reducedMotion: boolean;
  #floor: Instance | null = null;
  #floorGroup: string | null = null;
  readonly #compositor = new Compositor();

  constructor(intensity: Intensity = 'balanced', reducedMotion = false) {
    this.#intensity = intensity;
    this.#reducedMotion = reducedMotion;
  }

  get intensity(): Intensity {
    return this.#intensity;
  }

  setIntensity(intensity: Intensity): void {
    this.#intensity = intensity;
  }

  setReducedMotion(reduced: boolean): void {
    this.#reducedMotion = reduced;
  }

  get active(): readonly Instance[] {
    return this.#active;
  }

  /**
   * Ask for a behavioural moment, by group name (`celebrate`, `think`) or by a
   * specific sequence id.
   *
   * Callers should normally name the group. Naming a group means the tenant's
   * intensity setting selects the variant, so lowering intensity makes a
   * celebration quieter instead of removing it -- the failure mode where a
   * setting silently deletes a whole behaviour in production but not in tests.
   *
   * Returns false when nothing could be chosen. That is a silent no-op rather
   * than an error: asking for a moment that cannot play is not a fault.
   */
  request(groupOrId: string, state: SunnyState, now: number, anchor?: MomentAnchor): boolean {
    const sequence = SEQUENCE_BY_ID.get(groupOrId) ?? bestInGroup(groupOrId, this.#intensity);
    if (!sequence) return false;
    if (!sequence.states.includes(state)) return false;
    if (!isEligible(sequence, this.#intensity)) return false;
    if (this.#active.some((a) => a.sequence.group === sequence.group)) return false;
    this.#active.push({ sequence, startedAt: now, ...(anchor ? { anchor } : {}) });
    return true;
  }

  /**
   * Drop everything currently playing for a group or a sequence id.
   *
   * Named the same way `request` is, and for the same reason: a caller that
   * asked for `balloon` did not choose between `balloon-sway` and
   * `balloon-wander`, so it cannot name the one it wants back. More to the
   * point, the sequence a group request installed is *not* the sequence that
   * renders: `request('balloon', …)` stores whichever variant the intensity
   * picked, and under reduced motion it renders a third sequence again. An
   * id-only cancel silently matches none of those and the moment the caller
   * meant to stop keeps running underneath -- which is exactly the bug it was
   * written to prevent.
   */
  cancel(groupOrId: string): void {
    this.#active = this.#active.filter(
      (a) => a.sequence.id !== groupOrId && a.sequence.group !== groupOrId,
    );
  }

  /**
   * Forget everything that is playing, including the ambient floor.
   *
   * A requested sequence expires on its own clock, which starts when it is
   * *asked for* rather than when it is first drawn. So a moment can be queued
   * behind a longer, higher-priority one for its whole life and never be seen:
   * the celebration asked for while a 2.6 s charging panel plays is drawn on no
   * frame at all. That is the priority system working -- the alternative is a
   * moment landing late, detached from its cause -- but it means a caller that
   * wants an independent, isolated encounter with a moment has to clear the
   * stage first rather than hope the last one has finished. The animation lab's
   * gallery is exactly that caller: every `Play` is a fresh question, so a
   * previous demo must not be the answer.
   */
  clear(): void {
    this.#active = [];
    this.#floor = null;
    this.#floorGroup = null;
    this.#compositor.reset();
  }

  /** Resume the sequence a state change interrupted, if it qualifies. */
  private settled(instance: Instance, now: number): boolean {
    const { sequence, startedAt } = instance;
    if (sequence.loop) return false;
    return now - startedAt >= sequence.duration;
  }

  private resolve(sequence: Sequence): Sequence | null {
    if (!this.#reducedMotion) return sequence;
    const fallbackId = sequence.reducedMotionFallback;
    if (fallbackId === null) return null;
    return SEQUENCE_BY_ID.get(fallbackId) ?? null;
  }

  /**
   * Advance to `now` and pick the frame. Pure with respect to the clock: calling
   * it twice with the same `now` returns the same rig, which is what lets tests
   * and screenshot harnesses drive it deterministically.
   */
  update(base: SunnyRig, state: SunnyState, ctx: EngineContext, now: number): RenderResult {
    this.#reducedMotion = ctx.reducedMotion || ctx.lowPower;
    this.#intensity = ctx.paused ? 'off' : ctx.intensity;

    if (ctx.paused || ctx.hidden) {
      this.clear();
      return { rig: base, sequenceId: null, yields: [], overlays: [] };
    }

    // Retire finished instances and anything no longer valid for this state.
    this.#active = this.#active.filter(
      (a) => !this.settled(a, now) && a.sequence.states.includes(state),
    );

    // The ambient layer is always present underneath, so there is something to
    // render even when every requested sequence has been filtered out. Its start
    // time is pinned for as long as the state lasts -- a floor rebuilt on every
    // frame would hold a looping sequence at t = 0 and Sunny would stand frozen.
    const ambientGroup = AMBIENT_GROUP[state];
    const ambient = ambientGroup ? bestInGroup(ambientGroup, this.#intensity) : null;
    if (!ambient || ambient.group !== this.#floorGroup) {
      this.#floor = ambient ? { sequence: ambient, startedAt: now } : null;
      this.#floorGroup = ambient?.group ?? null;
    } else if (this.#floor && this.#floor.sequence.id !== ambient.id) {
      // The intensity changed under us and a different variant now fits.
      this.#floor = { sequence: ambient, startedAt: now };
    }

    const floor = this.#floor;
    const pool = floor ? [...this.#active, floor] : [...this.#active];
    const eligible = pool
      .map((instance) => ({ instance, sequence: this.resolve(instance.sequence) }))
      .filter((e): e is { instance: Instance; sequence: Sequence } => e.sequence !== null)
      .filter((e) => isEligible(e.sequence, this.#intensity));
    // Overlays (a blink) never compete for the frame: they are drawn on top of
    // whatever wins, so a blink no longer freezes the bounce underneath it.
    const overlays = eligible.filter((e) => e.sequence.layer === 'eyelids');
    const resolved = eligible
      .filter((e) => e.sequence.layer === undefined)
      .sort((a, b) => b.sequence.priority - a.sequence.priority);

    const progress = (e: { instance: Instance; sequence: Sequence }): number => {
      const elapsed = now - e.instance.startedAt;
      return e.sequence.loop
        ? (elapsed % e.sequence.duration) / e.sequence.duration
        : Math.min(1, elapsed / e.sequence.duration);
    };

    const winner = resolved[0];
    let target = winner
      ? winner.sequence.pose(base, progress(winner), winner.instance.anchor)
      : base;

    if (overlays.length > 0) {
      target = cloneRig(target);
      for (const o of overlays) {
        const lid = o.sequence.pose(base, progress(o), o.instance.anchor);
        target.eyes.left.closed = Math.max(target.eyes.left.closed, lid.eyes.left.closed);
        target.eyes.right.closed = Math.max(target.eyes.right.closed, lid.eyes.right.closed);
      }
    }

    const key = winner ? `${winner.sequence.id}@${winner.instance.startedAt}` : null;
    const rig = this.#compositor.compose(target, now, {
      key,
      blendMs:
        winner?.sequence.blendInMs ??
        (winner && winner.instance === floor ? STATE_BLEND_MS : BLEND_MS),
      reducedMotion: this.#reducedMotion,
    });

    return {
      rig,
      sequenceId: winner?.sequence.id ?? null,
      yields: resolved.slice(1).map((e) => e.sequence.id),
      overlays: overlays.map((e) => e.sequence.id),
    };
  }

  /** Everything the scheduler could play right now, for a debug overlay. */
  options(state: SunnyState): Sequence[] {
    return [...SEQUENCE_BY_ID.values()]
      .filter((s) => s.states.includes(state))
      .filter((s) => isEligible(s, this.#intensity))
      .sort((a, b) => b.priority - a.priority);
  }

  /** The priority band a state's ambient behaviour sits in. Exposed for tests. */
  static ambientPriority(state: SunnyState): number {
    const group = AMBIENT_GROUP[state];
    if (!group) return PRIORITY.idle;
    return bestInGroup(group, 'playful')?.priority ?? PRIORITY.idle;
  }
}
