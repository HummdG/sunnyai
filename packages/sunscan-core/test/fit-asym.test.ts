// Asymmetric (off-centre ridge) gables: one long shallow slope and one short steep slope at the same eave height.
// A symmetric gable cannot place the ridge, so without an asymmetric hypothesis the fitter falls back to a skillion
// and drops the short slope (seen on real houses, e.g. 3A Downs Walk, Peacehaven).
import { describe, it, expect, beforeAll } from 'vitest';
import { reconstruct } from '../src/fit/reconstruct.js';
import { generateCase, type CaseTruth } from './fixtures/fit/synth.js';
import type { ReconstructOutput } from '../src/types.js';

const TRIALS = 20;
const SEED = 300_000;
const p95 = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
};

const trials: { truth: CaseTruth; out: ReconstructOutput }[] = [];
const edgePitch = (roof: { pitchDeg?: number; edgePitchDeg?: (number | undefined)[] }, i: number) => roof.edgePitchDeg?.[i] ?? roof.pitchDeg ?? NaN;

describe('fit: asymmetric gables (sigma 0.15 m, 5 % outliers, 0.5 m misregistration)', () => {
  beforeAll(() => {
    for (let t = 0; t < TRIALS; t++) {
      const { input, truth } = generateCase('gable_asym', SEED + t);
      trials.push({ truth, out: reconstruct(input) });
    }
  }, 120_000);

  it('reports a single gabled part with the gable ends on the right edges (>= 90 %)', () => {
    const ok = trials.filter(({ truth, out }) => out.parts.length === 1 && out.parts[0].roof.type === 'gabled' && out.parts[0].edgeKinds.join() === truth.kinds.join());
    expect(ok.length / trials.length).toBeGreaterThanOrEqual(0.9);
  });

  it('recovers both pitches (p95 <= 4 deg) and the ridge height (p95 <= 0.3 m)', () => {
    const pitchErr: number[] = [], ridgeErr: number[] = [];
    for (const { truth, out } of trials) {
      const p = out.parts[0];
      if (p.roof.type !== 'gabled') continue;
      for (const i of [0, 2]) pitchErr.push(Math.abs(edgePitch(p.roof, i) - (truth.edgePitchDeg![i] ?? truth.pitchDeg)));
      ridgeErr.push(Math.abs((p.ridgeHeight ?? NaN) + out.ground - truth.ridge!));
    }
    expect(ridgeErr.length).toBeGreaterThanOrEqual(0.9 * TRIALS);
    expect(p95(pitchErr)).toBeLessThanOrEqual(4);
    expect(p95(ridgeErr)).toBeLessThanOrEqual(0.3);
  });
});
