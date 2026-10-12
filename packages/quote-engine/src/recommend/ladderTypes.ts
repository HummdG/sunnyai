// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\ladderTypes.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type { SystemConfig } from '../pricing/types.js';
import type { SolarResults } from '../types.js';

/**
 * One discrete point on the budget ladder: a fully-priced, fully-modelled system
 * the slider can land on. Carries its complete `results` so the client never
 * recomputes (and the catalogue / installer margin never reach the browser).
 */
export interface BudgetStep {
  /** Stable id within a ladder (frontier prices are unique, so price-keyed). */
  id: string;
  /** Lowest budget (£) at which this step becomes the active recommendation. */
  thresholdGbp: number;
  /** Installed price incl. installer margin. */
  priceGbp: number;
  config: SystemConfig;
  panelCount: number;
  hasBattery: boolean;
  batteryKwh: number;
  systemKwp: number;
  /** Hero = `results.twentyFiveYearSavings.at(-1).cumulative`. */
  results: SolarResults;
  /** Named-tier label when this step is a tier stop target, else null. */
  label: string | null;
}

/** A named tier marker rendered as a labelled tick on the slider track. */
export interface TierStop {
  tier: 'essential' | 'standard' | 'premium';
  /** Id of the `BudgetStep` this tier maps to (nearest on the frontier by price). */
  stepId: string;
  priceGbp: number;
}

/**
 * The precomputed budget ladder shipped to the client. The slider maps a budget
 * value to an already-computed step instantly, with no per-drag network calls.
 */
export interface BudgetLadder {
  /** Frontier steps, ascending by price (== ascending objective by construction). */
  steps: BudgetStep[];
  tierStops: TierStop[];
  /** Slider lower bound = cheapest step price. */
  minGbp: number;
  /** Slider upper bound = most capable step price. */
  maxGbp: number;
  /** Initial slider position, derived from the homeowner's stated budget band. */
  initialGbp: number;
}
