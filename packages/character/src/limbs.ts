/**
 * Sunny's rubber-hose limbs, drawn the way `reference_poses.png` draws them.
 *
 * Every pose on the sheet keeps all eight rays: the arms are short hoses that
 * come out of the sides of the body between the rays, and the legs come out of
 * the bottom either side of the lowest ray, ending in big flat bean shoes.
 *
 * History: on 2026-10-12 the rays themselves morphed into the limbs, which
 * left a standing Sunny with half a crown and blob hands. On 2026-10-14 the
 * owner rejected those hands and feet and asked for the pose sheet followed in
 * detail; this is that anatomy. The socket angles are one constant
 * (`LIMB_SOCKETS`), so the attachment is easy to revisit.
 *
 * Each limb has a `morph` from 0 to 1, meaning how far it is *out*:
 *
 * - 0 -- tucked away behind the body, nothing drawn: the logo pose, which is
 *   pixel-identical to `sunny.png`;
 * - in between -- the hose grows out of its socket towards its target, the
 *   hand or shoe growing on its end;
 * - 1 -- a full arm with its hand, or a leg with its shoe.
 *
 * Arms live in the body frame. Legs start at their socket on the body but
 * their feet are planted relative to the body's REST position, so when Sunny
 * bobs or squashes the legs stretch like rubber instead of the feet floating.
 */

import { boilPath, noise } from './boil.js';
import { RAY } from './geometry.js';
import { HANDS, SMEAR, type HandArt } from './hands.js';

interface Vec2 {
  x: number;
  y: number;
}

export const HAND_SHAPES = [
  'relaxed',
  'open',
  'fist',
  'grip',
  'point',
  'index',
  'thumb',
  'peace',
] as const;
export type HandShape = (typeof HAND_SHAPES)[number];

export interface ArmRig {
  /** Kept for compatibility; the arm grows from its socket (`LIMB_SOCKETS`). */
  shoulderDeg: number;
  /** The wrist, in the body frame. */
  hand: Vec2;
  /** Rubber-hose bow: + bulges clockwise of the ray-to-hand line. */
  bend: number;
  shape: HandShape;
  /** Extra hand rotation in degrees, on top of following the arm. */
  handRotation: number;
  /** Hand size multiplier. */
  handScale: number;
  /** Draw the whole arm over the body (hand on chin, holding a book). */
  front: boolean;
  /** Draw the whole arm behind the body (hands behind the head). */
  behind?: boolean;
  /** 0 = tucked behind the body; 1 = a full arm. Defaults to 1. */
  morph?: number;
  /**
   * Draw the whole arm, tube included, in front of the body -- for a pose
   * whose arm crosses in front (a hand on the chin), instead of passing behind.
   */
  tubeFront?: boolean;
  /** Mid-change between two hand shapes: draw the smear instead (`blendLimbs`). */
  smear?: boolean;
  /**
   * Where the elbow is, in the body frame: the point the hose passes through
   * halfway along. Overrides `bend` when given. A short arm -- a fist on the
   * hip -- needs its elbow placed, not bowed: the sheet throws it out wide.
   */
  elbow?: Vec2;
}

export interface LegRig {
  /** Kept for compatibility; legs grow from their sockets (`LIMB_SOCKETS`). */
  hip: Vec2;
  /** The ankle, relative to the body's REST centre (so feet stay planted). */
  foot: Vec2;
  bend: number;
  /** Shoe tilt in degrees; the toe points outward at 0. */
  footRotation: number;
  /** 0 = tucked behind the body; 1 = a full leg. Defaults to 1. */
  morph?: number;
}

export interface LimbsRig {
  visible: boolean;
  arms: { left: ArmRig; right: ArmRig };
  legs: { left: LegRig; right: LegRig };
}

/**
 * Where each limb comes out of the body, in degrees clockwise from straight up
 * -- the gaps between the rays where the sheet attaches them. The arms sit just
 * below the side rays; the legs either side of the bottom ray.
 */
export const LIMB_SOCKETS = {
  arms: { left: 247, right: 113 },
  legs: { left: 204, right: 156 },
} as const;

