import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { getPublishedPriceList, publishExample } from '../src/catalogue/price-list-service.js';
import { catalogueBackedPricing, pricingFromPriceList } from '../src/journey/catalogue-pricing.js';
import { applyProposals, budgetBand, extractAnswers } from '../src/journey/extract.js';
import {
  journeyStatus,
  prefillFromRoof,
  quoteAnswers,
  rejectRoof,
} from '../src/journey/journey.js';
import { demoPricing } from '../src/journey/pricing.js';
import { buildQuote } from '../src/journey/quote.js';
import {
  confirmationPrompt,
  mapRoof,
  panelsForPlane,
  type RoofAssessmentSummary,
} from '../src/journey/roof.js';
import { registerQuoteRoutes, type RoofLookup } from '../src/routes/quote.js';
import { issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, SANDBOX_TENANT, TenantRegistry } from '../src/tenants.js';

/** A semi-detached house in Norwich, shaped like the SunScan adapter's summary. */
function summary(overrides: Partial<RoofAssessmentSummary> = {}): RoofAssessmentSummary {
  return {
    assessmentId: 'ss_test1',
    status: 'succeeded',
    address: '164 Norwich Drive, Norwich',
    postcode: 'NR4 7TJ',
    builtForm: 'semi-detached',
    storeys: 2,
    roofType: 'hipped',
    eaveHeightM: 5.2,
    roofPlanes: [
      // The main plane faces south-west (azimuth 225).
      {
        id: 1,
        pitchDeg: 36,
        azimuthDeg: 225,
        facing: 'SW',
        areaM2: 34,
        widthM: 8.4,
        slopeLengthM: 4.6,
        fillRatio: 0.9,
        usableAreaM2: 26,
        maxPanels: 11,
        suitable: true,
      },
      // North-east: never counted for panels.
      {
        id: 2,
        pitchDeg: 36,
        azimuthDeg: 45,
        facing: 'NE',
        areaM2: 34,
        widthM: 8.4,
        slopeLengthM: 4.6,
        fillRatio: 0.9,
        usableAreaM2: 0,
        maxPanels: 0,
        suitable: false,
      },
      // A small south-east hip.
      {
        id: 3,
        pitchDeg: 36,
        azimuthDeg: 135,
        facing: 'SE',
        areaM2: 9,
        widthM: 4.2,
        slopeLengthM: 3.6,
        fillRatio: 0.5,
        usableAreaM2: 4,
        maxPanels: 2,
        suitable: true,
      },
    ],
    usableRoofAreaM2: 30,
    estimatedMaxPanels: 13,
    mainPlaneId: 1,
    bestFacing: 'SW',
    shadingFlags: ['shading-not-assessed'],
    confidence: { roof: 'measured' },
    reliable: true,
    label: 'Indicative, subject to an on-site survey',
    ...overrides,
  };
}

const PANEL = { widthMm: 1134, heightMm: 1762 };

