import { describe, expect, it } from 'vitest';

import * as engine from '../src/index';
import {
  DATA_EFFECTIVE_FROM,
  HEAT_PUMP_DISCLAIMER,
  STANDARD_SIZES_KW,
  estimate,
  nationOf,
  type HeatPumpInput,
} from '../src/index';

const base: HeatPumpInput = {
  postcode: 'NR4 7TJ',
  propertyType: 'semi',
  ageBand: '1965_1982',
  floorAreaM2: 90,
  bedrooms: 3,
  walls: 'cavity_filled',
  loft: 'some',
  glazing: 'double',
  currentFuel: 'gas',
  emitters: 'radiators_standard',
  hotWater: 'cylinder',
  occupants: 3,
  ownership: 'own',
  annualSpendGbp: null,
  epcRecommendsInsulation: null,
};

describe('nationOf', () => {
  it.each([
    ['EH1 1AA', 'scotland'],
    ['BT1 1AA', 'northern_ireland'],
    ['CF10 1AA', 'wales'],
    ['SY23 1AA', 'border'],
    ['TD15 1AA', 'border'],
    ['NR4 7TJ', 'england'],
    ['garbage', 'unknown'],
  ])('%s is %s', (pc, nation) => {
    expect(nationOf(pc)).toBe(nation);
  });
});

describe('estimate golden', () => {
  it('1965-82 semi, 90 m2, NR4 7TJ', () => {
    const e = estimate(base);
    // NR design temp is -3. 90 m2 x 80 W/m2 x 0.9 (cavity_filled) x 1.0 (some) x 1.0 (double)
    // = 6480 W; x (21 - -3) / (21 - -2) = 24 / 23 -> 6761.7 W -> 6.8 kW.
    expect(e.peakHeatLossKw).toBe(6.8);
    // Smallest standard size >= 6.8 is 7.
    expect(e.recommendedKw).toBe(7);
    // Space heat: 6.8 kW x 55000 degree hours / 24 K = 15583.3 kWh.
    expect(e.annualSpaceHeatKwh).toBeCloseTo(15583.33, 0);
    // Hot water: 3 occupants x 800 = 2400 kWh.
    expect(e.annualHotWaterKwh).toBe(2400);
    // SCOP: standard radiators 3.0, newer than 1944 so no deduction.
    expect(e.scop).toBe(3.0);
    // Gas: (15583.33 + 2400) / 0.85 kWh x 6.3p = 21156.9 kWh x 0.063 = 1332.9 GBP.
    expect(e.runningCost.boilerEfficiency).toBe(0.85);
    expect(e.runningCost.currentGbp).toBeCloseTo(((15583.33 + 2400) / 0.85) * 0.063, 0);
    // Heat pump: 17983.33 / 3.0 x 0.26 = 1558.6 GBP.
    expect(e.runningCost.heatPumpGbp).toBeCloseTo((17983.33 / 3.0) * 0.26, 0);
    expect(e.bus.eligible).toBe(true);
    expect(e.bus.amountGbp).toBe(7500);
    expect(e.nation).toBe('england');
    expect(e.floorAreaAssumed).toBe(false);
  });

  it('notes the spend without replacing the model', () => {
    const e = estimate({ ...base, annualSpendGbp: 900 });
    expect(e.assumptions.some((a) => a.includes('900'))).toBe(true);
    expect(e.runningCost.currentGbp).toBeGreaterThan(1000);
  });
});

describe('floor area', () => {
  it('falls back to bedrooms when null', () => {
    const e = estimate({ ...base, floorAreaM2: null, bedrooms: 3 });
    expect(e.floorAreaM2).toBe(90);
    expect(e.floorAreaAssumed).toBe(true);
    expect(e.assumptions.length).toBeGreaterThan(0);
  });
  it('falls back when implausible', () => {
    const e = estimate({ ...base, floorAreaM2: 5000, bedrooms: 4 });
    expect(e.floorAreaM2).toBe(120);
    expect(e.floorAreaAssumed).toBe(true);
  });
  it('uses 150 for five or more bedrooms and 90 by default', () => {
    expect(estimate({ ...base, floorAreaM2: null, bedrooms: 7 }).floorAreaM2).toBe(150);
    expect(estimate({ ...base, floorAreaM2: null, bedrooms: null }).floorAreaM2).toBe(90);
  });
});

describe('sizing cap', () => {
  it('caps a large old home at 16 kW with a warning', () => {
    const e = estimate({
      ...base,
      postcode: 'EH1 1AA',
      ageBand: 'pre_1919',
      floorAreaM2: 400,
      walls: 'solid_uninsulated',
      loft: 'none',
      glazing: 'single',
    });
    expect(e.peakHeatLossKw).toBeGreaterThan(16);
    expect(e.recommendedKw).toBe(16);
    expect(e.warnings).toContain(
      'This home may need a larger or second heat pump. Your installer will advise.',
    );
  });
});

