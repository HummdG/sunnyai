// Shared helpers for the house exporters: default layer sets and the attribution string.
import type { HouseMesh, HouseModelSpec, LayerKind, MeshLayer } from '../types.js';

/** Default GLB / OBJ content: the rendered model (roof skin instead of the closed solids and their roof view). */
export const DEFAULT_RENDER_LAYERS: readonly LayerKind[] = ['walls', 'roof-skin', 'openings', 'floors', 'interior', 'stairs', 'chimneys', 'neighbours', 'terrain'];
/** Default STL content: the closed watertight part solids (3D printing). */
export const DEFAULT_PRINT_LAYERS: readonly LayerKind[] = ['solid'];

/** Non-empty layers of the requested kinds, in HouseMesh order. */
export function selectLayers(mesh: HouseMesh, kinds: readonly LayerKind[] | 'glb' | 'stl'): MeshLayer[] {
  const want = new Set(kinds === 'glb' ? DEFAULT_RENDER_LAYERS : kinds === 'stl' ? DEFAULT_PRINT_LAYERS : kinds);
  return mesh.layers.filter((l) => want.has(l.kind) && l.indices.length >= 3 && l.positions.length >= 9);
}

/** Attribution / copyright line from the spec provenance (unique attributions, in order, '; '-joined). */
export function attributionOf(spec: HouseModelSpec): string {
  const seen = new Set<string>();
  for (const s of spec.provenance ?? []) {
    const a = (s?.attribution ?? '').trim();
    if (a) seen.add(a);
  }
  return [...seen].join('; ');
}
