// Cut levels for the storey cutaway (pure). Preference order: HouseMesh.levels (exact, from core/model), the mesh's
// rooms, per-storey floor layers, and finally the main part's eave split evenly between storeys.
import type { HouseMesh, HouseModelSpec } from '@sunny/sunscan-core/types';

export interface CutLevel {
  storey: number; // 0 = ground floor
  floorZ: number; // metres above the ground datum
  topZ: number; // cut height for "show up to this storey" (ceiling / next floor level)
  inRoof?: boolean; // storey inside the roof space (attic)
}

const PLINTH = 0.15;

export function storeyLevels(spec: HouseModelSpec, mesh: Pick<HouseMesh, 'rooms' | 'layers' | 'levels'>): CutLevel[] {
  if (mesh.levels?.length) {
    const by = new Map<number, { floor: number; ceiling: number; inRoof: boolean }>();
    for (const l of mesh.levels) {
      const e = by.get(l.storey);
      by.set(l.storey, e
        ? { floor: Math.min(e.floor, l.floorZ), ceiling: Math.max(e.ceiling, l.ceilingZ), inRoof: e.inRoof && l.inRoof }
        : { floor: l.floorZ, ceiling: l.ceilingZ, inRoof: l.inRoof });
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([storey, e]) => ({
      storey, floorZ: e.floor, topZ: Math.max(e.floor + 0.5, e.ceiling + 0.02), ...(e.inRoof ? { inRoof: true } : {}),
    }));
  }
  const main = spec.parts.find((p) => p.role === 'main') ?? spec.parts[0];
  const count = Math.max(1, ...spec.parts.map((p) => p.storeys));
  const floors = new Map<number, number>();
  const ceilings = new Map<number, number>();
  for (const r of mesh.rooms) {
    floors.set(r.storey, Math.min(floors.get(r.storey) ?? Infinity, r.floorZ));
    ceilings.set(r.storey, Math.max(ceilings.get(r.storey) ?? -Infinity, r.ceilingZ));
  }
  if (!floors.size)
    for (const l of mesh.layers) {
      if (l.kind !== 'floors' || l.storey === undefined) continue;
      let top = -Infinity;
      for (let i = 2; i < l.positions.length; i += 3) top = Math.max(top, l.positions[i]);
      if (Number.isFinite(top)) floors.set(l.storey, Math.min(floors.get(l.storey) ?? Infinity, top));
    }
  const eave = main ? main.eaveHeight : 2.6 * count;
  const base = main ? main.baseHeight : 0;
  const even = (eave - base - PLINTH) / count;
  const out: CutLevel[] = [];
  for (let s = 0; s < count; s++) {
    const floorZ = floors.get(s) ?? base + PLINTH + s * even;
    const nextFloor = floors.get(s + 1) ?? (s + 1 < count ? base + PLINTH + (s + 1) * even : eave);
    const ceiling = ceilings.get(s);
    const topZ = Math.max(floorZ + 0.5, ceiling !== undefined ? Math.min(ceiling + 0.02, nextFloor - 0.01) : nextFloor - 0.01);
    out.push({ storey: s, floorZ, topZ });
  }
  return out;
}

const ORDINAL = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
/** 'Ground floor', 'First floor', … (UK numbering); attic storeys are the roof space. */
export const storeyName = (s: number, inRoof = false) => (inRoof ? 'Roof space' : `${ORDINAL[s] ?? `Storey ${s + 1}`} floor`);
