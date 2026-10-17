import { type EyeRig, type MouthShape, type SunnyRig } from '@sunny/character';

import type { Sequence } from './types.js';

/**
 * The face rules every sequence plays by, applied to its output.
 *
 * Sequences were written when Sunny had one mouth and one way to shut an eye:
 * a bigger feeling was a deeper smile, and a squint was the traced eye squashed
 * part-way. Both looked wrong at the extremes -- the deep smile stretched its
 * own ink into a grimace, and a held half-lid read as a leer -- and the owner
 * called the result creepy. Rather than trust forty sequences to each remember
 * that, the rule is enforced once, here:
 *
 * - **A bigger smile is a different mouth.** Past `OPEN_AT` the mouth becomes
 *   the next one up (`JOY_UP`) and goes back to its own depth, so joy reads as
 *   an open smile or a laugh, drawn, instead of a stretch.
 * - **A flattened or inverted smile is the drawn flat line or frown.**
 * - **Eyes are open or shut, never half.** A lid past `SHUT_AT` is a closed eye
 *   drawn as an arc, and a lid short of it is simply open. A blink is the lid
 *   line (`shut`: open, shut, open, on twos); a wink, or eyes shut under an open
 *   smile, is the `happy` arch; and a squint made by squashing the eye is the
 *   happy arch too, since that is what it was trying to be.
 */
export const OPEN_AT = 1.22;
export const LAUGH_AT = 1.5;
/** The deepest a mouth with no bigger drawing above it is ever pulled. */
const DEEPEST = 1.12;
export const SHUT_AT = 0.5;
/** An eye squashed below this share of its height is shut, not squinting. */
export const SQUINT_AT = 0.72;

/** The next mouth up, for when a smile is pushed past `OPEN_AT`. */
const JOY_UP: Partial<Record<MouthShape, MouthShape>> = {
  smile: 'open',
  soft: 'open',
  smirk: 'open',
  flat: 'open',
  open: 'laugh',
};

export function applyFaceRules(out: SunnyRig, base: SunnyRig): SunnyRig {
  const smile = out.smile;
  const ratio = base.smile.depth === 0 ? 1 : smile.depth / base.smile.depth;
  if (smile.shape === base.smile.shape) {
    const up = JOY_UP[smile.shape];
    if (ratio >= OPEN_AT && up) {
      smile.shape = ratio >= LAUGH_AT ? (JOY_UP[up] ?? up) : up;
      smile.depth = base.smile.depth;
      smile.span = Math.min(smile.span, base.smile.span * 1.08);
    } else if (ratio >= OPEN_AT) {
      // Already the biggest drawing of its kind (a laugh, an "o"): it stays
      // that drawing, at its own depth, rather than being pulled any deeper.
      smile.depth = base.smile.depth * DEEPEST;
    } else if (smile.shape === 'smile' && ratio < 0) {
      smile.shape = 'frown';
      smile.depth = base.smile.depth;
    } else if (smile.shape === 'smile' && ratio < 0.55) {
      smile.shape = 'flat';
      smile.depth = base.smile.depth;
    }
  }
  const smiling = !['flat', 'frown', 'o'].includes(smile.shape);
  // A squint drawn by squashing the eye is a half-lid by another name: it is
  // the cheeks pushing the eyes shut with joy, and is drawn as exactly that.
  const squashed = (eye: EyeRig, rest: EyeRig): boolean =>
    eye.shape === 'open' && rest.scaleY > 0 && eye.scaleY / rest.scaleY < SQUINT_AT;
  const shut = (eye: EyeRig): boolean => eye.shape === 'open' && eye.closed >= SHUT_AT;
  const { left, right } = out.eyes;
  // One eye shutting alone is a wink, and a wink is a happy one.
  const wink = shut(left) !== shut(right);
  const lid = (eye: EyeRig, rest: EyeRig): void => {
    if (eye.shape !== 'open') return;
    if (squashed(eye, rest)) {
      eye.scaleY = rest.scaleY;
      eye.shape = smiling ? 'happy' : 'shut';
    } else if (shut(eye)) {
      // A blink is the lid line; a wink, or a shut eye under a big smile, beams.
      eye.shape = wink || (smiling && smile.shape !== 'smile') ? 'happy' : 'shut';
    }
    eye.closed = 0;
  };
  lid(left, base.eyes.left);
  lid(right, base.eyes.right);
  return out;
}

/** `sequence`, playing by the face rules. */
export function withFaceRules(sequence: Sequence): Sequence {
  return {
    ...sequence,
    pose: (base, t, anchor) => applyFaceRules(sequence.pose(base, t, anchor), base),
  };
}
