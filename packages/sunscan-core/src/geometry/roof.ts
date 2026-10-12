// Roof synthesis on top of the weighted straight skeleton.
//   eave edge  -> pitched face (speed w = cot(pitch), so skeleton time == height above the eave)
//   gable/party-> vertical face (w = 0)
// Roof types are just per-edge speed profiles (+ optional flat cap):
//   hipped/gabled/skeleton : eave w = cot(p), gable/party 0          (gables come from the edge kinds)
//   half-hipped (jerkinhead): gable 0 up to f*gableHeight, then cot(hipPitch)
//   dutch-gable (gablet)    : gable edges hip first, then vertical above f*height
//   gambrel / mansard       : eaves cot(lower) up to breakHeight, then cot(upper) (mansard flatTop -> cap)
//   skillion               : one eave, everything else vertical
//   pyramidal               : eave w_e = dist(apex, edge line) / apexHeight  (homothetic shrink -> one apex)
//   flat (+parapet)         : all w = 0 -> cap at t = 0 ; parapet via a w = 1 skeleton capped at thickness
import { computeSkeleton, faceKey, loopAreaXY, SKELETON_RETRY_SNAPS, SkeletonError, type ProfileSeg, type Skeleton, type SkEdge } from './skeleton.js';
import { triangulateLoops } from './triangulate.js';
import { buildCompoundRoof } from './compound.js';
import {
  type PolygonM, type Ring, type Vec2, type Vec3, cross, dot, normalize, sub, ringArea, pointInRing, rad, deg, bboxDiag, polygonArea,
} from './geom.js';

export type EdgeKind = 'eave' | 'gable' | 'party';
export type RoofType =
  | 'flat' | 'hipped' | 'gabled' | 'skeleton' | 'half-hipped' | 'dutch-gable' | 'pyramidal' | 'skillion' | 'gambrel' | 'mansard';

export interface RoofParams {
  type: RoofType;
  eaveHeight: number; // wall-top height above ground (m)
  pitchDeg?: number; // main pitch of eave faces (default 35)
  edgePitchDeg?: (number | undefined)[]; // optional per-edge override (indexed like the input footprint edges)
  halfHipFraction?: number; // half-hipped / dutch: fraction of the gable height where the profile switches (default 0.6)
  hipPitchDeg?: number; // half-hipped: pitch of the clipped hip (default = pitchDeg + 10)
  lowerPitchDeg?: number; // gambrel / mansard lower slope (default 60 / 70)
  upperPitchDeg?: number; // gambrel / mansard upper slope (default 25)
  breakHeight?: number; // height of the slope break above the eave (default 1.8 gambrel / 2.4 mansard)
  flatTop?: boolean; // mansard: flat top at breakHeight
  apexHeight?: number; // pyramidal: apex height above the eave (default from pitch on the nearest edge)
  parapetHeight?: number; // flat: parapet height above the roof deck (0 = none)
  parapetThickness?: number; // flat: parapet thickness (default 0.25)
  /** Compound roof: upper envelope of gabled components at eaveHeight, clipped to the (convex) footprint. */
  components?: RoofComponent[];
}

/** One gabled component of a compound roof (a gable over a rectangle: two parallel eave edges). */
export interface RoofComponent {
  role: 'main' | 'cross';
  footprint: PolygonM; // same frame as the part footprint
  edgeKinds: EdgeKind[]; // 'eave' on the two sides parallel to the ridge, 'gable' on the ends
  pitchDeg: number;
}

export interface PrepOptions { minEdge?: number; collinearTolDeg?: number; snapDist?: number }

export interface PreparedFootprint {
  poly: PolygonM; // outer CCW, holes CW, cleaned
  kinds: EdgeKind[]; // per prepared edge (outer edges first, then holes)
  pitchDeg: (number | undefined)[]; // per prepared edge override
  srcEdges: number[][]; // prepared edge -> original edge indices (input order, after re-orientation mapping)
}

export type FaceKind = 'roof' | 'gable' | 'party' | 'riser' | 'flat' | 'parapet-top' | 'parapet-inner' | 'wall' | 'floor';

