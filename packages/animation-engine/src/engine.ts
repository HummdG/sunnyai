import {
  BODY,
  defaultRig,
  toBodyFrame,
  type PropId,
  type SunnyRig,
  type Vec2,
} from '@sunny/character';

import { SunnyMachine, type MachineEvent } from './machine.js';
import { Scheduler, type RenderResult } from './scheduler.js';
import { PRIORITY, type EngineContext, type Intensity, type SunnyState } from './types.js';

/** Milliseconds between blinks, when Sunny is resting. */
const BLINK_MIN_MS = 2_600;
const BLINK_MAX_MS = 6_400;

/**
 * How close a pointer has to come to a prop's centre to count as a hit on it, in
 * body units, scaled by the prop's own scale.
 *
 * Generous on purpose, because this is not a selection tool: there is exactly one
 * thing in the scene that can be tapped. The balloon is about 27 units across, so
 * a radius of 24 is the whole prop plus enough slack for a thumb. A prop without
 * an entry here has a radius of zero -- unhittable -- which is the safe default:
 * a prop becomes tappable by being given a radius, never by being drawn.
 */
const TAP_RADIUS: Readonly<Partial<Record<PropId, number>>> = { balloon: 24 };

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
      case 'play_started':
        // Nothing used to happen here. `play_started` moved the machine into
        // `playing` and the playing state borrowed the idle layer, so the event
        // changed no pixel: a game could start and Sunny would carry on
        // breathing as if nothing had been said. The move is what makes the
        // state mean something -- asked for by group, so the tenant's intensity
        // setting chooses the shuffle, the run or the dance.
        this.scheduler.request('play', result.state, now);
        break;
      case 'dismissed':
        // The visitor closed the chat, so Sunny takes a break: `relaxing` is a
        // production state -- the widget's own `close()` dispatches this, and the
        // frame loop keeps running afterwards -- and until now the state borrowed
        // the idle layer, which is why closing the panel changed nothing but the
        // panel. The chair is a finite event, so reopening the chat retires it
        // along with the state.
        this.scheduler.request('relax', result.state, now);
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

  /**
   * Stop everything that is playing and let the next frame start clean.
   *
   * For a surface that asks for moments out of any context -- the lab's gallery,
   * where each button is a separate demonstration -- rather than one that is
   * following a conversation, where the previous moment is part of the story.
   */
  reset(): void {
    this.scheduler.clear();
  }

  /**
   * A pointer gesture on the character, given in viewBox coordinates. Returns
   * whether Sunny had anything to say about it.
   *
   * **Hit-tested against what was drawn.** The test is made against the last rig
   * the animator rendered rather than against anything current, for the same
   * reason a button responds where it is rather than where it will be: the
   * visitor pointed at a picture, and the picture they saw is the one that was on
   * screen when their finger went down. Both the balloon's position and its size
   * come from that frame, so a tap where the balloon is at the moment it is seen
   * lands, and a tap where it was half a second ago does not.
   *
   * **Two gestures, one entry point.** A tap on the balloon pops it; a tap on her
   * puts a balloon in her hands. Anything else the pointer lands on -- a ray tip,
   * the empty canvas -- is not a hit and changes nothing, because a character
   * that reacts to being touched anywhere is a character that cannot be *not*
   * touched.
   */
  tap(point: Vec2, now: number): boolean {
    const rig = this.#last?.rig ?? this.#base;
    const local = toBodyFrame(rig, point);

    // The balloon first: it is drawn over everything else and it is small, so a
    // point inside it is far likelier to have meant the balloon than the body it
    // happens to overlap. A balloon faded to nothing is not there to be hit.
    const balloon = rig.props.find((prop) => prop.id === 'balloon' && prop.opacity > 0.05);
    if (balloon) {
      const radius = (TAP_RADIUS.balloon ?? 0) * balloon.scale;
      if (Math.hypot(local.x - balloon.x, local.y - balloon.y) <= radius) {
        // The float is cancelled rather than left underneath: the burst is what
        // replaced it, and a balloon still drifting away beside its own shards
        // would be two answers to one gesture.
        this.scheduler.cancel('balloon');
        return this.scheduler.request('pop', this.machine.state, now, { point });
      }
    }

    // Then the body itself, and only the body: the rays are part of the drawing
    // but not part of the silhouette, and the state has to be one where a toy is
    // welcome at all -- the scheduler refuses the rest.
    if (Math.hypot(local.x, local.y) <= BODY.radius) {
      return this.scheduler.request('balloon', this.machine.state, now);
    }

    return false;
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
    // `playing` is in the list even though a play move outranks a blink: a game
    // is long, the move is a short burst at the start of it, and between bursts
    // the resting layer is what the visitor is looking at. A character that
    // stops blinking for the length of a game reads as switched off.
    const blinkable: SunnyState[] = [
      'idle',
      'listening',
      'speaking',
      'guiding',
      'relaxing',
      'playing',
    ];
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
