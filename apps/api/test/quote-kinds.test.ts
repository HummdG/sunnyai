import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { quoteCardSchema } from '@sunny/contracts';
import type { HeatPumpEstimate } from '@sunny/heat-pump-engine';
import { BATTERY_DISCLAIMER } from '@sunny/quote-engine';

import { quoteFacts } from '../src/channels/email/followup.js';
import { batteryPaybackYears, type BatteryQuoteRecord } from '../src/journey/battery/record.js';
import type { HeatPumpQuoteRecord } from '../src/journey/heat-pump/record.js';
import { hasProposal, isSolarRecord, quoteKind } from '../src/journey/quote-kinds.js';
import { demoPricing } from '../src/journey/pricing.js';
import type { QuoteRecord } from '../src/journey/quote.js';
import { toQuoteCard } from '../src/journey/service.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { registerProposalRoutes } from '../src/routes/proposal.js';
import { registerQuoteRoutes } from '../src/routes/quote.js';
import { issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, SANDBOX_TENANT, TenantRegistry } from '../src/tenants.js';

const SECRET = 'test-secret';
const NOW = Date.parse('2026-11-10T10:00:00Z');
let dir = '';
let apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps) await app.close();
  apps = [];
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = '';
});

async function freshStore(): Promise<FileStore> {
  dir = await mkdtemp(join(tmpdir(), 'sunny-quote-kinds-'));
  return new FileStore(dir);
}

/** A solar quote row as stored before quotes came in kinds: no `kind`. */
function legacySolar(): QuoteRecord {
  return {
    id: 'q_solar_1',
    tenantId: DEMO_TENANT.id,
    sessionId: 's1',
    createdAt: '2026-10-12T10:00:00.000Z',
    assessmentId: null,
    priced: true,
    pricing: {
      label: 'Demo price list',
      version: '1',
      priceStatus: 'indicative',
      vatRatePercent: 0,
      currency: 'GBP',
    },
    basis: {
      postcode: 'NR4 7TJ',
      regionName: 'East of England',
      mcsZone: '2',
      annualKwh: 3500,
      importPence: 24.5,
      exportPence: 15,
      irradianceKwhPerM2: 1000,
      roofMaxPanels: 12,
      pitchDeg: 36,
      mcsOrientationDeg: 45,
      shadingLoss: 0,
      budgetMaxGbp: null,
      roofConfidence: 'high',
    },
    options: [
      {
        id: 'opt_a',
        label: 'Recommended',
        isRecommended: true,
        headline: '10 panels with a 5 kWh battery',
        bestSuitedTo: 'Most homes',
        tier: 'mid',
        panelCount: 10,
        panelType: 'Panel 430',
        inverterType: 'Hybrid 5kW',
        batteryType: 'Battery 5',
        batteryCapacityKwh: 5,
        systemKwp: 4.3,
        priceGbp: 7200,
        priceIncVatGbp: 7200,
        priceLabel: 'Indicative price, 0% VAT',
        lineItems: [{ sku: 'p430', label: 'Panel 430', quantity: 10, totalGbp: 2000 }],
        annualGenerationKwh: 3900,
        selfConsumptionRate: 0.7,
        annualSavingsGbp: 820,
        paybackYears: 8.8,
        co2TonnesPerYear: 0.8,
        inclusions: ['Scaffolding'],
        warnings: [],
        aboveBudget: false,
        roofLimited: true,
        installerPriced: ['Bird mesh'],
        sentinel: { upliftPercent: 8, annualSavingsGbp: 885, paybackYears: 8.4, addedCostGbp: 0 },
      },
    ],
    recommendedId: 'opt_a',
    warnings: [],
    estimatedFrom: [],
    disclaimer: 'Indicative and non-binding.',
    leadId: null,
  };
}

