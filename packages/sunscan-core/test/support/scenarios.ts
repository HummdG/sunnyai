// The required test buildings (task 3) + analytic reference volumes for the rectangle cases.
import { RECT_10x6, L_SHAPE, T_SHAPE, TERRACE_OUTRIGGER, COURTYARD, BAY_HOUSE, randomOrtho, randomStar, rect } from './cases.js';
import type { PolygonM } from '../../src/geometry/geom.js';
import type { EdgeKind, RoofParams } from '../../src/geometry/roof.js';

export interface Scenario {
  name: string;
  poly: PolygonM;
  kinds: EdgeKind[];
  params: RoofParams;
  analyticVolume?: number; // closed-form building volume (box + roof)
  note?: string;
}

const H = 5.2; // two-storey eave height
const PITCH = 35;
const L = 10, W = 6; // RECT_10x6: edges 0 = front (S), 1 = east, 2 = back (N), 3 = west
const tan = (d: number) => Math.tan((d * Math.PI) / 180);
const cot = (d: number) => 1 / tan(d);

/** Exact integral of a piecewise-quadratic cross-section area A(z) via Simpson (exact for cubics). */
function integrate(A: (z: number) => number, breaks: number[]): number {
  let v = 0;
  for (let i = 0; i + 1 < breaks.length; i++) {
    const a = breaks[i], b = breaks[i + 1];
    v += ((b - a) / 6) * (A(a) + 4 * A((a + b) / 2) + A(b));
  }
  return v;
}

const box = L * W * H;
const c = cot(PITCH);
const hRidge = (W / 2) * tan(PITCH);

export const analytic = {
  hipped: box + (W * hRidge / 2) * (L - W) + (W * W * hRidge) / 3,
  gabled: box + (W * hRidge / 2) * L,
  endTerraceHip: box + integrate((z) => (W - 2 * c * z) * (L - c * z), [0, W / (2 * c)]),
  skillion: box + (L * W * (W * tan(PITCH))) / 2,
  pyramidal: box + (L * W * (3 * tan(PITCH))) / 3,
  halfHipped: (f: number, hipPitch: number) => {
    const zc = f * hRidge, ch = cot(hipPitch);
    return box + integrate((z) => (z <= zc ? L * (W - 2 * c * z) : (W - 2 * c * z) * (L - 2 * ch * (z - zc))), [0, zc, W / (2 * c)]);
  },
  dutchGable: (f: number) => {
    const zc = f * hRidge; // f x hipped-roof height (= ridge height for a rectangle)
    return box + integrate((z) => (z <= zc ? (W - 2 * c * z) * (L - 2 * c * z) : (W - 2 * c * z) * (L - 2 * c * zc)), [0, zc, W / (2 * c)]);
  },
  gambrel: (lower: number, upper: number, hb: number) => {
    const c1 = cot(lower), c2 = cot(upper), W1 = W - 2 * c1 * hb;
    return box + integrate((z) => (z <= hb ? L * (W - 2 * c1 * z) : L * (W1 - 2 * c2 * (z - hb))), [0, hb, hb + W1 / (2 * c2)]);
  },
  mansard: (lower: number, upper: number, hb: number, flatTop = false) => {
    const c1 = cot(lower), c2 = cot(upper), W1 = W - 2 * c1 * hb, L1 = L - 2 * c1 * hb;
    const A = (z: number) => (z <= hb ? (L - 2 * c1 * z) * (W - 2 * c1 * z) : (L1 - 2 * c2 * (z - hb)) * (W1 - 2 * c2 * (z - hb)));
    return box + integrate(A, flatTop ? [0, hb] : [0, hb, hb + W1 / (2 * c2)]);
  },
  flatParapet: (ph: number, th: number) => box + (L * W - (L - 2 * th) * (W - 2 * th)) * ph,
  twoPitches: (front: number, back: number) => box + (L * W * (W / (cot(front) + cot(back)))) / 2, // ridge where the planes meet
};

const all = (n: number, k: EdgeKind = 'eave') => Array<EdgeKind>(n).fill(k);

