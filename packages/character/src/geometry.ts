// Canonical Sunny proportions.
//
// These numbers are NOT invented. Every value below was measured from the
// supplied reference artwork (`sunny.png`, 1254x1254) by scripts/measure-reference.py,
// which classifies pixels, fills the character silhouette, takes its largest
// inscribed circle as the body, and reports each face feature's bounding box,
// centroid, principal axis and per-row edge profile.
//
// Provenance summary (source pixels; body centre (625, 618), body radius 366.8):
//   body outline stroke      20.0 px
//   ray tip radius          601.9 px
//   ray base radius         398.8 px
//   ray base half-width      97.8 px
//   eye outline stroke       11.0 px
//   highlight notch          53.7% down the eye opening, protruding right
//
// The scale is fixed by declaring the body's inner (orange) radius to be 46
// units: 1 source px = 46 / 366.8 = 0.125417 viewBox units.

/** Side length of the square viewBox the rig is authored in. */
export const VIEWBOX = 200;
/** Centre of the body within the viewBox. */
export const CENTRE = { x: 100, y: 100 } as const;

/** Source-pixel to viewBox-unit scale, kept for traceability. */
export const SOURCE_TO_VIEWBOX = 0.125417;
/** Body centre in the source artwork, kept for traceability. */
export const SOURCE_BODY_CENTRE = { x: 625, y: 618 } as const;

export const BODY = {
  /**
   * Radius to the centre-line of the outline stroke. The measured 46 units is
   * the radius of the orange interior, which is the inner edge of the stroke,
   * so the path sits half a stroke further out.
   */
  radius: 46 + 2.51 / 2,
  /** Outline stroke width, measured at 20 px. */
  strokeWidth: 2.51,
} as const;

export const RAY = {
  /**
   * Where the eight rays point, in degrees clockwise from straight up, in the
   * reference's own order. They are NOT evenly spaced: measured angular centres
   * are 0, 49, 91.5, 131.5, 180, 228.5, 268.5, 311. The diagonals are each
   * pressed a few degrees toward the horizontal, and the pattern is symmetric
   * about both axes, so this is deliberate artwork rather than measurement
   * noise. It is reproduced, not regularised to 45.
   */
  anglesDeg: [0, 49, 91.5, 131.5, 180, 228.5, 268.5, 311],
  /** Distance from centre to the visible orange tip: 601.9 px. */
  tipRadius: 75.5,
  /** Distance from centre to the visible orange base: 398.8 px. */
  baseRadius: 50.0,
  /** Half the visible orange base width: 97.8 px. */
  baseHalfWidth: 12.3,
  /** Rounding of the base corners. The reference's tips are near-pointed. */
  cornerRadius: 3.0,
  /** Rounding of the apex, which is much sharper than the base corners. */
  apexRadius: 0.6,
  /** Ray outline stroke width, matching the body outline. */
  strokeWidth: 2.51,
  /**
   * The rays are painted stroke-first and then filled, so their outline sits
   * entirely OUTSIDE the orange. This was measured, not assumed: the reference's
   * ray outline extends ~1.25 units beyond the orange, whereas its body outline
   * is centred on the path. This constant compensates for the rounded apex,
   * which would otherwise pull the orange tip in by more than a unit.
   */
  apexCompensation: 0.9,
} as const;

/**
 * Eye geometry, as defaults for the shape built by `eyeOutlinePath`. Each eye's
 * size and pose live in the rig, because the reference eyes are deliberately
 * asymmetric.
 */
export const EYE = {
  /** Eye outline stroke width, measured at 11 px. */
  strokeWidth: 1.4,
  /**
   * Where along the eye the opening is widest, as a fraction of the half-height
   * (−1 = top, +1 = bottom). The reference eye is fullest above the middle.
   */
  widest: 0.0,
  /** The lower half narrows to this fraction of the upper half's width. */
  taper: 0.85,
} as const;

/**
 * The cream highlight's right-hand boundary, in eye-local normalised
 * coordinates: `u` is x / half-width and `v` is y / half-height, both in -1..1.
 *
 * The list is traced from the reference. Its signature detail is the sharp
 * rightward spike (an arrow cutting into the black crescent) roughly 54% down
 * the eye; everything reads as the cream "filling" the left of the eye.
 */
export const EYE_HIGHLIGHT = {
  /**
   * Width of the cream strip, as a fraction of the eye's outer width. The
   * reference's cream is very nearly constant width down the eye rather than
   * filling a fixed fraction of it, so it is drawn as the eye's interior
   * trimmed back from its left edge by this much.
   *
   * Tuned by measurement, not by eye: at 0.55 the two highlights measured 28%
   * and 14% larger in area than the reference's; 0.47 brings them to +10% and
   * -2.5%, and the cream mask IoU over that change went 0.669 -> 0.741. It is a
   * single fraction standing in for two hand-drawn highlights, so both eyes
   * cannot be exact at once -- the reference traces them independently and they
   * do not scale with the eye alike.
   */
  widthFraction: 0.47,
  /** How far down the opening the notch sits: 0 = top, 1 = bottom. */
  notchAt: 0.54,
  /**
   * How far right the notch reaches, as a fraction of the eye's OUTER width,
   * measured from the eye's left inner edge. Deliberately not a multiple of the
   * strip's width: the reference's spike is a fixed bite out of the crescent
   * (about 12.5 units across a ~21 unit eye), not a scaled copy of the cream.
   */
  notchReach: 0.6,
} as const;

/** Brow defaults. Each brow's length, arch and pose live in the rig. */
export const BROW = {
  /**
   * Brow stroke width. The reference measures 18-21 px across the two brows,
   * but the ink area it inks (39.0 and 27.4 u2) is matched at 2.2 units.
   */
  strokeWidth: 2.2,
} as const;

/**
 * A fixed y-down smile arc: a pale peach, wide, double-ended hook. This is the
 * whole lower half of Sunny's face.
 *
 * `depth` scales the normalised offsets back into units; the reference has
 * depth 7.53 with a span of 50.8 at -14.6 degrees.
 */

export const SMILE_UNIT = 7.531;

/**
 * The smile centreline, normalised. `u` runs -1..1 along the chord from the
 * left end to the right end; `v` is the perpendicular offset below the chord,
 * scaled so the deepest point is 1. Sampled from the reference centreline.
 */
export const SMILE_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-1.0, 0.0],
  [-0.669, 0.552],
  [-0.323, 0.924],
  [0.045, 1.0],
  [0.441, 0.758],
  [0.721, 0.345],
  [1.0, 0.0],
];

export const SMILE = {
  /** Smile stroke width; the reference is a bold ~4 unit stroke. */
  strokeWidth: 4.0,
} as const;
