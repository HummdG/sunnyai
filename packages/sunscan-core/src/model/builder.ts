// LayerBuilder: accumulates triangles (positions, unit normals, metre UVs, optional per-triangle tags) for one
// MeshLayer. All helpers emit counter-clockwise triangles seen from the side the normal points to (outside),
// in the right-handed ENU frame (x east, y north, z up).
import { triangulateLoops } from '../geometry/triangulate.js';
import type { LayerKind, MaterialKey, MeshLayer, Vec2, Vec3 } from '../types.js';

/** Identification of a layer (everything in MeshLayer except the arrays). */
export interface LayerMeta {
  id: string;
  kind: LayerKind;
  material: MaterialKey;
  partId?: string;
  storey?: number;
}

/** Maps a 3D point to metre UVs. */
export type UVFn = (p: Vec3) => Vec2;

/** Per-triangle tag meaning "not attributable" (largest Uint32). */
export const NO_TAG = 0xffffffff;

/** 3D vector helpers (plain tuples, no allocation beyond the result). */
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
/** Unit vector (falls back to +z for a zero vector). */
export function unit3(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}

/** Plan UVs (x, y): roofs, floors, terrain. */
export const planUV: UVFn = (p) => [p[0], p[1]];

/** Wall UVs for a vertical face with outward normal n: u = metres to the right (seen from outside) + u0, v = z. */
export function wallUV(n: Vec3, u0 = 0): UVFn {
  const l = Math.hypot(n[0], n[1]) || 1;
  const tx = -n[1] / l, ty = n[0] / l;
  return (p) => [p[0] * tx + p[1] * ty + u0, p[2]];
}

/** Plan UVs for faces that are closer to horizontal than vertical, wall UVs otherwise. */
export function autoUV(n: Vec3): UVFn {
  return Math.abs(n[2]) > 0.7 ? planUV : wallUV(n);
}

/** Orthonormal in-plane axes (e1, e2) with e1 x e2 = n (CCW in (e1, e2) == CCW seen from the n side). */
export function planeFrame(n: Vec3): [Vec3, Vec3] {
  let e1: Vec3;
  if (Math.abs(n[2]) < 0.9) e1 = unit3([-n[1], n[0], 0]);
  else e1 = unit3(sub3([1, 0, 0], scale3(n, n[0])));
  return [e1, cross3(n, e1)];
}

/** Faces of an oriented box (by outward axis), used to omit hidden faces. */
export type BoxFace = '-u' | '+u' | '-v' | '+v' | '-w' | '+w';

