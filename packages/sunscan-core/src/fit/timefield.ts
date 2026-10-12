// Unit skeleton time t_M(p) for general polygons, from the geometry engine's weighted straight skeleton
// (eave weight 1, gable / party weight 0):  t(p) = n_e . p - c_e  on the face of eave edge e, constant on flat
// caps (regions enclosed only by vertical edges). Outside the footprint the face of the nearest boundary point
// is extended linearly, which reproduces the rectangle closed forms (negative under eave overhangs, the same
// profile continued across gable / party walls).
import { computeSkeleton, type Skeleton } from '../geometry/skeleton.js';
import { prepareFootprint, type EdgeKind } from '../geometry/roof.js';
import type { PolygonM, Vec2 } from '../geometry/geom.js';

/** Plan rotation u = x cos + y sin, v = -x sin + y cos. */
export interface Rotation { cos: number; sin: number }

/**
 * Rotate a polygon into a frame and snap edges that are axis-aligned to within `tol` metres exactly onto the axis.
 * The geometry engine handles exact ties (parallel eaves, simultaneous collapses) of axis-aligned plans robustly,
 * but the same plan rotated by an arbitrary angle turns them into 1e-16 near-ties that can produce runaway nodes;
 * skeleton time is rotation invariant, so fields are built in the part's own frame.
 */
export function alignPolygon(poly: PolygonM, f: Rotation, tol = 1e-6): PolygonM {
  const rings = [poly.outer, ...(poly.holes ?? [])].map((r) => r.map(([x, y]) => [x * f.cos + y * f.sin, -x * f.sin + y * f.cos] as Vec2));
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const du = Math.abs(b[0] - a[0]), dv = Math.abs(b[1] - a[1]);
      if (dv <= tol && du > 10 * tol) { const m = (a[1] + b[1]) / 2; a[1] = m; b[1] = m; }
      else if (du <= tol && dv > 10 * tol) { const m = (a[0] + b[0]) / 2; a[0] = m; b[0] = m; }
    }
  }
  return { outer: rings[0], holes: rings.slice(1) };
}

/** Skeleton-time evaluator of one footprint + edge-kind assignment. */
export interface TimeField {
  /** Unit skeleton time at (x, y) (extrapolated outside the footprint). */
  at(x: number, y: number): number;
  /** out[k] = at(pts[2k], pts[2k + 1]). */
  fill(pts: Float64Array, out?: Float64Array): Float64Array;
  /** Largest skeleton time over the footprint (ridge / apex). */
  tmax: number;
  skeleton: Skeleton;
}

interface FaceRec {
  loops: Float64Array[];
  x0: number; y0: number; x1: number; y1: number;
  nx: number; ny: number; c: number; w: number; // t = (n . p - c) / w ; w = 0 -> constant `c`
}

function inLoops(f: FaceRec, x: number, y: number): boolean {
  let inside = false;
  for (const L of f.loops) {
    const m = L.length >> 1;
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const ax = L[2 * i], ay = L[2 * i + 1], bx = L[2 * j], by = L[2 * j + 1];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
  }
  return inside;
}

const evalFace = (f: FaceRec, x: number, y: number) => (f.w === 0 ? f.c : (f.nx * x + f.ny * y - f.c) / f.w);

/** Thrown when the geometry engine returns an unusable skeleton (non-finite or far-away nodes, warnings). */
export class DegenerateSkeletonError extends Error {}

/** Sanity check of a skeleton: finite nodes inside the footprint bbox (+ margin), times within [0, diag], no warnings. */
export function skeletonSane(sk: Skeleton, poly: PolygonM): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of [poly.outer, ...(poly.holes ?? [])]) for (const [x, y] of r) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const diag = Math.hypot(x1 - x0, y1 - y0), m = 1e-6 * Math.max(1, diag);
  if (sk.stats.warnings.length) return false;
  return sk.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.t)
    && n.x >= x0 - m && n.x <= x1 + m && n.y >= y0 - m && n.y <= y1 + m && n.t >= -m && n.t <= diag);
}

/**
 * Build the time field of `poly` (local metres, any orientation) with per-edge kinds (eave = weight 1).
 * `eaveWeights` optionally overrides the weight of individual eave edges (input edge order): an eave of weight w
 * rises 1/w times as fast as a unit eave, so weights 1 and 1/q give an off-centre ridge with slope ratio q.
 * @throws DegenerateSkeletonError when the engine's skeleton fails the sanity check (such a roof could not be
 *         meshed either, so the caller should drop the hypothesis).
 */
