/** The heat pump estimate PDF: its pages, figures, grant deduction and disclaimer. */
import { HEAT_PUMP_DISCLAIMER } from '@sunny/heat-pump-engine';
import { describe, expect, it } from 'vitest';

import type { HeatPumpQuoteRecord } from '../src/journey/heat-pump/record.js';
import { toQuoteCard } from '../src/journey/service.js';
import { drawGrant } from '../src/proposal/heat-pump/grant.js';
import { drawRunningCosts } from '../src/proposal/heat-pump/running-costs.js';
import { drawHeatPumpSystem } from '../src/proposal/heat-pump/system.js';
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
  hpEstimate,
  hpOption,
  hpQuote,
  outOfBounds,
  render,
  snapshot,
} from './proposal-fixtures.js';
import { pdfItems, pdfText } from './pdf-text.js';

const NOW = new Date('2026-11-10T10:00:00Z');
const THEME = themeFor('#0f2a3d');

const sources: ProposalSources = {
  store: {
    getConversation: () =>
      Promise.resolve({ answers: { hp_current_heating: 'gas', address: '14 Elm Close' } }),
  } as unknown as Store,
};

async function textOf(q: HeatPumpQuoteRecord): Promise<string[]> {
  return pdfText(await proposalPdf(sources, DEMO_TENANT, q, null, NOW));
}

