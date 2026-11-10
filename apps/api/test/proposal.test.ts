import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  defaultQuotationSettings,
  productSchema,
  type Product,
  type QuotationSettings,
} from '@sunny/contracts';
import type { AssessmentRecord } from '@sunny/sunscan-adapter';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import { pinBrandAssets, type StoredBranding } from '../src/branding/meta.js';
import { MemoryBrandAssetStore } from '../src/branding/store.js';
import { HSENERGY_PRICE_LIST_CSV } from '../src/catalogue/examples/hsenergy.js';
import { importPriceList, type PriceList } from '../src/catalogue/price-list.js';
import { priceListToCsv } from '../src/catalogue/price-list-service.js';
import { emptyCatalogueState } from '../src/catalogue/types.js';
import type { ServerConfig } from '../src/config.js';
import { pricingFromPriceList, sentinelConfigFrom } from '../src/journey/catalogue-pricing.js';
import { prefillFromRoof, quoteAnswers } from '../src/journey/journey.js';
import { demoPricing } from '../src/journey/pricing.js';
import { buildQuote, type QuoteRecord } from '../src/journey/quote.js';
import { mapRoof, type RoofAssessmentSummary } from '../src/journey/roof.js';
import { createQuote, type JourneyDeps } from '../src/journey/service.js';
import { proposalDocFor, proposalPdf, renderProposal } from '../src/proposal/index.js';
import { proposalEmailConfigured, type ProposalEmail } from '../src/proposal/mailer.js';
import { snapshotAssetIds, snapshotFor } from '../src/proposal/snapshot.js';
import { warrantiesFor } from '../src/proposal/warranties.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, TenantRegistry, defaultTenants, type Tenant } from '../src/tenants.js';

import { pdfItems, pdfText, type PdfTextItem } from './pdf-text.js';
import { batQuote, hpQuote } from './proposal-fixtures.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';
const PANEL = { widthMm: 1134, heightMm: 1762 };

function roofSummary(): RoofAssessmentSummary {
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
      {
        id: 1,
        pitchDeg: 36,
        azimuthDeg: 180,
        facing: 'S',
        areaM2: 34,
        widthM: 8.4,
        slopeLengthM: 4.6,
        fillRatio: 0.9,
        usableAreaM2: 26,
        maxPanels: 11,
        suitable: true,
      },
    ],
    usableRoofAreaM2: 26,
    estimatedMaxPanels: 11,
    mainPlaneId: 1,
    bestFacing: 'S',
    shadingFlags: ['shading-not-assessed'],
    confidence: { roof: 'measured' },
    reliable: true,
    label: 'Indicative, subject to an on-site survey',
  };
}

function answers(tariff = 'smart_tou', lifestyle = 'ev_now'): Record<string, string> {
  const roof = mapRoof(roofSummary(), PANEL);
  return {
    address: '164 Norwich Drive, Norwich',
    ...prefillFromRoof({}, roof),
    roof_confirmed: 'yes',
    roof_shading: 'none',
    property_type: 'semi',
    ownership: 'own',
    usage_source: 'monthly_cost',
    monthly_cost: '120',
    lifestyle,
    tariff_type: tariff,
    existing_system: 'none',
    motivation: 'reduce_bills',
    budget_band: '10k_15k',
    finance_interest: 'maybe',
  };
}

function hsenergy(): PriceList {
  const { list, issues } = importPriceList(HSENERGY_PRICE_LIST_CSV);
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  return list!;
}

function quoteWith(pricing: ReturnType<typeof demoPricing> | null, id = 'q_test_1'): QuoteRecord {
  const roof = mapRoof(roofSummary(), PANEL);
  return buildQuote({
    id,
    tenantId: 't',
    sessionId: 's',
    createdAt: '2026-10-12T00:00:00Z',
    answers: quoteAnswers(answers(), roof, pricing)!,
    roof,
    pricing,
  });
}

describe('Sentinel on the price list', () => {
  it('reads from CSV rows and round-trips through the export', () => {
    const list = hsenergy();
    expect(list.sentinel).toMatchObject({
      enabled: true,
      basePercent: 12,
      capPercent: 30,
      noBatteryPercent: 40,
      batteryRequiredForFullUplift: true,
      addedCostMinor: 0,
    });
    expect(list.sentinel!.tariffPercent['smart_tou']).toBe(8);
    expect(list.sentinel!.lifestylePercent['ev_planned']).toBe(1.5);
    const again = importPriceList(priceListToCsv(list)).list!;
    expect(again.sentinel).toEqual(list.sentinel);
  });

  it('reports a bad setting by row instead of guessing', () => {
    const csv = [
      'Category,Key,Name,Pricing,Amount,Percent,From,Mandatory,Currency',
      'pv,PV-BASE,PV,table,£4000,,1,,',
      'mounting,MOUNT,Mount,per_unit,£30,,,,',
      'sentinel,base,Base,,,150,,,',
      'sentinel,turbo,Turbo,,,5,,,',
    ].join('\n');
    const messages = importPriceList(csv).issues.map((i) => i.message);
    expect(messages.some((m) => /between 0 and 100/.test(m))).toBe(true);
    expect(messages.some((m) => /"turbo" is not a Sentinel setting/.test(m))).toBe(true);
  });

  it('is off when a list has no sentinel rows, or switches it off', () => {
    expect(sentinelConfigFrom(null)).toBeNull();
    expect(sentinelConfigFrom({ ...hsenergy().sentinel!, enabled: false })).toBeNull();
  });

  it("maps to exactly SunScan v1's seed configuration for HSEnergy", async () => {
    const fixture = JSON.parse(
      await readFile(join(ROOT, 'fixtures', 'pricing', 'hsenergy-demo-pricelist.json'), 'utf8'),
    ) as { config: { sentinel: Record<string, unknown> } };
    const mapped = sentinelConfigFrom(hsenergy().sentinel)!;
    const v1 = fixture.config.sentinel;
    expect(mapped.baseUpliftPercent).toBeCloseTo(v1['baseUpliftPercent'] as number, 10);
    expect(mapped.capUpliftPercent).toBeCloseTo(v1['capUpliftPercent'] as number, 10);
    expect(mapped.noBatteryUpliftFactor).toBeCloseTo(v1['noBatteryUpliftFactor'] as number, 10);
    expect(mapped.batteryRequiredForFullUplift).toBe(v1['batteryRequiredForFullUplift']);
    for (const [k, v] of Object.entries(v1['tariffModifiers'] as Record<string, number>)) {
      expect(mapped.tariffModifiers[k]).toBeCloseTo(v, 10);
    }
    for (const [k, v] of Object.entries(v1['lifestyleBonus'] as Record<string, number>)) {
      expect(mapped.lifestyleBonus[k]).toBeCloseTo(v, 10);
    }
  });
});

