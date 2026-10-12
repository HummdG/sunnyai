// Rotation and near-tie robustness of the weighted-skeleton roof engine.
// Real UK footprints are almost never axis-aligned, and orthogonalised / re-projected outlines carry walls that are
// parallel only to within 1e-16 .. 1e-4 rad. Every roof below must satisfy the invariants of
// fixtures/geometry/invariants.ts (nodes inside the bbox, bounded times, watertight positive-volume solid, plan area =
// footprint area with no folds, exact face slopes, no warnings); rectangles are also compared with closed forms.
import { describe, it, expect } from 'vitest';
import { RECT_ROOFS, rectClosedForm, rectPts, rectRoof, roofInvariants, rot, type RectRoof } from './fixtures/geometry/invariants.js';
import { L_SHAPE, T_SHAPE, U_SHAPE, PLUS, H_SHAPE, E_SHAPE, TERRACE_OUTRIGGER, randomOrtho } from './support/cases.js';
import { linfHeight } from './support/alternatives.js';
import { mulberry32, type PolygonM, type Vec2 } from '../src/geometry/geom.js';
import type { EdgeKind } from '../src/geometry/roof.js';

const ASPECTS: [number, number][] = [[10, 6], [8, 8], [20, 6], [7.3, 5.1], [6, 11]];
const deg = (d: number) => (d * Math.PI) / 180;

function rectCase(type: RectRoof, w: number, h: number, angle: number, pitch: number, off: Vec2 = [3.3, -1.7]): string[] {
  const poly: PolygonM = { outer: rot(rectPts(w, h), angle, off[0], off[1]) };
  const { kinds, params } = rectRoof(type, pitch);
  const cf = rectClosedForm(type, w, h, pitch);
  return roofInvariants(poly, kinds, params, { tExact: cf.tExact, tMax: cf.tExact, volume: cf.volume }).errors;
}

describe('rotated rectangles: every 0.5 deg from 0 to 180 deg', () => {
  for (const type of RECT_ROOFS) {
    it(`${type}: ${ASPECTS.length} aspect ratios x 361 angles match the closed forms`, () => {
      const fails: string[] = [];
      let n = 0;
      for (const [w, h] of ASPECTS)
        for (let k = 0; k <= 360; k++) {
          const pitch = 25 + 5 * (k % 7);
          const e = rectCase(type, w, h, deg(k / 2), pitch);
          n++;
          if (e.length) fails.push(`${w}x${h} @${k / 2}deg pitch ${pitch}: ${e.join('; ')}`);
        }
      expect(fails.slice(0, 10)).toEqual([]);
      expect(n).toBe(ASPECTS.length * 361);
    });
  }
});

describe('rotated rectangles: random angles, sizes, pitches and offsets', () => {
  it('600 random rectangles x 5 roof types match the closed forms', () => {
    const fails: string[] = [];
    const rnd = mulberry32(20261009);
    for (let i = 0; i < 600; i++) {
      const a = rnd() * 2 * Math.PI, w = 3 + 22 * rnd(), h = 3 + 12 * rnd(), pitch = 15 + 50 * rnd();
      const off: Vec2 = [60 * (rnd() - 0.5), 60 * (rnd() - 0.5)];
      for (const type of RECT_ROOFS) {
        const e = rectCase(type, w, h, a, pitch, off);
        if (e.length) fails.push(`#${i} ${type} ${w.toFixed(3)}x${h.toFixed(3)} a=${a} pitch ${pitch.toFixed(2)}: ${e.join('; ')}`);
      }
    }
    expect(fails.slice(0, 10)).toEqual([]);
  });
});

