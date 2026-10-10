import { describe, expect, it } from 'vitest';

import { productSchema, recommendationResponseSchema } from '@sunny/contracts';
import type { Product } from '@sunny/contracts';

import { batteryInverterPairing, mergeWant, recommend } from '@sunny/solar-rules';

/**
 * Golden scenarios for the recommendation engine.
 *
 * Every test here is a claim the plan makes about what a recommendation must and
 * must not do: it must exclude a combination the installer's own catalogue says
 * does not work, it must never produce a total it cannot source, and a refinement
 * must not quietly drop the requirement it did not mention. The numbers are
 * arithmetic over fixtures small enough to check by hand, which is the point --
 * if the engine and the test disagree, one of them is wrong about the addition.
 */

const NOW = '2026-01-01T00:00:00.000Z';

/**
 * A fixture with only the fields a case cares about.
 *
 * The compatibility bag is the one nested object here, and it is spelled as a
 * partial so a fixture can say "this inverter has a 6 kW DC limit" without also
 * asserting that it has no open-circuit voltage — which is what the schema
 * normalises it to, and what the rules actually read.
 */
type Seed = Omit<Partial<Product>, 'compatibility'> &
  Pick<Product, 'id' | 'category' | 'manufacturer' | 'model'> & {
    compatibility?: Partial<Product['compatibility']>;
  };

function product(seed: Seed): Product {
  return productSchema.parse({
    tenantId: 'w_demo000001',
    createdAt: NOW,
    priceStatus: seed.priceMinor === null || seed.priceMinor === undefined ? 'unknown' : 'verified',
    sourceRef: 'https://example.test/list-2026-01',
    ...seed,
  });
}

const PANEL_430 = product({
  id: 'p430',
  category: 'panel',
  manufacturer: 'Aurora',
  model: 'A430',
  powerW: 430,
  priceMinor: 18000,
  currency: 'GBP',
  warrantyYears: 25,
  compatibility: { vocV: 41.2 },
});

const PANEL_500 = product({
  id: 'p500',
  category: 'panel',
  manufacturer: 'Aurora',
  model: 'A500',
  powerW: 500,
  priceMinor: 21000,
  currency: 'GBP',
  compatibility: { vocV: 42.0 },
});

const INVERTER_4K = product({
  id: 'i4k',
  category: 'inverter',
  manufacturer: 'Solaris',
  model: 'SI-4K',
  powerW: 4000,
  priceMinor: 90000,
  currency: 'GBP',
  compatibility: { maxDcPowerW: 6000, maxStringVoltageV: 600, mpptCount: 2 },
});

const INVERTER_6K = product({
  id: 'i6k',
  category: 'inverter',
  manufacturer: 'Solaris',
  model: 'SI-6K',
  powerW: 6000,
  priceMinor: 120000,
  currency: 'GBP',
  compatibility: {
    maxDcPowerW: 8000,
    maxStringVoltageV: 600,
    mpptCount: 2,
    hybrid: true,
    batteryFamilies: ['Powercell'],
  },
});

const BATTERY = product({
  id: 'b10',
  category: 'battery',
  manufacturer: 'Powercell',
  model: 'PC-10',
  capacityWh: 10000,
  priceMinor: 450000,
  currency: 'GBP',
  compatibility: { batteryFamily: 'Powercell' },
});

const CATALOGUE: Product[] = [PANEL_430, PANEL_500, INVERTER_4K, INVERTER_6K, BATTERY];

function run(
  products: readonly Product[],
  want: Parameters<typeof recommend>[0]['want'],
  answers: Record<string, string> = {},
) {
  return recommend({ products, answers, want, now: NOW });
}

function itemCategories(pkg: { items: { category: string }[] }): string[] {
  return pkg.items.map((item) => item.category);
}

