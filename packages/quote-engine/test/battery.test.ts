import { describe, expect, it } from 'vitest';

import {
  BATTERY_DISCLAIMER,
  BATTERY_RETROFIT_VAT_PERCENT,
  batteryEstimate,
  calcSelfConsumption,
  getTariffForPostcode,
  type BatteryGoal,
  type BatteryInput,
  type BatteryTariff,
} from '../src/index.js';

const usage = (annualKwh: number | null) => ({
  source: 'annual_kwh',
  annualKwh,
  unitRatePence: null,
  exportTariffPence: null,
  monthlyCostGbp: null,
  householdSize: null,
});

const base = (over: Partial<BatteryInput> = {}): BatteryInput => ({
  postcode: 'NR4 7TJ',
  pvKwp: 4,
  panelCount: null,
  usage: usage(3200),
  tariff: 'standard',
  lifestyle: [],
  goal: 'savings',
  ...over,
});

describe('batteryEstimate', () => {
  it('golden: 4 kWp, 3200 kWh, standard tariff at NR4 7TJ', () => {
    const e = batteryEstimate(base());
    const { importPencePerKwh: imp, segExportPencePerKwh: exp } = getTariffForPostcode('NR4 7TJ');
    const gen = 4 * 950; // 3800
    const use = 3200;
    const direct = calcSelfConsumption(gen, use, false).selfConsumptionKwh;
    expect(e.pvKwp).toBe(4);
    expect(e.pvKwpAssumed).toBe(false);
    expect(e.annualGenerationKwh).toBe(gen);
    expect(e.annualUseKwh).toBe(use);
    expect(e.importPence).toBe(imp);
    expect(e.exportPence).toBe(exp);
    expect(e.offPeakPence).toBeNull();

    // recommended: min(daily surplus, daily evening need), nearest 0.5, clamp 2.5..20
    const surplus = Math.max(0, (gen - direct) / 365);
    const evening = (use * 0.6) / 365;
    const expectedRec = Math.min(20, Math.max(2.5, Math.round(Math.min(surplus, evening) * 2) / 2));
    expect(e.recommendedKwh).toBe(expectedRec);

    const s = e.sizing(5);
    const extra = Math.max(0, calcSelfConsumption(gen, use, true, 5).selfConsumptionKwh - direct);
    expect(s.capacityKwh).toBe(5);
    expect(s.extraSelfUseKwh).toBe(Math.round(extra));
    expect(s.selfUseSavingGbp).toBe(Math.round((extra * (imp - exp)) / 100));
    expect(s.shiftKwh).toBe(0);
    expect(s.shiftSavingGbp).toBe(0);
    expect(s.annualSavingGbp).toBe(s.selfUseSavingGbp);
    expect(s.extraSelfUseKwh).toBeGreaterThan(0);
  });

  it('smart_tou gives a shift saving, standard gives none', () => {
    expect(batteryEstimate(base({ tariff: 'smart_tou' })).sizing(5).shiftSavingGbp).toBeGreaterThan(
      0,
    );
    expect(batteryEstimate(base({ tariff: 'economy7' })).sizing(5).shiftSavingGbp).toBeGreaterThan(
      0,
    );
    expect(batteryEstimate(base({ tariff: 'standard' })).sizing(5).shiftSavingGbp).toBe(0);
  });

  it('shift saving follows the rule', () => {
    const e = batteryEstimate(base({ tariff: 'smart_tou' }));
    const s = e.sizing(5);
    const gen = 3800;
    const use = 3200;
    const direct = calcSelfConsumption(gen, use, false).selfConsumptionKwh;
    const extra = Math.max(0, calcSelfConsumption(gen, use, true, 5).selfConsumptionKwh - direct);
    const spare = Math.max(0, 5 * 365 * 0.9 - extra);
    const shift = Math.min(spare, Math.max(0, Math.min(use * 0.75, use - direct) - extra));
    expect(s.shiftKwh).toBe(Math.round(shift));
    expect(s.shiftSavingGbp).toBe(Math.round((shift * (e.peakPence! - e.offPeakPence!)) / 100));
  });

  it('golden: 4 kWp, 3000 kWh, smart_tou, 10 kWh', () => {
    const e = batteryEstimate(base({ tariff: 'smart_tou', usage: usage(3000) }));
    const { segExportPencePerKwh: exp } = getTariffForPostcode('NR4 7TJ');
    const gen = 3800;
    const use = 3000;
    const [peak, cheap] = [28, 8];
    const direct = calcSelfConsumption(gen, use, false).selfConsumptionKwh;
    const extra = Math.max(0, calcSelfConsumption(gen, use, true, 10).selfConsumptionKwh - direct);
    const spare = Math.max(0, 10 * 365 * 0.9 - extra);
    const shift = Math.min(spare, Math.max(0, Math.min(use * 0.75, use - direct) - extra));
    const selfUse = Math.round((extra * (peak - exp)) / 100);
    const shiftGbp = Math.round((shift * (peak - cheap)) / 100);
    const s = e.sizing(10);
    expect(s.extraSelfUseKwh).toBe(Math.round(extra));
    expect(s.shiftKwh).toBe(Math.round(shift));
    expect(s.selfUseSavingGbp).toBe(selfUse);
    expect(s.shiftSavingGbp).toBe(shiftGbp);
    expect(s.annualSavingGbp).toBe(selfUse + shiftGbp);
    // Never more energy than the home uses.
    expect(direct + extra + shift).toBeLessThanOrEqual(use + 1e-9);
    expect(s.shiftKwh).toBeGreaterThan(0);
  });

  it('never counts more energy than the home uses, across tariffs, sizes and usage', () => {
    const tariffs: BatteryTariff[] = [
      'standard',
      'economy7',
      'smart_tou',
      'import_export',
      'already_exports',
      'unknown',
    ];
    for (const tariff of tariffs)
      for (const goal of ['savings', 'cheap_rate'] as BatteryGoal[])
        for (const pvKwp of [1, 4, 8, 16, 25])
          for (const kwh of [500, 1500, 3000, 6000, 12000, 30000])
            for (const cap of [2.5, 5, 10, 13.5, 20, 40]) {
              const e = batteryEstimate(base({ tariff, goal, pvKwp, usage: usage(kwh) }));
              const gen = e.annualGenerationKwh;
              const use = e.annualUseKwh;
              const direct = calcSelfConsumption(gen, use, false).selfConsumptionKwh;
              const extra = Math.max(
                0,
                calcSelfConsumption(gen, use, true, cap).selfConsumptionKwh - direct,
              );
              const s = e.sizing(cap);
              // The rounded figures and the exact ones both stay within the home's use.
              expect(
                direct + extra + s.shiftKwh,
                `${tariff} ${pvKwp} ${kwh} ${cap}`,
              ).toBeLessThanOrEqual(use + 1);
              expect(Math.round(direct) + s.extraSelfUseKwh + s.shiftKwh).toBeLessThanOrEqual(
                use + 2,
              );
            }
  });

  it('values self-use at the peak rate on a time-of-use tariff', () => {
    const { importPencePerKwh: imp, segExportPencePerKwh: exp } = getTariffForPostcode('NR4 7TJ');
    for (const [tariff, peak] of [
      ['economy7', 30],
      ['smart_tou', 28],
    ] as const) {
      const s = batteryEstimate(base({ tariff })).sizing(5);
      expect(s.selfUseSavingGbp).toBe(Math.round((s.extraSelfUseKwh * (peak - exp)) / 100));
    }
    const std = batteryEstimate(base()).sizing(5);
    expect(std.selfUseSavingGbp).toBe(Math.round((std.extraSelfUseKwh * (imp - exp)) / 100));
  });

  it('gives the single-rate assumption for every tariff without time-of-use rates', () => {
    const line = 'On a single-rate tariff the battery saves by storing your own solar.';
    for (const tariff of ['standard', 'unknown', 'import_export', 'already_exports'] as const)
      expect(batteryEstimate(base({ tariff })).assumptions, tariff).toContain(line);
    for (const tariff of ['economy7', 'smart_tou'] as const)
      expect(batteryEstimate(base({ tariff })).assumptions, tariff).not.toContain(line);
  });

  it('says cheap-rate charging needs a time-of-use tariff when the tariff has none', () => {
    const line =
      'Charging on a cheap overnight rate needs a time-of-use tariff. These savings assume your current tariff.';
    for (const tariff of ['standard', 'unknown', 'import_export', 'already_exports'] as const)
      expect(batteryEstimate(base({ tariff, goal: 'cheap_rate' })).assumptions, tariff).toContain(
        line,
      );
    for (const tariff of ['economy7', 'smart_tou'] as const)
      expect(
        batteryEstimate(base({ tariff, goal: 'cheap_rate' })).assumptions,
        tariff,
      ).not.toContain(line);
    expect(batteryEstimate(base({ goal: 'savings' })).assumptions).not.toContain(line);
  });

  it('PV size fallbacks', () => {
    expect(batteryEstimate(base({ pvKwp: 6.2 })).pvKwp).toBe(6.2);
    const fromPanels = batteryEstimate(base({ pvKwp: null, panelCount: 10 }));
    expect(fromPanels.pvKwp).toBe(4.3);
    expect(fromPanels.pvKwpAssumed).toBe(false);
    const bad = batteryEstimate(base({ pvKwp: 40, panelCount: 1 }));
    expect(bad.pvKwp).toBe(4);
    expect(bad.pvKwpAssumed).toBe(true);
    expect(bad.assumptions).toContain('Assumed a typical 4 kWp solar system.');
    expect(batteryEstimate(base({ pvKwp: 0.2, panelCount: 61 })).pvKwpAssumed).toBe(true);
  });

  it('clamps absurd usage', () => {
    expect(batteryEstimate(base({ usage: usage(50) })).annualUseKwh).toBe(500);
    expect(batteryEstimate(base({ usage: usage(900000) })).annualUseKwh).toBe(30000);
  });

  it('adds 20% for EV or heat pump and warns for backup', () => {
    const plain = batteryEstimate(base({ usage: usage(8000), pvKwp: 8 }));
    const ev = batteryEstimate(base({ usage: usage(8000), pvKwp: 8, lifestyle: ['ev_now'] }));
    expect(ev.recommendedKwh).toBeGreaterThanOrEqual(plain.recommendedKwh);
    const b = batteryEstimate(base({ goal: 'backup' }));
    expect(b.warnings).toContain(
      'Backup power needs a compatible inverter and a changeover switch. Your installer will confirm.',
    );
    expect(batteryEstimate(base()).assumptions).toContain(
      'On a single-rate tariff the battery saves by storing your own solar.',
    );
    expect(batteryEstimate(base({ tariff: 'smart_tou' })).assumptions).not.toContain(
      'On a single-rate tariff the battery saves by storing your own solar.',
    );
  });

  it('time-of-use recommended size uses evening need', () => {
    const e = batteryEstimate(base({ tariff: 'smart_tou', usage: usage(6000), pvKwp: 3 }));
    const expected = Math.min(20, Math.max(2.5, Math.round(((6000 * 0.6) / 365) * 2) / 2));
    expect(e.recommendedKwh).toBe(expected);
  });

  it('every output is finite and non-negative across a matrix', () => {
    const tariffs: BatteryTariff[] = [
      'standard',
      'economy7',
      'smart_tou',
      'import_export',
      'already_exports',
      'unknown',
    ];
    const goals: BatteryGoal[] = ['savings', 'backup', 'cheap_rate', 'unsure'];
    for (const tariff of tariffs)
      for (const goal of goals)
        for (const pvKwp of [null, 0.1, 1, 4, 12, 30])
          for (const kwh of [null, 10, 3000, 12000, 99999])
            for (const cap of [0, 2.5, 10, 40]) {
              const e = batteryEstimate(
                base({ tariff, goal, pvKwp, usage: usage(kwh), lifestyle: ['ev_now'] }),
              );
              const nums: number[] = [
                e.pvKwp,
                e.annualGenerationKwh,
                e.annualUseKwh,
                e.importPence,
                e.exportPence,
                e.recommendedKwh,
                ...Object.values(e.sizing(cap)),
              ];
              for (const n of nums) {
                expect(Number.isFinite(n)).toBe(true);
                expect(n).toBeGreaterThanOrEqual(0);
              }
            }
  });

  it('has no dashes in exported strings', () => {
    const e = batteryEstimate(base({ goal: 'backup', pvKwp: null }));
    const strings = [BATTERY_DISCLAIMER, ...e.warnings, ...e.assumptions];
    for (const t of ['standard', 'economy7', 'smart_tou', 'unknown', 'import_export'] as const)
      strings.push(...batteryEstimate(base({ tariff: t, goal: 'cheap_rate' })).assumptions);
    for (const s of strings) expect(s).not.toMatch(/[–—]/);
    expect(BATTERY_RETROFIT_VAT_PERCENT).toBeGreaterThanOrEqual(0);
  });
});

describe('batteryEstimate global values', () => {
  it('uses the plan rates, disclaimer and zero VAT', () => {
    const e7 = batteryEstimate(base({ tariff: 'economy7' }));
    expect([e7.peakPence, e7.offPeakPence]).toEqual([30, 15]);
    const tou = batteryEstimate(base({ tariff: 'smart_tou' }));
    expect([tou.peakPence, tou.offPeakPence]).toEqual([28, 8]);
    expect(BATTERY_RETROFIT_VAT_PERCENT).toBe(0);
    expect(BATTERY_DISCLAIMER).toBe(
      'This is an indicative estimate. Your installer will check your existing solar system, inverter and consumer unit at a survey before a final price.',
    );
    expect(batteryEstimate(base({ pvKwp: null, panelCount: 7 })).pvKwp).toBe(3);
  });
});
