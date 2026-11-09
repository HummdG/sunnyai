import { describe, expect, it } from 'vitest';

import type { ConversationFlow, FlowEffect, FlowStep } from '@sunny/contracts';

import { HSENERGY_PRICE_LIST_CSV } from '../src/catalogue/examples/hsenergy.js';
import { importPriceList, type PriceList } from '../src/catalogue/price-list.js';
import { effectsFor } from '../src/flow/effects.js';
import { FIXED_START, PRESET_GROUPS, PRESET_WARNINGS } from '../src/flow/presets.js';
import { resolveFlow } from '../src/flow/resolve.js';
import { pricingFromPriceList } from '../src/journey/catalogue-pricing.js';
import { prefillFromRoof, quoteAnswers } from '../src/journey/journey.js';
import { buildQuote, type QuoteRecord } from '../src/journey/quote.js';
import { mapRoof, type RoofAssessmentSummary } from '../src/journey/roof.js';
import { QUESTIONS } from '../src/questionnaire.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

/** The HSEnergy example price list (SunScan v1's own SKUs as item keys). */
const LIST: PriceList = importPriceList(HSENERGY_PRICE_LIST_CSV).list!;
const EV = 'EV-PROJECTEV-7KW-UNTETHERED';
const EV_NAME = LIST.items.find((i) => i.key === EV)!.name;

function summary(): RoofAssessmentSummary {
  return {
    assessmentId: 'ss_effects',
    status: 'succeeded',
    address: '164 Norwich Drive, Norwich',
    postcode: 'NR4 7TJ',
    builtForm: 'semi-detached',
    storeys: 2,
    roofType: 'hipped',
    eaveHeightM: 5.2,
    roofPlanes: [
      {
        id: 1,
        pitchDeg: 36,
        azimuthDeg: 180,
        facing: 'S',
        areaM2: 60,
        widthM: 12,
        slopeLengthM: 5,
        fillRatio: 0.9,
        usableAreaM2: 50,
        maxPanels: 20,
        suitable: true,
      },
    ],
    usableRoofAreaM2: 50,
    estimatedMaxPanels: 20,
    mainPlaneId: 1,
    bestFacing: 'S',
    shadingFlags: ['shading-not-assessed'],
    confidence: { roof: 'measured' },
    reliable: true,
    label: 'Indicative, subject to an on-site survey',
  };
}

const ROOF = mapRoof(summary(), { widthMm: 1134, heightMm: 1762 });

function answersFor(extra: Record<string, string> = {}): Record<string, string> {
  return {
    address: '164 Norwich Drive, Norwich',
    ...prefillFromRoof({}, ROOF),
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
    ...extra,
  };
}

const FIXED = new Set<string>(FIXED_START);
const MEMBERS = new Set(Object.values(PRESET_GROUPS).flat());

/** Sunny's own middle section, as a stored flow lists it. */
function presetSteps(): FlowStep[] {
  return Object.keys(QUESTIONS)
    .filter((id) => !FIXED.has(id) && !MEMBERS.has(id))
    .map((id) => ({ kind: 'preset', id }));
}

function flowOf(steps: FlowStep[]): ConversationFlow {
  return { version: 1, updatedAt: '2026-11-09T00:00:00Z', steps };
}

/** A yes/no quote question whose answers carry the given effects. */
function yesNo(id: string, yes: FlowEffect[], no: FlowEffect[] = []): FlowStep {
  return {
    kind: 'custom',
    id,
    prompt: `Question ${id}?`,
    mode: 'quote',
    answer: 'choice',
    choices: [
      { value: 'yes', label: 'Yes', effects: yes },
      { value: 'no', label: 'No', effects: no },
    ],
  };
}