function estimate(): HeatPumpEstimate {
  return {
    floorAreaM2: 90,
    floorAreaAssumed: false,
    peakHeatLossKw: 6.2,
    annualSpaceHeatKwh: 9800,
    annualHotWaterKwh: 2400,
    recommendedKw: 7,
    scop: 3.2,
    runningCost: {
      currentGbp: 1150,
      heatPumpGbp: 940,
      fuelPencePerKwh: 6.3,
      elecPencePerKwh: 24.5,
      boilerEfficiency: 0.85,
    },
    bus: { eligible: true, amountGbp: 7500, reasons: [] },
    nation: 'england',
    warnings: [],
    assumptions: [],
  };
}

function heatPump(overrides: Partial<HeatPumpQuoteRecord> = {}): HeatPumpQuoteRecord {
  return {
    kind: 'heat_pump',
    id: 'q_hp_1',
    tenantId: DEMO_TENANT.id,
    sessionId: 's1',
    createdAt: '2026-11-10T10:00:00.000Z',
    priced: true,
    pricing: {
      label: 'Demo price list',
      version: '1',
      priceStatus: 'indicative',
      vatRatePercent: 0,
      currency: 'GBP',
    },
    estimate: estimate(),
    postcode: 'NR4 7TJ',
    options: [
      {
        id: 'hp_7',
        label: 'Recommended',
        isRecommended: true,
        headline: 'A 7 kW air source heat pump',
        outputKw: 7,
        unitName: 'Air source 7kW',
        priceGbp: 12500,
        grantGbp: 7500,
        priceAfterGrantGbp: 5000,
        priceLabel: 'Indicative price, 0% VAT',
        lineItems: [{ sku: 'hp7', label: 'Air source 7kW', quantity: 1, totalGbp: 8000 }],
        runningCostGbp: 940,
        currentCostGbp: 1150,
        annualSavingsGbp: 210,
        inclusions: ['Commissioning'],
        warnings: [],
        installerPriced: false,
      },
    ],
    recommendedId: 'hp_7',
    warnings: [],
    disclaimer: 'Indicative and non-binding.',
    leadId: null,
    ...overrides,
  };
}

function battery(overrides: Partial<BatteryQuoteRecord> = {}): BatteryQuoteRecord {
  return {
    kind: 'battery',
    id: 'q_bat_1',
    tenantId: DEMO_TENANT.id,
    sessionId: 's1',
    createdAt: '2026-11-10T10:00:00.000Z',
    priced: true,
    pricing: {
      label: 'Battery quote',
      version: '1',
      priceStatus: 'indicative',
      vatRatePercent: 0,
      currency: 'GBP',
    },
    estimate: {
      pvKwp: 4,
      pvKwpAssumed: false,
      annualGenerationKwh: 3800,
      annualUseKwh: 3500,
      importPence: 24.5,
      exportPence: 15,
      offPeakPence: 8,
      peakPence: 28,
      recommendedKwh: 5,
      warnings: [],
      assumptions: [],
    },
    postcode: 'NR4 7TJ',
    tariff: 'smart_tou',
    options: [
      {
        id: 'bat_5',
        label: 'Recommended',
        isRecommended: true,
        headline: 'A 5 kWh battery',
        capacityKwh: 5,
        batteryName: 'Battery 5',
        priceGbp: 3200,
        priceLabel: 'Indicative price, 0% VAT',
        lineItems: [{ sku: 'bat5', label: 'Battery 5', quantity: 1, totalGbp: 3200 }],
        annualSavingsGbp: 400,
        selfUseSavingGbp: 150,
        shiftSavingGbp: 250,
        paybackYears: 8,
        warnings: [],
        installerPriced: false,
      },
    ],
    recommendedId: 'bat_5',
    warnings: [],
    disclaimer: BATTERY_DISCLAIMER,
    leadId: null,
    ...overrides,
  };
}

