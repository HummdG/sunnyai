// Skeleton time field for LiDAR fitting.
// For a fixed topology (edge kinds) and a uniform eave pitch, the roof is  z(p) = H + tan(pitch) * t(p)
// where t(p) is the "unit" skeleton time (weights 1 for eaves, 0 for gable/party edges) = horizontal inward
// offset distance of the eave whose face contains p. t(p) does not depend on H or pitch, so fitting (H, tan p)
// to DSM points is a 2-parameter LINEAR least-squares problem per candidate topology.
import { computeSkeleton, type Skeleton } from './skeleton.js';
import { prepareFootprint, type EdgeKind } from './roof.js';
import { dot, pointInRing, type PolygonM, type Vec2, type Vec3 } from './geom.js';

export interface TimeField {
  skeleton: Skeleton;
  /** Unit skeleton time at p (m of inward offset), or null outside the footprint. */
  t(p: Vec2): number | null;
  /** Index into skeleton.faces of the (sloped) face containing p, or -1. */
  face(p: Vec2): number;
  /** Eave (prepared edge index) whose plane governs p (for per-edge pitch models), or -1. */
  edge(p: Vec2): number;
}

export function skeletonTimeField(footprint: PolygonM, kinds: EdgeKind[], cell = 1.0): TimeField {
  const prep = prepareFootprint(footprint, kinds);
  const sk = computeSkeleton(prep.poly, { weights: (id) => (prep.kinds[id] === 'eave' ? 1 : 0) });
  const faces = sk.faces
    .map((f, idx) => ({ f, idx }))
    .filter(({ f }) => f.w > 0)
    .map(({ f, idx }) => {
      const loops = f.loops.map((l) => l.map((i) => [sk.nodes[i].x, sk.nodes[i].y] as Vec2));
      const xs = loops.flat().map((p) => p[0]), ys = loops.flat().map((p) => p[1]);
      return { idx, e: sk.edges[f.edge], loops, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
  // uniform grid acceleration: cell -> candidate faces (bbox overlap)
  const all = faces.flatMap((f) => [f.bb[0], f.bb[2]]);
  const allY = faces.flatMap((f) => [f.bb[1], f.bb[3]]);
  const x0 = Math.min(...all), y0 = Math.min(...allY);
  const nx = Math.max(1, Math.ceil((Math.max(...all) - x0) / cell)), ny = Math.max(1, Math.ceil((Math.max(...allY) - y0) / cell));
  const grid: number[][] = Array.from({ length: nx * ny }, () => []);
  faces.forEach((f, k) => {
    const i0 = Math.max(0, Math.floor((f.bb[0] - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((f.bb[2] - x0) / cell));
    const j0 = Math.max(0, Math.floor((f.bb[1] - y0) / cell)), j1 = Math.min(ny - 1, Math.floor((f.bb[3] - y0) / cell));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) grid[j * nx + i].push(k);
  });
  const locate = (p: Vec2): number => {
    const i = Math.floor((p[0] - x0) / cell), j = Math.floor((p[1] - y0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    for (const k of grid[j * nx + i]) {
      const f = faces[k];
      if (p[0] < f.bb[0] || p[0] > f.bb[2] || p[1] < f.bb[1] || p[1] > f.bb[3]) continue;
      let inside = false;
      for (const l of f.loops) if (pointInRing(p, l)) inside = !inside;
      if (inside) return k;
    }
    return -1;
  };
  return {
    skeleton: sk,
    t(p) { const k = locate(p); if (k < 0) return null; const e = faces[k].e; return dot(e.n, p) - e.c; },
    face(p) { const k = locate(p); return k < 0 ? -1 : faces[k].idx; },
    edge(p) { const k = locate(p); return k < 0 ? -1 : faces[k].e.id; },
  };
}

export interface PlaneFit { eave: number; tanPitch: number; pitchDeg: number; rmse: number; n: number }

/** Ordinary least squares for z = H + tanP * t(p) (robust weighting would wrap this, e.g. IRLS/Huber). */
export function fitEaveAndPitch(field: TimeField, pts: Vec3[]): PlaneFit {
  let n = 0, st = 0, sz = 0, stt = 0, stz = 0;
  const used: [number, number][] = [];
  for (const [x, y, z] of pts) {
    const t = field.t([x, y]);
    if (t === null) continue;
    n++; st += t; sz += z; stt += t * t; stz += t * z;
    used.push([t, z]);
  }
  const det = n * stt - st * st;
  const tanP = (n * stz - st * sz) / det;
  const H = (sz - tanP * st) / n;
  const rmse = Math.sqrt(used.reduce((s, [t, z]) => s + (z - H - tanP * t) ** 2, 0) / Math.max(1, n));
  return { eave: H, tanPitch: tanP, pitchDeg: (Math.atan(tanP) * 180) / Math.PI, rmse, n };
}