describe('from the 3D roof to the engine', () => {
  it('maps the main plane and counts panels with SunScan v1’s packing rule', () => {
    const roof = mapRoof(summary(), PANEL);
    expect(roof).toMatchObject({
      pitchDeg: 36,
      mcsOrientationDeg: 45,
      roofType: 'pitched',
      confidence: 'high',
      postcode: 'NR4 7TJ',
    });
    // SW plane: floor((8.4-0.6+0.02)/1.782)=4 cols × floor((4.6-0.6+0.02)/1.154)=3 rows × 0.9 → 10;
    // SE hip: 2 × 2 × 0.5 → 2; the NE plane counts for nothing.
    expect(panelsForPlane(summary().roofPlanes[0]!, PANEL)).toBe(10);
    expect(roof.maxPanelCount).toBe(12);
    expect(roof.assessmentMaxPanels).toBe(13);
  });

  it('does not trust an unreliable fit', () => {
    expect(mapRoof(summary({ reliable: false }), PANEL).confidence).toBe('low');
    expect(mapRoof(summary({ status: 'low-confidence' }), PANEL).confidence).toBe('low');
  });

  it('asks the visitor to confirm the mapped roof rather than describe it', () => {
    const roof = mapRoof(summary(), PANEL);
    expect(confirmationPrompt(roof)).toBe(
      'Your main roof faces south-west at about 35°, with room for roughly 12 panels on the sunnier sides. Does that look right?',
    );
    const answers: Record<string, string> = {
      address: '164 Norwich Drive',
      ...prefillFromRoof({ address: '164 Norwich Drive' }, roof),
    };
    expect(answers['roof_confidence']).toBe('high');
    const view = journeyStatus(answers, roof);
    expect(view.nextQuestionId).toBe('roof_confirmed');
    expect(view.prompt).toBe(confirmationPrompt(roof));
    // The size and direction were measured, so they are not asked; shading always is.
    expect(view.missing).not.toContain('roof_size');
    expect(view.missing).not.toContain('roof_direction');
    expect(view.missing).toContain('roof_shading');
  });

  it('asks the roof questions when the visitor says the mapping is wrong', () => {
    const roof = mapRoof(summary(), PANEL);
    const prefilled = { address: '164 Norwich Drive', ...prefillFromRoof({}, roof) };
    const rejected = rejectRoof(prefilled);
    expect(rejected['roof_confidence']).toBe('low');
    const view = journeyStatus(rejected, roof);
    expect(view.missing).toEqual(expect.arrayContaining(['roof_size', 'roof_direction']));
    // A later prefill does not overturn the visitor's "no".
    const again = { ...rejected, ...prefillFromRoof(rejected, roof) };
    expect(again['roof_confidence']).toBe('low');
  });

  it('keeps asking everything else while the roof is still being assessed', () => {
    const view = journeyStatus({ address: '164 Norwich Drive, Norwich NR4 7TJ' }, null, {
      roofPending: true,
    });
    expect(view.stage).toBe('roof_pending');
    expect(view.nextQuestionId).toBe('roof_shading');
    expect(view.canQuote).toBe(false);
  });

  it('treats a missing assessment as an unmapped roof and asks about it', () => {
    const view = journeyStatus({ address: '1 High St, Norwich NR4 7TJ' }, null);
    expect(view.postcode).toBe('NR4 7TJ');
    expect(view.missing).toEqual(
      expect.arrayContaining(['roof_size', 'roof_direction', 'roof_shading']),
    );
  });
});

describe('several answers from one message', () => {
  it('reads what the visitor volunteered, validated', () => {
    const proposals = extractAnswers(
      "It's a semi, we own it, the bill is about £120 a month and we're getting an electric car next year",
      'property_type',
    );
    const { answers, accepted } = applyProposals({}, proposals);
    expect(answers).toMatchObject({
      property_type: 'semi',
      ownership: 'own',
      usage_source: 'monthly_cost',
      monthly_cost: '120',
      lifestyle: 'ev_planned',
    });
    expect(accepted.length).toBeGreaterThanOrEqual(5);
  });

  it('reads a bare reply only as an answer to the question just asked', () => {
    expect(extractAnswers('yes', 'roof_confirmed')).toEqual([
      { questionId: 'roof_confirmed', value: 'yes' },
    ]);
    expect(extractAnswers('yes', 'tariff_type')).toEqual([]);
    expect(extractAnswers('not sure', 'tariff_type')).toEqual([
      { questionId: 'tariff_type', value: 'unknown' },
    ]);
    expect(extractAnswers('none of those', 'lifestyle')).toEqual([
      { questionId: 'lifestyle', value: 'none' },
    ]);
    expect(extractAnswers('four of us', 'household_size')).toEqual([
      { questionId: 'household_size', value: '4' },
    ]);
  });

  it('takes a correction and drops what it ruled out', () => {
    const first = applyProposals({}, [
      { questionId: 'usage_source', value: 'monthly_cost' },
      { questionId: 'monthly_cost', value: '120' },
    ]);
    const corrected = applyProposals(
      first.answers,
      extractAnswers('there are 4 people in the house', null),
    );
    expect(corrected.answers['usage_source']).toBe('household');
    expect(corrected.answers['household_size']).toBe('4');
    expect(corrected.removed).toContain('monthly_cost');
  });

  it('refuses what the questionnaire would refuse', () => {
    const { rejected } = applyProposals({}, [{ questionId: 'property_type', value: 'castle' }]);
    expect(rejected[0]).toMatchObject({ questionId: 'property_type' });
  });
});

