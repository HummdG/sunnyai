import type { SunnyRig } from '@sunny/character';

import { SEQUENCE_BY_ID, bestInGroup, isEligible } from './sequences.js';
import {
  PRIORITY,
  type EngineContext,
  type Intensity,
  type Sequence,
  type SunnyState,
} from './types.js';

/** A sequence that is currently playing. */
export interface Instance {
  sequence: Sequence;
  startedAt: number;
}

export interface RenderResult {
  rig: SunnyRig;
  /** The sequence that produced `rig`, or null when the base pose is showing. */
  sequenceId: string | null;
  /** Sequences that lost this frame, strongest first. Useful in a debug overlay. */
  yields: string[];
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
  playing: 'idle',
  listening: 'idle',
  thinking: 'think',
  speaking: 'speak',
  guiding: 'guide',
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
  request(groupOrId: string, state: SunnyState, now: number): boolean {
    const sequence = SEQUENCE_BY_ID.get(groupOrId) ?? bestInGroup(groupOrId, this.#intensity);
    if (!sequence) return false;
    if (!sequence.states.includes(state)) return false;
    if (!isEligible(sequence, this.#intensity)) return false;
    if (this.#active.some((a) => a.sequence.group === sequence.group)) return false;
    this.#active.push({ sequence, startedAt: now });
    return true;
  }

  /** Drop every instance of a sequence, whether or not it has finished. */
  cancel(id: string): void {
    this.#active = this.#active.filter((a) => a.sequence.id !== id);
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
      this.#active = [];
      this.#floor = null;
      this.#floorGroup = null;
      return { rig: base, sequenceId: null, yields: [] };
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
    const resolved = pool
      .map((instance) => ({ instance, sequence: this.resolve(instance.sequence) }))
      .filter((e): e is { instance: Instance; sequence: Sequence } => e.sequence !== null)
      .filter((e) => isEligible(e.sequence, this.#intensity))
      .sort((a, b) => b.sequence.priority - a.sequence.priority);

    if (resolved.length === 0) {
      return { rig: base, sequenceId: null, yields: [] };
    }

    const winner = resolved[0]!;
    const elapsed = now - winner.instance.startedAt;
    const t = winner.sequence.loop
      ? (elapsed % winner.sequence.duration) / winner.sequence.duration
      : Math.min(1, elapsed / winner.sequence.duration);

    return {
      rig: winner.sequence.pose(base, t),
      sequenceId: winner.sequence.id,
      yields: resolved.slice(1).map((e) => e.sequence.id),
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
