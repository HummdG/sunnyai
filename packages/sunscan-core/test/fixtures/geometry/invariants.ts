// Shared invariants for the engine robustness suites (rotated plans, near-ties, real OSM outlines).
// A roof passes when: every skeleton node lies inside the footprint's bbox, node times are bounded, the closed solid is
// watertight with positive volume, the roof's plan projection tiles the footprint exactly once (signed and absolute
// area), every face has its design slope (eaves their pitch, gables / party walls / risers 90 deg) and the engine
// reported no warnings. Analytic ridge heights / volumes are compared when the caller knows them.
import { buildRoof, type EdgeKind, type RoofModel, type RoofParams } from '../../../src/geometry/roof.js';
import { buildSolid } from '../../../src/geometry/solid.js';
import { checkMesh, checkRoof } from '../../../src/geometry/validate.js';
import { bboxDiag, pointInPolygon, type PolygonM, type Vec2 } from '../../../src/geometry/geom.js';

export const rot = (pts: Vec2[], a: number, dx = 0, dy = 0): Vec2[] =>
  pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a) + dx, x * Math.sin(a) + y * Math.cos(a) + dy]);
export const rectPts = (w: number, h: number): Vec2[] => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
const cot = (deg: number) => 1 / Math.tan((deg * Math.PI) / 180);

export interface InvariantOptions {
  /** Upper bound of skeleton node times; default: the eave-extent bound of {@link extentTimeBound}. */
  tMax?: number;
  /** Expected maximum node time (ridge / apex height above the eave) when known in closed form. */
  tExact?: number;
  /** Expected building volume when known in closed form. */
  volume?: number;
  /** Relative tolerance of the plan-area and volume comparisons (default 1e-9). */
  relTol?: number;
  /** Largest accepted face slope error in degrees (default 1e-6). */
  pitchTol?: number;
  /**
   * Input noise scale (m). Triangles below checkMesh's 1e-9 m2 are then accepted when they are not slivers (smallest
   * altitude >= 1e-9 x bbox diagonal) and no larger than 100 x noise: e.g. a multi-way event split by 1e-6 m of vertex
   * noise into distinct events leaves genuine micrometre faces. Collinear slivers are always rejected.
   */
  noise?: number;
}

export interface InvariantResult { roof?: RoofModel; errors: string[] }

/**
 * Upper bound of the skeleton time of any roof node: a point of the face of eave e (profile segment k, speed w_k > 0)
 * has t = t0_k + (offset beyond the segment start) / w_k, and that offset is at most the footprint's extent beyond
 * the eave line. Valid for every roof type (gables, party walls, skillions, profiles).
 */
export function extentTimeBound(roof: RoofModel): number {
  const pts = [roof.prepared.poly.outer, ...(roof.prepared.poly.holes ?? [])].flat();
  let T = 0;
  for (const e of roof.skeleton.edges) {
    if (e.virtual) continue;
    const D = Math.max(0, ...pts.map((p) => e.n[0] * p[0] + e.n[1] * p[1] - e.c));
    for (const s of e.profile) {
      T = Math.max(T, s.t0);
      if (s.w > 0) T = Math.max(T, s.t0 + D / s.w);
    }
  }
  return T;
}

/** Largest inscribed-circle radius (distance-to-boundary maximum), an upper bound from a grid of step S/150. */
export function maxInscribedRadius(poly: PolygonM): number {
  const rings = [poly.outer, ...(poly.holes ?? [])];
  const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const h = Math.hypot(x1 - x0, y1 - y0) / 150;
  let best = 0;
  for (let x = x0 + h / 2; x < x1; x += h)
    for (let y = y0 + h / 2; y < y1; y += h) {
      if (!pointInPolygon([x, y], poly)) continue;
      let d = Infinity;
      for (const r of rings)
        for (let i = 0; i < r.length; i++) {
          const a = r[i], b = r[(i + 1) % r.length];
          const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
          d = Math.min(d, Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y));
        }
      best = Math.max(best, d);
    }
  return best + h; // the distance function is 1-Lipschitz: every point is within h / sqrt(2) of a grid point
}

