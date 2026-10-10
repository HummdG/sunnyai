import { cloneRig, type PropRig, type SunnyRig } from '@sunny/character';

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

  // How far she has settled into the seat, and how far the chair has unfolded.
  // They ramp together on the way in; on the way out the chair lingers, so she
  // is standing before it has finished folding.
  const seated = Math.min(ease(t / 0.2), ease((1 - t) / 0.12));
  const deployed = Math.min(ease(t / 0.2), ease((1 - t) / 0.1));

  // One slow breath for the length of the hold, and one stretch before she gets
  // up -- the only part of the moment where she opens her eyes again.
  const breath = wave(t * 1.25) * seated;
  const stretch = bump((t - 0.7) / 0.18);

  const lean = seated * 7;
  const sink = seated * 2.5;
  const dx = seated * 1.2;
  const dy = sink - breath * 0.8 - stretch * 1.6;

  r.rotation = base.rotation - lean;
  r.x = base.x + dx;
  r.y = base.y + dy;
  // Leaning back into the chair's back, and a little wider as she settles.
  r.faceTilt = base.faceTilt - seated * 3;
  r.squash = seated * 0.02;

  // A sunlit squint rather than a shut eye. `closed` collapses the eye to 6% of
  // its height, which is right for a blink and wrong here: at the sizes this
  // moment is actually seen it draws a black bar across her face, and with the
  // shades drawn as outlines over the top the two marks fight. A narrow eye
  // reads as comfortable at every size and lets the lenses stay legible.
  const squint = seated * (1 - stretch) * 0.62;
  r.eyes.left.closed = squint;
  r.eyes.right.closed = squint;
  r.smile.depth = base.smile.depth * (1 + seated * 0.3);
  r.smile.span = base.smile.span * (1 + seated * 0.08);

  // Relaxed rays: a little shorter at rest, and breathing with her.
  for (const ray of r.rays) {
    ray.lengthScale = 1 - seated * 0.05 + breath * 0.05 + stretch * 0.14;
    ray.widthScale = 1 + breath * 0.03;
  }

  const angle = (lean * Math.PI) / 180;
  const props: PropRig[] = [
    {
      id: 'deckchair',
      // See the note above: this is the inverse of the body's rotation and
      // translation, so the chair stays on the ground while she settles into it.
      x: -dx * Math.cos(angle) + dy * Math.sin(angle),
      y: -dx * Math.sin(angle) - dy * Math.cos(angle),
      // Plus the unfold: the chair swings open from a lean as it deploys.
      rotation: lean + (1 - deployed) * -14,
      scale: 0.35 + 0.65 * deployed,
      opacity: deployed,
    },
  ];

  // The shades come down onto narrowed eyes and lift again before the stretch.
  if (extra.shades) {
    const on = Math.min(ease((t - 0.16) / 0.1), ease((0.84 - t) / 0.1));
    props.push({
      id: 'sunglasses',
      x: -1.4,
      y: -5.1 - 34 * (1 - on),
      rotation: -3,
      scale: 1,
      opacity: on,
    });
  }

  // The doze: two sparkles drifting up out of the notch above her head, the way
  // a sleeping thought is drawn. There rather than over her face because ink on
  // orange is legible at every size while the same mark on the chair's pale
  // surface is not, and because a sparkle crossing her face would read as
  // something happening to her rather than as something leaving her.
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
  playStill,
  playShuffle,
  playRun,
  playDance,
  relaxStill,
  relaxSettle,
  relaxSunbathe,
  relaxDoze,
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
