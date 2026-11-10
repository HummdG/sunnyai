import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultQuotationSettings } from '@sunny/contracts';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';

import type { QuoteOptionView, QuoteRecord } from '../src/journey/quote.js';
import { letterParagraphs, money, referenceFor, signOff } from '../src/proposal/copy.js';
import type { ProposalDoc } from '../src/proposal/doc.js';
import { CONTENT, PAGE, RAIL_FRACTION, registerFonts, themeFor } from '../src/proposal/layout.js';
import { drawCover } from '../src/proposal/pages/cover.js';
import { drawQuotation } from '../src/proposal/pages/quotation.js';
import { roofPlanFor } from '../src/proposal/roof-plan.js';
import type { QuotationSnapshot } from '../src/proposal/snapshot.js';
import { pdfItems, pdfText } from './pdf-text.js';

const THEME = themeFor('#0f2a3d');

const NOTICE =
  'This is an estimate, not a final price. It is based on a 3D model of your roof and the ' +
  'answers you gave us. Your final price will be confirmed after a survey of your property, ' +
  'and it may go up or down.';
const COVER_NOTICE = 'Estimate. Final price confirmed after a survey.';
const DEPOSIT_LABEL = 'Deposit, payable once your survey has confirmed the final price';

function option(over: Partial<QuoteOptionView> = {}): QuoteOptionView {
  return {
    id: 'standard',
    label: 'Standard',
    isRecommended: true,
    headline: 'Balanced',
    bestSuitedTo: 'Most homes',
    tier: 'standard',
    panelCount: 10,
    panelType: 'REA 460 W bifacial',
    inverterType: 'Fox ESS H3 8 kW hybrid',
    batteryType: 'Fox ESS EVO',
    batteryCapacityKwh: 10.24,
    systemKwp: 4.6,
    priceGbp: 13277,
    priceIncVatGbp: null,
    priceLabel: "From the installer's price list, 0% VAT",
    lineItems: [
      { sku: 'PNL-REA460', label: 'REA 460 W bifacial, 4.6 kWp', quantity: 10, totalGbp: 6407 },
      { sku: 'INV-H3', label: 'Fox ESS H3 8 kW hybrid inverter', quantity: 1, totalGbp: 0 },
      { sku: 'BAT-EVO10', label: 'Fox ESS EVO 10.24 kWh battery', quantity: 1, totalGbp: 4295 },
      { sku: 'EV-7KW', label: '7 kW EV charger', quantity: 1, totalGbp: 899 },
      { sku: 'BIRD', label: 'Bird-proofing mesh', quantity: 1, totalGbp: 600 },
      { sku: 'SCAF', label: 'Scaffolding, installation, DNO', quantity: 1, totalGbp: 726 },
      { sku: 'ADMIN', label: 'Administration', quantity: 1, totalGbp: 350 },
    ],
    annualGenerationKwh: 3743.4,
    selfConsumptionRate: 0.72,
    annualSavingsGbp: 929,
    paybackYears: 11.2,
    co2TonnesPerYear: 0.78,
    inclusions: [],
    warnings: [],
    aboveBudget: false,
    roofLimited: false,
    installerPriced: [],
    sentinel: null,
    ...over,
  };
}

function quote(over: Partial<QuoteRecord> = {}, opt: Partial<QuoteOptionView> = {}): QuoteRecord {
  return {
    id: 'q_7f3a9c2e41b8',
    tenantId: 't_demo',
    sessionId: 's1',
    createdAt: '2026-11-09T10:00:00.000Z',
    assessmentId: null,
    priced: true,
    pricing: {
      label: 'List',
      version: '1',
      priceStatus: 'verified',
      vatRatePercent: 0,
      currency: 'GBP',
    },
    basis: {
      postcode: 'NR4 7TJ',
      regionName: 'East England',
      mcsZone: '2',
      annualKwh: 4200,
      importPence: 24.5,
      exportPence: 15,
      irradianceKwhPerM2: 900,
      roofMaxPanels: 14,
      pitchDeg: 36,
      mcsOrientationDeg: 0,
      shadingLoss: 0,
      budgetMaxGbp: null,
      roofConfidence: 'measured',
    },
    options: [option(opt)],
    recommendedId: 'standard',
    warnings: [],
    estimatedFrom: [],
    disclaimer: 'Indicative and non-binding.',
    leadId: null,
    reasons: {
      'BAT-EVO10': 'You told us you use most of your electricity in the evening.',
      'EV-7KW': 'You told us you drive an electric car.',
    },
    ...over,
  };
}

