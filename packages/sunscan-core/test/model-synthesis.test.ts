import { describe, expect, it } from 'vitest';
import { checkMesh } from '../src/geometry/validate.js';
import { polygonArea } from '../src/geometry/geom.js';
import { bearing } from '../src/geometry/roof.js';
import { MATERIALS, NO_TAG, resolveInteriorProvider, synthesizeHouse, type ModelSynthesisOptions } from '../src/model/index.js';
import type { HouseMesh, HouseModelSpec, InteriorLayout, LayerKind } from '../src/types.js';
import { ALL_SPECS, part, rect, spec as mkSpec } from './fixtures/model/specs.js';
import { fixtureProvider } from './fixtures/model/interior.js';
import { layerProblems, layerToSolid, windingMismatches } from './fixtures/model/check.js';

type Name = keyof typeof ALL_SPECS;
const NAMES = Object.keys(ALL_SPECS) as Name[];
const KINDS: LayerKind[] = ['solid', 'walls', 'roof', 'roof-skin', 'openings', 'floors', 'interior', 'stairs', 'chimneys', 'neighbours', 'terrain'];
const build = (name: Name, opts: ModelSynthesisOptions = {}): { spec: HouseModelSpec; m: HouseMesh } => {
  const spec = ALL_SPECS[name]();
  return { spec, m: synthesizeHouse(spec, { layoutInterior: fixtureProvider, ...opts }) };
};
const deg = (r: number) => (r * 180) / Math.PI;

describe('synthesizeHouse: compound (cross-gable) roofs', () => {
  it('one part, one set of walls, ridge at the main ridge, footprint counted once', () => {
    const { m } = build('crossGableL');
    expect(m.validation.solidsWatertight).toBe(true);
    expect(m.stats.footprintArea).toBeCloseTo(96, 6);
    const roof = m.layers.find((l) => l.kind === 'roof')!;
    let top = -Infinity;
    for (let i = 2; i < roof.positions.length; i += 3) top = Math.max(top, roof.positions[i]);
    expect(top).toBeCloseTo(5.2 + 4.3, 3); // 8.6 m main block at 45 deg
    expect(m.roofFaces.filter((f) => f.pitchDeg > 1 && f.pitchDeg < 89).length).toBeGreaterThanOrEqual(4);
  });
});

describe('synthesizeHouse: closed part solids', () => {
  for (const name of NAMES) {
    it(`${name}: every part solid is a closed, outward, positive-volume 2-manifold`, () => {
      const { spec, m } = build(name);
      expect(m.validation.solidsWatertight).toBe(true);
      expect(m.validation.issues.filter((s) => !s.startsWith('interior'))).toEqual([]); // fixture notes are relayed
      const solids = m.layers.filter((l) => l.kind === 'solid');
      expect(solids.map((l) => l.partId)).toEqual(spec.parts.map((p) => p.id));
      let volume = 0;
      for (const l of solids) {
        const r = checkMesh(layerToSolid(l));
        expect(r.watertight, l.id).toBe(true);
        expect(r.boundaryEdges + r.nonManifoldEdges + r.sameDirectionEdges).toBe(0);
        expect(r.duplicateVertices).toBe(0);
        expect(r.degenerateTriangles).toBe(0);
        expect(r.components).toBe(1);
        expect(r.volume).toBeGreaterThan(0);
        volume += r.volume;
      }
      expect(Math.abs(m.stats.volume - volume) / volume).toBeLessThan(1e-5); // float32 layer vs float64 solid
    });
  }
});

