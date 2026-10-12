// HouseMesh.levels: the exact storey levels used by synthesizeHouse (partId, storey, floorZ, ceilingZ, inRoof), so
// viewers can cut away by storey without re-deriving them. Checked against the slabs, rooms and openings they drive.
import { describe, expect, it } from 'vitest';
import { SLAB_THICKNESS, storeyLevels, synthesizeHouse, type ModelSynthesisOptions } from '../src/model/index.js';
import type { HouseMesh, HouseModelSpec, MeshLayer } from '../src/types.js';
import { ALL_SPECS, part, rect, spec as mkSpec } from './fixtures/model/specs.js';
import { fixtureProvider } from './fixtures/model/interior.js';

type Name = keyof typeof ALL_SPECS;
const NAMES = Object.keys(ALL_SPECS) as Name[];
const build = (name: Name, opts: ModelSynthesisOptions = {}): { spec: HouseModelSpec; m: HouseMesh } => {
  const spec = ALL_SPECS[name]();
  return { spec, m: synthesizeHouse(spec, { layoutInterior: fixtureProvider, ...opts }) };
};
const maxZ = (l: MeshLayer) => { let z = -Infinity; for (let i = 2; i < l.positions.length; i += 3) z = Math.max(z, l.positions[i]); return z; };
const levelsOf = (m: HouseMesh, partId: string) => (m.levels ?? []).filter((l) => l.partId === partId);

describe('synthesizeHouse: HouseMesh.levels', () => {
  for (const name of NAMES) {
    it(`${name}: one level per storey of every part, ordered, consistent with the eave`, () => {
      const { spec, m } = build(name);
      expect(m.levels).toBeDefined();
      expect(new Set(m.levels!.map((l) => l.partId))).toEqual(new Set(spec.parts.map((p) => p.id)));
      for (const p of spec.parts) {
        const L = levelsOf(m, p.id);
        expect(L.map((l) => l.storey), p.id).toEqual(Array.from({ length: p.storeys }, (_, k) => k));
        L.forEach((l, k) => {
          expect(l.floorZ).toBeGreaterThan(p.baseHeight);
          expect(l.ceilingZ).toBeGreaterThan(l.floorZ + 2);
          if (k > 0) expect(l.floorZ).toBeCloseTo(L[k - 1].ceilingZ + SLAB_THICKNESS, 9); // ceiling = underside of the next slab
          expect(l.inRoof).toBe(l.ceilingZ > p.eaveHeight + 0.05);
          for (const v of [l.floorZ, l.ceilingZ]) expect(Number.isFinite(v)).toBe(true);
        });
      }
      // main part = the exported storeyLevels() of its spec
      const main = spec.parts.find((p) => p.role === 'main')!;
      expect(levelsOf(m, main.id).map(({ partId, ...l }) => l)).toEqual(storeyLevels(main, spec.era));
      expect(m.stats.storeys).toBe(levelsOf(m, main.id).length);
    });
  }

  it('attached parts share the main block\'s floor levels; a garage keeps its own', () => {
    const { m } = build('terraceOutrigger');
    const main = levelsOf(m, 'main'), rear = levelsOf(m, 'rear-1');
    expect(rear.length).toBeGreaterThan(0);
    rear.forEach((l, k) => expect(l.floorZ).toBeCloseTo(main[k].floorZ, 9));
    const flat = build('flatRoofParts');
    const strip = (L: { partId?: string }[]) => L.map(({ partId, ...l }) => l);
    const [mainSpec, ext, garage] = flat.spec.parts;
    const mainL = storeyLevels(mainSpec, flat.spec.era);
    const ff = mainL[1].floorZ - mainL[0].floorZ;
    // the attached extension uses the main block's plinth and floor-to-floor height, the garage its own levels
    expect(strip(levelsOf(flat.m, 'ext'))).toEqual(storeyLevels(ext, flat.spec.era, { plinth: mainL[0].floorZ, floorToFloor: ff }));
    expect(strip(levelsOf(flat.m, 'garage'))).toEqual(storeyLevels(garage, flat.spec.era));
    expect(strip(levelsOf(flat.m, 'ext'))).not.toEqual(storeyLevels(ext, flat.spec.era));
  });

  it('drives the storey slabs, rooms and openings', () => {
    for (const name of NAMES) {
      const { m } = build(name);
      for (const l of m.layers.filter((x) => x.kind === 'floors' && !x.id.includes('/loft/'))) {
        const lv = m.levels!.find((v) => v.partId === l.partId && v.storey === l.storey)!;
        expect(lv, l.id).toBeDefined();
        expect(maxZ(l)).toBeCloseTo(lv.floorZ, 4); // slab top = finished floor level (float32 layer)
      }
      for (const r of m.rooms) {
        const lv = m.levels!.find((v) => v.partId === r.partId && v.storey === r.storey);
        if (!lv) continue; // rooms of an attached part laid out with the main run use the main levels
        expect(r.floorZ).toBeCloseTo(lv.floorZ, 9);
        expect(r.ceilingZ).toBeCloseTo(lv.ceilingZ, 9);
      }
      for (const o of m.openings.filter((x) => x.type === 'window')) {
        const lv = m.levels!.find((v) => v.partId === o.partId && v.storey === o.storey)!;
        expect(lv, `${o.id} storey ${o.storey}`).toBeDefined();
        expect(o.center[2]).toBeGreaterThan(lv.floorZ);
      }
    }
  });

  it('marks rooms in the roof (1.5-storey cottage) and survives a part without storeys', () => {
    const cottage = part('main', 'main', rect(0, 0, 8, 6), ['eave', 'gable', 'eave', 'gable'], 3.4, { type: 'gabled', pitchDeg: 45 }, { storeys: 2 });
    const m = synthesizeHouse(mkSpec('cottage', 'detached', 'pre-1919', [cottage]), { layoutInterior: fixtureProvider });
    const L = levelsOf(m, 'main');
    expect(L.map((l) => l.inRoof)).toEqual([false, true]);
    const noStoreys = part('main', 'main', rect(0, 0, 8, 6), ['eave', 'eave', 'eave', 'eave'], 5.6, { type: 'hipped', pitchDeg: 35 }, { storeys: Number.NaN });
    const n = synthesizeHouse(mkSpec('nan-storeys', 'detached', 'unknown', [noStoreys]), { interior: false });
    expect(levelsOf(n, 'main').length).toBeGreaterThanOrEqual(1); // inferred from the eave height
    expect(synthesizeHouse(mkSpec('empty', 'unknown', 'unknown', [])).levels).toEqual([]);
  });

  it('is JSON-serialisable and deterministic', () => {
    const a = build('semi').m.levels, b = build('semi').m.levels;
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});