/** Limb geometry, in viewBox units. */
export const LIMB = {
  /** The ink outline outside the orange, matching the traced rays. */
  outline: 2.4,
  /** Half-width of an arm's hose: thick and even, like the sheet's. */
  armHalf: 5.4,
  /** Half-width at the wrist. */
  wristHalf: 4.6,
  /** Half-width of a leg's hose, and at the ankle. */
  legHalf: 6.6,
  ankleHalf: 6,
  /** The radius at which limbs are rooted: inside the body, so hidden by it. */
  socketRadius: 40,
  /** The size a shoe is drawn at, relative to its art. */
  shoeScale: 1.55,
  /** The body's rest centre in the viewBox, which feet are planted against. */
  restCentre: { x: 100, y: 100 },
} as const;

const arm = (
  hand: Vec2,
  bend: number,
  shape: HandShape,
  handRotation = 0,
  front = false,
  morph = 1,
): ArmRig => ({ shoulderDeg: 0, hand, bend, shape, handRotation, handScale: 1.5, front, morph });

const leg = (foot: Vec2, bend = 0, footRotation = 0, morph = 1): LegRig => ({
  hip: { x: 0, y: 0 },
  foot,
  bend,
  footRotation,
  morph,
});

/** A limb tucked away behind the body. */
const ARM_IN_L = arm({ x: -40, y: 18 }, 0, 'relaxed', 0, false, 0);
const ARM_IN_R = arm({ x: 40, y: 18 }, 0, 'relaxed', 0, false, 0);
const LEG_IN_L = leg({ x: -18, y: 44 }, 0, 0, 0);
const LEG_IN_R = leg({ x: 18, y: 44 }, 0, 0, 0);

const STAND = {
  left: leg({ x: -23, y: 82 }, -0.1, -4),
  right: leg({ x: 23, y: 82 }, 0.1, 4),
};

/**
 * How far the body drops to sit on the ground. A sitting pose's feet are
 * planted for a body lowered by this much; the sequences that sit move the body
 * down by it (the feet stay planted against the rest centre either way).
 */
export const SIT_DROP = 20;

/** Sitting on the ground, legs out in front, toes up (sheet: the book, the laptop). */
const SIT = {
  left: leg({ x: -44, y: 76 }, 0.35, -28),
  right: leg({ x: 44, y: 76 }, -0.35, 28),
};

/** A fist on the hip, elbow out: the sheet's spare hand in most poses. */
const HIP_L = {
  ...arm({ x: -50, y: 32 }, 0, 'fist', -100, true),
  handScale: 1.25,
  elbow: { x: -68, y: 8 },
};
const HIP_R = {
  ...arm({ x: 50, y: 32 }, 0, 'fist', -100, true),
  handScale: 1.25,
  elbow: { x: 68, y: 8 },
};
/** An arm hanging loose at the side. */
const DOWN_L = arm({ x: -52, y: 44 }, -0.35, 'relaxed', 10);
const DOWN_R = arm({ x: 52, y: 44 }, 0.35, 'relaxed', -10);

/**
 * The pose library, one entry per pose in `reference_poses.png`. Sequences
 * blend between these rather than inventing limb positions inline, so a pose
 * looks the same wherever it is used.
 */
