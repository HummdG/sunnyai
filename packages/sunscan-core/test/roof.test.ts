import { describe, it, expect, beforeAll } from 'vitest';
import Module from 'manifold-3d';
import { scenarios } from './support/scenarios.js';
import { buildRoof, type EdgeKind, type RoofType } from '../src/geometry/roof.js';
import { buildSolid } from '../src/geometry/solid.js';
import { checkMesh, checkRoof } from '../src/geometry/validate.js';
import { skeletonTimeField, fitEaveAndPitch } from '../src/geometry/field.js';
import { triangulateLoops } from '../src/geometry/triangulate.js';
import { randomStar, randomOrtho, noisy, L_SHAPE, T_SHAPE, TERRACE_OUTRIGGER, rect, regularPolygon } from './support/cases.js';
import { isSimple, mulberry32, type PolygonM, type Vec2, type Vec3 } from '../src/geometry/geom.js';

function validSolid(poly: PolygonM, kinds: EdgeKind[], params: Parameters<typeof buildRoof>[2]) {
  const roof = buildRoof(poly, kinds, params);
  const mesh = buildSolid(roof);
  return { roof, mesh, m: checkMesh(mesh), r: checkRoof(roof, mesh) };
}

describe('closed building solids for every required building', () => {
  let wasm: any;
  beforeAll(async () => { wasm = await Module(); wasm.setup(); });
  for (const sc of scenarios()) {
    it(sc.name, () => {
      const { roof, mesh, m, r } = validSolid(sc.poly, sc.kinds, sc.params);
      expect(roof.skeleton.stats.warnings).toEqual([]);
      expect(m.watertight).toBe(true); // (i) every edge used exactly twice, opposite orientation
      expect(m.duplicateVertices).toBe(0);
      expect(m.volume).toBeGreaterThan(0); // (ii) outward orientation
      expect(m.degenerateTriangles).toBe(0); // (vi)
      expect(r.maxPitchErrDeg).toBeLessThan(1e-9); // (iii)
      expect(r.maxAzimuthErrDeg).toBeLessThan(1e-9);
      expect(r.nonPlanarMax).toBeLessThan(1e-9); // every face planar (metres)
      expect(Math.abs(r.roofPlanArea - r.footprintArea) / r.footprintArea).toBeLessThan(1e-12); // (iv)
      expect(Math.abs(r.roofPlanAreaAbs - r.footprintArea) / r.footprintArea).toBeLessThan(1e-12); // no folds/overlaps
      if (sc.analyticVolume) expect(Math.abs(m.volume - sc.analyticVolume) / sc.analyticVolume).toBeLessThan(1e-12); // (v)
      const man = new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions.flat()), triVerts: new Uint32Array(mesh.triangles.flat()) }));
      expect(Math.abs(man.volume() - m.volume) / m.volume).toBeLessThan(1e-5); // independent manifold check (float32)
      man.delete();
    });
  }
});

describe('fuzz: random footprints x random edge kinds x every roof type', () => {
  it('always yields a closed, oriented, correctly pitched solid', () => {
    const types: RoofType[] = ['hipped', 'gabled', 'half-hipped', 'dutch-gable', 'gambrel', 'mansard', 'skillion', 'pyramidal', 'flat'];
    const fails: string[] = [];
    let n = 0;
    for (let i = 0; i < 360; i++) {
      const rnd = mulberry32(i + 42);
      const g = i % 5;
      const poly: PolygonM = g === 0 ? randomStar(6 + Math.floor(rnd() * 30), i) : g === 1 ? randomOrtho(i, 6, 40) : g === 2 ? noisy(i % 2 ? L_SHAPE : T_SHAPE, i, 0.03)
        : g === 3 ? { outer: rect(18, 14), holes: [rect(4, 3, 4 + 4 * rnd(), 4 + 4 * rnd()).reverse()] } : TERRACE_OUTRIGGER;
      if (!isSimple(poly)) continue;
      const nE = poly.outer.length + (poly.holes ?? []).reduce((s, h) => s + h.length, 0);
      const kinds: EdgeKind[] = Array.from({ length: nE }, () => { const u = rnd(); return u < 0.65 ? 'eave' : u < 0.9 ? 'gable' : 'party'; });
      if (!kinds.includes('eave')) kinds[0] = 'eave';
      let type = types[i % types.length];
      if (type === 'pyramidal') { // only defined for convex footprints
        const conv = regularPolygon(5 + Math.floor(rnd() * 6), 6, rnd());
        const res = validSolid(conv, conv.outer.map(() => 'eave'), { type, eaveHeight: 3, pitchDeg: 20 + 40 * rnd() });
        if (!res.m.watertight || res.r.maxPitchErrDeg > 1e-6) fails.push(`#${i} pyramidal`);
        n++;
        continue;
      }
      const params = { type, eaveHeight: 3 + 3 * rnd(), pitchDeg: 20 + 40 * rnd(), parapetHeight: type === 'flat' && rnd() < 0.5 ? 0.5 : 0, flatTop: rnd() < 0.3, breakHeight: 0.8 + rnd() } as const;
      try {
        const { roof, m, r } = validSolid(poly, kinds, params);
        const ok = m.watertight && m.volume > 0 && m.degenerateTriangles === 0 && m.duplicateVertices === 0 && r.maxPitchErrDeg < 1e-6 && r.nonPlanarMax < 1e-6
          && Math.abs(r.roofPlanAreaAbs - r.footprintArea) / r.footprintArea < 1e-9 && roof.skeleton.stats.warnings.length === 0;
        if (!ok) fails.push(`#${i} ${type}: wt ${m.watertight} bnd ${m.boundaryEdges} nm ${m.nonManifoldEdges} flip ${m.sameDirectionEdges} deg ${m.degenerateTriangles} pitch ${r.maxPitchErrDeg.toExponential(1)} plan ${(r.roofPlanAreaAbs / r.footprintArea).toFixed(6)} w ${roof.skeleton.stats.warnings.length}`);
      } catch (e: any) {
        fails.push(`#${i} ${type}: threw ${e.message}`);
      }
      n++;
    }
    expect(fails).toEqual([]);
    expect(n).toBeGreaterThan(300);
  });
});

