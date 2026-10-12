// Defence in depth against broken roof skeletons (runaway nodes 10^7–10^11 m away, engine errors such as a typed
// SkeletonError, leaky solids): synthesizeHouse validates every roof and replaces an unusable one by a flat-topped
// block at the eave (or the known ridge), reports it in validation.issues and never emits an exploding mesh.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRoof, type EdgeKind, type RoofModel, type RoofParams } from '../src/geometry/roof.js';
import { polygonArea, type PolygonM, type Vec2 } from '../src/geometry/geom.js';
import { synthesizeHouse } from '../src/model/index.js';
import { MAX_ROOF_RISE, roofProblem } from '../src/model/part.js';
import { dropRunawayLayers } from '../src/model/synthesize.js';
import type { BuildingPartSpec, HouseMesh, HouseModelSpec, LayerKind, MeshLayer } from '../src/types.js';
import { part, rect, spec as mkSpec } from './fixtures/model/specs.js';
import { fixtureProvider } from './fixtures/model/interior.js';

/** Real outlines on which the skeleton engine produced runaway nodes / errors (I-API replay, local metres). */
const OUTLINES: Record<string, { footprint: PolygonM; edgeKinds: EdgeKind[] }> = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/fit/complex-outlines.json', import.meta.url)), 'utf8'),
);
/** Rotated L whose gable variant sent a node 3e7 m away (fit-units repro). */
const ROT_L: PolygonM = { outer: [[-4.541245885484386, -6.466717476549093], [5.949068244372029, -3.16074409452267], [2.293494512035977, 8.438900653331075], [-1.7403001820202917, 7.167669141839724], [-0.11606962786754593, 2.013759305293206], [-6.572589063609485, -0.020982565241865814]] };

const HOUSE_KINDS = new Set<LayerKind>(['solid', 'walls', 'roof', 'roof-skin', 'openings', 'floors', 'interior', 'stairs', 'chimneys']);

class SkeletonError extends Error {
  override name = 'SkeletonError';
}

const bounds = (p: PolygonM) => {
  const xs = p.outer.map((q) => q[0]), ys = p.outer.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

/** Every house-layer vertex lies within the footprint bounds (+ overhang/verge allowance) and a sane height band. */
function expectContained(m: HouseMesh, spec: HouseModelSpec): void {
  const b = spec.parts.map((p) => bounds(p.footprint)).reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) }));
  const zMax = Math.max(...spec.parts.map((p) => p.eaveHeight)) + MAX_ROOF_RISE;
  for (const l of m.layers) {
    const P = l.positions;
    for (let i = 0; i < P.length; i++) expect(Number.isFinite(P[i]), l.id).toBe(true);
    if (!HOUSE_KINDS.has(l.kind)) continue;
    for (let i = 0; i < P.length; i += 3) {
      const ok = P[i] >= b.x0 - 3 && P[i] <= b.x1 + 3 && P[i + 1] >= b.y0 - 3 && P[i + 1] <= b.y1 + 3 && P[i + 2] >= -1 && P[i + 2] <= zMax;
      if (!ok) throw new Error(`${l.id}: vertex (${P[i]}, ${P[i + 1]}, ${P[i + 2]}) outside the house envelope`);
    }
  }
  for (const v of Object.values(m.stats)) expect(Number.isFinite(v)).toBe(true);
}

const house = (p: BuildingPartSpec, extra: Partial<HouseModelSpec> = {}) => mkSpec('robust', 'detached', 'unknown', [p], extra);

describe('synthesizeHouse: broken roof skeletons never reach the mesh', () => {
  const cases: [string, PolygonM, EdgeKind[], RoofParams['type']][] = [
    ...Object.entries(OUTLINES).flatMap(([slug, c]) => (['hipped', 'gabled'] as const).map((t): [string, PolygonM, EdgeKind[], RoofParams['type']] => [`${slug} ${t}`, c.footprint, c.edgeKinds, t])),
    ['rotated L, gable kinds, hipped', ROT_L, ['gable', 'eave', 'gable', 'eave', 'gable', 'eave'], 'hipped'],
    ['rotated L, gable kinds, gabled', ROT_L, ['gable', 'eave', 'gable', 'eave', 'gable', 'eave'], 'gabled'],
  ];
  for (const [name, footprint, kinds, type] of cases) {
    it(`${name}: contained, watertight, and any replaced roof is reported`, () => {
      const p = part('main', 'main', footprint, kinds, 5.5, { type, pitchDeg: 35 }, { overhang: 0.3, chimneys: [] });
      const spec = house(p);
      const m = synthesizeHouse(spec);
      expectContained(m, spec);
      expect(m.validation.solidsWatertight).toBe(true);
      const replaced = m.validation.issues.filter((s) => s.includes('unusable'));
      for (const s of replaced) expect(s).toMatch(/^part main: roof '\w+' unusable \(.+\); flat-topped block at 5\.50 m used$/);
      // the engine's own result is used only when it is sane
      let engineOk = true;
      try { engineOk = roofProblem(buildRoof(footprint, kinds, { type, pitchDeg: 35, eaveHeight: 5.5 }), footprint) === null; } catch { engineOk = false; }
      if (!engineOk) expect(replaced).toHaveLength(1);
      expect(m.layers.some((l) => l.kind === 'solid')).toBe(true);
    });
  }
});

