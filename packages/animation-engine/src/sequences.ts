import { withLimbActing } from './limb-acting.js';
import {
  blendLimbs,
  cloneRig,
  limbPose,
  toBodyFrame,
  toViewBox,
  type PropRig,
  type SunnyRig,
  type Vec2,
} from '@sunny/character';

import {
  PRIORITY,
  type Intensity,
  type MomentAnchor,
  type Sequence,
  type SunnyState,
} from './types.js';

// ─── small maths helpers ─────────────────────────────────────────────────────

const TAU = Math.PI * 2;

/** A sine wave over one period, phase `p` in 0..1, returning -1..1. */
const wave = (p: number, phase = 0): number => Math.sin((p + phase) * TAU);

/** Smooth 0→1→0 over the sequence, used to fade a gesture in and out. */
const bump = (t: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));

/**
 * Like `bump`, but *exactly* zero at both ends.
 *
 * `bump(1)` is `sin(pi)`, which is 1.2e-16 rather than 0, so a pose built from
 * it leaves the rig a hair off the base pose at the final frame. That is
 * invisible and was fine for every sequence whose only job is to *look* like it
 * settled -- but A10's acceptance is that the spin returns to the *exact*
 * default pose, and "exact" has to mean exactly zero or the claim cannot be
 * asserted with `toEqual`. The clamp is the whole difference.
 */
const land = (t: number): number => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));

/**
 * A rotation that completes a whole number of turns and lands back on zero.
 *
 * `whole * 360` degrees is a whole number of revolutions, and `% 360` folds it
 * back into 0..359 -- which is the same picture, so the motion is continuous,
 * while the *value* is exactly 0 at the end. Without the modulo a two-turn spin
 * would end at 720 and the rig would differ from the base pose by a number that
 * renders identically and compares differently.
 */
const turns = (t: number, whole: number): number => (whole * 360 * t) % 360;

/**
 * A bump over `[from, to]` that is *exactly* zero outside it.
 *
 * The bounds are tested against `t` rather than against the divided progress,
 * which is the whole point: `(1 - 0.72) / 0.28` is 0.9999999999999999 and not 1,
 * so a `land((t - 0.72) / 0.28)` bloom would leave the rays a hair long on the
 * final frame -- invisible, and enough to fail a `toEqual` against the base rig.
 */
const swell = (t: number, from: number, to: number): number =>
  t <= from || t >= to ? 0 : Math.sin(Math.PI * ((t - from) / (to - from)));

/** Smoothstep, for gestures that should ease rather than start and stop abruptly. */
const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// ─── 1930s cartoon timing ────────────────────────────────────────────────────
//
// Rubber-hose animation reads as alive because nothing moves linearly: every
// move is anticipated (a pull back before it goes), overshoots, and settles
// with a wobble; a bounce squashes on contact and stretches in flight; and
// loose parts -- the rays -- follow through a beat behind the body.

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** Ease-out that overshoots its target and comes back (a "back" ease). */
const overshoot = (t: number, s = 1.9): number => {
  const c = clamp01(t) - 1;
  return 1 + c * c * ((s + 1) * c + s);
};

/** A damped wobble that is exactly zero at t = 0 and t = 1. */
const settle = (t: number, cycles = 2.5, decay = 4.5): number =>
  t <= 0 || t >= 1 ? 0 : Math.sin(t * cycles * TAU) * Math.exp(-decay * t) * (1 - t);

/**
 * One rubber-hose bounce over phase `p` (periodic): `lift` is 0 at contact and
 * 1 at the top; `squash` spikes at contact; `stretch` is greatest when the
 * body moves fastest, between the two.
 */
function hoseBounce(p: number): { lift: number; squash: number; stretch: number } {
  const ph = ((p % 1) + 1) % 1;
  const lift = Math.sin(ph * Math.PI);
  const edge = Math.min(ph, 1 - ph);
  const squash = Math.max(0, 1 - edge / 0.14) ** 2;
  const stretch = Math.abs(Math.cos(ph * Math.PI)) * (1 - squash);
  return { lift, squash, stretch };
}

/**
 * Elastic rays: a wave travels round the ring so the rays flex one after
 * another, like rubber, instead of moving as a rigid crown. `p` is periodic.
 */
function rubberRays(r: SunnyRig, p: number, amount: number): void {
  for (const [i, ray] of r.rays.entries()) {
    const phase = i / r.rays.length;
    ray.rotation += wave(p, -phase) * 7 * amount;
    ray.lengthScale *= 1 + wave(p, 0.25 - phase) * 0.09 * amount;
    ray.widthScale *= 1 - wave(p, 0.25 - phase) * 0.05 * amount;
  }
}

/** Apply the same change to both eyes. */
function eyes(r: SunnyRig, f: (eye: SunnyRig['eyes']['left']) => void): void {
  f(r.eyes.left);
  f(r.eyes.right);
}

/** A prop at full strength. */
function prop(id: PropRig['id'], x: number, y: number, scale: number, rotation = 0): PropRig {
  return { id, x, y, rotation, scale, opacity: 1 };
}

// ─── the flagship sequences ──────────────────────────────────────────────────

/**
 * A01, the resting layer. A slow breath in the body and a gaze that drifts
 * between a few fixed points.
 *
 * The gaze targets are a literal list rather than anything random: a screenshot
 * test needs to know what it will see at t = 0.42. Idle is deliberately sparse,
 * per the character spec -- one gesture per breath, not a fidget.
 */
const idle: Sequence = {
  id: 'idle-breathe',
  group: 'idle',
  priority: PRIORITY.idle,
  duration: 6000,
  canInterrupt: true,
  loop: true,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: 'idle-still',
  states: ['idle', 'relaxing'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // Six easy bounces per loop, about one a second: the rubber-hose idle.
    // Small enough to sit on someone's website, big enough to read as alive.
    const b = hoseBounce(t * 6);
    r.y = base.y - b.lift * 3.2;
    r.squash = b.squash * 0.07 - b.stretch * 0.025;
    r.stretch = b.stretch * 0.035 - b.squash * 0.04;
    // The head sways on every other beat, a little behind the body.
    r.faceTilt = wave(t * 3, -0.12) * 2.6;
    rubberRays(r, t * 6 - 0.15, 0.7);
    // Gaze drifts around a short loop of points, holding on each.
    const phase = (t * 4) % 1;
    const hold = ease(Math.min(1, phase * 3));
    const targets: ReadonlyArray<[number, number]> = [
      [0, 0],
      [0.55, 0.15],
      [-0.4, 0.3],
      [-0.15, -0.2],
    ];
    const from = targets[Math.floor(t * 4) % targets.length]!;
    const to = targets[(Math.floor(t * 4) + 1) % targets.length]!;
    r.eyes.left.gaze = {
      x: from[0] + (to[0] - from[0]) * hold,
      y: from[1] + (to[1] - from[1]) * hold,
    };
    r.eyes.right.gaze = { ...r.eyes.left.gaze };
    // Brows ride the bounce a touch, which is most of what makes it a face.
    r.brows.left.y = base.brows.left.y - b.lift * 0.9;
    r.brows.right.y = base.brows.right.y - b.lift * 0.9;
    return r;
  },
};

/** The reduced-motion fallback for idle: a held, static rest pose. */
const idleStill: Sequence = {
  id: 'idle-still',
  group: 'idle',
  priority: PRIORITY.idle,
  duration: 1,
  canInterrupt: true,
  loop: true,
  intensity: 'off',
  assets: [],
  reducedMotionFallback: null,
  states: ['idle', 'relaxing'],
  pose: (base) => cloneRig(base),
};

/**
 * A blink is fast and asymmetric on purpose: the close takes about a third of
 * the time the open does, which is what stops it reading as a mechanical shutter.
 */
const blink: Sequence = {
  id: 'blink',
  group: 'blink',
  priority: PRIORITY.idle + 20,
  duration: 160,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['idle', 'listening', 'speaking', 'guiding', 'relaxing', 'playing'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const close = t < 0.35 ? ease(t / 0.35) : 1 - ease((t - 0.35) / 0.65);
    r.eyes.left.closed = close;
    r.eyes.right.closed = close;
    return r;
  },
};

/** The visitor got our attention: eyes widen, rays lift a little, body rises. */
const listening: Sequence = {
  id: 'listening-perk',
  group: 'listen',
  priority: PRIORITY.interaction,
  duration: 700,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: [],
  reducedMotionFallback: null,
  states: ['listening'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // Anticipate (dip and squash), pop up tall with big eyes, then settle on a
    // wobble back to rest.
    const dip = t < 0.18 ? Math.sin((t / 0.18) * Math.PI * 0.5) * (1 - t / 0.18) * 1.6 : 0;
    const pop = t < 0.18 ? 0 : overshoot((t - 0.18) / 0.35) * (1 - ease((t - 0.5) / 0.5));
    const wob = settle(t, 2, 3);
    r.y = base.y + dip * 3 - pop * 5;
    r.squash = dip * 0.12 - pop * 0.06 + wob * 0.04;
    r.stretch = pop * 0.08 - dip * 0.06;
    eyes(r, (eye) => {
      eye.scaleY = 1 + pop * 0.32 - dip * 0.25;
      eye.scaleX = 1 + pop * 0.1;
    });
    r.brows.left.y = base.brows.left.y - pop * 4;
    r.brows.right.y = base.brows.right.y - pop * 4;
    for (const [i, ray] of r.rays.entries()) {
      ray.lengthScale = 1 + pop * 0.14 - dip * 0.12 + settle(clamp01(t - i * 0.02), 2, 3) * 0.08;
    }
    r.smile.depth = base.smile.depth * (1 + pop * 0.3);
    return r;
  },
};

/**
 * The minimal listener. The eyes still widen -- that is the whole of the signal
 * and it is legible without any body movement -- but the rise and the ray lift
 * are dropped. Without this, turning the character down to minimal deleted the
 * acknowledgement that the visitor had been heard.
 */
const listeningStill: Sequence = {
  id: 'listening-still',
  group: 'listen',
  priority: PRIORITY.interaction,
  duration: 700,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['listening'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const a = bump(t);
    r.eyes.left.scaleY = 1 + a * 0.12;
    r.eyes.right.scaleY = 1 + a * 0.12;
    return r;
  },
};

/**
 * A02 thinking. The rays turn like a slow mechanism while the eyes track up and
 * left, which is the direction people read as "recalling" rather than "seeing".
 */
const thinking: Sequence = {
  id: 'thinking-whirr',
  group: 'think',
  priority: PRIORITY.chat,
  duration: 2400,
  canInterrupt: true,
  loop: true,
  intensity: 'balanced',
  assets: [],
  reducedMotionFallback: 'thinking-still',
  states: ['thinking'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // A clockwork tick-tock: the ring of rays rocks on four beats, each one
    // snapping past its mark and settling, like an escapement working a thought.
    const beat = t * 4;
    const k = Math.floor(beat);
    const f = beat - k;
    const dir = k % 2 === 0 ? 1 : -1;
    const tick = dir * (overshoot(f / 0.45) * 2 - 1);
    for (const [i, ray] of r.rays.entries()) {
      ray.rotation = tick * 9;
      ray.lengthScale = 1 + wave(t * 2, -i / r.rays.length) * 0.07;
    }
    // The body rocks with the clock and the head the other way.
    r.rotation = tick * 2.2;
    r.faceTilt = -tick * 3 + wave(t) * 2;
    r.y = base.y - Math.abs(Math.sin(beat * Math.PI)) * 1.4;
    const up = 0.68 + wave(t * 0.5) * 0.12;
    eyes(r, (eye) => {
      eye.gaze = { x: -up * 0.6, y: -up };
      eye.scaleY = 0.86;
    });
    // One brow up, one down: the thinking face.
    r.brows.left.y = base.brows.left.y - 3;
    r.brows.left.rotation = base.brows.left.rotation - 6;
    r.brows.right.y = base.brows.right.y + 1.2;
    r.smile.span = base.smile.span * 0.6;
    r.smile.depth = base.smile.depth * 0.45;
    r.smile.rotation = base.smile.rotation + 6;
    return r;
  },
};

