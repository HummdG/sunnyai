import { describe, expect, it } from 'vitest';

import {
  batteryPaybackText,
  batteryPriceText,
  batterySavingsText,
} from '../components/dashboard/battery-lead-text.js';

describe('the battery option on the lead page', () => {
  it('shows a price, or "Priced at survey" for an unpriced option', () => {
    expect(batteryPriceText({ priceGbp: 3200, installerPriced: false })).toBe('About £3,200');
    expect(batteryPriceText({ priceGbp: null, installerPriced: true })).toBe('Priced at survey');
    expect(batteryPriceText({ priceGbp: 3200, installerPriced: true })).toBe('Priced at survey');
  });

  it('shows the saving, with the cheap-rate part on a time-of-use tariff', () => {
    expect(batterySavingsText(310, 0)).toBe('About £310 a year');
    expect(batterySavingsText(520, 240)).toBe(
      'About £520 a year, about £240 of it from cheap-rate charging',
    );
    expect(batterySavingsText(0.3, 0)).toBe('None estimated');
  });

  it('shows the payback only for a priced option that has one', () => {
    expect(batteryPaybackText({ priceGbp: 3200, installerPriced: false, paybackYears: 10.5 })).toBe(
      'About 10.5 years',
    );
    expect(batteryPaybackText({ priceGbp: 3200, installerPriced: false, paybackYears: 1 })).toBe(
      'About 1 year',
    );
    expect(batteryPaybackText({ priceGbp: null, installerPriced: true, paybackYears: null })).toBe(
      'Not estimated',
    );
    expect(batteryPaybackText({ priceGbp: 3200, installerPriced: true, paybackYears: 9 })).toBe(
      'Not estimated',
    );
  });

  it('uses no dashes', () => {
    const all = [
      batteryPriceText({ priceGbp: null, installerPriced: true }),
      batterySavingsText(520, 240),
      batteryPaybackText({ priceGbp: 1, installerPriced: false, paybackYears: 2 }),
    ].join(' ');
    expect(all).not.toMatch(/[\u2013\u2014]/);
  });
});
