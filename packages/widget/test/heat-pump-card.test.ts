import type { HeatPumpQuoteCard, QuoteCard } from '@sunny/contracts';
import { quoteCardSchema } from '@sunny/contracts';
import { describe, expect, it } from 'vitest';

import { heatPumpCardText } from '../src/heat-pump-card.js';

/**
 * The heat pump quote card's words, read as values: the DOM is built from
 * exactly these strings (widget.ts #showHeatPumpQuote), so what a card claims
 * is checked here without a browser.
 */

type Option = HeatPumpQuoteCard['options'][number];

function option(overrides: Partial<Option> = {}): Option {
  return {
    id: 'hp_standard',
    label: 'Recommended',
    isRecommended: true,
    headline: 'An 8 kW heat pump with a new cylinder',
    outputKw: 8,
    priceGbp: 12_400,
    grantGbp: 7_500,
    grantStatus: 'eligible',
    priceAfterGrantGbp: 4_900,
    priceLabel: 'Indicative price',
    runningCostGbp: 1_150,
    currentCostGbp: 1_400,
    annualSavingsGbp: 250,
    ...overrides,
  };
}

function card(options: Option[]): QuoteCard {
  return {
    kind: 'heat_pump',
    quoteId: 'q_hp1',
    priced: true,
    disclaimer: 'Indicative, subject to a survey.',
    proposalAvailable: true,
    options,
  };
}

describe('heatPumpCardText', () => {
  it('renders a heat pump card from a fixture QuoteCard', () => {
    const quote = card([option()]);
    expect(quoteCardSchema.safeParse(quote).success).toBe(true);
    if (quote.kind !== 'heat_pump') throw new Error('fixture is a heat pump card');
    const [text] = quote.options.map(heatPumpCardText);
    expect(text).toEqual({
      priced: true,
      size: '8 kW heat pump',
      figure: '£12,400',
      figureLabel: 'Indicative price',
      grant: 'After the £7,500 grant: £4,900',
      stats: ['Running cost about £1,150 a year', 'About £250 a year less than now'],
      notes: [],
    });
  });

  it('says a dearer heat pump costs more to run, but is low carbon', () => {
    const text = heatPumpCardText(option({ runningCostGbp: 1_500, annualSavingsGbp: -100 }));
    expect(text.stats).toEqual([
      'Running cost about £1,500 a year',
      'About £100 a year more than now, but low carbon',
    ]);
  });

  it('says the running cost is about the same when the difference rounds to £0', () => {
    for (const annualSavingsGbp of [0, 0.4, -0.4]) {
      expect(heatPumpCardText(option({ annualSavingsGbp })).stats[1]).toBe(
        'About the same running cost as now',
      );
    }
  });

  it('says a heat pump £1 a year dearer to run costs more, but is low carbon', () => {
    expect(heatPumpCardText(option({ annualSavingsGbp: -0.6 })).stats[1]).toBe(
      'About £1 a year more than now, but low carbon',
    );
  });

  it('says the grant may apply when the postcode cannot tell, with no deduction', () => {
    const text = heatPumpCardText(
      option({ grantStatus: 'unsure', grantGbp: 0, priceAfterGrantGbp: 12_400 }),
    );
    expect(text.grant).toBe('The Boiler Upgrade Scheme may apply');
  });

  it('shows no grant line when there is no grant', () => {
    const text = heatPumpCardText(
      option({ grantStatus: 'none', grantGbp: 0, priceAfterGrantGbp: 12_400 }),
    );
    expect(text.grant).toBeNull();
  });

  it('shows an installer-priced option without any figure', () => {
    const text = heatPumpCardText(
      option({
        priceGbp: null,
        priceAfterGrantGbp: null,
        installerPriced: true,
        priceLabel: 'Priced by your installer',
        grantStatus: 'none',
        grantGbp: 0,
      }),
    );
    expect(text.priced).toBe(false);
    expect(text.figure).toBe('Priced by your installer');
    expect(text.figureLabel).toBe('Free survey, no obligation');
    expect(text.grant).toBeNull();
    expect(JSON.stringify([text.figure, text.figureLabel, text.grant])).not.toMatch(/£/);
  });

  it('says the grant comes off the price for an installer-priced eligible option', () => {
    const text = heatPumpCardText(
      option({
        priceGbp: null,
        priceAfterGrantGbp: null,
        installerPriced: true,
        priceLabel: 'Priced by your installer',
      }),
    );
    expect(text.figure).toBe('Priced by your installer');
    expect(text.grant).toBe('£7,500 Boiler Upgrade Scheme grant comes off the price');
  });

  it('deducts only the grant applied, never more than the price', () => {
    const text = heatPumpCardText(
      option({ priceGbp: 6_500, grantGbp: 6_500, priceAfterGrantGbp: 0 }),
    );
    expect(text.grant).toBe('After the £6,500 grant: £0');
  });

  it("keeps the grant's 'may apply' line for an installer-priced option", () => {
    const text = heatPumpCardText(
      option({
        priceGbp: null,
        priceAfterGrantGbp: null,
        installerPriced: true,
        grantStatus: 'unsure',
      }),
    );
    expect(text.grant).toBe('The Boiler Upgrade Scheme may apply');
  });

  it("lists the option's warnings as notes", () => {
    const warnings = ['Needs space outside for the unit'];
    expect(heatPumpCardText(option({ warnings })).notes).toEqual(warnings);
  });
});