describe('assembling options', () => {
  const response = run(CATALOGUE, { targetKwp: 4 });

  it('sizes the system from the visitor’s own figure', () => {
    // 4 kWp of a 430 W panel is 9.30 panels, so nine; of a 500 W panel, eight.
    expect(response.packages.map((pkg) => pkg.systemPowerW)).toEqual([3870, 4000, 3870]);
    expect(response.packages.map((pkg) => pkg.items[0]!.quantity)).toEqual([9, 8, 9]);
  });

  it('adds up to the installer’s prices, and ranks by them', () => {
    // 9 × £180 + £900 = £2,520; 8 × £210 + £900 = £2,580; 9 × £180 + £1,200 = £2,820.
    expect(response.packages.map((pkg) => pkg.totalMinor)).toEqual([252000, 258000, 282000]);
    expect(response.packages.map((pkg) => pkg.rank)).toEqual([1, 2, 3]);
    expect(response.packages.map((pkg) => pkg.currency)).toEqual(['GBP', 'GBP', 'GBP']);
    // Every price carries a source, so none of these is rounded up to a guess.
    expect(response.packages.every((pkg) => pkg.totalStatus === 'verified')).toBe(true);
  });

  it('gives reasons from the checks that passed, not from copy', () => {
    expect(response.packages[0]!.reasons.join(' ')).toContain('DC input limit');
    expect(response.packages[0]!.reasons.join(' ')).toContain('open-circuit voltage');
    expect(response.packages[0]!.reasons).toHaveLength(2);
  });

  it('describes the catalogue it worked from', () => {
    expect(response.catalogue).toEqual({ products: 5, priceable: 5, currency: 'GBP' });
    expect(response.note).toContain('3 options');
    expect(response.generatedAt).toBe(NOW);
  });

  it('reports the rules that did not apply as plainly as the ones that did', () => {
    const budget = response.constraintsChecked.find((entry) => entry.id === 'budget');
    expect(budget?.outcome).toBe('not-applicable');
    const size = response.constraintsChecked.find((entry) => entry.id === 'system-size');
    expect(size?.outcome).toBe('applied');
    expect(size?.detail).toContain('4 kWp');
  });

  it('names every rule that ran, with the numbers it used', () => {
    // The card's reasons are prose; this is the audit beside them. A rule that
    // passed is here as `applied`, so "which rules ran" is answerable without
    // reading the reasons, and a caller can tell a checked option from one that
    // merely has no complaint against it.
    const applied = response.constraintsChecked.filter((entry) => entry.outcome === 'applied');
    expect(applied.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        'catalogue-present',
        'single-currency',
        'system-size',
        'inverter-dc-limit',
        'panel-string-voltage',
      ]),
    );
    const dc = applied.find((entry) => entry.id === 'inverter-dc-limit');
    expect(dc?.detail).toContain('3870 W against 6000 W');
  });

  it('returns a body that satisfies the contract', () => {
    expect(() => recommendationResponseSchema.parse(response)).not.toThrow();
  });

  it('is reproducible: the same inputs give the same answer, byte for byte', () => {
    expect(JSON.stringify(run(CATALOGUE, { targetKwp: 4 }))).toBe(JSON.stringify(response));
  });

  it('honours a panel count as the visitor’s number', () => {
    const counted = run(CATALOGUE, { panelCount: 12 });
    expect(counted.packages.every((pkg) => pkg.items[0]!.quantity === 12)).toBe(true);
    // 12 × 430 = 5,160 W, which is inside the 6 kW inverter's 6 kW DC limit.
    expect(counted.packages[0]!.systemPowerW).toBe(5160);
  });
});

