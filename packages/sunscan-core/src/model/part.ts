// Per-part closed solid (floor + walls + roof faces) built with the geometry engine, lifted to the part's base,
// plus its split render views ('walls', 'roof') and the solar-ready roof-face table.
import { buildRoof, type EdgeKind, type RoofModel, type RoofParams } from '../geometry/roof.js';
import { buildSolid, type SolidMesh } from '../geometry/solid.js';
import { checkMesh, type MeshReport } from '../geometry/validate.js';
import type { BuildingPartSpec, PolygonM, RoofFaceInfo, Vec2, Vec3 } from '../types.js';
import { type LayerBuilder, type LayerSet, type UVFn, NO_TAG, cross3, planUV, sub3, unit3, wallUV } from './builder.js';
import { roofMaterialKey, wallMaterialKey } from './materials.js';
import { finite } from './polyops.js';

/** One prepared (cleaned) footprint edge of a part = one external wall plane. */
export interface WallInfo {
  /** Prepared edge index in the part's roof model. */
  edge: number;
  /** Original footprint edge indices merged into this wall (spec edge numbering). */
  srcEdges: number[];
  kind: EdgeKind;
  ring: number;
  a: Vec2;
  b: Vec2;
  /** Unit direction a -> b. */
  d: Vec2;
  /** Unit outward normal (right of a -> b for the CCW outer ring and the CW holes). */
  n: Vec2;
  length: number;
  /** Cumulative ring perimeter at `a` (continuous wall UVs around corners). */
  u0: number;
}

/** A part's roof model, closed solid and wall table (heights absolute above the ground datum). */
export interface PartGeometry {
  part: BuildingPartSpec;
  index: number;
  base: number;
  /** Absolute eave (wall-top) height above the ground datum. */
  eave: number;
  /** Roof model with heights relative to `base`. */
  roof: RoofModel;
  /** Closed solid with absolute heights. */
  solid: SolidMesh;
  report: MeshReport;
  walls: WallInfo[];
  /** Highest point of the solid (absolute). */
  top: number;
  /** Fallback applied when the requested roof was unusable (a flat-topped block replaced it). */
  fallback?: string;
}

const VERTICAL_KINDS = new Set(['wall', 'gable', 'party', 'riser', 'parapet-inner', 'parapet-top']);

/** Sanitised copy of a part's footprint and edge kinds (finite coordinates, one kind per edge). */
export function sanitizeFootprint(part: BuildingPartSpec): { poly: PolygonM; kinds: EdgeKind[] } | null {
  const ok = (r: Vec2[] | undefined) => !!r && r.length >= 3 && r.every((p) => finite(p[0], p[1]));
  if (!ok(part.footprint?.outer)) return null;
  const holes = (part.footprint.holes ?? []).filter(ok);
  const valid = new Set<EdgeKind>(['eave', 'gable', 'party']);
  const kinds: EdgeKind[] = [];
  let base = 0;
  for (const r of [part.footprint.outer, ...(part.footprint.holes ?? [])]) {
    const keep = ok(r);
    for (let i = 0; i < r.length; i++) {
      const k = part.edgeKinds?.[base + i];
      if (keep) kinds.push(k && valid.has(k) ? k : 'eave');
    }
    base += r.length;
  }
  return { poly: { outer: part.footprint.outer.map((p) => [p[0], p[1]] as Vec2), holes: holes.map((h) => h.map((p) => [p[0], p[1]] as Vec2)) }, kinds };
}

/** The geometry engine's roof builder (injectable so tests can simulate engine failures). */
export type RoofBuilder = (poly: PolygonM, kinds: EdgeKind[], params: RoofParams) => RoofModel;

/** Largest plausible rise of a roof above its eave (m); anything higher is a broken skeleton, not a roof. */
export const MAX_ROOF_RISE = 30;
/** Roof vertices may lie outside the footprint's bounding box by at most this much (m). */
export const ROOF_BBOX_TOLERANCE = 3;
/** Skeleton warnings meaning the engine gave up: the result is not trusted even when it looks sane. */
const FATAL_SKELETON_WARNING = /fail|diverg|runaway|unbounded|invalid|abort/i;

const errText = (e: unknown) => (e instanceof Error ? `${e.name && e.name !== 'Error' ? `${e.name}: ` : ''}${e.message}` : String(e));