function snapshot(over: Partial<QuotationSnapshot> = {}): QuotationSnapshot {
  const { signer: _signer, ...rest } = defaultQuotationSettings();
  void _signer;
  return {
    ...rest,
    signer: {
      name: 'Oliver Burnett',
      role: 'Solar adviser',
      phone: '07850 697435',
      email: 'oliver@greenroof.co.uk',
    },
    companyName: 'GreenRoof Solar Ltd',
    colour: '#0f2a3d',
    website: 'greenroof.co.uk',
    ...over,
  };
}

function docFor(
  over: Partial<ProposalDoc> = {},
  q: QuoteRecord = quote(),
  snap: QuotationSnapshot = snapshot(),
): ProposalDoc {
  const opt = q.options[0]!;
  return {
    quote: q,
    option: opt,
    chosen: false,
    others: [],
    snapshot: snap,
    customer: { name: 'Sam Patel', address: '14 Elm Close, Norwich' },
    roofPlan: null,
    roofFacts: {
      bestFacing: 'South',
      pitchDeg: 36,
      usableRoofAreaM2: 26,
      estimatedMaxPanels: 14,
      reliable: true,
      label: 'Good fit to the 3D data',
    },
    logo: null,
    accreditationLogos: [],
    generatedAt: new Date('2026-11-10T09:00:00Z'),
    reference: referenceFor(q),
    validUntil: new Date('2026-12-09T10:00:00Z'),
    ...over,
  };
}

function render(draw: (pdf: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    pdf.on('end', () => resolve(Buffer.concat(chunks))),
  );
  registerFonts(pdf);
  draw(pdf);
  pdf.end();
  return done;
}

const cover = (d: ProposalDoc) => render((pdf) => drawCover(pdf, d, THEME));
const quotation = (d: ProposalDoc, opts = { mcsBlock: false, termsFollow: false }) =>
  render((pdf) => drawQuotation(pdf, d, THEME, opts));
const text = async (buf: Buffer) => (await pdfText(buf)).join(' ');

describe('copy', () => {
  it('prints the reference as Q- and eight upper-case characters', () => {
    expect(referenceFor(quote({ id: 'q_7f3a9c2e41b8' }))).toBe('Q-9C2E41B8');
    expect(referenceFor(quote({ id: 'q_test_1' }))).toBe('Q-TEST_1');
    expect(referenceFor(quote())).toMatch(/^Q-[0-9A-Z]{8}$/);
  });

  it('opens the letter with the first name, or Hello', () => {
    expect(letterParagraphs(docFor())[0]).toBe('Dear Sam,');
    expect(letterParagraphs(docFor({ customer: { name: null, address: null } }))[0]).toBe('Hello,');
  });

  it('says what we recommend, why, and that it is an estimate', () => {
    const paras = letterParagraphs(
      docFor({}, quote(), snapshot({ letter: { opening: 'Thanks for asking.', closing: 'Bye.' } })),
    );
    expect(paras[1]).toBe('Thanks for asking.');
    const all = paras.join('\n');
    expect(all).toContain(
      "We'd recommend 10 panels on your south-facing roof with a 10.2 kWh battery.",
    );
    expect(all).toContain('You told us you use most of your electricity in the evening.');
    expect(all).toContain('You told us you drive an electric car.');
    expect(all).toContain('Every figure here is an estimate until we survey your property.');
    expect(all).toContain('Bye.');
    expect(signOff(docFor())).toEqual([
      'Oliver Burnett',
      'Solar adviser',
      '07850 697435 · oliver@greenroof.co.uk',
    ]);
  });

  it('describes a flat roof without "flat-facing"', () => {
    const all = letterParagraphs(
      docFor({ roofFacts: { ...docFor().roofFacts!, bestFacing: 'Flat roof' } }),
    ).join(' ');
    expect(all).toContain('on your flat roof');
    expect(all).not.toContain('flat-facing');
  });

  it('works out a percentage deposit to whole pounds and the balance', () => {
    const m = money(docFor({}, quote(), snapshot({ deposit: { kind: 'percent', percent: 25 } })))!;
    expect(m).toMatchObject({ total: 13277, deposit: 3319, balance: 9958 });
    expect(m.totalLabel).toBe('Estimated total');
    expect(m.vatNote).toBe('0% VAT');
  });

  it('caps a fixed deposit at the total, never a negative balance', () => {
    const m = money(
      docFor({}, quote(), snapshot({ deposit: { kind: 'fixed', amountGbp: 20000 } })),
    )!;
    expect(m).toMatchObject({ total: 13277, deposit: 13277, balance: 0 });
  });

  it('uses the VAT-inclusive figure when VAT is known', () => {
    const q = quote(
      { pricing: { ...quote().pricing!, vatRatePercent: 20 } },
      { priceIncVatGbp: 15932 },
    );
    const m = money(docFor({}, q, snapshot({ deposit: { kind: 'percent', percent: 10 } })))!;
    expect(m).toMatchObject({ total: 15932, deposit: 1593, balance: 14339 });
    expect(m.vatNote).toBe('including 20% VAT');
  });

  it('has no money for an unpriced or incomplete quote, or a zero total', () => {
    const unpriced = quote({ priced: false, pricing: null }, { priceGbp: null, lineItems: [] });
    expect(money(docFor({}, unpriced))).toBeNull();
    const partial = quote({}, { installerPriced: ['Roof works'] });
    expect(money(docFor({}, partial))).toBeNull();
    expect(money(docFor({}, quote({}, { priceGbp: 0 })))).toBeNull();
  });
});

