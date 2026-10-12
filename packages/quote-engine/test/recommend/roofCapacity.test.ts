// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\__tests__\roofCapacity.test.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { describe, it, expect } from 'vitest';
import {
  estimateRoofCapacity,
  usableGoogleSolarPanelCount,
} from '../../src/recommend/roofCapacity.js';
import type {
  GoogleSolarBuildingInsights,
  GoogleSolarPanelConfig,
  GoogleSolarRoofSegmentSummary,
} from '../../src/types.js';

/**
 * Build a rectangular WGS84 footprint ring of the given size (metres) using the
 * same flat-earth scaling the helper uses, so the local-metre area is exact.
 */
function rectRing(widthM: number, depthM: number): [number, number][] {
  const lng0 = 1.0;
  const lat0 = 52.0;
  const dLng = widthM / (Math.cos((lat0 * Math.PI) / 180) * 111320);
  const dLat = depthM / 110540;
  return [
    [lng0, lat0],
    [lng0 + dLng, lat0],
    [lng0 + dLng, lat0 + dLat],
    [lng0, lat0 + dLat],
    [lng0, lat0],
  ];
}

describe('estimateRoofCapacity', () => {
  it('returns a realistic single-plane count, well below the old footprint ÷ 4', () => {
    const ring = rectRing(10, 7); // ~70 m² footprint
    const { count } = estimateRoofCapacity(ring, 35);

    expect(count).toBeGreaterThan(0);
    // The old heuristic was Math.round(area / 4) ≈ 18 for the whole footprint.
    expect(count).toBeLessThan(Math.round(70 / 4));
    // …but still a sensible best-single-plane count, not a token handful.
    expect(count).toBeGreaterThanOrEqual(10);
  });

  it('returns positions matching the reported count', () => {
    const ring = rectRing(10, 7);
    const { count, positions } = estimateRoofCapacity(ring, 35);
    expect(positions).toHaveLength(count);
  });

  it('scales up with footprint size', () => {
    const small = estimateRoofCapacity(rectRing(8, 6), 35).count;
    const large = estimateRoofCapacity(rectRing(16, 10), 35).count;
    expect(large).toBeGreaterThan(small);
  });

  it('does not shrink as pitch increases (steeper roof = more slope area)', () => {
    const shallow = estimateRoofCapacity(rectRing(10, 7), 20).count;
    const steep = estimateRoofCapacity(rectRing(10, 7), 50).count;
    expect(steep).toBeGreaterThanOrEqual(shallow);
  });

  it('returns 0 for a footprint too small to size a system (< 10 m²)', () => {
    expect(estimateRoofCapacity(rectRing(2, 2), 35).count).toBe(0);
  });

  it('returns 0 for a degenerate ring', () => {
    expect(estimateRoofCapacity([[1, 52]], 35).count).toBe(0);
    expect(estimateRoofCapacity([], 35).count).toBe(0);
  });
});

// Compass azimuth: 0=N, 90=E, 180=S, 270=W.
function seg(azimuthDegrees: number, panelsCount: number): GoogleSolarRoofSegmentSummary {
  return { azimuthDegrees, panelsCount, pitchDegrees: 35, yearlyEnergyDcKwh: 0, segmentIndex: 0 };
}

function insightsWith(configs: GoogleSolarPanelConfig[]): GoogleSolarBuildingInsights {
  return {
    solarPotential: { solarPanelConfigs: configs },
  } as unknown as GoogleSolarBuildingInsights;
}

describe('usableGoogleSolarPanelCount', () => {
  it('sums usable (S/E/W) faces and excludes the north-facing one', () => {
    const largest: GoogleSolarPanelConfig = {
      panelsCount: 18,
      yearlyEnergyDcKwh: 0,
      roofSegmentSummaries: [
        seg(180, 6), // south
        seg(90, 4), //  east
        seg(270, 3), // west
        seg(0, 5), //   north — excluded
      ],
    };
    expect(usableGoogleSolarPanelCount(insightsWith([largest]))).toBe(13);
  });

  it('picks the largest layout config', () => {
    const small: GoogleSolarPanelConfig = {
      panelsCount: 5,
      yearlyEnergyDcKwh: 0,
      roofSegmentSummaries: [seg(180, 5)],
    };
    const large: GoogleSolarPanelConfig = {
      panelsCount: 12,
      yearlyEnergyDcKwh: 0,
      roofSegmentSummaries: [seg(180, 9), seg(0, 3)], // 9 usable + 3 north
    };
    expect(usableGoogleSolarPanelCount(insightsWith([small, large]))).toBe(9);
  });

  it('returns 0 when there are no panel configs or no insights', () => {
    expect(usableGoogleSolarPanelCount(insightsWith([]))).toBe(0);
    expect(usableGoogleSolarPanelCount(null)).toBe(0);
    expect(usableGoogleSolarPanelCount(undefined)).toBe(0);
  });
});
