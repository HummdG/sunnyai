// Automatic mesh / roof validation.
import { polygonArea, type PolygonM, type Vec3 } from './geom.js';
import type { SolidMesh } from './solid.js';
import type { RoofModel } from './roof.js';

export interface MeshReport {
  vertices: number;
  triangles: number;
  watertight: boolean; // every undirected edge used exactly twice, with opposite orientation
  boundaryEdges: number; // used once
  nonManifoldEdges: number; // used > 2 times
  sameDirectionEdges: number; // used twice in the same direction (inconsistent orientation)
  duplicateVertices: number; // distinct indices at the same position (would hide cracks)
  degenerateTriangles: number; // area < 1e-9 m2
  minTriangleArea: number;
  volume: number; // signed (positive = outward normals)
  eulerCharacteristic: number; // V - E + F (2 for a sphere-like solid, 0 with one courtyard)
  components: number;
}

export function checkMesh(m: SolidMesh): MeshReport {
  const P = m.positions;
  const used = new Set<number>();
  for (const t of m.triangles) for (const i of t) used.add(i);
  const dir = new Map<string, number>();
  for (const [a, b, c] of m.triangles)
    for (const [u, v] of [[a, b], [b, c], [c, a]]) dir.set(`${u},${v}`, (dir.get(`${u},${v}`) ?? 0) + 1);
  let boundary = 0, nonManifold = 0, sameDir = 0, edges = 0;
  const seen = new Set<string>();
  for (const [k, n] of dir) {
    const [u, v] = k.split(',').map(Number);
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges++;
    const fwd = dir.get(`${u},${v}`) ?? 0, bwd = dir.get(`${v},${u}`) ?? 0;
    const tot = fwd + bwd;
    if (tot === 1) boundary++;
    else if (tot > 2) nonManifold++;
    else if (fwd !== 1 || bwd !== 1) sameDir++;
    void n;
  }
  // duplicate positions among used vertices
  const pos = new Map<string, number>();
  let dup = 0;
  for (const i of used) {
    const k = P[i].map((x) => Math.round(x * 1e7)).join(',');
    if (pos.has(k)) dup++;
    else pos.set(k, i);
  }
  let vol = 0, minA = Infinity, degen = 0;
  for (const [a, b, c] of m.triangles) {
    const A = P[a], B = P[b], C = P[c];
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const ar = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    minA = Math.min(minA, ar);
    if (ar < 1e-9) degen++;
  }
  // connected components (via shared vertices)
  const parent = new Map<number, number>();
  const find = (x: number): number => { while (parent.get(x)! !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (const i of used) parent.set(i, i);
  for (const [a, b, c] of m.triangles) { parent.set(find(a), find(b)); parent.set(find(b), find(c)); }
  const comps = new Set([...used].map(find)).size;
  return {
    vertices: used.size, triangles: m.triangles.length,
    watertight: boundary === 0 && nonManifold === 0 && sameDir === 0,
    boundaryEdges: boundary, nonManifoldEdges: nonManifold, sameDirectionEdges: sameDir,
    duplicateVertices: dup, degenerateTriangles: degen, minTriangleArea: minA, volume: vol,
    eulerCharacteristic: used.size - edges + m.triangles.length, components: comps,
  };
}

export interface RoofReport {
  footprintArea: number;
  roofPlanArea: number; // signed sum of plan-projected areas of non-vertical roof faces
  roofPlanAreaAbs: number; // same with |.| per triangle (catches folds / overlaps)
  maxPitchErrDeg: number; // |actual face slope - design pitch| over all roof/gable faces
  maxAzimuthErrDeg: number; // downslope direction vs edge outward normal (pitched faces)
  nonPlanarMax: number; // max distance of a face vertex from its face plane (m)
}

export function checkRoof(roof: RoofModel, mesh: SolidMesh): RoofReport {
  const P = mesh.positions;
  const fp: PolygonM = roof.prepared.poly;
  let plan = 0, planAbs = 0, maxPitch = 0, maxAz = 0, nonPlanar = 0;
  const byFace = new Map<number, [number, number, number][]>();
  mesh.triangles.forEach((t, i) => { const f = mesh.triFace[i]; if (!byFace.has(f)) byFace.set(f, []); byFace.get(f)!.push(t); });
  for (const f of mesh.faces) {
    if (f.kind === 'wall' || f.kind === 'floor' || f.kind === 'parapet-inner') continue;
    const tris = byFace.get(f.id) ?? [];
    const countsInPlan = true; // deck + parapet tops + pitched faces together must tile the footprint
    // area-weighted normal
    let nx = 0, ny = 0, nz = 0;
    for (const [a, b, c] of tris) {
      const A = P[a], B = P[b], C = P[c];
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      nx += n[0]; ny += n[1]; nz += n[2];
      if (countsInPlan) { plan += n[2] / 2; planAbs += Math.abs(n[2]) / 2; }
      // per-triangle slope check (each triangle must have the face's pitch). Needle triangles (smallest altitude
      // < 1 cm) are skipped: ~1e-8 m of node noise tilts their normal by ~1e-3 deg; planarity in metres covers them.
      const l = Math.hypot(n[0], n[1], n[2]);
      const longest = Math.max(Math.hypot(u[0], u[1], u[2]), Math.hypot(v[0], v[1], v[2]), Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]));
      if (l > 1e-12 && l / longest >= 0.01) {
        const slope = (Math.acos(Math.max(-1, Math.min(1, n[2] / l))) * 180) / Math.PI;
        maxPitch = Math.max(maxPitch, Math.abs(slope - f.pitchDeg));
        if (f.pitchDeg > 0.5 && f.pitchDeg < 89.5) {
          const az = ((Math.atan2(n[0], n[1]) * 180) / Math.PI + 360) % 360; // normal's horizontal part = downslope dir
          let d = Math.abs(az - f.azimuthDeg) % 360;
          if (d > 180) d = 360 - d;
          if (f.kind === 'roof') maxAz = Math.max(maxAz, d);
        }
      }
    }
    // planarity: distance of all face vertices from the plane through the centroid with the mean normal
    const l = Math.hypot(nx, ny, nz);
    if (l > 0) {
      const n: Vec3 = [nx / l, ny / l, nz / l];
      const vs = [...new Set(tris.flat())];
      const c = vs.reduce((s, i) => [s[0] + P[i][0] / vs.length, s[1] + P[i][1] / vs.length, s[2] + P[i][2] / vs.length], [0, 0, 0]);
      for (const i of vs) nonPlanar = Math.max(nonPlanar, Math.abs((P[i][0] - c[0]) * n[0] + (P[i][1] - c[1]) * n[1] + (P[i][2] - c[2]) * n[2]));
    }
  }
  return { footprintArea: polygonArea(fp), roofPlanArea: plan, roofPlanAreaAbs: planAbs, maxPitchErrDeg: maxPitch, maxAzimuthErrDeg: maxAz, nonPlanarMax: nonPlanar };
}
