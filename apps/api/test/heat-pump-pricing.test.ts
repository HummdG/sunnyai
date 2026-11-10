import { describe, expect, it } from 'vitest';

import { HSENERGY_PRICE_LIST_CSV } from '../src/catalogue/examples/hsenergy.js';
import { importPriceList } from '../src/catalogue/price-list.js';
import { pricingFromPriceList } from '../src/journey/catalogue-pricing.js';
import { heatPumpPricingFrom } from '../src/journey/heat-pump/pricing.js';

const HEADER = 'Category,Key,Name,Pricing,Amount,Unit,Power (kW),Role,Currency';

function list(rows: string[]) {
  const { list: l, issues } = importPriceList([HEADER, ...rows].join('\n'), {
    sourceVersion: 'v7',
  });
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  return l!;
}

describe('heatPumpPricingFrom', () => {
  it('maps units and install extras', () => {
    const p = heatPumpPricingFrom(
      list([
        'heat_pump,HP-7,Acme 7 kW,flat,"£6,500",,7,,GBP',
        'heat_pump,HP-10,Acme 10 kW,quote_only,,,10,,GBP',
        'heat_pump,HP-NOKW,No rating,flat,£100,,,,GBP',
        'heat_pump_install,INS-BASE,Base install,flat,"£1,800",,,base_install,GBP',
        'heat_pump_install,INS-BASE2,Second base,flat,£1,,,base_install,GBP',
        'heat_pump_install,INS-CYL,Cylinder,flat,£900,,,cylinder,GBP',
        'heat_pump_install,INS-RAD,Radiator,per_unit,£250,unit,,radiator,GBP',
      ]),
    )!;
    expect(p.units).toEqual([
      { sku: 'HP-7', name: 'Acme 7 kW', outputKw: 7, priceGbp: 6500 },
      { sku: 'HP-10', name: 'Acme 10 kW', outputKw: 10, priceGbp: null },
    ]);
    expect(p.extras.baseInstall).toEqual({ sku: 'INS-BASE', label: 'Base install', unitGbp: 1800 });
    expect(p.extras.cylinder?.unitGbp).toBe(900);
    expect(p.extras.radiatorEach?.unitGbp).toBe(250);
    expect(p.extras.powerflush).toBeNull();
    expect(p.extras.controls).toBeNull();
    expect(p.extras.electrical).toBeNull();
    expect(p.vatRatePercent).toBe(0);
    expect(p.currency).toBe('GBP');
    expect(p.version).toBe('v7');
  });

  it('takes the first priced item for a role, else the first item', () => {
    const p = heatPumpPricingFrom(
      list([
        'heat_pump,HP-7,Acme 7 kW,flat,"£6,500",,7,,GBP',
        'heat_pump_install,INS-BASE-Q,Base on survey,quote_only,,,,base_install,GBP',
        'heat_pump_install,INS-BASE,Base install,flat,"£1,800",,,base_install,GBP',
        'heat_pump_install,INS-BASE2,Second base,flat,£1,,,base_install,GBP',
        'heat_pump_install,INS-CYL-Q,Cylinder on survey,quote_only,,,,cylinder,GBP',
      ]),
    )!;
    expect(p.extras.baseInstall).toEqual({ sku: 'INS-BASE', label: 'Base install', unitGbp: 1800 });
    // No priced cylinder at all: the first one, which has no price.
    expect(p.extras.cylinder).toBeNull();
  });

  it('is null without heat pump items', () => {
    expect(heatPumpPricingFrom(list(['pv,PV,PV,flat,£100,,,,GBP']))).toBeNull();
    expect(heatPumpPricingFrom(null)).toBeNull();
  });
});

describe('heat pump VAT and the solar list', () => {
  it('uses the dated zero rate even when the list says 20%', () => {
    const csv = [
      'Category,Key,Name,Pricing,Amount,Unit,Power (kW),Role,Percent,Currency',
      'vat,VAT,VAT,vat,,,,,20,GBP',
      'heat_pump,HP-7,Acme 7 kW,flat,"£6,500",,7,,,GBP',
    ].join('\n');
    const { list } = importPriceList(csv);
    expect(list!.vatRatePercent).toBe(20);
    expect(heatPumpPricingFrom(list)!.vatRatePercent).toBe(0);
  });

  it('leaves the solar pricing identical when heat pump rows are added', () => {
    const base = importPriceList(HSENERGY_PRICE_LIST_CSV).list!;
    const row = (cells: Record<number, string>) =>
      Array.from({ length: 31 }, (_, i) => cells[i + 1] ?? '').join(',');
    const withHp = importPriceList(
      HSENERGY_PRICE_LIST_CSV.trimEnd() +
        '\n' +
        row({
          1: 'heat_pump',
          2: 'HP-7',
          3: 'Acme 7 kW',
          6: 'flat',
          7: '"£6,500"',
          22: '7',
          30: 'GBP',
        }) +
        '\n' +
        row({
          1: 'heat_pump_install',
          2: 'INS-BASE',
          3: 'Base',
          6: 'flat',
          7: '£1800',
          23: 'base_install',
          30: 'GBP',
        }) +
        '\n',
    ).list!;
    expect(withHp.items.some((i) => i.category === 'heat_pump')).toBe(true);
    expect(pricingFromPriceList(withHp)).toEqual(pricingFromPriceList(base));
  });

  it('warns about an install item with no role', () => {
    const { issues } = importPriceList(
      [HEADER, 'heat_pump_install,INS-X,Extra,flat,£100,,,,GBP'].join(String.fromCharCode(10)),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        key: 'INS-X',
        message: 'This heat pump installation item has no Role, so Sunny will not use it.',
      }),
    );
  });
});