describe('matrix', () => {
  it('stays finite across every enum', () => {
    const ages = [
      'pre_1919',
      '1919_1944',
      '1945_1964',
      '1965_1982',
      '1983_1995',
      '1996_2006',
      '2007_on',
    ] as const;
    const walls = [
      'solid_uninsulated',
      'solid_insulated',
      'cavity_unfilled',
      'cavity_filled',
      'timber_or_modern',
      'unsure',
    ] as const;
    const lofts = ['none', 'some', 'good', 'unsure'] as const;
    const glz = ['single', 'double', 'triple', 'unsure'] as const;
    const fuels = [
      'gas',
      'oil',
      'lpg',
      'electric_storage',
      'electric_direct',
      'heat_pump',
      'other',
    ] as const;
    const ems = ['radiators_standard', 'radiators_large', 'underfloor', 'unsure'] as const;
    let n = 0;
    for (const ageBand of ages)
      for (const w of walls)
        for (const loft of lofts)
          for (const glazing of glz)
            for (const currentFuel of fuels)
              for (const emitters of ems) {
                const e = estimate({
                  ...base,
                  ageBand,
                  walls: w,
                  loft,
                  glazing,
                  currentFuel,
                  emitters,
                });
                const nums = [
                  e.floorAreaM2,
                  e.peakHeatLossKw,
                  e.annualSpaceHeatKwh,
                  e.annualHotWaterKwh,
                  e.recommendedKw,
                  e.scop,
                  e.runningCost.currentGbp,
                  e.runningCost.heatPumpGbp,
                  e.runningCost.fuelPencePerKwh,
                  e.runningCost.elecPencePerKwh,
                  e.runningCost.boilerEfficiency,
                  e.bus.amountGbp,
                ];
                expect(nums.every((v) => Number.isFinite(v))).toBe(true);
                n++;
              }
    expect(n).toBe(7 * 6 * 4 * 4 * 7 * 4);
  });
});

describe('BUS', () => {
  it('renter is ineligible', () => {
    const b = estimate({ ...base, ownership: 'rent' }).bus;
    expect(b.eligible).toBe(false);
    expect(b.reasons).toContain('The grant goes to the property owner.');
  });
  it('existing heat pump is ineligible', () => {
    const b = estimate({ ...base, currentFuel: 'heat_pump' }).bus;
    expect(b.eligible).toBe(false);
    expect(b.reasons).toContain('Already has a heat pump.');
  });
  it('Scotland is ineligible', () => {
    const b = estimate({ ...base, postcode: 'EH1 1AA' }).bus;
    expect(b.eligible).toBe(false);
    expect(b.reasons).toContain(
      'The Boiler Upgrade Scheme covers England and Wales. Home Energy Scotland offers its own support.',
    );
  });
  it('border is unsure', () => {
    expect(estimate({ ...base, postcode: 'TD15 1AA' }).bus.eligible).toBe('unsure');
  });
  it('NI is ineligible', () => {
    const b = estimate({ ...base, postcode: 'BT1 1AA' }).bus;
    expect(b.eligible).toBe(false);
    expect(b.reasons).toContain('The Boiler Upgrade Scheme covers England and Wales.');
  });
  it('unknown nation is unsure', () => {
    expect(estimate({ ...base, postcode: 'garbage' }).bus.eligible).toBe('unsure');
  });
  it('EPC insulation advice adds a reason but does not block', () => {
    const b = estimate({ ...base, epcRecommendsInsulation: 'yes' }).bus;
    expect(b.eligible).toBe(true);
    expect(b.reasons.length).toBeGreaterThan(0);
  });
});

describe('exports', () => {
  it('has the sizes, disclaimer and date', () => {
    expect(STANDARD_SIZES_KW).toEqual([5, 6, 7, 8.5, 10, 12, 14, 16]);
    expect(HEAT_PUMP_DISCLAIMER).toBe(
      'This is an indicative estimate. Your installer will confirm the heat loss with a room-by-room survey (MCS MIS 3005) before a final price.',
    );
    expect(DATA_EFFECTIVE_FROM).toBe('2026-10-01');
  });

  it('has no em or en dashes in any string it produces', () => {
    const strings: string[] = [HEAT_PUMP_DISCLAIMER, DATA_EFFECTIVE_FROM];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const v of Object.values(engine)) if (typeof v !== 'function') walk(v);
    for (const ageBand of ['pre_1919', '2007_on'] as const)
      for (const postcode of ['EH1 1AA', 'TD15 1AA', 'BT1 1AA', 'NR4 7TJ', 'garbage', 'SY1 1AA'])
        for (const ownership of ['own', 'rent'])
          for (const currentFuel of ['gas', 'heat_pump', 'electric_direct'] as const)
            for (const floorAreaM2 of [null, 90, 900])
              walk(
                estimate({
                  ...base,
                  ageBand,
                  postcode,
                  ownership,
                  currentFuel,
                  floorAreaM2,
                  annualSpendGbp: 800,
                  epcRecommendsInsulation: 'yes',
                }),
              );
    for (const s of strings) expect(s).not.toMatch(/[—–]/);
  });
});
