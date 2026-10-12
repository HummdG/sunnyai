// Shared material palette (UK-realistic, sRGB hex colours) used by the web viewer and by the exporters.
// Colours are sRGB (what a designer would pick); exporters convert to linear where a format requires it (glTF).
import type { MaterialKey, RoofMaterial, WallMaterial } from '../types.js';

/** PBR-lite material: sRGB hex colour, roughness / metalness in [0, 1], optional opacity (1 = opaque). */
export interface MaterialDef {
  color: string;
  roughness: number;
  metalness: number;
  opacity?: number;
}

/** Palette for every MaterialKey (procedural default look of a UK house). */
export const MATERIALS: Record<MaterialKey, MaterialDef> = {
  'wall-brick': { color: '#9a5a40', roughness: 0.9, metalness: 0 }, // red-brown stock brick
  'wall-render': { color: '#e8e0cc', roughness: 0.85, metalness: 0 }, // cream render
  'wall-stone': { color: '#b9ab8c', roughness: 0.9, metalness: 0 }, // sandstone / limestone
  'wall-timber': { color: '#8b6b4b', roughness: 0.8, metalness: 0 }, // stained timber cladding
  'wall-pebbledash': { color: '#cdc4b1', roughness: 0.95, metalness: 0 }, // grey-beige pebbledash
  'roof-tile': { color: '#9c4a31', roughness: 0.8, metalness: 0 }, // terracotta clay plain tile
  'roof-slate': { color: '#4b5059', roughness: 0.6, metalness: 0 }, // Welsh blue-grey slate
  'roof-flat': { color: '#3c3d40', roughness: 0.9, metalness: 0 }, // felt / EPDM membrane
  'roof-underside': { color: '#ebe7de', roughness: 0.7, metalness: 0 }, // white uPVC soffit / fascia
  glass: { color: '#3e5566', roughness: 0.05, metalness: 0, opacity: 0.55 }, // tinted glazing
  frame: { color: '#f3f3ef', roughness: 0.4, metalness: 0 }, // white uPVC / painted timber frames
  door: { color: '#24384c', roughness: 0.45, metalness: 0 }, // painted front door (dark blue)
  sill: { color: '#d8d2c4', roughness: 0.8, metalness: 0 }, // reconstituted stone sill / step
  'floor-slab': { color: '#bcb6aa', roughness: 0.95, metalness: 0 }, // concrete / screed
  'interior-wall': { color: '#f1eee7', roughness: 0.9, metalness: 0 }, // plastered, painted
  stair: { color: '#a77c5c', roughness: 0.7, metalness: 0 }, // timber stair
  'room-floor': { color: '#c9aa7f', roughness: 0.8, metalness: 0 }, // oak-effect floor
  chimney: { color: '#8e4e37', roughness: 0.9, metalness: 0 }, // chimney brick (weathered)
  'neighbour-wall': { color: '#d0cbc3', roughness: 0.95, metalness: 0 }, // neutral context massing
  'neighbour-roof': { color: '#8b8681', roughness: 0.9, metalness: 0 },
  terrain: { color: '#7d9a5b', roughness: 1, metalness: 0 }, // grass
};

const WALL_KEYS: Record<WallMaterial, MaterialKey> = {
  brick: 'wall-brick', render: 'wall-render', stone: 'wall-stone', timber: 'wall-timber', pebbledash: 'wall-pebbledash',
};
const ROOF_KEYS: Record<RoofMaterial, MaterialKey> = { tile: 'roof-tile', slate: 'roof-slate', flat: 'roof-flat' };

/** Palette key for a part's wall material (unknown values fall back to brick). */
export function wallMaterialKey(m: WallMaterial | undefined): MaterialKey {
  return (m && WALL_KEYS[m]) || 'wall-brick';
}

/** Palette key for a part's roof covering (unknown values fall back to tile). */
export function roofMaterialKey(m: RoofMaterial | undefined): MaterialKey {
  return (m && ROOF_KEYS[m]) || 'roof-tile';
}

/** Parse '#rgb' / '#rrggbb' into sRGB components in [0, 1]; returns null for anything else. */
export function parseHexColour(hex: string | undefined): [number, number, number] | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** sRGB transfer function -> linear (IEC 61966-2-1). */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear RGB in [0, 1] of a hex colour (glTF baseColorFactor); grey for unparsable input. */
export function hexToLinearRgb(hex: string): [number, number, number] {
  const c = parseHexColour(hex) ?? [0.7, 0.7, 0.7];
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}
