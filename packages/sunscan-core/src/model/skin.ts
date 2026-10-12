// Rendered roof skin: the roof surface extended by the eave overhang (and a small verge on gables), given a
// thickness (sloping soffit + fascia / barge boards) so it reads as a real roof.
//
// Construction: every prepared footprint edge is offset outwards by o_e = δ · w_e, where w_e is the edge's
// initial skeleton speed (cot pitch) and δ = overhang · tan(main pitch) is the eave drop. A roof built on the
// expanded footprint with its eave lowered by δ then has exactly the same planes as the closed solid's roof
// (skeleton time == height above the eave), so the skin's TOP surface coincides with the solid roof inside the
// walls and continues outward. Gable edges (w = 0) get a vertical verge offset, party edges none. The underside is
// the top shifted down by Δz = τ / cos(pitch) (perpendicular thickness τ on the main pitch); boundary edges get
// vertical strips (fascia at eaves, barge boards at verges, inset 1 cm at party walls to avoid z-fighting).
import { buildRoof, type EdgeKind, type RoofModel, type RoofParams } from '../geometry/roof.js';
import { computeSkeleton } from '../geometry/skeleton.js';
import { isSimple, ringArea, type PolygonM, type Ring, type Vec2, type Vec3 } from '../geometry/geom.js';
import type { RoofFaceInfo } from '../types.js';
import { type LayerSet, NO_TAG, planUV } from './builder.js';
import { roofMaterialKey } from './materials.js';
import { type PartGeometry, type RoofBuilder, roofProblem, trianglesFrame } from './part.js';

const rad = (d: number) => (d * Math.PI) / 180;
const VERGE = 0.1;

interface Expanded { poly: PolygonM; kinds: EdgeKind[]; pitch: (number | undefined)[] }

