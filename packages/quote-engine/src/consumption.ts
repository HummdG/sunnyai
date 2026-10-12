// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\consumption.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

// Consumption defaults for the installer lead-gen flow.
//
// When an installer just types an address (no bill), annual electricity
// consumption is unknown. We default to Ofgem's Typical Domestic Consumption
// Values (TDCV) for a single-rate electricity meter and let the installer
// override with a known figure.
//
// Source: Ofgem TDCV (electricity, single-rate). Reviewed periodically.

export type TdcvBand = 'low' | 'medium' | 'high';

export const TDCV_ELECTRICITY_KWH: Record<TdcvBand, number> = {
  low: 1800,
  medium: 2700,
  high: 4100,
};

/** Default annual consumption when nothing else is known (Ofgem medium). */
export const DEFAULT_ANNUAL_KWH = TDCV_ELECTRICITY_KWH.medium;

// Bounds mirror the Zod limits used elsewhere for annualKwh.
const MIN_ANNUAL_KWH = 100;
const MAX_ANNUAL_KWH = 100000;

export function defaultConsumptionKwh(band: TdcvBand = 'medium'): number {
  return TDCV_ELECTRICITY_KWH[band];
}

export interface ResolvedConsumption {
  annualKwh: number;
  source: 'override' | 'tdcv';
  band: TdcvBand;
}

/**
 * Resolve annual consumption from an optional installer override, falling back
 * to the chosen TDCV band when the override is missing or out of range.
 */
export function resolveConsumptionKwh(
  override: number | null | undefined,
  band: TdcvBand = 'medium',
): ResolvedConsumption {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= MIN_ANNUAL_KWH &&
    override <= MAX_ANNUAL_KWH
  ) {
    return { annualKwh: override, source: 'override', band };
  }
  return { annualKwh: TDCV_ELECTRICITY_KWH[band], source: 'tdcv', band };
}
