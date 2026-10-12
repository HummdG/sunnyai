// Real LiDAR plausibility (research 05 section 4.12; spec A3): EA LIDAR Composite 2022 (Forthlin Road, Mendips,
// with last-return DSM) and Welsh national LiDAR (5 Cwmdonkin Drive) + OSM footprints projected with OSTN15.
// No ground truth exists: assert architecturally plausible families, eave 4.5-7.5 m, pitch 25-50 deg, sigma* <= 0.5.
import { describe, it, expect, beforeAll } from 'vitest';
import { reconstruct } from '../src/fit/reconstruct.js';
import { storeysFromEave } from '../src/fit/priors.js';
import { partIssues } from '../src/fit/plausibility.js';
import { buildRoof } from '../src/geometry/roof.js';
import { hasRealFixture, loadRealCase, type RealCase } from './fixtures/fit/realdata.js';
import type { ReconstructOutput } from '../src/types.js';

const SLUGS = ['uk-forthlin-road', 'uk-mendips', 'wales-dylan-thomas-birthplace'] as const;
const available = SLUGS.every(hasRealFixture);
const results = new Map<string, { c: RealCase; out: ReconstructOutput; ms: number }>();

describe.skipIf(!available)('fit: real LiDAR fixtures (plausibility, research 05 section 4.12)', () => {
  beforeAll(async () => {
    for (const slug of SLUGS) {
      const c = await loadRealCase(slug);
      let t0 = performance.now();
      const out = reconstruct(c.input);
      let ms = performance.now() - t0;
      t0 = performance.now();
      reconstruct(c.input); // second run: timing = min of two (robust to parallel test load), output is deterministic
      ms = Math.min(ms, performance.now() - t0);
      results.set(slug, { c, out, ms });
      // eslint-disable-next-line no-console
      console.log(`[fit-realdata] ${slug}: ${out.report.selected} shift (${out.registration.shift.map((v) => v.toFixed(2)).join(', ')}) sigma* ${out.report.sigma.toFixed(3)} `
        + `P ${out.report.pModel.toFixed(2)} ${ms.toFixed(0)} ms | `
        + out.parts.map((p) => `${p.id} ${p.family} eave ${p.eaveHeight.toFixed(2)} ridge ${p.ridgeHeight.toFixed(2)} pitch ${p.roof.pitchDeg?.toFixed(1)}`).join('; '));
    }
  }, 60_000);

  const plausible = (out: ReconstructOutput) => {
    expect(out.ok).toBe(true);
    expect(out.report.unreliable).toBe(false);
    expect(out.report.sigma).toBeLessThanOrEqual(0.5);
    expect(out.report.inlierFraction).toBeGreaterThanOrEqual(0.7);
    expect(out.registration.method).toBe('edge-neighbourhood');
    expect(Math.hypot(...out.registration.shift)).toBeLessThan(2.5);
    expect(out.registration.flag).toBeUndefined();
    expect(out.groundCheck).not.toBeNull();
    expect(Math.abs(out.ground - out.groundCheck!)).toBeLessThan(0.5);
    const main = out.parts[0];
    expect(main.id).toBe('main');
    expect(main.eaveHeight).toBeGreaterThanOrEqual(4.5);
    expect(main.eaveHeight).toBeLessThanOrEqual(7.5);
    expect(main.roof.pitchDeg!).toBeGreaterThanOrEqual(25);
    expect(main.roof.pitchDeg!).toBeLessThanOrEqual(50);
    expect(main.ridgeHeight).toBeGreaterThan(main.eaveHeight + 1.5);
    expect(out.samples.length).toBe(out.report.nPixels);
    expect(out.neighbourHeights.length).toBeGreaterThan(0);
    // relative to the target's ground datum (downhill neighbours on sloping streets can sit below it)
    for (const n of out.neighbourHeights) expect(Number.isFinite(n.height) && Math.abs(n.height) < 30).toBe(true);
    // the geometry engine rebuilds every part from the emitted RoofSpec + edge kinds
    for (const p of out.parts) {
      const roof = buildRoof(p.footprint, p.edgeKinds, { ...p.roof, eaveHeight: p.eaveHeight });
      expect(roof.skeleton.stats.warnings).toEqual([]);
      const top = Math.max(...roof.vertices.map((v) => v[2]));
      expect(Math.abs(top - p.ridgeHeight)).toBeLessThan(0.05);
    }
  };

  it('20 Forthlin Road (post-war mid-terrace): dual-pitch gable between party walls, ~42 deg, eave ~5.1 m', () => {
    const { out } = results.get('uk-forthlin-road')!;
    plausible(out);
    expect(out.parts).toHaveLength(1);
    const p = out.parts[0];
    expect(p.roof.type).toBe('gabled');
    expect(p.edgeKinds.filter((k) => k === 'party')).toHaveLength(2);
    expect(p.edgeKinds.filter((k) => k === 'eave')).toHaveLength(2);
    // the two slopes differ (~37 / ~47 deg, off-centre ridge; ~74 RBIC better than a symmetric gable): their mean
    // is the ~42 deg a symmetric fit reports
    const pitches = p.edgeKinds.flatMap((k, i) => (k === 'eave' ? [p.roof.edgePitchDeg?.[i] ?? p.roof.pitchDeg!] : []));
    expect(Math.abs((pitches[0] + pitches[1]) / 2 - 42)).toBeLessThan(4);
    for (const q of pitches) expect(Math.abs(q - 42)).toBeLessThan(8);
    expect(Math.abs(p.eaveHeight - 5.1)).toBeLessThan(0.4);
    expect(storeysFromEave(p.eaveHeight, '1945-1964')).toBe(2);
  });

  it('"Mendips", 251 Menlove Avenue (1930s semi): hipped with the party wall, ~34 deg, eave ~5.3 m', () => {
    const { out } = results.get('uk-mendips')!;
    plausible(out);
    expect(out.parts).toHaveLength(1);
    const p = out.parts[0];
    expect(p.roof.type).toBe('hipped');
    expect(p.edgeKinds.filter((k) => k === 'party')).toHaveLength(1);
    expect(Math.abs(p.roof.pitchDeg! - 34)).toBeLessThan(4);
    expect(Math.abs(p.eaveHeight - 5.3)).toBeLessThan(0.4);
    expect(storeysFromEave(p.eaveHeight, '1919-1944')).toBe(2);
  });

  it('5 Cwmdonkin Drive (Edwardian semi on a slope): two parts, hipped main + lower rear mono-pitch', () => {
    const { out } = results.get('wales-dylan-thomas-birthplace')!;
    plausible(out);
    expect(out.parts).toHaveLength(2);
    const [main, rear] = out.parts;
    expect(main.roof.type).toBe('hipped');
    expect(rear.role).toBe('extension');
    expect(rear.eaveHeight).toBeLessThan(main.eaveHeight);
    expect(rear.ridgeHeight).toBeLessThan(main.ridgeHeight);
    expect(out.flags).toContain('partitioned');
  });

  // Wall-clock budget (Sunny): only meaningful on an unloaded CPU, so it runs
  // in `npm run test:perf` (isolated, also in CI), not inside the parallel suite.
  it.skipIf(!process.env['SUNSCAN_PERF'])('fits each real house in < 1.5 s', () => {
    for (const { ms } of results.values()) expect(ms).toBeLessThan(1500);
  });
});

