import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { defaultQuotationSettings, type QuotationSettings } from '@sunny/contracts';

import type { AppliedEffect } from '../src/flow/effects.js';
import { resolveFlow } from '../src/flow/resolve.js';
import { demoPricing } from '../src/journey/pricing.js';
import type { QuoteOptionView } from '../src/journey/quote.js';
import type { RoofAssessmentSummary } from '../src/journey/roof.js';
import { createQuote, type JourneyDeps } from '../src/journey/service.js';
import { reasonsFor } from '../src/proposal/reasons.js';
import { snapshotFor } from '../src/proposal/snapshot.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, TenantRegistry, type Tenant } from '../src/tenants.js';

const TENANT: Tenant = {
  ...DEMO_TENANT,
  websiteUrl: 'https://sunhomes.example',
  config: {
    ...DEMO_TENANT.config,
    companyName: 'Sun Homes',
    primaryColor: '#123456',
    supportContact: { phone: '01603 555 0100', email: 'hello@sunhomes.example' },
  },
};

function summary(): RoofAssessmentSummary {
  return {
    assessmentId: 'ss_snap',
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

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = '';
});

async function setup(lifestyle = 'evening_use') {
  dir = await mkdtemp(join(tmpdir(), 'sunny-snap-'));
  const store = new FileStore(dir);
  const tenants = new TenantRegistry([TENANT]);
  const deps: JourneyDeps = {
    store,
    pricing: { forTenant: () => Promise.resolve(demoPricing()) },
    roof: () => Promise.resolve({ state: 'ready', summary: summary() }),
    now: () => Date.parse('2026-11-09T10:00:00Z'),
    tenant: (id) => tenants.byId(id),
  };
  await store.mergeAnswers(TENANT.id, 's1', {
    journey_assessment_id: 'ss_snap',
    address: '164 Norwich Drive, Norwich',
    roof_confirmed: 'yes',
    roof_shading: 'none',
    property_type: 'semi',
    ownership: 'own',
    usage_source: 'monthly_cost',
    monthly_cost: '120',
    lifestyle,
    tariff_type: 'standard',
    existing_system: 'none',
    motivation: 'reduce_bills',
    budget_band: '10k_15k',
    finance_interest: 'maybe',
  });
  return { deps, tenants, store };
}

const saved = (over: Partial<QuotationSettings> = {}): QuotationSettings => ({
  ...defaultQuotationSettings(),
  version: 1,
  updatedAt: '2026-11-01T00:00:00Z',
  validityDays: 14,
  terms: 'Our terms',
  ...over,
});

describe('the quotation snapshot', () => {
  it('carries the installer settings in force when the quote was made', async () => {
    const { deps, tenants } = await setup();
    const settings = saved();
    await tenants.update(TENANT.id, (t) => ({
      ...t,
      config: { ...t.config, quotation: settings },
    }));
    const result = await createQuote(deps, TENANT.id, 's1');
    if (!result.ok) throw new Error(`not ok: ${result.missing.join()}`);
    expect(result.quote.quotation).toEqual(snapshotFor(tenants.byId(TENANT.id)!, settings));
    expect(result.quote.quotation?.validityDays).toBe(14);
  });

  it('does not change when the settings change afterwards', async () => {
    const { deps, tenants, store } = await setup();
    await tenants.update(TENANT.id, (t) => ({
      ...t,
      config: { ...t.config, quotation: saved() },
    }));
    const result = await createQuote(deps, TENANT.id, 's1');
    if (!result.ok) throw new Error('not ok');
    await tenants.update(TENANT.id, (t) => ({
      ...t,
      config: { ...t.config, quotation: saved({ validityDays: 90, terms: 'Changed' }) },
    }));
    const [stored] = await store.listQuotes(TENANT.id, 's1');
    expect(stored?.quotation?.validityDays).toBe(14);
    expect(stored?.quotation?.terms).toBe('Our terms');
  });

  it('uses the defaults, with the company as signer, when nothing is saved', async () => {
    const { deps, tenants } = await setup();
    const result = await createQuote(deps, TENANT.id, 's1');
    if (!result.ok) throw new Error('not ok');
    const q = result.quote.quotation!;
    expect(q).toEqual(snapshotFor(tenants.byId(TENANT.id)!, undefined));
    expect(q.signer).toEqual({
      name: 'Sun Homes',
      role: '',
      phone: '01603 555 0100',
      email: 'hello@sunhomes.example',
    });
    expect(q.companyName).toBe('Sun Homes');
    expect(q.colour).toBe('#123456');
    expect(q.website).toBe('https://sunhomes.example');
    expect(q.validityDays).toBe(30);
    expect(q.balanceDue).toBe('within 7 days of completion');
  });

  it('uses the saved signer when there is one', () => {
    const signer = { name: 'Ann', role: 'Director', phone: '1', email: 'a@b.c' };
    expect(snapshotFor(TENANT, saved({ signer })).signer).toEqual(signer);
  });

  it('gives the battery its evening-use reason on a real quote', async () => {
    const { deps } = await setup('evening_use');
    const result = await createQuote(deps, TENANT.id, 's1');
    if (!result.ok) throw new Error('not ok');
    expect(Object.values(result.quote.reasons ?? {})).toContain(
      'You told us you use most of your electricity in the evening.',
    );
  });
});

