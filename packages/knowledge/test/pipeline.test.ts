import { describe, expect, it } from 'vitest';

import {
  chunkDocument,
  cosine,
  htmlToMarkdown,
  hybridSearch,
  MAX_CHUNK_CHARS,
  reciprocalRankFusion,
  scanForPii,
  type KnowledgeChunk,
  type KnowledgeDocument,
} from '@sunny/knowledge';

function doc(text: string, id = 'doc_1'): KnowledgeDocument {
  return { id, title: 'Price list', url: 'https://installer.test/prices', version: 'v1', text };
}

const PRICE_TABLE = [
  '| Package | Panels | Battery | Price |',
  '| --- | --- | --- | --- |',
  '| Starter | 8 x REC420AA | none | £6,450 |',
  '| Family | 12 x REC420AA | Powerwall 3 | £13,900 |',
].join('\n');

describe('structure-aware chunking', () => {
  it('splits on H1, H2 and H3 and keeps each heading with its body', () => {
    const chunks = chunkDocument(
      doc('# Solar\n\nIntro.\n\n## Batteries\n\nWe fit Powerwall 3.\n\n### Warranty\n\n10 years.'),
    );
    expect(chunks.map((c) => c.heading)).toEqual(['Solar', 'Batteries', 'Warranty']);
  });

  it('never cuts a pricing table, even when prose is glued to it', () => {
    const intro = 'Our packages are priced as follows. '.repeat(30);
    const chunks = chunkDocument(
      doc(`## Prices\n\n${intro}\n${PRICE_TABLE}\nAll prices include VAT.`),
    );
    const holding = chunks.filter((c) => c.text.includes('| Package |'));
    expect(holding).toHaveLength(1);
    expect(holding[0]!.text).toContain(PRICE_TABLE);
  });

  it('splits an over-long table by rows and repeats the header on every piece', () => {
    const rows = Array.from(
      { length: 80 },
      (_, i) => `| Model ${i} | IQ8M | ${400 + i} W | £${1000 + i} |`,
    );
    const table = [
      '| Model | Inverter | Power | Price |',
      '| --- | --- | --- | --- |',
      ...rows,
    ].join('\n');
    const chunks = chunkDocument(doc(`## Range\n\n${table}`));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith('| Model | Inverter | Power | Price |\n| --- |')).toBe(true);
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      for (const line of chunk.text.split('\n')) expect(line).toMatch(/^\|.*\|$/);
    }
    const all = chunks.map((c) => c.text).join('\n');
    for (const row of rows) expect(all).toContain(row);
  });

  it('keeps a warranty clause whole rather than cutting mid-sentence', () => {
    const clause =
      'Our 25-year workmanship warranty covers roof penetrations, mounting and wiring we installed. ';
    const chunks = chunkDocument(doc(`## Warranty\n\n${clause.repeat(20)}`));
    for (const chunk of chunks.slice(0, -1)) expect(chunk.text.endsWith(' ')).toBe(true);
    expect(chunks.map((c) => c.text).join('')).toBe(clause.repeat(20).trim());
  });
});

describe('html to markdown', () => {
  const page = `<!doctype html><html><head><title>Batteries | Northwind Solar</title>
    <style>.x{}</style><script>track()</script></head><body>
    <header><a href="/">Logo</a><nav><a href="/a">Home</a><a href="/b">About</a></nav></header>
    <main><h1>Home batteries</h1>
    <p>We install the <strong>Tesla Powerwall 3</strong> and <a href="/givenergy">GivEnergy</a> &amp; more.</p>
    <h2>Prices</h2>
    <table><tr><th>Battery</th><th>Price</th></tr><tr><td>Powerwall 3</td><td>&pound;7,950</td></tr></table>
    <ul><li>Free survey</li><li>10-year warranty</li></ul>
    </main><footer>© 2026 Northwind · Cookie policy</footer></body></html>`;

  it('keeps headings, lists, tables and absolute links, and drops the chrome', () => {
    const { title, markdown } = htmlToMarkdown(page, 'https://northwind.test/batteries');
    expect(title).toBe('Batteries | Northwind Solar');
    expect(markdown).toContain('# Home batteries');
    expect(markdown).toContain('## Prices');
    expect(markdown).toContain('| Battery | Price |\n| --- | --- |\n| Powerwall 3 | £7,950 |');
    expect(markdown).toContain('- Free survey');
    expect(markdown).toContain('[GivEnergy](https://northwind.test/givenergy)');
    expect(markdown).toContain('**Tesla Powerwall 3**');
    expect(markdown).not.toMatch(/track\(\)|Cookie policy|About|\.x\{\}/);
  });

  it('chunks a converted page with the table intact', () => {
    const { markdown } = htmlToMarkdown(page, 'https://northwind.test/batteries');
    const chunks = chunkDocument(doc(markdown));
    const priced = chunks.find((c) => c.heading === 'Prices');
    expect(priced?.text).toContain('| Powerwall 3 | £7,950 |');
  });
});

