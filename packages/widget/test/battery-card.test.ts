import type { BatteryQuoteCard, QuoteCard } from '@sunny/contracts';
import { quoteCardSchema } from '@sunny/contracts';
import { describe, expect, it } from 'vitest';

import { batteryCardOrder, batteryCardText } from '../src/battery-card.js';

/**
 * The battery quote card's words, read as values: the DOM is built from
 * exactly these strings (widget.ts #showBatteryQuote), so what a card claims
 * is checked here without a browser.
 */

type Option = BatteryQuoteCard['options'][number];

function option(overrides: Partial<Option> = {}): Option {
  return {
    id: 'bat_standard',
    label: 'Recommended',
    isRecommended: true,
    headline: 'A 5 kWh battery, sized to your solar and your use.',
    capacityKwh: 5,
    priceGbp: 3_200,
    priceLabel: 'Indicative price',
    annualSavingsGbp: 310,
    shiftSavingGbp: 0,
    paybackYears: 10.5,
    ...overrides,
  };
}

function card(options: Option[]): QuoteCard {
  return {
    kind: 'battery',
    quoteId: 'q_bat1',
    priced: true,
    disclaimer: 'Indicative, subject to a survey.',
    proposalAvailable: true,
    options,
  };
}

describe('batteryCardText', () => {
  it('renders a priced battery card from a fixture QuoteCard', () => {
    const quote = card([option()]);
    expect(quoteCardSchema.safeParse(quote).success).toBe(true);
    if (quote.kind !== 'battery') throw new Error('fixture is a battery card');
    const [text] = quote.options.map(batteryCardText);
    expect(text).toEqual({
      priced: true,
      headline: 'A 5 kWh battery, sized to your solar and your use.',
      size: '5 kWh battery',
      figure: '£3,200',
      figureLabel: 'Indicative price',
      stats: ['Saves about £310 a year', 'Pays back in about 10.5 years'],
      notes: [],
    });
  });

  it('says how much of the saving comes from cheap-rate charging on a time-of-use tariff', () => {
    const text = batteryCardText(
      option({ capacityKwh: 9.5, annualSavingsGbp: 520, shiftSavingGbp: 240, paybackYears: 9 }),
    );
    expect(text.size).toBe('9.5 kWh battery');
    expect(text.stats).toEqual([
      'Saves about £520 a year, including about £240 from cheap-rate charging',
      'Pays back in about 9 years',
    ]);
  });

  it('shows an installer-priced option with its label, no price and no payback', () => {
    const text = batteryCardText(
      option({
        priceGbp: null,
        installerPriced: true,
        priceLabel: 'Priced by your installer',
        paybackYears: null,
      }),
    );
    expect(text.priced).toBe(false);
    expect(text.figure).toBe('Priced by your installer');
    expect(text.figureLabel).toBe('Free survey, no obligation');
    expect(text.stats).toEqual(['Saves about £310 a year']);
    expect(JSON.stringify([text.figure, text.figureLabel])).not.toMatch(/£/);
  });

  it('never shows a price or payback on an installer-priced option that still carries one', () => {
    const text = batteryCardText(option({ installerPriced: true, priceLabel: '' }));
    expect(text.priced).toBe(false);
    expect(text.figure).toBe('Priced by your installer');
    expect(text.stats.join(' ')).not.toMatch(/Pays back/);
  });

  it('leaves out the savings line when the saving rounds to nothing', () => {
    for (const annualSavingsGbp of [0, 0.4, -20]) {
      const text = batteryCardText(option({ annualSavingsGbp, paybackYears: null }));
      expect(text.stats).toEqual([]);
    }
  });

  it('says one year, not one years', () => {
    expect(batteryCardText(option({ paybackYears: 1 })).stats[1]).toBe('Pays back in about 1 year');
  });

  it("lists the option's warnings as notes", () => {
    const warnings = ['Your inverter may need replacing'];
    expect(batteryCardText(option({ warnings })).notes).toEqual(warnings);
  });

  it('orders the options smallest to largest, as solar does', () => {
    const rec = option({ id: 'recommended', capacityKwh: 9.5 });
    const more = option({ id: 'more_storage', isRecommended: false, capacityKwh: 13.5 });
    const smaller = option({ id: 'smaller', isRecommended: false, capacityKwh: 5 });
    expect(batteryCardOrder([rec, more, smaller]).map((o) => o.id)).toEqual([
      'smaller',
      'recommended',
      'more_storage',
    ]);
    const most = option({ id: 'most_storage', isRecommended: false, capacityKwh: 18 });
    expect(batteryCardOrder([rec, more, most]).map((o) => o.capacityKwh)).toEqual([9.5, 13.5, 18]);
  });

  it("carries the option's headline", () => {
    const headline = 'The largest battery your installer lists; the home could use about 6 kWh.';
    expect(batteryCardText(option({ headline })).headline).toBe(headline);
  });

  it('uses no dashes', () => {
    const text = batteryCardText(option({ shiftSavingGbp: 100 }));
    expect(JSON.stringify(text)).not.toMatch(/[\u2013\u2014]/);
  });
});