// ─── reasons ─────────────────────────────────────────────────────────────────

function option(lines: { sku: string; label: string }[], battery: string | null): QuoteOptionView {
  return {
    batteryType: battery,
    lineItems: lines.map((l) => ({ ...l, quantity: 1, totalGbp: 1 })),
  } as unknown as QuoteOptionView;
}

const EV_SKU = 'EV-PROJECTEV-7KW-UNTETHERED';

describe('reasonsFor', () => {
  const flow = resolveFlow({
    version: 1,
    updatedAt: '2026-11-09T00:00:00Z',
    steps: [
      {
        kind: 'custom',
        id: 'c_evcar01',
        prompt: 'Do you want a car charger?',
        mode: 'quote',
        answer: 'choice',
        choices: [
          { value: 'yes', label: 'Yes please', effects: [{ kind: 'add', itemKey: EV_SKU }] },
          { value: 'no', label: 'No', effects: [] },
        ],
      },
    ],
  });
  const effects: AppliedEffect[] = [
    { effect: { kind: 'add', itemKey: EV_SKU }, questionId: 'c_evcar01', value: 'yes' },
  ];
  const ev = option(
    [
      { sku: EV_SKU, label: 'Charger' },
      { sku: 'PV-BASE', label: 'Base' },
    ],
    null,
  );

  it('says which answer added the item', () => {
    expect(reasonsFor(effects, flow, { c_evcar01: 'yes' }, ev)).toEqual({
      [EV_SKU]: 'You answered "Yes please" to "Do you want a car charger?".',
    });
  });

  it('reads the preset EV answers', () => {
    expect(reasonsFor([], flow, { lifestyle: 'ev_now' }, ev)[EV_SKU]).toBe(
      'You told us you drive an electric car.',
    );
    expect(reasonsFor([], flow, { lifestyle: 'ev_planned' }, ev)[EV_SKU]).toBe(
      'You told us you are planning an electric car.',
    );
  });

  it('lets a flow-effect reason win over a preset one', () => {
    expect(
      reasonsFor(effects, flow, { c_evcar01: 'yes', lifestyle: 'ev_now' }, ev)[EV_SKU],
    ).toMatch(/^You answered/);
  });

  it('gives the battery its sentence only with evening use', () => {
    const o = option([{ sku: 'BAT-1', label: 'Sigen 8 kWh' }], 'Sigen');
    expect(reasonsFor([], flow, { lifestyle: 'ev_now,evening_use' }, o)['BAT-1']).toBe(
      'You told us you use most of your electricity in the evening.',
    );
    expect(reasonsFor([], flow, { lifestyle: 'ev_now' }, o)['BAT-1']).toBeUndefined();
  });

  it('gives items with no cause no entry', () => {
    const r = reasonsFor(effects, flow, { c_evcar01: 'yes', lifestyle: 'evening_use' }, ev);
    expect(r['PV-BASE']).toBeUndefined();
  });

  it('resolves unset colours to the brand colour and keeps chosen ones', () => {
    const t = new TenantRegistry([TENANT]).byId(TENANT.id)!;
    expect(snapshotFor(t, undefined).colours).toEqual({ rail: '#123456', accent: '#123456' });
    const chosen = saved({ colours: { rail: '#ffe066', accent: null } });
    expect(snapshotFor(t, chosen).colours).toEqual({ rail: '#ffe066', accent: '#123456' });
  });

  it('falls back like the theme when the brand colour is invalid', () => {
    const bad = { ...TENANT, config: { ...TENANT.config, primaryColor: 'nope' } };
    expect(snapshotFor(bad, undefined).colours).toEqual({ rail: '#0f2a3d', accent: '#0f2a3d' });
  });

  it('accepts stored settings saved before colours existed', () => {
    const t = new TenantRegistry([TENANT]).byId(TENANT.id)!;
    const { colours: _c, ...old } = saved();
    const snap = snapshotFor(t, old as unknown as QuotationSettings);
    expect(snap.colours).toEqual({ rail: '#123456', accent: '#123456' });
    expect(snap.validityDays).toBe(14);
  });
});