describe('Sentinel in quotes', () => {
  it('reproduces v1: the published HSEnergy list gives the seed fixture’s Sentinel figures', () => {
    const fromCatalogue = quoteWith(pricingFromPriceList(hsenergy())!.pricing);
    const fromV1Seed = quoteWith(demoPricing());
    for (const [i, option] of fromCatalogue.options.entries()) {
      const v1 = fromV1Seed.options[i]!;
      expect(option.sentinel).not.toBeNull();
      expect(option.sentinel).toEqual(v1.sentinel);
    }
    // Smart tariff + EV: the uplift is above the base and within the cap.
    const uplifts = fromCatalogue.options.map((o) => o.sentinel!.upliftPercent);
    expect(Math.max(...uplifts)).toBeGreaterThan(12);
    expect(Math.max(...uplifts)).toBeLessThanOrEqual(30);
  });

  it('is absent, and prices are unchanged, when the list does not offer it', () => {
    const list = hsenergy();
    const on = quoteWith(pricingFromPriceList(list)!.pricing);
    const off = quoteWith(pricingFromPriceList({ ...list, sentinel: null })!.pricing);
    for (const option of off.options) expect(option.sentinel).toBeNull();
    expect(off.options.map((o) => o.priceGbp).sort()).toEqual(
      on.options.map((o) => o.priceGbp).sort(),
    );
    for (const option of off.options) {
      const same = on.options.find((o) => o.id === option.id);
      if (same) expect(same.annualSavingsGbp).toBe(option.annualSavingsGbp);
    }
  });
});

// ─── the quotation PDF ───────────────────────────────────────────────────────

const ASSETS = join(import.meta.dirname, '..', 'assets');
const SAMPLE_SPEC = new Uint8Array(readFileSync(join(ASSETS, 'sample', 'house.spec.json')));
const SAMPLE_SUMMARY = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'sample-assessment-summary.json'), 'utf8'),
) as AssessmentRecord['summary'];

function tenantWith(settings?: QuotationSettings, over: Partial<Tenant['config']> = {}): Tenant {
  return {
    ...DEMO_TENANT,
    websiteUrl: 'https://brightside.example',
    config: {
      ...DEMO_TENANT.config,
      companyName: 'Brightside Solar',
      primaryColor: '#ff7900',
      supportContact: { phone: '01632 960123', email: 'hello@brightside.example' },
      ...(settings ? { quotation: settings } : {}),
      ...over,
    },
  };
}

function settings(over: Partial<QuotationSettings> = {}): QuotationSettings {
  return {
    ...defaultQuotationSettings(),
    version: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

/** Every setting on: deposit, T&Cs, accreditations, letter, signer, colours. */
function everything(): QuotationSettings {
  return settings({
    signer: {
      name: 'Oliver Burnett',
      role: 'Solar adviser',
      phone: '07850 697435',
      email: 'oliver@brightside.example',
    },
    accreditations: { mcsNumber: 'MCS NAP-12345', logoAssetIds: [] },
    sections: { system: true, performance: true, savings: true, terms: true },
    deposit: { kind: 'percent', percent: 25 },
    balanceDue: 'on the day the installation is complete',
    validityDays: 14,
    letter: {
      opening: 'Thank you for asking us about solar.',
      closing: 'We look forward to hearing from you.',
    },
    terms: 'PAYMENT\nThe deposit is due on order.\n\nCANCELLATION\nYou may cancel within 14 days.',
    colours: { rail: '#1d3b2a', accent: '#2f7d4f' },
  });
}

function pdfQuote(tenant: Tenant, over: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
    ...quoteWith(pricingFromPriceList(hsenergy())!.pricing, 'q_pdf_00000001'),
    tenantId: tenant.id,
    sessionId: 'sess_pdf',
    ...over,
  };
}

async function pdfStore(): Promise<FileStore> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-quotation-pdf-'));
  dirs.push(dir);
  return new FileStore(dir);
}

function png(w: number, h: number): Buffer {
  const p = new PNG({ width: w, height: h });
  p.data.fill(120);
  return PNG.sync.write(p);
}

/** The text items equal to `text` in the header band (the top 40pt). */
function inHeader(items: PdfTextItem[], text: string): PdfTextItem[] {
  return items.filter((i) => i.str === text && i.y > 841.89 - 40);
}

