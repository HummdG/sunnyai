// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\mcs.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. The lookup logic is
// unchanged; the CSV files it read from disk at runtime are now the generated
// typed modules in ./data, so the engine needs no file system.

import { MCS_IRRADIANCE, MCS_ORIENTATIONS } from './data/mcs-irradiance.js';
import { MCS_POSTCODE_ZONES } from './data/mcs-zones.js';

/**
 * Returns the MCS zone for a UK postcode.
 * Uses longest-match: "BD23" is checked before "BD".
 * Falls back to zone "1" (South East England) if not found.
 */
export function getZoneForPostcode(postcode: string): string {
  // Normalise: remove spaces, uppercase
  const cleaned = postcode.replace(/\s+/g, '').toUpperCase();
  // outward code is everything before the last 3 chars (inward = e.g. "1AA")
  const outward = cleaned.length > 3 ? cleaned.slice(0, cleaned.length - 3) : cleaned;
  for (let len = outward.length; len >= 1; len--) {
    const zone = MCS_POSTCODE_ZONES[outward.slice(0, len)];
    if (zone !== undefined) return zone;
  }
  return '1'; // default to SE England
}

/**
 * Returns kWh/m²/year irradiance from the MCS dataset.
 * Clamps inclination to [0,90] and finds the closest orientation row.
 * MCS orientation convention: 0=South, 90=East/West, 180=North.
 */
export function getIrradianceKwhPerM2(
  zone: string,
  inclinationDeg: number,
  orientationDeg: number,
): number {
  const inclClamped = Math.max(0, Math.min(90, Math.round(inclinationDeg)));
  // MCS dataset uses 0–175 for orientation (symmetric about south)
  const orientClamped = Math.max(0, Math.min(175, Math.round(orientationDeg / 5) * 5));

  const row = MCS_IRRADIANCE[zone]?.[inclClamped];
  if (!row || row.every((v) => v === null)) {
    // Fallback: any zone's row for this inclination (v1 took the first CSV row,
    // which is zone "1", orientation 0).
    return MCS_IRRADIANCE['1']?.[inclClamped]?.[0] ?? 900;
  }

  // Find closest orientation
  let best: number | null = null;
  let bestDiff = Infinity;
  MCS_ORIENTATIONS.forEach((orientation, i) => {
    const value = row[i];
    if (value === null || value === undefined) return;
    const diff = Math.abs(orientation - orientClamped);
    if (diff < bestDiff) {
      best = value;
      bestDiff = diff;
    }
  });
  return best ?? 900;
}