/** Build roof + solid and check every invariant; returns the list of violations (empty = pass). */
export function roofInvariants(poly: PolygonM, kinds: EdgeKind[], params: RoofParams, o: InvariantOptions = {}): InvariantResult {
  const errors: string[] = [];
  let roof: RoofModel;
  try {
    roof = buildRoof(poly, kinds, params);
  } catch (e) {
    return { errors: [`buildRoof threw ${(e as Error).name}: ${(e as Error).message}`] };
  }
  const rel = o.relTol ?? 1e-9;
  const rings = [poly.outer, ...(poly.holes ?? [])];
  const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
  const S = bboxDiag(poly), m = 1e-6 * S;
  const sk = roof.skeleton;
  const outside = sk.nodes.filter((n) => !(Number.isFinite(n.x) && Number.isFinite(n.y) && n.x >= Math.min(...xs) - m && n.x <= Math.max(...xs) + m && n.y >= Math.min(...ys) - m && n.y <= Math.max(...ys) + m));
  if (outside.length) errors.push(`${outside.length} skeleton node(s) outside the footprint bbox, farthest ${Math.max(...outside.map((n) => Math.hypot(n.x, n.y))).toExponential(2)} m`);
  const tMax = o.tMax ?? extentTimeBound(roof);
  const ts = sk.nodes.map((n) => n.t);
  const hi = Math.max(...ts), lo = Math.min(...ts);
  if (!(hi <= tMax * (1 + 1e-9) + 1e-9 * S)) errors.push(`node time ${hi} above the bound ${tMax}`);
  if (!(lo >= -1e-9 * S)) errors.push(`negative node time ${lo}`);
  if (o.tExact !== undefined && !(Math.abs(hi - o.tExact) <= 1e-7 * S + rel * o.tExact)) errors.push(`ridge time ${hi} != ${o.tExact}`);
  if (sk.stats.warnings.length) errors.push(`warnings: ${sk.stats.warnings.slice(0, 2).join(' | ')}`);
  let mesh;
  try {
    mesh = buildSolid(roof);
  } catch (e) {
    errors.push(`buildSolid threw ${(e as Error).message}`);
    return { roof, errors };
  }
  const mr = checkMesh(mesh), rr = checkRoof(roof, mesh);
  if (!mr.watertight) errors.push(`not watertight (boundary ${mr.boundaryEdges}, non-manifold ${mr.nonManifoldEdges}, flipped ${mr.sameDirectionEdges})`);
  if (!(mr.volume > 0)) errors.push(`volume ${mr.volume}`);
  let degenerate = 0;
  for (const [a, b, c] of mesh.triangles) {
    const P = mesh.positions, A3 = P[a], B3 = P[b], C3 = P[c];
    const u = [B3[0] - A3[0], B3[1] - A3[1], B3[2] - A3[2]], v = [C3[0] - A3[0], C3[1] - A3[1], C3[2] - A3[2]];
    const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    if (area >= 1e-9) continue;
    const longest = Math.max(Math.hypot(...u), Math.hypot(...v), Math.hypot(C3[0] - B3[0], C3[1] - B3[1], C3[2] - B3[2]));
    const tiny = o.noise !== undefined && longest <= 100 * o.noise && (2 * area) / longest >= 1e-9 * S;
    if (!tiny) degenerate++;
  }
  if (degenerate) errors.push(`${degenerate} degenerate triangle(s)`);
  if (mr.duplicateVertices) errors.push(`${mr.duplicateVertices} duplicate vertex position(s)`);
  if (o.volume !== undefined && !(Math.abs(mr.volume - o.volume) <= rel * o.volume + 1e-9 * S ** 3)) errors.push(`volume ${mr.volume} != ${o.volume}`);
  const A = rr.footprintArea;
  if (!(Math.abs(rr.roofPlanArea - A) <= rel * A)) errors.push(`roof plan area ${rr.roofPlanArea} != footprint ${A}`);
  if (!(Math.abs(rr.roofPlanAreaAbs - A) <= rel * A)) errors.push(`roof |plan| area ${rr.roofPlanAreaAbs} != footprint ${A} (folds / overlaps)`);
  if (!(rr.maxPitchErrDeg <= (o.pitchTol ?? 1e-6))) errors.push(`face slope error ${rr.maxPitchErrDeg.toExponential(2)} deg`);
  return { roof, errors };
}