describe('near-ties: walls parallel only to within the vertex noise (1e-12 .. 1e-4 m)', () => {
  // vertex noise on a rotated plan turns its exact ties (parallel eaves, simultaneous collapses) into near-ties:
  // nearly antiparallel walls meeting at a ridge, nearly collinear eave / gable pairs, nearly simultaneous events
  const L0: Vec2[] = [[0, 0], [11, 0], [11, 12.16], [6.77, 12.16], [6.77, 6.76], [0, 6.76]]; // near-square main body
  const T0: Vec2[] = T_SHAPE.outer, U0: Vec2[] = U_SHAPE.outer;
  for (const noise of [1e-12, 1e-10, 1e-8, 1e-6, 1e-4]) {
    it(`vertex noise ${noise} m: rectangles (5 roof types) and L / T / U plans (hipped, gables, party walls)`, () => {
      const fails: string[] = [];
      const rnd = mulberry32(Math.round(-Math.log10(noise)) * 7919);
      const jit = (p: Vec2): Vec2 => [p[0] + noise * (2 * rnd() - 1), p[1] + noise * (2 * rnd() - 1)];
      const o = { relTol: 1e-7, pitchTol: 1e-4, noise };
      for (let i = 0; i < 160; i++) {
        const a = rnd() * 2 * Math.PI, pitch = 20 + 40 * rnd(), off: Vec2 = [20 * (rnd() - 0.5), 20 * (rnd() - 0.5)];
        const w = 4 + 16 * rnd(), h = 4 + 10 * rnd();
        const type = RECT_ROOFS[i % RECT_ROOFS.length];
        const { kinds, params } = rectRoof(type, pitch);
        const r = roofInvariants({ outer: rot(rectPts(w, h), a, off[0], off[1]).map(jit) }, kinds, params, o);
        if (r.errors.length) fails.push(`rect #${i} ${type}: ${r.errors.join('; ')}`);
        const base = [L0, T0, U0][i % 3];
        const poly: PolygonM = { outer: rot(base, a, off[0], off[1]).map(jit) };
        const mode = Math.floor(i / 3) % 3;
        const pk: EdgeKind[] = base.map((_, j) => (mode === 0 ? 'eave' : mode === 1 ? (rnd() < 0.35 ? 'gable' : 'eave') : j === 0 || j === base.length - 1 ? 'party' : 'eave'));
        if (!pk.includes('eave')) pk[1] = 'eave';
        const s = roofInvariants(poly, pk, { type: mode === 1 ? 'gabled' : 'hipped', eaveHeight: 5, pitchDeg: pitch }, o);
        if (s.errors.length) fails.push(`plan #${i} ${['L', 'T', 'U'][i % 3]} ${pk.join(',')}: ${s.errors.join('; ')}`);
      }
      expect(fails.slice(0, 10)).toEqual([]);
    });
  }
});

describe('rotated rectilinear plans with exact ties', () => {
  const shapes: [string, Vec2[]][] = [
    ['L', L_SHAPE.outer], ['T', T_SHAPE.outer], ['U', U_SHAPE.outer], ['plus', PLUS.outer], ['H', H_SHAPE.outer], ['E', E_SHAPE.outer],
    ['terrace+outrigger', TERRACE_OUTRIGGER.outer], ['ortho#3', randomOrtho(3, 8, 24).outer], ['ortho#4', randomOrtho(4, 8, 24).outer],
  ];
  it('hipped roofs equal tan(p) x the L-infinity distance in the plan frame at every 2.5 deg', () => {
    const fails: string[] = [];
    const tanP = Math.tan(deg(35));
    for (const [name, pts] of shapes) {
      const ref = linfHeight({ outer: pts }, tanP);
      const rnd = mulberry32(name.length * 31);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const probes: Vec2[] = [];
      while (probes.length < 25) {
        const p: Vec2 = [Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys))];
        if (ref(p) !== null) probes.push(p);
      }
      for (let k = 0; k < 72; k++) {
        const a = deg(2.5 * k);
        const r = roofInvariants({ outer: rot(pts, a, 0.37, -0.21) }, pts.map(() => 'eave'), { type: 'hipped', eaveHeight: 3, pitchDeg: 35 });
        if (r.errors.length) { fails.push(`${name} @${2.5 * k}: ${r.errors.join('; ')}`); continue; }
        for (const p of probes) {
          const q = rot([p], a, 0.37, -0.21)[0];
          const z = r.roof!.heightAt(q), zr = 3 + ref(p)!;
          if (z === null || Math.abs(z - zr) > 1e-7) { fails.push(`${name} @${2.5 * k}: height ${z} != ${zr} at ${p}`); break; }
        }
      }
    }
    expect(fails.slice(0, 10)).toEqual([]);
  });
  it('random gable / party kinds on the same plans at every 5 deg', () => {
    const fails: string[] = [];
    for (const [name, pts] of shapes) {
      const rnd = mulberry32(name.length * 131 + 7);
      for (let k = 0; k < 36; k++) {
        const kinds: EdgeKind[] = pts.map(() => { const u = rnd(); return u < 0.65 ? 'eave' : u < 0.9 ? 'gable' : 'party'; });
        if (!kinds.includes('eave')) kinds[0] = 'eave';
        const r = roofInvariants({ outer: rot(pts, deg(5 * k), -0.4, 0.9) }, kinds, { type: 'gabled', eaveHeight: 4, pitchDeg: 25 + rnd() * 30 }, { relTol: 1e-9, pitchTol: 1e-6 });
        if (r.errors.length) fails.push(`${name} @${5 * k} ${kinds.join(',')}: ${r.errors.join('; ')}`);
      }
    }
    expect(fails.slice(0, 10)).toEqual([]);
  });
});
