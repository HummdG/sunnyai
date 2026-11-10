/**
 * Terms and conditions: the installer's own text (`snapshot.terms`), parsed
 * into headings, paragraphs and items, set in two columns and flowing over as
 * many pages as it needs. The words are kept as written; only characters the
 * bundled fonts cannot draw are swapped (see `glyphSafe`). Lines are wrapped
 * here, word by word, so a long URL or unbroken token breaks anywhere and no
 * line ever runs past its column.
 */

import type { ProposalDoc } from '../doc.js';
import { CONTENT, label, type Theme } from '../layout.js';
import { glyphSafe, parseTerms } from '../terms.js';

import { FULL_W, FULL_X, pageTitle, plainPage, subHead } from './parts.js';

type Pdf = PDFKit.PDFDocument;

/** Terms pages have no rail: stamp them with `footer(..., { hasRail: false })`. */
export const TERMS_HAS_RAIL = false;

const GUTTER = 22;
const COL_W = (FULL_W - GUTTER) / 2;
const BODY = { font: 'sans-400', size: 7.6, lineGap: 1.7 } as const;
const HEAD = { font: 'sans-600', size: 8.2, lineGap: 1.7 } as const;
const PARA_GAP = 4.5;
const HEAD_GAP = 7;
const ITEM_INDENT = 13;

interface FontKitLike {
  hasGlyphForCodePoint(cp: number): boolean;
}

/** `text` made drawable in `font` (selected on `pdf`). */
function safe(pdf: Pdf, font: string, text: string): string {
  pdf.font(font);
  const fk = (pdf as unknown as { _font?: { font?: Partial<FontKitLike> } })._font?.font;
  if (!fk || typeof fk.hasGlyphForCodePoint !== 'function') return text;
  return glyphSafe(text, (cp) => fk.hasGlyphForCodePoint!(cp));
}

/**
 * The first line of `text` that fits `width` in the current font, and the
 * text left after it. A word wider than the line is broken between characters.
 */
function takeLine(pdf: Pdf, text: string, width: number): [string, string] {
  const fits = (s: string) => pdf.widthOfString(s) <= width;
  let line = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === ' ') {
      i++;
      continue;
    }
    let j = text.indexOf(' ', i);
    if (j < 0) j = text.length;
    const word = text.slice(i, j);
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      i = j;
      continue;
    }
    if (line) break;
    // Too long for any line: break it between characters.
    let piece = '';
    for (const ch of word) {
      if (piece && !fits(piece + ch)) break;
      piece += ch;
    }
    return [piece, text.slice(i + piece.length)];
  }
  return [line, text.slice(i)];
}

/** Greedy word wrap at `width` in the current font (see `takeLine`). */
export function wrapLines(pdf: Pdf, text: string, width: number): string[] {
  const lines: string[] = [];
  let rest = text;
  while (rest.trim() !== '') {
    const [line, after] = takeLine(pdf, rest, width);
    lines.push(line);
    rest = after;
  }
  return lines;
}

/**
 * Whether the quote has terms to print. The orchestrator adds the Terms page
 * only when this is true; `drawTerms` draws nothing for blank terms.
 */
export function hasTerms(doc: ProposalDoc): boolean {
  return doc.snapshot.terms.trim() !== '';
}

/** Where the terms start when they follow the quotation on its own continuation page. */
export interface TermsStart {
  x: number;
  w: number;
  y: number;
}

interface Frame {
  x: number;
  w: number;
  top: number;
}

const twoColumns = (top: number): Frame[] => [
  { x: FULL_X, w: COL_W, top },
  { x: FULL_X + COL_W + GUTTER, w: COL_W, top },
];

/**
 * The terms, flowed through frames: on their own page, two columns (one full
 * width column when they fit in it); after `start`, first one column there,
 * then two columns on each page that follows.
 */
