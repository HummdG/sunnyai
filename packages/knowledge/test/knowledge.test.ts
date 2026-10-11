import { describe, expect, it } from 'vitest';

import {
  buildIndex,
  chunkDocument,
  chunkDocuments,
  MAX_CHUNK_CHARS,
  searchChunks,
  searchIndex,
  tokenize,
  type KnowledgeChunk,
  type KnowledgeDocument,
} from '@sunny/knowledge';

/**
 * What the retrieval layer promises, held to.
 *
 * The subject is a pure function of documents and a query, so these are
 * assertions about arithmetic and text handling rather than about a service.
 * That is the reason the package exists as a package: the properties that matter
 * -- nothing is lost in chunking, a heading stays with its passage, an empty
 * result means empty -- can be proven here without a store, a model or a
 * network, and the API-level tests can then be about tenancy instead of about
 * whether BM25 works.
 */

function doc(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: 'doc_1',
    title: 'Warranty terms',
    url: 'https://example.test/warranty',
    version: '2026-09',
    text: '# Warranty\n\nPanels carry a 25-year manufacturer warranty.',
    ...overrides,
  };
}

/** `noUncheckedIndexedAccess` makes every `[0]` optional; this says it is not. */
function first<T>(items: readonly T[]): T {
  const value = items[0];
  if (value === undefined) throw new Error('expected at least one item');
  return value;
}

describe('chunking', () => {
  it('keeps each heading with the passage under it', () => {
    const chunks = chunkDocument(
      doc({
        text: [
          '# Warranty',
          '',
          'Panels carry a 25-year manufacturer warranty.',
          '',
          '## Exclusions',
          '',
          'Storm damage is not covered.',
        ].join('\n'),
      }),
    );

    expect(chunks).toHaveLength(2);
    expect(first(chunks).heading).toBe('Warranty');
    expect(first(chunks).text).toBe('Panels carry a 25-year manufacturer warranty.');
    expect(chunks[1]?.heading).toBe('Exclusions');
    expect(chunks[1]?.text).toBe('Storm damage is not covered.');
  });

  it('leaves the text exactly as it was written', () => {
    // The parts a tidier would take away: the part number, the currency and the
    // capitalisation. An installer reads these back to a customer, so an index
    // that "cleans" them is an index that misquotes.
    const body = 'The Sunbeam SB-430 costs £185.00 ex VAT. Ask about the 25-YEAR term.';
    const chunks = chunkDocument(doc({ text: `# Prices\n\n${body}` }));

    expect(first(chunks).text).toBe(body);
    expect(first(chunks).text).toContain('SB-430');
    expect(first(chunks).text).toContain('£185.00');
    expect(first(chunks).text).toContain('25-YEAR');
  });

  it('drops a heading with no body under it', () => {
    const chunks = chunkDocument(doc({ text: '# Warranty\n\n# Exclusions\n\nStorm damage.' }));

    expect(chunks).toHaveLength(1);
    expect(first(chunks).heading).toBe('Exclusions');
  });

  it('gives a document with no headings one passage', () => {
    const chunks = chunkDocument(doc({ text: 'We cover Surrey and Sussex.' }));

    expect(chunks).toHaveLength(1);
    expect(first(chunks).heading).toBeNull();
  });

  it('splits a long section at paragraph boundaries, keeping the heading on every piece', () => {
    const paragraph = 'x'.repeat(500);
    const chunks = chunkDocument(
      doc({ text: `# Service area\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}` }),
    );

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.heading).toBe('Service area');
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });

  it('splits an over-long paragraph rather than dropping the rest of it', () => {
    // Nothing may end up on the floor. A hard cut mid-word is a worse reading
    // experience than a paragraph boundary and a far better one than a silently
    // truncated warranty.
    const text = `# Terms\n\n${'y'.repeat(MAX_CHUNK_CHARS * 2 + 10)}`;
    const chunks = chunkDocument(doc({ text }));

    expect(chunks.map((c) => c.text).join('')).toHaveLength(MAX_CHUNK_CHARS * 2 + 10);
  });

  it('keeps a table whole when it fits', () => {
    const table = ['| Panel | Watts |', '| ----- | ----- |', '| SB-430 | 430 |'].join('\n');
    const chunks = chunkDocument(doc({ text: `# Products\n\n${table}` }));

    expect(chunks).toHaveLength(1);
    expect(first(chunks).text).toBe(table);
  });

  it('is deterministic, and derives ids from the document and position', () => {
    const document = doc({ text: '# A\n\none\n\n# B\n\ntwo' });

    const once = chunkDocument(document);
    const twice = chunkDocument(document);

    expect(once.map((c) => c.id)).toEqual(twice.map((c) => c.id));
    expect(once.map((c) => c.id)).toEqual(['doc_1#0', 'doc_1#1']);
    expect(once.map((c) => c.ordinal)).toEqual([0, 1]);
  });

  it('carries the document provenance onto every chunk', () => {
    const chunks = chunkDocuments([
      doc({ id: 'doc_a', title: 'Warranty', url: 'https://a.test/w', version: 'v2' }),
      doc({ id: 'doc_b', title: 'Areas', url: null, version: 'v1', text: '# Areas\n\nSurrey.' }),
    ]);

    expect(chunks.map((c) => c.documentId)).toEqual(['doc_a', 'doc_b']);
    expect(first(chunks).url).toBe('https://a.test/w');
    expect(chunks[1]?.url).toBeNull();
    expect(chunks[1]?.version).toBe('v1');
  });
});

