// glTF 2.0 binary (GLB) writer for a HouseMesh — hand-written, dependency-free, isomorphic.
//   - y-up: (x, y, z)_ENU -> (x, z, -y), metres (three.js / glTF world: x = east, y = up, z = -north)
//   - one node + mesh per layer (name = layer id, extras = kind / material / part / storey), under a root node
//   - PBR materials from the shared palette (glass: alphaMode BLEND), per-part colour overrides from the spec
//   - 'solid' layers are written without NORMAL so viewers shade them flat (glTF spec), keeping welded vertices
//   - asset.copyright = attribution of spec.provenance; root extras = { address, id, stats, quality, provenance }
import type { HouseMesh, HouseModelSpec, LayerKind, MaterialKey, MeshLayer } from '../types.js';
import { MATERIALS, hexToLinearRgb, parseHexColour } from './materials.js';
import { attributionOf, selectLayers } from './export-common.js';

/** Options of exportHouseGLB. */
export interface GLBExportOptions {
  /** Layer kinds to include (default: everything except 'solid' and 'roof', i.e. the rendered roof skin). */
  layers?: LayerKind[];
  /** Write metre UVs as TEXCOORD_0 (default true). */
  uvs?: boolean;
  /** Apply the spec's per-part wall / roof colour overrides (default true). */
  partColours?: boolean;
}

const WALL_KEYS = new Set<MaterialKey>(['wall-brick', 'wall-render', 'wall-stone', 'wall-timber', 'wall-pebbledash']);
const ROOF_KEYS = new Set<MaterialKey>(['roof-tile', 'roof-slate', 'roof-flat']);

/** Colour override (hex) that applies to a layer, if any. */
function overrideColour(layer: MeshLayer, spec: HouseModelSpec): string | undefined {
  if (!layer.partId) return undefined;
  const m = spec.parts?.find((p) => p.id === layer.partId)?.material;
  if (!m) return undefined;
  const c = WALL_KEYS.has(layer.material) ? m.wallColour : ROOF_KEYS.has(layer.material) && (layer.kind === 'roof' || layer.kind === 'roof-skin') ? m.roofColour : undefined;
  return c && parseHexColour(c) ? c : undefined;
}

/** Serialise selected layers of a HouseMesh as a GLB (Uint8Array). */
export function exportHouseGLB(mesh: HouseMesh, spec: HouseModelSpec, opts: GLBExportOptions = {}): Uint8Array {
  const layers = selectLayers(mesh, opts.layers ?? 'glb');
  const withUV = opts.uvs !== false;
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const view = (data: ArrayBufferView, target: number) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const materials: Record<string, unknown>[] = [];
  const materialIndex = new Map<string, number>();
  const materialFor = (layer: MeshLayer) => {
    const colour = opts.partColours === false ? undefined : overrideColour(layer, spec);
    const key = colour ? `${layer.material}|${colour.toLowerCase()}` : layer.material;
    let i = materialIndex.get(key);
    if (i === undefined) {
      const def = MATERIALS[layer.material] ?? { color: '#b3b3b3', roughness: 0.9, metalness: 0 };
      const rgb = hexToLinearRgb(colour ?? def.color);
      const a = def.opacity ?? 1;
      const m: Record<string, unknown> = {
        name: colour ? `${layer.material}:${layer.partId}` : layer.material,
        pbrMetallicRoughness: { baseColorFactor: [rgb[0], rgb[1], rgb[2], a], metallicFactor: def.metalness, roughnessFactor: def.roughness },
      };
      if (a < 1) m.alphaMode = 'BLEND';
      i = materials.length;
      materials.push(m);
      materialIndex.set(key, i);
    }
    return i;
  };
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [{ name: spec.address?.display || spec.id || 'house', children: [] as number[] }];
  for (const layer of layers) {
    const n = layer.positions.length / 3;
    const pos = new Float32Array(n * 3);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = layer.positions[i * 3];
      pos[i * 3 + 1] = layer.positions[i * 3 + 2];
      pos[i * 3 + 2] = -layer.positions[i * 3 + 1];
    }
    for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < min[k]) min[k] = pos[i]; if (pos[i] > max[k]) max[k] = pos[i]; }
    const attributes: Record<string, number> = {};
    accessors.push({ bufferView: view(pos, 34962), componentType: 5126, count: n, type: 'VEC3', min, max });
    attributes.POSITION = accessors.length - 1;
    if (layer.kind !== 'solid') {
      const nrm = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const x = layer.normals[i * 3], y = layer.normals[i * 3 + 2], z = -layer.normals[i * 3 + 1];
        const l = Math.hypot(x, y, z) || 1;
        nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
      }
      accessors.push({ bufferView: view(nrm, 34962), componentType: 5126, count: n, type: 'VEC3' });
      attributes.NORMAL = accessors.length - 1;
    }
    if (withUV) {
      accessors.push({ bufferView: view(new Float32Array(layer.uvs), 34962), componentType: 5126, count: n, type: 'VEC2' });
      attributes.TEXCOORD_0 = accessors.length - 1;
    }
    const idx = n <= 65535 ? Uint16Array.from(layer.indices) : new Uint32Array(layer.indices);
    accessors.push({ bufferView: view(idx, 34963), componentType: n <= 65535 ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
    meshes.push({ name: layer.id, primitives: [{ attributes, indices: accessors.length - 1, material: materialFor(layer), mode: 4 }] });
    const extras: Record<string, unknown> = { kind: layer.kind, material: layer.material };
    if (layer.partId !== undefined) extras.partId = layer.partId;
    if (layer.storey !== undefined) extras.storey = layer.storey;
    nodes.push({ name: layer.id, mesh: meshes.length - 1, extras });
    (nodes[0].children as number[]).push(nodes.length - 1);
  }
  if (!(nodes[0].children as number[]).length) delete nodes[0].children;
  const extras = {
    address: spec.address, id: spec.id, stats: mesh.stats, quality: spec.quality, provenance: spec.provenance,
    origin: spec.origin, groundElevation: spec.groundElevation, frame: 'glTF y-up: x = east, y = up, z = -north (metres, origin = spec.origin)',
  };
  const copyright = attributionOf(spec);
  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'sunscan-core model exporter', ...(copyright ? { copyright } : {}) },
    extras,
    scene: 0,
    scenes: [{ name: 'house', nodes: [0], extras }],
    nodes,
  };
  if (meshes.length) {
    gltf.meshes = meshes;
    gltf.materials = materials;
    gltf.accessors = accessors;
    gltf.bufferViews = bufferViews;
    gltf.buffers = [{ byteLength: Math.ceil(byteLength / 4) * 4 }];
  }
  return packGLB(gltf, chunks, byteLength);
}

/** Assemble the GLB container: 12-byte header, JSON chunk (space padded), BIN chunk (zero padded). */
function packGLB(gltf: Record<string, unknown>, chunks: Uint8Array[], binLength: number): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = Math.ceil(json.byteLength / 4) * 4;
  const binLen = Math.ceil(binLength / 4) * 4;
  const hasBin = binLen > 0;
  const total = 12 + 8 + jsonLen + (hasBin ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(json, 20);
  out.fill(0x20, 20 + json.byteLength, 20 + jsonLen);
  if (hasBin) {
    const o = 20 + jsonLen;
    dv.setUint32(o, binLen, true);
    dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
    let p = o + 8;
    for (const c of chunks) { out.set(c, p); p += c.byteLength; }
  }
  return out;
}