/** Every answer a quote needs, for a confirmed roof. */
function complete(roof = mapRoof(summary(), PANEL)): Record<string, string> {
  return {
    address: '164 Norwich Drive, Norwich',
    ...prefillFromRoof({}, roof),
    roof_confirmed: 'yes',
    roof_shading: 'none',
    property_type: 'semi',
    ownership: 'own',
    usage_source: 'monthly_cost',
    monthly_cost: '120',
    lifestyle: 'ev_planned',
    tariff_type: 'standard',
    existing_system: 'none',
    motivation: 'reduce_bills',
    budget_band: '10k_15k',
    finance_interest: 'maybe',
  };
}

describe('an unreliable roof fit (from the first live run)', () => {
  // Live, Hill Top (a pitched heritage farmhouse) came back as one 200 m² flat
  // plane with room for 89 panels, flagged fit-unreliable. Nothing of that
  // geometry may reach the quote.
  const unreliable = () =>
    mapRoof(
      summary({
        status: 'low-confidence',
        reliable: false,
        roofType: 'flat',
        roofPlanes: [
          {
            id: 1,
            pitchDeg: 0,
            azimuthDeg: null,
            facing: 'flat',
            areaM2: 220,
            widthM: 20,
            slopeLengthM: 11,
            fillRatio: 1,
            usableAreaM2: 200,
            maxPanels: 89,
            suitable: true,
          },
        ],
        usableRoofAreaM2: 200,
        estimatedMaxPanels: 89,
        bestFacing: 'flat',
      }),
      PANEL,
    );

  function answersFor(roofSize: string): Record<string, string> {
    const roof = unreliable();
    return {
      ...complete(roof),
      roof_confirmed: '',
      ...prefillFromRoof({}, roof),
      roof_size: roofSize,
      roof_direction: 'south',
    };
  }

  it('uses the visitor’s answers, not the unreliable geometry', () => {
    const roof = unreliable();
    const qa = quoteAnswers(answersFor('unsure'), roof, demoPricing())!;
    expect(qa).not.toBeNull();
    expect(qa.roof).toMatchObject({ pitchDeg: 35, roofType: 'pitched', confidence: 'low' });
    expect(qa.roof.maxPanelCount).toBe(20);
    expect(qa.roof.maxPanelCount).not.toBe(89);
  });

  it('lets the visitor’s roof size set the panel limit', () => {
    const roof = unreliable();
    const quote = buildQuote({
      id: 'q_unreliable',
      tenantId: 't',
      sessionId: 's',
      createdAt: '2026-10-12T00:00:00Z',
      answers: quoteAnswers(answersFor('medium'), roof, demoPricing())!,
      roof,
      pricing: demoPricing(),
    });
    for (const option of quote.options) {
      expect(option.panelCount).toBeLessThanOrEqual(14);
      // No flat-roof structural survey on a roof nobody measured as flat.
      expect(JSON.stringify(option)).not.toContain('STRUCT-FLATROOF-SURVEY');
    }
  });
});