describe('retrieval', () => {
  const chunks: KnowledgeChunk[] = chunkDocuments([
    doc({
      id: 'doc_warranty',
      title: 'Warranty terms',
      url: 'https://example.test/warranty',
      text: [
        '# Warranty',
        '',
        'Panels carry a 25-year manufacturer warranty. The inverter is covered for 10 years.',
        '',
        '# Exclusions',
        '',
        'Storm damage and cosmetic scratches are not covered.',
      ].join('\n'),
    }),
    doc({
      id: 'doc_area',
      title: 'Areas served',
      text: ['# Areas', '', 'We install across Surrey and Sussex. We do not cover Cornwall.'].join(
        '\n',
      ),
    }),
  ]);

  it('ranks the passage that answers the question first', () => {
    const result = searchChunks(chunks, 'how long is the inverter warranty covered');

    expect(result.hits.length).toBeGreaterThan(0);
    expect(first(result.hits).chunk.documentId).toBe('doc_warranty');
    expect(first(result.hits).chunk.heading).toBe('Warranty');
    expect(first(result.hits).chunk.text).toContain('inverter');
  });

  it('finds a passage by a heading even when the body never repeats the word', () => {
    const result = searchChunks(chunks, 'exclusions');

    expect(first(result.hits).chunk.heading).toBe('Exclusions');
  });

  it('names the query terms the index does not hold', () => {
    const result = searchChunks(chunks, 'battery storage in Cornwall');

    expect(result.missingTerms).toContain('battery');
    expect(result.missingTerms).not.toContain('cornwall');
  });

  it('returns nothing rather than a weak match when no term matches', () => {
    const result = searchChunks(chunks, 'battery lithium voltage');

    expect(result.hits).toEqual([]);
    expect(result.missingTerms).toEqual(['battery', 'lithium', 'voltage']);
  });

  it('returns nothing for an empty index and does not throw', () => {
    const result = searchChunks([], 'warranty');

    expect(result.hits).toEqual([]);
    expect(result.indexedChunks).toBe(0);
    expect(result.indexedSources).toBe(0);
  });

  it('returns nothing for a query with no usable terms', () => {
    const result = searchChunks(chunks, '   a  ');

    expect(result.hits).toEqual([]);
  });

  it('reports how much it searched', () => {
    const result = searchChunks(chunks, 'surrey');

    expect(result.indexedChunks).toBe(chunks.length);
    expect(result.indexedSources).toBe(2);
  });

  it('is deterministic, including the order of equal scores', () => {
    const once = searchChunks(chunks, 'covered');
    const twice = searchChunks(chunks, 'covered');

    expect(once.hits.map((h) => h.chunk.id)).toEqual(twice.hits.map((h) => h.chunk.id));
  });

  it('honours the limit', () => {
    const index = buildIndex(chunks, 2);
    const result = searchIndex(index, 'covered warranty surrey', 1);

    expect(result.hits).toHaveLength(1);
  });

  it('reports which of the query terms a passage matched', () => {
    const result = searchChunks(chunks, 'inverter warranty');
    const best = first(result.hits);

    expect(best.matchedTerms).toEqual(['inverter', 'warranty']);
  });

  it('stops indexing a source once it is gone from the corpus', () => {
    // The property the API's "delete reflected" claim rests on: retrieval has no
    // second copy of the corpus, so a source that is no longer passed in cannot
    // be returned.
    const without = chunks.filter((c) => c.documentId !== 'doc_area');
    const result = searchChunks(without, 'cornwall', { sourceCount: 1 });

    expect(result.hits).toEqual([]);
    expect(result.indexedSources).toBe(1);
  });
});

describe('tokenizing', () => {
  it('keeps a hyphenated part number whole and also splits it', () => {
    const tokens = tokenize('SB-430');

    expect(tokens).toContain('sb-430');
    expect(tokens).toContain('430');
  });

  it('drops single-character tokens and keeps the rest', () => {
    expect(tokenize('a of 2 solar')).toEqual(['of', 'solar']);
  });
});