const HERITAGE = ['uk-hill-top', 'uk-shakespeare-birthplace', 'uk-down-house', 'uk-jane-austen-house', 'scot-carnegie-birthplace'] as const;

describe.skipIf(!HERITAGE.every(hasRealFixture))('fit: complex / heritage buildings are flagged, never silently wrong (spec A3)', () => {
  const out = new Map<string, { o: ReconstructOutput; ms: number }>();
  beforeAll(async () => {
    for (const slug of HERITAGE) {
      const c = await loadRealCase(slug);
      let t0 = performance.now();
      const o = reconstruct(c.input);
      let ms = performance.now() - t0;
      t0 = performance.now();
      reconstruct(c.input);
      ms = Math.min(ms, performance.now() - t0);
      out.set(slug, { o, ms });
    }
  }, 60_000);

  it('Hill Top: ok = false with outside-library / implausible flags', () => {
    const { o } = out.get('uk-hill-top')!;
    expect(o.ok).toBe(false);
    expect(o.flags.some((f) => f === 'outside-library' || f === 'implausible-part' || f === 'fit-unreliable')).toBe(true);
  });

  it('heritage fixtures are never a confident silent answer: ok = false with a reason, or plausible parts with reduced confidence', () => {
    for (const slug of HERITAGE) {
      const { o, ms } = out.get(slug)!;
      expect(ms, slug).toBeLessThan(1500);
      for (const p of o.parts) {
        const bad = p.eaveHeight < 2 || p.ridgeHeight < p.eaveHeight || (p.roof.type !== 'mansard' && p.roof.type !== 'gambrel' && (p.roof.pitchDeg ?? 0) > 70);
        if (bad) expect(o.ok, slug).toBe(false);
        if (o.ok) expect(partIssues(p, null), `${slug} ${p.id}`).toEqual([]);
      }
      if (o.ok) expect(o.report.pModel < 0.5 || o.flags.includes('implausible-best-replaced'), slug).toBe(true);
      else expect(o.flags.some((f) => ['fit-unreliable', 'outside-library', 'implausible-part'].includes(f)), slug).toBe(true);
    }
    expect(HERITAGE.filter((s) => !out.get(s)!.o.ok).length).toBeGreaterThanOrEqual(4);
  });
});