export function makeTimeField(poly: PolygonM, kinds: EdgeKind[], frame?: Rotation, eaveWeights?: (number | undefined)[]): TimeField {
  const rc = frame ? frame.cos : 1, rs = frame ? frame.sin : 0;
  // the weights ride in prepareFootprint's per-edge pitch slot, so edges of different weight are never merged
  const prep = prepareFootprint(frame ? alignPolygon(poly, frame) : poly, kinds, eaveWeights ?? []);
  const sk = computeSkeleton(prep.poly, { weights: (id) => (prep.kinds[id] === 'eave' ? prep.pitchDeg[id] ?? 1 : 0) });
  if (!skeletonSane(sk, prep.poly)) throw new DegenerateSkeletonError('degenerate skeleton');
  const faces: FaceRec[] = [];
  for (const f of sk.faces) {
    const isCap = f.key === 'cap';
    if (!isCap && !(f.w > 0)) continue; // vertical faces have no plan area
    const loops = f.loops.map((l) => {
      const a = new Float64Array(2 * l.length);
      l.forEach((id, k) => { a[2 * k] = sk.nodes[id].x; a[2 * k + 1] = sk.nodes[id].y; });
      return a;
    });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const L of loops) for (let k = 0; k < L.length; k += 2) {
      x0 = Math.min(x0, L[k]); x1 = Math.max(x1, L[k]); y0 = Math.min(y0, L[k + 1]); y1 = Math.max(y1, L[k + 1]);
    }
    if (isCap) {
      faces.push({ loops, x0, y0, x1, y1, nx: 0, ny: 0, c: sk.nodes[f.loops[0][0]].t, w: 0 });
    } else {
      const e = sk.edges[f.edge];
      faces.push({ loops, x0, y0, x1, y1, nx: e.n[0], ny: e.n[1], c: e.c, w: f.w });
    }
  }
  // uniform grid over face bounding boxes
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  for (const f of faces) { gx0 = Math.min(gx0, f.x0); gy0 = Math.min(gy0, f.y0); gx1 = Math.max(gx1, f.x1); gy1 = Math.max(gy1, f.y1); }
  if (!faces.length) { gx0 = gy0 = 0; gx1 = gy1 = 1; }
  const diag = Math.hypot(gx1 - gx0, gy1 - gy0);
  const cell = Math.min(2, Math.max(0.4, diag / 24));
  const nx = Math.max(1, Math.ceil((gx1 - gx0) / cell)), ny = Math.max(1, Math.ceil((gy1 - gy0) / cell));
  const grid: number[][] = Array.from({ length: nx * ny }, () => []);
  faces.forEach((f, k) => {
    const i0 = Math.max(0, Math.floor((f.x0 - gx0) / cell)), i1 = Math.min(nx - 1, Math.floor((f.x1 - gx0) / cell));
    const j0 = Math.max(0, Math.floor((f.y0 - gy0) / cell)), j1 = Math.min(ny - 1, Math.floor((f.y1 - gy0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * nx + i].push(k);
  });
  const eps = 1e-9 * Math.max(1, diag);
  const locate = (x: number, y: number): number => {
    const i = Math.floor((x - gx0) / cell), j = Math.floor((y - gy0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    for (const k of grid[j * nx + i]) {
      const f = faces[k];
      if (x < f.x0 - eps || x > f.x1 + eps || y < f.y0 - eps || y > f.y1 + eps) continue;
      if (inLoops(f, x, y)) return k;
    }
    return -1;
  };
  // boundary segments of the prepared polygon for extrapolation
  const segs: { ax: number; ay: number; bx: number; by: number; inx: number; iny: number }[] = [];
  for (const r of [prep.poly.outer, ...(prep.poly.holes ?? [])]) r.forEach((a, k) => {
    const b = r[(k + 1) % r.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    segs.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], inx: -(b[1] - a[1]) / L, iny: (b[0] - a[0]) / L });
  });
  const nudge = 1e-6 * Math.max(1, diag);
  const extrapolate = (x: number, y: number): number => {
    // numerical gap inside the footprint: probe the immediate neighbourhood first
    for (const [ox, oy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const k = locate(x + ox * 1e-7 * Math.max(1, diag), y + oy * 1e-7 * Math.max(1, diag));
      if (k >= 0) return evalFace(faces[k], x, y);
    }
    let best = Infinity, bs = segs[0], bt = 0;
    for (const s of segs) {
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      const L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? ((x - s.ax) * dx + (y - s.ay) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s.ax + t * dx - x, qy = s.ay + t * dy - y;
      const d2 = qx * qx + qy * qy;
      if (d2 < best) { best = d2; bs = s; bt = t; }
    }
    if (!bs) return 0;
    for (const scale of [1, 100, 1e4]) {
      const t = Math.min(Math.max(bt, 1e-4), 1 - 1e-4);
      const qx = bs.ax + t * (bs.bx - bs.ax) + bs.inx * nudge * scale;
      const qy = bs.ay + t * (bs.by - bs.ay) + bs.iny * nudge * scale;
      const k = locate(qx, qy);
      if (k >= 0) return evalFace(faces[k], x, y);
    }
    return 0;
  };
  const atAligned = (x: number, y: number): number => {
    const k = locate(x, y);
    return k >= 0 ? evalFace(faces[k], x, y) : extrapolate(x, y);
  };
  const at = (x: number, y: number): number => atAligned(x * rc + y * rs, -x * rs + y * rc);
  return {
    at,
    fill(pts, out) {
      const m = pts.length >> 1;
      const o = out ?? new Float64Array(m);
      for (let k = 0; k < m; k++) o[k] = at(pts[2 * k], pts[2 * k + 1]);
      return o;
    },
    tmax: sk.maxTime,
    skeleton: sk,
  };
}
