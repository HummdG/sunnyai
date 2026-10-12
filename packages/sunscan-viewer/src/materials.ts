// Material palette for MeshLayer.material keys. Base colours/roughness come from core's MATERIALS palette when core
// exports one (shape tolerated: color | colour | baseColor as '#hex', 0xRRGGBB or [r, g, b] 0..1), else from the
// local palette below. Textures and tile sizes are a viewer concern and always local.
import { Color, DoubleSide, FrontSide, MeshStandardMaterial, type Plane, type Texture } from 'three';
import type { MaterialKey } from '@sunny/sunscan-core/types';
import { makeTexture, type TextureKind } from './textures';

export interface MaterialDef {
  color: string;
  roughness: number;
  metalness: number;
  opacity?: number;
  texture?: TextureKind;
  /** Metres covered by one texture repeat [u, v]. */
  tile?: [number, number];
  /** Recompute UVs in the face plane (roof coverings: courses parallel to the eaves). */
  slopeUv?: boolean;
  doubleSide?: boolean;
}

export const LOCAL_PALETTE: Record<MaterialKey, MaterialDef> = {
  'wall-brick': { color: '#9a5b45', roughness: 0.92, metalness: 0, texture: 'brick', tile: [0.9, 0.6] },
  'wall-render': { color: '#e4dfd3', roughness: 0.95, metalness: 0, texture: 'render', tile: [2, 2] },
  'wall-stone': { color: '#b8a98d', roughness: 0.95, metalness: 0, texture: 'stone', tile: [1.6, 1.2] },
  'wall-timber': { color: '#8a6a4c', roughness: 0.85, metalness: 0, texture: 'timber', tile: [1.0, 1.2] },
  'wall-pebbledash': { color: '#d3ccbd', roughness: 1, metalness: 0, texture: 'pebbledash', tile: [1.5, 1.5] },
  'roof-tile': { color: '#7b4b3a', roughness: 0.85, metalness: 0, texture: 'tile', tile: [1.2, 1.2], slopeUv: true },
  'roof-slate': { color: '#535b66', roughness: 0.7, metalness: 0.05, texture: 'slate', tile: [1.0, 1.0], slopeUv: true },
  'roof-flat': { color: '#5b5e63', roughness: 0.95, metalness: 0, texture: 'felt', tile: [2, 2] },
  'roof-underside': { color: '#d8d1c3', roughness: 0.9, metalness: 0 },
  glass: { color: '#a9c3d2', roughness: 0.06, metalness: 0.1, opacity: 0.38 },
  frame: { color: '#f0eee8', roughness: 0.55, metalness: 0 },
  door: { color: '#2f4d5c', roughness: 0.6, metalness: 0 },
  sill: { color: '#d6d0c3', roughness: 0.8, metalness: 0 },
  'floor-slab': { color: '#b9b2a6', roughness: 0.95, metalness: 0, doubleSide: true },
  'interior-wall': { color: '#ebe6dc', roughness: 0.95, metalness: 0, doubleSide: true },
  stair: { color: '#a5825e', roughness: 0.75, metalness: 0, doubleSide: true },
  'room-floor': { color: '#c9b597', roughness: 0.8, metalness: 0, doubleSide: true },
  chimney: { color: '#8f523e', roughness: 0.92, metalness: 0, texture: 'brick', tile: [0.9, 0.6] },
  'neighbour-wall': { color: '#cdc8bf', roughness: 0.95, metalness: 0 },
  'neighbour-roof': { color: '#8e8b87', roughness: 0.9, metalness: 0 },
  terrain: { color: '#a8b496', roughness: 1, metalness: 0, texture: 'grass', tile: [4, 4] },
};

/** Keys that belong to the context, not the house (never clipped by the storey cutaway). */
export const CONTEXT_KEYS = new Set<MaterialKey>(['neighbour-wall', 'neighbour-roof', 'terrain']);

function colourOf(v: unknown): string | undefined {
  if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v.trim())) return v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`;
  if (typeof v === 'number' && Number.isFinite(v)) return `#${(v & 0xffffff).toString(16).padStart(6, '0')}`;
  if (Array.isArray(v) && v.length >= 3 && v.every((c) => typeof c === 'number')) return `#${new Color(v[0], v[1], v[2]).getHexString()}`;
  return undefined;
}
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : undefined);

/** Merges core's palette (unknown shape) over the local palette. */
export function resolvePalette(external: unknown): Record<MaterialKey, MaterialDef> {
  const out = { ...LOCAL_PALETTE };
  if (!external || typeof external !== 'object') return out;
  for (const key of Object.keys(LOCAL_PALETTE) as MaterialKey[]) {
    const e = (external as Record<string, unknown>)[key];
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const color = colourOf(r.color ?? r.colour ?? r.baseColor ?? r.hex);
    out[key] = {
      ...out[key],
      ...(color ? { color } : {}),
      roughness: num(r.roughness, 0, 1) ?? out[key].roughness,
      metalness: num(r.metalness, 0, 1) ?? out[key].metalness,
      ...(num(r.opacity, 0, 1) !== undefined ? { opacity: num(r.opacity, 0, 1) } : {}),
    };
  }
  return out;
}

export class MaterialLibrary {
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly textures = new Map<string, Texture>();
  private clip: Plane[] | null = null;

  constructor(readonly palette: Record<MaterialKey, MaterialDef>) {}

  def(key: MaterialKey): MaterialDef {
    return this.palette[key] ?? LOCAL_PALETTE['wall-render'];
  }

  /** Shared material for a key (+ optional colour override, e.g. a part's wallColour). */
  get(key: MaterialKey, colour?: string): MeshStandardMaterial {
    const def = this.def(key);
    const base = colourOf(colour) ?? def.color;
    const id = `${key}|${base}`;
    let m = this.materials.get(id);
    if (m) return m;
    let map: Texture | null = null;
    if (def.texture) {
      const tid = `${def.texture}|${base}`;
      map = this.textures.get(tid) ?? makeTexture(def.texture, base);
      this.textures.set(tid, map);
    }
    m = new MeshStandardMaterial({
      name: key, color: map ? '#ffffff' : base, map, roughness: def.roughness, metalness: def.metalness,
      transparent: def.opacity !== undefined && def.opacity < 1, opacity: def.opacity ?? 1,
      depthWrite: !(def.opacity !== undefined && def.opacity < 1), side: def.doubleSide ? DoubleSide : FrontSide,
    });
    m.userData.key = key;
    this.applyClip(m);
    this.materials.set(id, m);
    return m;
  }

  /** Clipping planes for the storey cutaway (house materials only). Cut walls render both sides. */
  setClipping(planes: Plane[] | null): void {
    this.clip = planes;
    for (const m of this.materials.values()) this.applyClip(m);
  }

  private applyClip(m: MeshStandardMaterial): void {
    const key = m.userData.key as MaterialKey;
    if (CONTEXT_KEYS.has(key)) return;
    const want = this.clip;
    const doubleSide = !!want || !!this.def(key).doubleSide;
    if (m.clippingPlanes === want && (m.side === DoubleSide) === doubleSide) return;
    m.clippingPlanes = want;
    m.clipShadows = !!want;
    m.side = doubleSide ? DoubleSide : FrontSide;
    m.needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.materials.clear();
    this.textures.clear();
  }
}
