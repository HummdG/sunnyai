// packages/core/test/compound-roof.test.ts
import { describe, it, expect } from 'vitest';
import Module from 'manifold-3d';
import { buildRoof, type RoofComponent } from '../src/geometry/roof.js';
import { SkeletonError } from '../src/geometry/skeleton.js';
import { buildSolid } from '../src/geometry/solid.js';
import { checkMesh, checkRoof } from '../src/geometry/validate.js';
import type { PolygonM, Vec2 } from '../src/geometry/geom.js';

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const rot = (r: Vec2[], a: number): Vec2[] => r.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
const H = 5;
// L: main N-S ridge over x in [-6, 3] (eaves W/E of that block), cross E-W ridge over x in [-1.5, 6] (eaves S/N)
const L = (a = 0, crossPitch = 45): { fp: PolygonM; comps: RoofComponent[] } => ({
  fp: { outer: rot(rect(-6, -4, 6, 4), a) },
  comps: [
    { role: 'main', footprint: { outer: rot(rect(-6, -4, 3, 4), a) }, edgeKinds: ['gable', 'eave', 'gable', 'eave'], pitchDeg: 45 },
    { role: 'cross', footprint: { outer: rot(rect(-1.5, -4, 6, 4), a) }, edgeKinds: ['eave', 'gable', 'eave', 'gable'], pitchDeg: crossPitch },
  ],
});
// T: main E-W ridge over the whole 12 x 8, cross N-S gable 4 m wide centred x = 1 from the south wall to the ridge
const T = (): { fp: PolygonM; comps: RoofComponent[] } => ({
  fp: { outer: rect(-6, -4, 6, 4) },
  comps: [
    { role: 'main', footprint: { outer: rect(-6, -4, 6, 4) }, edgeKinds: ['eave', 'gable', 'eave', 'gable'], pitchDeg: 40 },
    { role: 'cross', footprint: { outer: rect(-1, -4, 3, 0) }, edgeKinds: ['gable', 'eave', 'gable', 'eave'], pitchDeg: 40 },
  ],
});
const build = (c: { fp: PolygonM; comps: RoofComponent[] }) =>
  buildRoof(c.fp, c.fp.outer.map(() => 'eave'), { type: 'gabled', eaveHeight: H, pitchDeg: c.comps[0].pitchDeg, components: c.comps });

async function unionVolume(comps: RoofComponent[]): Promise<number> {
  const wasm = await Module(); wasm.setup();
  const solids = comps.map((c) => {
    const s = buildSolid(buildRoof(c.footprint, c.edgeKinds, { type: 'gabled', eaveHeight: H, pitchDeg: c.pitchDeg }));
    return new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: Float32Array.from(s.positions.flat()), triVerts: Uint32Array.from(s.triangles.flat()) }));
  });
  return wasm.Manifold.union(solids).volume();
}

describe('geometry/compound roofs', () => {
  const EQUAL = (Math.atan(4.5 / 4) * 180) / Math.PI; // cross ridge 4 m * tan = main ridge 4.5 m
  for (const [name, c] of [['L', L()], ['rotated L', L(0.7)], ['T', T()], ['equal ridges', L(0, EQUAL)]] as const) {
    it(`${name}: watertight solid, faces tile the footprint, volume = union of the components`, async () => {
      const roof = build(c);
      const solid = buildSolid(roof);
      const m = checkMesh(solid);
      expect(m.watertight).toBe(true);
      expect(m.duplicateVertices).toBe(0);
      const r = checkRoof(roof, solid);
      expect(r.roofPlanArea).toBeCloseTo(r.footprintArea, 6);
      expect(r.roofPlanAreaAbs).toBeCloseTo(r.footprintArea, 6);
      expect(r.nonPlanarMax).toBeLessThan(1e-6);
      const u = await unionVolume(c.comps);
      expect(Math.abs(m.volume - u) / u).toBeLessThan(1e-5); // manifold works in float32
    });
  }
  it('heightAt is the max of the component roofs', () => {
    const c = L();
    const roof = build(c);
    const parts = c.comps.map((k) => buildRoof(k.footprint, k.edgeKinds, { type: 'gabled', eaveHeight: H, pitchDeg: k.pitchDeg }));
    for (let i = 0; i < 200; i++) {
      const p: Vec2 = [-5.9 + 11.8 * ((i * 0.618) % 1), -3.9 + 7.8 * ((i * 0.377) % 1)];
      const want = Math.max(...parts.map((r) => r.heightAt(p) ?? -Infinity));
      expect(roof.heightAt(p)!).toBeCloseTo(want, 6);
    }
  });
  it('vertical faces only on the outer walls; the T front wall splits eave | gable | eave', () => {
    const roof = build(T());
    expect(roof.prepared.kinds.filter((k) => k === 'gable').length).toBe(3); // E + W main gables + cross-gable end
    for (const f of roof.faces.filter((x) => x.frame !== 'xy')) expect(f.edge).toBeGreaterThanOrEqual(0);
  });
  it('rejects a cross ridge above the main ridge (internal step)', () => {
    expect(() => build(L(0, 70))).toThrow(SkeletonError);
  });
});