export const LIMB_POSES = {
  /** The logo: no limbs out. */
  rest: {
    visible: true,
    arms: { left: ARM_IN_L, right: ARM_IN_R },
    legs: { left: LEG_IN_L, right: LEG_IN_R },
  },
  /** Standing on two legs, arms tucked. */
  stand: {
    visible: true,
    arms: { left: ARM_IN_L, right: ARM_IN_R },
    legs: STAND,
  },
  /** Standing easy, arms loose at the sides. */
  easy: {
    visible: true,
    arms: { left: DOWN_L, right: DOWN_R },
    legs: STAND,
  },
  /** Hands on hips, elbows out (sheet: bottom right). */
  hips: {
    visible: true,
    arms: { left: HIP_L, right: HIP_R },
    legs: STAND,
  },
  /** Waving hello, the other fist on the hip (sheet: top left). */
  wave: {
    visible: true,
    arms: {
      left: { ...arm({ x: -62, y: -34 }, 0, 'open', -6), elbow: { x: -72, y: 0 } },
      right: HIP_R,
    },
    legs: STAND,
  },
  /** Thumbs up, the other fist on the hip (sheet: top row, third). */
  thumbsUp: {
    visible: true,
    arms: {
      left: HIP_L,
      right: { ...arm({ x: 76, y: -4 }, 0, 'thumb', 10), elbow: { x: 74, y: 28 } },
    },
    legs: STAND,
  },
  /** Finger-guns, one each side (sheet: top right). */
  point: {
    visible: true,
    arms: {
      left: { ...arm({ x: -66, y: 4 }, 0, 'point', 75), elbow: { x: -58, y: 30 } },
      right: { ...arm({ x: 68, y: -4 }, 0, 'point', 75), elbow: { x: 62, y: 24 } },
    },
    legs: {
      left: leg({ x: -20, y: 82 }, -0.1, -4),
      right: leg({ x: 28, y: 78 }, 0.25, 14),
    },
  },
  /** Both fists up, cheering (sheet: second row, first). */
  cheer: {
    visible: true,
    arms: {
      left: { ...arm({ x: -58, y: -48 }, 0, 'fist', 0), elbow: { x: -74, y: -10 } },
      right: { ...arm({ x: 58, y: -48 }, 0, 'fist', 0), elbow: { x: 74, y: -10 } },
    },
    legs: {
      left: leg({ x: -30, y: 82 }, -0.15, -8),
      right: leg({ x: 30, y: 82 }, 0.15, 8),
    },
  },
  /** Hand on chin, thinking, the other on the hip (sheet: second row, second). */
  chin: {
    visible: true,
    arms: {
      left: HIP_L,
      right: arm({ x: 6, y: 40 }, 1.4, 'index', -150, true),
    },
    legs: STAND,
  },
  /** Finger up, "I've got it" (sheet: second row, third). */
  idea: {
    visible: true,
    arms: {
      left: { ...arm({ x: -60, y: -32 }, 0, 'index', 28), elbow: { x: -70, y: 2 } },
      right: HIP_R,
    },
    legs: STAND,
  },
  /** Peace sign (sheet: bottom left). */
  peace: {
    visible: true,
    arms: {
      left: { ...arm({ x: -60, y: -32 }, 0, 'peace', 28), elbow: { x: -70, y: 2 } },
      right: HIP_R,
    },
    legs: STAND,
  },
  /** Arms out, palms up: a shrug. */
  shrug: {
    visible: true,
    arms: {
      left: arm({ x: -66, y: 10 }, 0.6, 'open', -60),
      right: arm({ x: 66, y: 10 }, -0.6, 'open', 60),
    },
    legs: STAND,
  },
  /** Mid-jump, arms flung up, legs kicked out (sheet: bottom row, second). */
  jump: {
    visible: true,
    arms: {
      left: arm({ x: -70, y: -30 }, 0.35, 'open', -20),
      right: arm({ x: 70, y: -30 }, -0.35, 'open', 20),
    },
    legs: {
      left: leg({ x: -36, y: 70 }, -0.5, -24),
      right: leg({ x: 36, y: 70 }, 0.5, 24),
    },
  },
  /** Drooping: arms hang limp, knees buckle. */
  droop: {
    visible: true,
    arms: {
      left: arm({ x: -46, y: 50 }, -0.3, 'relaxed', 10),
      right: arm({ x: 46, y: 50 }, 0.3, 'relaxed', -10),
    },
    legs: {
      left: leg({ x: -20, y: 82 }, 0.45, 6),
      right: leg({ x: 20, y: 82 }, -0.45, -6),
    },
  },
  /** Sitting on the ground, legs out in front, hands at the sides. */
  sit: {
    visible: true,
    arms: { left: DOWN_L, right: DOWN_R },
    legs: SIT,
  },
  /** Holding an open book in both hands (sheet: third row, second). */
  read: {
    visible: true,
    arms: {
      left: arm({ x: -33, y: 36 }, -0.9, 'grip', 100, true),
      right: arm({ x: 33, y: 36 }, 0.9, 'grip', -100, true),
    },
    legs: SIT,
  },
  /** Typing on a laptop on the lap (sheet: third row, third). */
  type: {
    visible: true,
    arms: {
      left: arm({ x: -14, y: 48 }, -1.4, 'relaxed', 175, true),
      right: arm({ x: 18, y: 48 }, 1.4, 'relaxed', -175, true),
    },
    legs: SIT,
  },
  /** A magnifying glass held up to one eye (sheet: third row, fourth). */
  magnify: {
    visible: true,
    arms: {
      left: { ...arm({ x: -54, y: 26 }, 0, 'grip', 20, true), elbow: { x: -72, y: 40 } },
      right: arm({ x: 54, y: 26 }, -0.4, 'relaxed', -20),
    },
    legs: STAND,
  },
  /** A balloon string held out to the side (sheet: third row, first). */
  balloon: {
    visible: true,
    arms: {
      left: arm({ x: -62, y: -4 }, 0.4, 'grip', 0),
      right: arm({ x: 58, y: 24 }, -0.5, 'open', -40),
    },
    legs: {
      left: leg({ x: -26, y: 80 }, -0.25, -10),
      right: leg({ x: 24, y: 82 }, 0.15, 6),
    },
  },
  /** Reclining: hands behind the head, legs crossed (sheet: the deckchair). */
  recline: {
    visible: true,
    arms: {
      // The hands are hidden behind the head; only the elbows show, as wings.
      left: { ...arm({ x: -18, y: -30 }, -1.3, 'fist', 160), behind: true },
      right: { ...arm({ x: 18, y: -30 }, 1.3, 'fist', -160), behind: true },
    },
    legs: {
      left: leg({ x: -46, y: 50 }, 0.3, -6),
      right: leg({ x: -30, y: 58 }, -0.2, -4),
    },
  },
  /** Holding something out in one hand, the other on the hip. */
  hold: {
    visible: true,
    arms: {
      left: HIP_L,
      right: { ...arm({ x: 74, y: 10 }, 0, 'grip', 0, true), elbow: { x: 76, y: 38 } },
    },
    legs: STAND,
  },
  /** Presenting: one palm out to the side, as if to say "here it is". */
  present: {
    visible: true,
    arms: {
      left: { ...arm({ x: -72, y: -8 }, 0, 'open', 40), elbow: { x: -66, y: 20 } },
      right: HIP_R,
    },
    legs: STAND,
  },
  /** Walking: one stride (sheet: top row, second). Sequences swing it. */
  walk: {
    visible: true,
    arms: {
      left: arm({ x: -60, y: 28 }, -0.4, 'fist', 0),
      right: arm({ x: 58, y: 8 }, -0.5, 'fist', -30),
    },
    legs: {
      left: leg({ x: -34, y: 80 }, -0.3, -18),
      right: leg({ x: 26, y: 76 }, 0.45, 20),
    },
  },
} satisfies Record<string, LimbsRig>;

