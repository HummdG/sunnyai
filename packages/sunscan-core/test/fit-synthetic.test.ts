// Synthetic recovery of UK archetypes (research 05 section 4.2 protocol): DSMs from the geometry engine
// (buildRoof -> heightAt on overhang-offset wall lines), 8 x 8 area-averaged 1 m pixels, sigma = 0.15 m noise,
// 5 % outliers (+0.5..4 m), chimney stacks (p = 0.7), sloping undulating ground, neighbours, and a 0.5 m
// misregistration of all footprints. Seeded (mulberry32) -> deterministic.
import { describe, it, expect, beforeAll } from 'vitest';
import { reconstruct } from '../src/fit/reconstruct.js';
import { generateCase, SINGLE_CASES, type CaseName, type CaseTruth } from './fixtures/fit/synth.js';
import type { ReconstructOutput, RoofType } from '../src/types.js';

const TRIALS = 20;
const SEED = 100_000;
const norm = (t: RoofType | undefined) => (t === 'gabled' || t === 'hipped' ? 'pitched' : t);
const p95 = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
};

interface Trial { name: CaseName; truth: CaseTruth; out: ReconstructOutput; ms: number; correct: boolean; eaveErr: number; regErr: number; pitchErr?: number }

function familyCorrect(name: CaseName, truth: CaseTruth, out: ReconstructOutput): boolean {
  const p = out.parts[0];
  if (!p) return false;
  if (name === 'outrigger') return out.parts.length === 2 && norm(p.roof.type) === norm(truth.mainType);
  return out.parts.length === 1 && norm(p.roof.type) === norm(truth.type) && (truth.type === 'flat' || p.edgeKinds.join() === truth.kinds.join());
}

const trials: Trial[] = [];