describe('synthesizeHouse: injected engine failures', () => {
  const rectHouse = (extra: Partial<BuildingPartSpec> = {}) =>
    part('main', 'main', rect(0, 0, 8, 6), ['eave', 'gable', 'eave', 'gable'], 5.2, { type: 'gabled', pitchDeg: 40 }, { overhang: 0.3, ...extra });
  const throwing = (poly: PolygonM, kinds: EdgeKind[], params: RoofParams): RoofModel => {
    if (params.type !== 'flat') throw new SkeletonError('event queue diverged');
    return buildRoof(poly, kinds, params);
  };
  /** Real roofs with one skeleton node thrown 1e8 m away (the I-FIT repro pattern). */
  const runaway = (poly: PolygonM, kinds: EdgeKind[], params: RoofParams): RoofModel => {
    const r = buildRoof(poly, kinds, params);
    if (params.type === 'flat') return r;
    const k = r.vertices.findIndex((v) => v[2] > params.eaveHeight + 0.5);
    r.vertices[k] = [r.vertices[k][0] + 1e8, r.vertices[k][1], r.vertices[k][2]];
    return r;
  };

  it('a throwing engine (typed SkeletonError) gives a flat-topped block at the eave', () => {
    const spec = house(rectHouse());
    const m = synthesizeHouse(spec, { buildRoof: throwing, layoutInterior: fixtureProvider });
    expect(m.validation.issues).toContain("part main: roof 'gabled' unusable (SkeletonError: event queue diverged); flat-topped block at 5.20 m used");
    expect(m.validation.solidsWatertight).toBe(true);
    expect(m.roofFaces.every((f) => f.kind === 'flat' && Math.abs(f.centroid[2] - 5.2) < 1e-9)).toBe(true);
    expect(m.stats.ridgeHeight).toBeCloseTo(5.2, 9);
    expect(m.stats.volume).toBeCloseTo(8 * 6 * 5.2, 6);
    expect(m.levels!.filter((l) => l.partId === 'main')).toHaveLength(2);
    expectContained(m, spec);
  });

  it('runaway skeleton nodes are detected (part, roof skin and neighbours) and never emitted', () => {
    const nb = { id: 'osm:way/9', footprint: rect(8, 0, 8, 6), height: 8, eaveHeight: 5.2, roof: { type: 'gabled' as const, pitchDeg: 40 }, edgeKinds: ['eave', 'gable', 'eave', 'party'] as EdgeKind[], attached: true, source: 'osm' as const };
    const spec = house(rectHouse(), { context: { neighbours: [nb] } });
    const m = synthesizeHouse(spec, { buildRoof: runaway, layoutInterior: fixtureProvider });
    expect(m.validation.issues.some((s) => /^part main: roof 'gabled' unusable \(runaway roof vertex 1\.00e\+8 m outside the footprint\)/.test(s))).toBe(true);
    expect(m.validation.issues.some((s) => s.startsWith('neighbour osm:way/9: roof unusable (runaway'))).toBe(true);
    expect(m.validation.issues.some((s) => s.includes('layer') && s.includes('dropped'))).toBe(false); // caught upstream
    for (const l of m.layers) for (let i = 0; i < l.positions.length; i += 3) expect(Math.abs(l.positions[i])).toBeLessThan(200);
    expect(m.validation.solidsWatertight).toBe(true);
  });

  it('a corrupted expanded roof skin falls back to the unexpanded skin, keeping the fitted roof', () => {
    const skinOnly = (poly: PolygonM, kinds: EdgeKind[], params: RoofParams): RoofModel =>
      (params.eaveHeight < 5.2 - 1e-6 ? runaway : buildRoof)(poly, kinds, params); // the skin's eave is lowered by the overhang drop
    const spec = house(rectHouse());
    const m = synthesizeHouse(spec, { buildRoof: skinOnly, interior: false });
    expect(m.validation.issues.filter((s) => s.includes('unusable'))).toEqual([]);
    expect(m.roofFaces.filter((f) => f.kind === 'roof')).toHaveLength(2);
    const skin = m.layers.find((l) => l.id === 'main/roof-skin')!;
    let maxX = -Infinity;
    for (let i = 0; i < skin.positions.length; i += 3) maxX = Math.max(maxX, skin.positions[i]);
    expect(maxX).toBeLessThanOrEqual(8 + 1e-4); // unexpanded: no overhang beyond the wall line
    expectContained(m, spec);
  });

  it('uses the known ridge (LiDAR fit) as the block top, else the eave', () => {
    const fitPart = { partId: 'main', family: 'gable-u', eaveHeight: 5.2, ridgeHeight: 8.4, pitchDeg: 40 };
    const fit = { method: 'test', registration: { shift: [0, 0] as Vec2, sigmaMajor: 0, sigmaMinor: 0, method: 'none' as const }, sigma: 0.1, rmse: 0.1, inlierFraction: 1, nPixels: 100, pModel: 1, unreliable: false, selected: 'gable-u', alternatives: [], parts: [fitPart] };
    const lidar = synthesizeHouse(house(rectHouse(), { fit }), { buildRoof: throwing, interior: false });
    expect(lidar.validation.issues.some((s) => s.endsWith('flat-topped block at 8.40 m used'))).toBe(true);
    expect(lidar.stats.ridgeHeight).toBeCloseTo(8.4, 9);
    const prior = synthesizeHouse(house(rectHouse({ source: { heights: 'prior', roof: 'prior' } }), { fit }), { buildRoof: throwing, interior: false });
    expect(prior.stats.ridgeHeight).toBeCloseTo(5.2, 9);
    const silly = synthesizeHouse(house(rectHouse(), { fit: { ...fit, parts: [{ ...fitPart, ridgeHeight: 1e6 }] } }), { buildRoof: throwing, interior: false });
    expect(silly.stats.ridgeHeight).toBeCloseTo(5.2, 9);
  });

  it('skips a part when even the flat block cannot be built, without throwing', () => {
    const never = (): RoofModel => { throw new SkeletonError('no roof'); };
    const m = synthesizeHouse(house(rectHouse()), { buildRoof: never });
    expect(m.layers.some((l) => l.kind === 'solid')).toBe(false);
    expect(m.validation.solidsWatertight).toBe(false);
    expect(m.validation.issues.some((s) => s.includes('flat-topped block failed') && s.endsWith('skipped'))).toBe(true);
  });

  it('chimneys outside the part are skipped and absurd stack tops clipped', () => {
    const p = rectHouse({ chimneys: [{ center: [1e7, 3], width: 0.6, depth: 0.6, angleDeg: 0, top: 9, source: 'lidar' }, { center: [4, 3], width: 0.6, depth: 0.6, angleDeg: 0, top: 1e6, source: 'lidar' }] });
    const spec = house(p);
    const m = synthesizeHouse(spec, { interior: false });
    expect(m.validation.issues.some((s) => s.startsWith('chimney main#0: centre outside the part'))).toBe(true);
    expect(m.validation.issues.some((s) => s.startsWith('chimney main#1: top') && s.includes('clipped'))).toBe(true);
    expectContained(m, spec);
  });
});

