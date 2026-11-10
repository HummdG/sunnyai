/**
 * The visual check of the quotation: the sample PDF, with the default settings
 * and with every setting on, rasterised page by page.
 *
 * SUNNY_SHOTS_DIR is the directory the PNGs are written to, made if missing;
 * unset, nothing is written. To look at them:
 *   SUNNY_SHOTS_DIR=.cache/shots/quotation npx vitest run apps/api/test/proposal-visual.test.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { defaultQuotationSettings, type QuotationSettings } from '@sunny/contracts';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';

import { MemoryBrandAssetStore } from '../src/branding/store.js';
import { CONTENT, PAGE } from '../src/proposal/layout.js';
import { samplePdf } from '../src/proposal/sample.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT } from '../src/tenants.js';
import { pdfItems, pdfText } from './pdf-text.js';

const LOGO = 'a1a1a1a1a1a1a1a1';
const BADGES = ['b1b1b1b1b1b1b1b1', 'b2b2b2b2b2b2b2b2', 'b3b3b3b3b3b3b3b3'];

const TERMS = [
  '1. Your quotation',
  'This quotation is valid for the period shown on its cover. Prices include VAT at the rate in force on the date of the quotation.',
  '2. Survey',
  'Before any work starts we will survey your property. If the survey changes the price, we will send you a revised quotation and you may cancel without charge.',
  '3. Payment',
  '• The deposit is payable once the survey has confirmed the final price.',
  '• The balance is payable within 7 days of completion.',
  '4. Guarantees',
  'Your installation is covered by the manufacturer warranties listed in this quotation and by our workmanship guarantee.',
].join('\n');

const everything: QuotationSettings = {
  ...defaultQuotationSettings(),
  logoAssetId: LOGO,
  signer: {
    name: 'Priya Shah',
    role: 'Senior solar design consultant',
    phone: '0151 496 0000',
    email: 'priya@brightside-solar.example',
  },
  accreditations: { mcsNumber: 'MCS NAP-12345', logoAssetIds: BADGES },
  sections: { system: true, performance: false, savings: true, terms: true },
  deposit: { kind: 'percent', percent: 25 },
  balanceDue: 'within 14 days of completion',
  validityDays: 45,
  letter: {
    opening: 'Thank you for asking us to look at your roof. Here is what we would fit.',
    closing: 'We look forward to working with you.',
  },
  terms: TERMS,
  colours: { rail: '#1f3b2d', accent: '#c8553d' },
};

/** A PNG of the given size: a solid bar or disc, transparent around it. */
function png(width: number, height: number, rgb: [number, number, number], disc = false): Buffer {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const r = Math.min(width, height) / 2 - 2;
      const inside = disc
        ? (x - width / 2) ** 2 + (y - height / 2) ** 2 <= r * r
        : y > height * 0.2 && y < height * 0.8;
      img.data.set(inside ? [...rgb, 255] : [0, 0, 0, 0], (y * width + x) * 4);
    }
  return PNG.sync.write(img);
}

const dir = mkdtempSync(join(tmpdir(), 'sunny-visual-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function render(settings: QuotationSettings | undefined): Promise<Buffer> {
  const brandAssets = new MemoryBrandAssetStore();
  await brandAssets.put(DEMO_TENANT.id, `${LOGO}.png`, png(400, 80, [30, 60, 120]));
  for (const [i, id] of BADGES.entries()) {
    await brandAssets.put(DEMO_TENANT.id, `${id}.png`, png(96, 96, [40 + i * 60, 120, 60], true));
  }
  return samplePdf({
    sources: { store: new FileStore(dir), brandAssets, sunscan: null },
    tenant: DEMO_TENANT,
    settings,
    pricing: null,
    priceList: null,
    products: [],
  });
}

/** Rasterise every page; PNGs are written only when SUNNY_SHOTS_DIR is set. */
async function shoot(buf: Buffer, name: string): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');
  const dir = process.env['SUNNY_SHOTS_DIR'];
  const out = dir ? resolve(dir) : null;
  if (out) mkdirSync(out, { recursive: true });
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false });
  const doc = await task.promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({
      canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;
    const bytes = canvas.toBuffer('image/png');
    expect(bytes.length).toBeGreaterThan(1000);
    if (out) writeFileSync(join(out, `${name}-p${i}.png`), bytes);
  }
  const pages = doc.numPages;
  await task.destroy();
  return pages;
}

/**
 * Per page: the text items, how much of the content band the text fills
 * (0 to 1, from the top of the band to the lowest text in it), and whether it
 * is a terms continuation page.
 */
async function pageFacts(buf: Buffer) {
  return (await pdfItems(buf)).map((items) => {
    const text = items.map((i) => i.str).join(' ');
    let lowest: number = CONTENT.top;
    for (const i of items) {
      if (i.str.trim() === '') continue;
      const bottom = PAGE.height - i.y;
      if (bottom <= CONTENT.bottom + 1) lowest = Math.max(lowest, bottom);
    }
    return {
      text,
      used: (lowest - CONTENT.top) / (CONTENT.bottom - CONTENT.top),
      termsContinued: /TERMS AND CONDITIONS, CONTINUED/.test(text),
    };
  });
}

/** The signature sits on the page with the estimated total, and no page is nearly empty. */
async function expectWellLaidOut(buf: Buffer) {
  const pages = await pageFacts(buf);
  // Case matters: the rails print ESTIMATED TOTAL in capitals.
  const signed = pages.findIndex((p) => /\bSigned\b/.test(p.text));
  const total = pages.findIndex((p) => /Estimated total/.test(p.text));
  expect(signed).toBeGreaterThan(-1);
  expect(signed).toBe(total);
  const sparse = pages
    .map((p, i) => ({ page: i + 1, used: p.used, skip: p.termsContinued }))
    .filter((p) => !p.skip && p.used < 0.25);
  expect(sparse).toEqual([]);
}

/** Text items that lie, even partly, outside the page. */
async function offPage(buf: Buffer): Promise<string[]> {
  const out: string[] = [];
  (await pdfItems(buf)).forEach((items, p) => {
    for (const i of items) {
      if (i.str.trim() === '') continue;
      if (i.x < 0 || i.x + i.width > PAGE.width || i.y < 0 || i.y + i.height > PAGE.height) {
        out.push(`p${p + 1}: "${i.str}"`);
      }
    }
  });
  return out;
}

describe('the quotation, looked at', () => {
  it('renders the default sample on five pages, all text on the page', async () => {
    const buf = await render(undefined);
    expect(await shoot(buf, 'default')).toBe(5);
    expect(await offPage(buf)).toEqual([]);
    await expectWellLaidOut(buf);
  }, 60_000);

  it('renders the sample with every setting on, all text on the page', async () => {
    const buf = await render(everything);
    const pages = await shoot(buf, 'everything');
    const text = (await pdfText(buf)).join(' ');
    expect(pages).toBeGreaterThan(1);
    await expectWellLaidOut(buf);
    expect(text).toContain('Deposit, payable once your survey has confirmed the final price');
    expect(text).toContain('MCS NAP-12345');
    expect(text).toContain('Priya Shah');
    expect(text).toContain('Survey');
    expect(text).not.toContain('—');
    expect(await offPage(buf)).toEqual([]);
  }, 60_000);
});
