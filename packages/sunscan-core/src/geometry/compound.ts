// Compound roofs: the upper envelope of gabled components (e.g. a main gable plus a cross gable) over one convex
// wall footprint, all components at the footprint's eave height. Each component is a gable over a rectangle (two
// parallel eave edges), clipped to the footprint; its faces are convex planes. The envelope is assembled from convex
// pieces (pairwise "which plane is higher" half-plane splits), made conforming (no T-junctions) and closed with
// vertical gable / party faces along the outer walls, so buildSolid gives a watertight solid exactly as for
// skeleton roofs. A step inside the footprint (a component ending above its neighbour) is rejected.
import { convexIntersect, convexMinus, clipHalfPlane, ringArea2, type HalfPlane } from './clip.js';
import { deg, polygonArea, rad, type PolygonM, type Vec2, type Vec3 } from './geom.js';
import { computeSkeleton, SkeletonError, type Skeleton } from './skeleton.js';
import {
  bearing, finishModel, makeFace, prepareFootprint, type EdgeKind, type PreparedFootprint, type RoofComponent, type RoofFace, type RoofModel, type RoofParams,
} from './roof.js';

const EPS = 1e-7; // plan tolerance (m): vertex identity, points on segments
const ZEPS = 1e-6; // height tolerance (m)

/** A planar roof face z = a x + b y + c over a convex plan polygon, from component `comp`. */
interface PlaneFace { comp: number; poly: Vec2[]; pl: [number, number, number] }

/** One gable component: clipped plan polygon, eave lines (inward normal, offset) and slope. */
interface Comp { poly: Vec2[]; eaves: HalfPlane[]; k: number; faces: PlaneFace[] }

const fail = (msg: string): never => { throw new SkeletonError(`compound roof: ${msg}`, [msg], 0); };
const planeZ = (pl: [number, number, number], p: Vec2) => pl[0] * p[0] + pl[1] * p[1] + pl[2];

/** CCW copy of a component ring with its edge kinds re-indexed (edge j of the reversed ring = edge n-2-j). */
function ccw(r: Vec2[], kinds: EdgeKind[]): { ring: Vec2[]; kinds: EdgeKind[] } {
  if (ringArea2(r) > 0) return { ring: r, kinds };
  const n = r.length;
  return { ring: r.slice().reverse(), kinds: r.map((_, j) => kinds[(((n - 2 - j) % n) + n) % n]) };
}

function makeComp(c: RoofComponent, F: Vec2[], H: number, index: number): Comp {
  const { ring, kinds } = ccw(c.footprint.outer, c.edgeKinds);
  const eaves: HalfPlane[] = [];
  ring.forEach((a, i) => {
    if (kinds[i] !== 'eave') return;
    const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n: Vec2 = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
    eaves.push({ n, c: n[0] * a[0] + n[1] * a[1] });
  });
  if (eaves.length !== 2 || Math.abs(eaves[0].n[0] * eaves[1].n[1] - eaves[0].n[1] * eaves[1].n[0]) > 1e-6) {
    fail(`component ${index} must be a gable with exactly two parallel eaves`);
  }
  const poly = convexIntersect(ring, F);
  if (!poly.length) fail(`component ${index} lies outside the footprint`);
  const k = Math.tan(rad(c.pitchDeg));
  const [e1, e2] = eaves;
  // ridge split: d1 <= d2 belongs to eave 1, else eave 2  (d_i = n_i . p - c_i)
  const sep = (s: number): HalfPlane => {
    const nx = s * (e2.n[0] - e1.n[0]), ny = s * (e2.n[1] - e1.n[1]), L = Math.hypot(nx, ny);
    return { n: [nx / L, ny / L], c: (s * (e2.c - e1.c)) / L };
  };
  const faces: PlaneFace[] = [];
  for (const [e, half] of [[e1, sep(1)], [e2, sep(-1)]] as const) {
    const q = clipHalfPlane(poly, half);
    if (q.length) faces.push({ comp: index, poly: q, pl: [k * e.n[0], k * e.n[1], H - k * e.c] });
  }
  return { poly, eaves, k, faces };
}

