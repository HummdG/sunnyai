// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\evaluateConfig.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PANEL,
  runSolarCalculations,
  runSolarCalculationsFromGoogleData,
} from '../solarCalculations.js';
import { computeQuote } from '../pricing/computeQuote.js';
import type { PricingCatalogue, PricingContext, SystemConfig } from '../pricing/types.js';
import type { PanelSpec, SolarAssumptions, SolarResults } from '../types.js';
import { computeSentinelUplift } from './sentinel.js';
import type { OptionSetInput } from './optionTypes.js';

// ─── Scoring (ported from the proven sales-branch engine) ────────────────────
// Primary objective: net 25-year value (£). Penalties nudge away from systems
// that pay back too slowly or export a lot of cheap surplus (i.e. oversized).
const PAYBACK_TARGET_YEARS = 12;
const PAYBACK_PENALTY_PER_YEAR = 150;
const EXPORT_PENALTY_PER_KWH = 0.04;

export function net25YearValue(r: SolarResults): number {
  const s = r.twentyFiveYearSavings;
  return s.length ? s[s.length - 1]!.cumulative : 0;
}

export function scoreOf(r: SolarResults): number {
  const paybackPenalty =
    Math.max(0, r.paybackYears - PAYBACK_TARGET_YEARS) * PAYBACK_PENALTY_PER_YEAR;
  const exportPenalty = r.exportKwh * EXPORT_PENALTY_PER_KWH;
  return net25YearValue(r) - paybackPenalty - exportPenalty;
}

function panelSpecFor(catalogue: PricingCatalogue, sku: string): PanelSpec {
  const p =
    catalogue.panels.find((x) => x.sku === sku) ??
    catalogue.panels.find((x) => x.isBase) ??
    catalogue.panels[0];
  if (!p) return DEFAULT_PANEL;
  return {
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    depthMm: p.depthMm,
    wattPeak: p.wattPeak,
    modelName: p.modelName,
  };
}

export function batteryKwhFor(catalogue: PricingCatalogue, config: SystemConfig): number {
  if (!config.battery) return 0;
  const b = catalogue.batteries.find((x) => x.sku === config.battery!.sku);
  if (!b) return 0;
  const expansion = (b.expansionCapacityKwh ?? 0) * (config.battery.expansionUnits ?? 0);
  return b.baseCapacityKwh + expansion;
}

/**
 * Tier-agnostic evaluation of a single fully-formed `SystemConfig`: prices it,
 * runs the solar model (Google modelled DC where available, else MCS), and
 * scores it. Shared by `buildOptionSet` (tier presets) and `buildBudgetLadder`
 * (arbitrary panel × battery combinations) so the Google/MCS branch, kWp and
 * sentinel scoring live in exactly one place. Pure — no I/O.
 */
export interface CandidateEval {
  config: SystemConfig;
  panelCount: number;
  systemKwp: number;
  priceGbp: number;
  hasBattery: boolean;
  batteryKwh: number;
  results: SolarResults;
  score: number;
  warnings: string[];
}

export function evaluateConfig(
  config: SystemConfig,
  input: OptionSetInput,
  ctx: PricingContext,
): CandidateEval {
  const count = config.panelCount;
  const quote = computeQuote(config, ctx);
  const priceGbp = Math.round(quote.totalPounds * (1 + input.marginPercent));

  const hasBattery = !!config.battery;
  const batteryKwh = batteryKwhFor(input.catalogue, config);

  const assumptions: SolarAssumptions = {
    ...DEFAULT_ASSUMPTIONS,
    roofPitchDeg: input.pitchDeg,
    roofOrientationDeg: input.mcsOrientationDeg,
    shadingLoss: input.shadingLoss,
    inverterLoss: input.inverterLoss,
    systemLoss: input.systemLoss,
    exportTariffPencePerKwh: input.exportTariffPence,
    energyInflationRate: input.energyInflationRate,
    panelDegradationPerYear: input.panelDegradationPerYear,
    hasBattery,
    batteryKwh,
    systemCostPounds: priceGbp,
  };

  const configs = input.solarInsights?.solarPotential.solarPanelConfigs;
  let results: SolarResults;
  if (configs && configs.length) {
    const ref = configs.reduce((best, c) =>
      Math.abs(c.panelsCount - count) < Math.abs(best.panelsCount - count) ? c : best,
    );
    const perPanelDc = ref.yearlyEnergyDcKwh / Math.max(1, ref.panelsCount);
    results = runSolarCalculationsFromGoogleData(
      perPanelDc * count,
      count,
      input.solarInsights!.solarPotential.panelCapacityWatts,
      input.annualKwh,
      input.importTariffPence,
      assumptions,
    );
  } else {
    results = runSolarCalculations(
      count,
      panelSpecFor(input.catalogue, config.panelSku),
      input.irradianceKwhPerM2,
      input.annualKwh,
      input.importTariffPence,
      assumptions,
    );
  }

  // kWp from the config's actual panel wattage so size differs by panel choice too.
  const panel = input.catalogue.panels.find((p) => p.sku === config.panelSku);
  const systemKwp = Math.round((count * (panel?.wattPeak ?? 430)) / 10) / 100;

  // A modest Sentinel-potential nudge: systems that unlock more optimisation
  // (battery + smart tariff + EV/heat-pump) score slightly higher.
  const uplift = computeSentinelUplift(
    hasBattery,
    input.tariffType,
    input.lifestyle,
    input.sentinelConfig,
  );
  const score = scoreOf(results) + uplift * net25YearValue(results) * 0.25;

  return {
    config,
    panelCount: count,
    systemKwp,
    hasBattery,
    batteryKwh,
    priceGbp,
    results,
    score,
    warnings: quote.warnings,
  };
}