describe('synthesizeHouse: layers', () => {
  for (const name of NAMES) {
    it(`${name}: well-formed arrays, unit normals, CCW-from-outside winding, valid metadata`, () => {
      const { spec, m } = build(name);
      const ids = new Set<string>();
      const partIds = spec.parts.map((p) => p.id);
      for (const l of m.layers) {
        expect(layerProblems(l), l.id).toEqual([]);
        expect(ids.has(l.id), `duplicate ${l.id}`).toBe(false);
        ids.add(l.id);
        expect(KINDS).toContain(l.kind);
        expect(MATERIALS[l.material], l.material).toBeDefined();
        if (l.partId !== undefined) expect(partIds).toContain(l.partId);
        if (['floors', 'interior', 'stairs', 'openings'].includes(l.kind)) expect(Number.isInteger(l.storey), l.id).toBe(true);
        // flat-shaded layers: the triangle's winding normal equals its vertex normals; smooth ones agree in sign
        const smooth = l.kind === 'solid' || l.kind === 'terrain';
        expect(windingMismatches(l, smooth ? 0 : 0.99), l.id).toBe(0);
      }
      for (const k of ['solid', 'walls', 'roof', 'roof-skin', 'openings', 'floors', 'terrain'] as LayerKind[]) expect(m.layers.some((l) => l.kind === k), k).toBe(true);
    });
  }

  it('walls are tagged with source footprint edges and roofs with RoofFaceInfo ids', () => {
    const { spec, m } = build('detachedL');
    const walls = m.layers.find((l) => l.id === 'main/walls')!;
    const nEdges = spec.parts[0].footprint.outer.length;
    expect([...new Set(walls.triangleTags)].sort()).toEqual(Array.from({ length: nEdges }, (_, i) => i));
    for (const l of m.layers.filter((x) => x.kind === 'roof')) for (const t of l.triangleTags!) expect(m.roofFaces[t].partId).toBe(l.partId);
    const skin = m.layers.find((l) => l.id === 'main/roof-skin')!;
    expect(skin.triangleTags!.every((t) => t !== NO_TAG && t < m.roofFaces.length)).toBe(true);
  });
});

describe('synthesizeHouse: roof faces', () => {
  for (const name of NAMES) {
    it(`${name}: pitches match the spec, normals / azimuths / areas are consistent and tile the footprint`, () => {
      const { spec, m } = build(name);
      expect(m.roofFaces.map((f) => f.id)).toEqual(m.roofFaces.map((_, i) => i));
      for (const f of m.roofFaces) {
        const p = spec.parts.find((x) => x.id === f.partId)!;
        if (f.kind === 'roof') {
          expect(f.pitchDeg).toBeCloseTo(p.roof.pitchDeg!, 9);
          expect(f.azimuthDeg).toBeCloseTo(bearing([f.normal[0], f.normal[1]]), 6);
        } else {
          expect(f.kind).toBe('flat');
          expect(f.pitchDeg).toBe(0);
          expect(Number.isNaN(f.azimuthDeg)).toBe(true);
        }
        expect(deg(Math.acos(f.normal[2]))).toBeCloseTo(f.pitchDeg, 6);
        expect(Math.hypot(...f.normal)).toBeCloseTo(1, 12);
        expect(f.planArea).toBeCloseTo(f.area * Math.cos((f.pitchDeg * Math.PI) / 180), 6);
        expect(f.centroid[2]).toBeGreaterThanOrEqual(p.eaveHeight - 1e-9);
        expect(f.centroid[2]).toBeLessThanOrEqual(m.stats.ridgeHeight + 1e-9);
      }
      for (const p of spec.parts) {
        if ((p.roof.parapetHeight ?? 0) > 0) continue; // parapet coping is not a roof face
        const plan = m.roofFaces.filter((f) => f.partId === p.id).reduce((s, f) => s + f.planArea, 0);
        expect(plan).toBeCloseTo(polygonArea(p.footprint), 6);
      }
      expect(m.stats.roofArea).toBeCloseTo(m.roofFaces.reduce((s, f) => s + f.area, 0), 9);
      expect(m.stats.roofPlanArea).toBeCloseTo(m.roofFaces.reduce((s, f) => s + f.planArea, 0), 9);
    });
  }
});

