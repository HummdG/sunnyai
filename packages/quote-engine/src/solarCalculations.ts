// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\solarCalculations.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type { PanelSpec, SolarAssumptions, SolarResults } from './types.js';

// ─── Default constants ────────────────────────────────────────────────────────

export const DEFAULT_PANEL: PanelSpec = {
  widthMm: 1134,
  heightMm: 1722,
  depthMm: 30,
  wattPeak: 430,
  modelName: 'Generic 430W Monocrystalline',
};

export const DEFAULT_ASSUMPTIONS: SolarAssumptions = {
  roofPitchDeg: 35,
  roofOrientationDeg: 0, // 0 = South (MCS convention)
  shadingLoss: 0.05,
  inverterLoss: 0.03,
  systemLoss: 0.1,
  systemCostPounds: 8500,
  hasBattery: false,
  batteryKwh: 5.2,
  exportTariffPencePerKwh: 15, // SEG rate
  energyInflationRate: 0.03,
  panelDegradationPerYear: 0.005, // MCS standard
};

// UK grid carbon intensity (2024 figure, DESNZ)
const UK_GRID_CARBON_KG_PER_KWH = 0.233;

// Seasonal monthly weighting for annual generation distribution
// (exported for Sunny's month-by-month savings timeline; values unchanged)
// Weights sum to 1.0, based on typical UK solar irradiance profile
export const MONTHLY_GEN_WEIGHTS = [
  0.03, // Jan
  0.05, // Feb
  0.08, // Mar
  0.1, // Apr
  0.125, // May
  0.13, // Jun
  0.12, // Jul
  0.11, // Aug
  0.09, // Sep
  0.065, // Oct
  0.05, // Nov
  0.03, // Dec
];

// Typical UK domestic electricity consumption — heavier in winter.
// Source: BEIS/NEED 2023 anonymised half-hourly profiles, averaged.
export const MONTHLY_CONSUMPTION_WEIGHTS = [
  0.11, // Jan
  0.095, // Feb
  0.09, // Mar
  0.08, // Apr
  0.07, // May
  0.06, // Jun
  0.055, // Jul
  0.055, // Aug
  0.07, // Sep
  0.085, // Oct
  0.105, // Nov
  0.125, // Dec
];

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Fraction of daily generation that is consumed directly during daylight hours
// for a typical UK household (occupants often away during the day).
export const DAY_USE_RATIO = 0.25;

// ─── Core formulas ────────────────────────────────────────────────────────────

export function calcSystemSizeKw(panelCount: number, panel: PanelSpec): number {
  return (panelCount * panel.wattPeak) / 1000;
}

/**
 * MCS annual generation estimate.
 * annualGenKwh = systemKwp × irradianceKwhPerM2 × performanceRatio
 * performanceRatio = (1 - shadingLoss) × (1 - inverterLoss) × (1 - systemLoss)
 */
export function calcAnnualGeneration(
  systemSizeKw: number,
  irradianceKwhPerM2: number,
  assumptions: Pick<SolarAssumptions, 'shadingLoss' | 'inverterLoss' | 'systemLoss'>,
): number {
  const pr =
    (1 - assumptions.shadingLoss) * (1 - assumptions.inverterLoss) * (1 - assumptions.systemLoss);
  return systemSizeKw * irradianceKwhPerM2 * pr;
}

/**
 * Monthly-aware self-consumption model.
 * For each month: direct daytime consumption is min(monthlyGen × DAY_USE_RATIO, monthlyDemand).
 * If a battery is present, surplus daytime generation is stored and discharged in the evening,
 * bounded by the battery's monthly throughput and the remaining evening demand.
 */
