/** The battery estimate PDF: its pages, the savings table, the rates and the disclaimer. */
import { BATTERY_DISCLAIMER } from '@sunny/quote-engine';
import { describe, expect, it } from 'vitest';

import type { BatteryQuoteRecord } from '../src/journey/battery/record.js';
import { hasProposal } from '../src/journey/quote-kinds.js';
import { toQuoteCard } from '../src/journey/service.js';
import { drawBatterySavings } from '../src/proposal/battery/savings.js';
import { drawBatterySystem } from '../src/proposal/battery/system.js';
import {
  proposalDocFor,
  proposalFilename,
  proposalPdf,
  type ProposalSources,
} from '../src/proposal/index.js';
import { themeFor } from '../src/proposal/layout.js';
import type { Store } from '../src/store.js';
import { DEMO_TENANT } from '../src/tenants.js';

import {
  batEstimate,
  batOption,
  batQuote,
  outOfBounds,
  render,
  snapshot,
} from './proposal-fixtures.js';
import { pdfItems, pdfText } from './pdf-text.js';

const NOW = new Date('2026-11-10T10:00:00Z');
const THEME = themeFor('#0f2a3d');

const sources: ProposalSources = {
  store: {
    getConversation: () => Promise.resolve({ answers: { address: '14 Elm Close' } }),
  } as unknown as Store,
};

async function textOf(q: BatteryQuoteRecord): Promise<string[]> {
  return pdfText(await proposalPdf(sources, DEMO_TENANT, q, null, NOW));
}

/** A smart time-of-use quote: the cheap-rate saving is part of the total. */
function touQuote(): BatteryQuoteRecord {
  return batQuote({
    tariff: 'smart_tou',
    estimate: batEstimate({ offPeakPence: 8, peakPence: 28, assumptions: [] }),
    options: [
      batOption({
        annualSavingsGbp: 400,
        selfUseSavingGbp: 150,
        shiftSavingGbp: 250,
        paybackYears: 8,
      }),
    ],
  });
}

/** An option missing a part of its price: its lines so far, no total. */
function installerPricedQuote(): BatteryQuoteRecord {
  return batQuote({
    priced: false,
    options: [
      batOption({
        priceGbp: null,
        priceLabel: 'Priced by your installer',
        paybackYears: null,
        installerPriced: true,
        warnings: ['Your installer will price the AC coupling your inverter needs.'],
      }),
    ],
  });
}

