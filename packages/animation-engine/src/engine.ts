import { defaultRig, type SunnyRig } from '@sunny/character';

import { SunnyMachine, type MachineEvent } from './machine.js';
import { Scheduler, type RenderResult } from './scheduler.js';
import { PRIORITY, type EngineContext, type Intensity, type SunnyState } from './types.js';

/** Milliseconds between blinks, when Sunny is resting. */
const BLINK_MIN_MS = 2_600;
const BLINK_MAX_MS = 6_400;

/**
 * A deterministic stand-in for Math.random.
 *
 * The engine must produce identical frames for identical inputs, or the
 * screenshot tests cannot pin anything. A 32-bit xorshift seeded per animator
 * gives variation that is random-looking to a visitor and reproducible to a
 * test.
 */
function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

export interface AnimatorOptions {
  intensity?: Intensity;
  reducedMotion?: boolean;
  /** Seed for the blink cadence. Fixed by default so replays match. */
  seed?: number;
}

/**
 * Ties the machine, the scheduler and a clock together.
 *
 * There is no `requestAnimationFrame` here and no DOM: `frame(now)` takes the
 * time as an argument and returns a rig. The widget owns the loop; the engine
 * stays testable and replayable.
 */
export class SunnyAnimator {
  readonly machine: SunnyMachine;
  readonly scheduler: Scheduler;
  #base: SunnyRig;
  #random: () => number;
  #nextBlinkAt = 0;
  #last: RenderResult | null = null;

  constructor(base: SunnyRig = defaultRig(), options: AnimatorOptions = {}) {
    this.#base = base;
    this.machine = new SunnyMachine('idle', 0);
    this.scheduler = new Scheduler(options.intensity ?? 'balanced', options.reducedMotion ?? false);
    this.#random = xorshift(options.seed ?? 0x5eed_1234);
  }

  get state(): SunnyState {
    return this.machine.state;
  }

  /** Replace the base pose, e.g. when a tenant changes its theme. */
  setBase(base: SunnyRig): void {
    this.#base = base;
  }

  /**
   * Apply an application event. This is the only way behaviour changes: there is
   * deliberately no API that takes an animation id from a model response, so a
   * compromised or over-eager model cannot drive the character past the
   * vocabulary the application compiled in.
   */
  dispatch(event: MachineEvent, now: number): void {
    const previous = this.machine.state;
    const result = this.machine.send(event, now);
    if (!result.changed) return;

    // Events are named by the moment they express, never by a variant id, so the
    // tenant's intensity setting picks the strength. A state change retires
    // anything not valid in the new state on the next frame; nothing else is
    // needed here.
    switch (event.type) {
      case 'celebrate':
        this.scheduler.request('celebrate', result.state, now);
        break;
      case 'impress':
        this.scheduler.request('cool', result.state, now);
        break;
      case 'confused':
        this.scheduler.request('confused', result.state, now);
        break;
      case 'turn_failed':
        this.scheduler.request('error', result.state, now);
        break;
      case 'guiding_started':
        this.scheduler.request('guide', result.state, now);
        break;
      case 'attention':
        this.scheduler.request('open', result.state, now);
        break;
      case 'speaking_started':
        // Coming out of thinking, the first token is the answer arriving, which
        // is the eureka's whole reason to exist. From anywhere else -- a host
        // that streams a greeting, a resumed turn -- there is no idea to land,
        // and asking for one would put a spark over an answer nobody worked out.
        if (previous === 'thinking') this.scheduler.request('eureka', result.state, now);
        break;
      default:
        break;
    }
  }

  /** Play a named moment now, e.g. the charging sequence a tool call triggers. */
  play(group: string, now: number): boolean {
    return this.scheduler.request(group, this.machine.state, now);
  }

  /** Run one frame. `now` is monotonic milliseconds. */
  frame(now: number, ctx: Partial<EngineContext> = {}): RenderResult {
    const context: EngineContext = {
      state: this.machine.state,
      intensity: this.scheduler.intensity,
      reducedMotion: ctx.reducedMotion ?? false,
      hidden: ctx.hidden ?? false,
      paused: ctx.paused ?? false,
      lowPower: ctx.lowPower ?? false,
    };

    this.machine.tick(now);

    if (!context.paused && !context.hidden && context.intensity !== 'off') {
      this.maybeBlink(now);
    }

    const result = this.scheduler.update(this.#base, this.machine.state, context, now);
    this.#last = result;
    return result;
  }

  get lastFrame(): RenderResult | null {
    return this.#last;
  }

  /**
   * Blinking is scheduled rather than baked into the idle sequence, because a
   * blink must be able to land *on top of* whatever else is playing: a visitor
   * being talked at should still see Sunny blink.
   */
  private maybeBlink(now: number): void {
    const blinkable: SunnyState[] = ['idle', 'listening', 'speaking', 'guiding', 'relaxing'];
    if (!blinkable.includes(this.machine.state)) {
      this.#nextBlinkAt = now + BLINK_MIN_MS;
      return;
    }
    if (this.#nextBlinkAt === 0) {
      this.#nextBlinkAt = now + BLINK_MIN_MS;
      return;
    }
    if (now < this.#nextBlinkAt) return;

    this.scheduler.request('blink', this.machine.state, now);

    this.#nextBlinkAt = now + BLINK_MIN_MS + this.#random() * (BLINK_MAX_MS - BLINK_MIN_MS);
  }
}

export { PRIORITY };
