// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\__tests__\fixtures.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type { GoogleSolarBuildingInsights } from '../../src/types.js';

/**
 * Compact Google Solar insights fixture for engine tests.
 * Mirrors the shape of googleSolarApi's mock: a south-facing (az=180) segment
 * plus a north segment, and four panel configs (6/10/14/20 panels).
 */
export function mockBuildingInsightsForTest(): GoogleSolarBuildingInsights {
  return {
    name: 'buildings/test',
    center: { latitude: 52.6, longitude: 1.3 },
    boundingBox: {
      sw: { latitude: 52.5999, longitude: 1.2999 },
      ne: { latitude: 52.6001, longitude: 1.3001 },
    },
    imageryDate: { year: 2024, month: 6, day: 1 },
    imageryQuality: 'HIGH',
    solarPotential: {
      maxArrayPanelsCount: 20,
      maxArrayAreaMeters2: 38,
      maxSunshineHoursPerYear: 1100,
      carbonOffsetFactorKgPerMwh: 195,
      wholeRoofStats: {
        areaMeters2: 80,
        sunshineQuantiles: [600, 900, 1100, 1300, 1400],
        groundAreaMeters2: 70,
      },
      roofSegmentStats: [
        {
          pitchDegrees: 32,
          azimuthDegrees: 180,
          stats: {
            areaMeters2: 63,
            sunshineQuantiles: [900, 1100, 1200, 1350, 1450],
            groundAreaMeters2: 53,
          },
          center: { latitude: 52.5999, longitude: 1.3 },
          boundingBox: {
            sw: { latitude: 52.5998, longitude: 1.2999 },
            ne: { latitude: 52.6, longitude: 1.3001 },
          },
          planeHeightAtCenterMeters: 6.5,
        },
        {
          pitchDegrees: 32,
          azimuthDegrees: 0,
          stats: {
            areaMeters2: 63,
            sunshineQuantiles: [400, 600, 750, 900, 1050],
            groundAreaMeters2: 53,
          },
          center: { latitude: 52.6001, longitude: 1.3 },
          boundingBox: {
            sw: { latitude: 52.6, longitude: 1.2999 },
            ne: { latitude: 52.6002, longitude: 1.3001 },
          },
          planeHeightAtCenterMeters: 6.5,
        },
      ],
      solarPanelConfigs: [
        {
          panelsCount: 6,
          yearlyEnergyDcKwh: 1800,
          roofSegmentSummaries: [
            {
              pitchDegrees: 32,
              azimuthDegrees: 180,
              panelsCount: 6,
              yearlyEnergyDcKwh: 1800,
              segmentIndex: 0,
            },
          ],
        },
        {
          panelsCount: 10,
          yearlyEnergyDcKwh: 3000,
          roofSegmentSummaries: [
            {
              pitchDegrees: 32,
              azimuthDegrees: 180,
              panelsCount: 10,
              yearlyEnergyDcKwh: 3000,
              segmentIndex: 0,
            },
          ],
        },
        {
          panelsCount: 14,
          yearlyEnergyDcKwh: 4200,
          roofSegmentSummaries: [
            {
              pitchDegrees: 32,
              azimuthDegrees: 180,
              panelsCount: 14,
              yearlyEnergyDcKwh: 4200,
              segmentIndex: 0,
            },
          ],
        },
        {
          panelsCount: 20,
          yearlyEnergyDcKwh: 6000,
          roofSegmentSummaries: [
            {
              pitchDegrees: 32,
              azimuthDegrees: 180,
              panelsCount: 20,
              yearlyEnergyDcKwh: 6000,
              segmentIndex: 0,
            },
          ],
        },
      ],
      panelCapacityWatts: 400,
      panelHeightMeters: 1.65,
      panelWidthMeters: 0.992,
      panelLifetimeYears: 25,
    },
  };
}