describe('quote kinds in the store', () => {
  it('round-trips a battery record', async () => {
    const store = await freshStore();
    const row = battery();
    await store.saveQuote(row);
    const got = await store.getQuote(DEMO_TENANT.id, row.id);
    expect(got).toEqual(row);
    expect(got && isSolarRecord(got)).toBe(false);
    expect(got && quoteKind(got)).toBe('battery');
    expect(got && hasProposal(got)).toBe(false);
    expect(await store.listQuotes(DEMO_TENANT.id, 's1')).toEqual([row]);
  });

  it('round-trips a legacy solar row with no kind, unchanged', async () => {
    const store = await freshStore();
    const row = legacySolar();
    await store.saveQuote(row);
    const got = await store.getQuote(DEMO_TENANT.id, row.id);
    expect(got).toEqual(row);
    expect(got && 'kind' in got).toBe(false);
    expect(got && isSolarRecord(got)).toBe(true);
    expect(got && quoteKind(got)).toBe('solar');
    expect(await store.listQuotes(DEMO_TENANT.id, 's1')).toEqual([row]);
  });

  it('round-trips a heat pump record', async () => {
    const store = await freshStore();
    const row = heatPump();
    await store.saveQuote(row);
    const got = await store.getQuote(DEMO_TENANT.id, row.id);
    expect(got).toEqual(row);
    expect(got && isSolarRecord(got)).toBe(false);
    expect(got && quoteKind(got)).toBe('heat_pump');
    expect(await store.listQuotes(DEMO_TENANT.id, 's1')).toEqual([row]);
  });
});

describe('quote cards by kind', () => {
  it('maps a legacy solar row exactly as before', () => {
    expect(toQuoteCard(legacySolar(), { emailAvailable: false })).toEqual({
      quoteId: 'q_solar_1',
      priced: true,
      disclaimer: 'Indicative and non-binding.',
      proposalAvailable: true,
      emailAvailable: false,
      options: [
        {
          id: 'opt_a',
          label: 'Recommended',
          isRecommended: true,
          headline: '10 panels with a 5 kWh battery',
          panelCount: 10,
          systemKwp: 4.3,
          batteryType: 'Battery 5',
          batteryCapacityKwh: 5,
          priceGbp: 7200,
          priceLabel: 'Indicative price, 0% VAT',
          annualGenerationKwh: 3900,
          annualSavingsGbp: 820,
          paybackYears: 8.8,
          aboveBudget: false,
          roofLimited: true,
          installerPriced: ['Bird mesh'],
          sentinel: { upliftPercent: 8, annualSavingsGbp: 885, paybackYears: 8.4 },
        },
      ],
    });
  });

  it('maps a heat pump record to a heat pump card the contract accepts', () => {
    const card = toQuoteCard(heatPump(), { emailAvailable: true });
    expect(card).toEqual({
      kind: 'heat_pump',
      quoteId: 'q_hp_1',
      priced: true,
      disclaimer: 'Indicative and non-binding.',
      proposalAvailable: true,
      emailAvailable: true,
      options: [
        {
          id: 'hp_7',
          label: 'Recommended',
          isRecommended: true,
          headline: 'A 7 kW air source heat pump',
          outputKw: 7,
          priceGbp: 12500,
          grantGbp: 7500,
          grantStatus: 'eligible',
          priceAfterGrantGbp: 5000,
          priceLabel: 'Indicative price, 0% VAT',
          runningCostGbp: 940,
          currentCostGbp: 1150,
          annualSavingsGbp: 210,
        },
      ],
    });
    expect(quoteCardSchema.parse(card)).toEqual(card);
  });

  it('maps a battery record to a battery card the contract accepts', () => {
    const card = toQuoteCard(battery(), { emailAvailable: true });
    expect(card).toEqual({
      kind: 'battery',
      quoteId: 'q_bat_1',
      priced: true,
      disclaimer: BATTERY_DISCLAIMER,
      // No battery PDF yet.
      proposalAvailable: false,
      emailAvailable: true,
      options: [
        {
          id: 'bat_5',
          label: 'Recommended',
          isRecommended: true,
          headline: 'A 5 kWh battery',
          capacityKwh: 5,
          priceGbp: 3200,
          priceLabel: 'Indicative price, 0% VAT',
          annualSavingsGbp: 400,
          shiftSavingGbp: 250,
          paybackYears: 8,
        },
      ],
    });
    expect(quoteCardSchema.parse(card)).toEqual(card);
    const priced = toQuoteCard(
      battery({
        options: battery().options.map((o) => ({
          ...o,
          priceGbp: null,
          paybackYears: null,
          installerPriced: true,
          warnings: ['An extra unit is needed.'],
        })),
      }),
    );
    expect(priced.options[0]).toMatchObject({
      priceGbp: null,
      paybackYears: null,
      installerPriced: true,
      warnings: ['An extra unit is needed.'],
    });
    expect(quoteCardSchema.parse(priced)).toEqual(priced);
  });

  it('parses heat pump cards as before, and rejects a battery card with heat pump options', () => {
    const hp = toQuoteCard(heatPump(), { emailAvailable: true });
    expect(quoteCardSchema.parse(hp)).toEqual(hp);
    expect(quoteCardSchema.safeParse({ ...hp, kind: 'battery' }).success).toBe(false);
  });

  it('parses an old solar card without a kind as solar', () => {
    const old = toQuoteCard(legacySolar(), { emailAvailable: false });
    const parsed = quoteCardSchema.parse(old);
    expect(parsed).toEqual(old);
    expect(parsed.kind).toBeUndefined();
    // A solar card that names its kind parses too; a mismatched one does not.
    expect(quoteCardSchema.safeParse({ ...old, kind: 'solar' }).success).toBe(true);
    expect(quoteCardSchema.safeParse({ ...old, kind: 'heat_pump' }).success).toBe(false);
  });
});

