// Assembles the engine's input from a visitor's answers, the roof and the
// installer's pricing. A faithful, framework-free port of SunScan v1's
// `src/app/api/[installerSlug]/journey/results/route.ts` (see PROVENANCE.md):
// the same fallback mappings, the same annual-consumption resolution and the
// same defaults. What differs is only where data comes from -- the roof from
// Sunny's SunScanV2 assessment instead of Google Solar, the catalogue from the
// tenant's pricing instead of Prisma.

import { DEFAULT_ANNUAL_KWH, TDCV_ELECTRICITY_KWH } from './consumption.js';
import { getIrradianceKwhPerM2, getZoneForPostcode } from './mcs.js';
import type { RoofType } from './pricing/types.js';
import type { OptionSetInput } from './recommend/optionTypes.js';
import { DEFAULT_ENGINE_ASSUMPTIONS, type TenantPricing } from './pricing-source.js';
import { getTariffForPostcode } from './tariff.js';

export type RoofConfidence = 'high' | 'medium' | 'low';

/** The roof as the engine needs it. */
export interface QuoteRoof {
  pitchDeg: number;
  /** MCS convention: degrees from due south (0 = S, 90 = E/W, 180 = N). */
  mcsOrientationDeg: number;
  maxPanelCount: number;
  roofType: RoofType;
  confidence: RoofConfidence;
}

/** The visitor's own roof answers, used only when the roof confidence is low. */
export interface QuoteRoofFallback {
  sizeBand: string | null;
  direction: string | null;
  shading: string | null;
}

export interface QuoteUsage {
  source: string | null;
  annualKwh: number | null;
  unitRatePence: number | null;
  exportTariffPence: number | null;
  monthlyCostGbp: number | null;
  householdSize: number | null;
}

export interface QuoteAnswers {
  postcode: string;
  roof: QuoteRoof;
  roofFallback?: QuoteRoofFallback;
  usage: QuoteUsage;
  tariffType?: string | null;
  lifestyle?: string[];
  motivation?: string | null;
  existing?: string | null;
  budgetBandId: string | null;
}

// Fallback roof-question mappings (only used when mapping confidence is low).
export const SIZE_BAND_PANELS: Readonly<Record<string, number>> = {
  small: 8,
  medium: 14,
  large: 22,
};
export const DIRECTION_MCS: Readonly<Record<string, number>> = {
  south: 0,
  south_east: 45,
  south_west: 45,
  east: 90,
  west: 90,
  east_west: 90,
  north: 180,
};
export const SHADING_LOSS: Readonly<Record<string, number>> = {
  none: 0.03,
  trees: 0.1,
  buildings: 0.12,
  heavy: 0.25,
};

export function resolveAnnualKwh(usage: QuoteUsage, importPence: number): number {
  if (usage.annualKwh && usage.annualKwh > 0) return usage.annualKwh;
  if (usage.source === 'monthly_cost' && usage.monthlyCostGbp && usage.monthlyCostGbp > 0) {
    const poundsPerKwh = (usage.unitRatePence ?? importPence) / 100;
    if (poundsPerKwh > 0) return Math.round((usage.monthlyCostGbp * 12) / poundsPerKwh);
  }
  if (usage.source === 'household' && usage.householdSize && usage.householdSize > 0) {
    if (usage.householdSize <= 2) return TDCV_ELECTRICITY_KWH.low;
    if (usage.householdSize === 3) return TDCV_ELECTRICITY_KWH.medium;
    return TDCV_ELECTRICITY_KWH.high;
  }
  return DEFAULT_ANNUAL_KWH;
}

/** Everything the engine needs, plus the derived values worth showing. */
export interface QuoteInputs {
  input: OptionSetInput;
  derived: {
    annualKwh: number;
    importPence: number;
    exportPence: number;
    regionName: string;
    mcsZone: string;
    irradianceKwhPerM2: number;
    shadingLoss: number;
    roofMaxPanels: number;
    mcsOrientationDeg: number;
    budgetMaxGbp: number;
  };
}

export function buildQuoteInput(answers: QuoteAnswers, pricing: TenantPricing): QuoteInputs {
  const a = { ...DEFAULT_ENGINE_ASSUMPTIONS, ...pricing.assumptions };

  // Tariff: bill-derived where available, else regional fallback.
  const regional = getTariffForPostcode(answers.postcode);
  const importPence = answers.usage.unitRatePence ?? regional.importPencePerKwh;
  const exportPence = answers.usage.exportTariffPence ?? regional.segExportPencePerKwh;

  // Geometry: trust the modelled roof, override from fallback answers when low-confidence.
  const pitchDeg = answers.roof.pitchDeg;
  let mcsOrientationDeg = answers.roof.mcsOrientationDeg;
  let maxPanelCount = answers.roof.maxPanelCount;
  let shadingLoss = a.shadingLoss;
  if (answers.roof.confidence === 'low' && answers.roofFallback) {
    const { sizeBand, direction, shading } = answers.roofFallback;
    if (sizeBand && SIZE_BAND_PANELS[sizeBand]) maxPanelCount = SIZE_BAND_PANELS[sizeBand];
    if (direction && direction in DIRECTION_MCS) mcsOrientationDeg = DIRECTION_MCS[direction]!;
    if (shading && shading in SHADING_LOSS) shadingLoss = SHADING_LOSS[shading]!;
  }

  const annualKwh = resolveAnnualKwh(answers.usage, importPence);
  const mcsZone = getZoneForPostcode(answers.postcode);
  const irradianceKwhPerM2 = getIrradianceKwhPerM2(mcsZone, pitchDeg, mcsOrientationDeg);

  // Budget band → upper bound (default generous when unknown).
  const budgetMaxGbp =
    pricing.budgetBands.find((x) => x.id === answers.budgetBandId)?.maxGbp ?? 30000;

  const roofMaxPanels = Math.max(1, maxPanelCount);
  const input: OptionSetInput = {
    catalogue: pricing.catalogue,
    roofMaxPanels,
    roofType: answers.roof.roofType,
    pitchDeg,
    mcsOrientationDeg,
    // Sunny's roof comes from the SunScanV2 LiDAR fit, not Google Solar, so the
    // engine takes its MCS-irradiance path.
    solarInsights: null,
    annualKwh,
    importTariffPence: importPence,
    exportTariffPence: exportPence,
    tariffType: answers.tariffType ?? 'unknown',
    lifestyle: answers.lifestyle ?? [],
    motivation: answers.motivation ?? null,
    existing: answers.existing ?? null,
    sentinelConfig: pricing.sentinel,
    mcsZone,
    irradianceKwhPerM2,
    shadingLoss,
    inverterLoss: a.inverterLoss,
    systemLoss: a.systemLoss,
    energyInflationRate: a.energyInflationRate,
    panelDegradationPerYear: a.panelDegradationPerYear,
    minPanels: a.minPanels,
    maxPanels: a.maxPanels,
    marginPercent: a.marginPercent,
    budgetMaxGbp,
  };
  return {
    input,
    derived: {
      annualKwh,
      importPence,
      exportPence,
      regionName: regional.regionName,
      mcsZone,
      irradianceKwhPerM2,
      shadingLoss,
      roofMaxPanels,
      mcsOrientationDeg,
      budgetMaxGbp,
    },
  };
}