const thinkingStill: Sequence = {
  id: 'thinking-still',
  group: 'think',
  priority: PRIORITY.chat,
  duration: 2400,
  canInterrupt: true,
  loop: true,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['thinking'],
  pose: (base) => {
    const r = cloneRig(base);
    r.eyes.left.gaze = { x: -0.35, y: -0.55 };
    r.eyes.right.gaze = { x: -0.35, y: -0.55 };
    r.smile.span = base.smile.span * 0.7;
    r.smile.depth = base.smile.depth * 0.6;
    return r;
  },
};

/**
 * A02's payoff. A question mark pops over one shoulder, snaps to a tick, the
 * rays flare and the body springs. Short, because a eureka that outstays its
 * welcome is worse than no eureka.
 *
 * It sits *inside* the chat band but above the ambient conversation layer, and
 * that is deliberate rather than a rounding: the eureka is the answer arriving,
 * so it has to be able to interrupt the very thing that plays while Sunny works
 * the answer out. At the success band it lost every frame of its own `thinking`
 * and `speaking` states to `thinking-whirr` and `speaking-pulse` -- requestable,
 * eligible, and never once drawn.
 */
const eureka: Sequence = {
  id: 'thinking-eureka',
  group: 'eureka',
  priority: PRIORITY.chat + 20,
  duration: 1500,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['question-mark', 'sparkle', 'lightbulb'],
  // The eureka has a still of its own. Pointing at the celebration's was a
  // copy-paste that would have shown a reduced-motion visitor a different
  // moment from the one they asked for.
  reducedMotionFallback: 'eureka-still',
  // `celebrating` is deliberately absent. It was there, and it meant a eureka
  // still in flight outranked the celebration that arrived while it played --
  // a real success being buried, which is the failure the celebration tests
  // exist to prevent. An idea landing and a job well done are different beats.
  states: ['thinking', 'speaking'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // 0.0-0.45 hold the question mark; 0.45 onward, the flare.
    const flare = t < 0.45 ? 0 : ease((t - 0.45) / 0.55);
    const hold = t < 0.45 ? bump(t / 0.45) : 1;
    r.props = [
      {
        id: 'question-mark',
        x: -34,
        y: -30 - wave(t * 1.5) * 2,
        rotation: -12 + wave(t) * 4,
        scale: 0.5 + hold * 0.5,
        // Fades out as the flare takes over.
        opacity: Math.max(0, 1 - flare * 1.6),
      },
      {
        // The idea arrives as a lightbulb over her head, as in the pose sheet,
        // popping in on an overshoot.
        id: 'lightbulb',
        x: 30,
        y: -62 - flare * 4,
        rotation: 12 - flare * 12,
        scale: flare > 0 ? 0.8 + (1 - Math.cos(Math.min(1, flare * 1.4) * Math.PI)) * 0.55 : 0,
        opacity: flare > 0 ? Math.min(1, flare * 2) * (t > 0.9 ? (1 - t) / 0.1 : 1) : 0,
      },
      {
        id: 'sparkle',
        x: 46,
        y: -64,
        rotation: flare * 90,
        scale: 0.3 + flare * 0.6,
        opacity: flare > 0 ? Math.min(1, flare * 1.4) * (t > 0.9 ? (1 - t) / 0.1 : 1) : 0,
      },
    ];
    for (const ray of r.rays) {
      ray.lengthScale = 1 + flare * 0.16;
      ray.widthScale = 1 - flare * 0.1;
    }
    r.y = base.y - bump(Math.min(1, Math.max(0, (t - 0.45) / 0.55))) * 3;
    r.squash = -flare * 0.05;
    r.stretch = flare * 0.05;
    r.eyes.left.scaleY = 1 + flare * 0.2;
    r.eyes.right.scaleY = 1 + flare * 0.2;
    r.smile.span = base.smile.span * (0.7 + flare * 0.45);
    r.smile.depth = base.smile.depth * (0.6 + flare * 0.6);
    r.brows.left.y = base.brows.left.y - flare * 3;
    r.brows.right.y = base.brows.right.y - flare * 3;
    return r;
  },
};

/**
 * The minimal eureka. One sparkle, a brief smile, no prop theatrics and no
 * spring. The point of the moment is "I have got it"; a visitor who has asked
 * for minimal motion still deserves to be told that, and a screen-reader user
 * relying on the accompanying live region deserves the same visual corroboration
 * everyone else gets.
 */
const eurekaStill: Sequence = {
  id: 'eureka-still',
  group: 'eureka',
  // Matches the full eureka: a floor is about how much motion a tenant allows,
  // and both variants are the same moment. Left below it, a tenant who turned
  // the dial down would lose the eureka to the ambient layer instead of seeing
  // a still one.
  priority: PRIORITY.chat + 20,
  duration: 1100,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: ['sparkle'],
  reducedMotionFallback: null,
  states: ['thinking', 'speaking'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const a = bump(t);
    r.smile.depth = base.smile.depth * (1 + a * 0.35);
    r.props = [
      { id: 'sparkle', x: 34, y: -34, rotation: a * 30, scale: 0.4 + a * 0.3, opacity: a },
    ];
    return r;
  },
};

/**
 * Speaking. The mouth is a single drawn stroke, so it cannot lip-sync; instead
 * the whole face carries the rhythm -- the smile opens and closes on a beat and
 * the eyes narrow slightly on the stressed half.
 */
const speaking: Sequence = {
  id: 'speaking-pulse',
  group: 'speak',
  priority: PRIORITY.chat,
  duration: 900,
  canInterrupt: true,
  loop: true,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: 'speaking-still',
  states: ['speaking'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // Two syllables per loop. The mouth swings wide on each, the body bobs
    // under it with a squash on the stress, and the rays wag a beat behind.
    const syl = hoseBounce(t * 2);
    const open = Math.sin(((t * 2) % 1) * Math.PI);
    r.smile.depth = base.smile.depth * (1 + open * 0.55);
    r.smile.span = base.smile.span * (1 - open * 0.08);
    r.smile.y = base.smile.y + open * 0.9;
    r.brows.left.y = base.brows.left.y - open * 2.2;
    r.brows.right.y = base.brows.right.y - open * 2.2;
    r.y = base.y - syl.lift * 1.8;
    r.squash = syl.squash * 0.05;
    r.stretch = syl.stretch * 0.02;
    r.faceTilt = wave(t, 0.1) * 2;
    rubberRays(r, t * 2 - 0.2, 0.45);
    return r;
  },
};

const speakingStill: Sequence = {
  id: 'speaking-still',
  group: 'speak',
  priority: PRIORITY.chat,
  duration: 900,
  canInterrupt: true,
  loop: true,
  intensity: 'off',
  assets: [],
  reducedMotionFallback: null,
  states: ['speaking'],
  pose: (base) => cloneRig(base),
};

/** Guiding: Sunny leans toward whatever it is pointing at, on the page. */
const guiding: Sequence = {
  id: 'guiding-point',
  group: 'guide',
  priority: PRIORITY.chat,
  duration: 1200,
  canInterrupt: true,
  loop: true,
  intensity: 'balanced',
  assets: [],
  reducedMotionFallback: 'guiding-still',
  states: ['guiding'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const lean = 9;
    r.faceTilt = lean + wave(t) * 1.4;
    r.rotation = lean * 0.4;
    // One ray stretches toward the target: the ray as an arm, per the rig spec.
    const arm = r.rays[2];
    if (arm) {
      arm.lengthScale = 1.35;
      arm.widthScale = 1.5;
      arm.rotation = 8;
      arm.offset = { x: 6, y: 0 };
    }
    r.eyes.left.gaze = { x: 0.75, y: 0.25 };
    r.eyes.right.gaze = { x: 0.75, y: 0.25 };
    r.brows.left.rotation = -30;
    return r;
  },
};

const guidingStill: Sequence = {
  id: 'guiding-still',
  group: 'guide',
  priority: PRIORITY.chat,
  duration: 1200,
  canInterrupt: true,
  loop: true,
  intensity: 'off',
  assets: [],
  reducedMotionFallback: null,
  states: ['guiding'],
  pose: (base) => {
    const r = cloneRig(base);
    r.faceTilt = 8;
    r.eyes.left.gaze = { x: 0.6, y: 0.2 };
    r.eyes.right.gaze = { x: 0.6, y: 0.2 };
    return r;
  },
};

/** Celebrating a lead saved or a recommendation accepted. */
const celebrate: Sequence = {
  id: 'celebrate-spin',
  group: 'celebrate',
  priority: PRIORITY.success,
  duration: 1600,
  canInterrupt: true,
  loop: false,
  intensity: 'playful',
  assets: ['sparkle'],
  reducedMotionFallback: 'celebrate-still',
  states: ['celebrating', 'speaking', 'idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const a = bump(t);
    // Two full turns, easing out so it lands rather than stops dead.
    r.rotation = ease(Math.min(1, t / 0.8)) * 720;
    r.y = base.y - a * 7;
    r.squash = -a * 0.06;
    r.stretch = a * 0.06;
    r.smile.span = base.smile.span * (1 + a * 0.25);
    r.smile.depth = base.smile.depth * (1 + a * 0.35);
    r.eyes.left.scaleY = 1 - a * 0.3;
    r.eyes.right.scaleY = 1 - a * 0.3;
    r.props = [
      prop('sparkle', -40, -32, 0.5 + a * 0.8, a * 140),
      prop('sparkle', 42, -18, 0.5 + a * 0.8, -a * 140),
    ];
    for (const [i, ray] of r.rays.entries()) {
      ray.lengthScale = 1 + a * 0.2 * (i % 2 === 0 ? 1 : -0.5);
      ray.rotation = a * 40;
    }
    return r;
  },
};

/**
 * The `balanced` celebration. A double bounce and a flare rather than a spin:
 * two full turns is a lot of motion to impose on a page a visitor did not come
 * to for cartoons, which is exactly why `celebrate-spin` sits at `playful` and
 * this variant exists to serve everyone below that.
 */
const celebrateBounce: Sequence = {
  id: 'celebrate-bounce',
  group: 'celebrate',
  priority: PRIORITY.success,
  duration: 1400,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['sparkle'],
  reducedMotionFallback: 'celebrate-still',
  states: ['celebrating', 'speaking', 'idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // Two hops, the second smaller: an anticipation squash, a stretched
    // launch with the rays flung wide, a squash on each landing, a wobble.
    const hop = (from: number, to: number, height: number): number =>
      t <= from || t >= to ? 0 : Math.sin(((t - from) / (to - from)) * Math.PI) * height;
    const speed = (from: number, to: number): number =>
      t <= from || t >= to ? 0 : Math.abs(Math.cos(((t - from) / (to - from)) * Math.PI));
    const crouch = swell(t, 0, 0.14) + swell(t, 0.5, 0.6) * 0.8 + swell(t, 0.86, 0.96) * 0.6;
    const air = hop(0.12, 0.52, 9.5) + hop(0.58, 0.88, 6);
    const rising = speed(0.12, 0.52) + speed(0.58, 0.88);
    r.y = base.y - air + crouch * 4;
    r.squash = crouch * 0.18 - rising * 0.06;
    r.stretch = rising * 0.12 - crouch * 0.1;
    r.rotation = wave(clamp01((t - 0.12) / 0.76)) * 8 * (1 - t);
    const joy = Math.min(1, air / 6);
    for (const [i, ray] of r.rays.entries()) {
      ray.lengthScale =
        1 + joy * 0.22 - crouch * 0.15 + settle(clamp01(t - i * 0.015), 3, 4) * 0.06;
      ray.rotation = wave(t * 2, -i / 8) * 8 * joy;
    }
    const a = bump(t);
    r.smile.span = base.smile.span * (1 + a * 0.22);
    r.smile.depth = base.smile.depth * (1 + a * 0.6);
    eyes(r, (eye) => {
      eye.scaleY = 1 - joy * 0.45 + crouch * 0.1;
    });
    r.brows.left.y = base.brows.left.y - a * 5;
    r.brows.right.y = base.brows.right.y - a * 5;
    r.props = [
      {
        id: 'sparkle',
        x: -40,
        y: -34 - joy * 6,
        rotation: a * 180,
        scale: 0.3 + a * 0.8,
        opacity: a,
      },
      {
        id: 'sparkle',
        x: 42,
        y: -24 - joy * 6,
        rotation: -a * 180,
        scale: 0.3 + a * 0.7,
        opacity: a,
      },
    ];
    return r;
  },
};