export function drawTerms(pdf: Pdf, doc: ProposalDoc, theme: Theme, start?: TermsStart): void {
  if (!hasTerms(doc)) return;
  const blocks = parseTerms(doc.snapshot.terms);
  let frames: Frame[];
  if (start && start.y + 60 <= CONTENT.bottom) {
    const top = subHead(pdf, theme, 'Terms and conditions', start.x, start.y, start.w) + 10;
    frames = [{ x: start.x, w: start.w, top }];
  } else {
    if (start) pdf.addPage();
    plainPage(pdf);
    const top =
      pageTitle(pdf, theme, `Terms and conditions · ${doc.reference}`, 'Terms and ', 'conditions') +
      8;
    const oneColumn = flow(pdf, blocks, theme, [{ x: FULL_X, w: FULL_W, top }], () => null);
    frames = oneColumn ? [{ x: FULL_X, w: FULL_W, top }] : twoColumns(top);
  }
  flow(
    pdf,
    blocks,
    theme,
    frames,
    () => {
      pdf.addPage();
      plainPage(pdf);
      const top =
        label(pdf, `Terms and conditions, continued · ${doc.reference}`, FULL_X, CONTENT.top, {
          width: FULL_W,
          color: theme.muted,
        }) + 10;
      return twoColumns(top);
    },
    true,
  );
}

/**
 * Sets the blocks into `frames`, asking `more` for the next page's frames when
 * they are full. Without `draw` it only measures: true when everything fits
 * in the frames given, false as soon as it would need `more`.
 */
function flow(
  pdf: Pdf,
  blocks: ReturnType<typeof parseTerms>,
  theme: Theme,
  initial: Frame[],
  more: () => Frame[] | null,
  draw = false,
): boolean {
  const queue = [...initial];
  let frame = queue.shift()!;
  let y = frame.top;
  let overflow = false;
  const advance = () => {
    if (queue.length === 0) {
      const next = draw ? more() : null;
      if (!next) {
        overflow = true;
        return;
      }
      queue.push(...next);
    }
    frame = queue.shift()!;
    y = frame.top;
  };
  const lineH = (o: { font: string; size: number; lineGap: number }) => {
    pdf.font(o.font).fontSize(o.size);
    return pdf.currentLineHeight(true) + o.lineGap;
  };
  const bodyH = lineH(BODY);

  /** Sets `text` from `y`, line by line, wrapping at each frame's width. */
  const setText = (
    text: string,
    o: { font: string; size: number; lineGap: number },
    indent: number,
    marker?: { text: string; x: number },
  ) => {
    const h = lineH(o);
    let rest = text;
    let firstLine = true;
    do {
      if (y + h > CONTENT.bottom) advance();
      if (overflow) return;
      pdf.font(o.font).fontSize(o.size).fillColor(theme.ink);
      const [line, after] = takeLine(pdf, rest, frame.w - indent);
      if (draw) {
        if (firstLine && marker) pdf.text(marker.text, frame.x + marker.x, y, { lineBreak: false });
        pdf.text(line, frame.x + indent, y, { lineBreak: false });
      }
      firstLine = false;
      rest = after;
      y += h;
    } while (rest.trim() !== '');
  };

  let first = true;
  for (const block of blocks) {
    if (overflow) return false;
    if (block.kind === 'heading') {
      const text = safe(pdf, HEAD.font, block.text);
      pdf.fontSize(HEAD.size);
      const lines = wrapLines(pdf, text, frame.w).length;
      const gap = first ? 0 : HEAD_GAP;
      // Keep a heading with at least two lines of what follows.
      if (y + gap + lines * lineH(HEAD) + bodyH * 2 > CONTENT.bottom) advance();
      else if (y !== frame.top) y += gap;
      setText(text, HEAD, 0);
      y += 1.5;
    } else if (block.kind === 'para') {
      setText(safe(pdf, BODY.font, block.text), BODY, 0);
      y += PARA_GAP;
    } else {
      const nested = /^[\u25e6\u2023\u25cb]$/u.test(block.marker) ? 10 : 0;
      const marker = safe(pdf, BODY.font, block.marker);
      const text = safe(pdf, BODY.font, block.text);
      pdf.fontSize(BODY.size);
      const indent = nested + Math.max(ITEM_INDENT, pdf.widthOfString(marker) + 4);
      setText(text === '' ? ' ' : text, BODY, indent, { text: marker, x: nested });
      y += PARA_GAP - 1.5;
    }
    first = false;
  }
  return !overflow;
}
