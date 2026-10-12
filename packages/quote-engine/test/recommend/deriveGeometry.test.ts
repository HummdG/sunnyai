// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\__tests__\deriveGeometry.test.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { describe, it, expect } from 'vitest';
import { azimuthToMcsOrientation, deriveGeometry } from '../../src/recommend/deriveGeometry.js';
import type { OsBuilding } from '../../src/types.js';
import { mockBuildingInsightsForTest } from './fixtures.js';

describe('azimuthToMcsOrientation', () => {
  it('maps a true compass bearing to distance-from-south (MCS 0 = South)', () => {
    expect(azimuthToMcsOrientation(180)).toBe(0); // due south
    expect(azimuthToMcsOrientation(0)).toBe(180); // due north
    expect(azimuthToMcsOrientation(90)).toBe(90); // east
    expect(azimuthToMcsOrientation(270)).toBe(90); // west
  });

  it('wraps out-of-range bearings', () => {
    expect(azimuthToMcsOrientation(360)).toBe(180);
    expect(azimuthToMcsOrientation(-90)).toBe(90); // 270 → west
    expect(azimuthToMcsOrientation(540)).toBe(0); // 180 → south
  });
});

describe('deriveGeometry', () => {
  it('uses the sunniest Google segment when insights are present', () => {
    const insights = mockBuildingInsightsForTest(); // south segment (az 180) is sunniest
    const g = deriveGeometry(insights, null);
    expect(g.geometrySource).toBe('google_solar');
    expect(g.mcsOrientationDeg).toBe(0); // south
    expect(g.pitchDeg).toBe(32);
  });

  it('falls back to OS building pitch/azimuth when Google is absent', () => {
    const os: OsBuilding = {
      footprintPolygon: [[0, 0]],
      source: 'os_ngd',
      areaM2: 90,
      roofPitchDeg: 40,
      roofAzimuthDeg: 90, // east
    };
    const g = deriveGeometry(null, os);
    expect(g.geometrySource).toBe('os_ngd');
    expect(g.pitchDeg).toBe(40);
    expect(g.mcsOrientationDeg).toBe(90);
  });

  it('falls back to estimated defaults when nothing is available', () => {
    const g = deriveGeometry(null, null);
    expect(g.geometrySource).toBe('estimated');
    expect(g.pitchDeg).toBe(35);
    expect(g.mcsOrientationDeg).toBe(0);
  });

  it('ignores an OS building that lacks pitch or azimuth', () => {
    const os: OsBuilding = {
      footprintPolygon: [[0, 0]],
      source: 'os_ngd',
      areaM2: 90,
      // no roofPitchDeg / roofAzimuthDeg
    };
    const g = deriveGeometry(null, os);
    expect(g.geometrySource).toBe('estimated');
  });
});