export function calcSelfConsumption(
  annualGenKwh: number,
  annualDemandKwh: number,
  hasBattery: boolean,
  batteryKwh: number = 0,
): { selfConsumptionKwh: number; exportKwh: number; selfConsumptionRate: number } {
  if (annualGenKwh <= 0) {
    return { selfConsumptionKwh: 0, exportKwh: 0, selfConsumptionRate: 0 };
  }

  let totalSelfCons = 0;
  for (let i = 0; i < 12; i++) {
    const monthlyGen = annualGenKwh * MONTHLY_GEN_WEIGHTS[i]!;
    const monthlyDemand = annualDemandKwh * MONTHLY_CONSUMPTION_WEIGHTS[i]!;
    const daysInMonth = DAYS_IN_MONTH[i]!;

    const direct = Math.min(monthlyGen * DAY_USE_RATIO, monthlyDemand);

    let batteryShift = 0;
    if (hasBattery && batteryKwh > 0) {
      const surplus = monthlyGen - direct;
      const eveningDemand = Math.max(0, monthlyDemand - direct);
      // Battery roundtrip efficiency ~90%; one full cycle per day.
      const monthlyBatteryThroughput = batteryKwh * daysInMonth * 0.9;
      batteryShift = Math.min(surplus, monthlyBatteryThroughput, eveningDemand);
    }

    totalSelfCons += direct + batteryShift;
  }

  const selfConsumptionKwh = Math.min(totalSelfCons, annualGenKwh, annualDemandKwh);
  const exportKwh = Math.max(0, annualGenKwh - selfConsumptionKwh);
  const selfConsumptionRate = selfConsumptionKwh / annualGenKwh;
  return { selfConsumptionKwh, exportKwh, selfConsumptionRate };
}

export function calcAnnualSavings(
  selfConsumptionKwh: number,
  exportKwh: number,
  tariffPencePerKwh: number,
  exportTariffPencePerKwh: number,
): number {
  const importSaving = (selfConsumptionKwh * tariffPencePerKwh) / 100;
  const exportEarning = (exportKwh * exportTariffPencePerKwh) / 100;
  return importSaving + exportEarning;
}

export function calcPayback(systemCostPounds: number, annualSavingsPounds: number): number {
  if (annualSavingsPounds <= 0) return 99;
  return systemCostPounds / annualSavingsPounds;
}

export function calcCo2Saved(annualGenKwh: number): number {
  return (annualGenKwh * UK_GRID_CARBON_KG_PER_KWH) / 1000; // tonnes
}

export function calcMonthlyGenProfile(annualGenKwh: number): number[] {
  return MONTHLY_GEN_WEIGHTS.map((w) => Math.round(annualGenKwh * w));
}

/**
 * 25-year savings curve with linear panel degradation and energy price inflation.
 * Year n generation = baseGen × (1 − degradation × (n − 1))
 * Year n savings    = (selfCons × tariff + export × exportTariff) × (1 + inflation)^(n − 1)
 */
export function calc25YearSavings(
  baseAnnualGenKwh: number,
  selfConsumptionRate: number,
  tariffPencePerKwh: number,
  exportTariffPencePerKwh: number,
  systemCostPounds: number,
  inflationRate: number = 0.03,
  degradationPerYear: number = 0.005,
): { year: number; saving: number; cumulative: number }[] {
  const result: { year: number; saving: number; cumulative: number }[] = [];
  let cumulative = -systemCostPounds;
  for (let year = 1; year <= 25; year++) {
    const degradationFactor = Math.max(0, 1 - degradationPerYear * (year - 1));
    const genThisYear = baseAnnualGenKwh * degradationFactor;
    const selfKwh = genThisYear * selfConsumptionRate;
    const exportKwh = Math.max(0, genThisYear - selfKwh);
    const inflationFactor = Math.pow(1 + inflationRate, year - 1);
    const saving =
      ((selfKwh * tariffPencePerKwh + exportKwh * exportTariffPencePerKwh) / 100) * inflationFactor;
    cumulative += saving;
    result.push({ year, saving: Math.round(saving), cumulative: Math.round(cumulative) });
  }
  return result;
}

/**
 * Google Solar API override: accepts pre-computed DC generation from Google's models.
 * Shading is already modelled by Google — only apply inverter + system losses.
 */
