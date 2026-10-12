// Test helpers for the model tests: layer well-formedness, layer -> SolidMesh, GLB parsing.
import type { SolidMesh } from '../../../src/geometry/solid.js';
import type { HouseMesh, MeshLayer, Vec3 } from '../../../src/types.js';

/** Problems with a layer's arrays (empty list = well-formed). */
export function layerProblems(l: MeshLayer): string[] {
  const out: string[] = [];
  const n = l.positions.length / 3;
  if (!Number.isInteger(n) || n < 3) out.push('positions length');
  if (l.normals.length !== l.positions.length) out.push('normals length');
  if (l.uvs.length !== 2 * n) out.push('uvs length');
  if (l.indices.length === 0 || l.indices.length % 3) out.push('indices length');
  if (l.triangleTags && l.triangleTags.length !== l.indices.length / 3) out.push('tags length');
  for (const a of [l.positions, l.normals, l.uvs]) if (!a.every(Number.isFinite)) out.push('non-finite value');
  for (const i of l.indices) if (i >= n) { out.push(`index ${i} >= ${n}`); break; }
  for (let i = 0; i < n; i++) {
    const len = Math.hypot(l.normals[i * 3], l.normals[i * 3 + 1], l.normals[i * 3 + 2]);
    if (Math.abs(len - 1) > 1e-4) { out.push(`normal ${i} length ${len}`); break; }
  }
  return out;
}

/** Fraction of (non-tiny) triangles whose winding disagrees with their vertex normals. */
export function windingMismatches(l: MeshLayer, minDot = 0): number {
  const P = l.positions, N = l.normals, I = l.indices;
  let bad = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const gl = Math.hypot(g[0], g[1], g[2]);
    if (gl < 2e-6) continue; // area < 1e-6 m2: orientation numerically meaningless
    const nx = N[a] + N[b] + N[c], ny = N[a + 1] + N[b + 1] + N[c + 1], nz = N[a + 2] + N[b + 2] + N[c + 2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    if ((g[0] * nx + g[1] * ny + g[2] * nz) / (gl * nl) <= minDot) bad++;
  }
  return bad;
}

/** Interpret a (welded) layer as an engine SolidMesh for checkMesh. */
export function layerToSolid(l: MeshLayer): SolidMesh {
  const positions: Vec3[] = [];
  for (let i = 0; i < l.positions.length; i += 3) positions.push([l.positions[i], l.positions[i + 1], l.positions[i + 2]]);
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < l.indices.length; i += 3) triangles.push([l.indices[i], l.indices[i + 1], l.indices[i + 2]]);
  return { positions, triangles, triFace: triangles.map(() => 0), faces: [] };
}

/** Weld a triangle soup by rounded position (1e-5 m) and count edges not used exactly twice in opposite directions. */
export function openEdgesOfSoup(tris: Vec3[][]): number {
  const id = new Map<string, number>();
  const key = (p: Vec3) => p.map((x) => Math.round(x * 1e5)).join(',');
  const vid = (p: Vec3) => { const k = key(p); let v = id.get(k); if (v === undefined) { v = id.size; id.set(k, v); } return v; };
  const dir = new Map<string, number>();
  for (const t of tris) {
    const [a, b, c] = t.map(vid);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) dir.set(`${u},${v}`, (dir.get(`${u},${v}`) ?? 0) + 1);
  }
  let bad = 0;
  for (const [k, n] of dir) {
    const [u, v] = k.split(',');
    if (n !== 1 || dir.get(`${v},${u}`) !== 1) bad++;
  }
  return bad;
}

/** Signed volume of a triangle soup (divergence theorem). */
export function soupVolume(tris: Vec3[][]): number {
  let v = 0;
  for (const [A, B, C] of tris) v += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
  return v;
}

/** Split a GLB into its JSON and BIN chunks. */
export function parseGLB(glb: Uint8Array): { json: any; bin: Uint8Array } {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  const o = 20 + jsonLen;
  const bin = o < glb.byteLength ? glb.subarray(o + 8, o + 8 + dv.getUint32(o, true)) : new Uint8Array(0);
  return { json, bin };
}

/** Float32 data of a glTF accessor. */
export function accessorFloats(json: any, bin: Uint8Array, i: number): Float32Array {
  const acc = json.accessors[i], bv = json.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type as 'VEC3']!;
  return new Float32Array(bin.slice(bv.byteOffset + (acc.byteOffset ?? 0), bv.byteOffset + (acc.byteOffset ?? 0) + acc.count * comps * 4).buffer);
}

/** Total triangle count of the selected layer kinds. */
export const triCount = (m: HouseMesh, kinds: string[]) => m.layers.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l.indices.length / 3, 0);