function quoteFor(
  flow: ConversationFlow | null,
  answers: Record<string, string>,
  list: PriceList = LIST,
): QuoteRecord {
  const pricing = { ...pricingFromPriceList(list)!.pricing, sentinel: null };
  const resolved = resolveFlow(flow);
  const qa = quoteAnswers(answers, ROOF, pricing, resolved);
  expect(qa).not.toBeNull();
  return buildQuote({
    id: 'q_effects',
    tenantId: 't',
    sessionId: 's',
    createdAt: '2026-11-09T00:00:00Z',
    answers: qa!,
    roof: ROOF,
    pricing,
    flow: resolved,
    effects: effectsFor(flow, answers),
  });
}

const lines = (quote: QuoteRecord, sku: string) =>
  quote.options.map((o) => o.lineItems.filter((l) => l.sku === sku));

const EV_FLOW = flowOf([...presetSteps(), yesNo('c_evcar01', [{ kind: 'add', itemKey: EV }])]);

// ─── effects ─────────────────────────────────────────────────────────────────

describe('answers that change the quote', () => {
  it('"yes" to an electric-car question adds the EV charger to every option at its listed price', () => {
    const yes = quoteFor(EV_FLOW, answersFor({ c_evcar01: 'yes' }));
    const no = quoteFor(EV_FLOW, answersFor({ c_evcar01: 'no' }));
    expect(yes.options).toHaveLength(3);
    for (const found of lines(yes, EV)) {
      expect(found).toEqual([{ sku: EV, label: EV_NAME, quantity: 1, totalGbp: 995 }]);
    }
    for (const found of lines(no, EV)) expect(found).toEqual([]);
    for (const option of yes.options) expect(option.inclusions).toContain(EV_NAME);
    // The price is the sum of the listed items, the charger included.
    for (const option of yes.options) {
      const sum = option.lineItems.reduce((total, l) => total + l.totalGbp, 0);
      expect(option.priceGbp).toBe(sum);
    }
  });

  it('an ev_now lifestyle answer can carry the same effect', () => {
    const steps = presetSteps().map((s): FlowStep =>
      s.id === 'lifestyle'
        ? { kind: 'preset', id: 'lifestyle', effects: { ev_now: [{ kind: 'add', itemKey: EV }] } }
        : s,
    );
    const flow = flowOf(steps);
    const picked = quoteFor(flow, answersFor({ lifestyle: 'ev_now,heatpump_planned' }));
    for (const found of lines(picked, EV)) expect(found).toHaveLength(1);
    const notPicked = quoteFor(flow, answersFor({ lifestyle: 'heatpump_planned' }));
    for (const found of lines(notPicked, EV)) expect(found).toHaveLength(0);
  });

  it('removing the battery recalculates savings', () => {
    const batteries = LIST.items.filter((i) => i.category === 'battery').map((i) => i.key);
    const flow = flowOf([
      ...presetSteps(),
      yesNo(
        'c_battery1',
        [],
        batteries.map((itemKey) => ({ kind: 'remove', itemKey })),
      ),
    ]);
    const kept = quoteFor(flow, answersFor({ c_battery1: 'yes' }));
    const removed = quoteFor(flow, answersFor({ c_battery1: 'no' }));
    expect(kept.options.some((o) => o.batteryType !== null)).toBe(true);
    for (const option of removed.options) {
      expect(option.batteryType).toBeNull();
      expect(option.batteryCapacityKwh).toBe(0);
    }
    expect(removed.options.map((o) => o.annualSavingsGbp)).not.toEqual(
      kept.options.map((o) => o.annualSavingsGbp),
    );
    expect(removed.warnings).toEqual(kept.warnings);
  });

  it('swapping panels changes generation and price together', () => {
    const base = 'DMEGC-DM430';
    const better = 'REA-HD96-460';
    const flow = flowOf([
      ...presetSteps(),
      yesNo('c_panels01', [{ kind: 'swap', fromKey: base, toKey: better }]),
    ]);
    const plain = quoteFor(flow, answersFor({ c_panels01: 'no' }));
    const swapped = quoteFor(flow, answersFor({ c_panels01: 'yes' }));
    const baseName = LIST.items.find((i) => i.key === base)!.name;
    const betterName = LIST.items.find((i) => i.key === better)!.name;
    const before = plain.options.find((o) => o.panelType === baseName)!;
    expect(before).toBeDefined();
    const after = swapped.options.find((o) => o.tier === before.tier)!;
    expect(after.panelType).toBe(betterName);
    expect(after.lineItems.some((l) => l.sku === better)).toBe(true);
    expect(after.annualGenerationKwh / after.panelCount).toBeGreaterThan(
      before.annualGenerationKwh / before.panelCount,
    );
    // Same package size, so the higher-wattage panel shows in both figures.
    expect(after.panelCount).toBe(before.panelCount);
    expect(after.annualGenerationKwh).toBeGreaterThan(before.annualGenerationKwh);
    expect(after.priceGbp!).toBeGreaterThan(before.priceGbp!);
  });

  it('a swap whose item is not in a package leaves that package alone', () => {
    const from = 'DMEGC-DM455';
    const flow = flowOf([
      ...presetSteps(),
      yesNo('c_panels02', [{ kind: 'swap', fromKey: from, toKey: 'REA-HD96-460' }]),
    ]);
    const plain = quoteFor(flow, answersFor({ c_panels02: 'no' }));
    const swapped = quoteFor(flow, answersFor({ c_panels02: 'yes' }));
    const fromName = LIST.items.find((i) => i.key === from)!.name;
    const untouched = plain.options.filter((o) => o.panelType !== fromName);
    const touched = plain.options.filter((o) => o.panelType === fromName);
    expect(untouched.length).toBeGreaterThan(0);
    expect(touched.length).toBeGreaterThan(0);
    for (const option of untouched) {
      expect(swapped.options.find((o) => o.tier === option.tier)).toEqual(option);
    }
    for (const option of touched) {
      expect(swapped.options.find((o) => o.tier === option.tier)!.panelType).not.toBe(fromName);
    }
  });

  it('an item added by two answers appears once', () => {
    const flow = flowOf([
      ...presetSteps(),
      yesNo('c_evcar01', [{ kind: 'add', itemKey: EV }]),
      yesNo('c_evcar02', [{ kind: 'add', itemKey: EV }]),
    ]);
    const quote = quoteFor(flow, answersFor({ c_evcar01: 'yes', c_evcar02: 'yes' }));
    for (const found of lines(quote, EV))
      expect(found).toEqual([expect.objectContaining({ quantity: 1 })]);
  });

  it('remove after add in flow order removes it', () => {
    const flow = flowOf([
      ...presetSteps(),
      yesNo('c_evcar01', [{ kind: 'add', itemKey: EV }]),
      yesNo('c_evcar02', [{ kind: 'remove', itemKey: EV }]),
    ]);
    const answers = answersFor({ c_evcar01: 'yes', c_evcar02: 'yes' });
    expect(effectsFor(flow, answers).map((a) => [a.questionId, a.effect.kind])).toEqual([
      ['c_evcar01', 'add'],
      ['c_evcar02', 'remove'],
    ]);
    for (const found of lines(quoteFor(flow, answers), EV)) expect(found).toEqual([]);
    // The other way round, the later add wins.
    const reversed = flowOf([
      ...presetSteps(),
      yesNo('c_evcar02', [{ kind: 'remove', itemKey: EV }]),
      yesNo('c_evcar01', [{ kind: 'add', itemKey: EV }]),
    ]);
    for (const found of lines(quoteFor(reversed, answers), EV)) expect(found).toHaveLength(1);
  });

  it('a stale effect (item gone from the list) is skipped with its warning, and the quote still builds', () => {
    const gone: PriceList = { ...LIST, items: LIST.items.filter((i) => i.key !== EV) };
    const flow = flowOf([
      ...presetSteps(),
      yesNo('c_evcar01', [
        { kind: 'add', itemKey: EV },
        { kind: 'remove', itemKey: 'ELEC-ADMIN-FEE' },
      ]),
    ]);
    const quote = quoteFor(flow, answersFor({ c_evcar01: 'yes' }), gone);
    expect(quote.priced).toBe(true);
    expect(quote.options).toHaveLength(3);
    for (const found of lines(quote, EV)) expect(found).toEqual([]);
    const admin = LIST.items.find((i) => i.key === 'ELEC-ADMIN-FEE')!.name;
    expect(quote.warnings).toContain(
      `${EV} could not be added from your answers, so your installer will confirm it.`,
    );
    // A mandatory item is never an effect's target.
    expect(quote.warnings).toContain(
      `${admin} could not be removed from your answers, so your installer will confirm it.`,
    );
    for (const found of lines(quote, 'ELEC-ADMIN-FEE')) expect(found).toHaveLength(1);
    // Each warning once, however many packages it touched.
    expect(new Set(quote.warnings).size).toBe(quote.warnings.length);
  });

  it('a swap with a base-price item on either side is skipped with its warning', () => {
    const flow = flowOf([
      ...presetSteps(),
      yesNo('c_pvbase01', [{ kind: 'swap', fromKey: 'DMEGC-DM430', toKey: 'PV-BASE' }]),
    ]);
    const plain = quoteFor(flow, answersFor({ c_pvbase01: 'no' }));
    const quote = quoteFor(flow, answersFor({ c_pvbase01: 'yes' }));
    expect(quote.options).toEqual(plain.options);
    expect(quote.warnings).toContain(
      'PV-BASE could not be swapped from your answers, so your installer will confirm it.',
    );
  });
});

