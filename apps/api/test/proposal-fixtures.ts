/** Shared fixtures for the proposal page tests: a stored quote, a snapshot and a ProposalDoc. */
import { defaultQuotationSettings } from '@sunny/contracts';
import PDFDocument from 'pdfkit';

import type { QuoteOptionView, QuoteRecord } from '../src/journey/quote.js';
import { referenceFor } from '../src/proposal/copy.js';
import type { ProposalDoc } from '../src/proposal/doc.js';
import { CONTENT, PAGE, registerFonts } from '../src/proposal/layout.js';
import type { QuotationSnapshot } from '../src/proposal/snapshot.js';
import type { PdfTextItem } from './pdf-text.js';

export function option(over: Partial<QuoteOptionView> = {}): QuoteOptionView {
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

export function quote(
  over: Partial<QuoteRecord> = {},
  opt: Partial<QuoteOptionView> = {},
): QuoteRecord {
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

export function snapshot(over: Partial<QuotationSnapshot> = {}): QuotationSnapshot {
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

export function docFor(
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

export function render(draw: (pdf: PDFKit.PDFDocument) => void): Promise<Buffer> {
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

/** Text items outside the page column or the content band (blank items ignored). */
export function outOfBounds(pages: PdfTextItem[][], slack = 0.6): string[] {
  const out: string[] = [];
  pages.forEach((items, p) => {
    for (const i of items) {
      if (i.str.trim() === '') continue;
      const top = PAGE.height - (i.y + i.height);
      const bottom = PAGE.height - i.y;
      if (
        i.x < PAGE.margin - slack ||
        i.x + i.width > PAGE.width - PAGE.margin + slack ||
        top < CONTENT.top - 4 ||
        bottom > CONTENT.bottom + slack
      ) {
        out.push(
          `p${p + 1}: "${i.str}" x=${i.x.toFixed(1)} w=${i.width.toFixed(1)} y=${i.y.toFixed(1)}`,
        );
      }
    }
  });
  return out;
}
