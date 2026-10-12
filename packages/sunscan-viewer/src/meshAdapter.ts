// MeshLayer (core, local ENU, z-up) -> three.js BufferGeometry (x = E, y = U, z = -N). DOM-free (unit tested).
import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshLayer } from '@sunny/sunscan-core/types';
import { enuBufferToThree, normalizeVectors } from './frames';

export interface AdaptOptions {
  /** Metres covered by one texture repeat [u, v]; null/undefined = untextured (no uv attribute is written). */
  uvTile?: readonly [number, number] | null;
  /**
   * 'keep'  : scale the layer's metre UVs (walls: along/up; floors: plan x/y).
   * 'slope' : recompute UVs per triangle in the plane of the face (u along the eave, v up the slope) so tile and
   *           slate courses run parallel to the eaves whatever the building's orientation (unwelds the triangles).
   */
  uvMode?: 'keep' | 'slope';
  /** Unweld and use per-face normals (welded solids carry smooth normals that shade badly). */
  flatNormals?: boolean;
}

/** Structural problems that make a layer unusable, or null when it is well-formed. */
export function layerProblem(layer: MeshLayer): string | null {
  const n = layer.positions.length / 3;
  if (!Number.isInteger(n) || n === 0) return `${layer.id}: positions length ${layer.positions.length} is not a non-zero multiple of 3`;
  if (layer.indices.length === 0 || layer.indices.length % 3 !== 0) return `${layer.id}: ${layer.indices.length} indices is not a non-zero multiple of 3`;
  for (let i = 0; i < layer.indices.length; i++) if (layer.indices[i] >= n) return `${layer.id}: index ${layer.indices[i]} out of range (${n} vertices)`;
  for (let i = 0; i < layer.positions.length; i++) if (!Number.isFinite(layer.positions[i])) return `${layer.id}: non-finite position`;
  return null;
}

const indexArray = (src: ArrayLike<number>, vertexCount: number) => (vertexCount <= 65535 ? Uint16Array.from(src) : Uint32Array.from(src));

/** Builds a BufferGeometry for a layer. Throws on malformed layers (see layerProblem). */
export function layerToGeometry(layer: MeshLayer, opts: AdaptOptions = {}): BufferGeometry {
  const problem = layerProblem(layer);
  if (problem) throw new Error(problem);
  if (opts.uvTile && opts.uvMode === 'slope') return slopeGeometry(layer, opts.uvTile, !!opts.flatNormals);
  const n = layer.positions.length / 3;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(enuBufferToThree(layer.positions), 3));
  if (layer.normals.length === layer.positions.length) {
    const normals = enuBufferToThree(layer.normals);
    normalizeVectors(normals);
    geo.setAttribute('normal', new BufferAttribute(normals, 3));
  }
  if (opts.uvTile && layer.uvs.length === n * 2) {
    const [tu, tv] = opts.uvTile;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uv[2 * i] = layer.uvs[2 * i] / tu; uv[2 * i + 1] = layer.uvs[2 * i + 1] / tv; }
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
  }
  geo.setIndex(new BufferAttribute(indexArray(layer.indices, n), 1));
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (opts.flatNormals) {
    const flat = geo.toNonIndexed(); // one vertex per triangle corner
    flat.deleteAttribute('normal');
    flat.computeVertexNormals(); // non-indexed -> face normals
    geo.dispose();
    flat.computeBoundingBox();
    flat.computeBoundingSphere();
    return flat;
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Unwelded geometry with per-face UVs in the face plane (u along the horizontal tangent, v up the slope). */
function slopeGeometry(layer: MeshLayer, tile: readonly [number, number], flat: boolean): BufferGeometry {
  const P = layer.positions, I = layer.indices, N = layer.normals;
  const triCount = I.length / 3;
  const pos = new Float32Array(triCount * 9), nrm = new Float32Array(triCount * 9), uv = new Float32Array(triCount * 6);
  const hasNormals = !flat && N.length === P.length;
  for (let t = 0; t < triCount; t++) {
    const ia = I[3 * t], ib = I[3 * t + 1], ic = I[3 * t + 2];
    const ax = P[3 * ia], ay = P[3 * ia + 1], az = P[3 * ia + 2];
    const ux = P[3 * ib] - ax, uy = P[3 * ib + 1] - ay, uz = P[3 * ib + 2] - az;
    const vx = P[3 * ic] - ax, vy = P[3 * ic + 1] - ay, vz = P[3 * ic + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // horizontal tangent (along the eave) and up-slope bitangent b = n x t; flat faces use plan x / y
    let tx = 1, ty = 0, bx = 0, by = 1, bz = 0;
    const h = Math.hypot(nx, ny);
    if (h > 1e-6) {
      tx = -ny / h; ty = nx / h;
      bx = -nz * ty; by = nz * tx; bz = nx * ty - ny * tx;
    }
    [ia, ib, ic].forEach((vi, k) => {
      const x = P[3 * vi], y = P[3 * vi + 1], z = P[3 * vi + 2];
      const o = 9 * t + 3 * k;
      pos[o] = x; pos[o + 1] = z; pos[o + 2] = -y; // ENU -> three
      const sx = hasNormals ? N[3 * vi] : nx, sy = hasNormals ? N[3 * vi + 1] : ny, sz = hasNormals ? N[3 * vi + 2] : nz;
      nrm[o] = sx; nrm[o + 1] = sz; nrm[o + 2] = -sy;
      uv[6 * t + 2 * k] = (x * tx + y * ty) / tile[0];
      uv[6 * t + 2 * k + 1] = (x * bx + y * by + z * bz) / tile[1];
    });
  }
  normalizeVectors(nrm);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  const vc = triCount * 3;
  geo.setIndex(new BufferAttribute(vc <= 65535 ? new Uint16Array(vc).map((_, i) => i) : new Uint32Array(vc).map((_, i) => i), 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Bounding box of all positions of the given layers, in ENU: [minX, minY, minZ, maxX, maxY, maxZ]. */
export function enuBounds(layers: readonly MeshLayer[]): [number, number, number, number, number, number] | null {
  let b: [number, number, number, number, number, number] | null = null;
  for (const l of layers)
    for (let i = 0; i < l.positions.length; i += 3) {
      const x = l.positions[i], y = l.positions[i + 1], z = l.positions[i + 2];
      if (!b) b = [x, y, z, x, y, z];
      else { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.min(b[2], z); b[3] = Math.max(b[3], x); b[4] = Math.max(b[4], y); b[5] = Math.max(b[5], z); }
    }
  return b;
}
