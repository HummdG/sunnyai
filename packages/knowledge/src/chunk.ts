import { placeholdersIn } from './placeholders.js';
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

/** A Markdown table row: `| a | b |`. */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** The rule under a table header: `| --- | :---: |`. */
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

interface Block {
  text: string;
  table: boolean;
}

/**
 * The body as blocks: paragraphs, with every Markdown table pulled out as a
 * block of its own even when no blank line separates it from the prose around
 * it. A table glued to the sentence that introduces it is the normal shape of a
 * converted web page, and treating the pair as one paragraph is what would let
 * a long one be cut through the middle of a row.
 */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const part of text.split(/\n\s*\n/)) {
    let run: string[] = [];
    let runIsTable = false;
    const flush = (): void => {
      const joined = run.join('\n').trim();
      if (joined !== '') out.push({ text: joined, table: runIsTable });
      run = [];
    };
    for (const line of part.split(/\r?\n/)) {
      const isTable: boolean = TABLE_ROW.test(line) || (runIsTable && TABLE_RULE.test(line));
      if (run.length > 0 && isTable !== runIsTable) flush();
      runIsTable = isTable;
      run.push(line);
    }
    flush();
  }
  return out;
}

/**
 * A table too long for one chunk, split at row boundaries with the header (and
 * its rule) repeated on every piece -- so a row read on its own still says which
 * column is the price and which is the warranty.
 */
function splitTable(table: string): string[] {
  const rows = table.split('\n');
  const hasHeader = rows.length > 1 && TABLE_RULE.test(rows[1] ?? '');
  const header = hasHeader ? rows.slice(0, 2) : [];
  const body = hasHeader ? rows.slice(2) : rows;
  const out: string[] = [];
  let current: string[] = [...header];
  for (const row of body) {
    const next = [...current, row].join('\n');
    if (current.length > header.length && next.length > MAX_CHUNK_CHARS) {
      out.push(current.join('\n'));
      current = [...header];
    }
    current.push(row);
  }
  if (current.length > header.length || out.length === 0) out.push(current.join('\n'));
  return out;
}

/**
 * Cut an over-long run of prose into chunk-sized pieces without losing a
 * character: at the last space before the limit where there is one, and by hard
 * cut where there is not (a pasted blob, a list of part numbers). A passage the
 * model cannot take in whole is worse than one cut mid-sentence, and a silently
 * truncated warranty is worse than both.
 */
function hardSplit(part: string): string[] {
  const out: string[] = [];
  let rest = part;
  while (rest.length > MAX_CHUNK_CHARS) {
    const space = rest.lastIndexOf(' ', MAX_CHUNK_CHARS - 1);
    const cut = space >= MAX_CHUNK_CHARS / 2 ? space + 1 : MAX_CHUNK_CHARS;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest !== '') out.push(rest);
  return out;
}

/**
 * Split one section's body into chunk-sized pieces, at block boundaries.
 *
 * A table is never cut through a row: one that fits stays whole (moved to a
 * fresh chunk rather than split across two), and one that does not is split by
 * rows with its header repeated on each piece. Nothing here is allowed to end up
 * on the floor.
 */
function splitBody(body: string): string[] {
  const out: string[] = [];
  let current = '';
  const push = (): void => {
    if (current !== '') out.push(current);
    current = '';
  };
  for (const block of blocks(body)) {
    const part = block.text;
    if (current !== '' && current.length + part.length + 2 > MAX_CHUNK_CHARS) push();
    if (part.length > MAX_CHUNK_CHARS) {
      push();
      out.push(...(block.table ? splitTable(part) : hardSplit(part)));
      continue;
    }
    current = current === '' ? part : `${current}\n\n${part}`;
  }
  push();
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
  type Section = { heading: string | null; path: string[]; lines: string[] };
  const sections: Section[] = [];
  let current: Section = { heading: null, path: [], lines: [] };
  // The heading trail above the current line, by level: H1 › H2 › H3.
  const trail: string[] = [];

  for (const raw of document.text.split(/\r?\n/)) {
    const match = HEADING.exec(raw.trim());
    if (match) {
      sections.push(current);
      const heading = (match[2] ?? '').trim() || null;
      const level = (match[1] ?? '#').length;
      trail.length = Math.min(trail.length, level - 1);
      trail[level - 1] = heading ?? '';
      current = { heading, path: trail.filter((h) => h !== ''), lines: [] };
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
      const placeholders = placeholdersIn(text).map((p) => p.text);
      chunks.push({
        id: `${document.id}#${ordinal}`,
        documentId: document.id,
        title: document.title,
        url: document.url,
        version: document.version,
        heading: section.heading,
        ordinal,
        text,
        ...(section.path.length > 1 ? { section: section.path } : {}),
        ...(placeholders.length > 0 ? { placeholders } : {}),
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