describe('fitting support: z(p) = H + tan(pitch) * t(p)', () => {
  it('heightAt equals H + tan(p) * t_unit(p) for any pitch (t independent of pitch)', () => {
    const kinds: EdgeKind[] = ['eave', 'party', 'gable', 'eave', 'eave', 'party'];
    const field = skeletonTimeField(TERRACE_OUTRIGGER, kinds);
    const rnd = mulberry32(3);
    for (const pitch of [22.5, 35, 47, 60]) {
      const roof = buildRoof(TERRACE_OUTRIGGER, kinds, { type: 'gabled', eaveHeight: 5, pitchDeg: pitch });
      for (let s = 0; s < 300; s++) {
        const p: Vec2 = [rnd() * 5.5, rnd() * 13];
        const t = field.t(p), h = roof.heightAt(p);
        if (t === null || h === null) continue;
        expect(Math.abs(h - (5 + Math.tan((pitch * Math.PI) / 180) * t))).toBeLessThan(1e-9);
      }
    }
  });
  it('linear LS recovers eave height and pitch from noisy synthetic DSM samples', () => {
    const kinds: EdgeKind[] = ['eave', 'eave', 'gable', 'eave', 'eave', 'gable'];
    const truth = { H: 5.3, pitch: 38 };
    const roof = buildRoof(L_SHAPE, kinds, { type: 'gabled', eaveHeight: truth.H, pitchDeg: truth.pitch });
    const field = skeletonTimeField(L_SHAPE, kinds);
    const rnd = mulberry32(11);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const pts: Vec3[] = [];
    for (let x = 0.25; x < 10; x += 0.5) for (let y = 0.25; y < 11; y += 0.5) {
      const h = roof.heightAt([x, y]);
      if (h !== null) pts.push([x, y, h + 0.05 * gauss()]); // 5 cm noise
    }
    const fit = fitEaveAndPitch(field, pts);
    expect(Math.abs(fit.eave - truth.H)).toBeLessThan(0.03);
    expect(Math.abs(fit.pitchDeg - truth.pitch)).toBeLessThan(0.5);
    expect(fit.rmse).toBeLessThan(0.07);
  });
});

describe('triangulator', () => {
  it('keeps collinear boundary vertices and never emits zero-area triangles', () => {
    const pts: Vec2[] = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [1.5, 2], [0, 2], [0, 1]];
    const tris = triangulateLoops(pts, [pts.map((_, i) => i)]);
    expect(tris).toHaveLength(pts.length - 2);
    expect(new Set(tris.flat()).size).toBe(pts.length);
    for (const [a, b, c] of tris) expect((pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0])).toBeGreaterThan(0);
  });
  it('handles holes', () => {
    const outer: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const hole: Vec2[] = [[3, 3], [3, 7], [7, 7], [7, 3]];
    const pts = [...outer, ...hole];
    const tris = triangulateLoops(pts, [[0, 1, 2, 3], [4, 5, 6, 7]]);
    const area = tris.reduce((s, [a, b, c]) => s + ((pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0])) / 2, 0);
    expect(area).toBeCloseTo(84, 9);
  });
});