describe('email follow-up facts', () => {
  it('describes a heat pump quote by output, price and grant', () => {
    const facts = quoteFacts(heatPump({ chosenOptionId: 'hp_7' }));
    expect(facts).toContain('kW heat pump');
    expect(facts).toContain(
      '- Recommended: 7 kW heat pump, £12,500 (Indicative price, 0% VAT), Boiler Upgrade Scheme grant £7,500 [the one they chose, recommended]',
    );
    expect(facts).toContain('Quote for NR4 7TJ:');
  });

  it('carries the grant status: may apply when unsure, none when not eligible', () => {
    const unsure = heatPump();
    unsure.estimate = { ...unsure.estimate, bus: { ...unsure.estimate.bus, eligible: 'unsure' } };
    unsure.options = unsure.options.map((o) => ({ ...o, grantGbp: 0, priceAfterGrantGbp: 12500 }));
    expect(quoteFacts(unsure)).toContain(
      '7 kW heat pump, £12,500 (Indicative price, 0% VAT), Boiler Upgrade Scheme grant may apply',
    );
    const none = heatPump();
    none.estimate = { ...none.estimate, bus: { ...none.estimate.bus, eligible: false } };
    none.options = none.options.map((o) => ({ ...o, grantGbp: 0, priceAfterGrantGbp: 12500 }));
    expect(quoteFacts(none)).toContain(
      '7 kW heat pump, £12,500 (Indicative price, 0% VAT), no Boiler Upgrade Scheme grant',
    );
  });

  it('describes a battery quote by capacity, price and saving', () => {
    const facts = quoteFacts(battery({ chosenOptionId: 'bat_5' }));
    expect(facts).toContain('kWh battery');
    expect(facts).toBe(
      [
        'Quote for NR4 7TJ:',
        '- Recommended: 5 kWh battery, £3,200 (Indicative price, 0% VAT), about £400 saved a year [the one they chose, recommended]',
        BATTERY_DISCLAIMER,
      ].join('\n'),
    );
  });

  it('describes a solar quote as before', () => {
    expect(quoteFacts(legacySolar())).toBe(
      [
        'Quote for NR4 7TJ:',
        '- Recommended: 10 panels (4.3 kWp), 5 kWh battery, £7,200 (Indicative price, 0% VAT), about £820 saved a year [recommended]',
        'Indicative and non-binding.',
      ].join('\n'),
    );
  });
});

