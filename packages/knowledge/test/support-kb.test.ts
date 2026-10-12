import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  chunkDocument,
  findPlaceholders,
  hybridSearch,
  maskPlaceholders,
  type KnowledgeChunk,
} from '@sunny/knowledge';

/**
 * The owner's real aftercare knowledge base (`Knowledge Base.pdf`, converted to
 * `fixtures/knowledge/support-knowledge-base.md` by `scripts/pdf-to-markdown.py`)
 * as a retrieval fixture: the questions customers actually ask, and the section
 * that should answer each one.
 */

const text = readFileSync(
  fileURLToPath(new URL('../../../fixtures/knowledge/support-knowledge-base.md', import.meta.url)),
  'utf8',
);
const chunks = chunkDocument({
  id: 'support_kb',
  title: 'Solar Support Knowledge Base',
  url: null,
  version: '2026-10',
  text,
});

/** The "N. Title" section a chunk belongs to, from its heading trail. */
function sectionOf(chunk: KnowledgeChunk): string {
  const trail = chunk.section ?? (chunk.heading ? [chunk.heading] : []);
  return trail.find((h) => /^\d+\./.test(h)) ?? trail.join(' › ');
}

async function topSections(query: string, n = 3): Promise<string[]> {
  const result = await hybridSearch(chunks, query, { limit: n });
  return result.hits.map((hit) => sectionOf(hit.chunk));
}

describe('support knowledge base: chunking', () => {
  it('splits on its ## and ### headings and keeps the section trail on every chunk', () => {
    const solis = chunks.find((c) => c.heading === 'Solis data logger Wi-Fi reconfiguration');
    expect(solis?.section).toEqual([
      'Solar Support Chatbot Knowledge Base',
      '1. Data loggers',
      'Solis data logger Wi-Fi reconfiguration',
    ]);
  });

  it('keeps every table whole', () => {
    const tableLines = text.split('\n').filter((line) => /^\|.*\|$/.test(line.trim()));
    for (const chunk of chunks) {
      const lines = chunk.text.split('\n');
      // A chunk that holds part of a table holds its rule line too.
      if (lines.some((l) => /^\|.*\|$/.test(l))) expect(chunk.text).toMatch(/\| --- \|/);
    }
    const indexed = chunks.map((c) => c.text).join('\n');
    for (const line of tableLines) expect(indexed).toContain(line.trim());
    const seasonal = chunks.find((c) => c.text.includes('| August to September |'));
    expect(seasonal?.text).toContain('| December |');
    expect(sectionOf(seasonal!)).toBe('12. Generation change');
  });
});

describe('support knowledge base: retrieval', () => {
  const cases: [string, string][] = [
    ['my system is offline in the app', '1. Data loggers'],
    ['how do I get paid for export', '5. SEG process — Smart Export Guarantee'],
    ['generation dropped in September', '12. Generation change'],
    ['Solis wifi setup', '1. Data loggers'],
    ['inverter grid fault', '8. Grid alarms'],
  ];
  for (const [query, section] of cases) {
    it(`"${query}" → ${section}`, async () => {
      const sections = await topSections(query);
      expect(sections[0]).toBe(section);
    });
  }

  it('finds the Solis procedure itself for a Solis Wi-Fi question', async () => {
    const result = await hybridSearch(chunks, 'Solis wifi setup', { limit: 3 });
    expect(
      result.hits.some((h) => h.chunk.heading === 'Solis data logger Wi-Fi reconfiguration'),
    ).toBe(true);
  });

  it('brings the seasonal table into the top results for a September drop', async () => {
    const result = await hybridSearch(chunks, 'generation dropped in September', { limit: 5 });
    expect(result.hits.some((h) => h.chunk.text.includes('| August to September |'))).toBe(true);
  });
});

describe('support knowledge base: placeholders', () => {
  const findings = findPlaceholders(text);

  it('flags the unfilled safety phone number, with its section', () => {
    const phone = findings.find((f) => f.text.includes('XXXXX'));
    expect(phone).toMatchObject({ kind: 'placeholder', text: 'XXXXX XXXXXX' });
    expect(phone?.section).toContain('How the bot should use this document');
  });

  it('flags the note to replace placeholders and every outstanding checklist row', () => {
    expect(
      findings.some(
        (f) => f.kind === 'unfinished' && /Replace all bracketed placeholders/.test(f.text),
      ),
    ).toBe(true);
    const todo = findings.filter((f) => f.text.startsWith('| To do |'));
    expect(todo.length).toBe(12);
    for (const row of todo)
      expect(row.section).toContain('14. Knowledge base completion checklist');
  });

  it('marks the chunks that contain one, and masks it so it cannot be quoted', () => {
    const safety = chunks.find((c) => c.text.includes('XXXXX XXXXXX'));
    expect(safety?.placeholders).toContain('XXXXX XXXXXX');
    const masked = maskPlaceholders(safety!.text);
    expect(masked).not.toContain('XXXXX');
    expect(masked).toContain('[not yet provided by the installer]');
  });

  it('leaves clean text alone', () => {
    expect(findPlaceholders('# Batteries\n\nWe fit Powerwall 3. Call 01632 960123.')).toEqual([]);
  });
});
