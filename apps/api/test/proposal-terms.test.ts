import { describe, expect, it } from 'vitest';

import { themeFor } from '../src/proposal/layout.js';
import { drawTerms, TERMS_HAS_RAIL } from '../src/proposal/pages/terms.js';
import { glyphSafe, parseTerms } from '../src/proposal/terms.js';
import { docFor, outOfBounds, render, snapshot } from './proposal-fixtures.js';
import { pdfItems, pdfText } from './pdf-text.js';

const THEME = themeFor('#0f2a3d');
const URL300 = `https://example.co.uk/${'terms-and-conditions-'.repeat(13)}${'x'.repeat(300 - 22 - 21 * 13)}`;

/** A paste from Word: CRLF, tabs, bullets, numbering, curly quotes, a 300-char URL. */
const WORD_PASTE = [
  'TERMS AND CONDITIONS OF SALE',
  '',
  'Payment',
  'The “Customer” agrees to pay the deposit on acceptance of this quotation.',
  'The balance is due within 7 days of completion.',
  '',
  '1.\tDefinitions apply throughout.',
  '2)\tThe Company’s liability is limited to the contract price.',
  '•\tAll equipment carries the manufacturer’s warranty.',
  '◦\tPanels: 25 years.',
  '-\tScaffolding is included.',
  '* Waste is removed from site.',
  '',
  `Full terms: ${URL300}`,
  '',
  'Cancellation',
  'You may cancel within 14 days — in writing.',
].join('\r\n');

const words = (s: string) => s.replace(/\s+/g, '');

describe('parseTerms', () => {
  it('splits a Word paste into headings, paragraphs and items', () => {
    const blocks = parseTerms(WORD_PASTE);
    expect(blocks).toEqual([
      { kind: 'heading', text: 'TERMS AND CONDITIONS OF SALE' },
      { kind: 'heading', text: 'Payment' },
      {
        kind: 'para',
        text: 'The “Customer” agrees to pay the deposit on acceptance of this quotation.',
      },
      { kind: 'para', text: 'The balance is due within 7 days of completion.' },
      { kind: 'item', marker: '1.', text: 'Definitions apply throughout.' },
      {
        kind: 'item',
        marker: '2)',
        text: 'The Company’s liability is limited to the contract price.',
      },
      {
        kind: 'item',
        marker: '•',
        text: 'All equipment carries the manufacturer’s warranty.',
      },
      { kind: 'item', marker: '◦', text: 'Panels: 25 years.' },
      { kind: 'item', marker: '-', text: 'Scaffolding is included.' },
      { kind: 'item', marker: '*', text: 'Waste is removed from site.' },
      { kind: 'para', text: `Full terms: ${URL300}` },
      { kind: 'heading', text: 'Cancellation' },
      { kind: 'para', text: 'You may cancel within 14 days — in writing.' },
    ]);
  });

  it('loses no text', () => {
    const blocks = parseTerms(WORD_PASTE);
    const joined = blocks
      .map((b) => (b.kind === 'item' ? `${b.marker}${b.text}` : b.text))
      .join('');
    expect(words(joined)).toBe(words(WORD_PASTE));
  });

  it('joins a hard-wrapped paragraph and keeps a blank line as a break', () => {
    const blocks = parseTerms(
      'The customer shall\nprovide access to the roof.\n\nNext paragraph here.',
    );
    expect(blocks).toEqual([
      { kind: 'para', text: 'The customer shall provide access to the roof.' },
      { kind: 'para', text: 'Next paragraph here.' },
    ]);
  });

  it('keeps a numbered capitals line as a heading with its number', () => {
    expect(parseTerms('1. DEFINITIONS\nIn these terms, we means the Company.')[0]).toEqual({
      kind: 'heading',
      text: '1. DEFINITIONS',
    });
  });

  it('does not take a long line without a full stop as a heading', () => {
    const long = 'x'.repeat(90);
    expect(parseTerms(`${long}\nMore text.`)[0]!.kind).toBe('para');
  });
});

describe('glyphSafe', () => {
  const latin = (cp: number) => cp < 0x2100 && cp !== 0x25e6;
  it('keeps what the font has, including pasted em dashes and curly quotes', () => {
    expect(glyphSafe('“A” — B’s', latin)).toBe('“A” — B’s');
  });
  it('swaps what it lacks for a fallback, never a missing glyph', () => {
    expect(glyphSafe('◦ item', latin)).toBe('• item');
    expect(glyphSafe('漢字 \u{1f600}', latin)).toBe('?? ?');
    expect(glyphSafe('a\u200bb\u00adc\ufeff', latin)).toBe('abc');
    expect(glyphSafe('tab\there', latin)).toBe('tab here');
    const ascii = (cp: number) => cp < 0x80;
    expect(glyphSafe('‘q’ “q” – é •', ascii)).toBe(`'q' "q" - e -`);
  });
});

describe('terms page', () => {
  const terms = (text: string) =>
    render((pdf) => drawTerms(pdf, docFor({}, undefined, snapshot({ terms: text })), THEME));

  it('has no rail', () => {
    expect(TERMS_HAS_RAIL).toBe(false);
  });

  it('draws the Word paste inside the margins, every word kept', async () => {
    const buf = await terms(WORD_PASTE);
    const pages = await pdfItems(buf);
    expect(outOfBounds(pages)).toEqual([]);
    const t = (await pdfText(buf)).join(' ');
    expect(t).toContain('Terms and conditions');
    expect(t).toContain('TERMS AND CONDITIONS OF SALE');
    expect(t).toContain('“Customer”');
    expect(t).toContain('— in writing');
    expect(t).toContain('◦');
    // The URL is broken across lines but every character is there.
    expect(words(t)).toContain(words(URL300));
  });

  it('flows 40,000 characters over several pages, all inside the bounds', async () => {
    let text = '';
    let n = 1;
    while (text.length < 40000) {
      text +=
        `${n}. CLAUSE ${n}\r\n` +
        `•\tThe Customer shall allow the Company’s installers access to the property ` +
        `at reasonable times to carry out the survey and the installation of the system, ` +
        `and shall make sure the roof and the electrics are safe to work on.\r\n` +
        `This clause is governed by the law of England and Wales, and nothing in it limits ` +
        `your statutory rights as a consumer.\r\n\r\n`;
      n++;
    }
    text = text.slice(0, 40000);
    const buf = await terms(text);
    const pages = await pdfItems(buf);
    expect(pages.length).toBeGreaterThan(3);
    expect(outOfBounds(pages)).toEqual([]);
    const t = (await pdfText(buf)).join(' ');
    expect(t).toContain('CLAUSE 1 ');
    expect(t).toContain(`CLAUSE ${n - 2}`);
  });

  it('draws characters the fonts lack as a fallback, without throwing', async () => {
    const buf = await terms('Heading\nChinese 漢字 and an emoji \u{1f600} here.');
    const t = (await pdfText(buf)).join(' ');
    expect(t).toContain('Chinese ?? and an emoji ? here.');
  });
});