const celebrateStill: Sequence = {
  id: 'celebrate-still',
  group: 'celebrate',
  priority: PRIORITY.success,
  duration: 900,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['celebrating', 'speaking', 'idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const a = bump(t);
    r.smile.span = base.smile.span * (1 + a * 0.25);
    r.smile.depth = base.smile.depth * (1 + a * 0.3);
    r.eyes.left.scaleY = 1 - a * 0.25;
    r.eyes.right.scaleY = 1 - a * 0.25;
    return r;
  },
};

/** Confused: a head tilt, a raised brow, one eye narrower than the other. */
const confused: Sequence = {
  id: 'confused-tilt',
  group: 'confused',
  priority: PRIORITY.accessibility,
  duration: 1400,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['question-mark'],
  reducedMotionFallback: 'confused-still',
  states: ['confused'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // A double take: a quick shake, then a long puzzled tilt with a shrug of
    // the side rays, then back on a wobble.
    const shake = t < 0.22 ? Math.sin((t / 0.22) * TAU * 2) * (1 - t / 0.22) : 0;
    const tilt = t < 0.2 ? 0 : overshoot((t - 0.2) / 0.3) * (1 - ease((t - 0.75) / 0.25));
    const shrug = swell(t, 0.3, 0.75);
    r.faceTilt = -16 * tilt + shake * 8 + settle(t, 2, 3) * 4;
    r.rotation = -5 * tilt;
    r.y = base.y - shrug * 3;
    r.squash = -shrug * 0.03;
    r.stretch = shrug * 0.04;
    r.eyes.left.scaleY = 1 - tilt * 0.2;
    r.eyes.right.scaleY = 1 + tilt * 0.3;
    r.brows.left.y = base.brows.left.y - tilt * 6;
    r.brows.left.rotation = base.brows.left.rotation + tilt * 12;
    r.brows.right.y = base.brows.right.y + tilt * 3;
    r.smile.depth = base.smile.depth * (1 - tilt * 1.4);
    r.smile.rotation = base.smile.rotation + tilt * 10;
    // The side rays lift like shoulders.
    for (const [i, ray] of r.rays.entries()) {
      const side = i === 2 || i === 6 ? 1 : i % 2 === 1 ? 0.5 : 0;
      ray.rotation = (i < 4 ? -1 : 1) * side * shrug * 14;
      ray.lengthScale = 1 + side * shrug * 0.1;
    }
    const a = bump(t);
    r.props = [
      {
        id: 'question-mark',
        x: 36,
        y: -36 - Math.abs(Math.sin(t * TAU * 1.5)) * 3,
        rotation: 14 + wave(t * 1.5) * 8,
        scale: 0.5 + overshoot(clamp01(t / 0.35)) * 0.45 * a,
        opacity: Math.min(1, a * 1.4),
      },
    ];
    return r;
  },
};

const confusedStill: Sequence = {
  id: 'confused-still',
  group: 'confused',
  priority: PRIORITY.accessibility,
  duration: 1000,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['confused'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // The departure is held, but it is not *snapped to*. An earlier version of
    // this sequence ignored `t` entirely, so a tenant on `minimal` saw the face
    // jump into a frown and straight back out -- a pop, which is the one thing a
    // reduced-motion path must not do. The pose eases in and out instead; a fade
    // is the substitute reduced motion actually calls for, because it carries no
    // translation or scale for the inner ear to track.
    const a = bump(t);
    r.faceTilt = -10 * a;
    r.rotation = -2 * a;
    r.brows.left.y = base.brows.left.y - 4 * a;
    r.brows.right.y = base.brows.right.y + 2 * a;
    r.smile.depth = base.smile.depth * (1 - a * 0.5);
    return r;
  },
};

/** Error: dimmed rays, flattened smile, a small backwards settle. */
const error: Sequence = {
  id: 'error-deflate',
  group: 'error',
  priority: PRIORITY.accessibility,
  duration: 1200,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['sweat-drop'],
  reducedMotionFallback: 'error-still',
  states: ['error'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // Deflates like a punctured balloon -- squashes flat, the rays droop
    // towards the ground, a sweat drop slides -- then gulps and pops back into
    // shape with an overshoot.
    const sag = t < 0.55 ? ease(t / 0.4) : (1 - overshoot((t - 0.55) / 0.45)) * (1 - t);
    for (const [i, ray] of r.rays.entries()) {
      const angle = (ray.angleDeg + 360) % 360;
      const towardDown = angle < 180 ? 1 : -1;
      ray.rotation = towardDown * sag * 22 * Math.sin((angle * Math.PI) / 180) ** 2;
      ray.lengthScale = 1 - sag * 0.28 + settle(clamp01((t - 0.55) / 0.45 - i * 0.01), 2, 4) * 0.1;
      ray.widthScale = 1 - sag * 0.15;
    }
    r.squash = sag * 0.16;
    r.stretch = -sag * 0.1;
    r.y = base.y + sag * 5;
    r.smile.depth = base.smile.depth * (1 - sag * 1.5);
    eyes(r, (eye) => {
      eye.scaleY = 1 - sag * 0.4;
      eye.gaze = { x: 0, y: sag * 0.6 };
    });
    r.brows.left.y = base.brows.left.y + sag * 4;
    r.brows.right.y = base.brows.right.y + sag * 4;
    r.brows.left.rotation = base.brows.left.rotation + sag * 14;
    r.brows.right.rotation = base.brows.right.rotation - sag * 14;
    const a = bump(t);
    r.props = [{ id: 'sweat-drop', x: 28, y: -32 + t * 14, rotation: 0, scale: 0.6, opacity: a }];
    return r;
  },
};

const errorStill: Sequence = {
  id: 'error-still',
  group: 'error',
  priority: PRIORITY.accessibility,
  duration: 800,
  canInterrupt: true,
  loop: false,
  // `minimal`, not `off`, and the distinction is the whole rule: `off` is for a
  // variant that holds one pose, and this one animates. It also serves as
  // `error-deflate`'s reduced-motion fallback, which is what makes the fade the
  // right choice -- an opacity change is motion a reduced-motion viewer can
  // accept, and it is the only way the deflation can arrive without a jump.
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['error'],
  pose: (base, t) => {
    const a = bump(t);
    const r = cloneRig(base);
    for (const ray of r.rays) ray.lengthScale = 1 - a * 0.1;
    r.smile.depth = base.smile.depth * (1 - a * 0.7);
    return r;
  },
};

/**
 * A10, the sunglasses: Sunny puts them on when it has something worth being
 * confident about -- a finished recommendation, a question answered well.
 *
 * The moment is the *lowering*, not the wearing: the lenses come down from
 * above the eyes, overshoot slightly, and settle. A sequence that simply
 * appeared them would read as the artwork changing rather than as a decision.
 *
 * Drawing the lenses above the eyes mid-approach means they pass over the rays
 * and the brows. That is intentional and is why the prop is drawn after the
 * face: a prop that slid *behind* the head would look like it was being thrown
 * away from the viewer.
 */
const coolShades: Sequence = {
  id: 'cool-shades',
  group: 'cool',
  priority: PRIORITY.success,
  duration: 2400,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['sunglasses'],
  reducedMotionFallback: 'cool-still',
  states: ['celebrating', 'idle', 'speaking'],
  pose: (base, t) => {
    return shadesPose(base, t, false);
  },
};

/** The playful variant: the shades land with a sparkle and a strut. */
const coolShadesPlay: Sequence = {
  id: 'cool-shades-play',
  group: 'cool',
  priority: PRIORITY.success,
  duration: 2600,
  canInterrupt: true,
  loop: false,
  intensity: 'playful',
  assets: ['sunglasses', 'sparkle'],
  reducedMotionFallback: 'cool-still',
  states: ['celebrating', 'idle', 'speaking'],
  pose: (base, t) => {
    return shadesPose(base, t, true);
  },
};

/**
 * The reduced-motion variant. No travel and no overshoot: the lenses simply fade
 * in over the eyes and fade out again, which is the whole of the gesture that
 * carries meaning.
 */
const coolShadesStill: Sequence = {
  id: 'cool-still',
  group: 'cool',
  priority: PRIORITY.success,
  duration: 1600,
  canInterrupt: true,
  loop: false,
  // Deliberately `minimal` and not `off`. The lenses fade, and a fade is motion;
  // `off` is reserved for the variants that hold one pose, so that a visitor who
  // has asked for no animation gets a character that genuinely does not move.
  intensity: 'minimal',
  assets: ['sunglasses'],
  reducedMotionFallback: null,
  states: ['celebrating', 'idle', 'speaking'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const a = bump(t);
    r.faceTilt = 0;
    r.props = [{ id: 'sunglasses', x: -1.4, y: -5.1, rotation: -3, scale: 1.0, opacity: a }];
    return r;
  },
};

/**
 * A12, charging a panel: Sunny's rays pulse outward on a rising beat while a
 * battery prop fills. The fill is expressed as the prop's opacity against a
 * fixed frame, so the sequence owns no state between frames.
 */
const charging: Sequence = {
  id: 'charging-panel',
  group: 'charge',
  priority: PRIORITY.chat,
  duration: 2600,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['battery', 'sparkle'],
  reducedMotionFallback: 'charging-still',
  states: ['guiding', 'speaking', 'idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const charge = ease(Math.min(1, t / 0.85));
    for (const [i, ray] of r.rays.entries()) {
      const pulse = Math.max(0, wave(t * 2.5, -i / r.rays.length));
      ray.lengthScale = 1 + pulse * 0.22;
      ray.widthScale = 1 - pulse * 0.12;
    }
    r.y = base.y - charge * 1.5;
    r.eyes.left.gaze = { x: 0.4, y: 0.35 };
    r.eyes.right.gaze = { x: 0.4, y: 0.35 };
    r.smile.depth = base.smile.depth * (1 + charge * 0.2);
    r.props = [
      { id: 'battery', x: 38, y: 22, rotation: 0, scale: 1.1, opacity: 1 },
      {
        id: 'sparkle',
        x: 30,
        y: 22,
        rotation: charge * 120,
        scale: 0.35 * (1 - charge),
        opacity: Math.max(0, 1 - charge * 1.5),
      },
    ];
    return r;
  },
};

const chargingStill: Sequence = {
  id: 'charging-still',
  group: 'charge',
  priority: PRIORITY.chat,
  duration: 1400,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: ['battery'],
  reducedMotionFallback: null,
  states: ['guiding', 'speaking', 'idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const a = bump(t);
    r.props = [{ id: 'battery', x: 38, y: 22, rotation: 0, scale: 1.1, opacity: a }];
    return r;
  },
};

/**
 * The widget opening. Sunny compresses as the bubbles rise (played by the
 * widget's own CSS), then springs back with a slight overshoot as the panel
 * lands. This is the one sequence tuned to a wall-clock budget: the widget
 * targets 400-650 ms including this, so `duration` here is 420.
 */
const bubbleOpen: Sequence = {
  id: 'bubble-open',
  group: 'open',
  priority: PRIORITY.interaction,
  duration: 420,
  canInterrupt: false,
  loop: false,
  intensity: 'balanced',
  assets: [],
  reducedMotionFallback: null,
  states: ['idle', 'listening'],
  pose: (base, t) => {
    const r = cloneRig(base);
    // The click lands: Sunny squashes down hard (anticipation), launches up
    // stretched with the rays flung out, and overshoots into place. Tuned to
    // the widget's 400-650 ms opening.
    const crouch =
      t < 0.3 ? Math.sin((t / 0.3) * Math.PI * 0.5) : Math.max(0, 1 - ease((t - 0.3) / 0.12));
    const launch = swell(t, 0.3, 0.75);
    const wob = t < 0.6 ? 0 : settle((t - 0.6) / 0.4, 1.5, 3);
    r.squash = crouch * 0.22 - launch * 0.08 + wob * 0.06;
    r.stretch = launch * 0.16 - crouch * 0.12 - wob * 0.04;
    r.y = base.y + crouch * 6 - launch * 7;
    for (const [i, ray] of r.rays.entries()) {
      ray.lengthScale =
        1 -
        crouch * 0.3 +
        launch * 0.25 +
        settle(clamp01((t - 0.55) / 0.45 - i * 0.02), 2, 4) * 0.08;
    }
    eyes(r, (eye) => {
      eye.scaleY = 1 - crouch * 0.5 + launch * 0.25;
    });
    r.smile.depth = base.smile.depth * (1 + launch * 0.5);
    return r;
  },
};