/** Height of a component at p (undefined outside its clipped polygon). */
function compHeight(c: Comp, H: number, p: Vec2): number | undefined {
  const r = c.poly;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / L < -EPS) return undefined;
  }
  return H + c.k * Math.min(...c.eaves.map((e) => e.n[0] * p[0] + e.n[1] * p[1] - e.c));
}

/** Pieces of face f where it is the top surface (ties go to the lower component index). */
function topPieces(f: PlaneFace, comps: Comp[]): Vec2[][] {
  let pieces = [f.poly];
  comps.forEach((B, bi) => {
    if (bi === f.comp) return;
    const next: Vec2[][] = [];
    for (const q of pieces) {
      next.push(...convexMinus(q, B.poly));
      for (const g of B.faces) {
        const inter = convexIntersect(q, g.poly);
        if (!inter.length) continue;
        const nx = f.pl[0] - g.pl[0], ny = f.pl[1] - g.pl[1], dc = f.pl[2] - g.pl[2], L = Math.hypot(nx, ny);
        if (L < 1e-12) { if (dc > ZEPS || (Math.abs(dc) <= ZEPS && f.comp < bi)) next.push(inter); continue; }
        const kept = clipHalfPlane(inter, { n: [nx / L, ny / L], c: -dc / L });
        if (kept.length) next.push(kept);
      }
    }
    pieces = next;
  });
  return pieces;
}

/** Vertex pool with plan-tolerance identity. */
class Pool {
  readonly V: Vec3[] = [];
  private grid = new Map<string, number[]>();
  constructor(private height: (p: Vec2) => number) {}
  id(p: Vec2): number {
    const cx = Math.round(p[0] / (10 * EPS)), cy = Math.round(p[1] / (10 * EPS));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (Math.hypot(this.V[i][0] - p[0], this.V[i][1] - p[1]) <= EPS) return i;
      }
    }
    const i = this.V.length;
    this.V.push([p[0], p[1], this.height(p)]);
    const key = `${cx},${cy}`;
    this.grid.set(key, [...(this.grid.get(key) ?? []), i]);
    return i;
  }
}

/** Vertex ids lying strictly inside segment a-b, sorted from a to b. */
function onSegment(V: Vec3[], ids: number[], a: number, b: number): number[] {
  const ax = V[a][0], ay = V[a][1], dx = V[b][0] - ax, dy = V[b][1] - ay, L2 = dx * dx + dy * dy;
  const hits: { i: number; t: number }[] = [];
  for (const i of ids) {
    if (i === a || i === b) continue;
    const t = ((V[i][0] - ax) * dx + (V[i][1] - ay) * dy) / L2;
    if (t <= 1e-9 || t >= 1 - 1e-9) continue;
    if (Math.hypot(ax + t * dx - V[i][0], ay + t * dy - V[i][1]) <= EPS) hits.push({ i, t });
  }
  return hits.sort((p, q) => p.t - q.t).map((h) => h.i);
}

/**
 * Build the compound roof of `params.components` over a convex footprint (see the module header).
 * @throws SkeletonError for non-convex footprints, invalid components or a step inside the footprint.
 */
