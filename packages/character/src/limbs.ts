/**
 * Sunny's rubber-hose limbs: the rays themselves become the arms and legs.
 *
 * The owner's direction (2026-10-12): limbs must not sprout from the body
 * circle -- the triangle rays morph into them. The side rays (the ones at
 * ~268.5° and ~91.5°) become the arms and the two lower rays (~228.5° and
 * ~131.5°) become the legs; the top rays and the bottom ray stay triangles,
 * so a standing Sunny keeps a ray between the legs as in `reference_poses.png`.
 *
 * Each limb has a `morph` from 0 to 1:
 *
 * - 0 — the limb IS its ray: nothing extra is drawn and the traced triangle is
 *   shown, so the rest pose is pixel-identical to `sunny.png`;
 * - in between — the triangle's base stays where the ray sits (the detached
 *   gap is kept), its tip stretches and bends into a tapering rubber hose, and
 *   the hand or shoe grows out of the tip;
 * - 1 — a full arm with a traced mitten hand, or a leg with a traced shoe.
 *
 * Arms live in the body frame. Legs start on the body (their ray) but their
 * feet are planted relative to the body's REST position, so when Sunny bobs or
 * squashes the legs stretch like rubber instead of the feet floating.
 */

import { boilPath, noise } from './boil.js';
import { RAY } from './geometry.js';
import { TRACED_HANDS } from './traced-hands.js';

interface Vec2 {
  x: number;
  y: number;
}

export const HAND_SHAPES = ['relaxed', 'open', 'fist', 'point', 'thumb', 'peace'] as const;
export type HandShape = (typeof HAND_SHAPES)[number];

export interface ArmRig {
  /**
   * Kept for compatibility; the arm now always grows from its ray (see
   * `LIMB_RAYS`), so this is ignored.
   */
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
  /** 0 = the arm is still its triangle ray; 1 = a full arm. Defaults to 1. */
  morph?: number;
  /**
   * Draw the whole arm, tube included, in front of the body -- for a pose
   * whose arm crosses in front (a hand on the chin), instead of passing behind.
   */
  tubeFront?: boolean;
}

export interface LegRig {
  /** Kept for compatibility; legs now grow from their rays (`LIMB_RAYS`). */
  hip: Vec2;
  /** The ankle, relative to the body's REST centre (so feet stay planted). */
  foot: Vec2;
  bend: number;
  /** Shoe tilt in degrees; the toe points outward at 0. */
  footRotation: number;
  /** 0 = the leg is still its triangle ray; 1 = a full leg. Defaults to 1. */
  morph?: number;
}

export interface LimbsRig {
  visible: boolean;
  arms: { left: ArmRig; right: ArmRig };
  legs: { left: LegRig; right: LegRig };
}

/** Which ray each limb grows from (indices into `RAY.anglesDeg`). */
export const LIMB_RAYS = {
  arms: { left: 6, right: 2 },
  legs: { left: 5, right: 3 },
} as const;