/**
 * The minimal opening. The panel still opens -- that is the widget's own CSS and
 * is not negotiable -- and Sunny still has to acknowledge it, or the character
 * appears to ignore the visitor. What goes is the overshoot: the squeeze stays,
 * the spring does not. The shortest sequence in the set, because it has to
 * finish inside the same budget as the animated one.
 */
const bubbleOpenStill: Sequence = {
  id: 'open-still',
  group: 'open',
  priority: PRIORITY.interaction,
  duration: 260,
  canInterrupt: false,
  loop: false,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['idle', 'listening'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const a = bump(t);
    r.squash = a * 0.06;
    r.stretch = a * 0.04;
    return r;
  },
};

// ─── A07, the play moves ─────────────────────────────────────────────────────

/**
 * The reduced-motion fallback for the play moves: Sunny stands still.
 *
 * A play move is a burst of whole-body motion -- a hop, a run, a dance -- and
 * there is no honest still of one: a held frame of a hop is a character caught
 * in mid-air. So the fallback is the pose Sunny was measured into, exactly as
 * `idle-still` is for the resting layer.
 */
const playStill: Sequence = {
  id: 'play-still',
  group: 'play',
  priority: PRIORITY.play,
  duration: 1,
  canInterrupt: true,
  loop: true,
  intensity: 'off',
  assets: [],
  reducedMotionFallback: null,
  states: ['playing'],
  pose: (base) => cloneRig(base),
};

/**
 * A07 at `minimal`. Two small side-steps, right then left, each a hop with the
 * gaze and the head leaning into the direction of travel: the least motion that
 * still reads as "Sunny is playing along" rather than "Sunny is standing there".
 *
 * **Short and finite, not a loop.** A game of tic-tac-toe lasts minutes, and a
 * character that hops for the whole of it is exhausting and competes with the
 * board the visitor is trying to look at. So a play move is a burst at the start
 * of the session, and the resting layer underneath carries the wait between
 * moves. That is also why `AMBIENT_GROUP.playing` stays on the idle group.
 *
 * **No animation collisions, structurally.** All three moves share the `play`
 * group, and the scheduler refuses a second instance of a group that is already
 * running, so a shuffle can never be drawn over a dance. A07's acceptance
 * criterion is met by the data model rather than by timing the sequences to be
 * shorter than each other.
 *
 * Every pose here is enveloped by `bump(t)`, so the move leaves and returns to
 * the resting pose: a sequence that started mid-hop would snap into it on the
 * first frame, and one that ended mid-hop would leave the character in the air.
 */
const playShuffle: Sequence = {
  id: 'play-shuffle',
  group: 'play',
  priority: PRIORITY.play,
  duration: 900,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: 'play-still',
  states: ['playing'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const env = bump(t);
    const step = Math.floor(t * 2) % 2 === 0 ? 1 : -1;
    const hop = bump((t * 2) % 1) * env;
    r.x = base.x + step * hop * 5;
    r.y = base.y - hop * 3.5;
    r.squash = -hop * 0.05;
    r.stretch = hop * 0.04;
    r.faceTilt = step * hop * 5;
    r.smile.depth = base.smile.depth * (1 + hop * 0.18);
    r.eyes.left.gaze = { x: step * hop * 0.45, y: 0.1 };
    r.eyes.right.gaze = { ...r.eyes.left.gaze };
    for (const ray of r.rays) ray.rotation = step * hop * 5;
    return r;
  },
};

/**
 * A07 at `balanced`. A run on the spot: two strides, the body compressed at
 * each footfall and stretched at the top of each stride, the rays streaming
 * back from the direction of the lean, and the brows down and the eyes narrowed
 * so the run has some intent behind it rather than being a bounce.
 */
const playRun: Sequence = {
  id: 'play-run',
  group: 'play',
  priority: PRIORITY.play,
  duration: 1100,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: [],
  reducedMotionFallback: 'play-still',
  states: ['playing'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const env = bump(t);
    const stride = Math.abs(wave(t * 2)) * env;
    const sway = wave(t, 0.25) * env;
    // The lean and the wind are held for the whole move and only scale with the
    // envelope, because they are what makes this read as a run: a character with
    // no legs cannot show a stride, so the forward lean and the rays streaming
    // back carry the meaning and the bob only says how fast.
    r.rotation = env * 7 + stride * 2;
    r.x = base.x + sway * 2;
    r.y = base.y - stride * 4.5;
    r.squash = (0.09 - stride * 0.14) * env;
    r.stretch = (stride * 0.08 - 0.06) * env;
    r.faceTilt = env * 1.5;
    for (const side of ['left', 'right'] as const) {
      r.brows[side].y = base.brows[side].y + env * 1.4;
      r.brows[side].arch = base.brows[side].arch * (1 - env * 0.5);
      r.eyes[side].scaleY = 1 - env * 0.3;
      // Both eyes on the direction of travel: this is the one move in the set
      // that is going somewhere, even if it never actually gets there.
      r.eyes[side].gaze = { x: env * 0.45, y: -env * 0.05 };
    }
    r.smile.span = base.smile.span * (1 + env * 0.12);
    r.smile.depth = base.smile.depth * (1 + env * 0.25);
    for (const ray of r.rays) {
      ray.offset = { x: -(2 + stride * 1.5) * env, y: 0 };
      ray.lengthScale = 1 - env * 0.1;
      ray.rotation = -env * 5;
    }
    return r;
  },
};

/**
 * A07 at `playful`. A dance: the body rocks through one and a half cycles, the
 * head lagging behind it, the rays alternating in length so the ring ripples
 * rather than turning as one piece, and a single sparkle that fades in and out
 * as it swings. The plan's most-invoked move, so it is the one that gets the
 * prop.
 */
const playDance: Sequence = {
  id: 'play-dance',
  group: 'play',
  priority: PRIORITY.play,
  duration: 1300,
  canInterrupt: true,
  loop: false,
  intensity: 'playful',
  assets: ['sparkle'],
  reducedMotionFallback: 'play-still',
  states: ['playing'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const env = bump(t);
    const rock = wave(t * 1.5) * env;
    const swing = Math.abs(rock);
    r.rotation = rock * 11;
    r.x = base.x + rock * 4.5;
    r.y = base.y - Math.abs(wave(t * 1.5, 0.25)) * 4 * env;
    r.squash = -swing * 0.04;
    r.stretch = swing * 0.05;
    r.faceTilt = -rock * 6;
    r.smile.span = base.smile.span * (1 + env * 0.3);
    r.smile.depth = base.smile.depth * (1 + env * 0.45);
    for (const side of ['left', 'right'] as const) {
      r.eyes[side].scaleY = 1 - swing * 0.35;
      r.eyes[side].gaze = { x: rock * 0.3, y: 0 };
    }
    for (const [i, ray] of r.rays.entries()) {
      ray.lengthScale = 1 + swing * 0.22 * (i % 2 === 0 ? 1 : -0.4);
      ray.rotation = rock * 9;
    }
    r.props = [
      {
        ...prop('sparkle', rock * 30 - 6, -30, 0.35 + swing * 0.5, rock * 80),
        // Faded by the size of the swing, so it is invisible at both ends of the
        // move and cannot be left on screen by a frame that lands mid-gesture.
        opacity: swing,
      },
    ];
    return r;
  },
};

// ─── A10, the arcade spin ────────────────────────────────────────────────────

/**
 * A10 is the animation no other row needed: a fast roll. It is asked for by an
 * arcade moment -- a wave cleared, in A08's cabinet -- and the plan's two words
 * about it are both load-bearing.
 *
 * **"Original" is the design constraint, and it is about the silhouette rather
 * than about a name.** The move it is reaching for is the one everybody has seen
 * a hedgehog do: tuck into a ball, spin, dash. Copying that is copying the
 * character it belongs to, so Sunny's roll is hers and shaped like her -- her
 * eight rays fold *flat*, gathering into a single disc with her face still
 * legible at the centre, and it is the disc that turns. Nothing here is a ball
 * and nothing here is blue. The fold is also what makes it read as a roll at
 * all: a rotating sun still showing eight splayed rays is a sun wobbling.
 *
 * **"Returns to exact default pose" is the acceptance, and it is taken
 * literally.** `poses` in this file are pure functions of progress, so "returns"
 * is a claim about `t = 1` that a test can hold with `toEqual` -- provided every
 * number the pose touches is *exactly* the base value there, not merely close.
 * That is why this section has its own `land` (not `bump`, whose `sin(pi)` is
 * 1.2e-16) and `turns` (a rotation that lands on 0 rather than on 720): the two
 * helpers exist so the last frame is the base rig to the bit, and the test that
 * asserts it is the whole of the row's acceptance criterion.
 *
 * The gather-and-release is shared by all three variants and differs only in how
 * much the disc turns, which is the intensity setting's business: `arcade-tuck`
 * gathers and does not turn at all, and is therefore also the honest answer for a
 * visitor who asked for less motion -- the fold is a small movement, not a spin.
 * The variant bodies are written out rather than factored into one function with
 * a `turns` parameter, because the three want different envelopes (the roll
 * travels, the spin does not; the tuck narrows the eyes, the spin squints through
 * them) and a shared function with three flags is harder to read than three
 * short poses.
 */

/**
 * How far she has gathered into a disc, 0..1. Fast in, held, slower out -- and
 * exactly 0 at both ends, so anything scaled by it lands on the base value.
 */
function gather(t: number, inBy: number, outFrom: number): number {
  return Math.min(ease(t / inBy), ease((1 - t) / outFrom));
}

/**
 * A10 at `minimal`, and the reduced-motion answer for the other two.
 *
 * A gather and a small squash and nothing else: no rotation and no travel, so a
 * visitor who asked for less motion gets a beat rather than a spin. It is the
 * weakest of the three and it still does something, which is what stops an
 * intensity setting from deleting the row.
 */
const arcadeTuck: Sequence = {
  id: 'arcade-tuck',
  group: 'arcade',
  priority: PRIORITY.play,
  duration: 800,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: [],
  reducedMotionFallback: null,
  states: ['celebrating', 'playing', 'idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const a = land(t);
    // Every line is written as the base value *plus* a term that is exactly
    // zero at both ends, rather than as a bare expression that happens to be
    // zero -- `-a * 0.03` is negative zero when `a` is zero, and negative zero
    // is not zero to `toEqual`. See the note on A10 at the top of this section.
    r.squash = base.squash + a * 0.07;
    r.stretch = base.stretch - a * 0.03;
    r.y = base.y - a * 1.5;
    r.smile.span = base.smile.span * (1 + a * 0.18);
    r.smile.depth = base.smile.depth * (1 + a * 0.28);
    r.eyes.left.scaleY = base.eyes.left.scaleY - a * 0.22;
    r.eyes.right.scaleY = base.eyes.right.scaleY - a * 0.22;
    r.rays.forEach((ray, i) => {
      ray.lengthScale = base.rays[i]!.lengthScale - a * 0.16;
    });
    return r;
  },
};

/**
 * A10 at `balanced`: one full roll. She gathers, turns a single whole revolution
 * while the disc is tight, and unrolls as she comes out of it -- the three-phase
 * shape of an actual roll, with the turn confined to the middle so it starts and
 * ends still.
 */