export function buildCompoundRoof(footprint: PolygonM, edgeKinds: EdgeKind[], params: RoofParams): RoofModel {
  const base = prepareFootprint(footprint, edgeKinds);
  if ((base.poly.holes ?? []).length) fail('footprints with holes are not supported');
  const F = base.poly.outer;
  for (let i = 0; i < F.length; i++) {
    const a = F[i], b = F[(i + 1) % F.length], c = F[(i + 2) % F.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-9) fail('the footprint must be convex');
  }
  const H = params.eaveHeight;
  const comps = (params.components ?? []).map((c, i) => makeComp(c, F, H, i));
  const envelope = (p: Vec2): number => {
    let z = -Infinity;
    for (const c of comps) { const h = compHeight(c, H, p); if (h !== undefined && h > z) z = h; }
    return z;
  };
  // 1. envelope pieces (convex, each on one plane), tiling F
  const pieces: { poly: Vec2[]; pl: [number, number, number] }[] = [];
  for (const c of comps) for (const f of c.faces) for (const q of topPieces(f, comps)) pieces.push({ poly: q, pl: f.pl });
  const A = polygonArea(base.poly), covered = pieces.reduce((s, p) => s + ringArea2(p.poly), 0);
  if (Math.abs(covered - A) > 1e-6 * Math.max(1, A)) fail(`components do not cover the footprint (${covered.toFixed(4)} of ${A.toFixed(4)} m2)`);
  // 2. vertices at envelope heights
  const pool = new Pool((p) => envelope(p));
  const rings = pieces.map((p) => p.poly.map((q) => pool.id(q)));
  const fIds = F.map((p) => pool.id(p));
  const V = pool.V;
  const all = V.map((_, i) => i);
  // 3. conforming rings (insert every vertex lying on a piece edge)
  const conform = (r: number[]) => r.flatMap((a, j) => [a, ...onSegment(V, all, a, r[(j + 1) % r.length])]);
  const pieceLoops = rings.map(conform);
  // a piece below the envelope at a vertex of its (conforming) boundary means a step inside the footprint
  pieceLoops.forEach((loop, j) => {
    for (const i of loop) {
      if (Math.abs(planeZ(pieces[j].pl, [V[i][0], V[i][1]]) - V[i][2]) > ZEPS) fail(`internal step at (${V[i][0].toFixed(3)}, ${V[i][1].toFixed(3)})`);
    }
  });
  // 4. wall line: footprint corners + boundary vertices at eave height; higher ones form the vertical faces
  const ring: number[] = [], kinds: EdgeKind[] = [], src: number[][] = [], profile: number[][] = [];
  F.forEach((_, i) => {
    const a = fIds[i], b = fIds[(i + 1) % F.length];
    if (Math.abs(V[a][2] - H) > ZEPS) fail(`footprint corner ${i} is not at the eave height`);
    const between = onSegment(V, all, a, b);
    let start = a, prof: number[] = [];
    const close = (end: number) => {
      ring.push(start);
      kinds.push(base.kinds[i] === 'party' ? 'party' : prof.length ? 'gable' : 'eave');
      src.push(base.srcEdges[i]);
      profile.push(prof);
      start = end; prof = [];
    };
    for (const v of between) {
      if (V[v][2] > H + ZEPS) prof.push(v);
      else close(v);
    }
    close(b);
  });
  const prep: PreparedFootprint = {
    poly: { outer: ring.map((i) => [V[i][0], V[i][1]] as Vec2), holes: [] }, kinds, pitchDeg: kinds.map(() => undefined), srcEdges: src,
  };
  // 5. faces: envelope pieces, then vertical faces above the wall line
  const faces: RoofFace[] = [];
  pieceLoops.forEach((loop, j) => {
    const [a, b] = pieces[j].pl, g = Math.hypot(a, b);
    faces.push(makeFace(faces.length, 'roof', -1, [], 0, [loop], V, 'xy', g < 1e-12 ? 0 : deg(Math.atan(g)), g < 1e-12 ? NaN : bearing([-a / g, -b / g])));
  });
  ring.forEach((a, e) => {
    if (!profile[e].length) return;
    const b = ring[(e + 1) % ring.length];
    const L = Math.hypot(V[b][0] - V[a][0], V[b][1] - V[a][1]);
    const d: Vec2 = [(V[b][0] - V[a][0]) / L, (V[b][1] - V[a][1]) / L];
    faces.push(makeFace(faces.length, kinds[e] === 'party' ? 'party' : 'gable', e, src[e], 0, [[a, b, ...profile[e].slice().reverse()]], V, d, 90, bearing([d[1], -d[0]])));
  });
  // 6. proxy skeleton on the wall line (attic floors, warnings): plain gabled roof at the main pitch
  const main = params.components!.find((c) => c.role === 'main') ?? params.components![0];
  const cot = 1 / Math.tan(rad(params.pitchDeg ?? main.pitchDeg));
  let sk: Skeleton;
  try { sk = computeSkeleton(prep.poly, { weights: (id) => (kinds[id] === 'eave' ? cot : 0) }); }
  catch { sk = computeSkeleton(prep.poly, { weights: () => cot }); }
  const P = { ...params, pitchDeg: params.pitchDeg ?? main.pitchDeg } as RoofModel['params'];
  return finishModel(prep, P, sk, V, faces, [ring]);
}
