// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\__tests__\tariff.test.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { describe, it, expect } from 'vitest';
import { getTariffForPostcode, DEFAULT_TARIFF } from '../src/tariff.js';

describe('getTariffForPostcode', () => {
  it('resolves a known postcode area to its regional row', () => {
    const t = getTariffForPostcode('NR1 2AA'); // Norwich → East England
    expect(t.source).toBe('table');
    expect(t.regionName).toMatch(/East/i);
    expect(t.importPencePerKwh).toBeGreaterThan(0);
    expect(t.standingChargePencePerDay).toBeGreaterThan(0);
    expect(t.segExportPencePerKwh).toBeGreaterThan(0);
  });

  it('prefers the longest matching prefix (EH beats E)', () => {
    // 'E' is the East-London area; 'EH' is Edinburgh. A postcode 'EH1 1AA'
    // must match the 2-letter 'EH' row, never the 1-letter 'E' row.
    const edinburgh = getTariffForPostcode('EH1 1AA');
    expect(edinburgh.regionName).toMatch(/Scotland/i);

    const london = getTariffForPostcode('E1 6AN');
    expect(london.regionName).toMatch(/London/i);

    expect(edinburgh.regionName).not.toBe(london.regionName);
  });

  it('normalises case and whitespace', () => {
    const a = getTariffForPostcode('eh1 1aa');
    const b = getTariffForPostcode('  EH11AA ');
    const c = getTariffForPostcode('EH1 1AA');
    expect(a).toEqual(c);
    expect(b).toEqual(c);
  });

  it('falls back to DEFAULT_TARIFF for an unknown prefix', () => {
    const t = getTariffForPostcode('ZZ1 1ZZ');
    expect(t.source).toBe('default');
    expect(t).toEqual(DEFAULT_TARIFF);
  });

  it('returns the same cached result across calls', () => {
    const a = getTariffForPostcode('NR1 2AA');
    const b = getTariffForPostcode('NR1 2AA');
    expect(a).toEqual(b);
  });
});
