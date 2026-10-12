// packages/core/test/fit-cross.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { reconstruct } from '../src/fit/reconstruct.js';
import { generateCase, type CaseTruth } from './fixtures/fit/synth.js';
import type { ReconstructOutput } from '../src/types.js';

const TRIALS = 20;
const p95 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]; };
// Detection bars: L (end gables, large visible area) 85 %; T (flush front gables) 60 %: their visible triangle is
// only ~w^2/4 (5-9 m2 for 4.5-6 m gables, ~10 pixels at 1 m), close to the robust-BIC cost of 3 extra parameters.
// Undetected houses must fall back to a plain gable (never a wrong layout).
const BAR = { cross_L: 0.85, cross_T: 0.6 };
const runs: Record<'cross_L' | 'cross_T', { truth: CaseTruth; out: ReconstructOutput }[]> = { cross_L: [], cross_T: [] };

describe('fit: cross-gable (compound) roofs', () => {
  beforeAll(() => {
    for (const name of ['cross_L', 'cross_T'] as const) for (let t = 0; t < TRIALS; t++) {
      const { input, truth } = generateCase(name, 400_000 + (name === 'cross_T' ? 1000 : 0) + t);
      runs[name].push({ truth, out: reconstruct(input) });
    }
  }, 240_000);
  for (const name of ['cross_L', 'cross_T'] as const) {
    it(`${name}: one compound part with the right layout (L >= 85 %, T >= 60 %), plain gable otherwise`, () => {
      const right = (o: ReconstructOutput) => o.parts.length === 1 && o.parts[0].roof.components?.length === 2 && o.parts[0].family.startsWith(`cross-gable-${name.slice(-1)}`);
      const ok = runs[name].filter(({ out }) => right(out));
      expect(ok.length / TRIALS).toBeGreaterThanOrEqual(BAR[name]);
      for (const { out } of runs[name]) if (!right(out)) expect(out.parts.map((p) => p.family)).toEqual(['gable-u']);
    });
    it(`${name}: pitches <= 3 deg, ridges <= 0.3 m, cross-gable placed within 0.75 m (p95)`, () => {
      const pe: number[] = [], re: number[] = [], pos: number[] = [];
      for (const { truth, out } of runs[name]) {
        const c = out.parts[0]?.roof.components;
        if (!c || c.length !== 2) continue;
        const [m, x] = [c.find((k) => k.role === 'main')!, c.find((k) => k.role === 'cross')!];
        const [tm, tx] = [truth.components!.find((k) => k.role === 'main')!, truth.components!.find((k) => k.role === 'cross')!];
        pe.push(Math.abs(m.pitchDeg - tm.pitchDeg), Math.abs(x.pitchDeg - tx.pitchDeg));
        re.push(Math.abs(out.parts[0].ridgeHeight + out.ground - truth.mainRidge!));
        // centroid distance of the visible cross-gable rectangle, registered back by the fitted shift
        const cen = (r: [number, number][]) => r.reduce((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length], [0, 0]);
        const a = cen(x.footprint.outer as [number, number][]), b = cen(tx.footprint.outer as [number, number][]);
        pos.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      expect(pe.length).toBeGreaterThanOrEqual(2 * BAR[name] * TRIALS);
      expect(p95(pe)).toBeLessThanOrEqual(3);
      expect(p95(re)).toBeLessThanOrEqual(0.3);
      expect(p95(pos)).toBeLessThanOrEqual(0.75);
    });
  }
  it('small flush front gables (3 m) are too faint at 1 m LiDAR: reported as a plain gable, never as a wrong layout', () => {
    for (let t = 0; t < 6; t++) {
      const { input } = generateCase('cross_T', 402_000 + t, { crossWidth: 3 });
      const out = reconstruct(input);
      expect(out.parts).toHaveLength(1);
      expect(out.parts[0].family.startsWith('cross-gable-L')).toBe(false);
      expect(out.parts[0].roof.type).toBe('gabled');
    }
  });
});
