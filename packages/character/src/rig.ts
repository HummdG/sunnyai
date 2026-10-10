// The Sunny rig: a plain, serialisable description of the character's pose.
//
// Everything the character can do is expressed as numbers in this structure, so
// poses can be recorded, diffed, unit-tested and interpolated. The renderer
// (`render.ts`) is a pure function of a rig, which is what makes deterministic
// replay and screenshot testing possible.
//
// Face coordinates are the body's local frame: the origin is the centre of the
// body, +x is right and +y is DOWN (matching SVG). The values in `defaultRig()`
// are measurements of the reference artwork, so that pose reproduces it exactly.

import { RAY } from './geometry.js';
import { SUNNY_THEME, type SunnyTheme } from './tokens.js';

export interface Vec2 {
  x: number;
  y: number;
}

export interface EyeRig {
  /** Centre of the eye within the face frame. */
  x: number;
  y: number;
  /** Tilt of the eye in degrees, clockwise. */
  rotation: number;
  /** Width and height of the eye opening, before rotation. */
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  /** 0 = wide open, 1 = fully closed (a blink). */
  closed: number;
  /** Gaze offset, each axis in -1..1. Moves the highlight for eye-tracking. */
  gaze: Vec2;
}

export interface BrowRig {
  /** Centre of the brow within the face frame. */
  x: number;
  y: number;
  rotation: number;
  /** Chord length of the brow stroke. */
  length: number;
  /** How far the brow bows upward from its chord. */
  arch: number;
  scale: number;
}

export interface SmileRig {
  /** Midpoint of the smile's chord within the face frame. */
  x: number;
  y: number;
  /** Chord angle in degrees, clockwise. */
  rotation: number;
  /** Chord length, end to end. */
  span: number;
  /** Depth of the arc below the chord; negative turns the smile into a frown. */
  depth: number;
  strokeWidth: number;
}

export interface RayRig {
  /** Absolute angle in degrees, clockwise from straight up. */
  angleDeg: number;
  /** 1 = canonical length; 0 collapses the ray into the body. */
  lengthScale: number;
  /** 1 = canonical base width. */
  widthScale: number;
  /** Extra rotation about the body centre (rays can "spin"). */
  rotation: number;
  /** Radial/planar offset, used for arm morphs and wobble. */
  offset: Vec2;
  visible: boolean;
}

/**
 * Props Sunny can hold, wear or conjure. The list is closed and small on
 * purpose: every member is artwork this package draws, so a sequence can never
 * ask for a prop that does not exist and no caller can inject arbitrary content
 * into the scene.
 */
export const PROP_IDS = [
  'question-mark',
  'sparkle',
  'sweat-drop',
  'battery',
  'sunglasses',
  'deckchair',
] as const;
export type PropId = (typeof PROP_IDS)[number];

export interface PropRig {
  id: PropId;
  /** Centre of the prop in body-local coordinates, like the rays. */
  x: number;
  y: number;
  rotation: number;
  scale: number;
  /** 0 = invisible. Sequences fade props rather than popping them in and out. */
  opacity: number;
}

export interface SunnyRig {
  /** Root position within the viewBox. */
  x: number;
  y: number;
  /** Root rotation in degrees, clockwise. */
  rotation: number;
  /** Uniform scale. */
  scale: number;
  /** Vertical squash; 0 = none, positive flattens (impacts, landings). */
  squash: number;
  /** Horizontal bulge, the partner of `squash`. */
  stretch: number;
  /**
   * Rotation of the whole face group about the body centre, in degrees. The
   * reference face's own asymmetry is baked into the element positions, so this
   * is zero at rest and exists for animation (head tilts, gestures).
   */
  faceTilt: number;
  eyes: { left: EyeRig; right: EyeRig };
  brows: { left: BrowRig; right: BrowRig };
  smile: SmileRig;
  rays: RayRig[];
  /**
   * Props currently in the scene. Empty at rest.
   *
   * A prop exists only because a sequence put it in this list, and every
   * sequence derives its output from the caller's base rig rather than mutating
   * one. So a prop cannot outlive the sequence that introduced it -- the
   * "cleaned up" property the animation contract asks for holds by construction
   * rather than by remembering to write a cleanup callback.
   */
  props: PropRig[];
  theme: SunnyTheme;
}