export interface RoofFace {
  id: number;
  kind: FaceKind;
  edge: number; // prepared edge index (-1 for cap / parapet-inner)
  srcEdges: number[]; // original footprint edge indices
  seg: number; // profile segment
  loops: number[][]; // vertex-index loops into RoofModel.vertices (outer CCW in the face frame, holes CW)
  frame: 'xy' | Vec2; // 2D frame used to triangulate: plan view, or vertical plane with horizontal axis s
  triangles: [number, number, number][]; // vertex indices, outward-facing
  pitchDeg: number; // design pitch (90 vertical, 0 flat)
  azimuthDeg: number; // compass bearing of the downslope / facing direction (0 = N, 90 = E); NaN for flat
  planArea: number; // horizontal projected area (0 for vertical faces)
  area: number; // true 3D area
}

export interface RoofModel {
  prepared: PreparedFootprint;
  params: Required<Pick<RoofParams, 'type' | 'eaveHeight' | 'pitchDeg'>> & RoofParams;
  skeleton: Skeleton;
  vertices: Vec3[];
  faces: RoofFace[];
  /** For each prepared ring, the roof vertex index on top of each footprint vertex (= wall top). */
  ringTop: number[][];
  /** Plan-view sloped/flat faces for point queries. */
  heightAt(p: Vec2): number | null;
  /** Face id containing p (plan view), or -1. */
  faceAt(p: Vec2): number;
}

const DEF = { pitchDeg: 35 };

