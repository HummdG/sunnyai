import { describe, expect, it } from 'vitest';

import { importPriceList } from '../src/catalogue/price-list.js';
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

  it('is null without heat pump items', () => {
    expect(heatPumpPricingFrom(list(['pv,PV,PV,flat,£100,,,,GBP']))).toBeNull();
    expect(heatPumpPricingFrom(null)).toBeNull();
  });
});