describe('the quotation PDF', () => {
  it('is five pages by default, in order, numbered NN / 05', async () => {
    const tenant = tenantWith();
    const quote = pdfQuote(tenant, { quotation: snapshotFor(tenant, undefined) });
    const pdf = await proposalPdf({ store: await pdfStore() }, tenant, quote, null, new Date(NOW));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = await pdfText(pdf);
    expect(pages).toHaveLength(5);
    expect(pages[0]).toContain('Estimate. Final price confirmed after a survey.');
    expect(pages[1]).toMatch(/Your system/);
    expect(pages[2]).toMatch(/A\. Installation data/);
    expect(pages[3]).toMatch(/Cumulative savings/);
    expect(pages[4]).toContain('Estimated quotation');
    pages.forEach((text, i) => expect(text).toContain(`0${i + 1} / 05`));
    expect(pages.join(' ')).toContain('Prepared with Sunny');
    expect(pages[4]).not.toContain('Terms and conditions follow.');
    expect(pages.join(' ')).not.toContain('—');
  });

  it('adds the Terms pages after the quotation when the section is on', async () => {
    const tenant = tenantWith(everything());
    const quote = pdfQuote(tenant, { quotation: snapshotFor(tenant, everything()) });
    const pages = await pdfText(
      await proposalPdf({ store: await pdfStore() }, tenant, quote, null, new Date(NOW)),
    );
    expect(pages.length).toBeGreaterThanOrEqual(6);
    const at = pages.findIndex((p) => p.includes('Estimated quotation'));
    expect(pages.slice(at).join(' ')).toContain('Terms and conditions follow.');
    expect(pages.at(-1)).toContain('You may cancel within 14 days.');
    const n = String(pages.length).padStart(2, '0');
    expect(pages.at(-1)).toContain(`${n} / ${n}`);

    // Terms written but the section off: no Terms page.
    const off = { ...everything(), sections: { ...everything().sections, terms: false } };
    const quiet = await pdfText(
      await proposalPdf(
        { store: await pdfStore() },
        tenant,
        pdfQuote(tenant, { quotation: snapshotFor(tenant, off) }),
        null,
        new Date(NOW),
      ),
    );
    expect(quiet.join(' ')).not.toContain('You may cancel within 14 days.');
    expect(quiet.join(' ')).not.toContain('Terms and conditions follow.');
  });

  it('with system, performance and savings off: cover and quotation, with the options and the MCS block', async () => {
    const off = settings({
      sections: { system: false, performance: false, savings: false, terms: false },
    });
    const tenant = tenantWith(off);
    const quote = pdfQuote(tenant, { quotation: snapshotFor(tenant, off) });
    expect(quote.options.length).toBeGreaterThan(1);
    const pages = await pdfText(
      await proposalPdf({ store: await pdfStore() }, tenant, quote, null, new Date(NOW)),
    );
    const all = pages.join(' ');
    expect(pages[0]).toContain('Estimate. Final price confirmed after a survey.');
    expect(pages[1]).toContain('Estimated quotation');
    expect(all).toContain('Other options we looked at');
    expect(all).toMatch(/MCS performance estimate/i);
    expect(all).not.toMatch(/A\. Installation data/);
    expect(all).not.toMatch(/Cumulative savings/);

    // All on: the options sit on Your system, the MCS block is not needed.
    const on = await pdfText(
      await proposalPdf(
        { store: await pdfStore() },
        tenant,
        pdfQuote(tenant, { quotation: snapshotFor(tenant, undefined) }),
        null,
        new Date(NOW),
      ),
    );
    expect(on[1]).toContain('Other options we looked at');
    expect(on[4]).not.toContain('Other options we looked at');
    expect(on[4]).not.toMatch(/MCS performance estimate/i);
  });

  it('renders a re-download byte for byte the same after the installer changed every setting', async () => {
    const store = await pdfStore();
    const before = tenantWith(everything());
    const quote = pdfQuote(before, { quotation: snapshotFor(before, everything()) });
    const first = await proposalPdf({ store }, before, quote, null, new Date(NOW));

    const after = tenantWith(
      settings({
        deposit: { kind: 'fixed', amountGbp: 500 },
        validityDays: 90,
        terms: 'Completely different terms.',
        sections: { system: false, performance: false, savings: false, terms: true },
        letter: { opening: 'Changed.', closing: 'Changed.' },
        accreditations: { mcsNumber: 'MCS OTHER', logoAssetIds: [] },
        colours: { rail: '#000000', accent: '#ff0000' },
      }),
      { companyName: 'Renamed Solar', primaryColor: '#00ff00' },
    );
    const later = new Date(NOW + 40 * 24 * 60 * 60 * 1000);
    const second = await proposalPdf({ store }, after, quote, null, later);
    expect(second.equals(first)).toBe(true);

    const text = (await pdfText(second)).join(' ');
    // createdAt 12 October 2026 + 14 days, never the render date.
    expect(text).toContain('Valid until 26 October 2026');
    expect(text).toMatch(/Deposit · 25%/i);
    expect(text).toContain('You may cancel within 14 days.');
    expect(text).toContain('MCS NAP-12345');
    expect(text).not.toContain('Renamed Solar');
    expect(text).not.toContain('Completely different terms.');
  });

  it('renders a quote made before snapshots with the defaults, not the current settings', async () => {
    const tenant = tenantWith(everything());
    const quote = pdfQuote(tenant);
    expect(quote.quotation).toBeUndefined();
    const pages = await pdfText(
      await proposalPdf({ store: await pdfStore() }, tenant, quote, null, new Date(NOW)),
    );
    expect(pages).toHaveLength(5);
    const text = pages.join(' ');
    expect(text).toContain('Valid until 11 November 2026');
    expect(text).not.toContain('You may cancel within 14 days.');
    expect(text).not.toMatch(/Deposit · 25%/i);
  });

  it('renders a snapshot saved before colours existed in the brand colour', async () => {
    const tenant = tenantWith();
    const { colours: _c, ...old } = snapshotFor(tenant, undefined);
    void _c;
    const quote = pdfQuote(tenant, { quotation: old as QuoteRecord['quotation'] });
    const doc = await proposalDocFor(
      { store: await pdfStore() },
      tenant,
      quote,
      null,
      new Date(NOW),
    );
    expect(doc.snapshot.colours).toEqual({ rail: '#ff7900', accent: '#ff7900' });
    expect(await pdfText(await renderProposal(doc))).toHaveLength(5);
  });

  it('has no roof plan, and no error, for a quote without an assessment', async () => {
    const tenant = tenantWith();
    const quote = pdfQuote(tenant, { assessmentId: null });
    const sunscan = { getArtefact: () => Promise.reject(new Error('not called')) };
    const doc = await proposalDocFor(
      { store: await pdfStore(), sunscan },
      tenant,
      quote,
      null,
      new Date(NOW),
    );
    expect(doc.roofPlan).toBeNull();
    expect(doc.roofFacts).toBeNull();
    expect((await pdfText(await renderProposal(doc))).join(' ')).not.toMatch(/ ROOF · /);
  });

  it('draws the real roof from the stored assessment, with roof facts that agree with it', async () => {
    const tenant = tenantWith();
    const store = await pdfStore();
    await store.saveSunScanAssessment({
      id: 'ss_sample',
      tenantId: tenant.id,
      status: 'succeeded',
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      target: { address: '20 Forthlin Road, Liverpool', postcode: 'L18 9TN' },
      sessionId: 'sess_pdf',
      summary: SAMPLE_SUMMARY,
      error: null,
      artefacts: ['spec.json', 'model.glb'],
      engine: 'test',
    });
    const asked: string[][] = [];
    const sunscan = {
      getArtefact: (t: string, id: string, name: string) => {
        asked.push([t, id, name]);
        return Promise.resolve(SAMPLE_SPEC);
      },
    };
    const quote = pdfQuote(tenant, { assessmentId: 'ss_sample' });
    const doc = await proposalDocFor({ store, sunscan }, tenant, quote, null, new Date(NOW));
    expect(asked).toEqual([[tenant.id, 'ss_sample', 'spec.json']]);
    expect(doc.roofPlan).not.toBeNull();
    expect(doc.roofPlan!.panels).toHaveLength(doc.option.panelCount);
    expect(doc.roofPlan!.sample).toBe(false);
    const main = doc.roofPlan!.faces.find((f) => f.id === doc.roofPlan!.mainFace.id)!;
    expect(doc.roofFacts!.pitchDeg).toBe(main.pitchDeg);
    expect(doc.roofFacts!.bestFacing).toBe(doc.roofPlan!.mainFacing);
    const pages = await pdfText(await renderProposal(doc));
    expect(pages[0]).toContain(
      `SOUTH ROOF · ${Math.round(main.pitchDeg)}° · ${doc.option.panelCount} PANELS`,
    );
    expect(pages[1]).toContain(`About ${Math.round(main.pitchDeg)}°`);

    // A spec that cannot be fetched or read: no plan, and no error.
    for (const getArtefact of [
      () => Promise.reject(new Error('storage down')),
      () => Promise.resolve(new TextEncoder().encode('not json')),
      () => Promise.resolve(null),
    ]) {
      const none = await proposalDocFor(
        { store, sunscan: { getArtefact } },
        tenant,
        quote,
        null,
        new Date(NOW),
      );
      expect(none.roofPlan).toBeNull();
      expect(none.roofFacts).not.toBeNull();
    }
    const noService = await proposalDocFor({ store }, tenant, quote, null, new Date(NOW));
    expect(noService.roofPlan).toBeNull();
  });

  it("uses the snapshot's PDF logo, else Your brand's, and skips a missing asset", async () => {
    const brandAssets = new MemoryBrandAssetStore();
    const pdfLogo = png(200, 40);
    const wordmark = png(300, 60);
    const accreditation = png(80, 80);
    const tenant = tenantWith(undefined, {
      branding: {
        mode: 'logo',
        icon: { id: 'aaaaaaaaaaaaaaaa' },
        wordmark: { id: 'bbbbbbbbbbbbbbbb' },
        effects: [],
        colors: null,
      } as unknown as StoredBranding,
    });
    await brandAssets.put(tenant.id, 'cccccccccccccccc.png', pdfLogo);
    await brandAssets.put(tenant.id, 'bbbbbbbbbbbbbbbb.png', wordmark);
    await brandAssets.put(tenant.id, 'dddddddddddddddd.png', accreditation);
    const store = await pdfStore();
    const docWith = (s: QuotationSettings) =>
      proposalDocFor(
        { store, brandAssets },
        tenant,
        pdfQuote(tenant, { quotation: snapshotFor(tenant, s) }),
        null,
        new Date(NOW),
      );

    const own = await docWith(settings({ logoAssetId: 'cccccccccccccccc' }));
    expect(own.logo?.equals(pdfLogo)).toBe(true);
    const brand = await docWith(settings());
    expect(brand.logo?.equals(wordmark)).toBe(true);
    const gone = await docWith(settings({ logoAssetId: 'eeeeeeeeeeeeeeee' }));
    expect(gone.logo).toBeNull();
    const accredited = await docWith(
      settings({
        accreditations: {
          mcsNumber: '',
          logoAssetIds: ['dddddddddddddddd', 'ffffffffffffffff', 'not-an-id'],
        },
      }),
    );
    expect(accredited.accreditationLogos).toHaveLength(1);
    expect(accredited.accreditationLogos[0]!.equals(accreditation)).toBe(true);
    expect(await pdfText(await renderProposal(own))).toHaveLength(5);
  });

  it('stamps the header logo only on pages without the rail, and footers beside the rail', async () => {
    const tenant = tenantWith();
    const quote = pdfQuote(tenant, { quotation: snapshotFor(tenant, undefined) });
    const items = await pdfItems(
      await proposalPdf({ store: await pdfStore() }, tenant, quote, null, new Date(NOW)),
    );
    expect(items).toHaveLength(5);
    const name = 'Brightside Solar';
    // Cover and quotation carry the name in the rail: no header copy.
    expect(inHeader(items[0]!, name)).toHaveLength(0);
    expect(inHeader(items[4]!, name)).toHaveLength(0);
    for (const p of [1, 2, 3]) expect(inHeader(items[p]!, name)).toHaveLength(1);
    // The footer's company line starts clear of the rail on rail pages, at the margin elsewhere.
    const footLeft = (page: PdfTextItem[]) =>
      page.find((i) => i.str.startsWith(name) && i.y < 60)!.x;
    expect(footLeft(items[0]!)).toBeGreaterThan(595.28 * 0.3);
    expect(footLeft(items[4]!)).toBeGreaterThan(595.28 * 0.3);
    expect(footLeft(items[1]!)).toBeCloseTo(40, 0);
  });

  it('prints the warranties fixed on the quote', async () => {
    const tenant = tenantWith();
    const base = pdfQuote(tenant, { quotation: snapshotFor(tenant, undefined) });
    const option = base.options.find((o) => o.id === base.recommendedId) ?? base.options[0]!;
    const battery = option.lineItems.find((i) => i.sku === 'FOX-EVO-1024');
    expect(battery).toBeDefined();
    const quote = { ...base, warranties: { [battery!.sku]: 12 } };
    const doc = await proposalDocFor(
      { store: await pdfStore() },
      tenant,
      quote,
      null,
      new Date(NOW),
    );
    expect(doc.warranties).toEqual({ [battery!.sku]: 12 });
    expect((await pdfText(await renderProposal(doc)))[1]).toContain('12-year warranty');
    const none = await proposalDocFor(
      { store: await pdfStore() },
      tenant,
      base,
      null,
      new Date(NOW),
    );
    expect(none.warranties).toBeUndefined();
  });
});

