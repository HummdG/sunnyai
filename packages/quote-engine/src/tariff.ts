// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\tariff.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. The lookup logic is
// unchanged; `data/regional_tariffs.csv` is now the generated module
// ./data/regional-tariffs.ts.

import { REGIONAL_TARIFF_ROWS } from './data/regional-tariffs.js';

/**
 * Regional electricity tariff lookup for the installer lead-gen flow.
 *
 * When an installer just types an address (no bill), we still need import unit
 * rate, standing charge, and SEG export rate to size and price a system. We
 * maintain a static table keyed by postcode prefix → one of the 14 GB
 * electricity distribution regions.
 *
 * Source: representative Ofgem energy-price-cap regional figures for import
 * unit rate and standing charge; SEG export is supplier-set so a representative
 * ~15p/kWh is used. Review quarterly. The installer can always override the
 * auto-derived rates.
 */

export interface RegionalTariff {
  importPencePerKwh: number;
  standingChargePencePerDay: number;
  segExportPencePerKwh: number;
  regionName: string;
  source: 'table' | 'default';
}

/** National-average fallback when a postcode prefix isn't in the table. */
export const DEFAULT_TARIFF: RegionalTariff = {
  importPencePerKwh: 24.5,
  standingChargePencePerDay: 53,
  segExportPencePerKwh: 15,
  regionName: 'National average',
  source: 'default',
};

const TARIFFS: ReadonlyMap<string, RegionalTariff> = new Map(
  REGIONAL_TARIFF_ROWS.map(([prefix, regionName, importP, standingP, segP]) => [
    prefix,
    {
      importPencePerKwh: importP,
      standingChargePencePerDay: standingP,
      segExportPencePerKwh: segP,
      regionName,
      source: 'table' as const,
    },
  ]),
);

/**
 * Returns the regional tariff for a UK postcode.
 * Uses longest-match on the outward code: "EH1" → "EH" before "E".
 * Falls back to DEFAULT_TARIFF if no prefix matches.
 */
export function getTariffForPostcode(postcode: string): RegionalTariff {
  const cleaned = postcode.replace(/\s+/g, '').toUpperCase();
  // outward code is everything before the last 3 chars (inward = e.g. "1AA")
  const outward = cleaned.length > 3 ? cleaned.slice(0, cleaned.length - 3) : cleaned;
  for (let len = outward.length; len >= 1; len--) {
    const hit = TARIFFS.get(outward.slice(0, len));
    if (hit) return hit;
  }
  return DEFAULT_TARIFF;
}