/** Limb geometry, in viewBox units. */
export const LIMB = {
  /** The ink outline outside the orange, matching the traced rays. */
  outline: 2.4,
  /** Half-width at the wrist and the ankle when fully morphed. */
  wristHalf: 4.8,
  ankleHalf: 5.6,
  /** Retained for older callers; the tube is now tapered (see `tubePath`). */
  fill: 7,
  ink: 11.4,
  shoulderRadius: 50,
  /** How far a grown limb's root tucks inside the body, hiding the ray's base corners. */
  rootInset: 9,
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

/** A limb that is still its ray. */
const ARM_RAY_L = arm({ x: -70, y: 2 }, 0, 'open', 0, false, 0);
const ARM_RAY_R = arm({ x: 70, y: 2 }, 0, 'open', 0, false, 0);
const LEG_RAY_L = leg({ x: -40, y: 60 }, 0, 0, 0);
const LEG_RAY_R = leg({ x: 40, y: 60 }, 0, 0, 0);

const STAND = {
  left: leg({ x: -24, y: 86 }, -0.12),
  right: leg({ x: 24, y: 86 }, 0.12),
};

/**
 * The pose library, one entry per pose in `reference_poses.png`. Sequences
 * blend between these rather than inventing limb positions inline, so a pose
 * looks the same wherever it is used. Only the rays a pose needs are morphed.
 */
export const LIMB_POSES = {
  /** The logo: every limb is still its ray. */
  rest: {
    visible: true,
    arms: { left: ARM_RAY_L, right: ARM_RAY_R },
    legs: { left: LEG_RAY_L, right: LEG_RAY_R },
  },
  /** Standing on two legs, arms still rays. */
  stand: {
    visible: true,
    arms: { left: ARM_RAY_L, right: ARM_RAY_R },
    legs: STAND,
  },
  /** Hands on hips, elbows out (sheet: bottom right). */
  hips: {
    visible: true,
    arms: {
      left: arm({ x: -54, y: 34 }, 2.2, 'fist', 0, true),
      right: arm({ x: 54, y: 34 }, -2.2, 'fist', 0, true),
    },
    legs: STAND,
  },
  /** Waving hello (sheet: top left). */
  wave: {
    visible: true,
    arms: {
      left: arm({ x: -66, y: -34 }, 0.35, 'open', -10),
      right: ARM_RAY_R,
    },
    legs: STAND,
  },
  /** Thumbs up (sheet: top row, third). */
  thumbsUp: {
    visible: true,
    arms: {
      left: ARM_RAY_L,
      right: arm({ x: 70, y: -14 }, -0.35, 'thumb', 30),
    },
    legs: STAND,
  },
  /** Pointing off to the side (sheet: top right). */
  point: {
    visible: true,
    arms: {
      left: ARM_RAY_L,
      right: arm({ x: 60, y: -2 }, -0.1, 'point', 0),
    },
    legs: STAND,
  },
  /** Both fists up, cheering (sheet: second row, first). */
  cheer: {
    visible: true,
    arms: {
      left: arm({ x: -60, y: -46 }, 0.3, 'fist', 0),
      right: arm({ x: 60, y: -46 }, -0.3, 'fist', 0),
    },
    legs: {
      left: leg({ x: -30, y: 86 }, -0.1),
      right: leg({ x: 30, y: 86 }, 0.1),
    },
  },
  /** Hand on chin, thinking (sheet: second row, second). */
  chin: {
    visible: true,
    arms: {
      left: ARM_RAY_L,
      right: arm({ x: 4, y: 44 }, 1.1, 'fist', 70, true),
    },
    legs: STAND,
  },
  /** Finger up, "I've got it" (sheet: second row, third). */
  idea: {
    visible: true,
    arms: {
      left: arm({ x: -62, y: -38 }, 0.3, 'point', -35),
      right: ARM_RAY_R,
    },
    legs: STAND,
  },
  /** Peace sign (sheet: bottom left). */
  peace: {
    visible: true,
    arms: {
      left: arm({ x: -64, y: -34 }, 0.3, 'peace', -35),
      right: ARM_RAY_R,
    },
    legs: STAND,
  },
  /** Arms out, palms up: a shrug. */
  shrug: {
    visible: true,
    arms: {
      left: arm({ x: -72, y: 8 }, 0.45, 'open', -55),
      right: arm({ x: 72, y: 8 }, -0.45, 'open', 55),
    },
    legs: STAND,
  },
  /** Mid-jump, arms flung up, legs tucked (sheet: bottom row, second). */
  jump: {
    visible: true,
    arms: {
      left: arm({ x: -74, y: -34 }, 0.25, 'open', -15),
      right: arm({ x: 74, y: -34 }, -0.25, 'open', 15),
    },
    legs: {
      left: leg({ x: -34, y: 64 }, -0.5, -20),
      right: leg({ x: 34, y: 64 }, 0.5, 20),
    },
  },
  /** Drooping: arms hang limp, knees buckle. */
  droop: {
    visible: true,
    arms: {
      left: arm({ x: -52, y: 54 }, -0.25, 'relaxed', 0),
      right: arm({ x: 52, y: 54 }, 0.25, 'relaxed', 0),
    },
    legs: {
      left: leg({ x: -26, y: 86 }, 0.4),
      right: leg({ x: 26, y: 86 }, -0.4),
    },
  },
} satisfies Record<string, LimbsRig>;

export type LimbPoseName = keyof typeof LIMB_POSES;

export function cloneLimbs(l: LimbsRig): LimbsRig {
  const a = (x: ArmRig): ArmRig => ({ ...x, hand: { ...x.hand } });
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
  const blendArm = (p: ArmRig, q: ArmRig): ArmRig => {
    const pm = morphOf(p.morph);
    const qm = morphOf(q.morph);
    const shapeFrom = pm < 0.01 ? q : qm < 0.01 ? p : k < 0.5 ? p : q;
    return {
      shoulderDeg: mix(p.shoulderDeg, q.shoulderDeg, k),
      // A limb growing from its ray keeps aiming at its target; it does not
      // sweep across from the ray's own resting tip.
      hand: pm < 0.01 ? { ...q.hand } : qm < 0.01 ? { ...p.hand } : mixV(p.hand, q.hand, k),
      bend: pm < 0.01 ? q.bend : qm < 0.01 ? p.bend : mix(p.bend, q.bend, k),
      shape: shapeFrom.shape,
      handRotation:
        pm < 0.01
          ? q.handRotation
          : qm < 0.01
            ? p.handRotation
            : mix(p.handRotation, q.handRotation, k),
      handScale: mix(p.handScale, q.handScale, k),
      front: shapeFrom.front,
      tubeFront: shapeFrom.tubeFront,
      ...(shapeFrom.behind !== undefined ? { behind: shapeFrom.behind } : {}),
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
      left: blendArm(a.arms.left, b.arms.left),
      right: blendArm(a.arms.right, b.arms.right),
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
}

/**
 * A ray growing into a limb: a tapered rubber-hose outline from the ray's base
 * to its (moving) tip. At morph 0 the outline is the ray's own triangle.
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
    x: (t.base.x + end.x) / 2 + perp.x * t.bend * len * 0.5,
    y: (t.base.y + end.y) / 2 + perp.y * t.bend * len * 0.5,
  };
  const c = mixV(straight, bowed, m);
  const endHalf = mix(0.35, t.endHalf, smooth(m * 1.4));
  // The taper: linear (a triangle) at rest, then wide at the base and quickly
  // tube-like as it grows -- a ray that has become an arm.
  const power = mix(1, 3.2, m);
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

const HAND_ART: Record<HandShape, keyof typeof TRACED_HANDS> = {
  relaxed: 'open',
  open: 'open',
  fist: 'fist',
  point: 'point',
  thumb: 'thumb',
  peace: 'peace',
};

function artInk(art: { ink: string }, paint: LimbPaint, boil: number | undefined): string {
  return `<path d="${boilPath(art.ink, boil, 0.18)}" fill="${paint.ink}"/>`;
}

function artFill(art: { fill: string }, paint: LimbPaint, boil: number | undefined): string {
  return `<path d="${boilPath(art.fill, boil, 0.18)}" fill="${paint.limb}"/>`;
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

/** The ray rotation and base for a limb, as the rig has moved its ray. */
function rayOf(rays: readonly RayLike[], index: number): RayLike {
  return (
    rays[index] ?? {
      angleDeg: RAY.anglesDeg[index] ?? 0,
      rotation: 0,
      lengthScale: 1,
      widthScale: 1,
      offset: { x: 0, y: 0 },
      visible: true,
    }
  );
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
 * One arm, split for layering: the tube (always drawn behind the body, since
 * it grows from a ray) and the hand (in front of the body when the pose puts
 * it there -- a fist on the hip, a hand under the chin). Empty strings when the
 * arm is still its ray.
 */
export function armParts(
  armRig: ArmRig,
  side: 'left' | 'right',
  rays: readonly RayLike[],
  paint: LimbPaint,
  boil: number | undefined,
): { tube: string; hand: string } {
  const whole = armMarkupSplit(armRig, side, rays, paint, boil);
  return whole;
}

/** One arm as a single string (tube then hand). */
export function armMarkup(
  armRig: ArmRig,
  side: 'left' | 'right',
  rays: readonly RayLike[],
  paint: LimbPaint,
  boil: number | undefined,
): string {
  const { tube, hand } = armMarkupSplit(armRig, side, rays, paint, boil);
  return tube + hand;
}

function armMarkupSplit(
  armRig: ArmRig,
  side: 'left' | 'right',
  rays: readonly RayLike[],
  paint: LimbPaint,
  boil: number | undefined,
): { tube: string; hand: string } {
  const m = morphOf(armRig.morph);
  if (m < 0.02) return { tube: '', hand: '' };
  const ray = rayOf(rays, LIMB_RAYS.arms[side]);
  const dir = rayDirection(ray.angleDeg + ray.rotation);
  // As the ray becomes an arm its base slides a little inside the body (which
  // is drawn over it), so the ray's wide base corners never show as flanges at
  // the shoulder. At morph 0 it sits exactly where the ray does.
  const inset = LIMB.rootInset * smooth(m * 2);
  const base = {
    x: dir.x * (RAY.baseRadius - inset) + ray.offset.x,
    y: dir.y * (RAY.baseRadius - inset) + ray.offset.y,
  };
  const tube = tubePath({
    base,
    dir,
    baseHalf: RAY.baseHalfWidth * ray.widthScale,
    rayLength: (RAY.tipRadius - RAY.baseRadius) * ray.lengthScale,
    target: armRig.hand,
    endHalf: LIMB.wristHalf,
    // Flare to just inside the hand's own wrist, so the hand stays a touch wider.
    flareHalf: Math.min(
      TRACED_HANDS[HAND_ART[armRig.shape]].joint * armRig.handScale * 0.78,
      LIMB.wristHalf * 1.9,
    ),
    bend: armRig.bend,
    morph: m,
    boil,
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
    const art = TRACED_HANDS[HAND_ART[armRig.shape]];
    const ink = place + artInk(art, paint, boil) + '</g>';
    const fill = place + artFill(art, paint, boil) + '</g>';
    // A hand only comes in front of the body once its arm has (nearly) grown:
    // while growing or retracting it travels behind with its tube, so a
    // shrinking fist never floats across the face on its way back to a ray.
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
 * One leg, in the viewBox frame: it grows from its ray on the body (mapped
 * through the body's transform by `toViewBox`) to a foot planted relative to
 * the body's rest centre.
 */
export function legMarkup(
  legRig: LegRig,
  side: 'left' | 'right',
  rays: readonly RayLike[],
  toViewBox: (p: Vec2) => Vec2,
  scale: number,
  paint: LimbPaint,
  boil: number | undefined,
): string {
  const m = morphOf(legRig.morph);
  if (m < 0.02) return '';
  const ray = rayOf(rays, LIMB_RAYS.legs[side]);
  const dirLocal = rayDirection(ray.angleDeg + ray.rotation);
  const inset = LIMB.rootInset * smooth(m * 2);
  const baseLocal = {
    x: dirLocal.x * (RAY.baseRadius - inset) + ray.offset.x,
    y: dirLocal.y * (RAY.baseRadius - inset) + ray.offset.y,
  };
  const base = toViewBox(baseLocal);
  const ahead = toViewBox({ x: baseLocal.x + dirLocal.x, y: baseLocal.y + dirLocal.y });
  const dl = Math.hypot(ahead.x - base.x, ahead.y - base.y) || 1;
  const dir = { x: (ahead.x - base.x) / dl, y: (ahead.y - base.y) / dl };
  const foot = {
    x: LIMB.restCentre.x + legRig.foot.x,
    y: LIMB.restCentre.y + legRig.foot.y,
  };
  const tube = tubePath({
    base,
    dir,
    baseHalf: RAY.baseHalfWidth * ray.widthScale * scale,
    rayLength: (RAY.tipRadius - RAY.baseRadius) * ray.lengthScale * scale,
    target: foot,
    endHalf: LIMB.ankleHalf,
    flareHalf: TRACED_HANDS.shoe.joint * 1.65 * 1.05,
    bend: legRig.bend,
    morph: m,
    boil,
  });
  const growth = smooth((m - 0.3) / 0.7);
  if (growth > 0.01) {
    const mirror = side === 'left';
    const s = 1.65 * growth;
    const place = `<g transform="translate(${n(tube.end.x)} ${n(tube.end.y)}) scale(${n(mirror ? -s : s)} ${n(s)}) rotate(${n(legRig.footRotation)}) translate(-1.5 -1)">`;
    return joined(
      tube.d,
      place + artInk(TRACED_HANDS.shoe, paint, boil) + '</g>',
      place + artFill(TRACED_HANDS.shoe, paint, boil) + '</g>',
      paint,
    );
  }
  return tubeInk(tube.d, paint) + tubeFill(tube.d, paint);
}

/** The ray indices a rig's limbs have taken over (not drawn as triangles). */
export function limbRayIndices(limbs: LimbsRig): number[] {
  if (!limbs.visible) return [];
  const out: number[] = [];
  if (morphOf(limbs.arms.left.morph) >= 0.02) out.push(LIMB_RAYS.arms.left);
  if (morphOf(limbs.arms.right.morph) >= 0.02) out.push(LIMB_RAYS.arms.right);
  if (morphOf(limbs.legs.left.morph) >= 0.02) out.push(LIMB_RAYS.legs.left);
  if (morphOf(limbs.legs.right.morph) >= 0.02) out.push(LIMB_RAYS.legs.right);
  return out;
}