describe('warranties from the catalogue', () => {
  const product = (over: Partial<Product>): Product =>
    productSchema.parse({
      id: `prd_${(over.model ?? 'x').replace(/[^A-Za-z0-9]/g, '')}`,
      tenantId: 't',
      category: 'battery',
      manufacturer: 'Fox ESS',
      model: 'H3-8.0',
      createdAt: '2026-10-01T00:00:00Z',
      ...over,
    });

  it('maps each line item to the catalogue product with the same make and model', () => {
    const list = hsenergy();
    const items = [
      { sku: 'PV-BASE', label: '10 × 430W solar PV system', quantity: 1, totalGbp: 5000 },
      { sku: 'FOX-H3-8.0', label: 'Fox ESS H3', quantity: 1, totalGbp: 0 },
      { sku: 'FOX-EVO-1024', label: 'Fox ESS EVO', quantity: 1, totalGbp: 4000 },
      { sku: 'ELEC-ADMIN-FEE', label: 'Admin', quantity: 1, totalGbp: 350 },
      { sku: 'TESLA-PW3', label: 'Powerwall', quantity: 1, totalGbp: 9000 },
    ];
    const products = [
      product({ model: 'H3 8.0', warrantyYears: 10 }),
      product({ category: 'battery', model: 'EVO 10.24 All-in-One', warrantyYears: 15 }),
      product({
        category: 'panel',
        manufacturer: 'DMEGC',
        model: 'DM430M10RT-54HBB',
        warrantyYears: 25,
      }),
      product({
        category: 'battery',
        manufacturer: 'Tesla',
        model: 'Powerwall 3 + Gateway',
        warrantyYears: null,
      }),
    ];
    expect(warrantiesFor(items, list, products)).toEqual({
      'PV-BASE': 25,
      'FOX-H3-8.0': 10,
      'FOX-EVO-1024': 15,
    });
    expect(warrantiesFor(items, null, products)).toEqual({});
    // Two products for one make and model that disagree: none rather than a guess.
    expect(
      warrantiesFor(items, list, [
        product({ model: 'H3-8.0', warrantyYears: 10 }),
        product({ id: 'prd_2', model: 'H3-8.0', warrantyYears: 5 }),
      ]),
    ).toEqual({});
  });

  it('are fixed on the quote when it is made', async () => {
    const store = await pdfStore();
    const tenant = tenantWith();
    const list = hsenergy();
    await store.putCatalogueState({
      ...emptyCatalogueState(tenant.id, new Date(NOW).toISOString()),
      priceList: { published: list, version: 1, pending: null, history: [] },
    });
    await store.saveProducts(
      tenant.id,
      [
        product({ tenantId: tenant.id, model: 'H3-8.0', warrantyYears: 10 }),
        product({ tenantId: tenant.id, model: 'H1-3.7', warrantyYears: 10 }),
        product({
          tenantId: tenant.id,
          category: 'panel',
          manufacturer: 'DMEGC',
          model: 'DM430M10RT-54HBB',
          warrantyYears: 25,
        }),
      ],
      'replace',
    );
    await store.mergeAnswers(tenant.id, 'sess_w', {
      ...answers(),
      journey_assessment_id: 'ss_test1',
    });
    const summary = roofSummary();
    const deps: JourneyDeps = {
      store,
      pricing: { forTenant: () => Promise.resolve(pricingFromPriceList(list)!.pricing) },
      roof: () => Promise.resolve({ state: 'ready', summary }),
      now: () => NOW,
      tenant: () => tenant,
    };
    const made = await createQuote(deps, tenant.id, 'sess_w');
    if (!made.ok) throw new Error(`not ok: ${made.missing.join()}`);
    const skus = new Set(made.quote.options.flatMap((o) => o.lineItems.map((i) => i.sku)));
    expect(made.quote.warranties).toBeDefined();
    expect(Object.keys(made.quote.warranties!).length).toBeGreaterThan(0);
    for (const [sku, years] of Object.entries(made.quote.warranties!)) {
      expect(skus.has(sku)).toBe(true);
      expect([10, 25]).toContain(years);
    }
    const [stored] = await store.listQuotes(tenant.id, 'sess_w');
    expect(stored?.warranties).toEqual(made.quote.warranties);
  });
});

