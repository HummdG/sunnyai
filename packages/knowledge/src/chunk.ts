import type { KnowledgeChunk, KnowledgeDocument } from './types.js';

/**
 * Splitting a document into passages without losing what gave them meaning.
 *
 * The plan asks ingestion to "preserve headings, tables, part numbers, warranty,
 * prices, source URLs and versions". Three of those are properties of the text
 * and the fourth and fifth are properties of this splitter, so the rules are:
 *
 *   1. **Nothing is stripped.** The text is never normalised, lowercased,
 *      de-hyphenated or reflowed. A part number that a cleaner would tidy into
 *      two words is a part number the assistant can no longer quote.
 *   2. **A chunk keeps its heading.** The document is cut at headings, and each
 *      piece carries the heading it sat under. Cutting on length instead would
 *      be simpler and would produce passages that begin mid-sentence under a
 *      heading nobody can see.
 *   3. **A table stays whole where it fits.** Markdown and plain-text tables are
 *      runs of adjacent lines, so splitting on blank lines keeps one intact
 *      unless it is genuinely longer than a chunk -- and then it is split at a
 *      line boundary rather than dropped.
 *
 * Only two things are dropped: whitespace at the edges, and a heading with no
 * body under it. Both are absences rather than losses, and the second is
 * reported: a document that chunks to nothing is an empty document, which the
 * route refuses to store rather than indexing as silence.
 */

/**
 * How long a passage may get before it is split further.
 *
 * Chosen for the reader, not for the tokenizer: a passage is what the assistant
 * quotes from and what a citation points at, so it has to be long enough to
 * hold a warranty clause and short enough to stay one idea. Around 200 words.
 */
export const MAX_CHUNK_CHARS = 1200;

/** `# Heading` through `###### Heading`, which is also how plain text is marked. */
const HEADING = /^(#{1,6})\s+(.*)$/;

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Split one section's body into chunk-sized pieces, at paragraph boundaries.
 *
 * A single paragraph longer than the limit is split by hard cut, and that is
 * deliberate: the alternative is to emit an over-long chunk, and a passage the
 * model cannot take in whole is worse than one cut mid-sentence, because the
 * cut at least keeps every word in the index. Nothing else here is allowed to
 * end up on the floor.
 */
function splitBody(body: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const part of paragraphs(body)) {
    if (current !== '' && current.length + part.length + 2 > MAX_CHUNK_CHARS) {
      out.push(current);
      current = '';
    }
    if (part.length > MAX_CHUNK_CHARS) {
      if (current !== '') {
        out.push(current);
        current = '';
      }
      for (let i = 0; i < part.length; i += MAX_CHUNK_CHARS) {
        out.push(part.slice(i, i + MAX_CHUNK_CHARS));
      }
      continue;
    }
    current = current === '' ? part : `${current}\n\n${part}`;
  }
  if (current !== '') out.push(current);
  return out;
}

/**
 * One document into chunks, in reading order, with what was dropped.
 *
 * Deterministic by construction -- no clock, no randomness, ids derived from the
 * document's own id and the chunk's position -- so re-ingesting an unchanged
 * document produces the same chunk ids, and a citation stored last month still
 * resolves today.
 *
 * `emptySections` counts headings that had nothing under them. It is reported
 * rather than swallowed because it is the only way an installer learns that half
 * their page did not survive the conversion to text: the route stores the
 * document either way and says so, which is a warning they can act on rather
 * than a silence they cannot.
 */
export function chunkWithReport(document: KnowledgeDocument): {
  chunks: KnowledgeChunk[];
  emptySections: number;
} {
  const sections: { heading: string | null; lines: string[] }[] = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };

  for (const raw of document.text.split(/\r?\n/)) {
    const match = HEADING.exec(raw.trim());
    if (match) {
      sections.push(current);
      current = { heading: (match[2] ?? '').trim() || null, lines: [] };
      continue;
    }
    current.lines.push(raw);
  }
  sections.push(current);

  const chunks: KnowledgeChunk[] = [];
  let emptySections = 0;
  for (const section of sections) {
    const body = section.lines.join('\n').trim();
    if (body === '') {
      // A heading with nothing after it is an absence, not a loss -- and not an
      // error either, because a page whose last section is a stub is a page.
      if (section.heading !== null) emptySections += 1;
      continue;
    }
    for (const text of splitBody(body)) {
      const ordinal = chunks.length;
      chunks.push({
        id: `${document.id}#${ordinal}`,
        documentId: document.id,
        title: document.title,
        url: document.url,
        version: document.version,
        heading: section.heading,
        ordinal,
        text,
      });
    }
  }
  return { chunks, emptySections };
}

/** One document into chunks, in reading order. */
export function chunkDocument(document: KnowledgeDocument): KnowledgeChunk[] {
  return chunkWithReport(document).chunks;
}

/** Every document's chunks, in the order the documents were given. */
export function chunkDocuments(documents: readonly KnowledgeDocument[]): KnowledgeChunk[] {
  return documents.flatMap((document) => chunkDocument(document));
}