const arcadeRoll: Sequence = {
  id: 'arcade-roll',
  group: 'arcade',
  priority: PRIORITY.play,
  duration: 1000,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: [],
  reducedMotionFallback: 'arcade-tuck',
  states: ['celebrating', 'playing', 'idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const fold = gather(t, 0.2, 0.26);
    const a = land(t);
    r.rotation = base.rotation + turns(ease((t - 0.14) / 0.62), 1);
    // A roll goes somewhere. The travel is small and returns with her, which is
    // the compromise a roll in place has to make: she is not going to leave the
    // panel, so the sense of rolling is carried by the turn and the tilt.
    r.x = base.x + a * 2.5;
    r.y = base.y - a * 2;
    r.squash = base.squash + fold * 0.11;
    r.stretch = base.stretch - fold * 0.05;
    r.smile.span = base.smile.span * (1 + a * 0.22);
    r.smile.depth = base.smile.depth * (1 + a * 0.35);
    r.eyes.left.scaleY = base.eyes.left.scaleY - fold * 0.4;
    r.eyes.right.scaleY = base.eyes.right.scaleY - fold * 0.4;
    r.rays.forEach((ray, i) => {
      ray.lengthScale = base.rays[i]!.lengthScale - fold * 0.4;
      // A quarter of the body's turn, so the ring is not perfectly rigid: a
      // disc of separate rays that turned as one piece would read as a picture
      // of a disc rather than as eight things spinning together.
      ray.rotation = base.rays[i]!.rotation + fold * 90;
    });
    return r;
  },
};

/**
 * A10 at `playful`: the fast one. Two whole revolutions inside a tight disc, a
 * hop off the ground at the top of the spin, and a bloom on the way out where
 * the rays fly a little past their resting length and settle back -- the overshoot
 * is what makes it read as "fast" rather than merely as "rotating".
 */
const arcadeSpin: Sequence = {
  id: 'arcade-spin',
  group: 'arcade',
  priority: PRIORITY.play,
  duration: 1300,
  canInterrupt: true,
  loop: false,
  intensity: 'playful',
  assets: [],
  reducedMotionFallback: 'arcade-tuck',
  states: ['celebrating', 'playing', 'idle'],
  pose: (base, t) => {
    const r = cloneRig(base);
    const fold = gather(t, 0.16, 0.24);
    const a = land(t);
    // The hop peaks in the middle of the spin, not at the start, so she is
    // airborne for the fastest part of it.
    const hop = a * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.15) / 0.7)));
    // Two revolutions, folded back to 0..359 so the value lands on base.rotation.
    r.rotation = base.rotation + turns(ease((t - 0.12) / 0.68), 2);
    r.y = base.y - hop * 4;
    r.squash = base.squash + (fold * 0.14 - hop * 0.05);
    r.stretch = base.stretch + (hop * 0.04 - fold * 0.06);
    r.faceTilt = base.faceTilt - fold * 3;
    r.smile.span = base.smile.span * (1 + a * 0.3);
    r.smile.depth = base.smile.depth * (1 + a * 0.45);
    r.eyes.left.scaleY = base.eyes.left.scaleY - fold * 0.45;
    r.eyes.right.scaleY = base.eyes.right.scaleY - fold * 0.45;
    // The bloom: the rays fly out past their resting length as the disc opens,
    // peaking just after the turn ends. `swell` is a bump over 0.72..1 and is
    // exactly zero at t = 1, like everything else here.
    const bloom = swell(t, 0.72, 1);
    r.rays.forEach((ray, i) => {
      ray.lengthScale = base.rays[i]!.lengthScale + (bloom * 0.18 - fold * 0.42);
      ray.rotation = base.rays[i]!.rotation + fold * 120;
    });
    return r;
  },
};

// ─── A04, the deckchair ──────────────────────────────────────────────────────

/**
 * The part of the break every variant shares: the chair unfolds under her, she
 * settles into it with narrowed eyes and a slow breath, and at the end she gets
 * up while it folds away again. The variants add what is special about each
 * intensity setting -- nothing, shades, a doze -- on top of this, so the arc
 * itself exists once and cannot drift between them.
 *
 * **Why the moment ends by undoing itself.** A looping sunbathe cannot be made
 * to work: a sequence's pose is a function of its progress, so a loop would
 * replay the unfold on every cycle, and a loop that started already deployed
 * would pop the chair into existence on the first frame. It cannot be the state's
 * *ambient* layer either, which is where a break belongs by nature, because the
 * scheduler never retires the floor instance -- the ambient has to loop, and a
 * looping break is the chair that reopens every ten seconds. So the break is a
 * finite *event*, requested once when the panel closes and leaving the idle layer
 * underneath it, exactly as A07's play moves are. That also gives A04's "stops
 * immediately on user interaction" for free, because any event that moves the
 * machine out of `relaxing` retires the instance on the next frame -- the clock
 * is not what ends it, the visitor is.
 *
 * **The chair is planted, she is not.** Props are drawn in the body's frame, so
 * a prop inherits the body's motion: without the correction below the chair
 * would lean and sink with her, and rise and fall with her breathing. The chair
 * is therefore given back exactly the transform her body was given to sit down
 * -- the inverse of the root rotation and of the translation, applied about the
 * same origin the artwork is authored against -- and none of the breath. The
 * inverse rotation needs the translation to be rotated too, which is why the
 * three lines below are not simply negations.
 */
function relaxPose(base: SunnyRig, t: number, extra: { shades: boolean; doze: boolean }): SunnyRig {
  const r = cloneRig(base);

  // How far she has settled into the chair, and how far the chair has
  // unfolded. They ramp together on the way in; on the way out the chair
  // lingers, so she is up before it has finished folding.
  const seated = Math.min(ease(t / 0.2), ease((1 - t) / 0.12));
  const deployed = Math.min(ease(t / 0.16), ease((1 - t) / 0.08));
  const breath = wave(t * 1.25) * seated;
  const stretch = bump((t - 0.7) / 0.18);

  // She leans back into the sling (clockwise: the chair's back is on her
  // right) and sinks a little; the chair is counter-rotated so it stays level.
  const lean = seated * 16;
  r.rotation = base.rotation + lean;
  r.x = base.x - seated * 4;
  r.y = base.y + seated * 6 - breath * 0.8 - stretch * 1.4;
  r.faceTilt = base.faceTilt - seated * 4;

  r.smile.depth = base.smile.depth * (1 + seated * 0.35);
  r.smile.span = base.smile.span * (1 + seated * 0.08);
  for (const ray of r.rays) {
    ray.lengthScale = 1 - seated * 0.04 + breath * 0.04 + stretch * 0.12;
  }

  // Limbs: legs stretched out to the front of the chair and crossed at the
  // ankle; arms folded behind the head (drawn behind the body, so only the
  // elbows show). Each grows from its ray as she settles and goes back after.
  const relaxed = limbPose('rest');
  relaxed.legs.left = {
    ...relaxed.legs.left,
    foot: { x: -66, y: 54 },
    bend: 0.25,
    footRotation: -12,
    morph: 1,
  };
  relaxed.legs.right = {
    ...relaxed.legs.right,
    foot: { x: -78, y: 47 },
    bend: 0.35,
    footRotation: -6,
    morph: 1,
  };
  relaxed.arms.left = {
    ...relaxed.arms.left,
    hand: { x: -16, y: -26 },
    bend: 1.35,
    shape: 'fist',
    handRotation: 0,
    behind: true,
    morph: 1,
  };
  relaxed.arms.right = {
    ...relaxed.arms.right,
    hand: { x: 18, y: -28 },
    bend: -1.35,
    shape: 'fist',
    handRotation: 0,
    behind: true,
    morph: 1,
  };
  r.limbs = blendLimbs(base.limbs, relaxed, seated * (1 - stretch * 0.5));

  // The chair is drawn in the body frame, so it is given back exactly the move
  // her body made to sit down: its origin lands on her rest centre in the
  // viewBox and it stays level, however she leans and breathes.
  const back = (-r.rotation * Math.PI) / 180;
  const dx = base.x - r.x;
  const dy = base.y - r.y;
  const props: PropRig[] = [
    {
      id: 'deckchair',
      x: dx * Math.cos(back) - dy * Math.sin(back),
      y: dx * Math.sin(back) + dy * Math.cos(back),
      rotation: -r.rotation + (1 - deployed) * 18,
      scale: 0.55 + 0.45 * deployed,
      opacity: deployed,
    },
  ];

  if (extra.shades) {
    // Shades drop onto the eyes as she settles and lift off before she rises.
    const on = Math.min(ease((t - 0.18) / 0.1), ease((0.84 - t) / 0.1));
    props.push({ ...SHADES_REST, y: SHADES_REST.y - 40 * (1 - on), opacity: on });
    const squint = on * 0.35;
    r.eyes.left.closed = squint;
    r.eyes.right.closed = squint;
  } else {
    const squint = seated * (1 - stretch) * 0.6;
    r.eyes.left.closed = squint;
    r.eyes.right.closed = squint;
  }

  if (extra.doze) {
    for (const [i, phase] of [0, 0.35].entries()) {
      const p = (t - 0.26 - phase) / 0.42;
      if (p <= 0 || p >= 1) continue;
      props.push({
        id: 'sparkle',
        x: 14 + i * 10 + p * 8,
        y: -52 - p * 24,
        rotation: p * 140,
        scale: 0.42 + bump(p) * 0.22,
        opacity: bump(p) * 0.85 * seated,
      });
    }
  }

  r.props = props;
  return r;
}

/**
 * The shades' resting place on the face, in the face frame: centred between
 * the traced eyes and tilted with the line through them (the reference's right
 * eye sits higher, so the eye line falls about 11° to the left).
 */
const SHADES_REST = {
  id: 'sunglasses' as const,
  x: 1.8,
  y: -5.4,
  rotation: -11.4,
  scale: 1,
  opacity: 1,
};

/** A body-frame point in the face frame (the face group rotates by faceTilt). */
function toFaceFrame(rig: SunnyRig, p: Vec2): Vec2 {
  const a = (-rig.faceTilt * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

/**
 * Sunglasses, the 1930s way: a ray pops into an arm, reaches up off the top of
 * the frame, swings a pair of wayfarers down onto the eyes, gives them a cheeky
 * nudge with a raised brow, and retracts into a ray again; the shades are worn
 * for a beat and then flip up and away so the sequence ends at rest.
 */
function shadesPose(base: SunnyRig, t: number, playful: boolean): SunnyRig {
  const r = cloneRig(base);
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));

  const reach = ease(clamp(t / 0.12)); // the ray pops into an arm
  const bring = ease(clamp((t - 0.12) / 0.24)); // hand swings the shades down
  const landed = t >= 0.36;
  const land = landed
    ? Math.sin(clamp((t - 0.36) / 0.18) * Math.PI * 2.5) *
      Math.exp(-clamp((t - 0.36) / 0.18) * 4) *
      (1 - clamp((t - 0.36) / 0.18))
    : 0;
  const nudge = swell(t, 0.44, 0.54);
  const retract = ease(clamp((t - 0.56) / 0.14)); // the arm goes back to a ray
  const off = ease(clamp((t - 0.86) / 0.14)); // shades flip up and away

  // A little anticipation squash as the arm pops, a confident lean when worn.
  const pop = swell(t, 0, 0.12);
  const wearing = landed ? Math.min(1, (t - 0.36) / 0.1) * (1 - off) : 0;
  r.squash = pop * 0.06;
  r.stretch = -pop * 0.03;
  r.rotation = base.rotation - wearing * 3;
  r.y = base.y - wearing * 1.5 - (playful ? Math.abs(wave(t * 4)) * 2 * wearing : 0);
  r.faceTilt = base.faceTilt + wearing * wave(t * 2) * 2.5;

  // The hand: from off the top-right of the frame, along an arc to the temple.
  const start = { x: 70, y: -96 };
  const temple = { x: 50, y: -14 };
  const hand = {
    x: start.x + (temple.x - start.x) * bring + Math.sin(bring * Math.PI) * 10,
    y: start.y + (temple.y - start.y) * bring,
  };
  // Pushing the shades up the nose, then letting go.
  hand.y -= nudge * 3;
  const armPose = limbPose('rest');
  armPose.arms.right = {
    ...armPose.arms.right,
    hand,
    bend: -0.55,
    shape: 'fist',
    handRotation: -100,
    front: true,
    morph: 1,
  };
  r.limbs = blendLimbs(base.limbs, armPose, reach * (1 - retract));

  // The shades: carried by the hand until they land, then worn.
  const carried = toFaceFrame(r, { x: hand.x - 48, y: hand.y + 8.6 });
  const worn = { x: SHADES_REST.x, y: SHADES_REST.y + land * 1.8 - nudge * 2.4 };
  const at = landed ? worn : carried;
  r.props = [
    {
      ...SHADES_REST,
      x: at.x,
      y: at.y - off * 46,
      rotation:
        (landed ? SHADES_REST.rotation : -38 + (SHADES_REST.rotation + 38) * bring) - off * 28,
      opacity: Math.min(clamp(t / 0.06), 1 - off),
    },
  ];
  if (playful && landed) {
    const glint = swell(t, 0.36, 0.56);
    r.props.push({
      id: 'sparkle',
      x: -20,
      y: -18,
      rotation: glint * 120,
      scale: 0.4 + glint * 0.6,
      opacity: glint,
    });
  }

  // Behind the lenses: a squint, a raised brow, a cheeky grin.
  const squint = wearing * 0.45;
  r.eyes.left.closed = squint;
  r.eyes.right.closed = squint;
  r.brows.left.y = base.brows.left.y - (nudge + wearing * 0.6) * 4;
  r.brows.left.rotation = base.brows.left.rotation - wearing * 8;
  r.smile.depth = base.smile.depth * (1 + wearing * 0.35);
  r.smile.rotation = base.smile.rotation - wearing * 4;
  return r;
}