describe('dropRunawayLayers: last line of defence', () => {
  it('drops layers with non-finite or far-away vertices and reports them', () => {
    const spec = house(part('main', 'main', rect(0, 0, 8, 6), ['eave', 'eave', 'eave', 'eave'], 5, { type: 'flat' }));
    const m = synthesizeHouse(spec, { interior: false });
    const walls = m.layers.find((l) => l.kind === 'walls')!;
    const bad = (id: string, v: number): MeshLayer => ({ ...walls, id, positions: Float32Array.from([0, 0, 0, 1, 0, 0, v, 0, 1]) });
    const issues: string[] = [];
    const kept = dropRunawayLayers([walls, bad('far', 3e7), bad('nan', Number.NaN), bad('near', 20)], spec, issues);
    expect(kept.map((l) => l.id)).toEqual([walls.id, 'near']);
    expect(issues).toEqual([
      'layer far: runaway vertex (3.00e+7, 0.00e+0, 1.00e+0); layer dropped',
      'layer nan: runaway vertex (NaN, 0.00e+0, 1.00e+0); layer dropped',
    ]);
    // nothing to compare against (no parts, neighbours or terrain): layers are kept as they are
    expect(dropRunawayLayers([bad('far', 3e7)], house(part('x', 'main', { outer: [] }, [], 5, { type: 'flat' })), [])).toHaveLength(1);
  });
});

describe('roofProblem', () => {
  it('accepts sane roofs and names the defect of broken ones', () => {
    const fp = rect(0, 0, 10, 8);
    const ok = buildRoof(fp, ['eave', 'eave', 'eave', 'eave'], { type: 'hipped', pitchDeg: 35, eaveHeight: 5 });
    expect(roofProblem(ok, fp)).toBeNull();
    expect(polygonArea(fp)).toBe(80);
    const far = { ...ok, vertices: ok.vertices.map((v, i) => (i === ok.vertices.length - 1 ? [v[0], v[1] + 5e9, v[2]] : v)) } as RoofModel;
    expect(roofProblem(far, fp)).toMatch(/^runaway roof vertex 5\.00e\+9 m outside the footprint$/);
    const tall = { ...ok, vertices: ok.vertices.map((v, i) => (i === ok.vertices.length - 1 ? [v[0], v[1], 400] : v)) } as RoofModel;
    expect(roofProblem(tall, fp)).toMatch(/above the part base/);
    const nan = { ...ok, vertices: ok.vertices.map((v, i) => (i === 0 ? [Number.NaN, v[1], v[2]] : v)) } as RoofModel;
    expect(roofProblem(nan, fp)).toBe('non-finite roof vertex');
    const gaveUp = { ...ok, skeleton: { ...ok.skeleton, stats: { ...ok.skeleton.stats, warnings: ['skeleton failed: unbounded node'] } } } as RoofModel;
    expect(roofProblem(gaveUp, fp)).toMatch(/^skeleton: /);
  });
});