export type LimbPoseName = keyof typeof LIMB_POSES;

export function cloneLimbs(l: LimbsRig): LimbsRig {
  const a = (x: ArmRig): ArmRig => ({
    ...x,
    hand: { ...x.hand },
    ...(x.elbow ? { elbow: { ...x.elbow } } : {}),
  });
  const g = (x: LegRig): LegRig => ({ ...x, hip: { ...x.hip }, foot: { ...x.foot } });
  return {
    visible: l.visible,
    arms: { left: a(l.arms.left), right: a(l.arms.right) },
    legs: { left: g(l.legs.left), right: g(l.legs.right) },
  };
}

/** A pose from the library, ready to mutate. */
export function limbPose(name: LimbPoseName): LimbsRig {
  return cloneLimbs(LIMB_POSES[name]);
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixV = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
const morphOf = (m: number | undefined): number => (m === undefined ? 1 : m);

/**
 * Blend two limb poses. Hand shapes are drawings, so they swap at the midpoint
 * -- or, when one side is still a ray, the shape comes from the side that has
 * an arm, so a hand never changes while it is growing.
 */
export function blendLimbs(a: LimbsRig, b: LimbsRig, t: number): LimbsRig {
  const k = Math.min(1, Math.max(0, t));
  // The ends are exact: a sequence that hands back its weight returns to the
  // base pose itself, not to a pose that merely draws the same.
  if (k <= 0) return cloneLimbs(a);
  if (k >= 1) return cloneLimbs(b);
  const blendArm = (p: ArmRig, q: ArmRig, side: 'left' | 'right'): ArmRig => {
    const pm = morphOf(p.morph);
    const qm = morphOf(q.morph);
    // An elbow placed on either side is blended against the elbow the other
    // side's bend implies, so the arm swings rather than snapping its joint.
    const elbow =
      p.elbow || q.elbow
        ? pm < 0.01
          ? (q.elbow ?? impliedElbow(side, q))
          : qm < 0.01
            ? (p.elbow ?? impliedElbow(side, p))
            : mixV(p.elbow ?? impliedElbow(side, p), q.elbow ?? impliedElbow(side, q), k)
        : undefined;
    const shapeFrom = pm < 0.01 ? q : qm < 0.01 ? p : k < 0.5 ? p : q;
    // A change of hand shape passes through a smear: the hand pinches for the
    // middle of the blend, so the swap reads as a quick motion, not a cut.
    const changing = pm >= 0.01 && qm >= 0.01 && p.shape !== q.shape;
    const smear = changing && k > 0.3 && k < 0.7;
    return {
      shoulderDeg: mix(p.shoulderDeg, q.shoulderDeg, k),
      // A limb growing from its ray keeps aiming at its target; it does not
      // sweep across from the ray's own resting tip.
      hand: pm < 0.01 ? { ...q.hand } : qm < 0.01 ? { ...p.hand } : mixV(p.hand, q.hand, k),
      bend: pm < 0.01 ? q.bend : qm < 0.01 ? p.bend : mix(p.bend, q.bend, k),
      shape: shapeFrom.shape,
      ...(smear ? { smear: true } : {}),
      handRotation:
        pm < 0.01
          ? q.handRotation
          : qm < 0.01
            ? p.handRotation
            : mix(p.handRotation, q.handRotation, k),
      handScale:
        mix(p.handScale, q.handScale, k) * (changing ? 1 - 0.14 * Math.sin(Math.PI * k) : 1),
      front: shapeFrom.front,
      tubeFront: shapeFrom.tubeFront,
      ...(shapeFrom.behind !== undefined ? { behind: shapeFrom.behind } : {}),
      ...(elbow ? { elbow: { ...elbow } } : {}),
      morph: mix(pm, qm, k),
    };
  };
  const blendLeg = (p: LegRig, q: LegRig): LegRig => {
    const pm = morphOf(p.morph);
    const qm = morphOf(q.morph);
    return {
      hip: mixV(p.hip, q.hip, k),
      foot: pm < 0.01 ? { ...q.foot } : qm < 0.01 ? { ...p.foot } : mixV(p.foot, q.foot, k),
      bend: pm < 0.01 ? q.bend : qm < 0.01 ? p.bend : mix(p.bend, q.bend, k),
      footRotation: mix(p.footRotation, q.footRotation, k),
      morph: mix(pm, qm, k),
    };
  };
  return {
    visible: k < 1 ? a.visible : b.visible,
    arms: {
      left: blendArm(a.arms.left, b.arms.left, 'left'),
      right: blendArm(a.arms.right, b.arms.right, 'right'),
    },
    legs: { left: blendLeg(a.legs.left, b.legs.left), right: blendLeg(a.legs.right, b.legs.right) },
  };
}

// ─── drawing ─────────────────────────────────────────────────────────────────

export interface LimbPaint {
  limb: string;
  ink: string;
}

function n(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** The ray's direction (unit) for a ray rig index at its current angle. */
function rayDirection(angleDeg: number): Vec2 {
  const a = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** Where a ray's base centre sits, in the body frame. */
export function shoulderPoint(deg: number): Vec2 {
  const d = rayDirection(deg);
  return { x: d.x * RAY.baseRadius, y: d.y * RAY.baseRadius };
}

interface TubeInput {
  base: Vec2;
  /** Unit direction the ray points (outward). */
  dir: Vec2;
  /** Half-width of the ray's base. */
  baseHalf: number;
  /** Ray length from base to tip at rest. */
  rayLength: number;
  target: Vec2;
  endHalf: number;
  bend: number;
  morph: number;
  boil: number | undefined;
  /**
   * Half-width at the very end, where the tube meets a hand or shoe that is
   * wider than the wrist: the last stretch flares out to it, like a cartoon
   * rubber-hose cuff, so the two meet without a step.
   */
  flareHalf?: number;
  /** Taper exponent; defaults to the ray-to-hose taper. 1 is an even hose. */
  power?: number;
  /** A point the hose must pass through halfway along; overrides `bend`. */
  elbow?: Vec2;
}

/**
 * A rubber-hose outline from a root to its (moving) end. With a `rayLength`
 * the hose grows out of a triangle; with none it grows out of its root.
 */
export function tubePath(t: TubeInput): { d: string; end: Vec2; endDir: Vec2 } {
  const m = Math.min(1, Math.max(0, t.morph));
  const restTip = { x: t.base.x + t.dir.x * t.rayLength, y: t.base.y + t.dir.y * t.rayLength };
  // The tip travels out to the target with an ease, so the ray "pops".
  const reach = smooth(m * 1.15);
  const end = mixV(restTip, t.target, reach);
  const dx = end.x - t.base.x;
  const dy = end.y - t.base.y;
  const len = Math.hypot(dx, dy) || 1;
  const perp = { x: -dy / len, y: dx / len };
  const straight = { x: t.base.x + t.dir.x * len * 0.5, y: t.base.y + t.dir.y * len * 0.5 };
  const bowed = {
    // The bow is measured against at least a forearm's length, so a short
    // arm (a fist on the hip) can still throw its elbow well out.
    x: (t.base.x + end.x) / 2 + perp.x * t.bend * Math.max(len, 24) * 0.5,
    y: (t.base.y + end.y) / 2 + perp.y * t.bend * Math.max(len, 24) * 0.5,
  };
  // With an elbow, the control point is the one that puts the curve's middle
  // exactly on it; the elbow grows out with the arm like everything else.
  const mid = { x: (t.base.x + end.x) / 2, y: (t.base.y + end.y) / 2 };
  const elbowAt = t.elbow ? mixV(mid, t.elbow, reach) : null;
  const c = elbowAt
    ? { x: 2 * elbowAt.x - mid.x, y: 2 * elbowAt.y - mid.y }
    : mixV(straight, bowed, m);
  const endHalf = mix(0.35, t.endHalf, smooth(m * 1.4));
  // The taper: linear (a triangle) at rest, then wide at the base and quickly
  // tube-like as it grows -- a ray that has become an arm.
  const power = t.power ?? mix(1, 3.2, m);
  const N = 16;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  let endDir = { x: dx / len, y: dy / len };
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const u = 1 - s;
    const p = {
      x: u * u * t.base.x + 2 * u * s * c.x + s * s * end.x,
      y: u * u * t.base.y + 2 * u * s * c.y + s * s * end.y,
    };
    const tan = {
      x: 2 * u * (c.x - t.base.x) + 2 * s * (end.x - c.x),
      y: 2 * u * (c.y - t.base.y) + 2 * s * (end.y - c.y),
    };
    const tl = Math.hypot(tan.x, tan.y) || 1;
    const nx = -tan.y / tl;
    const ny = tan.x / tl;
    if (i === N) endDir = { x: tan.x / tl, y: tan.y / tl };
    const wobble = t.boil === undefined ? 0 : noise(i, t.boil) * 0.22;
    const flare =
      t.flareHalf !== undefined && t.flareHalf > endHalf
        ? (t.flareHalf - endHalf) * smooth((s - 0.72) / 0.28) * smooth(m * 1.2)
        : 0;
    const half = endHalf + (t.baseHalf - endHalf) * Math.pow(1 - s, power) + flare + wobble;
    left.push({ x: p.x + nx * half, y: p.y + ny * half });
    right.push({ x: p.x - nx * half, y: p.y - ny * half });
  }
  // A rounded end cap around the tip.
  const cap: Vec2[] = [];
  for (let k = 1; k < 6; k++) {
    const a = (k / 6) * Math.PI;
    const ex = Math.cos(a);
    const ey = Math.sin(a);
    const nx = -endDir.y;
    const ny = endDir.x;
    cap.push({
      x: end.x + nx * endHalf * ex + endDir.x * endHalf * ey,
      y: end.y + ny * endHalf * ex + endDir.y * endHalf * ey,
    });
  }
  const outline = [...left, ...cap, ...right.reverse()];
  return { d: smoothClosed(outline), end, endDir };
}

/** A closed Catmull-Rom curve through points, with a straight base edge. */
function smoothClosed(pts: Vec2[]): string {
  const count = pts.length;
  const at = (i: number): Vec2 => pts[(i + count) % count]!;
  const parts = [`M${n(at(0).x)} ${n(at(0).y)}`];
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    // The base edge (last point back to the first) stays straight, like the ray's.
    if (i === count - 1) {
      parts.push(`L${n(p2.x)} ${n(p2.y)}`);
      continue;
    }
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    parts.push(`C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p2.x)} ${n(p2.y)}`);
  }
  parts.push('Z');
  return parts.join('');
}

function tubeInk(d: string, paint: LimbPaint): string {
  return `<path d="${d}" fill="${paint.ink}" stroke="${paint.ink}" stroke-width="${n(LIMB.outline * 2)}" stroke-linejoin="round"/>`;
}

function tubeFill(d: string, paint: LimbPaint): string {
  return `<path d="${d}" fill="${paint.limb}"/>`;
}

const HAND_ART: Record<HandShape, HandArt> = {
  relaxed: HANDS.relaxed,
  open: HANDS.open,
  fist: HANDS.fist,
  grip: HANDS.grip,
  point: HANDS.point,
  index: HANDS.index,
  thumb: HANDS.thumb,
  peace: HANDS.peace,
};

function artInk(art: { ink: string }, paint: LimbPaint, boil: number | undefined): string {
  return `<path d="${boilPath(art.ink, boil, 0.18)}" fill="${paint.ink}"/>`;
}

function artFill(
  art: { fill: string; lines?: string },
  paint: LimbPaint,
  boil: number | undefined,
): string {
  const fill = `<path d="${boilPath(art.fill, boil, 0.18)}" fill="${paint.limb}"/>`;
  if (!art.lines) return fill;
  return fill + `<path d="${boilPath(art.lines, boil, 0.12)}" fill="${paint.ink}"/>`;
}

/**
 * A limb joined to its hand or shoe without a seam. Everything's ink goes
 * down first, then the hand's fill, then the tube's fill last: inside the
 * limb's width the tube's orange runs straight over the hand's wrist outline,
 * while outside it (a hand is wider than its wrist) the hand keeps its line.
 */
function joined(tubeD: string, endArt: string, endArtFill: string, paint: LimbPaint): string {
  return tubeInk(tubeD, paint) + endArt + endArtFill + tubeFill(tubeD, paint);
}

export interface RayLike {
  angleDeg: number;
  rotation: number;
  lengthScale: number;
  widthScale: number;
  offset: Vec2;
  visible: boolean;
}

/**
 * The elbow an arm's `bend` puts it at: the middle of its hose, for blending a
 * bent arm with one whose elbow is placed. Uses the same bow as `tubePath`.
 */
export function impliedElbow(side: 'left' | 'right', arm: ArmRig): Vec2 {
  if (arm.elbow) return { ...arm.elbow };
  const { base } = socket(LIMB_SOCKETS.arms[side]);
  const end = arm.hand;
  const dx = end.x - base.x;
  const dy = end.y - base.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = arm.bend * Math.max(len, 24) * 0.5;
  const c = {
    x: (base.x + end.x) / 2 - (dy / len) * bow,
    y: (base.y + end.y) / 2 + (dx / len) * bow,
  };
  return { x: (base.x + 2 * c.x + end.x) / 4, y: (base.y + 2 * c.y + end.y) / 4 };
}

/** A socket on the body: the root point and the direction a limb leaves it. */
function socket(deg: number): { base: Vec2; dir: Vec2 } {
  const dir = rayDirection(deg);
  return { base: { x: dir.x * LIMB.socketRadius, y: dir.y * LIMB.socketRadius }, dir };
}

/**
 * One arm, split for layering: the tube (drawn behind the body, since it comes
 * out of the body's side) and the hand (in front of the body when the pose puts
 * it there -- a fist on the hip, a hand under the chin). Empty strings when the
 * arm is tucked away.
 *
 * `rays` is accepted for compatibility with the ray-morph renderer and unused:
 * an arm no longer moves with a ray.
 */
export function armParts(
  armRig: ArmRig,
  side: 'left' | 'right',
  _rays: readonly RayLike[],
  paint: LimbPaint,
  boil: number | undefined,
): { tube: string; hand: string } {
  return armMarkupSplit(armRig, side, paint, boil);
}

/** One arm as a single string (tube then hand). */
export function armMarkup(
  armRig: ArmRig,
  side: 'left' | 'right',
  _rays: readonly RayLike[],
  paint: LimbPaint,
  boil: number | undefined,
): string {
  const { tube, hand } = armMarkupSplit(armRig, side, paint, boil);
  return tube + hand;
}

function armMarkupSplit(
  armRig: ArmRig,
  side: 'left' | 'right',
  paint: LimbPaint,
  boil: number | undefined,
): { tube: string; hand: string } {
  const m = morphOf(armRig.morph);
  if (m < 0.02) return { tube: '', hand: '' };
  const { base, dir } = socket(LIMB_SOCKETS.arms[side]);
  const art = armRig.smear ? SMEAR : HAND_ART[armRig.shape];
  const tube = tubePath({
    base,
    dir,
    baseHalf: LIMB.armHalf,
    rayLength: 0,
    target: armRig.hand,
    endHalf: LIMB.wristHalf,
    // Flare to just inside the hand's own wrist, so the hand stays a touch wider.
    flareHalf: Math.min(art.joint * armRig.handScale * 0.5, LIMB.wristHalf * 1.4),
    bend: armRig.bend,
    ...(armRig.elbow ? { elbow: armRig.elbow } : {}),
    morph: m,
    boil,
    power: 1,
  });
  const growth = smooth((m - 0.3) / 0.7);
  if (growth > 0.01) {
    const follow = (Math.atan2(tube.endDir.x, -tube.endDir.y) * 180) / Math.PI;
    const mirror = side === 'left';
    const rotation = follow + (mirror ? -armRig.handRotation : armRig.handRotation);
    const s = armRig.handScale * growth;
    // The wrist sits a touch inside the tube's end so the two merge.
    const back = LIMB.wristHalf * 0.6;
    const wrist = { x: tube.end.x - tube.endDir.x * back, y: tube.end.y - tube.endDir.y * back };
    const place = `<g transform="translate(${n(wrist.x)} ${n(wrist.y)}) rotate(${n(rotation)}) scale(${n(mirror ? -s : s)} ${n(s)})">`;
    const ink = place + artInk(art, paint, boil) + '</g>';
    const fill = place + artFill(art, paint, boil) + '</g>';
    // A hand only comes in front of the body once its arm is (nearly) out:
    // while growing or tucking away it travels behind with its tube, so a
    // retracting fist never floats across the face.
    const inFront = armRig.front && m >= 0.85;
    if (inFront && armRig.tubeFront) {
      // The whole arm crosses in front of the body.
      return { tube: '', hand: joined(tube.d, ink, fill, paint) };
    }
    if (inFront) {
      // The hand sits over the body while its arm passes behind it, so the
      // hand is drawn whole, its wrist line included.
      return { tube: tubeInk(tube.d, paint) + tubeFill(tube.d, paint), hand: ink + fill };
    }
    return { tube: joined(tube.d, ink, fill, paint), hand: '' };
  }
  return { tube: tubeInk(tube.d, paint) + tubeFill(tube.d, paint), hand: '' };
}

/**
 * One leg, in the viewBox frame: it comes out of its socket on the body
 * (mapped through the body's transform by `toViewBox`) and ends at a shoe
 * planted relative to the body's rest centre.
 */
export function legMarkup(
  legRig: LegRig,
  side: 'left' | 'right',
  _rays: readonly RayLike[],
  toViewBox: (p: Vec2) => Vec2,
  scale: number,
  paint: LimbPaint,
  boil: number | undefined,
): string {
  const m = morphOf(legRig.morph);
  if (m < 0.02) return '';
  const local = socket(LIMB_SOCKETS.legs[side]);
  const base = toViewBox(local.base);
  const ahead = toViewBox({ x: local.base.x + local.dir.x, y: local.base.y + local.dir.y });
  const dl = Math.hypot(ahead.x - base.x, ahead.y - base.y) || 1;
  const dir = { x: (ahead.x - base.x) / dl, y: (ahead.y - base.y) / dl };
  const foot = {
    x: LIMB.restCentre.x + legRig.foot.x,
    y: LIMB.restCentre.y + legRig.foot.y,
  };
  const tube = tubePath({
    base,
    dir,
    baseHalf: LIMB.legHalf * scale,
    rayLength: 0,
    target: foot,
    endHalf: LIMB.ankleHalf,
    flareHalf: HANDS.shoe.joint * LIMB.shoeScale * 0.5,
    bend: legRig.bend,
    morph: m,
    boil,
    power: 1,
  });
  const growth = smooth((m - 0.3) / 0.7);
  if (growth > 0.01) {
    const mirror = side === 'left';
    const s = LIMB.shoeScale * growth;
    const place = `<g transform="translate(${n(tube.end.x)} ${n(tube.end.y)}) scale(${n(mirror ? -s : s)} ${n(s)}) rotate(${n(legRig.footRotation)})">`;
    return joined(
      tube.d,
      place + artInk(HANDS.shoe, paint, boil) + '</g>',
      place + artFill(HANDS.shoe, paint, boil) + '</g>',
      paint,
    );
  }
  return tubeInk(tube.d, paint) + tubeFill(tube.d, paint);
}

/**
 * The ray indices a rig's limbs have taken over. Always none: limbs come out
 * between the rays, so every ray is drawn. Kept for callers of the old API.
 */
export function limbRayIndices(_limbs: LimbsRig): number[] {
  return [];
}
