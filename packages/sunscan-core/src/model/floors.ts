// Floor slabs: the part footprint inset by the external wall thickness (weighted skeleton cap), clipped to the
// region where the roof is high enough for storeys in the roof / the loft floor. Stairwell openings are cut by
// clipping each slab triangle against the (convex) stair rectangle.
import { computeSkeleton, type ProfileSeg } from '../geometry/skeleton.js';
import { triangulateLoops } from '../geometry/triangulate.js';
import { ringArea, type Ring, type Vec2, type Vec3 } from '../geometry/geom.js';
import type { LayerBuilder } from './builder.js';
import { SLAB_THICKNESS, WALL_THICKNESS, type StoreyLevel } from './levels.js';
import { type PartGeometry, ringBounds } from './part.js';
import { segmentInsideIntervals, subtractConvex } from './polyops.js';

/** Inner wall line of a part: loops of the inset footprint and the wall (prepared edge) behind each inset edge. */
export interface InsetInfo {
  loops: Ring[];
  arcs: { a: Vec2; b: Vec2; edge: number }[];
  area: number;
}

/** A floor slab to mesh: plan loops (outer CCW, holes CW), top level, area. */
export interface SlabPlan {
  part: PartGeometry;
  storey: number;
  loops: Ring[];
  top: number;
  area: number;
  /** Loft floor over the top storey (ceiling joists), tagged with storey = number of storeys. */
  loft: boolean;
}

function capLoops(sk: ReturnType<typeof computeSkeleton>): Ring[] {
  const cap = sk.faces.find((f) => f.key === 'cap');
  return cap ? cap.loops.map((l) => l.map((i): Vec2 => [sk.nodes[i].x, sk.nodes[i].y])) : [];
}

/** Inset loops must lie inside the footprint: anything outside its bounds is a broken skeleton (no loops then). */
function insideBounds(loops: Ring[], pg: PartGeometry): Ring[] {
  const [x0, y0, x1, y1] = ringBounds(pg.roof.prepared.poly.outer);
  const tol = 0.01;
  for (const l of loops) for (const [x, y] of l) if (!(x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol)) return [];
  return loops;
}

const loopsArea = (loops: Ring[]) => loops.reduce((s, l) => s + ringArea(l), 0);

/** Footprint inset by `t` (uniform weights) with the source wall of every inset edge; null if it vanishes. */
export function insetOf(pg: PartGeometry, t = WALL_THICKNESS): InsetInfo | null {
  try {
    const sk = computeSkeleton(pg.roof.prepared.poly, { weights: () => 1, capTime: t });
    const loops = insideBounds(capLoops(sk), pg);
    if (!loops.length) return null;
    const nIn = pg.walls.length;
    const arcs = sk.arcs.filter((a) => a.left === 'cap').map((a) => {
      const e = Number(a.right.split(':')[0]);
      return { a: [sk.nodes[a.u].x, sk.nodes[a.u].y] as Vec2, b: [sk.nodes[a.v].x, sk.nodes[a.v].y] as Vec2, edge: e < nIn ? e : -1 };
    });
    return { loops, arcs, area: loopsArea(loops) };
  } catch {
    return null;
  }
}

/** Horizontal distance an edge has moved at skeleton time T (integral of its speed profile). */
function offsetAt(profile: ProfileSeg[], T: number): number {
  let off = 0;
  for (let k = 0; k < profile.length; k++) {
    const t0 = profile[k].t0, t1 = k + 1 < profile.length ? profile[k + 1].t0 : Infinity;
    if (T <= t0) break;
    off += profile[k].w * (Math.min(T, t1) - t0);
  }
  return off;
}

/**
 * Plan region (inset by `inset`) where the roof surface is at least `z` (absolute). Because skeleton time equals
 * height above the eave, this is the weighted offset of the footprint with per-edge distance max(inset, d_e(T)).
 */
export function regionBelowRoof(pg: PartGeometry, z: number, inset = WALL_THICKNESS): Ring[] {
  const T = z - pg.eave;
  const R = pg.roof;
  if (T > 0 && (R.params.type === 'flat' || T >= R.skeleton.maxTime - 1e-6)) return [];
  const d = pg.walls.map((w) => (T <= 0 ? inset : Math.max(inset, offsetAt(R.skeleton.edges[w.edge]?.profile ?? [{ t0: 0, w: 0 }], T))));
  try {
    return insideBounds(capLoops(computeSkeleton(R.prepared.poly, { weights: (id) => d[id] ?? inset, capTime: 1 })), pg);
  } catch {
    return [];
  }
}

/** Slabs of a part: one per storey (floor level) plus the loft floor under a pitched roof. */
export function planSlabs(pg: PartGeometry, levels: StoreyLevel[], inset: InsetInfo | null, roofClearance: number): SlabPlan[] {
  const out: SlabPlan[] = [];
  const mk = (storey: number, top: number, loft: boolean) => {
    const loops = top + roofClearance <= pg.eave && inset ? inset.loops : regionBelowRoof(pg, top + roofClearance);
    const area = loopsArea(loops);
    if (loops.length && area > (loft ? 2 : 0.5)) out.push({ part: pg, storey, loops, top, area, loft });
  };
  for (const L of levels) mk(L.storey, L.floorZ, false);
  const last = levels[levels.length - 1];
  if (last && pg.roof.params.type !== 'flat') mk(levels.length, last.ceilingZ + SLAB_THICKNESS, true);
  return out;
}

/** Triangulated plan polygon minus convex holes, as convex CCW pieces (plan orientation). */
export function polygonMinusHoles(loops: Ring[], holes: Vec2[][]): Vec2[][] {
  const pts: Vec2[] = [];
  const idx = loops.filter((l) => l.length >= 3).map((l) => l.map((p) => { pts.push(p); return pts.length - 1; }));
  let tris: [number, number, number][] = [];
  try { tris = triangulateLoops(pts, idx); } catch { return []; }
  let pieces: Vec2[][] = tris.map(([a, b, c]) => [pts[a], pts[b], pts[c]]);
  for (const h of holes) pieces = pieces.flatMap((p) => subtractConvex(p, h));
  return pieces;
}

/** Emit a slab (top, underside, edges, stairwell edges) between z = top - thickness and top. */
export function emitSlab(b: LayerBuilder, loops: Ring[], top: number, holes: Vec2[][], thickness = SLAB_THICKNESS, tag?: number): void {
  const bot = top - thickness;
  for (const piece of polygonMinusHoles(loops, holes)) {
    b.convex(piece.map((p): Vec3 => [p[0], p[1], top]), [0, 0, 1], undefined, tag);
    b.convex([...piece].reverse().map((p): Vec3 => [p[0], p[1], bot]), [0, 0, -1], undefined, tag);
  }
  // outer edges (material on the left of each loop edge -> face to the right)
  for (const l of loops) {
    for (let i = 0; i < l.length; i++) {
      const u = l[i], v = l[(i + 1) % l.length];
      b.quad([u[0], u[1], bot], [v[0], v[1], bot], [v[0], v[1], top], [u[0], u[1], top], undefined, undefined, tag);
    }
  }
  // stairwell edges facing into each (CCW) hole, only where the hole is inside the slab
  for (const h of holes) {
    for (let i = 0; i < h.length; i++) {
      const p = h[i], q = h[(i + 1) % h.length];
      for (const [t0, t1] of segmentInsideIntervals(p, q, loops)) {
        const a: Vec2 = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0];
        const c: Vec2 = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1];
        b.quad([c[0], c[1], bot], [a[0], a[1], bot], [a[0], a[1], top], [c[0], c[1], top], undefined, undefined, tag);
      }
    }
  }
}