// ------------------------------------------------------------------ rectangle closed forms
export type RectRoof = 'hipped' | 'gabled' | 'mid-terrace' | 'skillion' | 'half-hipped';
export const RECT_ROOFS: RectRoof[] = ['hipped', 'gabled', 'mid-terrace', 'skillion', 'half-hipped'];

/** Kinds and params of a rectangle roof on rectPts(w, h) (edge 0 = bottom side of length w, edge 1 = right side). */
export function rectRoof(type: RectRoof, pitchDeg: number, eave = 5): { kinds: EdgeKind[]; params: RoofParams } {
  switch (type) {
    case 'hipped': return { kinds: ['eave', 'eave', 'eave', 'eave'], params: { type: 'hipped', eaveHeight: eave, pitchDeg } };
    case 'gabled': return { kinds: ['eave', 'gable', 'eave', 'gable'], params: { type: 'gabled', eaveHeight: eave, pitchDeg } };
    case 'mid-terrace': return { kinds: ['eave', 'party', 'eave', 'party'], params: { type: 'gabled', eaveHeight: eave, pitchDeg } };
    case 'skillion': return { kinds: ['eave', 'eave', 'eave', 'eave'], params: { type: 'skillion', eaveHeight: eave, pitchDeg } };
    case 'half-hipped': return { kinds: ['eave', 'gable', 'eave', 'gable'], params: { type: 'half-hipped', eaveHeight: eave, pitchDeg, hipPitchDeg: Math.min(pitchDeg + 10, 80), halfHipFraction: 0.6 } };
  }
}

/** Exact ridge time (height above the eave) and building volume of a rectangle roof (sides w along edge 0, h). */
export function rectClosedForm(type: RectRoof, w: number, h: number, pitchDeg: number, eave = 5): { tExact: number; volume: number } {
  const c = cot(pitchDeg), tn = 1 / c, box = w * h * eave;
  const simpson = (A: (z: number) => number, br: number[]) => {
    let v = 0;
    for (let i = 0; i + 1 < br.length; i++) { const a = br[i], b = br[i + 1]; v += ((b - a) / 6) * (A(a) + 4 * A((a + b) / 2) + A(b)); }
    return v;
  };
  if (type === 'hipped') {
    const W = Math.min(w, h), L = Math.max(w, h), t = W / 2 / c;
    return { tExact: t, volume: box + simpson((z) => (W - 2 * c * z) * (L - 2 * c * z), [0, t]) };
  }
  if (type === 'skillion') return { tExact: h / c, volume: box + (w * h * (h * tn)) / 2 };
  // eaves = edges 0 and 2 (separation h), gables / party walls = edges 1 and 3 (separation w)
  const t = h / 2 / c;
  if (type === 'gabled' || type === 'mid-terrace') return { tExact: t, volume: box + (h * t / 2) * w };
  // half-hipped: gables vertical up to zc = 0.6 t, then hipped at the steeper hip pitch (the hips may meet below t)
  const zc = 0.6 * t, ch = cot(Math.min(pitchDeg + 10, 80));
  const top = Math.min(t, zc + w / (2 * ch));
  return { tExact: top, volume: box + simpson((z) => (z <= zc ? w * (h - 2 * c * z) : (h - 2 * c * z) * Math.max(0, w - 2 * ch * (z - zc))), [0, zc, top]) };
}