/** Build the canonical ring of eight rays. */
export function createRays(): RayRig[] {
  return RAY.anglesDeg.map((angleDeg) => ({
    angleDeg,
    lengthScale: 1,
    widthScale: 1,
    rotation: 0,
    offset: { x: 0, y: 0 },
    visible: true,
  }));
}

const eye = (x: number, y: number, rotation: number, width: number, height: number): EyeRig => ({
  x,
  y,
  rotation,
  width,
  height,
  scaleX: 1,
  scaleY: 1,
  closed: 0,
  gaze: { x: 0, y: 0 },
});

const brow = (x: number, y: number, rotation: number, length: number, arch: number): BrowRig => ({
  x,
  y,
  rotation,
  length,
  arch,
  scale: 1,
});

/**
 * The canonical pose, matching the supplied reference artwork. This is the pose
 * the character must return to exactly after any animation.
 *
 * Every number here is a measurement; see docs/design/character-reference.md.
 * Note how asymmetric the reference is: the left eye is longer and stands
 * almost upright while the right is shorter and leans a further 13 degrees,
 * the left brow is a long steep arc while the right is short and nearly level,
 * and the smile rises far more on its right. That asymmetry is the character;
 * do not "tidy" it away.
 *
 * The eye tilts and sizes below were originally transposed onto the wrong eye:
 * the lean and the small size were authored onto the left eye, which is the
 * opposite of what `scripts/compare-reference.py` measures on the reference
 * (long axes +89.6 and +76.6 degrees; ours rendered +76.5 and +85.4, and the
 * left eye came out ~13% too short). Re-check any change here with that script
 * rather than by eye -- the transposition survived review precisely because a
 * leaning eye on either side looks plausible in isolation.
 */
export function defaultRig(): SunnyRig {
  return {
    x: 100,
    y: 100,
    rotation: 0,
    scale: 1,
    squash: 0,
    stretch: 0,
    faceTilt: 0,
    eyes: {
      // Reference long axes are +89.6 and +76.6 degrees, and the renderer maps
      // `rotation` to an axis of 90 + rotation, so the tilts are -0.4 and -13.4.
      // Sizes are the measured extents: the reported major/minor lengths run
      // ~2.65 units larger than the opening itself (that is the outline stroke
      // and the black crescent, which are part of the ink mask), and the offset
      // was confirmed against all four of the reference's eye measurements.
      left: eye(-14.0, -1.9, -0.4, 21.8, 36.6),
      right: eye(17.6, -8.3, -13.4, 18.6, 30.5),
    },
    brows: {
      left: brow(-20.8, -23.0, -36.7, 12.5, 4.3),
      right: brow(12.3, -30.5, -5.9, 9.1, 2.5),
    },
    smile: {
      x: 5.1,
      y: 15.2,
      rotation: -14.6,
      span: 46.6,
      depth: 7.531,
      strokeWidth: 4.0,
    },
    rays: createRays(),
    props: [],
    theme: { ...SUNNY_THEME },
  };
}