// ─── removed presets ─────────────────────────────────────────────────────────

describe('a conversation without some of Sunny’s questions', () => {
  it('a flow with every price-dependent preset removed still quotes, with estimatedFrom listing them', () => {
    const dependent = new Set(Object.keys(PRESET_WARNINGS));
    const flow = flowOf(presetSteps().filter((s) => !dependent.has(s.id)));
    const answers = Object.fromEntries(
      Object.entries(answersFor()).filter(
        ([id]) =>
          !dependent.has(id) && !['annual_kwh', 'monthly_cost', 'household_size'].includes(id),
      ),
    );
    const quote = quoteFor(flow, answers);
    expect(quote.priced).toBe(true);
    expect(quote.options).toHaveLength(3);
    for (const option of quote.options) expect(option.priceGbp).toBeGreaterThan(0);
    expect([...quote.estimatedFrom].sort()).toEqual([...dependent].sort());
  });

  it('the default flow’s quote equals today’s quote for the same answers', () => {
    const pricing = { ...pricingFromPriceList(LIST)!.pricing, sentinel: null };
    const answers = answersFor();
    const common = {
      id: 'q',
      tenantId: 't',
      sessionId: 's',
      createdAt: '2026-11-09T00:00:00Z',
      roof: ROOF,
      pricing,
    };
    const today = buildQuote({ ...common, answers: quoteAnswers(answers, ROOF, pricing)! });
    const viaFlow = buildQuote({
      ...common,
      answers: quoteAnswers(answers, ROOF, pricing, resolveFlow(null))!,
      flow: resolveFlow(null),
      effects: effectsFor(null, answers),
    });
    expect(viaFlow).toEqual(today);
    expect(today.estimatedFrom).toEqual([]);
  });

  it('a quote with removed presets tells the visitor which figures are typical values', () => {
    const flow = flowOf(
      presetSteps().filter((s) => s.id !== 'roof_shading' && s.id !== 'usage_source'),
    );
    const answers = answersFor();
    for (const id of ['roof_shading', 'usage_source', 'monthly_cost']) delete answers[id];
    const quote = quoteFor(flow, answers);
    expect(quote.estimatedFrom).toEqual(['roof_shading', 'usage_source']);
    expect(quote.warnings).toContain(
      'Some figures use typical values because your installer does not ask about roof shading and electricity use.',
    );
  });
});
