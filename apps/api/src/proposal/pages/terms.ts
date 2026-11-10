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

import { FULL_W, FULL_X, pageTitle, plainPage } from './parts.js';

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
 * Greedy word wrap at `width` in the current font; a word wider than the
 * line is broken between characters.
 */
export function wrapLines(pdf: Pdf, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  const fits = (s: string) => pdf.widthOfString(s) <= width;
  for (const word of text.split(' ').filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    if (fits(word)) {
      line = word;
      continue;
    }
    // Too long for any line: break it between characters.
    let piece = '';
    for (const ch of word) {
      if (piece && !fits(piece + ch)) {
        lines.push(piece);
        piece = '';
      }
      piece += ch;
    }
    line = piece;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawTerms(pdf: Pdf, doc: ProposalDoc, theme: Theme): void {
  plainPage(pdf);
  const top0 =
    pageTitle(pdf, theme, `Terms and conditions · ${doc.reference}`, 'Terms and ', 'conditions') +
    8;

  let col = 0;
  let top = top0;
  let y = top;
  const colX = () => FULL_X + col * (COL_W + GUTTER);
  const advance = () => {
    if (col === 0) {
      col = 1;
      y = top;
      return;
    }
    pdf.addPage();
    plainPage(pdf);
    top =
      label(pdf, `Terms and conditions, continued · ${doc.reference}`, FULL_X, CONTENT.top, {
        width: FULL_W,
        color: theme.muted,
      }) + 10;
    col = 0;
    y = top;
  };
  const lineH = (o: { font: string; size: number; lineGap: number }) => {
    pdf.font(o.font).fontSize(o.size);
    return pdf.currentLineHeight(true) + o.lineGap;
  };
  const bodyH = lineH(BODY);

  /** Sets `lines` from `y`, moving to the next column when full; the first line can carry a marker. */
  const setLines = (
    lines: string[],
    o: { font: string; size: number; lineGap: number },
    color: string,
    indent: number,
    marker?: { text: string; x: number },
  ) => {
    const h = lineH(o);
    lines.forEach((ln, i) => {
      if (y + h > CONTENT.bottom) advance();
      pdf.font(o.font).fontSize(o.size).fillColor(color);
      if (i === 0 && marker) {
        pdf.text(marker.text, colX() + marker.x, y, { lineBreak: false });
      }
      pdf.text(ln, colX() + indent, y, { lineBreak: false });
      y += h;
    });
  };

  let first = true;
  for (const block of parseTerms(doc.snapshot.terms)) {
    if (block.kind === 'heading') {
      const text = safe(pdf, HEAD.font, block.text);
      pdf.fontSize(HEAD.size);
      const lines = wrapLines(pdf, text, COL_W);
      const gap = first ? 0 : HEAD_GAP;
      // Keep a heading with at least two lines of what follows.
      if (y + gap + lines.length * lineH(HEAD) + bodyH * 2 > CONTENT.bottom) advance();
      else if (y !== top) y += gap;
      setLines(lines, HEAD, theme.ink, 0);
      y += 1.5;
    } else if (block.kind === 'para') {
      const text = safe(pdf, BODY.font, block.text);
      pdf.fontSize(BODY.size);
      setLines(wrapLines(pdf, text, COL_W), BODY, theme.ink, 0);
      y += PARA_GAP;
    } else {
      const nested = /^[\u25e6\u2023\u25cb]$/u.test(block.marker) ? 10 : 0;
      const marker = safe(pdf, BODY.font, block.marker);
      const text = safe(pdf, BODY.font, block.text);
      pdf.fontSize(BODY.size);
      const indent = nested + Math.max(ITEM_INDENT, pdf.widthOfString(marker) + 4);
      const lines = wrapLines(pdf, text, COL_W - indent);
      setLines(lines.length > 0 ? lines : [''], BODY, theme.ink, indent, {
        text: marker,
        x: nested,
      });
      y += PARA_GAP - 1.5;
    }
    first = false;
  }
}
