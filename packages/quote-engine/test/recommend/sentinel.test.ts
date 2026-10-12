// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\__tests__\sentinel.test.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { describe, it, expect } from 'vitest';
import {
  computeSentinel,
  computeSentinelUplift,
  type SentinelConfig,
} from '../../src/recommend/sentinel.js';

const CONFIG: SentinelConfig = {
  enabled: true,
  baseUpliftPercent: 0.12,
  tariffModifiers: { standard: 0, smart_tou: 0.08, unknown: 0 },
  batteryRequiredForFullUplift: true,
  noBatteryUpliftFactor: 0.4,
  lifestyleBonus: { ev_now: 0.03, high_daytime: 0.02 },
  capUpliftPercent: 0.3,
  addedCostGbp: 0,
};

describe('computeSentinelUplift', () => {
  it('smart-ToU + battery beats standard + no battery', () => {
    const smart = computeSentinelUplift(true, 'smart_tou', ['ev_now'], CONFIG); // 0.12+0.08+0.03
    const plain = computeSentinelUplift(false, 'standard', [], CONFIG); // 0.12 * 0.4
    expect(smart).toBeGreaterThan(plain);
    expect(smart).toBeCloseTo(0.23, 5);
    expect(plain).toBeCloseTo(0.048, 5);
  });

  it('clamps to the cap', () => {
    const u = computeSentinelUplift(true, 'smart_tou', ['ev_now', 'high_daytime'], {
      ...CONFIG,
      capUpliftPercent: 0.2,
    });
    expect(u).toBe(0.2);
  });

  it('returns 0 when disabled or no config', () => {
    expect(computeSentinelUplift(true, 'smart_tou', [], { ...CONFIG, enabled: false })).toBe(0);
    expect(computeSentinelUplift(true, 'smart_tou', [], null)).toBe(0);
  });
});

describe('computeSentinel', () => {
  it('raises savings, lowers export, recomputes payback', () => {
    const r = computeSentinel({
      annualSavingGbp: 1000,
      annualExportGbp: 200,
      paybackYearsBase: 10,
      priceGbp: 10000,
      hasBattery: true,
      tariffType: 'smart_tou',
      lifestyle: ['ev_now'],
      config: CONFIG,
    });
    expect(r.enabled).toBe(true);
    expect(r.upliftPercent).toBeCloseTo(0.23, 5);
    expect(r.withSentinel.annualSavingGbp).toBeCloseTo(1230, 5);
    expect(r.withSentinel.annualExportGbp).toBeCloseTo(154, 5); // 200 * (1 - 0.23)
    expect(r.withSentinel.paybackYears).toBeCloseTo(10000 / 1230, 3);
    expect(r.indicative).toBe(true);
  });

  it('before === after when disabled', () => {
    const r = computeSentinel({
      annualSavingGbp: 1000,
      annualExportGbp: 200,
      paybackYearsBase: 10,
      priceGbp: 10000,
      hasBattery: true,
      tariffType: 'smart_tou',
      lifestyle: [],
      config: { ...CONFIG, enabled: false },
    });
    expect(r.enabled).toBe(false);
    expect(r.withSentinel).toEqual(r.withoutSentinel);
    expect(r.upliftPercent).toBe(0);
  });
});