describe('the quote', () => {
  it('is ready once every applicable question is answered', () => {
    const roof = mapRoof(summary(), PANEL);
    const view = journeyStatus(complete(roof), roof);
    expect(view.missing).toEqual([]);
    expect(view.stage).toBe('quote_ready');
  });

  it('gives three priced options from the installer’s price list, all labelled indicative', () => {
    const roof = mapRoof(summary(), PANEL);
    const pricing = demoPricing();
    const qa = quoteAnswers(complete(roof), roof, pricing)!;
    expect(qa.budgetBandId).toBe('12k_15k');
    const quote = buildQuote({
      id: 'q1',
      tenantId: 't',
      sessionId: 's',
      createdAt: '2026-10-12T00:00:00Z',
      answers: qa,
      roof,
      pricing,
    });
    expect(quote.priced).toBe(true);
    expect(quote.options).toHaveLength(3);
    for (const option of quote.options) {
      expect(option.priceGbp).toBeGreaterThan(0);
      expect(option.panelCount).toBeLessThanOrEqual(12);
      expect(option.priceLabel).toMatch(/Indicative/);
      expect(option.lineItems.some((l) => l.sku === 'ELEC-ADMIN-FEE')).toBe(true);
      expect(option.annualGenerationKwh).toBeGreaterThan(0);
    }
    expect(quote.disclaimer).toMatch(/non-binding/);
    expect(quote.basis).toMatchObject({ mcsZone: expect.any(String), roofConfidence: 'high' });
  });

  it('without a price list, sizes and savings but no prices', () => {
    const roof = mapRoof(summary(), PANEL);
    const qa = quoteAnswers(complete(roof), roof, null)!;
    const quote = buildQuote({
      id: 'q2',
      tenantId: 't',
      sessionId: 's',
      createdAt: '2026-10-12T00:00:00Z',
      answers: qa,
      roof,
      pricing: null,
    });
    expect(quote.priced).toBe(false);
    expect(quote.options).toHaveLength(3);
    for (const option of quote.options) {
      expect(option.priceGbp).toBeNull();
      expect(option.paybackYears).toBeNull();
      expect(option.annualSavingsGbp).toBeGreaterThan(0);
    }
    expect(quote.warnings.join(' ')).toMatch(/specialist will price/);
  });

  it('without a price list, a modest home still gets three different sizes', () => {
    // Live: a low bill put the smaller and mid-sized systems both at four panels.
    const roof = mapRoof(summary(), PANEL);
    const qa = quoteAnswers({ ...complete(roof), monthly_cost: '40' }, roof, null)!;
    const quote = buildQuote({
      id: 'q3',
      tenantId: 't',
      sessionId: 's',
      createdAt: '2026-10-26T00:00:00Z',
      answers: qa,
      roof,
      pricing: null,
    });
    const counts = quote.options.map((o) => o.panelCount);
    expect(counts).toHaveLength(3);
    expect(counts[1]!).toBeGreaterThan(counts[0]!);
    expect(counts[2]!).toBeGreaterThan(counts[1]!);
  });
});

// ─── routes ──────────────────────────────────────────────────────────────────

const SECRET = 'test-secret';
let dir = '';
let apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps) await app.close();
  apps = [];
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function server(
  roofFor: (sessionId: string, id: string) => RoofLookup = () => ({ state: 'none' }),
) {
  dir = await mkdtemp(join(tmpdir(), 'sunny-quote-'));
  const store = new FileStore(dir);
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const code = (error as { code?: string }).code;
    const status =
      code === 'not_found' ? 404 : code === 'unauthorized' ? 401 : code === 'forbidden' ? 403 : 400;
    void reply.code(status).send({ error: { code, message: (error as Error).message } });
  });
  registerQuoteRoutes(app, {
    store,
    tenants: new TenantRegistry([DEMO_TENANT, SANDBOX_TENANT]),
    sessionSecret: SECRET,
    now: () => Date.parse('2026-10-12T10:00:00Z'),
    pricing: { forTenant: (id) => Promise.resolve(id === DEMO_TENANT.id ? demoPricing() : null) },
    roof: (_tenant, sessionId, id) => Promise.resolve(roofFor(sessionId, id)),
  });
  await app.ready();
  apps.push(app);
  return { app, store };
}