/** Accumulates the triangles of one MeshLayer (flat-shaded faces unless vertices are shared explicitly). */
export class LayerBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];
  private readonly tags: number[] = [];
  private tagged = false;

  constructor(readonly meta: LayerMeta) {}

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.idx.length / 3; }

  /** Add one vertex; returns its index. */
  vertex(p: Vec3, n: Vec3, uv: Vec2): number {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    return this.pos.length / 3 - 1;
  }

  /** Add a triangle of existing vertex indices (CCW from outside). */
  triangle(a: number, b: number, c: number, tag: number = NO_TAG): void {
    this.idx.push(a, b, c);
    this.tags.push(tag);
    if (tag !== NO_TAG) this.tagged = true;
  }

  /** Flat convex polygon (CCW seen from outside), fan-triangulated. Returns false if degenerate. */
  convex(pts: Vec3[], n?: Vec3, uv?: UVFn, tag: number = NO_TAG): boolean {
    if (pts.length < 3) return false;
    const nn = n ?? polygonNormal(pts);
    if (!nn) return false;
    const f = uv ?? autoUV(nn);
    const ids = pts.map((p) => this.vertex(p, nn, f(p)));
    for (let i = 1; i + 1 < ids.length; i++) this.triangle(ids[0], ids[i], ids[i + 1], tag);
    return true;
  }

  /** Quad a, b, c, d (CCW seen from outside). */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n?: Vec3, uv?: UVFn, tag: number = NO_TAG): boolean {
    return this.convex([a, b, c, d], n, uv, tag);
  }

  /**
   * Flat polygon with holes: outer loops CCW and hole loops CW as seen from the side `n` points to.
   * Triangulated with the engine's ear clipper (keeps collinear vertices). Returns false if triangulation failed.
   */
  polygon(loops: Vec3[][], n: Vec3, uv?: UVFn, tag: number = NO_TAG): boolean {
    const [e1, e2] = planeFrame(n);
    const pts: Vec2[] = [];
    const src: Vec3[] = [];
    const loopIdx: number[][] = [];
    for (const l of loops) {
      if (l.length < 3) continue;
      loopIdx.push(l.map((p) => { pts.push([dot3(p, e1), dot3(p, e2)]); src.push(p); return pts.length - 1; }));
    }
    if (!loopIdx.length) return false;
    let tris: [number, number, number][];
    try { tris = triangulateLoops(pts, loopIdx); } catch { return false; }
    if (!tris.length) return false;
    const f = uv ?? autoUV(n);
    const ids = new Map<number, number>();
    const vid = (k: number) => {
      let v = ids.get(k);
      if (v === undefined) { v = this.vertex(src[k], n, f(src[k])); ids.set(k, v); }
      return v;
    };
    for (const [a, b, c] of tris) this.triangle(vid(a), vid(b), vid(c), tag);
    return true;
  }

  /**
   * Oriented box: corners o + U*u + V*v + W*w with u in [u0, u1], v in [v0, v1], w in [w0, w1].
   * (U, V, W) must be orthonormal and right-handed (U x V = W). `skip` omits hidden faces.
   */
  box(o: Vec3, U: Vec3, V: Vec3, W: Vec3, e: [number, number, number, number, number, number], skip: BoxFace[] = [], tag: number = NO_TAG): void {
    const [u0, u1, v0, v1, w0, w1] = e;
    if (!(u1 - u0 > 1e-9 && v1 - v0 > 1e-9 && w1 - w0 > 1e-9)) return;
    const us = [u0, u1], vs = [v0, v1], ws = [w0, w1];
    const c = (i: number, j: number, k: number): Vec3 => add3(o, add3(scale3(U, us[i]), add3(scale3(V, vs[j]), scale3(W, ws[k]))));
    const faces: [BoxFace, Vec3, Vec3[]][] = [
      ['-u', scale3(U, -1), [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)]],
      ['+u', U, [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)]],
      ['-v', scale3(V, -1), [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)]],
      ['+v', V, [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)]],
      ['-w', scale3(W, -1), [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)]],
      ['+w', W, [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)]],
    ];
    for (const [name, n, q] of faces) if (!skip.includes(name)) this.convex(q, n, undefined, tag);
  }

  /** Finish: typed arrays, or null when the layer is empty. */
  build(): MeshLayer | null {
    if (!this.idx.length) return null;
    const layer: MeshLayer = {
      ...this.meta,
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      uvs: new Float32Array(this.uv),
      indices: new Uint32Array(this.idx),
    };
    if (layer.partId === undefined) delete layer.partId;
    if (layer.storey === undefined) delete layer.storey;
    if (this.tagged) layer.triangleTags = new Uint32Array(this.tags);
    return layer;
  }
}

/** Newell normal of a (nearly) planar polygon; null when degenerate. */
export function polygonNormal(pts: Vec3[]): Vec3 | null {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return l > 1e-12 ? [x / l, y / l, z / l] : null;
}

/** Collects named builders in creation order and returns the non-empty layers. */
export class LayerSet {
  private readonly builders = new Map<string, LayerBuilder>();

  /** Builder for `meta.id` (created on first use; later calls return the same builder). */
  get(meta: LayerMeta): LayerBuilder {
    let b = this.builders.get(meta.id);
    if (!b) { b = new LayerBuilder(meta); this.builders.set(meta.id, b); }
    return b;
  }

  build(): MeshLayer[] {
    const out: MeshLayer[] = [];
    for (const b of this.builders.values()) { const l = b.build(); if (l) out.push(l); }
    return out;
  }
}
