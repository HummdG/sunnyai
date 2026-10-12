// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\pricing\__tests__\siteContext.test.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { describe, it, expect } from 'vitest';
import { deriveSiteContext } from '../../src/pricing/siteContext.js';
import type { GoogleSolarBuildingInsights } from '../../src/types.js';

// Google insights with an absurd whole-roof count — deriveSiteContext must
// ignore it now and trust the realistic count the caller passes in.
function insightsWithMaxArray(maxArrayPanelsCount: number): GoogleSolarBuildingInsights {
  return {
    solarPotential: {
      maxArrayPanelsCount,
      roofSegmentStats: [{ pitchDegrees: 35 }],
    },
  } as unknown as GoogleSolarBuildingInsights;
}

describe('deriveSiteContext', () => {
  it('uses the passed-in realistic count, not Google maxArrayPanelsCount', () => {
    const { roofMaxPanels } = deriveSiteContext(null, insightsWithMaxArray(86), 13);
    expect(roofMaxPanels).toBe(13);
  });

  it('falls back to the default cap when the realistic count is 0', () => {
    const { roofMaxPanels } = deriveSiteContext(null, insightsWithMaxArray(86), 0);
    expect(roofMaxPanels).toBe(20);
  });
});