describe('cover page', () => {
  it('shows the rail figures, the notice and the reference on one page', async () => {
    const pages = await pdfText(await cover(docFor()));
    expect(pages).toHaveLength(1);
    const t = pages[0]!;
    for (const k of [
      'PREPARED FOR',
      'RECOMMENDED',
      'GENERATION',
      'YEAR-ONE SAVING',
      'ESTIMATED TOTAL',
      'QUOTE',
    ]) {
      expect(t).toContain(k);
    }
    expect(t).toContain(COVER_NOTICE);
    expect(t).toContain('£13,277');
    expect(t).toContain('£929');
    expect(t).toContain('3,743');
    expect(t).toContain('Q-9C2E41B8');
    expect(t).toContain('Valid until 9 December 2026');
    expect(t).toContain('Dear Sam,');
  });

  it('says the system we recommend, or your chosen system', async () => {
    const rec = await text(await cover(docFor()));
    expect(rec).toContain('The system we recommend');
    expect(rec).toContain('Ten panels, one battery,');
    expect(rec).toContain('your south-facing roof.');
    expect(rec).toContain('RECOMMENDED');
    const chosen = await text(await cover(docFor({ chosen: true })));
    expect(chosen).toContain('Your chosen system');
    expect(chosen).toContain('YOUR CHOICE');
    expect(chosen).not.toContain('The system we recommend');
  });

  it('greets with Hello when there is no name', async () => {
    const t = await text(await cover(docFor({ customer: { name: null, address: null } })));
    expect(t).toContain('Hello,');
    expect(t).not.toContain('Dear');
  });

  it('shows no total figure on the cover of an unpriced quote', async () => {
    const unpriced = quote({ priced: false, pricing: null }, { priceGbp: null, lineItems: [] });
    const t = await text(await cover(docFor({}, unpriced)));
    expect(t).toContain('ESTIMATED TOTAL');
    expect(t).not.toMatch(/£\d{2},\d{3}/);
  });

  it('draws the real roof plan when there is one', async () => {
    const spec = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'assets', 'sample', 'house.spec.json'), 'utf8'),
    ) as unknown;
    const plan = roofPlanFor(spec, { panelCount: 10, reliable: true, sample: true });
    expect(plan).not.toBeNull();
    const pages = await pdfText(await cover(docFor({ roofPlan: plan })));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('SAMPLE');
    expect(pages[0]).toContain('OVERALL WIDTH');
  });

  it('keeps a long company name and a 3-line address inside the rail', async () => {
    const d = docFor(
      {
        customer: {
          name: 'Dr Alexandra Montgomery-Fitzwilliam',
          address:
            'Flat 12, The Old Rectory Buildings\n144 Long Meadow Lane, Little Snoring\nFakenham, Norfolk NR21 0AA',
        },
      },
      quote(),
      snapshot({
        companyName: 'Northern Counties Renewable Energy Installations Limited',
        signer: {
          name: 'Oliver Burnett',
          role: 'Senior Residential Solar Adviser',
          phone: '07850 697435',
          email: 'oliver@greenroof.co.uk',
        },
      }),
    );
    const buf = await cover(d);
    expect(await pdfText(buf)).toHaveLength(1);
    const items = (await pdfItems(buf))[0]!.filter((i) => i.str.trim() !== '');
    const railW = PAGE.width * RAIL_FRACTION;
    const inRail = items.filter((i) => i.x < railW);
    expect(inRail.map((i) => i.str).join(' ')).toContain('Northern Counties');
    expect(inRail.map((i) => i.str).join(' ')).toContain('NR21 0AA');
    for (const i of inRail) expect(i.x + i.width).toBeLessThanOrEqual(railW - 10);
    // nothing in the rail overlaps anything else in it
    for (const a of inRail) {
      for (const b of inRail) {
        if (a === b) continue;
        const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width;
        const yOverlap = a.y < b.y + b.height && b.y < a.y + a.height;
        expect(xOverlap && yOverlap, `${a.str} / ${b.str}`).toBe(false);
      }
    }
    // nothing enters the footer band
    for (const i of items) expect(i.y).toBeGreaterThan(PAGE.height - CONTENT.bottom);
  });
});

