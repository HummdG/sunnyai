// OBJ and GLB writers (welded vertices -> the exported mesh keeps the watertight topology).
// GLB: glTF 2.0, y-up (three.js world: x = east, y = up, z = -north); one primitive per face kind sharing one
// POSITION accessor; no NORMAL attribute (viewers must compute flat normals per glTF spec).
import type { SolidMesh } from './solid.js';

const KIND_COLOURS: Record<string, [number, number, number]> = {
  roof: [0.62, 0.23, 0.18], gable: [0.82, 0.74, 0.62], party: [0.55, 0.55, 0.6], riser: [0.9, 0.6, 0.2],
  flat: [0.35, 0.35, 0.38], 'parapet-top': [0.75, 0.72, 0.68], 'parapet-inner': [0.8, 0.77, 0.7],
  wall: [0.86, 0.8, 0.7], floor: [0.3, 0.3, 0.3],
};

export function toOBJ(m: SolidMesh, name = 'building'): string {
  const lines = [`# ${name}: ${m.positions.length} vertices, ${m.triangles.length} triangles; z-up, metres (x = east, y = north)`, `o ${name}`];
  for (const p of m.positions) lines.push(`v ${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}`);
  const byKind = new Map<string, number[]>();
  m.triangles.forEach((_, i) => { const k = m.faces[m.triFace[i]].kind; if (!byKind.has(k)) byKind.set(k, []); byKind.get(k)!.push(i); });
  for (const [k, tris] of byKind) {
    lines.push(`g ${k}`, `usemtl ${k}`);
    for (const i of tris) { const [a, b, c] = m.triangles[i]; lines.push(`f ${a + 1} ${b + 1} ${c + 1}`); }
  }
  return lines.join('\n') + '\n';
}

export function toMTL(): string {
  return Object.entries(KIND_COLOURS).map(([k, c]) => `newmtl ${k}\nKd ${c.join(' ')}\n`).join('\n');
}

export function toGLB(m: SolidMesh): Uint8Array {
  const used = m.positions;
  const pos = new Float32Array(used.length * 3);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  used.forEach((p, i) => {
    const q = [p[0], p[2], -p[1]]; // z-up -> y-up
    for (let k = 0; k < 3; k++) { pos[i * 3 + k] = q[k]; min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); }
  });
  const kinds = [...new Set(m.triangles.map((_, i) => m.faces[m.triFace[i]].kind))];
  const idxArrays = kinds.map((k) => {
    const a: number[] = [];
    m.triangles.forEach((t, i) => { if (m.faces[m.triFace[i]].kind === k) a.push(...t); });
    return new Uint32Array(a);
  });
  // buffer layout: positions then each index array (4-byte aligned)
  const chunks: Uint8Array[] = [new Uint8Array(pos.buffer), ...idxArrays.map((a) => new Uint8Array(a.buffer))];
  const offsets: number[] = [];
  let off = 0;
  for (const c of chunks) { offsets.push(off); off += Math.ceil(c.byteLength / 4) * 4; }
  const bin = new Uint8Array(off);
  chunks.forEach((c, i) => bin.set(c, offsets[i]));
  const gltf = {
    asset: { version: '2.0', generator: 'sunscan-roofs-research' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'building' }],
    meshes: [{ name: 'building', primitives: kinds.map((k, i) => ({ attributes: { POSITION: 0 }, indices: i + 1, material: i, mode: 4 })) }],
    materials: kinds.map((k) => ({ name: k, doubleSided: false, pbrMetallicRoughness: { baseColorFactor: [...(KIND_COLOURS[k] ?? [0.7, 0.7, 0.7]), 1], metallicFactor: 0, roughnessFactor: 0.9 } })),
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: pos.byteLength, target: 34962 },
      ...idxArrays.map((a, i) => ({ buffer: 0, byteOffset: offsets[i + 1], byteLength: a.byteLength, target: 34963 })),
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: used.length, type: 'VEC3', min, max },
      ...idxArrays.map((a, i) => ({ bufferView: i + 1, componentType: 5125, count: a.length, type: 'SCALAR' })),
    ],
  };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = Math.ceil(json.byteLength / 4) * 4;
  const jsonChunk = new Uint8Array(jsonPad).fill(0x20);
  jsonChunk.set(json);
  json = jsonChunk;
  const total = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, json.byteLength, true); dv.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
  const o2 = 20 + json.byteLength;
  dv.setUint32(o2, bin.byteLength, true); dv.setUint32(o2 + 4, 0x004e4942, true); out.set(bin, o2 + 8);
  return out;
}

/** Binary STL (unwelded triangles, z-up). */
export function toSTL(m: SolidMesh): Uint8Array {
  const out = new Uint8Array(84 + 50 * m.triangles.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, m.triangles.length, true);
  m.triangles.forEach(([a, b, c], i) => {
    const A = m.positions[a], B = m.positions[b], C = m.positions[c];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const o = 84 + 50 * i;
    [n[0] / l, n[1] / l, n[2] / l, ...A, ...B, ...C].forEach((x, k) => dv.setFloat32(o + 4 * k, x, true));
  });
  return out;
}
