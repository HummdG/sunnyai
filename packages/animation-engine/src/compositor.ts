import { cloneRig, lerpRig, type SunnyRig } from '@sunny/character';

/**
 * What turns a list of poses into motion.
 *
 * The scheduler answers "which sequence is on screen"; on its own that answer
 * changes in a single frame, and every change was a cut: a blink froze the
 * bounce, a state change snapped an arm to the chin, a moment ending dropped the
 * body back to rest. That is what made Sunny read as a slideshow. The rive brief
 * (§4) asked for every sequence to blend back within ~150-250 ms; this is that
 * blend, plus the follow-through that makes the result read as a game rather
 * than as poses.
 *
 * Two passes, both history-dependent but deterministic for a given sequence of
 * calls (calling twice with the same `now` returns the same rig):
 *
 *  1. **Transition blend.** When the thing on screen changes, the compositor
 *     blends from the rig it last drew -- not from the base pose -- into the new
 *     target over `BLEND_MS`. A blend interrupted by another change starts from
 *     wherever the first one had got to, so there is never a jump.
 *  2. **Follow-through.** A damped spring trails the body. Its lag drags the
 *     rays and hands a beat behind, so a hop leaves the crown and the mittens
 *     catching up -- overlapping action, the rubber-hose signature.
 */

/** How long a change of sequence takes to blend in. */
export const BLEND_MS = 180;

/** A state's resting loop takes a touch longer, so the arm eases to the chin. */
export const STATE_BLEND_MS = 260;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export interface ComposeOptions {
  /** A key that changes whenever the source of the target changes. */
  key: string | null;
  /** Blend duration for this change, when it is one. */
  blendMs?: number;
  reducedMotion?: boolean;
}

export class Compositor {
  #last: SunnyRig | null = null;
  #from: SunnyRig | null = null;
  #blendStart = 0;
  #blendMs = BLEND_MS;
  #key: string | null = null;
  #lastNow: number | null = null;
  readonly #follow = new FollowThrough();

  /** Forget history: the next frame is drawn as-is, with nothing to blend from. */
  reset(): void {
    this.#last = null;
    this.#from = null;
    this.#key = null;
    this.#lastNow = null;
    this.#follow.reset();
  }

  compose(target: SunnyRig, now: number, options: ComposeOptions): SunnyRig {
    // Time running backwards is a test or a replay starting over: start clean.
    if (this.#lastNow !== null && now < this.#lastNow) this.reset();
    const previous = this.#lastNow;
    this.#lastNow = now;

    if (options.key !== this.#key) {
      this.#from = this.#last;
      // The change happened at some point since the last frame was drawn, so
      // the blend is timed from that frame: the first new frame is already on
      // its way, and a long gap (a test jumping ahead) arrives fully blended.
      this.#blendStart = previous ?? now;
      this.#blendMs = options.blendMs ?? BLEND_MS;
      this.#key = options.key;
    }

    let rig = target;
    if (this.#from) {
      const k = (now - this.#blendStart) / this.#blendMs;
      if (k >= 1) this.#from = null;
      else rig = lerpRig(this.#from, target, easeOutCubic(Math.max(0, k)));
    }

    // Reduced motion keeps the gentle blend (it is a fade between still poses)
    // but not the springs, which exist only to add motion.
    rig = options.reducedMotion ? rig : this.#follow.apply(rig, now);
    this.#last = rig;
    return rig;
  }
}

/** Fixed integration step, so the springs do not depend on the display rate. */
const STEP_MS = 1000 / 120;
/** A gap longer than this (a hidden tab, a test jumping ahead) resets the springs. */
const MAX_GAP_MS = 250;
/** Spring stiffness and damping: about 2.3 Hz, a little under-damped (one wobble). */
const OMEGA = 14.5;
const ZETA = 0.42;
/** Lag below this, in viewBox units/degrees, is treated as none (so poses land exactly). */
const DEADZONE = 0.04;
const MAX_LAG = 7;
const MAX_ROT_LAG = 14;

interface Spring {
  p: number;
  v: number;
}

const springStep = (s: Spring, target: number, dt: number): void => {
  const a = OMEGA * OMEGA * (target - s.p) - 2 * ZETA * OMEGA * s.v;
  s.v += a * dt;
  s.p += s.v * dt;
};

const clamp = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);

/**
 * Overlapping action: springs that trail the body's position and rotation.
 *
 * The lag (spring minus body) is applied to the parts that should be loose --
 * the rays and the hands -- so they arrive a beat after the body and overshoot
 * once. Integrated in fixed steps from a known start, so it is reproducible.
 */
export class FollowThrough {
  #x: Spring | null = null;
  #y: Spring = { p: 0, v: 0 };
  #r: Spring = { p: 0, v: 0 };
  #t = 0;

  reset(): void {
    this.#x = null;
  }

  apply(rig: SunnyRig, now: number): SunnyRig {
    if (this.#x === null || now - this.#t > MAX_GAP_MS || now < this.#t) {
      this.#x = { p: rig.x, v: 0 };
      this.#y = { p: rig.y, v: 0 };
      this.#r = { p: rig.rotation, v: 0 };
      this.#t = now;
      return rig;
    }
    while (now - this.#t >= STEP_MS) {
      const dt = STEP_MS / 1000;
      springStep(this.#x, rig.x, dt);
      springStep(this.#y, rig.y, dt);
      springStep(this.#r, rig.rotation, dt);
      this.#t += STEP_MS;
    }

    const lagX = clamp(this.#x.p - rig.x, MAX_LAG);
    const lagY = clamp(this.#y.p - rig.y, MAX_LAG);
    const lagR = clamp(this.#r.p - rig.rotation, MAX_ROT_LAG);
    if (Math.abs(lagX) < DEADZONE && Math.abs(lagY) < DEADZONE && Math.abs(lagR) < DEADZONE) {
      return rig;
    }

    // The lag is in the viewBox; rays and hands live in the body frame, which
    // is rotated and scaled. Bring the drag into that frame.
    const a = (-rig.rotation * Math.PI) / 180;
    const s = rig.scale || 1;
    const lx = (lagX * Math.cos(a) - lagY * Math.sin(a)) / s;
    const ly = (lagX * Math.sin(a) + lagY * Math.cos(a)) / s;

    const out = cloneRig(rig);
    for (const ray of out.rays) {
      ray.offset.x += lx * 0.45;
      ray.offset.y += ly * 0.45;
      ray.rotation += lagR * 0.55;
    }
    for (const arm of [out.limbs.arms.left, out.limbs.arms.right]) {
      arm.hand.x += lx * 0.7;
      arm.hand.y += ly * 0.7;
      arm.handRotation += lagR * 0.8;
    }
    // Squash-and-stretch from vertical speed: falling stretches, landing squashes
    // is already authored, so only the in-flight stretch is added here.
    const vy = this.#y.v / s;
    out.stretch -= clamp(Math.abs(vy) * 0.0006, 0.03);
    out.squash -= clamp(Math.abs(vy) * 0.0005, 0.025);
    return out;
  }
}