export function scenarios(): Scenario[] {
  const base = { eaveHeight: H, pitchDeg: PITCH };
  const ortho = randomOrtho(1);
  const star = randomStar(40, 1);
  return [
    { name: 'rect-hipped', poly: RECT_10x6, kinds: all(4), params: { ...base, type: 'hipped' }, analyticVolume: analytic.hipped },
    { name: 'rect-gabled', poly: RECT_10x6, kinds: ['eave', 'gable', 'eave', 'gable'], params: { ...base, type: 'gabled' }, analyticVolume: analytic.gabled },
    { name: 'rect-midterrace', poly: RECT_10x6, kinds: ['eave', 'party', 'eave', 'party'], params: { ...base, type: 'gabled' }, analyticVolume: analytic.gabled, note: 'dual pitch, ridge party wall to party wall' },
    { name: 'rect-endterrace-hip', poly: RECT_10x6, kinds: ['eave', 'eave', 'eave', 'party'], params: { ...base, type: 'hipped' }, analyticVolume: analytic.endTerraceHip },
    { name: 'rect-endterrace-gable', poly: RECT_10x6, kinds: ['eave', 'gable', 'eave', 'party'], params: { ...base, type: 'gabled' }, analyticVolume: analytic.gabled },
    { name: 'rect-skillion', poly: RECT_10x6, kinds: all(4), params: { ...base, type: 'skillion' }, analyticVolume: analytic.skillion, note: 'low eave = front (edge 0)' },
    { name: 'rect-pyramidal', poly: RECT_10x6, kinds: all(4), params: { ...base, type: 'pyramidal' }, analyticVolume: analytic.pyramidal, note: 'apex over centroid; long sides at 35 deg' },
    { name: 'rect-half-hipped', poly: RECT_10x6, kinds: ['eave', 'gable', 'eave', 'gable'], params: { ...base, type: 'half-hipped', halfHipFraction: 0.6, hipPitchDeg: 45 }, analyticVolume: analytic.halfHipped(0.6, 45) },
    { name: 'rect-dutch-gable', poly: RECT_10x6, kinds: ['eave', 'gable', 'eave', 'gable'], params: { ...base, type: 'dutch-gable', halfHipFraction: 0.6 }, analyticVolume: analytic.dutchGable(0.6) },
    { name: 'rect-gambrel', poly: RECT_10x6, kinds: ['eave', 'gable', 'eave', 'gable'], params: { ...base, type: 'gambrel', lowerPitchDeg: 60, upperPitchDeg: 25, breakHeight: 1.8 }, analyticVolume: analytic.gambrel(60, 25, 1.8) },
    { name: 'rect-mansard', poly: RECT_10x6, kinds: all(4), params: { ...base, type: 'mansard', lowerPitchDeg: 70, upperPitchDeg: 25, breakHeight: 2.4 }, analyticVolume: analytic.mansard(70, 25, 2.4) },
    { name: 'rect-mansard-flat', poly: RECT_10x6, kinds: all(4), params: { ...base, type: 'mansard', lowerPitchDeg: 70, upperPitchDeg: 25, breakHeight: 2.4, flatTop: true }, analyticVolume: analytic.mansard(70, 25, 2.4, true) },
    { name: 'rect-flat-parapet', poly: RECT_10x6, kinds: all(4), params: { ...base, type: 'flat', parapetHeight: 0.6, parapetThickness: 0.25 }, analyticVolume: analytic.flatParapet(0.6, 0.25) },
    { name: 'rect-flat', poly: RECT_10x6, kinds: all(4), params: { ...base, type: 'flat' }, analyticVolume: box },
    { name: 'rect-two-pitches', poly: RECT_10x6, kinds: ['eave', 'gable', 'eave', 'gable'], params: { ...base, type: 'gabled', edgePitchDeg: [30, undefined, 45, undefined] }, analyticVolume: analytic.twoPitches(30, 45), note: 'front 30 deg, back 45 deg: ridge shifts' },
    { name: 'L-hipped', poly: L_SHAPE, kinds: all(6), params: { ...base, type: 'hipped' } },
    { name: 'L-gabled', poly: L_SHAPE, kinds: ['eave', 'eave', 'gable', 'eave', 'eave', 'gable'], params: { ...base, type: 'gabled' }, note: 'gables at wing end + west end, hip at east' },
    { name: 'L-cross-gabled', poly: L_SHAPE, kinds: ['eave', 'gable', 'gable', 'eave', 'eave', 'gable'], params: { ...base, type: 'gabled' }, note: 'east side vertical (gable) too' },
    { name: 'T-hipped', poly: T_SHAPE, kinds: all(8), params: { ...base, type: 'hipped' } },
    { name: 'T-gabled', poly: T_SHAPE, kinds: ['eave', 'gable', 'eave', 'eave', 'gable', 'eave', 'eave', 'gable'], params: { ...base, type: 'gabled' } },
    { name: 'terrace-outrigger', poly: TERRACE_OUTRIGGER, kinds: ['eave', 'party', 'gable', 'eave', 'eave', 'party'], params: { ...base, type: 'gabled' }, note: 'mid-terrace + rear outrigger, one polygon' },
    { name: 'detached-outrigger-hipped', poly: TERRACE_OUTRIGGER, kinds: all(6), params: { ...base, type: 'hipped' } },
    { name: 'bay-house-hipped', poly: BAY_HOUSE, kinds: all(8), params: { ...base, type: 'hipped' } },
    { name: 'courtyard-hipped', poly: COURTYARD, kinds: all(8), params: { ...base, type: 'hipped' }, note: 'polygon with hole' },
    { name: 'courtyard-gambrel', poly: COURTYARD, kinds: all(8), params: { ...base, type: 'mansard', lowerPitchDeg: 65, upperPitchDeg: 25, breakHeight: 1.5 } },
    { name: 'ortho40-hipped', poly: ortho, kinds: all(ortho.outer.length), params: { ...base, type: 'hipped' }, note: `${ortho.outer.length}-vertex rectilinear` },
    { name: 'star40-hipped', poly: star, kinds: all(40), params: { ...base, type: 'hipped' }, note: '40-vertex irregular (star-shaped)' },
    { name: 'collinear-mixed-kinds', poly: { outer: [[0, 0], [10, 0], [10, 6], [5, 6], [0, 6]] }, kinds: ['eave', 'eave', 'eave', 'party', 'eave'], params: { ...base, type: 'hipped' }, note: 'collinear eave + party wall on the back line -> vertical riser' },
    { name: 'rect-flat-in-hip', poly: { outer: rect(14, 10) }, kinds: all(4), params: { ...base, type: 'mansard', lowerPitchDeg: 35, upperPitchDeg: 35, breakHeight: 1.5, flatTop: true }, note: 'hip with flat top (crown roof)' },
  ];
}