/**
 * The reduced-motion variant, and the `off` setting's member.
 *
 * There is no honest still of this moment: the chair arrives by unfolding, and
 * the model cannot cross-fade two poses, so a held pose plus a chair that faded
 * in around a frozen body would read as a bug rather than as a break. A visitor
 * who has asked for reduced motion gets the resting pose instead -- the same
 * call the play moves make, and for the same reason.
 */
const relaxStill: Sequence = {
  id: 'relax-still',
  group: 'relax',
  priority: PRIORITY.idle + 40,
  duration: 1,
  canInterrupt: true,
  loop: true,
  intensity: 'off',
  assets: [],
  reducedMotionFallback: null,
  states: ['relaxing'],
  pose: (base) => cloneRig(base),
};

/**
 * A04 at `minimal`. The chair unfolds, she settles, and she gets up again: the
 * whole arc with nothing added. At this setting the break reads as a chair and a
 * posture rather than as a performance.
 */
const relaxSettle: Sequence = {
  id: 'relax-settle',
  group: 'relax',
  priority: PRIORITY.idle + 40,
  duration: 6_800,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: ['deckchair'],
  reducedMotionFallback: 'relax-still',
  states: ['relaxing'],
  pose: (base, t) => relaxPose(base, t, { shades: false, doze: false }),
};

/**
 * A04 at `balanced`: the plan's "chair unfolds, shades, relax". The lenses come
 * down after the chair has taken her weight, and lift again before she stirs.
 */
const relaxSunbathe: Sequence = {
  id: 'relax-sunbathe',
  group: 'relax',
  priority: PRIORITY.idle + 40,
  duration: 9_200,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['deckchair', 'sunglasses'],
  reducedMotionFallback: 'relax-still',
  states: ['relaxing'],
  pose: (base, t) => relaxPose(base, t, { shades: true, doze: false }),
};

/**
 * A04 at `playful`: she dozes off, and two sparkles drift away from her while
 * she is under -- the character's one daydream, and the reason this variant is
 * longer than the others.
 */
const relaxDoze: Sequence = {
  id: 'relax-doze',
  group: 'relax',
  priority: PRIORITY.idle + 40,
  duration: 11_400,
  canInterrupt: true,
  loop: false,
  intensity: 'playful',
  assets: ['deckchair', 'sunglasses', 'sparkle'],
  reducedMotionFallback: 'relax-still',
  states: ['relaxing'],
  pose: (base, t) => relaxPose(base, t, { shades: true, doze: true }),
};

// ─── A05: the balloon ────────────────────────────────────────────────────────

/**
 * Where the balloon is let go from, where it hovers, and how far it drifts once
 * it is released: all three in the body's frame, which is the frame the balloon
 * artwork is authored in.
 *
 * A balloon is the one prop with nowhere else to be authored *but* the body's
 * frame (D-21): it is held against the character, so its position is a fact
 * about the composition -- "past her rays, over her shoulder" -- rather than
 * about a balloon. These constants are therefore the composition, and the
 * variants below only decide how much the balloon wanders around them.
 */
const BALLOON_START = { x: 30, y: -10 } as const;
const BALLOON_HOVER = { x: 34, y: -62 } as const;
/** How far it drifts once released, to the right and up, in body units. */
const BALLOON_RELEASE = { x: 12, y: 18 } as const;

/** How each intensity setting lets the balloon behave. */
interface BalloonExtra {
  /** Side-to-side swing while it is held, in body units. */
  sway: number;
  /**
   * A second, faster swing at a different frequency. The two together make the
   * balloon wander rather than oscillate, which is the difference between "being
   * held" and "doing whatever it likes" -- and it is the only thing `playful`
   * adds that `balanced` cannot express.
   */
  wander: number;
  /** How far she leans after it, in degrees. */
  lean: number;
}

/**
 * The balloon, from the moment she lets it go to the moment it is gone.
 *
 * **Why this is a finite event rather than a loop.** It is the same constraint
 * the deckchair runs into (A04, D-20): a sequence's pose is a function of its
 * own progress and nothing else, so a loop would replay the release on every
 * cycle, and an ambient cannot loop here either because the scheduler never
 * retires the floor instance. So the float is a finite *event*, asked for when
 * the visitor taps her, and the resting layer carries the scene afterwards.
 *
 * **It leaves by itself.** The visitor may never tap the balloon at all, so the
 * float has to have an end that does not depend on them: it rises, hovers for as
 * long as it likes, and is released at the end -- up and to the right, shrinking
 * as it goes, its opacity already at nothing before it reaches the edge of the
 * viewBox. The tap, if it comes, cuts this short (see `pop`, below).
 *
 * **The gaze is the one part of this pose that is a function of another part of
 * it.** Everything else here derives from `t`; the gaze derives from where the
 * balloon currently *is*, because a character watching something that wanders
 * cannot have that fact precomputed. It is still pure -- the position is a pure
 * function of `t`, so the gaze is too -- and it is written this way rather than
 * as a second, parallel set of numbers so the two can never drift apart.
 */
function balloonPose(base: SunnyRig, t: number, extra: BalloonExtra): SunnyRig {
  const r = cloneRig(base);

  // In over the first fifth, out over the last fifth, so the balloon is never
  // drawn in the instant it appears or the instant it goes.
  const arrive = ease(t / 0.2);
  const leave = ease((t - 0.8) / 0.2);
  const visible = arrive * (1 - leave);
  // Only the middle of the flight obeys the variants: the arrival is a release
  // and the departure is a drift, and neither is a thing the tenant's motion
  // setting should be able to make wander.
  const held = ease(Math.min(arrive, (0.8 - t) / 0.12));

  const sway = wave(t * 1.5) * extra.sway * held;
  const wander = wave(t * 2.3, 0.15) * extra.wander * held;
  const bob = wave(t * 1.5, 0.25) * (2.2 + extra.sway * 0.25) * held;
  const drift = wave(t * 3.1, 0.6) * extra.wander * held;

  const x =
    BALLOON_START.x +
    (BALLOON_HOVER.x - BALLOON_START.x) * arrive +
    sway +
    wander +
    leave * BALLOON_RELEASE.x;
  const y =
    BALLOON_START.y +
    (BALLOON_HOVER.y - BALLOON_START.y) * arrive -
    bob -
    leave * BALLOON_RELEASE.y;

  // She leans and tilts after it -- a small lean, because the balloon is doing
  // the travelling and she is only watching it go -- and smiles a little more.
  const toward = extra.lean * held;
  r.rotation = base.rotation + toward;
  r.faceTilt = base.faceTilt - toward * 0.6;
  r.x = base.x + toward * 0.35;
  r.y = base.y - held * 0.5 - bob * 0.1;
  r.smile.depth = base.smile.depth * (1 + held * 0.12);
  r.smile.span = base.smile.span * (1 + held * 0.05);

  // The gaze follows the balloon: from the body centre to where it is now,
  // normalised, and clamped to the ±1 the rig documents.
  const mag = Math.max(1, Math.hypot(x, y));
  const gaze: Vec2 = {
    x: Math.max(-1, Math.min(1, x / mag)),
    y: Math.max(-1, Math.min(1, y / mag)),
  };
  r.eyes.left.gaze = gaze;
  r.eyes.right.gaze = { ...gaze };

  // The ring opens as she looks up, and the wind that moved the balloon moves
  // the rays with it -- which is the only reason `drift` exists as its own term
  // rather than being folded into `wander`.
  for (const ray of r.rays) {
    ray.lengthScale = 1 + held * 0.04 + drift * 0.02;
    ray.widthScale = 1 + held * 0.02;
    ray.rotation = drift * 2;
  }

  r.props = [
    {
      id: 'balloon',
      x,
      y,
      // Tumbling slightly as it swings, and held back at an angle in the instant
      // it is released -- which reads as the string going slack rather than as
      // the balloon rotating on its own.
      rotation: sway * 1.5 + drift * 2 + (1 - arrive) * -6,
      scale: 0.72 + 0.28 * arrive - leave * 0.16,
      opacity: visible,
    },
  ];
  return r;
}

/**
 * The reduced-motion variant, and the `off` setting's member: a balloon held
 * still.
 *
 * This is the opposite call to A04's, and the difference is worth stating.
 * There is no honest still of a deckchair arriving (D-20), so that moment
 * resolves to the resting pose. There *is* an honest still here -- a balloon at
 * rest is a perfectly ordinary thing to see -- so the visitor who has asked for
 * less motion gets a balloon rather than nothing, and the tap still works on it.
 * What they do not get is a balloon that travels, which is the whole of what
 * this moment's motion consists of.
 */
const balloonStill: Sequence = {
  id: 'balloon-still',
  group: 'balloon',
  priority: PRIORITY.play,
  duration: 1,
  canInterrupt: true,
  loop: true,
  intensity: 'off',
  assets: ['balloon'],
  reducedMotionFallback: null,
  states: ['idle', 'playing'],
  pose: (base) => {
    const r = cloneRig(base);
    r.props = [
      { id: 'balloon', x: BALLOON_HOVER.x, y: BALLOON_HOVER.y, rotation: 0, scale: 1, opacity: 1 },
    ];
    return r;
  },
};

/**
 * A05 at `minimal`: the balloon is released, rises to shoulder height, hovers
 * while she watches it, and is let go. No sway to speak of -- at this setting
 * the moment is the balloon, not what the balloon does.
 */
const balloonRise: Sequence = {
  id: 'balloon-rise',
  group: 'balloon',
  priority: PRIORITY.play,
  duration: 4_600,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: ['balloon'],
  reducedMotionFallback: 'balloon-still',
  states: ['idle', 'playing'],
  pose: (base, t) => balloonPose(base, t, { sway: 0.6, wander: 0, lean: 1.6 }),
};

/**
 * A05 at `balanced`: the plan's "balloon floats, gaze follows". It swings as she
 * holds on to it, and she leans after it as it goes.
 */
const balloonSway: Sequence = {
  id: 'balloon-sway',
  group: 'balloon',
  priority: PRIORITY.play,
  duration: 5_600,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['balloon'],
  reducedMotionFallback: 'balloon-still',
  states: ['idle', 'playing'],
  pose: (base, t) => balloonPose(base, t, { sway: 1.6, wander: 0.8, lean: 2.6 }),
};

/**
 * A05 at `playful`: a balloon that is not being held so much as tolerated. Two
 * frequencies rather than one bigger one, so the path is a wander rather than a
 * swing, and the rays feel the wind.
 */
const balloonWander: Sequence = {
  id: 'balloon-wander',
  group: 'balloon',
  priority: PRIORITY.play,
  duration: 6_800,
  canInterrupt: true,
  loop: false,
  intensity: 'playful',
  assets: ['balloon'],
  reducedMotionFallback: 'balloon-still',
  states: ['idle', 'playing'],
  pose: (base, t) => balloonPose(base, t, { sway: 2.4, wander: 2.0, lean: 3.4 }),
};

