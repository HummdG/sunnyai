// Python-oracle parity: the TS fitter core (rectangle library, profile init, Tukey IRLS, two-stage robust BIC)
// must reproduce research/methods/roofit on 60 synthetic houses exported by research/methods/ts/make_fixtures.py
// (`python ts/make_fixtures.py <out> 60`; the first 20 are research/methods/ts/fixtures.json verbatim).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fitRectangleOracle } from '../src/fit/select.js';
import type { RectSpec } from '../src/fit/models.js';

interface Fixture {
  name: string; rect: RectSpec; sub: number[]; n: number; S2: number; z: number[];
  ref: { label: string; beta: number[]; g: number | null; sigma: number; p_best: number; crits: Record<string, number | null> };
}

const fixtures: Fixture[] = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/fit/roofit-oracle.json', import.meta.url)), 'utf8'));

describe('fit: Python oracle parity (research/methods/roofit)', () => {
  it('has the 60 oracle cases covering every rectangle family', () => {
    expect(fixtures.length).toBe(60);
    const labels = new Set(fixtures.map((f) => f.ref.label));
    for (const l of ['flat', 'gable-u', 'gable-v', 'hip', 'halfhip-u', 'mansard-u', 'skillion-S']) expect(labels.has(l)).toBe(true);
  });

  it('selects the same model with the same parameters, scale, posterior and criteria on all 60 cases', () => {
    let maxDb = 0, maxDs = 0, maxDp = 0, maxDc = 0, nCrit = 0;
    const mismatches: string[] = [];
    const t0 = performance.now();
    for (const f of fixtures) {
      const r = fitRectangleOracle(f.rect, Float64Array.from(f.sub), f.n, f.S2, Float64Array.from(f.z));
      if (r.label !== f.ref.label) { mismatches.push(`${f.name}: ts=${r.label} py=${f.ref.label}`); continue; }
      maxDb = Math.max(maxDb, ...r.beta.map((b, i) => Math.abs(b - f.ref.beta[i])));
      if (f.ref.g !== null) expect(r.g).toBeCloseTo(f.ref.g, 9);
      maxDs = Math.max(maxDs, Math.abs(r.sigma - f.ref.sigma));
      maxDp = Math.max(maxDp, Math.abs(r.pBest - f.ref.p_best));
      for (const h of r.all) {
        const pc = f.ref.crits[h.label];
        if (typeof pc === 'number' && Number.isFinite(h.crit)) { maxDc = Math.max(maxDc, Math.abs(pc - h.crit)); nCrit++; }
        if (pc === null) expect(Number.isFinite(h.crit)).toBe(false);
      }
      expect(r.all.map((h) => h.label).sort()).toEqual(Object.keys(f.ref.crits).sort());
    }
    const ms = (performance.now() - t0) / fixtures.length;
    expect(mismatches).toEqual([]);
    expect(maxDb).toBeLessThan(1e-6); // metres / slope
    expect(maxDs).toBeLessThan(1e-6);
    expect(maxDp).toBeLessThan(1e-6);
    expect(maxDc).toBeLessThan(1e-4);
    expect(nCrit).toBeGreaterThan(400);
    // eslint-disable-next-line no-console
    console.log(`[fit-parity] 60/60 same model; max |dbeta| ${maxDb.toExponential(1)}, |dsigma| ${maxDs.toExponential(1)}, |dP| ${maxDp.toExponential(1)}, |dRBIC| ${maxDc.toExponential(1)} over ${nCrit} criteria; ${ms.toFixed(1)} ms/house`);
  });
});