/** Axis-aligned bounds of a polygon's outer ring: [minX, minY, maxX, maxY]. */
export function ringBounds(ring: Vec2[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

/**
 * Why a roof model built on `poly` is unusable, or null when it is sane: non-finite vertices, runaway vertices (outside
 * the footprint's bounding box by more than ROOF_BBOX_TOLERANCE m), heights outside [0, eave + MAX_ROOF_RISE] (relative
 * to the part base, as built), or a skeleton warning saying the engine gave up.
 */
export function roofProblem(roof: RoofModel, poly: PolygonM): string | null {
  const [x0, y0, x1, y1] = ringBounds(poly.outer);
  const tol = ROOF_BBOX_TOLERANCE;
  const zMax = (Number.isFinite(roof.params?.eaveHeight) ? roof.params.eaveHeight : 0) + MAX_ROOF_RISE;
  let worst = 0, high = -Infinity;
  for (const v of roof.vertices) {
    if (!finite(v[0], v[1], v[2])) return 'non-finite roof vertex';
    worst = Math.max(worst, x0 - v[0], v[0] - x1, y0 - v[1], v[1] - y1);
    if (v[2] < -0.01) return `roof vertex ${v[2].toFixed(2)} m below the part base`;
    high = Math.max(high, v[2]);
  }
  if (worst > tol) return `runaway roof vertex ${worst.toExponential(2)} m outside the footprint`;
  if (high > zMax) return `roof vertex ${high.toExponential(2)} m above the part base (more than ${MAX_ROOF_RISE} m above the eave)`;
  const fatal = (roof.skeleton?.stats?.warnings ?? []).find((w) => FATAL_SKELETON_WARNING.test(w));
  return fatal ? `skeleton: ${fatal}` : null;
}

interface Attempt {
  geom?: { roof: RoofModel; solid: SolidMesh; report: MeshReport };
  problem?: string;
}

/** Roof + lifted closed solid for one set of roof parameters, validated (sane roof, watertight, positive volume). */
function attempt(build: RoofBuilder, fp: { poly: PolygonM; kinds: EdgeKind[] }, params: RoofParams, base: number): Attempt {
  let roof: RoofModel;
  try { roof = build(fp.poly, fp.kinds, params); } catch (e) { return { problem: errText(e) }; }
  const bad = roofProblem(roof, fp.poly);
  if (bad) return { problem: bad };
  let solid: SolidMesh;
  try { solid = buildSolid(roof); } catch (e) { return { problem: `solid failed: ${errText(e)}` }; }
  for (const p of solid.positions) p[2] += base;
  const report = checkMesh(solid);
  const geom = { roof, solid, report };
  if (!report.watertight) return { geom, problem: `solid not watertight (boundary ${report.boundaryEdges}, non-manifold ${report.nonManifoldEdges}, flipped ${report.sameDirectionEdges})` };
  if (!(report.volume > 0)) return { geom, problem: `solid volume ${report.volume}` };
  return { geom };
}

/** Options of {@link buildPartGeometry}. */
export interface PartBuildOptions {
  /**
   * Top (absolute height above the ground datum) of the flat-topped block that replaces an unusable roof: the part's
   * known ridge height when there is one; default (or when implausible) the eave.
   */
  fallbackTop?: number;
  /** Roof builder (default: the geometry engine's buildRoof). */
  build?: RoofBuilder;
}

/**
 * Roof + solid of one part. The roof is validated (engine errors, runaway or implausible vertices, leaky solid); an
 * unusable roof is replaced by a flat-topped block at `opts.fallbackTop` (else the eave) and reported in `issues`, so a
 * broken skeleton never reaches the mesh. Returns null (with an issue) when nothing sensible can be built.
 */
export function buildPartGeometry(part: BuildingPartSpec, index: number, issues: string[], opts: PartBuildOptions = {}): PartGeometry | null {
  const fp = sanitizeFootprint(part);
  if (!fp) { issues.push(`part ${part.id}: invalid footprint, skipped`); return null; }
  const base = finite(part.baseHeight) ? part.baseHeight : 0;
  let eave = finite(part.eaveHeight) ? part.eaveHeight : base + 2.6;
  if (eave < base + 0.5) {
    issues.push(`part ${part.id}: eave height ${eave} not above base ${base}; using base + 2.6 m`);
    eave = base + 2.6;
  }
  const build = opts.build ?? buildRoof;
  const params: RoofParams = { ...(part.roof ?? { type: 'hipped' }), eaveHeight: eave - base };
  if (!params.type) params.type = 'hipped';
  const done = (g: NonNullable<Attempt['geom']>, wallTop: number, fallback?: string): PartGeometry => {
    for (const w of g.roof.skeleton.stats.warnings) issues.push(`part ${part.id}: skeleton warning: ${w}`);
    let top = -Infinity;
    for (const t of g.solid.triangles) for (const i of t) top = Math.max(top, g.solid.positions[i][2]);
    return { part, index, base, eave: wallTop, roof: g.roof, solid: g.solid, report: g.report, walls: wallInfos(g.roof), top, ...(fallback ? { fallback } : {}) };
  };
  const first = attempt(build, fp, params, base);
  if (first.geom && !first.problem) return done(first.geom, eave);

  // unusable roof: flat-topped block at the known ridge (else the eave); never emit a broken skeleton
  const ft = opts.fallbackTop;
  const blockTop = ft !== undefined && finite(ft) && ft >= eave && ft <= eave + MAX_ROOF_RISE ? ft : eave;
  const flat = attempt(build, fp, { type: 'flat', eaveHeight: blockTop - base }, base);
  if (flat.geom && !flat.problem) {
    const fallback = `roof '${params.type}' unusable (${first.problem}); flat-topped block at ${blockTop.toFixed(2)} m used`;
    issues.push(`part ${part.id}: ${fallback}`);
    return done(flat.geom, blockTop, fallback);
  }
  // a sane but leaky first attempt beats nothing (its solid issues are reported with the validation)
  if (first.geom) {
    issues.push(`part ${part.id}: roof '${params.type}' ${first.problem}; flat-topped block failed too (${flat.problem}), leaky roof kept`);
    return done(first.geom, eave);
  }
  issues.push(`part ${part.id}: roof '${params.type}' unusable (${first.problem}) and flat-topped block failed (${flat.problem}), skipped`);
  return null;
}

function wallInfos(roof: RoofModel): WallInfo[] {
  const out: WallInfo[] = [];
  const rings = [roof.prepared.poly.outer, ...(roof.prepared.poly.holes ?? [])];
  let e = 0;
  rings.forEach((r, ring) => {
    let u = 0;
    for (let i = 0; i < r.length; i++, e++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const d: Vec2 = L > 0 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : [1, 0];
      out.push({ edge: e, srcEdges: roof.prepared.srcEdges[e] ?? [], kind: roof.prepared.kinds[e], ring, a, b, d, n: [d[1], -d[0]], length: L, u0: u });
      u += L;
    }
  });
  return out;
}

/** Absolute roof height at a plan point (null outside the part's roof). */
export function roofAt(pg: PartGeometry, p: Vec2): number | null {
  const h = pg.roof.heightAt(p);
  return h === null ? null : h + pg.base;
}

/** Absolute height of the wall top (roof surface just inside the wall) at distance s along the wall. */
export function wallTop(pg: PartGeometry, w: WallInfo, s: number): number {
  const t = Math.min(Math.max(s, 0.02), Math.max(0.02, w.length - 0.02));
  const p: Vec2 = [w.a[0] + w.d[0] * t - w.n[0] * 0.02, w.a[1] + w.d[1] * t - w.n[1] * 0.02];
  const h = roofAt(pg, p);
  return h === null ? pg.eave : Math.max(h, pg.eave);
}

/** Area-weighted unit normal, centroid and 3D area of a set of triangles. */
export function trianglesFrame(P: Vec3[], tris: [number, number, number][]): { normal: Vec3; centroid: Vec3; area: number } {
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0, A = 0;
  for (const [a, b, c] of tris) {
    const n = cross3(sub3(P[b], P[a]), sub3(P[c], P[a]));
    const ar = Math.hypot(n[0], n[1], n[2]) / 2;
    nx += n[0]; ny += n[1]; nz += n[2];
    cx += ar * (P[a][0] + P[b][0] + P[c][0]) / 3; cy += ar * (P[a][1] + P[b][1] + P[c][1]) / 3; cz += ar * (P[a][2] + P[b][2] + P[c][2]) / 3;
    A += ar;
  }
  return { normal: unit3([nx, ny, nz]), centroid: A > 0 ? [cx / A, cy / A, cz / A] : [0, 0, 0], area: A };
}

/**
 * Emit the part's 'solid' (welded, watertight), 'walls' and 'roof' layers into `set` and return its roof faces
 * (ids start at `idOffset`). Wall triangles are tagged with the source footprint edge, roof triangles with the
 * RoofFaceInfo id.
 */
export function emitPartLayers(pg: PartGeometry, set: LayerSet, idOffset: number): RoofFaceInfo[] {
  const { part, solid } = pg;
  const pid = part.id;
  const wallMat = wallMaterialKey(part.material?.wall);
  const roofMat = roofMaterialKey(part.material?.roof);
  emitSolid(pg, set);
  const byFace = new Map<number, [number, number, number][]>();
  solid.triangles.forEach((t, i) => {
    const f = solid.triFace[i];
    let l = byFace.get(f);
    if (!l) byFace.set(f, (l = []));
    l.push(t);
  });
  const roofFaces: RoofFaceInfo[] = [];
  const P = solid.positions;
  for (const f of solid.faces) {
    const tris = byFace.get(f.id);
    if (!tris || f.kind === 'floor') continue;
    const fr = trianglesFrame(P, tris);
    let layer: LayerBuilder;
    let uv: UVFn;
    let tag = NO_TAG;
    if (VERTICAL_KINDS.has(f.kind)) {
      layer = set.get({ id: `${pid}/walls`, kind: 'walls', material: wallMat, partId: pid });
      const w = f.edge >= 0 ? pg.walls[f.edge] : undefined;
      uv = f.kind === 'parapet-top' ? planUV : w ? wallUV(fr.normal, w.u0 - (w.a[0] * w.d[0] + w.a[1] * w.d[1])) : wallUV(fr.normal);
      if (f.srcEdges.length) tag = f.srcEdges[0];
    } else {
      const flat = f.kind === 'flat' && roofMat !== 'roof-flat';
      layer = set.get(flat ? { id: `${pid}/roof-flat`, kind: 'roof', material: 'roof-flat', partId: pid } : { id: `${pid}/roof`, kind: 'roof', material: roofMat, partId: pid });
      uv = planUV;
      tag = idOffset + roofFaces.length;
      roofFaces.push({
        id: tag, partId: pid, kind: f.kind, pitchDeg: f.pitchDeg, azimuthDeg: f.kind === 'flat' ? NaN : f.azimuthDeg,
        area: fr.area, planArea: Math.abs(f.planArea), centroid: fr.centroid, normal: fr.normal,
      });
    }
    const local = new Map<number, number>();
    const vid = (g: number) => {
      let v = local.get(g);
      if (v === undefined) { v = layer.vertex(P[g], fr.normal, uv(P[g])); local.set(g, v); }
      return v;
    };
    for (const [a, b, c] of tris) layer.triangle(vid(a), vid(b), vid(c), tag);
  }
  return roofFaces;
}

/** Welded closed solid: shared vertices (watertight indexing), angle-weighted pseudo-normals, plan UVs. */
function emitSolid(pg: PartGeometry, set: LayerSet): void {
  const { solid, part } = pg;
  const layer = set.get({ id: `${part.id}/solid`, kind: 'solid', material: wallMaterialKey(part.material?.wall), partId: part.id });
  const P = solid.positions;
  const acc = new Map<number, Vec3>();
  for (const [a, b, c] of solid.triangles) {
    const n = unit3(cross3(sub3(P[b], P[a]), sub3(P[c], P[a])));
    for (const [i, j, k] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const u = unit3(sub3(P[j], P[i])), v = unit3(sub3(P[k], P[i]));
      const ang = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));
      const s = acc.get(i) ?? [0, 0, 0];
      acc.set(i, [s[0] + n[0] * ang, s[1] + n[1] * ang, s[2] + n[2] * ang]);
    }
  }
  const map = new Map<number, number>();
  const vid = (g: number) => {
    let v = map.get(g);
    if (v === undefined) { v = layer.vertex(P[g], unit3(acc.get(g) ?? [0, 0, 1]), [P[g][0], P[g][1]]); map.set(g, v); }
    return v;
  };
  for (const [a, b, c] of solid.triangles) layer.triangle(vid(a), vid(b), vid(c));
}
