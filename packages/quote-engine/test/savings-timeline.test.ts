import { describe, expect, it } from 'vitest';

import {
  buildSavingsTimeline,
  calc25YearSavings,
  calcAnnualSavings,
  calcSelfConsumption,
  runSolarCalculations,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PANEL,
  savingsTimelineForOption,
  type SavingsTimelineInput,
} from '../src/index.js';

const base: SavingsTimelineInput = {
  annualGenerationKwh: 3659,
  annualDemandKwh: 3500,
  hasBattery: true,
  batteryKwh: 10.24,
  tariffPencePerKwh: 27,
  exportTariffPencePerKwh: 15,
  systemCostPounds: 13810,
};

function engineYear1(input: SavingsTimelineInput): number {
  const sc = calcSelfConsumption(
    input.annualGenerationKwh,
    input.annualDemandKwh,
    input.hasBattery,
    input.batteryKwh,
  );
  return calcAnnualSavings(
    sc.selfConsumptionKwh,
    sc.exportKwh,
    input.tariffPencePerKwh,
    input.exportTariffPencePerKwh,
  );
}

describe('savings timeline', () => {
  it('has twelve months that add up exactly to the year-1 total', () => {
    const t = buildSavingsTimeline(base);
    expect(t.months).toHaveLength(12);
    expect(t.months.map((m) => m.month)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
    const sum = t.months.reduce((a, m) => a + m.savingsGbp, 0);
    expect(sum).toBe(t.year1TotalGbp);
    expect(t.months[11]!.cumulativeGbp).toBe(t.year1TotalGbp);
  });

  it("matches the engine's own annual savings within £1", () => {
    for (const input of [
      base,
      { ...base, hasBattery: false, batteryKwh: 0 },
      { ...base, annualGenerationKwh: 2177, annualDemandKwh: 5200 },
      { ...base, annualGenerationKwh: 6000, annualDemandKwh: 1800 },
    ]) {
      const t = buildSavingsTimeline(input);
      expect(Math.abs(t.year1TotalGbp - engineYear1(input))).toBeLessThanOrEqual(1);
    }
  });

  it('saves more in summer than in winter', () => {
    const t = buildSavingsTimeline(base);
    const june = t.months[5]!.savingsGbp;
    const december = t.months[11]!.savingsGbp;
    expect(june).toBeGreaterThan(december);
    expect(t.months[5]!.generationKwh).toBeGreaterThan(t.months[0]!.generationKwh);
  });

  it('reports the same 25-year total as calc25YearSavings', () => {
    const t = buildSavingsTimeline(base);
    const sc = calcSelfConsumption(
      base.annualGenerationKwh,
      base.annualDemandKwh,
      base.hasBattery,
      base.batteryKwh,
    );
    const curve = calc25YearSavings(
      base.annualGenerationKwh,
      sc.selfConsumptionRate,
      base.tariffPencePerKwh,
      base.exportTariffPencePerKwh,
      base.systemCostPounds!,
    );
    expect(t.twentyFiveYearTotalGbp).toBe(curve.reduce((a, y) => a + y.saving, 0));
    // Net of the package price, it is the curve's final cumulative figure (±£1
    // for the curve's own per-year rounding).
    expect(Math.abs(t.twentyFiveYearNetGbp! - curve[24]!.cumulative)).toBeLessThanOrEqual(13);
    expect(t.years).toHaveLength(25);
  });

  it('records the assumptions it used and labels itself indicative', () => {
    const t = buildSavingsTimeline(base);
    expect(t.label).toBe('indicative');
    expect(t.assumptions.energyInflationRate).toBe(0.03);
    expect(t.assumptions.panelDegradationPerYear).toBe(0.005);
    const custom = buildSavingsTimeline({ ...base, energyInflationRate: 0.05 });
    expect(custom.assumptions.energyInflationRate).toBe(0.05);
    expect(custom.twentyFiveYearTotalGbp).toBeGreaterThan(t.twentyFiveYearTotalGbp);
  });

  it('is deterministic', () => {
    expect(buildSavingsTimeline(base)).toEqual(buildSavingsTimeline(base));
  });

  it('gives no net figure when the price is not known, and zeros for no generation', () => {
    const { systemCostPounds: _omit, ...unpriced } = base;
    expect(buildSavingsTimeline(unpriced).twentyFiveYearNetGbp).toBeNull();
    const none = buildSavingsTimeline({ ...base, annualGenerationKwh: 0 });
    expect(none.year1TotalGbp).toBe(0);
    expect(none.months.every((m) => m.savingsGbp === 0)).toBe(true);
  });

  it('builds the timeline for a quote option from the inputs the quote used', () => {
    const results = runSolarCalculations(11, DEFAULT_PANEL, 950, 3500, 27, {
      ...DEFAULT_ASSUMPTIONS,
      hasBattery: false,
    });
    const t = savingsTimelineForOption(
      { results, batteryCapacityKwh: 0, batteryType: null, priceGbp: 9848 },
      { annualKwh: 3500, importTariffPence: 27, exportTariffPence: 15 },
    );
    expect(Math.abs(t.year1TotalGbp - results.annualSavingsPounds)).toBeLessThanOrEqual(1);
    expect(t.twentyFiveYearNetGbp).not.toBeNull();
  });
});
