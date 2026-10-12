// The pipeline with the REAL core/fit `reconstruct` (default dependency) on the 9 recorded addresses.
// Auto-skips while core/fit does not export `reconstruct`.
import { beforeAll, describe, expect, it } from 'vitest';
import * as fitModule from '@sunny/sunscan-core/fit';
import type { HouseModelSpec } from '@sunny/sunscan-core';
import { buildModel } from '../src/pipeline/index.js';
import { createFixtureProviders, inputOf } from './support/fixture-providers.js';
import { SLUGS, type Slug } from './support/paths.js';
import { expectWellFormedSpec, ridgeOf } from './support/spec-checks.js';

const fit = fitModule as unknown as Record<string, unknown>;
const hasReconstruct = typeof fit.reconstruct === 'function';
const ORDINARY: Slug[] = ['uk-mendips', 'uk-forthlin-road', 'wales-dylan-thomas-birthplace'];

describe.skipIf(!hasReconstruct)('pipeline with the real core/fit reconstruct', () => {
  const providers = createFixtureProviders();
  const specs = new Map<Slug, HouseModelSpec>();
  beforeAll(async () => {
    for (const slug of SLUGS) {
      const q = inputOf(slug);
      const geocode = await providers.geocodeUk(q);
      const r = await buildModel({ lat: geocode.best!.lat, lon: geocode.best!.lon, address: q, geocode }, { providers, now: () => new Date('2026-10-08T12:00:00Z'), log: () => undefined });
      specs.set(slug, r.spec);
    }
  }, 120_000);

  it.each(SLUGS)('%s: well-formed, plausible heights, labelled with the fitter', (slug) => {
    const s = specs.get(slug)!;
    expectWellFormedSpec(s);
    expect(s.fit?.method).toBe(fit.FIT_METHOD);
    for (const p of s.parts) {
      // main part: a house; secondary parts may be single-storey lean-tos
      expect(p.eaveHeight).toBeGreaterThanOrEqual(p.role === 'main' ? 2.3 : 1.0);
      expect(p.eaveHeight).toBeLessThanOrEqual(16);
      expect(ridgeOf(p)).toBeGreaterThanOrEqual(p.eaveHeight);
    }
    if (s.fit?.unreliable) expect(['medium', 'low', 'estimated']).toContain(s.quality.heights);
  });

  it.each(ORDINARY)('%s: reliable LiDAR roof (criterion A3: eave 4.5–7.5 m, pitch 25–50°, σ* <= 0.5 m)', (slug) => {
    const s = specs.get(slug)!;
    expect(s.fit!.unreliable).toBe(false);
    expect(s.fit!.sigma).toBeLessThanOrEqual(0.5);
    const main = s.parts.find((p) => p.role === 'main')!;
    expect(main.eaveHeight).toBeGreaterThanOrEqual(4.5);
    expect(main.eaveHeight).toBeLessThanOrEqual(7.5);
    expect(main.roof.type).not.toBe('flat');
    expect(main.roof.pitchDeg!).toBeGreaterThanOrEqual(25);
    expect(main.roof.pitchDeg!).toBeLessThanOrEqual(50);
    expect(s.quality.heights).toBe('measured');
  });

  it('keeps the terrace registration across the row (Forthlin: research shift ≈ (−0.7, −0.3) m)', () => {
    const shift = specs.get('uk-forthlin-road')!.fit!.registration.shift;
    expect(Math.hypot(shift[0] + 0.7, shift[1] + 0.3)).toBeLessThan(0.75);
  });
});