describe('the battery estimate PDF', () => {
  it('reads as a battery estimate, page by page', async () => {
    const pages = await textOf(batQuote());
    const all = pages.join('\n');
    expect(pages[0]).toContain('Battery estimate');
    expect(all).toContain('5 kWh');
    expect(all).toContain('Savings');
    expect(all).toContain(BATTERY_DISCLAIMER);
    const order = ['Your battery', 'Savings', 'Estimated quotation'];
    const at = order.map((t) => pages.findIndex((p, i) => i > 0 && p.includes(t)));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('shows the existing solar, the use, the recommended size and the options', async () => {
    const pages = await textOf(batQuote());
    const system = pages.find((p) => p.includes('Recommended battery size'))!;
    expect(system).toContain('4 kWp');
    expect(system).not.toContain('assumed');
    expect(system).toContain('3,500 kWh');
    expect(system).toContain('Acme 5 kWh');
    expect(system).toContain('Options compared');
    expect(system).toContain('More storage');
    expect(system).not.toContain('(recommended)');
    expect(system).toContain('£4,000');
    expect(system).toContain(BATTERY_DISCLAIMER);
  });

  it('says when the solar size was assumed', async () => {
    const all = (await textOf(batQuote({ estimate: batEstimate({ pvKwpAssumed: true }) }))).join(
      '\n',
    );
    expect(all).toContain('4 kWp, assumed');
  });

  it('has no cheap-rate row on a standard tariff', async () => {
    const pages = await textOf(batQuote());
    const savings = pages.find((p) => p.includes('Storing your own solar'))!;
    expect(savings).toContain('£160 a year');
    expect(savings).not.toContain('cheap rate');
    expect(savings).not.toContain('Cheap rate');
    expect(savings).toContain('Total saving');
    expect(savings).toContain('20 years');
    expect(savings).toContain('24.5p per kWh');
    expect(savings).toContain('15p per kWh');
    expect(savings).toContain(
      'On a single-rate tariff the battery saves by storing your own solar.',
    );
    expect(savings).toContain('1 October 2026');
  });

  it('adds the cheap-rate row and the rates on a time-of-use tariff', async () => {
    const savings = (await textOf(touQuote())).find((p) => p.includes('Storing your own solar'))!;
    expect(savings).toContain('£150 a year');
    expect(savings).toContain('Charging at the cheap rate');
    expect(savings).toContain('£250 a year');
    expect(savings).toContain('£400 a year');
    expect(savings).toContain('8 years');
    expect(savings).toContain('8p per kWh');
    expect(savings).toContain('28p per kWh');
    expect(savings).toContain('Smart time-of-use');
    expect(savings).toContain('1 October 2026');
  });

  it('carries the disclaimer above the quotation total, with no grant row', async () => {
    const quotation = (await textOf(batQuote())).find((p) => p.includes('Estimated quotation'))!;
    const at = quotation.indexOf(BATTERY_DISCLAIMER);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(quotation.indexOf('Estimated total'));
    expect(quotation).toContain('£3,200');
    expect(quotation).not.toContain('grant');
    expect(quotation).not.toContain('Priced so far');
  });

  it('prints "Priced so far" and no total for an installer-priced option', async () => {
    const pages = await textOf(installerPricedQuote());
    const quotation = pages.find((p) => p.includes('Estimated quotation'))!;
    expect(quotation).toContain('Priced so far');
    expect(quotation).toContain('Priced by your installer');
    expect(quotation).toContain('Your installer will price the AC coupling your inverter needs.');
    expect(quotation.indexOf('Priced so far')).toBeLessThan(quotation.indexOf('Acme 5 kWh'));
    // The line so far, once; never as a total.
    expect(quotation.split('£3,200').length - 1).toBe(1);
    expect(pages[0]).not.toContain('£3,200');
  });

  it('follows the switches: savings or performance on shows Savings', async () => {
    const off = snapshot({
      sections: { system: false, performance: false, savings: false, terms: false },
    });
    const none = (await textOf(batQuote({}, off))).join('\n');
    expect(none).not.toContain('Recommended battery size');
    expect(none).not.toContain('Storing your own solar');
    expect(none).toContain('Estimated quotation');
    for (const sections of [
      { system: false, performance: true, savings: false, terms: false },
      { system: false, performance: false, savings: true, terms: false },
    ]) {
      const all = (await textOf(batQuote({}, snapshot({ sections })))).join('\n');
      expect(all).toContain('Storing your own solar');
      expect(all.split('Storing your own solar').length - 1).toBe(1);
    }
  });

  it('never uses an en or em dash', async () => {
    const snap = snapshot({
      sections: { system: true, performance: true, savings: true, terms: true },
      terms: '1. Payment\nThe balance is payable on completion.',
    });
    for (const q of [
      batQuote({}, snap),
      touQuote(),
      installerPricedQuote(),
      batQuote({ chosenOptionId: 'more_storage', estimate: batEstimate({ pvKwpAssumed: true }) }),
      batQuote({ tariff: 'economy7', estimate: batEstimate({ offPeakPence: 15, peakPence: 30 }) }),
    ]) {
      const all = (await textOf(q)).join('\n');
      expect(all).not.toContain(String.fromCodePoint(0x2013));
      expect(all).not.toContain(String.fromCodePoint(0x2014));
    }
  });

  it('is named for the postcode', () => {
    expect(proposalFilename(DEMO_TENANT, batQuote())).toBe('battery-estimate-NR4-7TJ.pdf');
    expect(proposalFilename(DEMO_TENANT, batQuote({ postcode: ' ' }))).toBe('battery-estimate.pdf');
  });

  it('is titled as a battery estimate and stays inside the page', async () => {
    for (const q of [batQuote(), touQuote(), batQuote({ chosenOptionId: 'more_storage' })]) {
      const buf = await proposalPdf(sources, DEMO_TENANT, q, null, NOW);
      const doc = await proposalDocFor(sources, DEMO_TENANT, q, null, NOW);
      for (const draw of [drawBatterySystem, drawBatterySavings]) {
        const page = await render((pdf) => draw(pdf, doc, THEME));
        expect(outOfBounds(await pdfItems(page))).toEqual([]);
      }
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false });
      const meta = await (await task.promise).getMetadata();
      expect((meta.info as { Title?: string }).Title).toBe('Battery estimate for 14 Elm Close');
      await task.destroy();
    }
  });

  it('documents the chosen option when the visitor picked one', async () => {
    const doc = await proposalDocFor(
      sources,
      DEMO_TENANT,
      batQuote({ chosenOptionId: 'more_storage' }),
      null,
      NOW,
    );
    expect(doc.option.id).toBe('more_storage');
    expect(doc.chosen).toBe(true);
    const all = (await textOf(batQuote({ chosenOptionId: 'more_storage' }))).join(' ');
    expect(all).toContain('More storage (your choice)');
    expect(all).toContain('You chose a 9.5 kWh battery, for more storage.');
  });

  it('is offered on the card and by the routes', () => {
    expect(hasProposal(batQuote())).toBe(true);
    const card = toQuoteCard(batQuote(), { emailAvailable: true });
    expect(card.proposalAvailable).toBe(true);
  });
});