describe('quote routes with a heat pump quote', () => {
  async function server() {
    const store = await freshStore();
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      const code = (error as { code?: string }).code;
      const status =
        code === 'not_found'
          ? 404
          : code === 'unauthorized'
            ? 401
            : code === 'forbidden'
              ? 403
              : 400;
      void reply.code(status).send({ error: { code, message: (error as Error).message } });
    });
    const tenants = new TenantRegistry([DEMO_TENANT, SANDBOX_TENANT]);
    registerQuoteRoutes(app, {
      store,
      tenants,
      sessionSecret: SECRET,
      now: () => NOW,
      pricing: { forTenant: () => Promise.resolve(demoPricing()) },
      roof: () => Promise.resolve({ state: 'none' }),
    });
    registerProposalRoutes(app, {
      store,
      tenants,
      portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
      sessionSecret: SECRET,
      now: () => NOW,
      mailer: null,
    });
    await app.ready();
    apps.push(app);
    const auth = {
      authorization: `Bearer ${issueSessionToken(
        { tenantId: DEMO_TENANT.id, sessionId: 's1', expiresAt: NOW + 60_000 },
        SECRET,
      )}`,
    };
    return { app, store, auth };
  }

  it('chooses an option on a heat pump quote and returns it', async () => {
    const { app, store, auth } = await server();
    await store.saveQuote(heatPump());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/quote/q_hp_1/choose',
      headers: auth,
      payload: { sessionId: 's1', optionId: 'hp_7' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ chosen: heatPump().options[0] });
    const saved = await store.getQuote(DEMO_TENANT.id, 'q_hp_1');
    expect(saved?.chosenOptionId).toBe('hp_7');
    expect(saved?.chosenAt).toBe(new Date(NOW).toISOString());
    expect(saved?.kind).toBe('heat_pump');

    const bogus = await app.inject({
      method: 'POST',
      url: '/v1/quote/q_hp_1/choose',
      headers: auth,
      payload: { sessionId: 's1', optionId: 'nope' },
    });
    expect(bogus.statusCode).toBe(404);
  });

  it('chooses an option on a battery quote and returns it', async () => {
    const { app, store, auth } = await server();
    await store.saveQuote(battery());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/quote/q_bat_1/choose',
      headers: auth,
      payload: { sessionId: 's1', optionId: 'bat_5' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ chosen: battery().options[0] });
    const saved = await store.getQuote(DEMO_TENANT.id, 'q_bat_1');
    expect(saved?.chosenOptionId).toBe('bat_5');
    expect(saved?.kind).toBe('battery');
  });

  it('serves a battery quote without a PDF yet', async () => {
    const { app, store, auth } = await server();
    await store.saveQuote(battery());
    const got = await app.inject({ method: 'GET', url: '/v1/quote/q_bat_1', headers: auth });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ kind: 'battery', proposalAvailable: false });
    const pdf = await app.inject({
      method: 'GET',
      url: '/v1/quote/q_bat_1/proposal.pdf',
      headers: auth,
    });
    expect(pdf.statusCode).toBe(404);
  });

  it('serves a heat pump quote with its PDF, the heat pump estimate', async () => {
    const { app, store, auth } = await server();
    await store.saveQuote(heatPump());
    const got = await app.inject({ method: 'GET', url: '/v1/quote/q_hp_1', headers: auth });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ kind: 'heat_pump', proposalAvailable: true });
    expect(got.json().tenantId).toBeUndefined();
    const pdf = await app.inject({
      method: 'GET',
      url: '/v1/quote/q_hp_1/proposal.pdf',
      headers: auth,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(
      'attachment; filename="heat-pump-estimate-NR4-7TJ.pdf"',
    );
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('battery payback', () => {
  it('is price over saving, rounded to the half year', () => {
    expect(batteryPaybackYears(3200, 400)).toBe(8);
    expect(batteryPaybackYears(3300, 400)).toBe(8.5);
    expect(batteryPaybackYears(3000, 400)).toBe(7.5);
  });

  it('is null when unpriced or when nothing is saved', () => {
    expect(batteryPaybackYears(null, 400)).toBeNull();
    expect(batteryPaybackYears(3200, 0)).toBeNull();
  });
});
