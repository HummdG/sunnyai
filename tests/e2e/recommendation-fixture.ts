import type { Page } from '@playwright/test';
import type { RecommendationResponse } from '@sunny/contracts';

/**
 * A recommendation to feed the widget's browser tests.
 *
 * The widget reaches its options two ways -- the visitor typing, and the model
 * calling the tool -- and in both cases it *reads them back* from
 * `GET /v1/recommendations` rather than being handed them over the stream. So a
 * browser test of the card surface needs an answer on that route, and the honest
 * way to produce one is to intercept it: the e2e API has no model credential and
 * no seeded catalogue, and neither of the alternatives is acceptable --
 * inventing one in the server, or asserting against a card nobody can render.
 *
 * Intercepting also lets the fixture hold the awkward cases on purpose. Option
 * two has no total, because one of its rows has no price, which is the case the
 * card has to get right and the one a happy-path fixture would never reach.
 */
export const OPTIONS_FIXTURE: RecommendationResponse = {
  generatedAt: '2026-10-11T09:00:00.000Z',
  catalogue: { products: 12, priceable: 10, currency: 'GBP' },
  want: { targetKwp: 4, currency: 'GBP' },
  constraintsChecked: [
    {
      id: 'inverter-dc-limit',
      description: 'Panels must not exceed the inverter’s maximum DC input power.',
      outcome: 'applied',
      detail: '3870 W against 6000 W.',
    },
  ],
  packages: [
    {
      id: 'opt-vx4k-sb430-9',
      rank: 1,
      title: '9 panels with a 4 kW inverter',
      summary: 'The closest match to a 4 kWp roof with Northwind’s current list.',
      items: [
        {
          productId: 'p-sb430',
          category: 'panel',
          manufacturer: 'Sunbeam',
          model: 'SB-430',
          quantity: 9,
          powerW: 430,
          capacityWh: null,
          priceMinor: 18_500,
          priceStatus: 'verified',
          currency: 'GBP',
          sourceRef: 'Northwind price list 2026-09.pdf p.4',
          warrantyYears: 25,
        },
        {
          productId: 'p-vx4k',
          category: 'inverter',
          manufacturer: 'Voltix',
          model: 'VX-4K',
          quantity: 1,
          powerW: 4000,
          capacityWh: null,
          priceMinor: 95_000,
          priceStatus: 'verified',
          currency: 'GBP',
          sourceRef: 'Northwind price list 2026-09.pdf p.7',
          warrantyYears: 10,
        },
      ],
      totalMinor: 261_500,
      currency: 'GBP',
      totalStatus: 'verified',
      systemPowerW: 3870,
      batteryCapacityWh: null,
      reasons: [
        'Every row is priced in the installer’s own list, so the total is a quote rather than an estimate.',
        'A DC/AC ratio of 0.97, which the inverter’s datasheet covers.',
      ],
      limitations: [
        'It assumes the roof you described faces roughly south.',
        'The price list is dated September 2026 and has not been re-quoted.',
      ],
      nextStep: 'Book a survey and Northwind will confirm the roof and the price.',
    },
    {
      id: 'opt-vx4k-sb500-8',
      rank: 2,
      title: '8 larger panels with the same inverter',
      summary: 'Fewer, larger panels — the same 4 kWp for less racking.',
      items: [
        {
          productId: 'p-sb500',
          category: 'panel',
          manufacturer: 'Sunbeam',
          model: 'SB-500',
          quantity: 8,
          powerW: 500,
          capacityWh: null,
          priceMinor: 21_000,
          priceStatus: 'indicative',
          currency: 'GBP',
          sourceRef: null,
          warrantyYears: null,
        },
        {
          productId: 'p-mount-rail',
          category: 'mounting',
          manufacturer: 'Northwind',
          model: 'Rail kit, 4 m',
          quantity: 4,
          powerW: null,
          capacityWh: null,
          priceMinor: null,
          priceStatus: 'unknown',
          currency: null,
          sourceRef: null,
          warrantyYears: null,
        },
      ],
      totalMinor: null,
      currency: null,
      totalStatus: 'unknown',
      systemPowerW: 4000,
      batteryCapacityWh: null,
      reasons: ['The same DC power from fewer roof penetrations.'],
      limitations: ['The rail kit has no price in the installer’s list yet, so there is no total.'],
      nextStep: 'Ask Northwind to price the rail kit, or take the first option.',
    },
  ],
  exclusions: [
    {
      code: 'over-budget',
      message: 'A 6 kW inverter was over the budget you gave.',
      productIds: ['p-vx6k'],
    },
    {
      code: 'missing-data',
      message: 'Three panels have no wattage, so no size could be checked against them.',
      productIds: [],
    },
  ],
  assumptions: [
    'A 4 kWp system size came from the conversation rather than from a roof measurement.',
  ],
  surveyConfirmed: [],
  note: 'These are the options Northwind’s list can price today.',
};

/**
 * Answer `GET /v1/recommendations` with the fixture.
 *
 * Registered before the panel opens, because the widget asks for its options as
 * soon as it has a session.
 */
export async function stubOptions(page: Page, fixture = OPTIONS_FIXTURE): Promise<void> {
  await page.route('**/v1/recommendations', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });
}