/** How a pop plays out. */
interface PopExtra {
  /** How many shards the burst has. */
  shards: number;
  /** How far the furthest shard travels, in body units. */
  reach: number;
  /** How much she is startled by it: 0 is nothing, 1 is a full flinch. */
  jolt: number;
}

/**
 * The balloon bursting where the visitor touched it.
 *
 * **Anchored, and that is the whole point of the moment.** A pose is a function
 * of its own progress; this one is also a function of a position the visitor
 * chose, which is why `Sequence.pose` takes an optional `MomentAnchor` at all
 * (see `types.ts`). The anchor is in viewBox coordinates and the shards are
 * placed back into the body's frame from it, *per shard and after the body has
 * moved*: the burst expands on the screen rather than in the body's frame, so
 * the flinch below must not drag the shards along with it. A burst that moved
 * with her would look painted on.
 *
 * **Without an anchor** -- the scheduler asked for the moment with no input, as
 * the animation gallery's `Play` does -- the burst starts at the balloon's own
 * resting place, which is the only other position it could meaningfully have.
 * Every other anchored reading of this would be an invented one.
 */
function popPose(
  base: SunnyRig,
  t: number,
  anchor: MomentAnchor | undefined,
  extra: PopExtra,
): SunnyRig {
  const r = cloneRig(base);
  const centre: Vec2 = anchor ? anchor.point : toViewBox(base, BALLOON_HOVER);

  // The flinch: the burst is the moment and she is only reacting to it, so this
  // is over in the first third and the shards outlive it.
  const jolt = bump(t / 0.35) * extra.jolt;
  r.y = base.y - jolt * 2.4;
  r.squash = jolt * 0.07;
  r.stretch = jolt * 0.03;
  r.rotation = base.rotation - jolt * 2.2;
  r.faceTilt = base.faceTilt - jolt * 1.6;

  // Eyes wider and brows up: this is the only moment in the vocabulary where
  // Sunny is the one being surprised.
  for (const side of ['left', 'right'] as const) {
    r.eyes[side].scaleY = base.eyes[side].scaleY + jolt * 0.22;
    r.brows[side].y = base.brows[side].y - jolt * 1.4;
    r.brows[side].arch = base.brows[side].arch * (1 + jolt * 0.3);
  }
  r.smile.depth = base.smile.depth * (1 + jolt * 0.2);

  // And the rays take the shock: one quick flare out and a settle back.
  for (const ray of r.rays) {
    ray.lengthScale = 1 + jolt * 0.12;
    ray.widthScale = 1 + jolt * 0.08;
  }

  // The shards. Each is aimed at its own angle and thrown along it, so the burst
  // is a ring rather than a blob; alternating angles by a fixed amount and
  // varying the reach by shard index keeps it irregular enough to read as a
  // burst rather than as a clock face, without any randomness to replay.
  const props: PropRig[] = [];
  for (let i = 0; i < extra.shards; i++) {
    // Staggered by thirds so the burst has a little depth to it rather than
    // being one ring expanding in lockstep -- which reads as a diagram.
    const p = (t - 0.06 - (i % 3) * 0.04) / 0.68;
    if (p <= 0 || p >= 1) continue;
    const out = 1 - (1 - p) * (1 - p); // fast out of the centre, slowing as it goes
    const angle = (i / extra.shards) * 360 + (i % 2) * 24;
    const dist = out * extra.reach * (0.72 + 0.28 * ((i % 3) / 2));
    const radians = (angle * Math.PI) / 180;
    const local = toBodyFrame(r, {
      x: centre.x + Math.sin(radians) * dist,
      y: centre.y - Math.cos(radians) * dist,
    });
    props.push({
      id: 'sparkle',
      x: local.x,
      y: local.y,
      rotation: angle + p * 180,
      scale: 0.95 * (1 - out * 0.55),
      opacity: bump(p) * 0.95,
    });
  }

  r.props = props;
  return r;
}

/**
 * The reduced-motion variant, and the `off` setting's member: the balloon is
 * simply not there any more.
 *
 * Unlike the float's still, there is no honest still of this moment -- a frozen
 * burst is a drawing of a burst rather than the burst -- so this is the resting
 * pose, exactly as `play-still` is for a hop. It is a real answer rather than a
 * gap: the shards were never the balloon, and the balloon is gone either way.
 */
const popStill: Sequence = {
  id: 'pop-still',
  group: 'pop',
  priority: PRIORITY.interaction,
  duration: 1,
  canInterrupt: true,
  loop: true,
  intensity: 'off',
  assets: [],
  reducedMotionFallback: null,
  states: ['idle', 'playing'],
  pose: (base) => cloneRig(base),
};

/**
 * A05 at `minimal`: the balloon is gone and a few shards drift out of where it
 * was. She notices, but barely -- at this setting the pop is an event rather
 * than a fright.
 */
const popBurst: Sequence = {
  id: 'pop-burst',
  group: 'pop',
  priority: PRIORITY.interaction,
  duration: 520,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: ['sparkle'],
  reducedMotionFallback: null,
  states: ['idle', 'playing'],
  pose: (base, t, anchor) => popPose(base, t, anchor, { shards: 5, reach: 20, jolt: 0.35 }),
};

/**
 * A05 at `balanced`: the plan's "optional tap/pop". A fuller burst, and she
 * flinches at it -- the first moment in the vocabulary she did not ask for.
 */
const popFlinch: Sequence = {
  id: 'pop-flinch',
  group: 'pop',
  priority: PRIORITY.interaction,
  duration: 620,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['sparkle'],
  reducedMotionFallback: null,
  states: ['idle', 'playing'],
  pose: (base, t, anchor) => popPose(base, t, anchor, { shards: 7, reach: 26, jolt: 0.8 }),
};

/**
 * A05 at `playful`: a shower. The most shards and the longest throw, which at
 * this size is the difference between "it popped" and "it went everywhere".
 */
const popShower: Sequence = {
  id: 'pop-shower',
  group: 'pop',
  priority: PRIORITY.interaction,
  duration: 760,
  canInterrupt: true,
  loop: false,
  intensity: 'playful',
  assets: ['sparkle'],
  reducedMotionFallback: null,
  states: ['idle', 'playing'],
  pose: (base, t, anchor) => popPose(base, t, anchor, { shards: 10, reach: 34, jolt: 1 }),
};

// ─── A11: planting a flower ──────────────────────────────────────────────────

/**
 * Where the seed goes in, and how far the plant leans away from her.
 *
 * Authored in the body's frame like every other prop, but the numbers come from
 * the composition rather than from taste, and the composition puts one rule on
 * this moment that no other row has: **the plant must not be drawn across her
 * rays.** She has eight; the two that own the lower right are at 91.5 degrees
 * (straight out to the side) and 131.5 (down and right), and they leave a
 * 40-degree gap between them. Everything else on that side is her own body or a
 * ray, so the plant goes in the gap: the base at (64, 52), which is 82.5 out from
 * her centre and so past both ray tips, and a lean of 14 degrees away from her,
 * which is what keeps the stem outside the ray ring all the way up.
 *
 * `y = 52` is the ground the deckchair stands on (D-20), because a plant on a
 * different floor from the chair is a sticker rather than a plant.
 *
 * The leaning is the part that has to be explained, and it is not botany.
 * `sprout` and `flower` are the two props authored *from their base* (see
 * `render.ts`), so 22 units of stem is 22 units of lean away from wherever it is
 * planted -- and leaning it *toward* her, which is the direction a real plant
 * would grow toward a sun, would grow it straight across the rays this whole
 * placement exists to avoid. It leans away because that is where the open space
 * is, and the two numbers below are where that stopped grazing the ray at 131.5
 * degrees: the leaf tip comes within 2 units of it, which is a gap on screen
 * rather than a crossing.
 */
const PLANT = { x: 64, y: 52, lean: 14 } as const;

/**
 * How far above the planting point the bloom's centre sits, in the flower's own
 * art.
 *
 * The one number here that is a copy of a number in `render.ts`, kept because
 * the alternative is a gaze aimed at nothing: she looks at the flower, so the
 * sequence has to know where the flower is, and where it is is (0, -30) rotated
 * by the lean. If the bloom moves in the artwork, this moves with it -- the
 * `flower` path and this constant are two halves of one fact.
 */
const BLOOM_UP = 30;

/** Where the bloom's centre ends up once the plant has leaned, in body units. */
function bloomCentre(): Vec2 {
  const a = (PLANT.lean * Math.PI) / 180;
  return { x: PLANT.x + BLOOM_UP * Math.sin(a), y: PLANT.y - BLOOM_UP * Math.cos(a) };
}

/**
 * Where the seed is before it is dropped, in body units: beside her, chest high,
 * in the same gap in the rays the plant ends up in, so the fall is one short
 * move down and out rather than a journey around her. At radius 59 it is clear
 * of the body's outline (47.25) and of both rays on that side.
 */
const SEED_HELD = { x: 56, y: 18 } as const;

/** When each stage of the moment happens, as progress through it. */
const SEED_APPEARS_BY = 0.06;
const SEED_DROPS_AT = 0.02;
const SEED_LANDS_BY = 0.16;
const SEED_FADES_FROM = 0.17;
const SEED_GONE = 0.22;
const SPROUT_AT = 0.26;
const SPROUT_DONE = 0.5;
const FLOWER_AT = 0.58;
const FLOWER_DONE = 0.86;
const TAKEN_IN = 0.88;

/** How each intensity setting lets the planting behave. */
interface BloomExtra {
  /** How far the rays stretch while the sun does its work, as a fraction. */
  shine: number;
  /** How many glints are in the air while it grows. */
  gleam: number;
  /** How much bigger the bloom comes out. */
  bloom: number;
  /** Whether the bloom lifts her off the ground for a moment. */
  hop: boolean;
  /** How far she leans toward it, in degrees. */
  lean: number;
}

/**
 * A11: the seed, the sun, the sprout and the flower.
 *
 * **One moment with four stages, rather than four moments.** The row names four
 * things in a fixed order and that order is the whole of its interest. Four
 * sequences would be four chances to be interrupted between them -- a visitor
 * who looked away during the sprout would have planted a seed and never seen a
 * flower -- so the story is kept whole in one pose, and its four stages are four
 * windows of one progress value.
 *
 * **Three props for four stages, because a prop cannot morph.** A prop is one
 * path with one transform (see `render.ts`), so nothing here can be a seed that
 * *becomes* a shoot: the growth is a cross-fade, each stage faded in as the one
 * before it fades out. It works because `sprout` and `flower` are both authored
 * from their planting point, so the two cross-fade over the same spot rather
 * than two drawings sliding past each other.
 *
 * **The shine has no prop at all.** A beam of light would be a fourth painting,
 * and the character is already the light she is standing in: her rays stretch,
 * which is the same gesture as the sun coming out, and it is the stage the three
 * variants carry most of their difference in.
 *
 * **Nothing is left behind.** The bloom withdraws over the last tenth of the
 * moment because a finite sequence is retired when it is over, so a flower that
 * stayed would be a flower that vanished on the next frame. A visitor who asked
 * for less motion gets a plant that is simply already there, which is
 * `bloom-still`.
 */
