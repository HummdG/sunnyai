import type { PackageItem, PackageOption, RecommendationResponse } from '@sunny/contracts';
import { describe, expect, it } from 'vitest';

import { optionsPanel } from '../src/cards.js';
import { contrastRatio, parseHex, AA_NORMAL_TEXT } from '../src/contrast.js';
import { styles, VERIFIED_PRICE_INK } from '../src/styles.js';

/**
 * The cards, checked by reading values rather than by looking at a screenshot.
 *
 * `optionsPanel` is a pure function of the response, so everything a card claims
 * can be asserted here -- and what it must *not* claim is the more important
 * half. Three non-negotiables: no yield is ever shown, an absent figure is
 * absent rather than zero, and a price without provenance is never dressed as a
 * verified one.
 *
 * The DOM builders in the same module are deliberately not covered here: the
 * unit tests run in Node with no layout engine, and "does this card look right"
 * is a question only a browser answers. The Playwright check does that.
 */

function item(overrides: Partial<PackageItem> = {}): PackageItem {
  return {
    productId: 'p1',
    category: 'panel',
    manufacturer: 'Sunbeam',
    model: 'SB-430',
    quantity: 1,
    powerW: null,
    capacityWh: null,
    priceMinor: null,
    priceStatus: 'unknown',
    currency: null,
    sourceRef: null,
    warrantyYears: null,
    ...overrides,
  };
}

function option(overrides: Partial<PackageOption> = {}): PackageOption {
  return {
    id: 'opt-1',
    rank: 1,
    title: 'A 4 kWp roof system',
    summary: 'Nine panels and one inverter.',
    items: [item()],
    totalMinor: null,
    currency: null,
    totalStatus: 'unknown',
    systemPowerW: null,
    batteryCapacityWh: null,
    reasons: [],
    limitations: [],
    nextStep: 'Book a survey and we will confirm the roof.',
    ...overrides,
  };
}

function response(overrides: Partial<RecommendationResponse> = {}): RecommendationResponse {
  return {
    generatedAt: '2026-10-11T00:00:00.000Z',
    catalogue: { products: 0, priceable: 0, currency: null },
    want: {},
    constraintsChecked: [],
    packages: [],
    exclusions: [],
    assumptions: [],
    surveyConfirmed: [],
    note: 'Tell me about your roof and I will put some options together.',
    ...overrides,
  };
}

/** Under `noUncheckedIndexedAccess` every index is possibly absent; tests still want the element. */
function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) throw new Error('expected at least one entry');
  return head;
}

describe('optionsPanel', () => {
  it('shows nothing when the visitor has asked for nothing', () => {
    // The opening state of every conversation. An empty frame, or a "no
    // options" message about a question nobody asked, would both be worse than
    // showing nothing at all.
    expect(optionsPanel(response())).toBeNull();
  });

  it('gives a panel once a size has been stated, even with no options in it', () => {
    const view = optionsPanel(response({ want: { targetKwp: 4 } }));
    expect(view).not.toBeNull();
    expect(view?.cards).toEqual([]);
    expect(view?.note).toBe('Tell me about your roof and I will put some options together.');
  });

  it('treats an explicit false as something asked for', () => {
    // `requireBattery: false` is a decision the visitor made, not an absent
    // field: the engine will have answered it, so the panel belongs on screen.
    expect(optionsPanel(response({ want: { requireBattery: false } }))).not.toBeNull();
  });
});

describe('a card line', () => {
  it('leads with the quantity only when it is more than one', () => {
    const many = optionsPanel(
      response({ want: { targetKwp: 4 }, packages: [option({ items: [item({ quantity: 9 })] })] }),
    );
    expect(first(first(many?.cards ?? []).lines).label).toBe('9 × Sunbeam SB-430');

    const single = optionsPanel(response({ want: { targetKwp: 4 }, packages: [option()] }));
    expect(first(first(single?.cards ?? []).lines).label).toBe('Sunbeam SB-430');
  });

  it('describes a panel in watts per panel and a battery in kilowatt hours', () => {
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [
          option({
            items: [
              item({ quantity: 9, powerW: 430, warrantyYears: 25 }),
              item({
                productId: 'b1',
                category: 'battery',
                manufacturer: 'Alpha',
                model: 'Store 5',
                capacityWh: 5000,
              }),
            ],
          }),
        ],
      }),
    );
    const lines = first(view?.cards ?? []).lines;
    expect(first(lines).detail).toBe('430 W per panel · 25-year warranty');
    expect(lines[1]?.detail).toBe('5.0 kWh');
  });

  it('says nothing about a spec the catalogue does not carry', () => {
    // Not "0-year warranty", not a dash: a row that carries nothing gets no
    // detail line, because an invented zero is a fact the installer never gave.
    const view = optionsPanel(response({ want: { targetKwp: 4 }, packages: [option()] }));
    expect(first(first(view?.cards ?? []).lines).detail).toBeNull();
  });

  it('never shows a number without a currency', () => {
    // The route rejects this shape, but a card that printed "120000" for a
    // price would be the worst possible failure of the whole file.
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [option({ items: [item({ priceMinor: 120_000, priceStatus: 'indicative' })] })],
      }),
    );
    const line = first(first(view?.cards ?? []).lines);
    expect(line.price).toBeNull();
    expect(line.priceStatus).toBe('indicative');
  });

  it('formats money in major units with two places', () => {
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [
          option({
            items: [item({ priceMinor: 12_345, priceStatus: 'verified', currency: 'GBP' })],
          }),
        ],
      }),
    );
    expect(first(first(view?.cards ?? []).lines).price).toBe('GBP 123.45');
  });
});