/** Deep-copy a rig so poses can be mutated without aliasing the default. */
export function cloneRig(rig: SunnyRig): SunnyRig {
  return {
    ...rig,
    eyes: {
      left: { ...rig.eyes.left, gaze: { ...rig.eyes.left.gaze } },
      right: { ...rig.eyes.right, gaze: { ...rig.eyes.right.gaze } },
    },
    brows: { left: { ...rig.brows.left }, right: { ...rig.brows.right } },
    smile: { ...rig.smile },
    rays: rig.rays.map((r) => ({ ...r, offset: { ...r.offset } })),
    props: rig.props.map((p) => ({ ...p })),
    theme: { ...rig.theme },
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Interpolate between two rigs. Used by the animation engine to blend poses and
 * to guarantee a clean return to the default pose. `t` is clamped to 0..1.
 */
export function lerpRig(a: SunnyRig, b: SunnyRig, t: number): SunnyRig {
  const k = clamp01(t);
  const n = (p: number, q: number) => lerp(p, q, k);
  const eyeBlend = (p: EyeRig, q: EyeRig): EyeRig => ({
    x: n(p.x, q.x),
    y: n(p.y, q.y),
    rotation: n(p.rotation, q.rotation),
    width: n(p.width, q.width),
    height: n(p.height, q.height),
    scaleX: n(p.scaleX, q.scaleX),
    scaleY: n(p.scaleY, q.scaleY),
    closed: n(p.closed, q.closed),
    gaze: { x: n(p.gaze.x, q.gaze.x), y: n(p.gaze.y, q.gaze.y) },
  });
  const browBlend = (p: BrowRig, q: BrowRig): BrowRig => ({
    x: n(p.x, q.x),
    y: n(p.y, q.y),
    rotation: n(p.rotation, q.rotation),
    length: n(p.length, q.length),
    arch: n(p.arch, q.arch),
    scale: n(p.scale, q.scale),
  });
  return {
    x: n(a.x, b.x),
    y: n(a.y, b.y),
    rotation: n(a.rotation, b.rotation),
    scale: n(a.scale, b.scale),
    squash: n(a.squash, b.squash),
    stretch: n(a.stretch, b.stretch),
    faceTilt: n(a.faceTilt, b.faceTilt),
    eyes: { left: eyeBlend(a.eyes.left, b.eyes.left), right: eyeBlend(a.eyes.right, b.eyes.right) },
    brows: {
      left: browBlend(a.brows.left, b.brows.left),
      right: browBlend(a.brows.right, b.brows.right),
    },
    smile: {
      x: n(a.smile.x, b.smile.x),
      y: n(a.smile.y, b.smile.y),
      rotation: n(a.smile.rotation, b.smile.rotation),
      span: n(a.smile.span, b.smile.span),
      depth: n(a.smile.depth, b.smile.depth),
      strokeWidth: n(a.smile.strokeWidth, b.smile.strokeWidth),
    },
    rays: a.rays.map((ra, i) => {
      const rb = b.rays[i] ?? ra;
      return {
        angleDeg: n(ra.angleDeg, rb.angleDeg),
        lengthScale: n(ra.lengthScale, rb.lengthScale),
        widthScale: n(ra.widthScale, rb.widthScale),
        rotation: n(ra.rotation, rb.rotation),
        offset: { x: n(ra.offset.x, rb.offset.x), y: n(ra.offset.y, rb.offset.y) },
        visible: k < 1 ? ra.visible : rb.visible,
      };
    }),
    // Props blend by position. A prop present in only one of the two rigs is
    // treated as fully transparent at the other end, so it fades instead of
    // appearing or vanishing mid-blend.
    props: blendProps(a.props, b.props, k, n),
    theme: k < 1 ? { ...a.theme } : { ...b.theme },
  };
}

function blendProps(
  a: readonly PropRig[],
  b: readonly PropRig[],
  k: number,
  n: (p: number, q: number) => number,
): PropRig[] {
  const count = Math.max(a.length, b.length);
  const out: PropRig[] = [];
  for (let i = 0; i < count; i++) {
    const p = a[i];
    const q = b[i];
    if (p && q) {
      out.push({
        id: k < 0.5 ? p.id : q.id,
        x: n(p.x, q.x),
        y: n(p.y, q.y),
        rotation: n(p.rotation, q.rotation),
        scale: n(p.scale, q.scale),
        opacity: n(p.opacity, q.opacity),
      });
    } else if (p) {
      out.push({ ...p, opacity: p.opacity * (1 - k) });
    } else if (q) {
      out.push({ ...q, opacity: q.opacity * k });
    }
  }
  return out;
}
