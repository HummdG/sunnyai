// Closed building solid: floor (z = 0) + vertical walls up to the roof's wall-top vertices + roof faces.
// Watertightness by construction: walls use exactly the roof's t = 0 skeleton nodes as their top vertices,
// gable / party faces are the vertical roof faces above the wall quads, and every roof face is triangulated
// with all of its boundary nodes (no T-junctions).
import type { Vec2, Vec3 } from './geom.js';
import { triangulateLoops } from './triangulate.js';
import { bearing, type EdgeKind, type FaceKind, type RoofModel } from './roof.js';

export interface FaceMeta {
  id: number;
  kind: FaceKind;
  edgeKind?: EdgeKind; // for walls / roof faces: kind of the footprint edge they rise from
  edge: number; // prepared edge index, -1 if none
  srcEdges: number[]; // original footprint edge indices
  pitchDeg: number; // 90 = vertical, 0 = horizontal
  azimuthDeg: number; // compass bearing of the face's outward/downslope direction
  area: number; // 3D area (m2)
  planArea: number; // horizontal projection (m2), 0 for vertical faces, negative for the floor
}

export interface SolidMesh {
  positions: Vec3[];
  triangles: [number, number, number][];
  triFace: number[];
  faces: FaceMeta[];
}

export function buildSolid(roof: RoofModel): SolidMesh {
  const positions: Vec3[] = roof.vertices.map((v) => [...v] as Vec3);
  const triangles: [number, number, number][] = [];
  const triFace: number[] = [];
  const faces: FaceMeta[] = [];
  const kinds = roof.prepared.kinds;
  const rings = [roof.prepared.poly.outer, ...(roof.prepared.poly.holes ?? [])];

  // roof faces
  for (const f of roof.faces) {
    const id = faces.length;
    faces.push({
      id, kind: f.kind, edgeKind: f.edge >= 0 ? kinds[f.edge] : undefined, edge: f.edge, srcEdges: f.srcEdges,
      pitchDeg: f.pitchDeg, azimuthDeg: f.azimuthDeg, area: f.area, planArea: f.planArea,
    });
    for (const t of f.triangles) { triangles.push(t); triFace.push(id); }
  }

  // bottom vertices
  const bottom: number[][] = rings.map((r) => r.map((p) => { positions.push([p[0], p[1], 0]); return positions.length - 1; }));

  // floor (facing down): triangulate the footprint in plan and flip
  {
    const pts: Vec2[] = [];
    const loops: number[][] = [];
    const glob: number[] = [];
    rings.forEach((r, ri) => {
      loops.push(r.map((p, i) => { pts.push(p); glob.push(bottom[ri][i]); return pts.length - 1; }));
    });
    const tris = triangulateLoops(pts, loops);
    const id = faces.length;
    let area = 0;
    for (const [a, b, c] of tris) {
      triangles.push([glob[a], glob[c], glob[b]]);
      triFace.push(id);
      area += ((pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0])) / 2;
    }
    faces.push({ id, kind: 'floor', edge: -1, srcEdges: [], pitchDeg: 180, azimuthDeg: NaN, area, planArea: -area });
  }

  // walls: quad (a0, b0, bTop, aTop) per footprint edge
  let eIdx = 0;
  rings.forEach((r, ri) => {
    for (let i = 0; i < r.length; i++, eIdx++) {
      const j = (i + 1) % r.length;
      const a0 = bottom[ri][i], b0 = bottom[ri][j];
      const aT = roof.ringTop[ri][i], bT = roof.ringTop[ri][j];
      const id = faces.length;
      const dx = r[j][0] - r[i][0], dy = r[j][1] - r[i][1];
      const L = Math.hypot(dx, dy);
      const hA = positions[aT][2], hB = positions[bT][2];
      faces.push({
        id, kind: 'wall', edgeKind: kinds[eIdx], edge: eIdx, srcEdges: roof.prepared.srcEdges[eIdx],
        pitchDeg: 90, azimuthDeg: bearing([dy / L, -dx / L]), area: (L * (hA + hB)) / 2, planArea: 0,
      });
      triangles.push([a0, b0, bT], [a0, bT, aT]);
      triFace.push(id, id);
    }
  });
  return { positions, triangles, triFace, faces };
}

/** Extract a sub-mesh (e.g. roof only) as an open surface. */
export function roofOnly(m: SolidMesh): SolidMesh {
  const keep = new Set(m.faces.filter((f) => f.kind !== 'wall' && f.kind !== 'floor').map((f) => f.id));
  const tris: [number, number, number][] = [];
  const tf: number[] = [];
  m.triangles.forEach((t, i) => { if (keep.has(m.triFace[i])) { tris.push(t); tf.push(m.triFace[i]); } });
  return { positions: m.positions, triangles: tris, triFace: tf, faces: m.faces };
}