describe('quotation page', () => {
  it('carries the four estimate strings', async () => {
    const t = await text(await quotation(docFor()));
    expect(t).toContain('Estimated quotation');
    expect(t).toContain(NOTICE);
    expect(t).toContain('Estimated total');
    expect(t).toContain('£13,277');
    expect(t).toContain('Valid until 9 December 2026');
    const cov = await text(await cover(docFor()));
    expect(cov).toContain(COVER_NOTICE);
  });

  it('numbers the items and puts the reason under the EV charger', async () => {
    const pages = await pdfItems(await quotation(docFor()));
    const items = pages[0]!;
    const charger = items.find((i) => i.str.includes('7 kW EV charger'))!;
    const reason = items.find((i) => i.str.includes('You told us you drive an electric car.'))!;
    expect(charger).toBeDefined();
    expect(reason).toBeDefined();
    expect(reason.y).toBeLessThan(charger.y); // PDF y grows upwards: below the label
    expect(Math.abs(reason.x - charger.x)).toBeLessThan(1);
    const t = pages[0]!.map((i) => i.str).join(' ');
    expect(t).toContain('01');
    expect(t).toContain('07');
  });

  it('prints a 25% deposit and the balance', async () => {
    const t = await text(
      await quotation(docFor({}, quote(), snapshot({ deposit: { kind: 'percent', percent: 25 } }))),
    );
    expect(t).toContain(DEPOSIT_LABEL);
    expect(t).toContain('25% of the estimated total');
    expect(t).toContain('£3,319');
    expect(t).toContain('Balance, within 7 days of completion');
    expect(t).toContain('£9,958');
  });

  it('prints a fixed deposit above the total as the total, and £0 balance', async () => {
    const t = await text(
      await quotation(
        docFor({}, quote(), snapshot({ deposit: { kind: 'fixed', amountGbp: 20000 } })),
      ),
    );
    expect(t).toContain('Fixed deposit');
    expect(t).not.toContain('£20,000');
    expect(t).toContain('£0');
    expect(t).not.toMatch(/-£|£-/);
  });

  it('has no deposit block without a deposit rule', async () => {
    const t = await text(await quotation(docFor()));
    expect(t).not.toContain(DEPOSIT_LABEL);
  });

  it('shows no total figure and no deposit for an unpriced quote', async () => {
    const unpriced = quote({ priced: false, pricing: null }, { priceGbp: null, lineItems: [] });
    const t = await text(
      await quotation(
        docFor({}, unpriced, snapshot({ deposit: { kind: 'percent', percent: 25 } })),
      ),
    );
    expect(t).toContain('Priced by your installer');
    expect(t).toContain('Estimated total');
    expect(t).not.toMatch(/£\d/);
    expect(t).not.toContain(DEPOSIT_LABEL);
  });

  it('marks installer-priced items and holds back the total', async () => {
    const t = await text(
      await quotation(
        docFor(
          {},
          quote({}, { installerPriced: ['Roof works'] }),
          snapshot({ deposit: { kind: 'percent', percent: 25 } }),
        ),
      ),
    );
    expect(t).toContain('Roof works');
    expect(t).toContain('Priced by your installer');
    expect(t).not.toContain('£13,277');
    expect(t).not.toContain(DEPOSIT_LABEL);
  });

  it('adds the MCS block only when asked', async () => {
    const without = await text(await quotation(docFor()));
    expect(without).not.toContain('cannot be predicted with certainty');
    const withIt = await text(await quotation(docFor(), { mcsBlock: true, termsFollow: false }));
    expect(withIt).toContain(
      'The performance of a solar PV system cannot be predicted with certainty',
    );
    expect(withIt).toContain('3,743 kWh');
  });

  it('has the acceptance block and the terms line when asked', async () => {
    const t = await text(await quotation(docFor(), { mcsBlock: false, termsFollow: true }));
    expect(t).toContain('Signed');
    expect(t).toContain('Date');
    expect(t).toContain(
      'To go ahead, contact Oliver Burnett on 07850 697435 or oliver@greenroof.co.uk.',
    );
    expect(t).toContain('Terms and conditions follow.');
    const no = await text(await quotation(docFor()));
    expect(no).not.toContain('Terms and conditions follow.');
  });

  it('lists the notes', async () => {
    const q = quote(
      {
        warnings: [
          'Some figures use typical values because your installer does not ask about your tariff.',
        ],
        estimatedFrom: ['tariff_type'],
      },
      {
        aboveBudget: true,
        roofLimited: true,
        warnings: ['Option warning here.'],
        sentinel: {
          upliftPercent: 12,
          annualSavingsGbp: 1040,
          paybackYears: 10,
          addedCostGbp: 250,
        },
      },
    );
    const t = await text(await quotation(docFor({}, q)));
    expect(t).toContain('NOTES');
    expect(t).toContain('Sentinel');
    expect(t).toContain('Optional: Sentinel');
    expect(t).toContain('£250');
    expect(t).toContain('Option warning here.');
    expect(t).toContain('Some figures use typical values because your installer does not ask');
    expect(t).toContain('space on your roof');
    expect(t).toContain('budget you mentioned');
  });

  it('continues onto a new page cleanly when there is a lot to say', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      sku: `X${i}`,
      label: `Item number ${i + 1} with a reasonably long description of the work`,
      quantity: 1,
      totalGbp: 100,
    }));
    const d = docFor({}, quote({}, { lineItems: many, priceGbp: 3000 }));
    const buf = await quotation(d, { mcsBlock: true, termsFollow: true });
    const pages = await pdfItems(buf);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      for (const i of page) {
        if (i.str.trim() === '') continue;
        expect(i.y, i.str).toBeGreaterThan(PAGE.height - CONTENT.bottom - 0.5);
      }
    }
    const all = (await pdfText(buf)).join(' ');
    expect(all).toContain('Item number 30');
    expect(all).toContain('Terms and conditions follow.');
  });
});

describe('no em dashes', () => {
  it('appears in neither page', async () => {
    const q = quote(
      { warnings: ['A warning.'] },
      {
        aboveBudget: true,
        roofLimited: true,
        sentinel: { upliftPercent: 12, annualSavingsGbp: 1040, paybackYears: 10, addedCostGbp: 0 },
      },
    );
    const d = docFor({}, q, snapshot({ deposit: { kind: 'percent', percent: 25 } }));
    const all =
      (await text(await cover(d))) +
      (await text(await quotation(d, { mcsBlock: true, termsFollow: true })));
    expect(all).not.toContain('—');
  });
});
