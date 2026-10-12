// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\optionTypes.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type { GoogleSolarBuildingInsights, SolarResults } from '../types.js';
import type { PricingCatalogue, RoofType, SystemConfig, Tier } from '../pricing/types.js';
import type { SentinelConfig, SentinelResult } from './sentinel.js';
import type { BudgetLadder } from './ladderTypes.js';

export type PresetTier = Exclude<Tier, 'custom'>;
export type OptionKind = 'budget_fit' | 'better_value' | 'recommended';

/** One presented system option (one column of the results comparison table). */
export interface OptionResult {
  id: OptionKind;
  kind: OptionKind;
  label: string; // 'Budget-fit' | 'Better value' | 'Recommended'
  isRecommended: boolean;
  tier: PresetTier;
  config: SystemConfig;
  panelCount: number;
  panelType: string;
  inverterType: string;
  batteryType: string | null;
  batteryCapacityKwh: number;
  systemKwp: number;
  priceGbp: number;
  results: SolarResults;
  sentinel: SentinelResult;
  inclusions: string[];
  /** Short benefit framing distinct per tier (e.g. "Lowest upfront cost"). */
  headline: string;
  bestSuitedTo: string;
  nextStep: string;
  score: number;
  warnings: string[];
  /** Even the smallest option exceeds the stated budget. */
  aboveBudget: boolean;
  /** Sizing was capped by the roof rather than the budget. */
  roofLimited: boolean;
}

export interface OptionSetContext {
  mcsZone: string;
  irradianceKwhPerM2: number;
  annualKwh: number;
  roofMaxPanels: number;
  budgetMaxGbp: number;
}

export interface OptionSet {
  /** Exactly 3 distinct options, ordered by price ascending. */
  options: OptionResult[];
  recommendedId: OptionKind;
  context: OptionSetContext;
  warnings: string[];
  /**
   * Continuous budget ladder for the slider — a single recommended system that
   * morphs as the budget changes. Optional so existing consumers (lead route,
   * tests) remain valid; populated by `buildOptionSet`.
   */
  ladder?: BudgetLadder;
}

/**
 * Everything the pure engine needs — all I/O (catalogue load, MCS / tariff /
 * consumption lookup) happens upstream in the results route.
 */
export interface OptionSetInput {
  catalogue: PricingCatalogue;
  roofMaxPanels: number;
  roofType: RoofType;
  pitchDeg: number;
  mcsOrientationDeg: number;
  /** Present → use Google's modelled DC generation; absent → MCS irradiance path. */
  solarInsights: GoogleSolarBuildingInsights | null;
  annualKwh: number;
  importTariffPence: number;
  exportTariffPence: number;
  /** Homeowner tariff type + lifestyle tags — drive the Sentinel uplift. */
  tariffType: string;
  lifestyle: string[];
  /** Homeowner goal + existing system — feed the ladder's battery affinity. */
  motivation: string | null;
  existing: string | null;
  sentinelConfig: SentinelConfig | null;
  mcsZone: string;
  irradianceKwhPerM2: number;
  shadingLoss: number;
  inverterLoss: number;
  systemLoss: number;
  energyInflationRate: number;
  panelDegradationPerYear: number;
  minPanels: number;
  maxPanels: number;
  marginPercent: number;
  /** Upper bound of the homeowner's stated budget band. */
  budgetMaxGbp: number;
}