describe('the price labels', () => {
  it('calls a sourced price verified and an unsourced one indicative', () => {
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [
          option({
            items: [
              item({ productId: 'a', priceMinor: 1000, currency: 'GBP', priceStatus: 'verified' }),
              item({
                productId: 'b',
                priceMinor: 2000,
                currency: 'GBP',
                priceStatus: 'indicative',
              }),
            ],
          }),
        ],
      }),
    );
    const lines = first(view?.cards ?? []).lines;
    expect(first(lines).priceLabel).toBe('Verified price');
    expect(lines[1]?.priceLabel).toBe('Indicative price');
  });

  it('carries the row’s own source reference, and nothing when there is none', () => {
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [
          option({
            items: [
              item({ productId: 'a', sourceRef: 'pricelist-2026-09.pdf p.4' }),
              item({ productId: 'b' }),
            ],
          }),
        ],
      }),
    );
    const lines = first(view?.cards ?? []).lines;
    expect(first(lines).source).toBe('pricelist-2026-09.pdf p.4');
    expect(lines[1]?.source).toBeNull();
  });
});

describe('the total', () => {
  it('is shown with its status when every item is priced', () => {
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [option({ totalMinor: 257_000, currency: 'GBP', totalStatus: 'verified' })],
      }),
    );
    const card = first(view?.cards ?? []);
    expect(card.total).toBe('GBP 2570.00');
    expect(card.totalLabel).toBe('Verified price');
    expect(card.totalStatus).toBe('verified');
  });

  it('says why there is no total rather than showing a subtotal', () => {
    const view = optionsPanel(response({ want: { targetKwp: 4 }, packages: [option()] }));
    const card = first(view?.cards ?? []);
    expect(card.total).toBe('No total yet');
    expect(card.totalLabel).toBe('At least one item has no price in the installer’s list.');
  });
});

describe('the card as a whole', () => {
  it('names the first option the best match and numbers the rest', () => {
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [option(), option({ id: 'opt-2', rank: 2 })],
      }),
    );
    expect(first(view?.cards ?? []).rankLabel).toBe('Best match');
    expect(view?.cards[1]?.rankLabel).toBe('Option 2');
  });

  it('carries the four things the plan asks a card to carry', () => {
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [
          option({
            title: 'A 4 kWp roof system',
            reasons: ['Fits the roof you described.'],
            limitations: ['Assumes a south-facing roof.'],
            nextStep: 'Book a survey.',
          }),
        ],
      }),
    );
    const card = first(view?.cards ?? []);
    expect(card.title).toBe('A 4 kWp roof system');
    expect(card.reasons).toEqual(['Fits the roof you described.']);
    expect(card.limitations).toEqual(['Assumes a south-facing roof.']);
    expect(card.nextStep).toBe('Book a survey.');
  });

  it('copies the engine’s lists rather than sharing them', () => {
    // A card that handed back the response's own array would let a later edit
    // of the view mutate the engine's answer.
    const reasons = ['Fits the roof you described.'];
    const view = optionsPanel(
      response({ want: { targetKwp: 4 }, packages: [option({ reasons })] }),
    );
    expect(first(view?.cards ?? []).reasons).not.toBe(reasons);
  });
});

describe('the exclusions', () => {
  it('keeps the first four and drops the tail', () => {
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        exclusions: ['one', 'two', 'three', 'four', 'five'].map((message) => ({
          code: 'over-budget',
          message,
          productIds: [],
        })),
      }),
    );
    expect(view?.exclusions).toEqual(['one', 'two', 'three', 'four']);
  });
});

describe('what no card ever says', () => {
  it('never claims a yield, a generation figure or a saving', () => {
    // The strongest guard in the file. Nothing in the response carries a yield,
    // so nothing here may invent one -- and the way to keep that true is to
    // assert it over every string the whole panel would render.
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [
          option({
            title: 'A 4 kWp roof system',
            summary: 'Nine panels and one inverter.',
            items: [item({ quantity: 9, powerW: 430, warrantyYears: 25 })],
            reasons: ['Fits the roof you described.'],
            limitations: ['Assumes a south-facing roof.'],
            nextStep: 'Book a survey.',
          }),
        ],
        exclusions: [{ code: 'over-budget', message: 'Over the budget you gave.', productIds: [] }],
      }),
    );
    expect(JSON.stringify(view)).not.toMatch(
      /per year|kwh\/year|annual|generat|\bsaving|payback|co2|carbon offset/i,
    );
  });

  it('does not present the panel rating as output', () => {
    const view = optionsPanel(
      response({
        want: { targetKwp: 4 },
        packages: [option({ items: [item({ quantity: 9, powerW: 430 })], systemPowerW: 3870 })],
      }),
    );
    expect(JSON.stringify(view)).toContain('430 W per panel');
    expect(JSON.stringify(view)).not.toMatch(/3870/);
  });
});

describe('the verified-price ink', () => {
  it('is the colour the stylesheet actually paints with', () => {
    expect(styles()).toContain(`color: ${VERIFIED_PRICE_INK}`);
  });

  it('clears AA on the white card it sits on', () => {
    const ink = parseHex(VERIFIED_PRICE_INK);
    const white = parseHex('#ffffff');
    expect(ink).not.toBeNull();
    expect(white).not.toBeNull();
    if (ink === null || white === null) return;
    expect(contrastRatio(ink, white)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