/** Offset every prepared edge outward by off[e]; inserts vertical steps where parallel neighbours differ. */
export function expandFootprint(rings: Ring[], kinds: EdgeKind[], pitch: (number | undefined)[], off: number[]): Expanded {
  const outRings: Ring[] = [];
  const outKinds: EdgeKind[] = [];
  const outPitch: (number | undefined)[] = [];
  let base = 0;
  for (const r of rings) {
    const m = r.length;
    const dir = (i: number): Vec2 => {
      const a = r[i], b = r[(i + 1) % m];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    const pts: Vec2[] = [];
    const ks: EdgeKind[] = [];
    const ps: (number | undefined)[] = [];
    for (let j = 0; j < m; j++) {
      const i = (j - 1 + m) % m;
      const v = r[j];
      const d1 = dir(i), d2 = dir(j);
      const n1: Vec2 = [d1[1], -d1[0]], n2: Vec2 = [d2[1], -d2[0]];
      const o1 = off[base + i], o2 = off[base + j];
      const s = d1[0] * d2[1] - d1[1] * d2[0];
      const p1: Vec2 = [v[0] + n1[0] * o1, v[1] + n1[1] * o1];
      const p2: Vec2 = [v[0] + n2[0] * o2, v[1] + n2[1] * o2];
      let two = false;
      if (Math.abs(s) < Math.sin(rad(8))) {
        if (Math.abs(o1 - o2) < 1e-9) pts.push(p1);
        else two = true;
      } else {
        // intersection of p1 + t d1 and p2 + u d2
        const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / s;
        const q: Vec2 = [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
        if (Math.hypot(q[0] - v[0], q[1] - v[1]) > 4 * Math.max(o1, o2) + 0.05) two = true; // miter limit -> bevel
        else pts.push(q);
      }
      if (two) { pts.push(p1, p2); ks.push('gable'); ps.push(undefined); }
      ks.push(kinds[base + j]);
      ps.push(pitch[base + j]);
    }
    // ks/ps were pushed per vertex j as [step?, edge j]; ring edge k goes from pts[k] to pts[k+1]:
    // a step sits between the two points of vertex j, edge j between vertex j's last point and vertex j+1's first.
    outRings.push(pts);
    outKinds.push(...ks);
    outPitch.push(...ps);
    base += m;
  }
  return { poly: { outer: outRings[0], holes: outRings.slice(1) }, kinds: outKinds, pitch: outPitch };
}

function validExpansion(orig: Ring[], ex: Expanded): boolean {
  const rings = [ex.poly.outer, ...(ex.poly.holes ?? [])];
  if (rings.some((r) => r.length < 3 || r.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))) return false;
  if (ringArea(ex.poly.outer) < ringArea(orig[0]) - 1e-6) return false;
  for (let k = 1; k < rings.length; k++) if (ringArea(rings[k]) >= -1e-6 || Math.abs(ringArea(rings[k])) > Math.abs(ringArea(orig[k])) + 1e-6) return false;
  return isSimple(ex.poly);
}

/** Effective edge kinds used by buildRoof (skillion keeps only one eave). */
function effectiveKinds(roof: RoofModel): EdgeKind[] {
  const k = roof.prepared.kinds.slice();
  if (roof.params.type !== 'skillion') return k;
  let low = k.findIndex((x) => x === 'eave');
  if (low < 0) low = 0;
  return k.map((x, i) => (i === low ? 'eave' : x === 'party' ? 'party' : 'gable'));
}

/**
 * Skin roof model (relative heights, like pg.roof) and its eave drop; falls back to the solid's roof when the expanded
 * roof cannot be built, does not reproduce the solid roof, or is not sane (runaway skeleton vertices).
 */
function skinRoof(pg: PartGeometry, overhang: number, build: RoofBuilder): { roof: RoofModel; expanded: boolean } {
  const R = pg.roof, P = R.params;
  const type = P.type;
  const parapet = type === 'flat' && (P.parapetHeight ?? 0) > 0;
  // compound (cross-gable) roofs keep the wall-line roof: their components are not expanded (no overhang in v1)
  if (parapet || !(overhang > 0.005) || P.components?.length) return { roof: R, expanded: false };
  const kinds = effectiveKinds(R);
  const rings = [R.prepared.poly.outer, ...(R.prepared.poly.holes ?? [])];
  const pMain = type === 'gambrel' || type === 'mansard' ? P.lowerPitchDeg ?? (type === 'gambrel' ? 60 : 70) : P.pitchDeg;
  for (const o of [overhang, overhang / 2]) {
    let delta = type === 'flat' ? 0 : o * Math.tan(rad(pMain));
    delta = Math.min(delta, Math.max(0, P.eaveHeight - 0.3));
    const verge = Math.min(VERGE, o);
    const off = kinds.map((k, e) => {
      if (k === 'party') return 0;
      if (type === 'flat') return k === 'eave' ? o : verge;
      const w = R.skeleton.edges[e]?.profile[0]?.w ?? 0;
      if (w > 1e-9) return delta * w;
      return type === 'half-hipped' ? 0 : verge;
    });
    const ex = expandFootprint(rings, kinds, R.prepared.pitchDeg, off);
    if (!validExpansion(rings, ex)) continue;
    const params: RoofParams = { ...P, eaveHeight: P.eaveHeight - delta, edgePitchDeg: ex.pitch };
    if (type === 'gambrel' || type === 'mansard') params.breakHeight = (P.breakHeight ?? (type === 'gambrel' ? 1.8 : 2.4)) + delta;
    if (type === 'pyramidal') params.apexHeight = maxZ(R) - P.eaveHeight + delta;
    if (type === 'half-hipped') params.halfHipFraction = halfHipFraction(R, kinds, delta);
    if (type === 'dutch-gable') params.halfHipFraction = dutchFraction(R, kinds, delta);
    try {
      const S = build(ex.poly, ex.kinds, params);
      if (S.skeleton.stats.warnings.length || roofProblem(S, ex.poly) || !coincident(R, S)) continue;
      return { roof: S, expanded: true };
    } catch {
      continue;
    }
  }
  return { roof: R, expanded: false };
}

const maxZ = (R: RoofModel) => R.vertices.reduce((m, v) => Math.max(m, v[2]), -Infinity);

function halfHipFraction(R: RoofModel, kinds: EdgeKind[], delta: number): number {
  const f = R.params.halfHipFraction ?? 0.6;
  const g = R.faces.find((fc) => fc.kind === 'gable' && fc.seg === 0 && kinds[fc.edge] === 'gable');
  if (!g) return f;
  const tb = g.loops.flat().reduce((m, i) => Math.max(m, R.vertices[i][2]), -Infinity) - R.params.eaveHeight; // = f * hmax
  const hmax = tb / f;
  return hmax + delta > 0 ? (tb + delta) / (hmax + delta) : f;
}

function dutchFraction(R: RoofModel, kinds: EdgeKind[], delta: number): number {
  const f = R.params.halfHipFraction ?? 0.6;
  const pitch = (i: number) => R.prepared.pitchDeg[i] ?? R.params.pitchDeg;
  const sk = computeSkeleton(R.prepared.poly, { weights: (id) => (kinds[id] === 'party' ? 0 : 1 / Math.tan(rad(pitch(id)))) });
  const H = sk.maxTime;
  return H + delta > 0 ? (f * H + delta) / (H + delta) : f;
}

/** The expanded roof must reproduce the solid roof inside the footprint (sampled at face centroids). */
function coincident(R: RoofModel, S: RoofModel): boolean {
  for (const f of R.faces) {
    if (f.kind !== 'roof' && f.kind !== 'flat') continue;
    const { centroid } = trianglesFrame(R.vertices, f.triangles);
    const p: Vec2 = [centroid[0], centroid[1]];
    const a = R.heightAt(p), b = S.heightAt(p);
    if (a === null) continue;
    if (b === null || Math.abs(a - b) > 0.02) return false;
  }
  return true;
}

/**
 * Emit the part's roof skin layers ('roof-skin' kind): top (roof material; flat pockets as 'roof-flat'),
 * underside + fascia ('roof-underside'). Top triangles are tagged with the matching RoofFaceInfo id.
 */
export function emitRoofSkin(pg: PartGeometry, set: LayerSet, partRoofFaces: RoofFaceInfo[], thickness = 0.15, build: RoofBuilder = buildRoof): { expanded: boolean } {
  const pid = pg.part.id;
  const overhang = Number.isFinite(pg.part.overhang) ? Math.min(Math.max(pg.part.overhang, 0), 1.5) : 0;
  const { roof: S, expanded } = skinRoof(pg, overhang, build);
  const P = S.params;
  const isFlatType = P.type === 'flat';
  const dz = isFlatType ? thickness : thickness / Math.cos(rad(Math.min(P.pitchDeg, 60)));
  const roofMat = roofMaterialKey(pg.part.material?.roof);
  const top = set.get({ id: `${pid}/roof-skin`, kind: 'roof-skin', material: roofMat, partId: pid });
  const topFlat = roofMat === 'roof-flat' ? top : set.get({ id: `${pid}/roof-skin-flat`, kind: 'roof-skin', material: 'roof-flat', partId: pid });
  const under = set.get({ id: `${pid}/roof-skin-underside`, kind: 'roof-skin', material: 'roof-underside', partId: pid });
  const V = S.vertices.map((v): Vec3 => [v[0], v[1], v[2] + pg.base]);
  const dir = new Set<string>();
  const verticalKind = new Map<string, string>();
  const key = (u: number, v: number) => (u < v ? `${u},${v}` : `${v},${u}`);
  for (const f of S.faces) {
    if (f.kind === 'roof' || f.kind === 'flat') {
      for (const [a, b, c] of f.triangles) { dir.add(`${a},${b}`); dir.add(`${b},${c}`); dir.add(`${c},${a}`); }
    } else if (f.kind !== 'parapet-top') {
      for (const [a, b, c] of f.triangles) for (const [u, v] of [[a, b], [b, c], [c, a]]) verticalKind.set(key(u, v), f.kind);
    }
  }
  for (const f of S.faces) {
    if (f.kind !== 'roof' && f.kind !== 'flat') continue;
    const fr = trianglesFrame(V, f.triangles);
    const tag = matchFace(fr.normal, V[f.triangles[0][0]], partRoofFaces);
    const layer = f.kind === 'flat' ? topFlat : top;
    const map = new Map<number, number>();
    const vid = (g: number) => {
      let x = map.get(g);
      if (x === undefined) { x = layer.vertex(V[g], fr.normal, planUV(V[g])); map.set(g, x); }
      return x;
    };
    const down: Vec3 = [-fr.normal[0], -fr.normal[1], -fr.normal[2]];
    const umap = new Map<number, number>();
    const uid = (g: number) => {
      let x = umap.get(g);
      if (x === undefined) { const p: Vec3 = [V[g][0], V[g][1], V[g][2] - dz]; x = under.vertex(p, down, planUV(p)); umap.set(g, x); }
      return x;
    };
    for (const [a, b, c] of f.triangles) {
      layer.triangle(vid(a), vid(b), vid(c), tag);
      under.triangle(uid(a), uid(c), uid(b), tag);
      // boundary edges of the top surface -> vertical strips (fascia / verge / party / step)
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        if (dir.has(`${v},${u}`)) continue;
        const kind = verticalKind.get(key(u, v)) ?? 'eave';
        const U = V[u], W = V[v];
        let sx = 0, sy = 0;
        // strips lying in an external wall plane (party walls, or no overhang) would z-fight with the wall
        if (kind === 'party' || onWallPlane(pg, [(U[0] + W[0]) / 2, (U[1] + W[1]) / 2])) {
          const l = Math.hypot(W[0] - U[0], W[1] - U[1]) || 1;
          sx = (-(W[1] - U[1]) / l) * 0.01; sy = ((W[0] - U[0]) / l) * 0.01; // 1 cm towards the roof (left)
        }
        under.quad([U[0] + sx, U[1] + sy, U[2] - dz], [W[0] + sx, W[1] + sy, W[2] - dz], [W[0] + sx, W[1] + sy, W[2]], [U[0] + sx, U[1] + sy, U[2]], undefined, undefined, NO_TAG);
      }
    }
  }
  return { expanded };
}

/** True if a plan point lies on one of the part's external wall lines (within 2 mm). */
function onWallPlane(pg: PartGeometry, p: Vec2): boolean {
  for (const w of pg.walls) {
    const t = (p[0] - w.a[0]) * w.d[0] + (p[1] - w.a[1]) * w.d[1];
    if (t < -0.002 || t > w.length + 0.002) continue;
    if (Math.abs((p[0] - w.a[0]) * w.n[0] + (p[1] - w.a[1]) * w.n[1]) < 0.002) return true;
  }
  return false;
}

/** RoofFaceInfo id whose plane contains the given face (same normal, point on plane), else NO_TAG. */
function matchFace(n: Vec3, p: Vec3, faces: RoofFaceInfo[]): number {
  for (const f of faces) {
    const dn = Math.abs(f.normal[0] - n[0]) + Math.abs(f.normal[1] - n[1]) + Math.abs(f.normal[2] - n[2]);
    if (dn > 1e-4) continue;
    const d = (p[0] - f.centroid[0]) * n[0] + (p[1] - f.centroid[1]) * n[1] + (p[2] - f.centroid[2]) * n[2];
    if (Math.abs(d) < 2e-3) return f.id;
  }
  return NO_TAG;
}