describe('what the catalogue forbids', () => {
  it('excludes a combination above the inverter’s DC input limit', () => {
    const small = product({
      id: 'i3k',
      category: 'inverter',
      manufacturer: 'Solaris',
      model: 'SI-3K',
      powerW: 3000,
      priceMinor: 70000,
      currency: 'GBP',
      compatibility: { maxDcPowerW: 3000 },
    });
    const response = run([PANEL_430, small], { targetKwp: 4 });

    expect(response.packages).toEqual([]);
    const exclusion = response.exclusions.find((entry) => entry.code === 'inverter-dc-limit');
    expect(exclusion?.message).toContain('3870 W');
    expect(exclusion?.message).toContain('3000 W DC input limit');
    expect(exclusion?.productIds).toEqual(['p430', 'i3k']);
    expect(response.note).toContain('No combination');
  });

  it('excludes a panel that exceeds the inverter’s string voltage', () => {
    const tall = product({
      id: 'p-tall',
      category: 'panel',
      manufacturer: 'Aurora',
      model: 'T600',
      powerW: 300,
      priceMinor: 15000,
      currency: 'GBP',
      compatibility: { vocV: 60 },
    });
    const low = product({
      id: 'i-low-v',
      category: 'inverter',
      manufacturer: 'Solaris',
      model: 'SI-50V',
      powerW: 3000,
      priceMinor: 60000,
      currency: 'GBP',
      compatibility: { maxStringVoltageV: 50, maxDcPowerW: 6000 },
    });
    const response = run([tall, low], { panelCount: 4 });

    expect(response.packages).toEqual([]);
    expect(response.exclusions.map((entry) => entry.code)).toContain('panel-string-voltage');
  });

  it('refuses to show a battery the inverter is not listed with', () => {
    const other = product({
      id: 'b-other',
      category: 'battery',
      manufacturer: 'Othercell',
      model: 'OC-5',
      capacityWh: 5000,
      priceMinor: 300000,
      currency: 'GBP',
      compatibility: { batteryFamily: 'Othercell' },
    });
    const response = run([PANEL_430, INVERTER_6K, other], { targetKwp: 4, requireBattery: true });

    expect(response.packages).toEqual([]);
    const exclusion = response.exclusions.find(
      (entry) => entry.code === 'battery-inverter-pairing',
    );
    expect(exclusion?.message).toContain('listed as working');
    expect(response.note).toContain('No battery');
  });

  it('keeps considering a battery whose pairing nobody recorded, and says so', () => {
    const unlisted = product({
      id: 'b-unlisted',
      category: 'battery',
      manufacturer: 'Silent',
      model: 'S-5',
      capacityWh: 5000,
      priceMinor: 200000,
      currency: 'GBP',
    });
    const response = run([PANEL_430, INVERTER_4K, unlisted], {
      targetKwp: 4,
      requireBattery: true,
    });

    expect(response.packages).toHaveLength(1);
    expect(itemCategories(response.packages[0]!)).toContain('battery');
    // Silence is not a pass: the option is shown with the doubt attached, and
    // the constraint ledger records that the rule could not run.
    expect(response.packages[0]!.limitations.join(' ')).toContain('does not confirm');
    const pairing = response.constraintsChecked.find(
      (entry) => entry.id === 'battery-inverter-pairing',
    );
    expect(pairing?.outcome).toBe('skipped-missing-data');
  });

  it('states why it did not run a rule, rather than passing it silently', () => {
    const noSpec = product({
      id: 'i-nospec',
      category: 'inverter',
      manufacturer: 'Solaris',
      model: 'SI-4K-B',
      powerW: 4000,
      priceMinor: 90000,
      currency: 'GBP',
    });
    const response = run([PANEL_430, noSpec], { targetKwp: 4 });
    const dc = response.constraintsChecked.find((entry) => entry.id === 'inverter-dc-limit');
    expect(dc?.outcome).toBe('skipped-missing-data');
    expect(dc?.detail).toContain('no maximum DC input power');
    expect(response.packages[0]!.limitations.join(' ')).toContain('does not carry the figures');
  });

  it('bounds its search and admits when the bound bites', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      product({
        id: `p-${index}`,
        category: 'panel',
        manufacturer: 'Aurora',
        model: `A${400 + index}`,
        powerW: 400,
        priceMinor: 10000 + index * 100,
        currency: 'GBP',
      }),
    );
    const response = run([...many, INVERTER_4K], { panelCount: 4 });
    expect(
      response.constraintsChecked.find((entry) => entry.id === 'catalogue-search-bounded')?.outcome,
    ).toBe('applied');
    // The shortlist is the cheapest end of the catalogue, which is the end a
    // recommendation is drawn from.
    expect(response.packages[0]!.items[0]!.priceMinor).toBe(10000);
  });
});

describe('pairing a battery with an inverter', () => {
  const battery = (inverterModels: string[] | null, family: string | null = null): Product =>
    product({
      id: 'b1',
      category: 'battery',
      manufacturer: 'Alpha',
      model: 'Home 5',
      capacityWh: 5000,
      compatibility: { inverterModels, batteryFamily: family },
    });
  const inverter = (batteryFamilies: string[] | null): Product =>
    product({
      id: 'i1',
      category: 'inverter',
      manufacturer: 'Voltix',
      model: 'VX-4K',
      powerW: 4000,
      compatibility: { batteryFamilies },
    });

  it('accepts a battery that names the inverter the way a price list writes it', () => {
    // Both forms mean the same product, and reading the long one as a *different*
    // inverter would turn formatting into a contradiction.
    expect(batteryInverterPairing(battery(['VX-4K']), inverter(null))).toBe('compatible');
    expect(batteryInverterPairing(battery(['Voltix VX-4K']), inverter(null))).toBe('compatible');
    expect(batteryInverterPairing(battery(['voltix vx-4k']), inverter(null))).toBe('compatible');
  });

  it('accepts a battery in a family the inverter accepts', () => {
    expect(batteryInverterPairing(battery(null, 'Alpha'), inverter(['Alpha']))).toBe('compatible');
  });

  it('excludes a battery whose list names other inverters', () => {
    expect(batteryInverterPairing(battery(['Otherbrand X1']), inverter(null))).toBe('incompatible');
  });

  it('excludes a battery from a family the inverter lists and does not include', () => {
    expect(batteryInverterPairing(battery(null, 'Beta'), inverter(['Alpha']))).toBe('incompatible');
  });

  it('will not call an unlisted pair compatible on a hybrid inverter alone', () => {
    const hybrid = product({
      id: 'i2',
      category: 'inverter',
      manufacturer: 'Voltix',
      model: 'VX-4KH',
      powerW: 4000,
      compatibility: { hybrid: true },
    });
    expect(batteryInverterPairing(battery(null), hybrid)).toBe('unknown');
  });
});