describe('the heat pump estimate PDF', () => {
  it('reads as a heat pump estimate, page by page', async () => {
    const pages = await textOf(hpQuote());
    const all = pages.join('\n');
    expect(pages[0]).toContain('Heat pump estimate');
    expect(all).toContain('7 kW');
    expect(all).toContain('Boiler Upgrade Scheme');
    expect(all).toContain('Boiler Upgrade Scheme grant −£7,500');
    expect(all).toContain('The installer applies for the grant and it comes off your invoice.');
    expect(all).toContain(HEAT_PUMP_DISCLAIMER);
    const order = [
      'Your heat pump',
      'Running costs',
      'Boiler Upgrade Scheme',
      'Estimated quotation',
    ];
    const at = order.map((t) => pages.findIndex((p, i) => i > 0 && p.includes(t)));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('shows the system facts, the running costs and the grant', async () => {
    const all = (await textOf(hpQuote())).join('\n');
    expect(all).toContain('6.4 kW');
    expect(all).toContain('assumed from bedrooms');
    expect(all).toContain('Vaillant aroTHERM plus 7 kW');
    expect(all).toContain('Heat pump only');
    expect(all).toContain('Gas boiler');
    expect(all).toContain('£1,150');
    expect(all).toContain('£940');
    expect(all).toContain('£210');
    expect(all).toContain('3.2');
    expect(all).toContain('Floor area assumed from 3 bedrooms.');
    expect(all).toContain('1 October 2026');
    expect(all).toContain('Your home is in England.');
  });

  it('carries the disclaimer on Your heat pump and above the quotation total', async () => {
    const pages = await textOf(hpQuote());
    const system = pages.find(
      (p) => p.includes('Your heat pump') && p.includes('Estimated peak heat loss'),
    );
    expect(system).toContain(HEAT_PUMP_DISCLAIMER);
    const quotation = pages.find((p) => p.includes('Estimated quotation'))!;
    const disclaimerAt = quotation.indexOf(HEAT_PUMP_DISCLAIMER);
    expect(disclaimerAt).toBeGreaterThan(-1);
    expect(disclaimerAt).toBeLessThan(quotation.indexOf('Estimated total after the grant'));
    expect(disclaimerAt).toBeLessThan(quotation.lastIndexOf('£5,000'));
  });

  it('has no running-costs page with performance off', async () => {
    const snap = snapshot({
      sections: { system: true, performance: false, savings: true, terms: false },
    });
    const pages = await textOf(hpQuote({}, snap));
    expect(pages.join('\n')).not.toContain('Running costs');
    expect(pages.join('\n')).toContain('Boiler Upgrade Scheme');
  });

  it('follows the other switches: no Your heat pump, no grant page', async () => {
    const snap = snapshot({
      sections: { system: false, performance: true, savings: false, terms: false },
    });
    const pages = await textOf(hpQuote({}, snap));
    const all = pages.join('\n');
    expect(all).not.toContain('Estimated peak heat loss');
    expect(all).not.toContain('it comes off your invoice');
    expect(all).toContain('Running costs');
  });

  it('never uses an en or em dash', async () => {
    for (const q of [
      hpQuote(),
      hpQuote({
        estimate: hpEstimate({ bus: { eligible: 'unsure', amountGbp: 7500, reasons: [] } }),
        options: [hpOption({ grantGbp: 0, priceAfterGrantGbp: 12500 })],
      }),
      hpQuote({
        options: [hpOption({ priceGbp: null, priceAfterGrantGbp: null, installerPriced: true })],
      }),
    ]) {
      const all = (await textOf(q)).join('\n');
      expect(all).not.toContain(String.fromCodePoint(0x2013));
      expect(all).not.toContain(String.fromCodePoint(0x2014));
    }
  });

  it('prints "Priced by your installer" for an installer-priced option, with no total', async () => {
    const pages = await textOf(
      hpQuote({
        priced: false,
        options: [
          hpOption({
            priceGbp: null,
            priceAfterGrantGbp: null,
            installerPriced: true,
            warnings: ['Your installer will price the new cylinder.'],
          }),
        ],
      }),
    );
    const quotation = pages.find((p) => p.includes('Estimated quotation'))!;
    expect(quotation).toContain('Priced by your installer');
    expect(quotation).not.toContain('£5,000');
    expect(quotation).toContain('Your installer will price the new cylinder.');
  });

  it('notes an unsure grant without deducting it', async () => {
    const pages = await textOf(
      hpQuote({
        estimate: hpEstimate({ bus: { eligible: 'unsure', amountGbp: 7500, reasons: [] } }),
        options: [hpOption({ grantGbp: 0, priceAfterGrantGbp: 12500 })],
      }),
    );
    const all = pages.join('\n');
    expect(all).toContain('The Boiler Upgrade Scheme may apply. Your installer will confirm.');
    expect(all).not.toContain('−£7,500');
    expect(all).toContain('£12,500');
  });

  it('is named for the postcode', () => {
    expect(proposalFilename(DEMO_TENANT, hpQuote())).toBe('heat-pump-estimate-NR4-7TJ.pdf');
  });

  it('is titled as a heat pump estimate and stays inside the page', async () => {
    const snap = snapshot({
      deposit: { kind: 'percent', percent: 25 },
      sections: { system: true, performance: true, savings: true, terms: true },
      terms: '1. Payment\nThe balance is payable on completion.',
      letter: { opening: 'Thank you for asking us.', closing: 'We look forward to it.' },
    });
    for (const q of [hpQuote({}, snap), hpQuote({ chosenOptionId: 'heat_pump_only' }, snap)]) {
      const buf = await proposalPdf(sources, DEMO_TENANT, q, null, NOW);
      // The pages without the rail, drawn alone, keep inside the content band.
      const doc = await proposalDocFor(sources, DEMO_TENANT, q, null, NOW);
      for (const draw of [drawHeatPumpSystem, drawRunningCosts, drawGrant]) {
        const page = await render((pdf) => draw(pdf, doc, THEME));
        expect(outOfBounds(await pdfItems(page))).toEqual([]);
      }
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false });
      const meta = await (await task.promise).getMetadata();
      expect((meta.info as { Title?: string }).Title).toBe('Heat pump estimate for 14 Elm Close');
      await task.destroy();
    }
  });

  it('is offered on the card, as a solar proposal is', () => {
    const card = toQuoteCard(hpQuote(), { emailAvailable: true });
    expect(card.proposalAvailable).toBe(true);
    expect(card.emailAvailable).toBe(true);
  });
});