export function runSolarCalculationsFromGoogleData(
  yearlyEnergyDcKwh: number,
  panelCount: number,
  panelCapacityWatts: number,
  annualDemandKwh: number,
  tariffPencePerKwh: number,
  assumptions: SolarAssumptions,
): SolarResults {
  const pr = (1 - assumptions.inverterLoss) * (1 - assumptions.systemLoss);
  const annualGenerationKwh = yearlyEnergyDcKwh * pr;
  const { selfConsumptionKwh, exportKwh, selfConsumptionRate } = calcSelfConsumption(
    annualGenerationKwh,
    annualDemandKwh,
    assumptions.hasBattery,
    assumptions.batteryKwh,
  );
  const annualSavingsPounds = calcAnnualSavings(
    selfConsumptionKwh,
    exportKwh,
    tariffPencePerKwh,
    assumptions.exportTariffPencePerKwh,
  );
  const paybackYears = calcPayback(assumptions.systemCostPounds, annualSavingsPounds);
  const co2SavedTonnesPerYear = calcCo2Saved(annualGenerationKwh);
  const monthlyGenKwh = calcMonthlyGenProfile(annualGenerationKwh);
  const twentyFiveYearSavings = calc25YearSavings(
    annualGenerationKwh,
    selfConsumptionRate,
    tariffPencePerKwh,
    assumptions.exportTariffPencePerKwh,
    assumptions.systemCostPounds,
    assumptions.energyInflationRate ?? 0.03,
    assumptions.panelDegradationPerYear ?? 0.005,
  );

  void panelCapacityWatts; // available for future system size display

  return {
    annualGenerationKwh: Math.round(annualGenerationKwh),
    selfConsumptionKwh: Math.round(selfConsumptionKwh),
    exportKwh: Math.round(exportKwh),
    selfConsumptionRate,
    annualSavingsPounds: Math.round(annualSavingsPounds),
    paybackYears: Math.round(paybackYears * 10) / 10,
    co2SavedTonnesPerYear: Math.round(co2SavedTonnesPerYear * 100) / 100,
    monthlyGenKwh,
    twentyFiveYearSavings,
  };
}

/**
 * Master function: given all inputs, return all SolarResults.
 * `tariffPencePerKwh` MUST come from the user's bill (OCR or manual entry) — no defaults.
 */
export function runSolarCalculations(
  panelCount: number,
  panel: PanelSpec,
  irradianceKwhPerM2: number,
  annualDemandKwh: number,
  tariffPencePerKwh: number,
  assumptions: SolarAssumptions,
): SolarResults {
  const systemSizeKw = calcSystemSizeKw(panelCount, panel);
  const annualGenerationKwh = calcAnnualGeneration(systemSizeKw, irradianceKwhPerM2, assumptions);
  const { selfConsumptionKwh, exportKwh, selfConsumptionRate } = calcSelfConsumption(
    annualGenerationKwh,
    annualDemandKwh,
    assumptions.hasBattery,
    assumptions.batteryKwh,
  );
  const annualSavingsPounds = calcAnnualSavings(
    selfConsumptionKwh,
    exportKwh,
    tariffPencePerKwh,
    assumptions.exportTariffPencePerKwh,
  );
  const paybackYears = calcPayback(assumptions.systemCostPounds, annualSavingsPounds);
  const co2SavedTonnesPerYear = calcCo2Saved(annualGenerationKwh);
  const monthlyGenKwh = calcMonthlyGenProfile(annualGenerationKwh);
  const twentyFiveYearSavings = calc25YearSavings(
    annualGenerationKwh,
    selfConsumptionRate,
    tariffPencePerKwh,
    assumptions.exportTariffPencePerKwh,
    assumptions.systemCostPounds,
    assumptions.energyInflationRate ?? 0.03,
    assumptions.panelDegradationPerYear ?? 0.005,
  );

  return {
    annualGenerationKwh: Math.round(annualGenerationKwh),
    selfConsumptionKwh: Math.round(selfConsumptionKwh),
    exportKwh: Math.round(exportKwh),
    selfConsumptionRate,
    annualSavingsPounds: Math.round(annualSavingsPounds),
    paybackYears: Math.round(paybackYears * 10) / 10,
    co2SavedTonnesPerYear: Math.round(co2SavedTonnesPerYear * 100) / 100,
    monthlyGenKwh,
    twentyFiveYearSavings,
  };
}