describe('money', () => {
  it('gives no total when an item in the option has no price', () => {
    const unpriced = product({
      id: 'p-unpriced',
      category: 'panel',
      manufacturer: 'Aurora',
      model: 'A430X',
      powerW: 430,
      priceMinor: null,
      compatibility: { vocV: 41.2 },
    });
    const response = run([unpriced, INVERTER_4K], { targetKwp: 4 });

    expect(response.packages).toHaveLength(1);
    expect(response.packages[0]!.totalMinor).toBeNull();
    expect(response.packages[0]!.currency).toBeNull();
    expect(response.packages[0]!.totalStatus).toBe('unknown');
    expect(response.packages[0]!.limitations.join(' ')).toContain('no price');
  });

  it('will not compare an unpriced option against a budget', () => {
    const unpriced = product({
      id: 'p-unpriced',
      category: 'panel',
      manufacturer: 'Aurora',
      model: 'A430X',
      powerW: 430,
      priceMinor: null,
      compatibility: { vocV: 41.2 },
    });
    const response = run([unpriced, INVERTER_4K], { targetKwp: 4, maxBudgetMajor: 9000 });

    expect(response.packages).toEqual([]);
    expect(response.exclusions.map((entry) => entry.code)).toContain('price-unknown');
  });

  it('applies a budget as a ceiling, and reports what fell outside it', () => {
    const response = run(CATALOGUE, { targetKwp: 4, maxBudgetMajor: 2000 });

    expect(response.packages).toEqual([]);
    const exclusion = response.exclusions.find((entry) => entry.code === 'over-budget');
    expect(exclusion?.message).toContain('2520.00');
    expect(response.note).toContain('under the budget');
    expect(response.constraintsChecked.find((entry) => entry.id === 'budget')?.outcome).toBe(
      'applied',
    );
  });

  it('keeps an option it can afford, and drops the ones it cannot', () => {
    const response = run(CATALOGUE, { targetKwp: 4, maxBudgetMajor: 2700 });
    expect(response.packages.map((pkg) => pkg.totalMinor)).toEqual([252000, 258000]);
  });

  it('refuses to add two currencies together', () => {
    const euro = product({
      id: 'i-eur',
      category: 'inverter',
      manufacturer: 'Solaris',
      model: 'SI-4K-EU',
      powerW: 4000,
      priceMinor: 105000,
      currency: 'EUR',
      compatibility: { maxDcPowerW: 6000, maxStringVoltageV: 600 },
    });
    const response = run([PANEL_430, euro], { targetKwp: 4 });

    expect(response.catalogue.currency).toBeNull();
    expect(response.exclusions.map((entry) => entry.code)).toContain('mixed-currency');
    expect(response.packages[0]!.totalMinor).toBeNull();
    expect(response.packages[0]!.limitations.join(' ')).toContain('different currencies');
  });

  it('does not convert a budget stated in another currency', () => {
    const response = run(CATALOGUE, { targetKwp: 4, maxBudgetMajor: 9000, currency: 'USD' });
    const budget = response.constraintsChecked.find((entry) => entry.id === 'budget');
    expect(budget?.outcome).toBe('skipped-missing-data');
    expect(budget?.detail).toContain('does not convert');
    // Not applied, so nothing was excluded on the strength of it.
    expect(response.packages).toHaveLength(3);
  });
});

