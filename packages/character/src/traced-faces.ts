// The faces Sunny pulls beyond the reference's own.
//
// The reference has one mouth and one pair of eyes, traced in `traced-art.ts`.
// Expressions need more drawings than that, and the one thing they must not do
// is stretch the traced smile into them: scaling an inked line scales its
// weight too, so a "bigger" smile becomes a fat-bottomed grimace. So every other
// mouth and every closed eye is drawn here, in the same hand: a brush stroke
// that swells in the middle and thins to a point at each end, at the reference's
// line weight, with the cheek creases the traced smile has at its corners.
//
// Coordinates are each feature's own frame, not the body's. A mouth is drawn
// about its smile's chord midpoint with the chord along +x (the traced smile's
// chord runs from -SPAN/2 to +SPAN/2), and an eye about its centre with its long
// axis along y. The renderer places the frame where the rig says the feature is,
// so the tilt and lean of the reference carry over without being redrawn.
//
// Paths use only M, L, Q and Z with absolute coordinate pairs, so `boilPath`
// can wobble them like every traced part.

import type { EyeShape, MouthShape } from './rig.js';

type Pt = readonly [number, number];

/** The traced smile's chord length at rest (`defaultRig().smile.span`). */
export const SMILE_SPAN = 46.6;

/** The reference's ink weight at its heaviest, in body units. */
const WEIGHT = 3.4;

const r1 = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** A point along a Catmull-Rom curve through `pts`, `u` in 0..1. */
function along(pts: readonly Pt[], u: number): Pt {
  const segs = pts.length - 1;
  const f = Math.min(segs - 1e-9, Math.max(0, u * segs));
  const i = Math.floor(f);
  const t = f - i;
  const p0 = pts[Math.max(0, i - 1)]!;
  const p1 = pts[i]!;
  const p2 = pts[i + 1]!;
  const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
  const c = (a: number, b: number, d: number, e: number): number =>
    0.5 *
    (2 * b +
      (-a + d) * t +
      (2 * a - 5 * b + 4 * d - e) * t * t +
      (-a + 3 * b - 3 * d + e) * t * t * t);
  return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}

/**
 * An inked stroke through `pts`: a filled outline that swells to `weight` in
 * the middle and tapers to `tip` at both ends, the way a brush line does.
 */
export function inkStroke(pts: readonly Pt[], weight = WEIGHT, tip = 0.7): string {
  const N = 28;
  const centre: Pt[] = [];
  for (let k = 0; k <= N; k++) centre.push(along(pts, k / N));
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const a = centre[Math.max(0, k - 1)]!;
    const b = centre[Math.min(N, k + 1)]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const half = (tip + (weight - tip) * Math.sin((Math.PI * k) / N) ** 0.6) / 2;
    const [cx, cy] = centre[k]!;
    left.push([cx + nx * half, cy + ny * half]);
    right.push([cx - nx * half, cy - ny * half]);
  }
  const ring = [...left, ...right.reverse()];
  return `M${ring.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;
}

/** The little bracket of a cheek crease just outside a mouth corner. */
function crease(x: number, y: number, side: -1 | 1, size = 1): string {
  return inkStroke(
    [
      [x + side * 0.6 * size, y - 3.6 * size],
      [x + side * 2.3 * size, y - 0.2 * size],
      [x + side * 1.2 * size, y + 3.2 * size],
    ],
    2.3 * size,
    0.6,
  );
}

/** A mouth: ink paths, and optionally a tongue and a row of teeth. */
export interface MouthArt {
  ink: string;
  tongue?: string;
  teeth?: string;
}

/**
 * Every mouth but the traced `smile`, in the smile's chord frame. The open
 * mouths are a filled ink cavity with the tongue and teeth inset, so they keep
 * a solid inked edge however they are scaled.
 */
export const MOUTH_ART: Record<Exclude<MouthShape, 'smile'>, MouthArt> = {
  soft: {
    ink:
      inkStroke([
        [-15, -0.6],
        [-7.5, 4.2],
        [0.5, 5.6],
        [8.5, 4],
        [15.5, -1],
      ]) +
      crease(-15.6, -0.8, -1, 0.8) +
      crease(16.1, -1.2, 1, 0.8),
  },
  open: {
    ink:
      'M-18 -1.2Q0 2.6 18.5 -2.2Q17.5 13.5 0.4 14.6Q-15.6 13.6 -18 -1.2Z' +
      crease(-18.8, -1.4, -1, 0.9) +
      crease(19.3, -2.4, 1, 0.9),
    tongue: 'M-9.2 11.2Q-5 5.6 0.6 7.4Q6 5.4 9.8 10.8Q5.6 13.6 0.4 13.6Q-5 13.6 -9.2 11.2Z',
  },
  laugh: {
    ink:
      'M-21.5 -2.4Q0 2.4 22 -3.4Q21.4 18.8 0.4 19.8Q-19.8 18.8 -21.5 -2.4Z' +
      crease(-22.3, -2.6, -1) +
      crease(22.8, -3.6, 1),
    teeth: 'M-18.6 -0.4Q0 3.8 19.2 -1.2L18.6 2.4Q0 6.8 -18 3Z',
    tongue: 'M-11.6 15.4Q-6 8.4 0.6 10.4Q7.2 8.2 12.4 14.6Q6.8 18.4 0.4 18.6Q-6.6 18.4 -11.6 15.4Z',
  },
  o: {
    ink: 'M0.6 -4.6Q7.4 -4.5 7.5 3.8Q7.3 12 0.6 12.1Q-6.2 12 -6.3 3.8Q-6.2 -4.5 0.6 -4.6Z',
    tongue: 'M-3.6 9.4Q0.6 6.4 4.8 9.4Q3 11.4 0.6 11.4Q-1.8 11.4 -3.6 9.4Z',
  },
  smirk: {
    ink:
      inkStroke([
        [-12.5, 1.8],
        [-3, 3.6],
        [7, 2.6],
        [14, -1.2],
        [17.5, -5.2],
      ]) + crease(18.2, -5.6, 1, 0.85),
  },
  flat: {
    ink: inkStroke(
      [
        [-12.5, 1.8],
        [-4.5, 0.4],
        [3.5, 1.6],
        [12.5, 0.2],
      ],
      3.4,
    ),
  },
  frown: {
    ink: inkStroke(
      [
        [-13, 4.2],
        [-6.5, 0.6],
        [0.5, -0.8],
        [7.5, 0.6],
        [13.5, 4.4],
      ],
      3.2,
    ),
  },
};

/**
 * A closed eye, in the eye's own frame for an eye `width` across and `height`
 * tall (each eye passes its own rest size, so the reference's big left eye and
 * smaller right eye close to arcs of their own sizes).
 */
export function closedEyeArt(
  shape: Exclude<EyeShape, 'open'>,
  width: number,
  height: number,
): string {
  const w = width / 2;
  const at = (u: number, v: number): Pt => [u * w, v * height];
  const weight = WEIGHT * (width / 21.8) ** 0.5;
  return shape === 'happy'
    ? // An arch, sitting a little low: the cheeks have pushed the eye up shut.
      inkStroke(
        [at(-0.9, 0.24), at(-0.5, 0.02), at(0, -0.05), at(0.5, 0.02), at(0.9, 0.24)],
        weight,
      )
    : // A gentle downward curve: lids lowered, content.
      inkStroke(
        [at(-0.9, 0.06), at(-0.45, 0.17), at(0, 0.2), at(0.45, 0.17), at(0.9, 0.06)],
        weight,
      );
}

/** The tongue's colour, which does not follow the theme: it is a tongue. */
export const TONGUE = '#E4573D';