function token(tenantId: string, sessionId: string): string {
  return issueSessionToken(
    { tenantId, sessionId, expiresAt: Date.parse('2026-10-13T00:00:00Z') },
    SECRET,
  );
}

describe('the quote routes', () => {
  it('walks the journey from the roof to three priced options', async () => {
    const { app } = await server((sessionId, id) =>
      sessionId === 's1' && id === 'ss_test1'
        ? { state: 'ready', summary: summary() }
        : { state: 'none' },
    );
    const auth = { authorization: `Bearer ${token(DEMO_TENANT.id, 's1')}` };

    let res = await app.inject({
      method: 'POST',
      url: '/v1/quote/journey/answers',
      headers: auth,
      payload: {
        sessionId: 's1',
        assessmentId: 'ss_test1',
        answers: [{ questionId: 'address', value: '164 Norwich Drive, Norwich' }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().journey.nextQuestionId).toBe('roof_confirmed');

    res = await app.inject({
      method: 'POST',
      url: '/v1/quote/journey/answers',
      headers: auth,
      payload: {
        sessionId: 's1',
        text: "yes that's right. It's a semi and we own it, about £120 a month, no shading, getting an EV next year",
      },
    });
    const body = res.json();
    expect(body.accepted.map((a: { questionId: string }) => a.questionId)).toEqual(
      expect.arrayContaining([
        'roof_confirmed',
        'property_type',
        'ownership',
        'monthly_cost',
        'roof_shading',
        'lifestyle',
      ]),
    );

    // Not ready yet: the quote refuses and says what is missing.
    res = await app.inject({
      method: 'POST',
      url: '/v1/quote/options',
      headers: auth,
      payload: { sessionId: 's1' },
    });
    expect(res.statusCode).toBe(400);

    res = await app.inject({
      method: 'POST',
      url: '/v1/quote/journey/answers',
      headers: auth,
      payload: {
        sessionId: 's1',
        answers: [
          { questionId: 'tariff_type', value: 'standard' },
          { questionId: 'existing_system', value: 'none' },
          { questionId: 'motivation', value: 'reduce_bills' },
          { questionId: 'budget_band', value: '10k_15k' },
          { questionId: 'finance_interest', value: 'maybe' },
        ],
      },
    });
    expect(res.json().journey.stage).toBe('quote_ready');

    res = await app.inject({
      method: 'POST',
      url: '/v1/quote/options',
      headers: auth,
      payload: { sessionId: 's1' },
    });
    expect(res.statusCode).toBe(201);
    const quote = res.json();
    expect(quote.options).toHaveLength(3);
    expect(quote.tenantId).toBeUndefined();
    expect(quote.priced).toBe(true);

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/quote/${quote.id}`,
      headers: auth,
    });
    expect(fetched.json().id).toBe(quote.id);
  });

  it('never shows one session’s quote or roof to another tenant or session', async () => {
    const { app, store } = await server((sessionId, id) =>
      sessionId === 's1' && id === 'ss_test1'
        ? { state: 'ready', summary: summary() }
        : { state: 'none' },
    );
    await store.mergeAnswers(DEMO_TENANT.id, 's1', complete());
    const own = await app.inject({
      method: 'POST',
      url: '/v1/quote/options',
      headers: { authorization: `Bearer ${token(DEMO_TENANT.id, 's1')}` },
      payload: { sessionId: 's1' },
    });
    const id = own.json().id as string;

    const otherTenant = await app.inject({
      method: 'GET',
      url: `/v1/quote/${id}`,
      headers: { authorization: `Bearer ${token(SANDBOX_TENANT.id, 's1')}` },
    });
    expect(otherTenant.statusCode).toBe(404);
    const otherSession = await app.inject({
      method: 'GET',
      url: `/v1/quote/${id}`,
      headers: { authorization: `Bearer ${token(DEMO_TENANT.id, 's2')}` },
    });
    expect(otherSession.statusCode).toBe(404);
    // Another session cannot claim this session's assessment either.
    const claim = await app.inject({
      method: 'POST',
      url: '/v1/quote/journey/answers',
      headers: { authorization: `Bearer ${token(DEMO_TENANT.id, 's2')}` },
      payload: { sessionId: 's2', assessmentId: 'ss_test1' },
    });
    expect(claim.statusCode).toBe(404);
  });

  it('prices nothing for an installer without a price list', async () => {
    const { app, store } = await server(() => ({ state: 'ready', summary: summary() }));
    await store.mergeAnswers(SANDBOX_TENANT.id, 's9', complete());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/quote/options',
      headers: { authorization: `Bearer ${token(SANDBOX_TENANT.id, 's9')}` },
      payload: { sessionId: 's9' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().priced).toBe(false);
  });

  it('attaches a quote only to this session’s consented lead', async () => {
    const { app, store } = await server((sessionId) =>
      sessionId === 's1' ? { state: 'ready', summary: summary() } : { state: 'none' },
    );
    await store.mergeAnswers(DEMO_TENANT.id, 's1', complete());
    const auth = { authorization: `Bearer ${token(DEMO_TENANT.id, 's1')}` };
    const quote = (
      await app.inject({
        method: 'POST',
        url: '/v1/quote/options',
        headers: auth,
        payload: { sessionId: 's1' },
      })
    ).json();

    // No lead yet -- i.e. no consent -- so nothing to attach to.
    const early = await app.inject({
      method: 'POST',
      url: `/v1/quote/${quote.id}/lead`,
      headers: auth,
      payload: { sessionId: 's1', leadId: 'lead_missing' },
    });
    expect(early.statusCode).toBe(404);

    const saved = await store.saveLead({
      id: 'lead_1',
      tenantId: DEMO_TENANT.id,
      sessionId: 's1',
      conversationId: null,
      name: 'Alex',
      email: 'alex@example.com',
      phone: null,
      postcode: 'NR4 7TJ',
      summary: 'Wants a quote',
      score: null,
      createdAt: '2026-10-12T10:00:00Z',
    });
    const leadId = (saved as { lead?: { id: string } }).lead?.id ?? 'lead_1';
    const attached = await app.inject({
      method: 'POST',
      url: `/v1/quote/${quote.id}/lead`,
      headers: auth,
      payload: { sessionId: 's1', leadId },
    });
    expect(attached.statusCode).toBe(200);
    expect(attached.json().leadId).toBe(leadId);
  });
});

// ─── the installer's published price list (WS7 catalogue) ────────────────────

describe('pricing from a published price list', () => {
  it('maps the HSEnergy example back onto the engine, matching SunScan v1’s own seed', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'sunny-catalogue-'));
    try {
      const store = new FileStore(tmp);
      await publishExample(store, 't_cat', '2026-10-12T10:00:00Z');
      const list = await getPublishedPriceList(store, 't_cat');
      const mapped = pricingFromPriceList(list!);
      expect(mapped).not.toBeNull();
      const fromList = mapped!.pricing;
      const seed = demoPricing();

      // Same tables, same SKUs, same pounds.
      expect(fromList.catalogue.pvBasePrice.map((r) => [r.panelCount, r.priceGbp])).toEqual(
        seed.catalogue.pvBasePrice.map((r) => [r.panelCount, r.priceGbp]),
      );
      const bat = (p: typeof seed) =>
        p.catalogue.batteries.map((b) => [b.sku, b.tier, b.priceWithSolar, b.priceRetrofit]).sort();
      expect(bat(fromList)).toEqual(bat(seed));
      const pan = (p: typeof seed) =>
        p.catalogue.panels.map((x) => [x.sku, x.upliftType, x.upliftValue, x.productTier]).sort();
      expect(pan(fromList)).toEqual(pan(seed));
      expect(fromList.vatRatePercent).toBeNull(); // the sheet states none; not assumed

      // And the same three prices for the same visitor.
      const roof = mapRoof(summary(), PANEL);
      const quoteWith = (pricing: typeof seed) =>
        buildQuote({
          id: 'q',
          tenantId: 't',
          sessionId: 's',
          createdAt: '2026-10-12T00:00:00Z',
          answers: quoteAnswers(complete(roof), roof, pricing)!,
          roof,
          pricing: { ...pricing, sentinel: null },
        });
      const a = quoteWith(fromList).options.map((o) => [o.panelCount, o.priceGbp]);
      const b = quoteWith(seed).options.map((o) => [o.panelCount, o.priceGbp]);
      expect(a).toEqual(b);
      expect(quoteWith(fromList).options[0]!.priceLabel).toMatch(/VAT as quoted by your installer/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('names a mandatory item the list will not price, instead of inventing a figure', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'sunny-catalogue-'));
    try {
      const store = new FileStore(tmp);
      await publishExample(store, 't_cat', '2026-10-12T10:00:00Z');
      const list = (await getPublishedPriceList(store, 't_cat'))!;
      const bespokeAdmin = {
        ...list,
        items: list.items.map((i) =>
          i.key === 'ELEC-ADMIN-FEE' ? { ...i, pricing: { kind: 'quote_only' as const } } : i,
        ),
      };
      const mapped = pricingFromPriceList(bespokeAdmin)!;
      expect(mapped.pricing.installerPriced).toEqual([
        list.items.find((i) => i.key === 'ELEC-ADMIN-FEE')!.name,
      ]);
      const roof = mapRoof(summary(), PANEL);
      const quote = buildQuote({
        id: 'q',
        tenantId: 't',
        sessionId: 's',
        createdAt: '2026-10-12T00:00:00Z',
        answers: quoteAnswers(complete(roof), roof, mapped.pricing)!,
        roof,
        pricing: mapped.pricing,
      });
      for (const option of quote.options) {
        expect(option.installerPriced.length).toBe(1);
        expect(option.lineItems.some((l) => l.sku === 'ELEC-ADMIN-FEE')).toBe(false);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('gives no prices to a tenant with no published list', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'sunny-catalogue-'));
    try {
      const source = catalogueBackedPricing(new FileStore(tmp));
      expect(await source.forTenant('t_none')).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('answers in the words visitors use', () => {
  it('understands how a visitor names their usage figure', () => {
    expect(extractAnswers('My monthly bill', 'usage_source')).toContainEqual({
      questionId: 'usage_source',
      value: 'monthly_cost',
    });
    expect(extractAnswers('I know my kWh', 'usage_source')).toContainEqual({
      questionId: 'usage_source',
      value: 'manual_kwh',
    });
    expect(extractAnswers('how many people live here', 'usage_source')).toContainEqual({
      questionId: 'usage_source',
      value: 'household',
    });
  });

  it('reads "yes" to the ownership question as owning it', () => {
    expect(extractAnswers('Yes, I own it', 'ownership')).toContainEqual({
      questionId: 'ownership',
      value: 'own',
    });
  });

  it('places a typed budget in its band, a range by its top end', () => {
    expect(budgetBand('about £5,500')).toBe('under_6k');
    expect(budgetBand('£8,000 to £10,000')).toBe('6k_10k');
    expect(budgetBand('around 12k')).toBe('10k_15k');
    expect(budgetBand('20 grand')).toBe('15k_plus');
    expect(budgetBand('not sure')).toBeNull();
    expect(extractAnswers('£8,000 to £10,000', 'budget_band')).toContainEqual({
      questionId: 'budget_band',
      value: '6k_10k',
    });
  });

  it('matches an option by its visitor-facing label', () => {
    expect(extractAnswers('Smart / time-of-use', 'tariff_type')).toContainEqual({
      questionId: 'tariff_type',
      value: 'smart_tou',
    });
  });
});

describe('choosing a package', () => {
  it("records the visitor's pick and returns its month-by-month savings", async () => {
    const { app, store } = await server((sessionId) =>
      sessionId === 's1' ? { state: 'ready', summary: summary() } : { state: 'none' },
    );
    await store.mergeAnswers(DEMO_TENANT.id, 's1', complete());
    const auth = { authorization: `Bearer ${token(DEMO_TENANT.id, 's1')}` };
    const quote = (
      await app.inject({
        method: 'POST',
        url: '/v1/quote/options',
        headers: auth,
        payload: { sessionId: 's1' },
      })
    ).json();
    const pick = quote.options[1];

    const res = await app.inject({
      method: 'POST',
      url: `/v1/quote/${quote.id}/choose`,
      headers: auth,
      payload: { sessionId: 's1', optionId: pick.id },
    });
    expect(res.statusCode).toBe(200);
    const chosen = res.json();
    expect(chosen.chosenOptionId).toBe(pick.id);
    expect(chosen.option.panelCount).toBe(pick.panelCount);
    expect(chosen.timeline.months).toHaveLength(12);
    expect(chosen.timeline.label).toBe('indicative');
    // The months add up to the year, and the year matches the option's card.
    const sum = chosen.timeline.months.reduce(
      (a: number, m: { savingsGbp: number }) => a + m.savingsGbp,
      0,
    );
    expect(sum).toBe(chosen.timeline.year1TotalGbp);
    expect(Math.abs(chosen.timeline.year1TotalGbp - pick.annualSavingsGbp)).toBeLessThanOrEqual(1);
    expect(chosen.timeline.twentyFiveYearTotalGbp).toBeGreaterThan(
      chosen.timeline.year1TotalGbp * 20,
    );

    // The choice is stored on the quote (and so on any lead that carries it).
    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/quote/${quote.id}`,
      headers: auth,
    });
    expect(fetched.json().chosenOptionId).toBe(pick.id);

    // Choosing again replaces it; an option that is not on the quote is refused.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/quote/${quote.id}/choose`,
      headers: auth,
      payload: { sessionId: 's1', optionId: quote.options[0].id },
    });
    expect(again.json().chosenOptionId).toBe(quote.options[0].id);
    const bogus = await app.inject({
      method: 'POST',
      url: `/v1/quote/${quote.id}/choose`,
      headers: auth,
      payload: { sessionId: 's1', optionId: 'no_such_option' },
    });
    expect(bogus.statusCode).toBe(404);
  });

  it("cannot choose on another session's or tenant's quote", async () => {
    const { app, store } = await server((sessionId) =>
      sessionId === 's1' ? { state: 'ready', summary: summary() } : { state: 'none' },
    );
    await store.mergeAnswers(DEMO_TENANT.id, 's1', complete());
    const quote = (
      await app.inject({
        method: 'POST',
        url: '/v1/quote/options',
        headers: { authorization: `Bearer ${token(DEMO_TENANT.id, 's1')}` },
        payload: { sessionId: 's1' },
      })
    ).json();
    for (const [tenantId, sessionId] of [
      [DEMO_TENANT.id, 's2'],
      [SANDBOX_TENANT.id, 's1'],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/quote/${quote.id}/choose`,
        headers: { authorization: `Bearer ${token(tenantId, sessionId)}` },
        payload: { sessionId, optionId: quote.options[0].id },
      });
      expect(res.statusCode).toBe(404);
    }
    const unauth = await app.inject({
      method: 'POST',
      url: `/v1/quote/${quote.id}/choose`,
      payload: { sessionId: 's1', optionId: quote.options[0].id },
    });
    expect(unauth.statusCode).toBe(401);
  });
});
