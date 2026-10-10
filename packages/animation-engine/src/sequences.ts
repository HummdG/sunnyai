import { cloneRig, type PropRig } from '@sunny/character';

import { PRIORITY, type Intensity, type Sequence, type SunnyState } from './types.js';

// ─── small maths helpers ─────────────────────────────────────────────────────

const TAU = Math.PI * 2;

/** A sine wave over one period, phase `p` in 0..1, returning -1..1. */
const wave = (p: number, phase = 0): number => Math.sin((p + phase) * TAU);

/** Smooth 0→1→0 over the sequence, used to fade a gesture in and out. */
const bump = (t: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));

/** Smoothstep, for gestures that should ease rather than start and stop abruptly. */
const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

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
    const breath = wave(t) * 0.012;
    r.squash = breath;
    r.stretch = -breath * 0.6;
    r.y = base.y - 0.6 + wave(t) * 0.6;
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
  states: ['idle', 'listening', 'speaking', 'guiding', 'relaxing'],
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
    const a = bump(t);
    r.eyes.left.scaleY = 1 + a * 0.16;
    r.eyes.right.scaleY = 1 + a * 0.16;
    r.eyes.left.scaleX = 1 + a * 0.05;
    r.eyes.right.scaleX = 1 + a * 0.05;
    r.y = base.y - a * 2.2;
    for (const ray of r.rays) {
      ray.lengthScale = 1 + a * 0.06;
      ray.widthScale = 1 - a * 0.04;
    }
    r.smile.depth = base.smile.depth + a * 1.2;
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
    const spin = t * 22;
    for (const [i, ray] of r.rays.entries()) {
      ray.rotation = spin;
      // A travelling pulse, so the ring reads as turning rather than snapping.
      ray.lengthScale = 1 + wave(t * 2, -i / r.rays.length) * 0.07;
    }
    r.faceTilt = wave(t) * 2.4;
    const up = 0.62 + wave(t * 0.5) * 0.12;
    r.eyes.left.gaze = { x: -up * 0.6, y: -up };
    r.eyes.right.gaze = { x: -up * 0.6, y: -up };
    r.eyes.left.scaleY = 0.9;
    r.eyes.right.scaleY = 0.9;
    r.brows.left.y = base.brows.left.y - 1.6;
    r.brows.right.y = base.brows.right.y - 1.6;
    r.smile.span = base.smile.span * 0.62;
    r.smile.depth = base.smile.depth * 0.5;
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
  assets: ['question-mark', 'sparkle'],
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
        id: 'sparkle',
        x: 36,
        y: -36,
        rotation: flare * 90,
        scale: 0.4 + flare * 0.9,
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
    const beat = wave(t * 2);
    r.smile.depth = base.smile.depth * (1 + beat * 0.26);
    r.smile.span = base.smile.span * (1 + beat * 0.05);
    r.smile.y = base.smile.y + beat * 0.7;
    r.brows.left.y = base.brows.left.y + beat * 1.5;
    r.brows.right.y = base.brows.right.y + beat * 1.5;
    r.y = base.y + wave(t) * 0.8;
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
    const a = bump(t);
    const hop = Math.abs(Math.sin(t * Math.PI * 2)) * (1 - t * 0.4);
    r.y = base.y - hop * 6;
    r.squash = (0.06 - hop * 0.09) * (t < 0.5 ? 1 : 0.6);
    r.stretch = -r.squash * 0.7;
    r.rotation = wave(t * 2) * 6;
    r.smile.span = base.smile.span * (1 + a * 0.22);
    r.smile.depth = base.smile.depth * (1 + a * 0.3);
    r.eyes.left.scaleY = 1 - a * 0.26;
    r.eyes.right.scaleY = 1 - a * 0.26;
    r.brows.left.y = base.brows.left.y - a * 4;
    r.brows.right.y = base.brows.right.y - a * 4;
    r.props = [
      { id: 'sparkle', x: -38, y: -34, rotation: a * 90, scale: 0.4 + a * 0.6, opacity: a },
      { id: 'sparkle', x: 40, y: -22, rotation: -a * 90, scale: 0.4 + a * 0.6, opacity: a },
    ];
    for (const [i, ray] of r.rays.entries()) {
      ray.lengthScale = 1 + a * 0.12 * (i % 2 === 0 ? 1 : -0.4);
    }
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
    const a = bump(t);
    r.faceTilt = -14 * a;
    r.rotation = -4 * a;
    r.eyes.left.scaleY = 1 - a * 0.12;
    r.eyes.right.scaleY = 1 + a * 0.22;
    r.brows.left.y = base.brows.left.y - a * 5;
    r.brows.left.rotation = base.brows.left.rotation + a * 10;
    r.brows.right.y = base.brows.right.y + a * 3;
    r.smile.depth = base.smile.depth * (1 - a * 0.55);
    r.smile.rotation = base.smile.rotation + a * 8;
    r.props = [
      {
        id: 'question-mark',
        x: 36,
        y: -34,
        rotation: 14,
        scale: 0.55 + a * 0.35,
        opacity: a * 1.2 > 1 ? 1 : a * 1.2,
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
    const a = bump(t);
    for (const ray of r.rays) {
      ray.lengthScale = 1 - a * 0.22;
      ray.widthScale = 1 - a * 0.18;
    }
    r.squash = a * 0.08;
    r.stretch = -a * 0.06;
    r.smile.depth = base.smile.depth * (1 - a * 0.85);
    r.eyes.left.scaleY = 1 - a * 0.35;
    r.eyes.right.scaleY = 1 - a * 0.35;
    r.brows.left.y = base.brows.left.y + a * 4;
    r.brows.right.y = base.brows.right.y + a * 4;
    r.props = [
      {
        id: 'sweat-drop',
        x: 26,
        y: -32 + a * 6,
        rotation: 0,
        scale: 0.55,
        opacity: a,
      },
    ];
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
    const r = cloneRig(base);
    // Down over the first 30%, then held with a slow settle. After the hold the
    // lenses lift away again so the sequence can end in the rest pose.
    const descend = ease(Math.min(1, t / 0.3));
    const leave = t > 0.82 ? ease((t - 0.82) / 0.18) : 0;
    const drop = -34 * (1 - descend) - leave * 40;
    // A small overshoot past the resting height, damped: the confidence is in
    // the landing, not the speed.
    const overshoot = t < 0.3 ? 0 : Math.sin(t * Math.PI * 5) * Math.exp(-(t - 0.3) * 9) * 1.6;

    r.faceTilt = 0;
    // A slight backward lean and a rise as it lands, plus a half-smile that
    // does most of its work in the first tenth of a second.
    const lean = bump(Math.min(1, t / 0.6));
    r.rotation = base.rotation - lean * 2.2;
    r.y = base.y - lean * 1.2;
    r.eyes.left.gaze = { x: 0.12, y: -0.1 };
    r.eyes.right.gaze = { x: 0.12, y: -0.1 };
    r.smile.depth = base.smile.depth * (1 + descend * 0.18);
    for (const ray of r.rays) {
      ray.lengthScale = 1 + lean * 0.06;
    }
    r.props = [
      {
        id: 'sunglasses',
        x: -1.4,
        y: -5.1 + drop + overshoot,
        rotation: -3,
        scale: 1.0,
        opacity: Math.min(1, Math.max(0, 1 - leave)),
      },
    ];
    return r;
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
    const r = cloneRig(base);
    const descend = ease(Math.min(1, t / 0.26));
    const leave = t > 0.85 ? ease((t - 0.85) / 0.15) : 0;
    const drop = -40 * (1 - descend) - leave * 44;
    const overshoot = t < 0.26 ? 0 : Math.sin(t * Math.PI * 6) * Math.exp(-(t - 0.26) * 8) * 2.2;
    const strut = Math.sin(t * Math.PI * 4) * (t < 0.7 ? bump(t / 0.7) : 0);

    r.faceTilt = 0;
    r.rotation = base.rotation + strut * 4.5;
    r.x = base.x + strut * 2.6;
    r.y = base.y - bump(t) * 2.2;
    r.squash = strut * 0.02;
    for (const ray of r.rays) {
      ray.lengthScale = 1 + Math.max(0, strut) * 0.16;
      ray.rotation = ray.rotation + strut * 6;
    }
    r.smile.depth = base.smile.depth * (1 + descend * 0.3);
    r.props = [
      {
        id: 'sunglasses',
        x: -1.4,
        y: -5.1 + drop + overshoot,
        rotation: -6 + strut * 4,
        scale: 1.0,
        opacity: Math.min(1, Math.max(0, 1 - leave)),
      },
      // A sparkle flicks off the right lens as they land, then is gone.
      {
        id: 'sparkle',
        x: 15,
        y: -12 + overshoot,
        rotation: 24 + t * 140,
        scale: 0.5 * Math.max(0, 1 - t * 2.6),
        opacity: Math.max(0, 1 - t * 2.2),
      },
    ];
    return r;
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
    // Compress, then overshoot past rest, then settle. The overshoot is what
    // makes it feel elastic rather than like a resize.
    const compress = t < 0.35 ? ease(t / 0.35) : 0;
    const spring =
      t < 0.35 ? 0 : Math.sin(((t - 0.35) / 0.65) * Math.PI * 2) * Math.exp(-(t - 0.35) * 6);
    r.squash = compress * 0.16 - spring * 0.05;
    r.stretch = compress * 0.12 + spring * 0.04;
    r.y = base.y + compress * 4;
    for (const ray of r.rays) {
      ray.lengthScale = 1 - compress * 0.25 + spring * 0.05;
    }
    r.eyes.left.scaleY = 1 - compress * 0.3;
    r.eyes.right.scaleY = 1 - compress * 0.3;
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

/**
 * The registry. Every sequence the engine can run is here; the scheduler can
 * only pick from this list, so a typo in a state name is a typecheck failure
 * rather than a silently dead animation.
 */
export const SEQUENCES: readonly Sequence[] = [
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
];

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