describe('fit: synthetic recovery (sigma 0.15 m, 5 % outliers, chimneys, 0.5 m misregistration)', () => {
  beforeAll(() => {
    [...SINGLE_CASES, 'outrigger' as const].forEach((name, ci) => {
      for (let t = 0; t < TRIALS; t++) {
        const { input, truth } = generateCase(name, SEED + 1000 * ci + t);
        const t0 = performance.now();
        const out = reconstruct(input);
        const ms = performance.now() - t0;
        const p = out.parts[0];
        const correct = familyCorrect(name, truth, out);
        trials.push({
          name, truth, out, ms, correct,
          eaveErr: Math.abs(p.eaveHeight + out.ground - truth.eave),
          regErr: Math.hypot(out.registration.shift[0] - truth.correction[0], out.registration.shift[1] - truth.correction[1]),
          ...(correct && truth.type !== 'flat' ? { pitchErr: Math.abs((p.roof.pitchDeg ?? 0) - truth.pitchDeg) } : {}),
        });
      }
    });
    const single = trials.filter((t) => t.name !== 'outrigger');
    const line = (name: string, ts: Trial[]) => {
      const pe = ts.flatMap((t) => (t.pitchErr === undefined ? [] : [t.pitchErr]));
      return `${name.padEnd(12)} acc ${((100 * ts.filter((t) => t.correct).length) / ts.length).toFixed(1)}%  eave p95 ${p95(ts.map((t) => t.eaveErr)).toFixed(3)} m  `
        + `pitch p95 ${pe.length ? p95(pe).toFixed(2) : '  - '} deg  reg p95 ${p95(ts.map((t) => t.regErr)).toFixed(3)} m  max ${Math.max(...ts.map((t) => t.ms)).toFixed(0)} ms`;
    };
    // eslint-disable-next-line no-console
    console.log(['[fit-synthetic]', ...[...SINGLE_CASES, 'outrigger'].map((n) => line(n, trials.filter((t) => t.name === n))), line('ALL single', single)].join('\n'));
  }, 120_000);

  it('identifies family + orientation (party walls, gable ends, skillion side) in >= 95 % of single-part houses', () => {
    const single = trials.filter((t) => t.name !== 'outrigger');
    expect(single.length).toBe(SINGLE_CASES.length * TRIALS);
    expect(single.filter((t) => t.correct).length / single.length).toBeGreaterThanOrEqual(0.95);
    for (const name of SINGLE_CASES) {
      const ts = single.filter((t) => t.name === name);
      expect(ts.filter((t) => t.correct).length / ts.length, name).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('recovers eave heights (p95 <= 0.15 m) and pitches (p95 <= 2.5 deg)', () => {
    const single = trials.filter((t) => t.name !== 'outrigger');
    expect(p95(single.map((t) => t.eaveErr))).toBeLessThanOrEqual(0.15);
    const pitch = single.flatMap((t) => (t.pitchErr === undefined ? [] : [t.pitchErr]));
    expect(pitch.length).toBeGreaterThan(100);
    expect(p95(pitch)).toBeLessThanOrEqual(2.5);
  });

  it('co-registers the neighbourhood to <= 0.2 m (p95) from a 0.5 m offset', () => {
    expect(p95(trials.map((t) => t.regErr))).toBeLessThanOrEqual(0.2);
    for (const t of trials) expect(t.out.registration.method).toBe('edge-neighbourhood');
  });

  it('splits rectangle + outrigger houses into two parts with the right main roof', () => {
    const ts = trials.filter((t) => t.name === 'outrigger');
    expect(ts.filter((t) => t.out.parts.length === 2).length / ts.length).toBeGreaterThanOrEqual(0.9);
    expect(ts.filter((t) => t.correct).length / ts.length).toBeGreaterThanOrEqual(0.85);
    expect(p95(ts.map((t) => t.eaveErr))).toBeLessThanOrEqual(0.2);
    const secondary: number[] = [];
    for (const t of ts.filter((x) => x.out.parts.length === 2)) {
      const [main, ext] = t.out.parts;
      expect(main.id).toBe('main');
      expect(ext.role).toBe('extension');
      expect(main.eaveHeight).toBeGreaterThan(ext.eaveHeight); // single-storey outrigger below the main eave
      secondary.push(Math.abs(ext.eaveHeight + t.out.ground - t.truth.secondaryEave!));
      expect(t.out.flags).toContain('partitioned');
    }
    // the secondary roof TYPE is weakly identified on 3 x 4 m parts (research 05 table 4.3: eave median 0.29 / p95 0.72 m)
    const med = [...secondary].sort((a, b) => a - b)[Math.floor(secondary.length / 2)];
    expect(med).toBeLessThanOrEqual(0.35);
    expect(p95(secondary)).toBeLessThanOrEqual(1.2);
    // single-part houses are never split
    expect(trials.filter((t) => t.name !== 'outrigger' && t.out.parts.length > 1).length).toBeLessThanOrEqual(2);
  });

  it('reports consistent quality fields, samples and reliability', () => {
    for (const t of trials) {
      const r = t.out.report;
      expect(r.nPixels).toBe(t.out.samples.length);
      expect(r.sigma).toBeGreaterThanOrEqual(0.05);
      expect(r.sigma).toBeLessThan(0.5);
      expect(r.inlierFraction).toBeGreaterThan(0.7);
      expect(r.pModel).toBeGreaterThan(0);
      expect(r.pModel).toBeLessThanOrEqual(1);
      expect(r.unreliable).toBe(false);
      expect(t.out.ok).toBe(true);
      expect(Math.abs(t.out.ground - t.truth.groundAtCentroid)).toBeLessThan(0.35);
      if (!t.out.flags.includes('implausible-best-replaced')) for (const a of r.alternatives) expect(a.deltaCriterion).toBeGreaterThanOrEqual(0);
      expect(t.out.flags).not.toContain('implausible-part');
      for (const p of t.out.parts) {
        expect(p.ridgeHeight).toBeGreaterThanOrEqual(p.eaveHeight - 1e-9);
        expect(p.edgeKinds.length).toBe(p.footprint.outer.length);
        if (p.roof.type !== 'flat') expect(p.pitchSE).toBeGreaterThan(0);
        expect(p.eaveSE).toBeGreaterThan(0);
      }
    }
  });

  // Wall-clock budget (Sunny): only meaningful on an unloaded CPU, so it runs
  // in `npm run test:perf` (isolated, also in CI), not inside the parallel suite.
  it.skipIf(!process.env['SUNSCAN_PERF'])('runs in < 1.5 s per house including co-registration and partitions', () => {
    // a house over budget is timed once more (min of two runs) so parallel test load / GC pauses do not flake
    for (const t of trials.filter((x) => x.ms >= 1500)) {
      const { input } = generateCase(t.name, SEED + 1000 * [...SINGLE_CASES, 'outrigger'].indexOf(t.name) + trials.filter((x) => x.name === t.name).indexOf(t));
      const t0 = performance.now();
      reconstruct(input);
      t.ms = Math.min(t.ms, performance.now() - t0);
    }
    expect(Math.max(...trials.map((t) => t.ms))).toBeLessThan(1500);
    const sorted = trials.map((t) => t.ms).sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(500); // typical house well inside the budget
  });
});

describe('fit: chimney stacks from residual clusters', () => {
  it('finds most planted stacks on clean DSMs without inventing any', () => {
    let hit = 0, tot = 0, falsePos = 0;
    for (const name of ['gable_long', 'hip', 'semi_hip', 'mid_terrace'] as const) {
      for (let t = 0; t < 8; t++) {
        const { input, truth } = generateCase(name, 3000 + t, { outliers: 0, chimneyP: 1 });
        const out = reconstruct(input);
        for (const c of truth.chimneys) {
          tot++;
          if (out.chimneys.some((ch) => Math.hypot(ch.center[0] - c[0], ch.center[1] - c[1]) < 1.0)) hit++;
        }
        for (const ch of out.chimneys) {
          if (!truth.chimneys.some((c) => Math.hypot(ch.center[0] - c[0], ch.center[1] - c[1]) < 1.0)) falsePos++;
          expect(ch.source).toBe('lidar');
          expect(ch.top).toBeGreaterThan(out.parts[0].eaveHeight);
          expect(ch.width).toBeGreaterThan(0.3);
        }
      }
    }
    expect(tot).toBeGreaterThan(30);
    expect(hit / tot).toBeGreaterThanOrEqual(0.65);
    expect(falsePos).toBeLessThanOrEqual(1);
  });
});

describe('fit: registration search widening', () => {
  it('recovers offsets beyond the +-6 m coarse window (one widening pass to +-12 m)', () => {
    for (const m of [3, 8, 11]) {
      const { input, truth } = generateCase('gable_long', 4000 + m, { misreg: m });
      const out = reconstruct(input);
      expect(Math.hypot(out.registration.shift[0] - truth.correction[0], out.registration.shift[1] - truth.correction[1])).toBeLessThan(0.2);
      expect(out.ok).toBe(true);
      expect(out.report.selected).toBe('gable-u');
    }
  });
});