function bloomPose(base: SunnyRig, t: number, extra: BloomExtra): SunnyRig {
  const r = cloneRig(base);
  const props: PropRig[] = [];

  // The sun. The rays lengthen while the seed is in the ground and settle back
  // before the bloom opens, so the light is what the growth is *for* rather than
  // decoration over the top of it.
  const shine = swell(t, 0.1, 0.46) * extra.shine;
  r.rays.forEach((ray, i) => {
    ray.lengthScale = base.rays[i]!.lengthScale + shine;
  });

  // The seed: it appears beside her, drops to the planting point, and is gone
  // before the shoot is up. The fall eases rather than running straight -- a
  // drop that does not slow before it lands reads as a seed being pushed -- and
  // it rights itself on the way down, which is the whole of what planting looks
  // like on a character with no hands.
  const fallen = ease((t - SEED_DROPS_AT) / (SEED_LANDS_BY - SEED_DROPS_AT));
  const seedOpacity =
    ease(t / SEED_APPEARS_BY) * (1 - ease((t - SEED_FADES_FROM) / (SEED_GONE - SEED_FADES_FROM)));
  if (seedOpacity > 0) {
    props.push({
      id: 'seed',
      x: SEED_HELD.x + (PLANT.x - SEED_HELD.x) * fallen,
      y: SEED_HELD.y + (PLANT.y - SEED_HELD.y) * fallen,
      rotation: -22 * (1 - fallen),
      scale: 1,
      opacity: seedOpacity,
    });
  }

  // The shoot: up out of the planting point, more sideways than it ends so that
  // it reads as growing *out* of the ground, then straightening as it rises.
  const sprout = ease((t - SPROUT_AT) / (SPROUT_DONE - SPROUT_AT));
  const sproutOpacity = Math.min(1, sprout * 4) * (1 - ease((t - FLOWER_AT) / 0.14));
  if (sproutOpacity > 0) {
    props.push({
      id: 'sprout',
      x: PLANT.x,
      y: PLANT.y,
      rotation: PLANT.lean + 14 * (1 - sprout),
      scale: 0.25 + 0.75 * sprout,
      opacity: sproutOpacity,
    });
  }

  // The bloom, and the shape the row is named for. It opens as it grows -- the
  // head untwists and then settles, which is the only sort of opening a
  // one-transform prop can do -- and it is taken in over the last tenth.
  const bloom = ease((t - FLOWER_AT) / (FLOWER_DONE - FLOWER_AT));
  const flowerOpacity = Math.min(1, bloom * 4) * (1 - ease((t - TAKEN_IN) / (1 - TAKEN_IN)));
  if (flowerOpacity > 0) {
    props.push({
      id: 'flower',
      x: PLANT.x,
      y: PLANT.y,
      rotation: PLANT.lean - 11 * (1 - bloom) + swell(t, 0.6, 0.92) * 3,
      scale: (0.25 + 0.75 * bloom) * extra.bloom * (1 + swell(t, 0.62, 0.86) * 0.06),
      opacity: flowerOpacity,
    });
  }

  // She leans over it and watches. One number drives the lean, the shift and the
  // smile rather than three that would drift apart, and it is `land` so that all
  // of them are the base values *exactly* at both ends (D-25).
  const held = land(t / 0.9);
  const lean = extra.lean * held;
  r.rotation = base.rotation + lean;
  r.x = base.x + lean * 0.35;
  r.faceTilt = base.faceTilt - lean * 0.5;
  r.smile.depth = base.smile.depth * (1 + held * 0.16);
  r.smile.span = base.smile.span * (1 + held * 0.06);
  if (extra.hop) r.y = base.y - swell(t, 0.58, 0.88) * 2.4;

  // What she is looking at: the seed while it is still falling, the bloom once
  // there is one, and nothing in particular before either. The offset is written
  // as `base + (target - base) * held` rather than assigned outright so that the
  // gaze is the base gaze at t = 0 and t = 1 -- and so that this keeps working
  // the day a base rig arrives with a gaze of its own.
  const focus: Vec2 =
    sprout > 0 || bloom > 0
      ? bloomCentre()
      : {
          x: SEED_HELD.x + (PLANT.x - SEED_HELD.x) * fallen,
          y: SEED_HELD.y + (PLANT.y - SEED_HELD.y) * fallen,
        };
  const mag = Math.max(1, Math.hypot(focus.x, focus.y));
  const gaze: Vec2 = {
    x: base.eyes.left.gaze.x + (focus.x / mag - base.eyes.left.gaze.x) * held,
    y: base.eyes.left.gaze.y + (focus.y / mag - base.eyes.left.gaze.y) * held,
  };
  r.eyes.left.gaze = gaze;
  r.eyes.right.gaze = { ...gaze };

  // The glints at the stronger settings: the light coming off the plant as it
  // grows. Each is drawn only inside its own window -- `continue` rather than a
  // fade to zero -- so the last frame of the moment has no props in it at all,
  // and the two are staggered so they are in the air one after the other rather
  // than in a row.
  //
  // They rise along the plant's own lean, from just above the soil to a little
  // past the bloom, rather than in a freer arc. The reason is the same one that
  // fixed the planting point: the gap between the rays at 91.5 and 131.5 degrees
  // is narrow, and a glint that wanders out of it lands *on* the side ray, where
  // a dark sparkle against orange reads as a speck of dirt on the ray rather
  // than as light. Light that travels up the stem is also the truer picture --
  // it is what made the plant grow.
  const axis = {
    x: Math.sin((PLANT.lean * Math.PI) / 180),
    y: -Math.cos((PLANT.lean * Math.PI) / 180),
  };
  for (let i = 0; i < extra.gleam; i++) {
    const p = (t - 0.34 - i * 0.14) / 0.3;
    if (p <= 0 || p >= 1) continue;
    // From 8 units above the planting point to 8 units past the bloom, so the
    // spark leaves the stem at the top rather than stopping on the flower.
    const rise = 8 + p * 32;
    props.push({
      id: 'sparkle',
      x: PLANT.x + axis.x * rise,
      y: PLANT.y + axis.y * rise,
      rotation: p * 160,
      scale: 0.34 + bump(p) * 0.42,
      opacity: bump(p) * 0.9,
    });
  }

  r.props = props;
  return r;
}

/**
 * The `off` setting's member, and the reduced-motion answer: the plant standing
 * where it was planted.
 *
 * The same call as A05's still and not A04's, and for the same reason: there is
 * no honest still of a deckchair arriving (D-20), and there *is* an honest still
 * of a plant growing -- a flower standing beside her is an ordinary thing to
 * see. So a visitor who has asked for less motion gets the flower rather than
 * nothing, and what they do not get is the four stages, which is the whole of
 * what this moment's motion consists of.
 *
 * It loops, so at the `off` intensity -- where the setting picks this variant
 * itself -- the plant simply stays. Reached the other way, as the fallback for a
 * visitor who asked for less motion at a higher setting, it runs on the clock of
 * the variant it replaced and is retired with it at 6.2 s. That difference is the
 * engine's rather than this row's: a fallback has always run on the length of the
 * moment it stood in for, and every group behaves the same way.
 *
 * It is three of the four stages compressed to the last one, which is worth
 * being plain about: a still cannot show a seed becoming a shoot, so the still
 * is the end of the story rather than a taste of it.
 */
const bloomStill: Sequence = {
  id: 'bloom-still',
  group: 'bloom',
  priority: PRIORITY.play,
  duration: 1,
  canInterrupt: true,
  loop: true,
  intensity: 'off',
  assets: ['flower'],
  reducedMotionFallback: null,
  states: ['idle', 'playing'],
  pose: (base) => {
    const r = cloneRig(base);
    r.props = [
      { id: 'flower', x: PLANT.x, y: PLANT.y, rotation: PLANT.lean, scale: 1, opacity: 1 },
    ];
    return r;
  },
};

/**
 * A11 at `minimal`: the seed goes in and the flower comes up. The shine is a
 * suggestion rather than a moment of its own -- at this setting the row is the
 * plant, not the light that made it grow.
 */
const bloomSeed: Sequence = {
  id: 'bloom-seed',
  group: 'bloom',
  priority: PRIORITY.play,
  duration: 4_200,
  canInterrupt: true,
  loop: false,
  intensity: 'minimal',
  assets: ['seed', 'sprout', 'flower'],
  reducedMotionFallback: 'bloom-still',
  states: ['idle', 'playing'],
  pose: (base, t) => bloomPose(base, t, { shine: 0.05, gleam: 0, bloom: 1, hop: false, lean: 1.4 }),
};

/**
 * A11 at `balanced`: the plan's four stages, in order. The rays stretch while it
 * is in the ground, and a glint comes off it as it comes up.
 */
const bloomGrow: Sequence = {
  id: 'bloom-grow',
  group: 'bloom',
  priority: PRIORITY.play,
  duration: 5_200,
  canInterrupt: true,
  loop: false,
  intensity: 'balanced',
  assets: ['seed', 'sprout', 'flower', 'sparkle'],
  reducedMotionFallback: 'bloom-still',
  states: ['idle', 'playing'],
  pose: (base, t) => bloomPose(base, t, { shine: 0.11, gleam: 1, bloom: 1, hop: false, lean: 2.2 }),
};

/**
 * A11 at `playful`: the sunlight is at full strength, two glints run up the
 * plant as it grows, and the bloom is big enough to lift her off the ground
 * for a moment -- which is the one thing here that is a *reaction* rather than a
 * reading of the story.
 */
const bloomShowcase: Sequence = {
  id: 'bloom-showcase',
  group: 'bloom',
  priority: PRIORITY.play,
  duration: 6_200,
  canInterrupt: true,
  loop: false,
  intensity: 'playful',
  assets: ['seed', 'sprout', 'flower', 'sparkle'],
  reducedMotionFallback: 'bloom-still',
  states: ['idle', 'playing'],
  pose: (base, t) => bloomPose(base, t, { shine: 0.16, gleam: 2, bloom: 1.12, hop: true, lean: 3 }),
};

/**
 * The registry. Every sequence the engine can run is here; the scheduler can
 * only pick from this list, so a typo in a state name is a typecheck failure
 * rather than a silently dead animation.
 */
const AUTHORED: readonly Sequence[] = [
  idleStill,
  idle,
  blink,
  listeningStill,
  listening,
  thinkingStill,
  thinking,
  eurekaStill,
  eureka,
  speakingStill,
  speaking,
  guidingStill,
  guiding,
  celebrateStill,
  celebrateBounce,
  celebrate,
  confusedStill,
  confused,
  errorStill,
  error,
  chargingStill,
  charging,
  coolShadesStill,
  coolShades,
  coolShadesPlay,
  bubbleOpenStill,
  bubbleOpen,
  playStill,
  playShuffle,
  playRun,
  playDance,
  relaxStill,
  relaxSettle,
  relaxSunbathe,
  relaxDoze,
  balloonStill,
  balloonRise,
  balloonSway,
  balloonWander,
  popStill,
  popBurst,
  popFlinch,
  popShower,
  arcadeTuck,
  arcadeRoll,
  arcadeSpin,
  bloomStill,
  bloomSeed,
  bloomGrow,
  bloomShowcase,
];

/** Every sequence, with the body acting from `limb-acting.ts` layered on. */
export const SEQUENCES: readonly Sequence[] = AUTHORED.map(withLimbActing);

export const SEQUENCE_BY_ID: ReadonlyMap<string, Sequence> = new Map(
  SEQUENCES.map((s) => [s.id, s]),
);

/** Sequences eligible in a given state, strongest priority first. */
export function sequencesForState(state: SunnyState): Sequence[] {
  return SEQUENCES.filter((s) => s.states.includes(state)).sort((a, b) => b.priority - a.priority);
}

const RANK: Readonly<Record<Intensity, number>> = { off: 0, minimal: 1, balanced: 2, playful: 3 };

/** Intensity is a floor, not a hint: an ineligible sequence is never chosen. */
export function isEligible(sequence: Sequence, intensity: Intensity): boolean {
  return RANK[intensity] >= RANK[sequence.intensity];
}

/** Every sequence serving a behavioural moment, weakest first. */
export function sequencesInGroup(group: string): Sequence[] {
  return SEQUENCES.filter((s) => s.group === group).sort(
    (a, b) => RANK[a.intensity] - RANK[b.intensity] || a.id.localeCompare(b.id),
  );
}

/** Every group name, for the tests that assert none is ever left with no member. */
export const GROUPS: readonly string[] = [...new Set(SEQUENCES.map((s) => s.group))].sort();

/**
 * The strongest member of a group this intensity setting allows.
 *
 * Returns null only when the group is empty or every member is above the floor,
 * which is the situation the group tests exist to make impossible for the
 * moments the product actually depends on.
 */
export function bestInGroup(group: string, intensity: Intensity): Sequence | null {
  const eligible = sequencesInGroup(group).filter((s) => isEligible(s, intensity));
  // `sequencesInGroup` is sorted weakest first, so the last one is the
  // strongest the visitor's setting permits.
  return eligible[eligible.length - 1] ?? null;
}
