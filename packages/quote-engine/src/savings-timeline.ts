/**
 * The month-by-month savings timeline behind the "watch your package save you
 * money" simulation.
 *
 * It splits the engine's own year-1 savings into months using the engine's
 * own monthly model -- the same generation and consumption weights, daytime
 * use ratio and battery throughput `calcSelfConsumption` uses -- so the twelve
 * months add up to the figure on the quote card, and the 25-year total is
 * exactly what `calc25YearSavings` reports. Nothing here re-derives physics:
 * it only apportions the annual result across the year.
 *
 * Every figure is indicative and subject to a survey.
 */

import type { OptionResult } from './recommend/optionTypes.js';
import {
  calc25YearSavings,
  calcAnnualSavings,
  calcSelfConsumption,
  DAY_USE_RATIO,
  DAYS_IN_MONTH,
  DEFAULT_ASSUMPTIONS,
  MONTHLY_CONSUMPTION_WEIGHTS,
  MONTHLY_GEN_WEIGHTS,
} from './solarCalculations.js';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface SavingsTimelineInput {
  /** The package's year-1 generation, kWh. */
  annualGenerationKwh: number;
  /** The household's annual electricity use, kWh. */
  annualDemandKwh: number;
  hasBattery: boolean;
  batteryKwh: number;
  /** Import tariff the visitor pays, pence per kWh. */
  tariffPencePerKwh: number;
  /** Export (SEG) rate, pence per kWh. */
  exportTariffPencePerKwh: number;
  /** The package price, for the net 25-year figure. Optional. */
  systemCostPounds?: number;
  /** Annual energy price inflation (0–1). Defaults to the engine's 3%. */
  energyInflationRate?: number;
  /** Annual panel degradation (0–1). Defaults to the engine's 0.5%. */
  panelDegradationPerYear?: number;
}

export interface SavingsMonth {
  /** 0 = January. */
  index: number;
  /** Short name, e.g. "Mar". */
  month: string;
  /** Full name, e.g. "March". */
  monthName: string;
  generationKwh: number;
  /** Electricity used straight from the panels or the battery, kWh. */
  selfConsumedKwh: number;
  exportedKwh: number;
  /** Whole pounds; the twelve months add up to `year1TotalGbp`. */
  savingsGbp: number;
  /** Running total to the end of this month, whole pounds. */
  cumulativeGbp: number;
}

export interface SavingsTimeline {
  months: SavingsMonth[];
  year1TotalGbp: number;
  /** Sum of the 25 yearly savings (before the package price). */
  twentyFiveYearTotalGbp: number;
  /** The 25-year total minus the package price, when the price is known. */
  twentyFiveYearNetGbp: number | null;
  years: { year: number; savingGbp: number }[];
  assumptions: {
    energyInflationRate: number;
    panelDegradationPerYear: number;
    tariffPencePerKwh: number;
    exportTariffPencePerKwh: number;
    annualDemandKwh: number;
    hasBattery: boolean;
  };
  label: 'indicative';
}

/**
 * Split whole pounds across months so they add up exactly to `total`
 * (largest-remainder rounding), keeping each month as close as possible to its
 * true value.
 */
function apportion(values: number[], total: number): number[] {
  const floors = values.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    out[order[k]!.i]! += 1;
  }
  return out;
}