describe('PII quarantine', () => {
  it('passes an ordinary spec sheet untouched', () => {
    const scan = scanForPii(
      'REC Alpha Pure-R 430 W. Model REC430AA. Serial format 1234567890123. Call 01632 960123.',
    );
    expect(scan.verdict).toBe('clean');
  });

  it("quarantines a customer's utility bill", () => {
    const bill = [
      'Customer name: Jane Example',
      '14 Acacia Avenue, Leeds LS1 4AB',
      'Account number 12345678 Sort code 20-00-00',
      'MPAN 1200 0000 0000 0',
      'Amount due: £143.20 by Direct Debit',
      'jane.example@gmail.com 07700 900123',
    ].join('\n');
    const scan = scanForPii(bill);
    expect(scan.verdict).toBe('quarantine');
    expect(scan.findings.map((f) => f.kind)).toEqual(
      expect.arrayContaining(['uk-bank-account', 'customer-record']),
    );
    expect(scan.reason).toMatch(/Not indexed/);
  });

  it('quarantines a valid card number but not a Luhn-failing one', () => {
    expect(scanForPii('Card 4111 1111 1111 1111').verdict).toBe('quarantine');
    expect(scanForPii('Part 4111 1111 1111 1112').verdict).toBe('clean');
  });

  it('quarantines IBANs, NI numbers and SSNs', () => {
    expect(scanForPii('Pay GB82 WEST 1234 5698 7654 32').findings[0]?.kind).toBe('iban');
    expect(scanForPii('NI: AB 12 34 56 C').verdict).toBe('quarantine');
    expect(scanForPii('SSN 123-45-6789').verdict).toBe('quarantine');
  });

  it("redacts a private individual's email but keeps the installer's own", () => {
    const scan = scanForPii('Write to sales@northwind.test or bob.smith@hotmail.com.', {
      businessDomains: ['northwind.test'],
    });
    expect(scan.verdict).toBe('redact');
    expect(scan.redacted).toContain('sales@northwind.test');
    expect(scan.redacted).not.toContain('bob.smith@hotmail.com');
  });
});

describe('hybrid retrieval', () => {
  const chunk = (id: string, text: string, heading: string | null = null): KnowledgeChunk => ({
    id,
    documentId: id.split('#')[0]!,
    title: id,
    url: null,
    version: 'v1',
    heading,
    ordinal: 0,
    text,
  });
  const chunks = [
    chunk('a#0', 'We fit the Enphase IQ8M microinverter on every system.'),
    chunk('b#0', 'Our prices start at six thousand pounds for a starter package.'),
    chunk('c#0', 'Batteries: Tesla Powerwall 3 and GivEnergy.'),
  ];

  it('is lexical when there are no vectors, and still finds an exact model number', async () => {
    const result = await hybridSearch(chunks, 'Do you install IQ8M?');
    expect(result.mode).toBe('lexical');
    expect(result.hits[0]?.chunk.id).toBe('a#0');
  });

  it('lets meaning find a passage that shares no words with the question', async () => {
    const vectors = new Map<string, number[]>([
      ['a#0', [1, 0, 0]],
      ['b#0', [0, 1, 0]],
      ['c#0', [0, 0, 1]],
    ]);
    const result = await hybridSearch(chunks, 'how much does it cost', {
      queryVector: [0.1, 0.95, 0.05],
      vectors,
    });
    expect(result.mode).toBe('hybrid');
    expect(result.hits[0]?.chunk.id).toBe('b#0');
  });

  it('fuses rankings so agreement beats a single first place', () => {
    const fused = reciprocalRankFusion([
      ['x', 'y', 'z'],
      ['y', 'q', 'x'],
    ]);
    expect(fused[0]?.id).toBe('y');
  });

  it('lets a reranker reorder but never drop evidence, and survives its failure', async () => {
    const vectors = new Map<string, number[]>([['c#0', [1, 0]]]);
    const reordered = await hybridSearch(chunks, 'IQ8M Powerwall', {
      queryVector: [1, 0],
      vectors,
      rerank: () => Promise.resolve(['c#0']),
    });
    expect(reordered.reranked).toBe(true);
    expect(reordered.hits.map((h) => h.chunk.id)).toEqual(['c#0', 'a#0']);

    const failing = await hybridSearch(chunks, 'IQ8M', {
      rerank: () => Promise.reject(new Error('ranking API down')),
    });
    expect(failing.reranked).toBe(false);
    expect(failing.hits[0]?.chunk.id).toBe('a#0');
  });

  it('computes cosine similarity', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });
});