// ---------------------------------------------------------------- footprint preparation
export function prepareFootprint(input: PolygonM, kinds: EdgeKind[], pitch: (number | undefined)[] = [], opts: PrepOptions = {}): PreparedFootprint {
  const minEdge = opts.minEdge ?? 1e-3;
  const tolSin = Math.sin(rad(opts.collinearTolDeg ?? 0.5));
  const rings = [input.outer, ...(input.holes ?? [])];
  let base = 0;
  const outRings: Ring[] = [];
  const outKinds: EdgeKind[] = [];
  const outPitch: (number | undefined)[] = [];
  const outSrc: number[][] = [];
  rings.forEach((r0, ri) => {
    const n0 = r0.length;
    // edge records in input order
    let pts = r0.map((p) => [...p] as Vec2);
    let rec = pts.map((_, i) => ({ k: kinds[base + i] ?? 'eave', p: pitch[base + i], src: [base + i] }));
    const wantCCW = ri === 0;
    if ((ringArea(pts) > 0) !== wantCCW) {
      // reverse ring; edge j of reversed ring = original edge (n-2-j) mod n
      const n = pts.length;
      pts = pts.slice().reverse();
      rec = pts.map((_, j) => rec[(((n - 2 - j) % n) + n) % n]);
    }
    // drop duplicate vertices (edge shorter than minEdge): merge its record into the previous edge
    let changed = true;
    while (changed && pts.length > 3) {
      changed = false;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        if (Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]) < minEdge) {
          const prev = (i - 1 + pts.length) % pts.length;
          rec[prev] = { ...rec[prev], src: [...rec[prev].src, ...rec[i].src] };
          pts.splice(j, 1);
          rec.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    // merge collinear consecutive edges of the same kind/pitch (vertex j between edge j-1 and edge j)
    changed = true;
    while (changed && pts.length > 3) {
      changed = false;
      for (let j = 0; j < pts.length; j++) {
        const i = (j - 1 + pts.length) % pts.length, k = (j + 1) % pts.length;
        const d1 = normalize(sub(pts[j], pts[i])), d2 = normalize(sub(pts[k], pts[j]));
        if (Math.abs(cross(d1, d2)) < tolSin && dot(d1, d2) > 0 && rec[i].k === rec[j].k && rec[i].p === rec[j].p) {
          rec[i] = { ...rec[i], src: [...rec[i].src, ...rec[j].src] };
          pts.splice(j, 1);
          rec.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
    // near-collinear junction between edges of DIFFERENT kind/pitch (kept separate above): snap the vertex onto the
    // line through its neighbours when it deviates < snapDist, so the engine sees exact collinearity (vertical riser)
    // instead of a nearly-parallel pair whose junction vertex races along the line (sliver faces).
    const snapDist = opts.snapDist ?? 0.01;
    for (let j = 0; j < pts.length; j++) {
      const i = (j - 1 + pts.length) % pts.length, k = (j + 1) % pts.length;
      const d = normalize(sub(pts[k], pts[i]));
      const v = sub(pts[j], pts[i]);
      const dev = Math.abs(cross(d, v));
      const d1 = normalize(sub(pts[j], pts[i])), d2 = normalize(sub(pts[k], pts[j]));
      if (dev > 0 && dev < snapDist && dot(d1, d2) > 0 && Math.abs(cross(d1, d2)) < tolSin) {
        const tproj = dot(v, d);
        pts[j] = [pts[i][0] + d[0] * tproj, pts[i][1] + d[1] * tproj];
      }
    }
    outRings.push(pts);
    for (const r of rec) { outKinds.push(r.k); outPitch.push(r.p); outSrc.push(r.src); }
    base += n0;
  });
  return { poly: { outer: outRings[0], holes: outRings.slice(1) }, kinds: outKinds, pitchDeg: outPitch, srcEdges: outSrc };
}

/** Heuristic gable assignment: an eave whose hipped face is a triangle ending on a horizontal ridge becomes a gable. */
export function autoGableKinds(poly: PolygonM, kinds?: EdgeKind[]): EdgeKind[] {
  const prep = prepareFootprint(poly, kinds ?? poly.outer.map(() => 'eave'));
  const sk = computeSkeleton(prep.poly, { weights: (id) => (prep.kinds[id] === 'eave' ? 1 : 0) });
  const out = [...prep.kinds];
  const S = bboxDiag(prep.poly);
  for (const f of sk.faces) {
    if (f.seg !== 0 || f.edge < 0 || prep.kinds[f.edge] !== 'eave' || f.loops.length !== 1) continue;
    const loop = f.loops[0];
    if (loop.length !== 3) continue;
    const apex = loop.find((id) => sk.nodes[id].t > 1e-9 * S)!;
    // ridge: a horizontal arc leaving the apex
    const ridge = sk.arcs.some((a) => (a.u === apex || a.v === apex) && Math.abs(sk.nodes[a.u].t - sk.nodes[a.v].t) < 1e-9 * S && a.u !== a.v);
    if (ridge) out[f.edge] = 'gable';
  }
  // map back to input edge order (prepared edges may merge input edges)
  const res: EdgeKind[] = (kinds ?? poly.outer.map(() => 'eave')).slice();
  prep.srcEdges.forEach((src, i) => src.forEach((s) => (res[s] = out[i])));
  return res;
}

// ---------------------------------------------------------------- roof
/**
 * Roof model of a footprint (local metres) with per-edge kinds. Every returned roof is validated: skeleton nodes inside
 * the footprint, bounded heights, faces tiling the footprint in plan and triangulated without losing nodes (so
 * buildSolid gives a watertight solid). Near-degenerate inputs may be recomputed in the footprint's dominant-axis
 * frame with walls snapped by up to 1 mm; `prepared.poly` is then the polygon actually used and
 * `skeleton.stats.snap` / `skeleton.stats.notes` record it.
 * @throws SkeletonError when no valid roof can be built (callers should fall back, e.g. to a flat roof).
 */
export function buildRoof(footprint: PolygonM, edgeKinds: EdgeKind[], params: RoofParams, prepOpts: PrepOptions = {}): RoofModel {
  if (params.components?.length) return buildCompoundRoof(footprint, edgeKinds, params);
  const P = { pitchDeg: DEF.pitchDeg, ...params };
  const prep = prepareFootprint(footprint, edgeKinds, P.edgePitchDeg ?? [], prepOpts);
  const nE = prep.kinds.length;
  const H = P.eaveHeight;
  const cot = (d: number) => 1 / Math.tan(rad(d));
  const eavePitch = (i: number) => prep.pitchDeg[i] ?? P.pitchDeg;
  let kinds = prep.kinds.slice();
  if (P.type === 'skillion') {
    // exactly one low eave: the first eave edge (or the longest edge if none is marked)
    let low = kinds.findIndex((k) => k === 'eave');
    if (low < 0) low = 0;
    kinds = kinds.map((k, i) => (i === low ? 'eave' : k === 'party' ? 'party' : 'gable'));
  }
  if (P.type === 'flat') {
    return buildFlat(prep, P);
  }

  let profiles: ProfileSeg[][] = kinds.map((k, i) => (k === 'eave' ? [{ t0: 0, w: cot(eavePitch(i)) }] : [{ t0: 0, w: 0 }]));
  let capTime: number | undefined;

  if (P.type === 'half-hipped' || P.type === 'dutch-gable') {
    // need the gable height of each gable edge: run the plain gabled roof first
    const base = computeSkeleton(prep.poly, { weights: (id) => profiles[id] });
    const f = P.halfHipFraction ?? 0.6;
    const hipPitch = P.hipPitchDeg ?? Math.min(P.pitchDeg + 10, 80);
    profiles = profiles.map((pr, i) => {
      if (kinds[i] !== 'gable') return pr;
      if (P.type === 'half-hipped') {
        const face = base.faces.find((fc) => fc.edge === i && fc.seg === 0);
        const hmax = face ? Math.max(...face.loops.flat().map((id) => base.nodes[id].t)) : 0;
        return hmax > 0 ? [{ t0: 0, w: 0 }, { t0: f * hmax, w: cot(hipPitch) }] : pr;
      }
      // dutch gable: hip at the eave pitch, vertical gablet above f * (hipped roof height of that face)
      return [{ t0: 0, w: cot(eavePitch(i)) }, { t0: f * maxHeightHipped(prep, eavePitch), w: 0 }];
    });
  } else if (P.type === 'gambrel' || P.type === 'mansard') {
    const lower = P.lowerPitchDeg ?? (P.type === 'gambrel' ? 60 : 70);
    const upper = P.upperPitchDeg ?? 25;
    const hb = P.breakHeight ?? (P.type === 'gambrel' ? 1.8 : 2.4);
    profiles = kinds.map((k) => (k === 'eave' ? [{ t0: 0, w: cot(lower) }, { t0: hb, w: cot(upper) }] : [{ t0: 0, w: 0 }]));
    if (P.type === 'mansard' && P.flatTop) capTime = hb;
  } else if (P.type === 'pyramidal') {
    const apex = pyramidApex(prep.poly);
    const E = edgeLines(prep.poly);
    const dmin = Math.min(...E.filter((_, i) => kinds[i] === 'eave').map((e) => dot(e.n, apex) - e.c));
    const h = P.apexHeight ?? dmin * Math.tan(rad(P.pitchDeg));
    profiles = kinds.map((k, i) => (k === 'eave' ? [{ t0: 0, w: (dot(E[i].n, apex) - E[i].c) / h }] : [{ t0: 0, w: 0 }]));
  }

  return robustRoof(prep, P, (alignSnap) => computeSkeleton(prep.poly, { weights: (id) => profiles[id], capTime, alignSnap }), (sk, pr) => {
    const vertices: Vec3[] = sk.nodes.map((n) => [n.x, n.y, H + n.t]);
    const faces: RoofFace[] = [];
    for (const f of sk.faces) {
      const e: SkEdge | undefined = f.edge >= 0 ? sk.edges[f.edge] : undefined;
      const isCap = f.key === 'cap';
      const w = isCap ? NaN : f.w;
      const vertical = !isCap && w === 0;
      const kind: FaceKind = isCap ? 'flat' : vertical ? (e!.virtual ? 'riser' : kinds[f.edge] === 'party' ? 'party' : 'gable') : 'roof';
      const out = e ? [-e.n[0], -e.n[1]] : [0, 0];
      faces.push(makeFace(faces.length, kind, e && !e.virtual ? f.edge : -1, e && !e.virtual ? pr.srcEdges[f.edge] : [], f.seg, f.loops, vertices,
        vertical ? e!.d : 'xy', isCap ? 0 : vertical ? 90 : deg(Math.atan(1 / w)), isCap ? NaN : bearing(out as Vec2)));
    }
    return { vertices, faces };
  });
}

/**
 * Roof-level checks after triangulation: every face keeps all of its boundary nodes (else the solid has a crack) and
 * the non-vertical faces tile the footprint in plan exactly once (signed and absolute area within 1e-6).
 */
function roofIssues(prep: PreparedFootprint, faces: RoofFace[], V: Vec3[]): string[] {
  const issues: string[] = [];
  let plan = 0, planAbs = 0;
  for (const f of faces) {
    const used = new Set(f.triangles.flat());
    const lost = f.loops.flat().filter((id) => !used.has(id)).length;
    if (lost) issues.push(`face ${f.id} (${f.kind}) lost ${lost} boundary node(s) in triangulation`);
    if (f.frame !== 'xy') continue;
    for (const [a, b, c] of f.triangles) {
      const z = ((V[b][0] - V[a][0]) * (V[c][1] - V[a][1]) - (V[b][1] - V[a][1]) * (V[c][0] - V[a][0])) / 2;
      plan += z; planAbs += Math.abs(z);
    }
  }
  const A = polygonArea(prep.poly);
  if (!(Math.abs(plan - A) <= 1e-6 * A && Math.abs(planAbs - A) <= 1e-6 * A)) issues.push(`roof faces do not tile the footprint (plan area ${plan}, |area| ${planAbs}, footprint ${A})`);
  return issues;
}

/**
 * Skeleton -> faces with roof-level validation. A rejected result is rebuilt from the skeleton of the polygon's
 * dominant-axis frame with larger wall snaps (SKELETON_RETRY_SNAPS); the walls then use that (snapped) polygon so the
 * solid stays watertight. Throws SkeletonError when no attempt is valid: callers never get an exploding roof.
 */
function robustRoof(
  prep: PreparedFootprint, P: RoofModel['params'],
  skeleton: (alignSnap: number | undefined) => Skeleton,
  build: (sk: Skeleton, prep: PreparedFootprint) => { vertices: Vec3[]; faces: RoofFace[] },
): RoofModel {
  const issues: string[] = [];
  let snap: number | undefined;
  let attempts = 0;
  for (;;) {
    let sk: Skeleton;
    try {
      sk = skeleton(snap);
    } catch (e) {
      if (!(e instanceof SkeletonError)) throw e;
      throw new SkeletonError(`roof skeleton: ${e.message}`, [...issues, ...e.issues], attempts + e.attempts, e.skeleton);
    }
    attempts += sk.stats.attempts;
    const used: PreparedFootprint = sk.stats.snap === undefined ? prep : { ...prep, poly: sk.poly };
    let bad: string[];
    try {
      const { vertices, faces } = build(sk, used);
      bad = roofIssues(used, faces, vertices);
      if (!bad.length) {
        for (const m of issues) sk.stats.notes.push(`rejected roof attempt: ${m}`);
        return finishModel(used, P, sk, vertices, faces, ringTopNodes(used.poly, sk));
      }
    } catch (e) {
      bad = [`face triangulation failed: ${(e as Error).message}`];
    }
    issues.push(`attempt ${attempts}${sk.stats.snap === undefined ? '' : ` (dominant-axis frame, snap ${sk.stats.snap} m)`}: ${bad.join('; ')}`);
    const next = SKELETON_RETRY_SNAPS.find((s) => s > (sk.stats.snap ?? 0));
    if (next === undefined) break;
    snap = next;
  }
  throw new SkeletonError(`roof invalid after ${attempts} attempt(s): ${issues[issues.length - 1]}`, issues, attempts);
}

function maxHeightHipped(prep: PreparedFootprint, eavePitch: (i: number) => number): number {
  const sk = computeSkeleton(prep.poly, { weights: (id) => (prep.kinds[id] === 'party' ? 0 : 1 / Math.tan(rad(eavePitch(id)))) });
  return sk.maxTime;
}

/** Apex for pyramidal roofs: centroid if comfortably inside, else the deepest skeleton node. */
export function pyramidApex(poly: PolygonM): Vec2 {
  let A = 0, cx = 0, cy = 0;
  const r = poly.outer;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const c = a[0] * b[1] - b[0] * a[1];
    A += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
  }
  const c: Vec2 = [cx / (3 * A), cy / (3 * A)];
  const sk = computeSkeleton(poly, { weights: () => 1 });
  const E = edgeLines(poly);
  const inr = sk.maxTime;
  const dC = Math.min(...E.map((e) => dot(e.n, c) - e.c));
  const inside = pointInRing(c, poly.outer) && !(poly.holes ?? []).some((h) => pointInRing(c, h));
  if (inside && dC > 0.5 * inr) return c;
  const deepest = sk.nodes.reduce((m, n) => (n.t > m.t ? n : m), sk.nodes[0]);
  return [deepest.x, deepest.y];
}

function edgeLines(poly: PolygonM) {
  const out: { n: Vec2; c: number; d: Vec2 }[] = [];
  for (const r of [poly.outer, ...(poly.holes ?? [])])
    r.forEach((a, i) => {
      const d = normalize(sub(r[(i + 1) % r.length], a));
      const n: Vec2 = [-d[1], d[0]];
      out.push({ n, c: dot(n, a), d });
    });
  return out;
}

/** Compass bearing (deg, 0 = north, 90 = east) of a plan direction. */
export const bearing = (v: Vec2) => (deg(Math.atan2(v[0], v[1])) + 360) % 360;

function ringTopNodes(poly: PolygonM, sk: Skeleton): number[][] {
  const res: number[][] = [];
  for (const r of [poly.outer, ...(poly.holes ?? [])]) {
    res.push(r.map((p) => {
      let best = -1, bd = Infinity;
      sk.nodes.forEach((n, i) => {
        if (n.t !== 0) return;
        const d = Math.hypot(n.x - p[0], n.y - p[1]);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }));
  }
  return res;
}

export function makeFace(id: number, kind: FaceKind, edge: number, srcEdges: number[], seg: number, loops: number[][], V: Vec3[], frame: 'xy' | Vec2, pitchDeg: number, azimuthDeg: number): RoofFace {
  const to2 = (i: number): Vec2 => (frame === 'xy' ? [V[i][0], V[i][1]] : [frame[0] * V[i][0] + frame[1] * V[i][1], V[i][2]]);
  // compact local index space for the triangulator
  const ids = [...new Set(loops.flat())];
  const local = new Map(ids.map((g, k) => [g, k]));
  const pts = ids.map(to2);
  const tris = triangulateLoops(pts, loops.map((l) => l.map((g) => local.get(g)!))).map((t) => t.map((k) => ids[k]) as [number, number, number]);
  let area = 0, planArea = 0;
  for (const [a, b, c] of tris) {
    const u = sub3(V[b], V[a]), v = sub3(V[c], V[a]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    area += Math.hypot(n[0], n[1], n[2]) / 2;
    planArea += n[2] / 2;
  }
  return { id, kind, edge, srcEdges, seg, loops, frame, triangles: tris, pitchDeg, azimuthDeg, planArea, area };
}
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function finishModel(prep: PreparedFootprint, P: RoofModel['params'], sk: Skeleton, vertices: Vec3[], faces: RoofFace[], ringTop: number[][]): RoofModel {
  // plan-view query structure: non-vertical faces with their xy loops and bbox
  const q = faces
    .filter((f) => f.frame === 'xy' && f.planArea > 1e-12 && f.kind !== 'parapet-top')
    .map((f) => {
      const loops = f.loops.map((l) => l.map((i) => [vertices[i][0], vertices[i][1]] as Vec2));
      const xs = loops.flat().map((p) => p[0]), ys = loops.flat().map((p) => p[1]);
      // plane z = a x + b y + c from the face's triangles (exact for planar faces)
      const [i0, i1, i2] = f.triangles.reduce((best, t) => (triArea(vertices, t) > triArea(vertices, best) ? t : best), f.triangles[0]);
      const pl = planeThrough(vertices[i0], vertices[i1], vertices[i2]);
      return { f, loops, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], pl };
    });
  const faceAtIdx = (p: Vec2) => {
    for (let k = 0; k < q.length; k++) {
      const { loops, bb } = q[k];
      if (p[0] < bb[0] - 1e-9 || p[0] > bb[2] + 1e-9 || p[1] < bb[1] - 1e-9 || p[1] > bb[3] + 1e-9) continue;
      let inside = false;
      for (const l of loops) if (pointInRing(p, l)) inside = !inside;
      if (inside) return k;
    }
    return -1;
  };
  return {
    prepared: prep, params: P, skeleton: sk, vertices, faces, ringTop,
    heightAt(p) {
      const k = faceAtIdx(p);
      if (k < 0) return null;
      const pl = q[k].pl;
      return pl[0] * p[0] + pl[1] * p[1] + pl[2];
    },
    faceAt(p) { const k = faceAtIdx(p); return k < 0 ? -1 : q[k].f.id; },
  };
}
const triArea = (V: Vec3[], t: [number, number, number]) => {
  const u = sub3(V[t[1]], V[t[0]]), v = sub3(V[t[2]], V[t[0]]);
  return Math.abs(u[0] * v[1] - u[1] * v[0]);
};
function planeThrough(a: Vec3, b: Vec3, c: Vec3): [number, number, number] {
  const u = sub3(b, a), v = sub3(c, a);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const A = -n[0] / n[2], B = -n[1] / n[2];
  return [A, B, a[2] - A * a[0] - B * a[1]];
}

// ---------------------------------------------------------------- flat roof (+ parapet)
function buildFlat(prep: PreparedFootprint, P: RoofModel['params']): RoofModel {
  const H = P.eaveHeight;
  const ph = P.parapetHeight ?? 0;
  if (ph <= 0) {
    // nothing moves -> cap at t = 0
    return robustRoof(prep, P, (alignSnap) => computeSkeleton(prep.poly, { weights: () => 0, alignSnap }), (sk) => {
      const vertices: Vec3[] = sk.nodes.map((n) => [n.x, n.y, H]);
      const faces: RoofFace[] = [];
      for (const f of sk.faces) if (f.key === 'cap') faces.push(makeFace(0, 'flat', -1, [], 0, f.loops, vertices, 'xy', 0, NaN));
      return { vertices, faces };
    });
  }
  // parapet: band between the footprint and its inward offset (thickness) at H + ph; roof deck (cap) at H
  const th = P.parapetThickness ?? 0.25;
  return robustRoof(prep, P, (alignSnap) => computeSkeleton(prep.poly, { weights: () => 1, capTime: th, alignSnap }), (sk, pr) => {
    const top = H + ph;
    const vertices: Vec3[] = sk.nodes.map((n) => [n.x, n.y, top]);
    const low = new Map<number, number>(); // node id -> duplicate vertex at deck level
    const lowOf = (id: number) => {
      let v = low.get(id);
      if (v === undefined) { v = vertices.length; vertices.push([sk.nodes[id].x, sk.nodes[id].y, H]); low.set(id, v); }
      return v;
    };
    const faces: RoofFace[] = [];
    for (const f of sk.faces) {
      if (f.key === 'cap') {
        faces.push(makeFace(faces.length, 'flat', -1, [], 0, f.loops.map((l) => l.map(lowOf)), vertices, 'xy', 0, NaN));
      } else {
        faces.push(makeFace(faces.length, 'parapet-top', f.edge, pr.srcEdges[f.edge], 0, f.loops, vertices, 'xy', 0, NaN));
      }
    }
    // inner parapet walls along every cap arc (u -> v has the cap on its left; the wall faces the cap)
    for (const a of sk.arcs) {
      if (a.left !== 'cap') continue;
      const u = a.u, v = a.v;
      const d = normalize([sk.nodes[v].x - sk.nodes[u].x, sk.nodes[v].y - sk.nodes[u].y]);
      // faces the deck (left of u->v): with frame axis s = -d the loop v, v_low, u_low, u is CCW in (s, z)
      const s: Vec2 = [-d[0], -d[1]];
      faces.push(makeFace(faces.length, 'parapet-inner', -1, [], 0, [[v, lowOf(v), lowOf(u), u]], vertices, s, 90, bearing([-d[1], d[0]])));
    }
    return { vertices, faces };
  });
}

export { faceKey, loopAreaXY };