export function buildSavingsTimeline(input: SavingsTimelineInput): SavingsTimeline {
  const inflation = input.energyInflationRate ?? DEFAULT_ASSUMPTIONS.energyInflationRate ?? 0.03;
  const degradation =
    input.panelDegradationPerYear ?? DEFAULT_ASSUMPTIONS.panelDegradationPerYear ?? 0.005;
  const gen = Math.max(0, input.annualGenerationKwh);
  const demand = Math.max(0, input.annualDemandKwh);

  // The engine's annual result, which the months must add up to.
  const annual = calcSelfConsumption(gen, demand, input.hasBattery, input.batteryKwh);
  const annualSavings = calcAnnualSavings(
    annual.selfConsumptionKwh,
    annual.exportKwh,
    input.tariffPencePerKwh,
    input.exportTariffPencePerKwh,
  );

  // The same monthly model calcSelfConsumption sums internally. Note SunScan
  // v1's generation weights add up to 0.98, not 1: the self-consumption below
  // uses them exactly as the engine does, but the month's *generation* is
  // spread with the weights normalised to 1, so the twelve months cover the
  // whole year's generation (and its export) as the annual figure does.
  const weightSum = MONTHLY_GEN_WEIGHTS.reduce((a, w) => a + w, 0);
  const raw = MONTHLY_GEN_WEIGHTS.map((weight, i) => {
    const engineGen = gen * weight;
    const monthlyGen = weightSum > 0 ? (gen * weight) / weightSum : 0;
    const monthlyDemand = demand * MONTHLY_CONSUMPTION_WEIGHTS[i]!;
    const direct = Math.min(engineGen * DAY_USE_RATIO, monthlyDemand);
    let shift = 0;
    if (input.hasBattery && input.batteryKwh > 0) {
      const surplus = engineGen - direct;
      const evening = Math.max(0, monthlyDemand - direct);
      shift = Math.min(surplus, input.batteryKwh * DAYS_IN_MONTH[i]! * 0.9, evening);
    }
    return { monthlyGen, self: direct + shift };
  });
  // The engine clamps the annual total (to generation and demand); scale the
  // months by the same factor so they reconcile with it exactly.
  const rawSelf = raw.reduce((a, m) => a + m.self, 0);
  const scale = rawSelf > 0 ? annual.selfConsumptionKwh / rawSelf : 0;

  const monthly = raw.map((m) => {
    const self = m.self * scale;
    const exported = Math.max(0, m.monthlyGen - self);
    const savings = calcAnnualSavings(
      self,
      exported,
      input.tariffPencePerKwh,
      input.exportTariffPencePerKwh,
    );
    return { gen: m.monthlyGen, self, exported, savings };
  });

  const year1TotalGbp = Math.round(annualSavings);
  const pounds = apportion(
    monthly.map((m) => m.savings),
    year1TotalGbp,
  );
  let running = 0;
  const months: SavingsMonth[] = monthly.map((m, index) => {
    running += pounds[index]!;
    const monthName = MONTH_NAMES[index]!;
    return {
      index,
      month: monthName.slice(0, 3),
      monthName,
      generationKwh: Math.round(m.gen),
      selfConsumedKwh: Math.round(m.self),
      exportedKwh: Math.round(m.exported),
      savingsGbp: pounds[index]!,
      cumulativeGbp: running,
    };
  });

  const curve = calc25YearSavings(
    gen,
    annual.selfConsumptionRate,
    input.tariffPencePerKwh,
    input.exportTariffPencePerKwh,
    input.systemCostPounds ?? 0,
    inflation,
    degradation,
  );
  const twentyFiveYearTotalGbp = curve.reduce((a, y) => a + y.saving, 0);

  return {
    months,
    year1TotalGbp,
    twentyFiveYearTotalGbp,
    twentyFiveYearNetGbp:
      input.systemCostPounds !== undefined && input.systemCostPounds > 0
        ? twentyFiveYearTotalGbp - Math.round(input.systemCostPounds)
        : null,
    years: curve.map((y) => ({ year: y.year, savingGbp: y.saving })),
    assumptions: {
      energyInflationRate: inflation,
      panelDegradationPerYear: degradation,
      tariffPencePerKwh: input.tariffPencePerKwh,
      exportTariffPencePerKwh: input.exportTariffPencePerKwh,
      annualDemandKwh: demand,
      hasBattery: input.hasBattery,
    },
    label: 'indicative',
  };
}

/** The timeline for one option of a quote, from the inputs the quote used. */
export function savingsTimelineForOption(
  option: Pick<OptionResult, 'results' | 'batteryCapacityKwh' | 'batteryType' | 'priceGbp'>,
  context: {
    annualKwh: number;
    importTariffPence: number;
    exportTariffPence: number;
    energyInflationRate?: number;
    panelDegradationPerYear?: number;
  },
): SavingsTimeline {
  const hasBattery = option.batteryType !== null && option.batteryCapacityKwh > 0;
  return buildSavingsTimeline({
    annualGenerationKwh: option.results.annualGenerationKwh,
    annualDemandKwh: context.annualKwh,
    hasBattery,
    batteryKwh: hasBattery ? option.batteryCapacityKwh : 0,
    tariffPencePerKwh: context.importTariffPence,
    exportTariffPencePerKwh: context.exportTariffPence,
    ...(option.priceGbp > 0 ? { systemCostPounds: option.priceGbp } : {}),
    ...(context.energyInflationRate !== undefined
      ? { energyInflationRate: context.energyInflationRate }
      : {}),
    ...(context.panelDegradationPerYear !== undefined
      ? { panelDegradationPerYear: context.panelDegradationPerYear }
      : {}),
  });
}
