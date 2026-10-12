// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\deriveGeometry.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { DEFAULT_ASSUMPTIONS } from '../solarCalculations.js';
import type { GoogleSolarBuildingInsights, OsBuilding } from '../types.js';

/** Provenance of the derived roof geometry. */
export type GeometrySource = 'google_solar' | 'os_ngd' | 'estimated';

const PITCH_MIN_DEG = 5;
const PITCH_MAX_DEG = 70;

/**
 * Convert a true compass bearing (0 = N, 90 = E, 180 = S, 270 = W) to the MCS
 * orientation convention (0 = South, 90 = E/W, 180 = North) — the angular
 * distance from due south. Robust to out-of-range bearings.
 *
 * This is the CORRECT conversion. The legacy homeowner SurveyForm used an
 * inverted inline formula (north→0) that silently degraded every generation /
 * savings / payback figure. Always use this.
 */
export function azimuthToMcsOrientation(azimuthDeg: number): number {
  const wrapped = ((azimuthDeg % 360) + 360) % 360;
  return Math.abs(wrapped - 180);
}

function clampPitch(deg: number): number {
  return Math.round(Math.min(PITCH_MAX_DEG, Math.max(PITCH_MIN_DEG, deg)));
}

function p50(quantiles: number[] | undefined): number {
  if (!quantiles || quantiles.length === 0) return 0;
  return quantiles[Math.floor(quantiles.length / 2)]!;
}

export interface DerivedGeometry {
  pitchDeg: number;
  mcsOrientationDeg: number;
  geometrySource: GeometrySource;
}

/**
 * Derive roof pitch + MCS orientation from the best available source:
 * Google Solar (sunniest segment) → OS NGD (pitch/azimuth) → estimated defaults.
 * Pure — no I/O.
 */
export function deriveGeometry(
  insights: GoogleSolarBuildingInsights | null | undefined,
  osBuilding: OsBuilding | null | undefined,
): DerivedGeometry {
  const segments = insights?.solarPotential.roofSegmentStats ?? [];
  if (segments.length > 0) {
    const best = segments.reduce((prev, cur) =>
      p50(cur.stats.sunshineQuantiles) > p50(prev.stats.sunshineQuantiles) ? cur : prev,
    );
    return {
      pitchDeg: clampPitch(best.pitchDegrees),
      mcsOrientationDeg: Math.round(azimuthToMcsOrientation(best.azimuthDegrees)),
      geometrySource: 'google_solar',
    };
  }

  if (osBuilding && osBuilding.roofPitchDeg != null && osBuilding.roofAzimuthDeg != null) {
    return {
      pitchDeg: clampPitch(osBuilding.roofPitchDeg),
      mcsOrientationDeg: Math.round(azimuthToMcsOrientation(osBuilding.roofAzimuthDeg)),
      geometrySource: 'os_ngd',
    };
  }

  return {
    pitchDeg: DEFAULT_ASSUMPTIONS.roofPitchDeg,
    mcsOrientationDeg: DEFAULT_ASSUMPTIONS.roofOrientationDeg,
    geometrySource: 'estimated',
  };
}