// ─── routes ──────────────────────────────────────────────────────────────────

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function config(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-proposal',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: false,
      trustProxyHops: 0,
      rules: {
        session: { limit: 1000, windowMs: 60_000 },
        chat: { limit: 1000, windowMs: 60_000 },
        leads: { limit: 1000, windowMs: 60_000 },
        qualification: { limit: 1000, windowMs: 60_000 },
        catalogue: { limit: 1000, windowMs: 60_000 },
        knowledge: { limit: 1000, windowMs: 60_000 },
      },
      maxKeys: 1000,
    },
  } as unknown as ServerConfig;
}

async function setup(mailer: { sent: ProposalEmail[] } | null) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-proposal-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: config(),
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
    proposalMailer: mailer
      ? {
          send: (email) => {
            mailer.sent.push(email);
            return Promise.resolve({ messageId: 'm1' });
          },
        }
      : null,
  });
  await app.ready();

  // An installer, a visitor's quote and the lead the visitor agreed to.
  const owner = 'owner@brightside.example';
  const as = (email: string) => ({
    authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}`,
  });
  const created = await app.inject({
    method: 'POST',
    url: '/v1/portal/tenants',
    headers: as(owner),
    payload: { companyName: 'Brightside Solar' },
  });
  const tenantId = created.json<{ tenant: { id: string } }>().tenant.id;
  const quote = { ...quoteWith(demoPricing(), 'q_route_1'), tenantId, sessionId: 'sess_1' };
  await store.mergeAnswers(tenantId, 'sess_1', { address: '164 Norwich Drive, Norwich' });
  const lead = {
    id: 'lead_1',
    tenantId,
    sessionId: 'sess_1',
    conversationId: null,
    name: 'Sam Patel',
    email: 'sam@example.com',
    phone: null,
    postcode: 'NR4 7TJ',
    summary: '',
    score: null,
    createdAt: new Date(NOW).toISOString(),
  };
  await store.saveLead(lead);
  await store.saveQuote({ ...quote, leadId: lead.id });

  const visitor = (sessionId: string, tenant = tenantId) => ({
    authorization: `Bearer ${issueSessionToken(
      { sessionId, tenantId: tenant, expiresAt: NOW + 60_000, origin: null },
      SECRET,
    )}`,
  });
  return { app, store, tenantId, quote, lead, owner, as, visitor };
}

describe('proposal routes', () => {
  it("serves the visitor their own quote's PDF, and no one else's", async () => {
    const { app, quote, visitor, tenantId } = await setup(null);
    const own = await app.inject({
      method: 'GET',
      url: `/v1/quote/${quote.id}/proposal.pdf`,
      headers: visitor('sess_1'),
    });
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    expect(own.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    for (const headers of [visitor('sess_other'), visitor('sess_1', 't_demo0001')]) {
      const other = await app.inject({
        method: 'GET',
        url: `/v1/quote/${quote.id}/proposal.pdf`,
        headers,
      });
      expect(other.statusCode).toBe(404);
    }
    const anonymous = await app.inject({
      method: 'GET',
      url: `/v1/quote/${quote.id}/proposal.pdf`,
    });
    expect(anonymous.statusCode).toBe(401);
    void tenantId;
  });

  it('limits how often one session can download its PDF', async () => {
    const { app, quote, visitor } = await setup(null);
    const get = (sess: string) =>
      app.inject({
        method: 'GET',
        url: `/v1/quote/${quote.id}/proposal.pdf`,
        headers: visitor(sess),
      });
    for (let i = 0; i < 20; i++) expect((await get('sess_1')).statusCode).toBe(200);
    expect((await get('sess_1')).statusCode).toBe(429);
  }, 60_000);

  it('gives the installer their lead’s proposal, and other installers nothing', async () => {
    const { app, tenantId, lead, owner, as } = await setup(null);
    const url = `/v1/portal/tenants/${tenantId}/leads/${lead.id}/quote/proposal.pdf`;
    const mine = await app.inject({ method: 'GET', url, headers: as(owner) });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['content-disposition']).toMatch(/Brightside-Solar-proposal-/);

    await app.inject({
      method: 'POST',
      url: '/v1/portal/tenants',
      headers: as('rival@other.example'),
      payload: { companyName: 'Rival Solar' },
    });
    const theirs = await app.inject({ method: 'GET', url, headers: as('rival@other.example') });
    expect(theirs.statusCode).toBe(404);
  });

  it('emails the quote only with consent, from the installer, at most three times a day', async () => {
    const mailer = { sent: [] as ProposalEmail[] };
    const { app, quote, visitor } = await setup(mailer);
    const url = `/v1/quote/${quote.id}/proposal/email`;
    const noConsent = await app.inject({
      method: 'POST',
      url,
      headers: visitor('sess_1'),
      payload: { email: 'sam@example.com', consent: false },
    });
    expect(noConsent.statusCode).toBe(400);
    expect(mailer.sent).toHaveLength(0);

    for (let i = 0; i < 3; i++) {
      const ok = await app.inject({
        method: 'POST',
        url,
        headers: visitor('sess_1'),
        payload: { email: 'sam@example.com', consent: true },
      });
      expect(ok.statusCode).toBe(200);
    }
    const fourth = await app.inject({
      method: 'POST',
      url,
      headers: visitor('sess_1'),
      payload: { email: 'sam@example.com', consent: true },
    });
    expect(fourth.statusCode).toBe(429);

    const email = mailer.sent[0]!;
    expect(email.to).toBe('sam@example.com');
    expect(email.fromName).toBe('Brightside Solar via Sunny');
    expect(email.subject).toMatch(/Brightside Solar/);
    expect(email.text).toMatch(/indicative and non-binding/);
    expect(email.attachment.data.subarray(0, 5).toString()).toBe('%PDF-');

    const stranger = await app.inject({
      method: 'POST',
      url,
      headers: visitor('sess_other'),
      payload: { email: 'x@example.com', consent: true },
    });
    expect(stranger.statusCode).toBe(404);
  });

  it('refuses to email when outbound email is not configured', async () => {
    const { app, quote, visitor } = await setup(null);
    const response = await app.inject({
      method: 'POST',
      url: `/v1/quote/${quote.id}/proposal/email`,
      headers: visitor('sess_1'),
      payload: { email: 'sam@example.com', consent: true },
    });
    expect(response.statusCode).toBe(403);
    expect(proposalEmailConfigured({})).toBe(false);
    expect(
      proposalEmailConfigured({ SUNNY_POSTMARK_SERVER_TOKEN: 't', SUNNY_PROPOSAL_FROM: 'q@x.io' }),
    ).toBe(true);
  });
});

describe('proposal routes with a heat pump quote', () => {
  async function withHeatPump(mailer: { sent: ProposalEmail[] } | null) {
    const ctx = await setup(mailer);
    const { store } = ctx;
    const hpLead = { ...ctx.lead, id: 'lead_hp', sessionId: 'sess_hp' };
    await store.saveLead(hpLead);
    // The answer now says gas; the quote was made with oil, and the PDF follows the quote.
    await store.mergeAnswers(ctx.tenantId, 'sess_hp', { hp_current_heating: 'gas' });
    const hp = hpQuote({
      tenantId: ctx.tenantId,
      sessionId: 'sess_hp',
      leadId: hpLead.id,
      currentFuel: 'oil',
    });
    await store.saveQuote(hp);
    return { ...ctx, hp, hpLead };
  }

  it("gives the installer their heat pump lead's estimate", async () => {
    const { app, tenantId, hpLead, owner, as } = await withHeatPump(null);
    const url = `/v1/portal/tenants/${tenantId}/leads/${hpLead.id}/quote/proposal.pdf`;
    const res = await app.inject({ method: 'GET', url, headers: as(owner) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="heat-pump-estimate-NR4-7TJ.pdf"',
    );
    const text = (await pdfText(res.rawPayload)).join('\n');
    expect(text).toContain('Heat pump estimate');
    expect(text).toContain('Oil boiler');
  });

  it('emails the heat pump estimate as a heat pump quote', async () => {
    const mailer = { sent: [] as ProposalEmail[] };
    const { app, hp, visitor } = await withHeatPump(mailer);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/quote/${hp.id}/proposal/email`,
      headers: visitor('sess_hp'),
      payload: { email: 'sam@example.com', consent: true },
    });
    expect(res.statusCode).toBe(200);
    const email = mailer.sent[0]!;
    expect(email.subject).toBe('Your heat pump quote from Brightside Solar');
    expect(email.text).toContain('heat pump estimate');
    expect(email.text).not.toContain(String.fromCodePoint(0x2013));
    expect(email.text).not.toContain(String.fromCodePoint(0x2014));
    expect(email.attachment.filename).toBe('heat-pump-estimate-NR4-7TJ.pdf');
    expect(email.attachment.data.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('proposal routes with a battery quote', () => {
  it('emails the battery estimate as a battery quote, and gives it to the installer', async () => {
    const mailer = { sent: [] as ProposalEmail[] };
    const ctx = await setup(mailer);
    const { app, store, tenantId, owner, as, visitor } = ctx;
    const batLead = { ...ctx.lead, id: 'lead_bat', sessionId: 'sess_bat' };
    await store.saveLead(batLead);
    const bat = batQuote({ tenantId, sessionId: 'sess_bat', leadId: batLead.id });
    await store.saveQuote(bat);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/quote/${bat.id}/proposal/email`,
      headers: visitor('sess_bat'),
      payload: { email: 'sam@example.com', consent: true },
    });
    expect(res.statusCode).toBe(200);
    const email = mailer.sent[0]!;
    expect(email.subject).toBe('Your battery quote from Brightside Solar');
    expect(email.text).toContain('battery estimate');
    expect(email.text).not.toContain(String.fromCodePoint(0x2013));
    expect(email.text).not.toContain(String.fromCodePoint(0x2014));
    expect(email.attachment.filename).toBe('battery-estimate-NR4-7TJ.pdf');

    const url = `/v1/portal/tenants/${tenantId}/leads/${batLead.id}/quote/proposal.pdf`;
    const pdf = await app.inject({ method: 'GET', url, headers: as(owner) });
    expect(pdf.statusCode).toBe(200);
    expect((await pdfText(pdf.rawPayload)).join(' ')).toContain('Battery estimate');
  });
});

describe('a quote keeps its logos', () => {
  const I1 = '1111111111111111';
  const W1 = 'aaaaaaaaaaaaaaaa';
  const L1 = 'bbbbbbbbbbbbbbbb';
  const A1 = 'cccccccccccccccc';
  const X1 = 'dddddddddddddddd';
  const L2 = 'eeeeeeeeeeeeeeee';

  function colourPng(w: number, h: number, rgb: [number, number, number]): Buffer {
    const p = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) {
      p.data[i * 4] = rgb[0];
      p.data[i * 4 + 1] = rgb[1];
      p.data[i * 4 + 2] = rgb[2];
      p.data[i * 4 + 3] = 255;
    }
    return PNG.sync.write(p);
  }

  it('re-downloads the same bytes after the logos change and an upload prunes old assets', async () => {
    let clock = NOW;
    const store = await pdfStore();
    const tenants = await TenantRegistry.load(store, defaultTenants(false));
    const brandAssets = new MemoryBrandAssetStore(() => clock);
    const app = buildServer({
      config: config(),
      store,
      tenants,
      now: () => clock,
      portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
      brandAssets,
      proposalMailer: null,
    });
    await app.ready();
    const owner = { authorization: `Bearer ${issueDevToken(SECRET, 'owner@keep.example', NOW)}` };
    const created = await app.inject({
      method: 'POST',
      url: '/v1/portal/tenants',
      headers: owner,
      payload: { companyName: 'Keep Solar' },
    });
    const tenantId = created.json<{ tenant: { id: string } }>().tenant.id;
    for (const [id, rgb] of [
      [I1, [10, 10, 10]],
      [W1, [200, 60, 20]],
      [L1, [20, 160, 60]],
      [A1, [20, 60, 200]],
      [X1, [90, 90, 90]],
    ] as const) {
      await brandAssets.put(tenantId, `${id}.png`, colourPng(120, 40, [...rgb]));
    }
    const branding = (wordmark: string) =>
      ({
        mode: 'logo',
        icon: { id: I1 },
        wordmark: { id: wordmark },
        effects: [],
        colors: null,
      }) as unknown as StoredBranding;
    await tenants.update(tenantId, (t) => ({
      ...t,
      config: {
        ...t.config,
        branding: branding(W1),
        quotation: settings({
          logoAssetId: L1,
          accreditations: { mcsNumber: 'MCS 1', logoAssetIds: [A1] },
        }),
      },
    }));

    const deps: JourneyDeps = {
      store,
      pricing: { forTenant: () => Promise.resolve(demoPricing()) },
      roof: () => Promise.resolve({ state: 'ready', summary: roofSummary() }),
      now: () => NOW,
      tenant: (id) => tenants.byId(id),
      pinBrandAssets: (id, ids) => pinBrandAssets(tenants, id, ids),
    };
    const quoteFor = async (sessionId: string) => {
      await store.mergeAnswers(tenantId, sessionId, {
        ...answers(),
        journey_assessment_id: 'ss_test1',
      });
      const made = await createQuote(deps, tenantId, sessionId);
      if (!made.ok) throw new Error(`not ok: ${made.missing.join()}`);
      return made.quote;
    };
    // Own PDF logo; then a quote on the default (Your brand's wordmark).
    const own = await quoteFor('sess_own');
    expect(own.quotation?.pdfLogoAssetId).toBe(L1);
    await tenants.update(tenantId, (t) => ({
      ...t,
      config: { ...t.config, quotation: { ...t.config.quotation!, logoAssetId: null } },
    }));
    const brand = await quoteFor('sess_brand');
    expect(brand.quotation?.pdfLogoAssetId).toBe(W1);
    expect([...(tenants.byId(tenantId)!.config.pinnedBrandAssetIds ?? [])].sort()).toEqual(
      [A1, L1, W1].sort(),
    );

    const render = (q: QuoteRecord) =>
      proposalPdf({ store, brandAssets }, tenants.byId(tenantId)!, q, null, new Date(NOW));
    const ownDoc = await proposalDocFor(
      { store, brandAssets },
      tenants.byId(tenantId)!,
      own,
      null,
      new Date(NOW),
    );
    expect(ownDoc.logo?.equals((await brandAssets.get(tenantId, `${L1}.png`))!)).toBe(true);
    const first = [await render(own), await render(brand)];

    // Every logo changes; days later a new upload prunes what is not in use.
    await brandAssets.put(tenantId, `${L2}.png`, colourPng(120, 40, [0, 0, 0]));
    await tenants.update(tenantId, (t) => ({
      ...t,
      config: {
        ...t.config,
        branding: branding(L2),
        quotation: settings({ logoAssetId: L2 }),
      },
    }));
    clock = NOW + 3 * 24 * 60 * 60 * 1000;
    const upload = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/brand/wordmark`,
      headers: {
        authorization: `Bearer ${issueDevToken(SECRET, 'owner@keep.example', clock)}`,
      },
      payload: { png: colourPng(300, 80, [30, 120, 200]).toString('base64') },
    });
    expect(upload.statusCode).toBe(200);
    expect(await brandAssets.get(tenantId, `${X1}.png`)).toBeNull();
    for (const id of [L1, W1, A1]) {
      expect(await brandAssets.get(tenantId, `${id}.png`)).not.toBeNull();
    }

    const second = [await render(own), await render(brand)];
    expect(second[0]!.equals(first[0]!)).toBe(true);
    expect(second[1]!.equals(first[1]!)).toBe(true);

    // The pins are server-only.
    const publicId = tenants.byId(tenantId)!.publicId;
    expect(tenants.configFor(publicId)).not.toHaveProperty('pinnedBrandAssetIds');
    await app.close();
  });

  it('pins only what is new, and a quote without logos pins nothing', async () => {
    const tenants = new TenantRegistry([tenantWith()]);
    const id = DEMO_TENANT.id;
    let writes = 0;
    const counting = {
      byId: (t: string) => tenants.byId(t),
      update: (t: string, m: (c: Tenant) => Tenant) => {
        writes++;
        return tenants.update(t, m);
      },
    };
    await pinBrandAssets(counting, id, [L1, A1]);
    await pinBrandAssets(counting, id, [A1, L1]);
    expect(writes).toBe(1);
    await pinBrandAssets(counting, id, [L1, L2]);
    expect(writes).toBe(2);
    expect(tenants.byId(id)!.config.pinnedBrandAssetIds).toEqual([L1, A1, L2]);
    expect(snapshotAssetIds(snapshotFor(tenantWith(), undefined))).toEqual([]);
  });

  it('prints the company contact in the footer, not a named signer', async () => {
    const tenant = tenantWith(everything());
    const quote = pdfQuote(tenant, { quotation: snapshotFor(tenant, everything()) });
    const items = await pdfItems(
      await proposalPdf({ store: await pdfStore() }, tenant, quote, null, new Date(NOW)),
    );
    const footer = items[1]!
      .filter((i) => i.y < 40)
      .map((i) => i.str)
      .join(' ');
    expect(footer).toContain('01632 960123');
    expect(footer).toContain('hello@brightside.example');
    expect(footer).not.toContain('07850 697435');
  });
});
