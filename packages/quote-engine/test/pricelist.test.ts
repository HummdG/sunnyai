import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildOptionSet,
  buildQuoteInput,
  computeQuote,
  pricingFromFile,
  type QuoteAnswers,
} from '../src/index.js';

const raw: unknown = JSON.parse(
  readFileSync(
    new URL('../../../fixtures/pricing/hsenergy-demo-pricelist.json', import.meta.url),
    'utf8',
  ),
);
const pricing = pricingFromFile(raw, 'HSEnergy demo');

describe('the demo price list (HSEnergy 2026 master, from SunScan v1 seed)', () => {
  it('is labelled as demo data', () => {
    expect((raw as { _demo: string })._demo).toMatch(/DEMO DATA/);
  });

  // Spot checks against "Residential Sales Pricelists - Google Sheets.pdf"
  // (v 23rd Feb 2026), read independently of the seed.
  it('matches the PDF PV base price table', () => {
    const row = (n: number) => pricing.catalogue.pvBasePrice.find((r) => r.panelCount === n);
    expect(pricing.catalogue.pvBasePrice).toHaveLength(50);
    expect(row(1)).toMatchObject({ kwp: 0.43, priceGbp: 3985 });
    expect(row(10)).toMatchObject({ kwp: 4.3, priceGbp: 5932 });
    expect(row(20)).toMatchObject({ kwp: 8.6, priceGbp: 8449 });
    expect(row(26)).toMatchObject({ kwp: 11.18, priceGbp: 10230 });
    expect(row(50)).toMatchObject({ kwp: 21.5, priceGbp: 19673 });
  });

  it('matches the PDF batteries, extras and panel uplifts', () => {
    const battery = (sku: string) => pricing.catalogue.batteries.find((b) => b.sku === sku);
    expect(battery('FOX-EC2900')).toMatchObject({ priceWithSolar: 2595, priceRetrofit: 3195 });
    expect(battery('FOX-EQ4800')).toMatchObject({ priceWithSolar: 3995, priceRetrofit: 4695 });
    expect(battery('TESLA-PW3')).toMatchObject({ priceWithSolar: 9195, priceRetrofit: 9795 });
    expect(battery('FOX-EVO-1024')).toMatchObject({
      priceWithSolar: 4295,
      multiUnitDiscountGbp: 200,
    });

    const extra = (sku: string) => pricing.catalogue.extras.find((e) => e.sku === sku);
    expect(extra('ELEC-ADMIN-FEE')).toMatchObject({ baseGbp: 350, isMandatory: true });
    expect(extra('STRUCT-FLATROOF-SURVEY')?.baseGbp).toBe(261);
    expect(extra('OPT-BIRDMESH')).toMatchObject({
      baseGbp: 600,
      perPanelGbp: 30,
      panelThreshold: 20,
    });
    expect(extra('EPS-FOX')?.baseGbp).toBe(825);

    const panel = (sku: string) => pricing.catalogue.panels.find((p) => p.sku === sku);
    expect(panel('DMEGC-DM455')).toMatchObject({ upliftType: 'percent', upliftValue: 0.075 });
    expect(panel('REA-HD96-460')).toMatchObject({ upliftType: 'percent', upliftValue: 0.08 });
    expect(panel('REA-HD108-450-ENPHASE')).toMatchObject({
      upliftType: 'flat_per_panel',
      upliftValue: 150,
    });
    expect(panel('DMEGC-DM430')).toMatchObject({ widthMm: 1134, heightMm: 1762, isBase: true });
  });

  it('prices a plain 10-panel pitched system to the list price plus mounting and admin', () => {
    const quote = computeQuote(
      {
        tier: 'custom',
        panelSku: 'DMEGC-DM430',
        panelCount: 10,
        mountingSku: 'MOUNT-PITCHED-TILE',
        battery: null,
        scaffoldingExtras: [],
        electricalExtras: [],
        optionalExtras: [],
        trenching: null,
        birdMesh: false,
        optimiserScope: 'none',
      },
      { catalogue: pricing.catalogue, roofMaxPanels: 20, annualKwh: 3500, roofType: 'pitched' },
    );
    // £5,932 (10 panels) + 10 × £30 pitched-tile mounting + £350 admin.
    expect(quote.totalPounds).toBe(5932 + 300 + 350);
    expect(quote.vatRatePercent).toBe(0);
  });
});

describe('a quote from answers, the roof and the demo price list', () => {
  const answers: QuoteAnswers = {
    postcode: 'NR4 7TJ',
    roof: {
      pitchDeg: 35,
      mcsOrientationDeg: 20,
      maxPanelCount: 18,
      roofType: 'pitched',
      confidence: 'high',
    },
    usage: {
      source: 'monthly_cost',
      annualKwh: null,
      unitRatePence: null,
      exportTariffPence: null,
      monthlyCostGbp: 110,
      householdSize: null,
    },
    tariffType: 'standard',
    lifestyle: ['ev_planned'],
    motivation: 'reduce_bills',
    existing: 'none',
    budgetBandId: '10k_12k',
  };

  it('produces exactly three distinct options, cheapest first, within the roof', () => {
    const { input, derived } = buildQuoteInput(answers, pricing);
    expect(derived.regionName).toMatch(/East/i);
    expect(derived.annualKwh).toBeGreaterThan(4000); // £110/month at the regional rate
    expect(derived.budgetMaxGbp).toBe(12000);
    const set = buildOptionSet(input);
    expect(set.options).toHaveLength(3);
    const prices = set.options.map((o) => o.priceGbp);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    for (const option of set.options) {
      expect(option.panelCount).toBeLessThanOrEqual(18);
      expect(option.results.annualGenerationKwh).toBeGreaterThan(0);
      expect(option.results.paybackYears).toBeGreaterThan(0);
    }
    expect(set.options.filter((o) => o.isRecommended)).toHaveLength(1);
  });

  it('uses the visitor’s roof answers only when the roof confidence is low', () => {
    const low = buildQuoteInput(
      {
        ...answers,
        roof: { ...answers.roof, confidence: 'low' },
        roofFallback: { sizeBand: 'small', direction: 'east', shading: 'trees' },
      },
      pricing,
    );
    expect(low.derived).toMatchObject({
      roofMaxPanels: 8,
      mcsOrientationDeg: 90,
      shadingLoss: 0.1,
    });
    const high = buildQuoteInput(
      { ...answers, roofFallback: { sizeBand: 'small', direction: 'east', shading: 'trees' } },
      pricing,
    );
    expect(high.derived).toMatchObject({
      roofMaxPanels: 18,
      mcsOrientationDeg: 20,
      shadingLoss: 0.05,
    });
  });

  it('resolves consumption the way SunScan v1 does', () => {
    const household = buildQuoteInput(
      {
        ...answers,
        usage: { ...answers.usage, source: 'household', monthlyCostGbp: null, householdSize: 4 },
      },
      pricing,
    );
    expect(household.derived.annualKwh).toBe(4100); // Ofgem TDCV high
    const known = buildQuoteInput(
      { ...answers, usage: { ...answers.usage, annualKwh: 3200 } },
      pricing,
    );
    expect(known.derived.annualKwh).toBe(3200);
  });
});