describe('refinements', () => {
  it('keeps what the visitor asked for earlier', () => {
    const merged = mergeWant(
      { targetKwp: 4, requireBattery: true, maxBudgetMajor: 12000 },
      { preferCheaper: true },
    );
    expect(merged).toEqual({
      targetKwp: 4,
      requireBattery: true,
      maxBudgetMajor: 12000,
      preferCheaper: true,
    });
  });

  it('starts again when the visitor changes their mind', () => {
    const merged = mergeWant(
      { targetKwp: 4, requireBattery: true, maxBudgetMajor: 12000 },
      { reset: true, panelCount: 6 },
    );
    expect(merged).toEqual({ panelCount: 6 });
    expect(merged.reset).toBeUndefined();
  });

  it('treats “cheaper” as cheaper *than the last set*, battery and all', () => {
    const merged = mergeWant({ requireBattery: true, targetKwp: 4 }, { preferCheaper: true });
    const response = run(CATALOGUE, merged);

    expect(merged.requireBattery).toBe(true);
    expect(response.packages).toHaveLength(3);
    for (const pkg of response.packages) {
      expect(itemCategories(pkg)).toContain('battery');
    }
    // 9 × £180 + £900 + £4,500 = £7,020, then £7,080, then £7,320: ascending.
    expect(response.packages.map((pkg) => pkg.totalMinor)).toEqual([702000, 708000, 732000]);
  });

  it('says which battery pairing it relied on, and which it could not', () => {
    const response = run(CATALOGUE, { targetKwp: 4, requireBattery: true });
    const withListed = response.packages.find((pkg) => pkg.title.includes('SI-6K'));
    const withUnknown = response.packages.find((pkg) => pkg.title.includes('SI-4K'));
    expect(withListed!.reasons.join(' ')).toContain('listed as working');
    expect(withUnknown!.limitations.join(' ')).toContain('does not confirm');
  });

  it('names a battery capacity floor as a requirement, not a preference', () => {
    const response = run(CATALOGUE, { targetKwp: 4, minBatteryKwh: 20 });
    expect(response.packages).toEqual([]);
    expect(
      response.exclusions.find((entry) => entry.code === 'battery-inverter-pairing')?.message,
    ).toContain('20 kWh');
  });
});

describe('when it cannot answer', () => {
  it('asks for a size rather than inventing one', () => {
    const response = run(CATALOGUE, {});
    expect(response.packages).toEqual([]);
    expect(response.note).toContain('how big a system');
    expect(response.constraintsChecked.find((entry) => entry.id === 'system-size')?.outcome).toBe(
      'not-applicable',
    );
  });

  it('says the catalogue is empty rather than showing nothing', () => {
    const response = run([], { targetKwp: 4 });
    expect(response.packages).toEqual([]);
    expect(response.catalogue).toEqual({ products: 0, priceable: 0, currency: null });
    expect(response.note).toContain('has not loaded');
    expect(
      response.constraintsChecked.find((entry) => entry.id === 'catalogue-present')?.outcome,
    ).toBe('not-applicable');
    expect(() => recommendationResponseSchema.parse(response)).not.toThrow();
  });

  it('says which half of a system the catalogue is missing', () => {
    const response = run([PANEL_430], { targetKwp: 4 });
    expect(response.packages).toEqual([]);
    expect(response.note).toContain('no inverters');
  });
});

describe('the roof the visitor described', () => {
  it('carries what they said as a limitation, and what it settles as reported', () => {
    const response = run(
      CATALOGUE,
      { targetKwp: 4 },
      {
        roof_size: 'medium',
        roof_direction: 'north',
        roof_shading: 'heavy',
        roof_confidence: 'high',
      },
    );

    expect(response.packages[0]!.limitations.join(' ')).toContain('north-facing');
    expect(response.packages[0]!.limitations.join(' ')).toContain('Heavy shading');
    expect(response.surveyConfirmed.join(' ')).toContain('Roof faces north');
    expect(response.constraintsChecked.find((entry) => entry.id === 'roof-survey')?.outcome).toBe(
      'applied',
    );
  });

  it('treats an unsure answer as an assumption rather than a fact', () => {
    const response = run(
      CATALOGUE,
      { targetKwp: 4 },
      { roof_size: 'unsure', roof_direction: 'unsure' },
    );
    expect(response.surveyConfirmed).toEqual([]);
    expect(response.assumptions.join(' ')).toContain('not from a survey');
    expect(response.packages[0]!.limitations.join(' ')).toContain('own estimate');
  });

  it('never puts a number on the roof it was told about', () => {
    const response = run(
      CATALOGUE,
      { targetKwp: 4 },
      {
        roof_size: 'small',
        roof_direction: 'north',
        roof_shading: 'heavy',
        roof_confidence: 'high',
      },
    );
    const words = JSON.stringify(response.packages);
    expect(words).not.toMatch(/\b\d+\s*(panels? fit|kW output|kWh\/year|per year)\b/i);
    // The old ad-hoc rule ("more than 20 panels is more than a small roof will
    // take") is gone: nothing here reads the panel count against the roof band.
    expect(response.packages.length).toBeGreaterThan(0);
  });
});
