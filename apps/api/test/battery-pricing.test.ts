import { describe, expect, it } from 'vitest';

import { HSENERGY_PRICE_LIST_CSV } from '../src/catalogue/examples/hsenergy.js';
import { importPriceList } from '../src/catalogue/price-list.js';
import { pricingFromPriceList } from '../src/journey/catalogue-pricing.js';
import { batteryPricingFrom } from '../src/journey/battery/pricing.js';

const HEADER = 'Category,Key,Name,Pricing,Amount,Unit,Capacity (kWh),Role,Currency';

function list(rows: string[]) {
  const { list: l, issues } = importPriceList([HEADER, ...rows].join('\n'), {
    sourceVersion: 'v3',
  });
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  return l!;
}

describe('batteryPricingFrom', () => {
  it('uses the retrofit price and carries the expansion (hsenergy fixture)', () => {
    const p = batteryPricingFrom(importPriceList(HSENERGY_PRICE_LIST_CSV).list!)!;
    const fox = p.batteries.find((b) => b.sku === 'FOX-EC2900')!;
    expect(fox.priceGbp).toBe(3195);
    expect(fox.capacityKwh).toBe(5.8);
    expect(fox.expansion).toEqual({
      sku: 'FOX-ECS2900',
      capacityKwh: 2.9,
      priceGbp: 895,
      maxUnits: 7,
    });
    expect(p.batteries.find((b) => b.sku === 'TESLA-PW3')!.priceGbp).toBe(9795);
    expect(p.vatRatePercent).toBe(0);
  });

  it('gives a null price for a with-solar-only battery, never the with-solar price', () => {
    const csv = [
      'Category,Key,Name,Pricing,Price with solar,Price retrofit,Capacity (kWh),Currency',
      'battery,B-1,Solar only,with_solar,"£2,000",,5,GBP',
    ].join('\n');
    const { list: l } = importPriceList(csv);
    const p = batteryPricingFrom(l)!;
    expect(p.batteries).toEqual([
      { sku: 'B-1', name: 'Solar only', capacityKwh: 5, priceGbp: null, expansion: null },
    ]);
  });

  it('skips batteries without a capacity', () => {
    const p = batteryPricingFrom(
      list(['battery,B-1,Sized,flat,"£3,000",,5,,GBP', 'battery,B-2,Unsized,flat,"£3,000",,,,GBP']),
    )!;
    expect(p.batteries.map((b) => b.sku)).toEqual(['B-1']);
    expect(p.version).toBe('v3');
  });

  it('picks up the first priced ac_coupling inverter', () => {
    const p = batteryPricingFrom(
      list([
        'battery,B-1,Sized,flat,"£3,000",,5,,GBP',
        'inverter,AC-Q,AC on survey,quote_only,,,,ac_coupling,GBP',
        'inverter,AC-1,AC coupled inverter,flat,£700,,,ac_coupling,GBP',
        'inverter,AC-2,Another,flat,£1,,,ac_coupling,GBP',
        'inverter,INV-PLAIN,Plain,flat,£5,,,,GBP',
      ]),
    )!;
    expect(p.acCoupling).toEqual({ sku: 'AC-1', label: 'AC coupled inverter', unitGbp: 700 });
  });

  it('has no acCoupling without one', () => {
    expect(
      batteryPricingFrom(list(['battery,B-1,Sized,flat,"£3,000",,5,,GBP']))!.acCoupling,
    ).toBeNull();
  });

  it('is null without battery items', () => {
    expect(batteryPricingFrom(list(['pv,PV,PV,flat,£100,,,,GBP']))).toBeNull();
    expect(batteryPricingFrom(null)).toBeNull();
  });

  it('uses the dated zero rate even when the list says 20%', () => {
    const csv = [
      'Category,Key,Name,Pricing,Amount,Capacity (kWh),Percent,Currency',
      'vat,VAT,VAT,vat,,,20,GBP',
      'battery,B-1,Sized,flat,"£3,000",5,,GBP',
    ].join('\n');
    const { list: l } = importPriceList(csv);
    expect(l!.vatRatePercent).toBe(20);
    expect(batteryPricingFrom(l)!.vatRatePercent).toBe(0);
  });

  it('leaves the solar pricing identical when an inverter gains the ac_coupling role', () => {
    const row = (role: string) =>
      Array.from(
        { length: 31 },
        (_, i) =>
          ({
            1: 'inverter',
            2: 'AC-1',
            3: 'AC coupled',
            6: 'flat',
            7: '£700',
            23: role,
            30: 'GBP',
          })[i + 1] ?? '',
      ).join(',');
    const build = (role: string) =>
      importPriceList(HSENERGY_PRICE_LIST_CSV.trimEnd() + '\n' + row(role) + '\n').list!;
    const plain = build('');
    const withRole = build('ac_coupling');
    expect(withRole.items.find((i) => i.key === 'AC-1')?.role).toBe('ac_coupling');
    expect(plain.items.find((i) => i.key === 'AC-1')?.role).toBeUndefined();
    expect(pricingFromPriceList(withRole)).toEqual(pricingFromPriceList(plain));
  });

  it('warns about a role that does not fit the category', () => {
    const { issues } = importPriceList(
      [HEADER, 'battery,B-1,Sized,flat,"£3,000",,5,ac_coupling,GBP'].join('\n'),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        key: 'B-1',
        message: 'The role ac_coupling does not fit a battery item, so Sunny will not use it.',
      }),
    );
  });
});