describe('synthesizeHouse: stats', () => {
  for (const name of NAMES) {
    it(`${name}: consistent with the spec and the geometry`, () => {
      const { spec, m } = build(name);
      const s = m.stats;
      expect(s.footprintArea).toBeCloseTo(spec.parts.reduce((a, p) => a + polygonArea(p.footprint), 0), 9);
      const main = spec.parts.find((p) => p.role === 'main')!;
      expect(s.eaveHeight).toBe(main.eaveHeight);
      expect(s.storeys).toBe(main.storeys);
      expect(s.ridgeHeight).toBeGreaterThanOrEqual(s.eaveHeight);
      let top = -Infinity;
      for (const l of m.layers.filter((x) => x.kind === 'solid')) for (let i = 2; i < l.positions.length; i += 3) top = Math.max(top, l.positions[i]);
      expect(Math.abs(s.ridgeHeight - top)).toBeLessThan(1e-5);
      expect(s.windows).toBe(m.openings.filter((o) => o.type === 'window').length);
      expect(s.doors).toBe(m.openings.filter((o) => o.type === 'door').length);
      expect(s.grossFloorArea).toBeGreaterThan(0);
      expect(s.grossFloorArea).toBeLessThanOrEqual(spec.parts.reduce((a, p) => a + polygonArea(p.footprint) * p.storeys, 0));
      expect(s.wallArea).toBeGreaterThan(0);
      for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
    });
  }

  it('mid-terrace: analytic wall, party-wall, roof, volume and floor areas', () => {
    const { m } = build('midTerrace');
    const t = Math.tan((38 * Math.PI) / 180), rise = 4.25 * t;
    expect(m.stats.wallArea).toBeCloseTo(2 * 5.5 * 6.0, 9);
    expect(m.stats.partyWallArea).toBeCloseTo(2 * (8.5 * 6.0 + 0.5 * 8.5 * rise), 9);
    expect(m.stats.roofArea).toBeCloseTo((5.5 * 8.5) / Math.cos((38 * Math.PI) / 180), 9);
    expect(m.stats.volume).toBeCloseTo(5.5 * 8.5 * 6.0 + 5.5 * 0.5 * 8.5 * rise, 9);
    expect(m.stats.ridgeHeight).toBeCloseTo(6.0 + rise, 9);
    expect(m.stats.grossFloorArea).toBeCloseTo(2 * (5.5 - 0.6) * (8.5 - 0.6), 9);
  });
});

describe('synthesizeHouse: determinism and performance', () => {
  for (const name of NAMES) {
    it(`${name}: identical output for identical input`, () => {
      const a = build(name).m, b = build(name).m;
      expect(b).toEqual(a);
    });
  }

  it('typical part sets: < 60 ms without interior, < 200 ms with the interior fixture (median of 5)', () => {
    const median = (f: () => void) => {
      const ts: number[] = [];
      for (let i = 0; i < 5; i++) { const t0 = performance.now(); f(); ts.push(performance.now() - t0); }
      return ts.sort((x, y) => x - y)[2];
    };
    for (const name of NAMES) {
      const spec = ALL_SPECS[name]();
      synthesizeHouse(spec, { interior: false }); // warm-up (JIT)
      synthesizeHouse(spec, { layoutInterior: fixtureProvider });
      const plain = median(() => synthesizeHouse(spec, { interior: false }));
      const full = median(() => synthesizeHouse(spec, { layoutInterior: fixtureProvider }));
      expect(plain, `${name} without interior`).toBeLessThan(60);
      expect(full, `${name} with interior`).toBeLessThan(200);
    }
  });
});

