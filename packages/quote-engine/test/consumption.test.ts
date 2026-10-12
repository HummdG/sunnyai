// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\__tests__\consumption.test.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { describe, it, expect } from 'vitest';
import {
  TDCV_ELECTRICITY_KWH,
  DEFAULT_ANNUAL_KWH,
  defaultConsumptionKwh,
  resolveConsumptionKwh,
} from '../src/consumption.js';

describe('TDCV bands', () => {
  it('uses the Ofgem electricity TDCV figures', () => {
    expect(TDCV_ELECTRICITY_KWH.low).toBe(1800);
    expect(TDCV_ELECTRICITY_KWH.medium).toBe(2700);
    expect(TDCV_ELECTRICITY_KWH.high).toBe(4100);
  });

  it('defaults to the medium band', () => {
    expect(DEFAULT_ANNUAL_KWH).toBe(2700);
    expect(defaultConsumptionKwh()).toBe(2700);
    expect(defaultConsumptionKwh('high')).toBe(4100);
  });
});

describe('resolveConsumptionKwh', () => {
  it('falls back to the medium TDCV band when no override is given', () => {
    expect(resolveConsumptionKwh(null)).toEqual({
      annualKwh: 2700,
      source: 'tdcv',
      band: 'medium',
    });
    expect(resolveConsumptionKwh(undefined)).toEqual({
      annualKwh: 2700,
      source: 'tdcv',
      band: 'medium',
    });
  });

  it('falls back to the chosen band when no override is given', () => {
    expect(resolveConsumptionKwh(null, 'low')).toEqual({
      annualKwh: 1800,
      source: 'tdcv',
      band: 'low',
    });
  });

  it('uses a valid override regardless of band', () => {
    expect(resolveConsumptionKwh(5200, 'medium')).toEqual({
      annualKwh: 5200,
      source: 'override',
      band: 'medium',
    });
  });

  it('ignores an out-of-range override and falls back to the band', () => {
    // below the 100 floor
    expect(resolveConsumptionKwh(50, 'medium').source).toBe('tdcv');
    expect(resolveConsumptionKwh(50, 'medium').annualKwh).toBe(2700);
    // above the 100000 ceiling
    expect(resolveConsumptionKwh(250000, 'high').source).toBe('tdcv');
    expect(resolveConsumptionKwh(250000, 'high').annualKwh).toBe(4100);
    // NaN / non-finite
    expect(resolveConsumptionKwh(Number.NaN, 'medium').source).toBe('tdcv');
  });
});