describe('synthesizeHouse: options and degradation', () => {
  it('honours every SynthesisOptions flag', () => {
    const spec = ALL_SPECS.midTerrace();
    const m = synthesizeHouse(spec, { openings: false, floors: false, interior: false, chimneys: false, roofSkin: false, neighbours: false, terrain: false });
    expect([...new Set(m.layers.map((l) => l.kind))].sort()).toEqual(['roof', 'solid', 'walls']);
    expect(m.openings).toEqual([]);
    expect(m.rooms).toEqual([]);
    expect(m.stats.windows + m.stats.doors).toBe(0);
    expect(m.validation.solidsWatertight).toBe(true);
  });

  it('a throwing interior provider is reported, not fatal', () => {
    const spec = ALL_SPECS.semi();
    const m = synthesizeHouse(spec, { layoutInterior: () => { throw new Error('boom'); } });
    expect(m.validation.issues.some((s) => s.includes('interior') && s.includes('boom'))).toBe(true);
    expect(m.rooms).toEqual([]);
    expect(m.layers.some((l) => l.kind === 'stairs' || l.id.endsWith('interior-walls'))).toBe(false);
    expect(m.validation.solidsWatertight).toBe(true);
    expect(m.openings.length).toBeGreaterThan(0);
  });

  it('malformed or out-of-footprint interior output is filtered with a warning', () => {
    const spec = ALL_SPECS.semi();
    const bad = (input: Parameters<typeof fixtureProvider>[0]): InteriorLayout => {
      const good = fixtureProvider(input);
      return {
        rooms: [...good.rooms, { ...good.rooms[0], polygon: [[0, 0]] }, { ...good.rooms[0], id: 'far', polygon: [[50, 50], [52, 50], [52, 52], [50, 52]] }],
        walls: [...good.walls, { storey: 0, a: [Number.NaN, 0], b: [1, 1], thickness: 0.1, doors: [] }],
        stairs: good.stairs, warnings: ['note from layout'],
      };
    };
    const m = synthesizeHouse(spec, { layoutInterior: bad });
    expect(m.rooms.length).toBe(fixtureProvider({ ...interiorInputOf(spec) }).rooms.length);
    expect(m.validation.issues.some((s) => s.includes('malformed'))).toBe(true);
    expect(m.validation.issues.some((s) => s.includes('outside the footprint'))).toBe(true);
    expect(m.validation.issues.some((s) => s.includes('note from layout'))).toBe(true);
  });

  it('resolves the interior provider defensively', () => {
    const f = () => ({ rooms: [], walls: [], stairs: [], warnings: [] });
    expect(resolveInteriorProvider({})).toBeUndefined();
    expect(resolveInteriorProvider(null)).toBeUndefined();
    expect(resolveInteriorProvider({ layoutInterior: 42 })).toBeUndefined();
    expect(resolveInteriorProvider({ layoutInterior: f })).toBe(f);
  });

  it('skips unusable parts, repairs bad heights and never throws', () => {
    const ok = part('main', 'main', rect(0, 0, 6, 8), ['eave', 'gable', 'eave', 'gable'], 5.2, { type: 'gabled', pitchDeg: 35 });
    const broken = part('bad', 'extension', { outer: [[0, 9], [1, 9]] }, ['eave', 'eave'], 3, { type: 'flat' });
    const low = part('low', 'garage', rect(6, 0, 3, 5), ['eave', 'eave', 'eave', 'party'], -1, { type: 'flat' }, { storeys: 1 });
    const spec = mkSpec('broken', 'detached', 'unknown', [ok, broken, low]);
    spec.context.terrain = { originX: 0, originY: 0, cellSize: 1, width: 3, height: 3, heights: [1, 2], source: 'bad' };
    spec.parts[0].chimneys = [{ center: [3, 4], width: 0.6, depth: 0.6, angleDeg: 0, top: 1, source: 'prior' }, { center: [Number.NaN, 0], width: 1, depth: 1, angleDeg: 0, top: 9, source: 'prior' }];
    const m = synthesizeHouse(spec, { layoutInterior: fixtureProvider });
    expect(m.layers.filter((l) => l.kind === 'solid').map((l) => l.partId)).toEqual(['main', 'low']);
    const has = (s: string) => m.validation.issues.some((x) => x.includes(s));
    expect(has('part bad: invalid footprint')).toBe(true);
    expect(has('part low: eave height')).toBe(true);
    expect(has('terrain: invalid grid')).toBe(true);
    expect(has('chimney main#0')).toBe(true);
    expect(has('chimney main#1')).toBe(true);
    expect(m.validation.solidsWatertight).toBe(true);
    const ground = m.layers.find((l) => l.kind === 'terrain')!;
    expect(ground.indices.length).toBe(6); // flat ground square fallback
  });

  it('an empty spec yields no solids and a validation failure', () => {
    const m = synthesizeHouse(mkSpec('empty', 'unknown', 'unknown', []));
    expect(m.validation.solidsWatertight).toBe(false);
    expect(m.validation.issues).toContain('no buildable parts in the spec');
    expect(m.layers.every((l) => l.kind === 'terrain')).toBe(true);
  });

  it.runIf(!!resolveInteriorProvider())('integrates with core/interior (default provider)', () => {
    for (const name of NAMES) {
      const spec = ALL_SPECS[name]();
      const m = synthesizeHouse(spec);
      expect(m.validation.solidsWatertight).toBe(true);
      expect(m.validation.issues.filter((s) => s.includes('layout failed'))).toEqual([]);
      expect(m.rooms.length, name).toBeGreaterThan(0);
      for (const l of m.layers.filter((x) => x.id.endsWith('room-floors'))) for (const t of l.triangleTags!) expect(t).toBeLessThan(m.rooms.length);
      for (const l of m.layers) expect(layerProblems(l), l.id).toEqual([]);
    }
  });
});

/** InteriorInput-like object for the fixture provider (only the fields it reads). */
function interiorInputOf(spec: HouseModelSpec) {
  const p = spec.parts[0];
  return {
    partId: p.id, footprint: p.footprint, edgeKinds: p.edgeKinds, storeys: p.storeys, wallThickness: 0.3, era: spec.era, builtForm: spec.builtForm, role: p.role,
    levels: Array.from({ length: p.storeys }, (_, k) => ({ floorZ: 0.3 + 2.7 * k, ceilingZ: 2.8 + 2.7 * k })),
  };
}
