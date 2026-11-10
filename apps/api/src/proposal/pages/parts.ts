/**
 * Pieces the rail pages share: the main column, the rail's brand mark and
 * figure blocks, and a paragraph that reports where it ended.
 */

import type { ProposalBase } from '../doc.js';
import { CONTENT, PAGE, RAIL_FRACTION, drawLogo, label, rail, type Theme } from '../layout.js';

type Pdf = PDFKit.PDFDocument;

export const RAIL_W = PAGE.width * RAIL_FRACTION;
/** The main column beside the rail. */
export const MAIN_X = RAIL_W + 34;
export const MAIN_W = PAGE.width - PAGE.margin - MAIN_X;
/** The rail's first line, level with the main column's first line. */
export const RAIL_TOP = CONTENT.top - 20;

/**
 * Starts drawing on the current page: no automatic page breaks (we measure
 * and break ourselves), and the rail filled. Returns the rail's inner column.
 */
export function railPage(pdf: Pdf, theme: Theme): { x: number; width: number } {
  pdf.page.margins.top = 0;
  pdf.page.margins.bottom = 0;
  return rail(pdf, theme, RAIL_FRACTION);
}

interface TextOpts {
  font: string;
  size: number;
  color: string;
  width: number;
  lineGap?: number;
  align?: 'left' | 'right';
  /** At most this many lines; the last ends with an ellipsis. */
  maxLines?: number;
}

/** Height of `text` as `para` would set it. */
export function measure(pdf: Pdf, text: string, o: TextOpts): number {
  pdf.font(o.font).fontSize(o.size);
  const h = pdf.heightOfString(text, { width: o.width, lineGap: o.lineGap ?? 0 });
  if (!o.maxLines) return h;
  return Math.min(h, o.maxLines * (pdf.currentLineHeight(true) + (o.lineGap ?? 0)));
}

/** Sets `text` at (x, y) and returns the y just below it. */
export function para(pdf: Pdf, text: string, x: number, y: number, o: TextOpts): number {
  const h = measure(pdf, text, o);
  pdf
    .font(o.font)
    .fontSize(o.size)
    .fillColor(o.color)
    .text(text, x, y, {
      width: o.width,
      lineGap: o.lineGap ?? 0,
      align: o.align ?? 'left',
      ...(o.maxLines ? { height: h, ellipsis: true } : {}),
    });
  return y + h;
}

/** The installer's logo on its plate, or the company name, at the top of the rail. */
export function railBrand(
  pdf: Pdf,
  doc: ProposalBase,
  theme: Theme,
  col: { x: number; width: number },
): number {
  const y = RAIL_TOP;
  if (doc.logo) {
    const r = drawLogo(
      pdf,
      doc.logo,
      doc.snapshot.companyName,
      { x: col.x, y, w: col.width, h: 30 },
      true,
    );
    return Math.max(y + 30, r.y + r.h);
  }
  return para(pdf, doc.snapshot.companyName, col.x, y, {
    font: 'sans-800',
    size: 12,
    color: theme.railText,
    width: col.width,
    maxLines: 3,
  });
}

/**
 * A figure block in the rail: a mono label, then an optional large figure
 * and lines of plain text. Returns the y below it.
 */
export function railItem(
  pdf: Pdf,
  theme: Theme,
  col: { x: number; width: number },
  y: number,
  key: string,
  parts: { big?: string; lines?: string[]; strong?: string[]; maxLines?: number },
): number {
  let at = label(pdf, key, col.x, y + 16, { width: col.width, color: theme.railLabel });
  if (parts.big) {
    at = para(pdf, parts.big, col.x, at, {
      font: 'sans-300',
      size: 20,
      color: theme.railText,
      width: col.width,
      maxLines: 2,
    });
  }
  for (const line of parts.strong ?? []) {
    at = para(pdf, line, col.x, at + 1, {
      font: 'sans-600',
      size: 8.6,
      color: theme.railText,
      width: col.width,
      lineGap: 1,
      maxLines: parts.maxLines ?? 3,
    });
  }
  for (const line of parts.lines ?? []) {
    at = para(pdf, line, col.x, at + 1, {
      font: 'sans-400',
      size: 8.4,
      color: theme.railText,
      width: col.width,
      lineGap: 1,
      maxLines: parts.maxLines ?? 3,
    });
  }
  return at;
}

/** A thin horizontal rule across the main column. */
export function rule(
  pdf: Pdf,
  y: number,
  color: string,
  weight = 0.5,
  x = MAIN_X,
  w = MAIN_W,
): void {
  pdf
    .save()
    .moveTo(x, y)
    .lineTo(x + w, y)
    .lineWidth(weight)
    .stroke(color)
    .restore();
}

// ---- Pages without the rail ------------------------------------------------

/** The full-width column of the pages without the rail. */
export const FULL_X = PAGE.margin;
export const FULL_W = PAGE.width - PAGE.margin * 2;

/** Starts drawing on a page without the rail: no automatic page breaks. */
export function plainPage(pdf: Pdf): void {
  pdf.page.margins.top = 0;
  pdf.page.margins.bottom = 0;
}

/**
 * The kicker line and the light-then-bold title at the top of a page.
 * Returns the y below the title.
 */
export function pageTitle(
  pdf: Pdf,
  theme: Theme,
  kicker: string,
  light: string,
  bold: string,
  x = FULL_X,
  w = FULL_W,
): number {
  let y = label(pdf, kicker, x, CONTENT.top, { width: w, color: theme.muted });
  y += 12;
  pdf.font('sans-300').fontSize(24).fillColor(theme.ink);
  pdf.text(light, x, y, { continued: true, lineBreak: false });
  pdf.font('sans-800').text(bold, { lineBreak: false });
  return y + pdf.currentLineHeight(true) + 6;
}

/** Height `keyValues` will take. */
export function keyValuesHeight(pdf: Pdf, rows: [string, string][], w: number, valueW = 96) {
  return rows.reduce((sum, [k, v]) => sum + kvRowHeight(pdf, k, v, w, valueW), 0);
}

function kvRowHeight(pdf: Pdf, k: string, v: string, w: number, valueW: number) {
  const kh = measure(pdf, k, { font: 'sans-400', size: 8.6, color: '', width: w - valueW - 10 });
  const vh = measure(pdf, v, { font: 'sans-600', size: 8.6, color: '', width: valueW });
  return Math.max(kh, vh) + 9;
}

/**
 * Label and value rows, ruled thinly between, the value right-aligned.
 * Returns the y below the last rule.
 */
export function keyValues(
  pdf: Pdf,
  theme: Theme,
  rows: [string, string][],
  x: number,
  y: number,
  w: number,
  valueW = 96,
): number {
  for (const [k, v] of rows) {
    const h = kvRowHeight(pdf, k, v, w, valueW);
    para(pdf, k, x, y + 4.5, {
      font: 'sans-400',
      size: 8.6,
      color: theme.ink,
      width: w - valueW - 10,
    });
    para(pdf, v, x + w - valueW, y + 4.5, {
      font: 'sans-600',
      size: 8.6,
      color: theme.ink,
      width: valueW,
      align: 'right',
    });
    y += h;
    rule(pdf, y, theme.rule, 0.5, x, w);
  }
  return y;
}

/**
 * Key figures in a row, each with a thin rule above, a mono label and a light
 * large figure (no cards or boxes). Returns the y below the tallest.
 */
export function figures(
  pdf: Pdf,
  theme: Theme,
  items: { key: string; value: string; sub?: string }[],
  x: number,
  y: number,
  w: number,
): number {
  const gap = 16;
  const cw = (w - gap * (items.length - 1)) / items.length;
  let bottom = y;
  // Labels may wrap; the figures share one line below the tallest label.
  const valueY = Math.max(
    ...items.map((item) => {
      pdf.font('mono-400').fontSize(6.8);
      const h = pdf.heightOfString(item.key.toUpperCase(), { width: cw, characterSpacing: 0.6 });
      return y + 6 + h + 3;
    }),
  );
  items.forEach((item, i) => {
    const cx = x + i * (cw + gap);
    rule(pdf, y, theme.ink, 0.8, cx, cw);
    label(pdf, item.key, cx, y + 6, { width: cw, color: theme.muted });
    let at = para(pdf, item.value, cx, valueY + 1, {
      font: 'sans-300',
      size: 20,
      color: theme.ink,
      width: cw,
      maxLines: 1,
    });
    if (item.sub) {
      at = para(pdf, item.sub, cx, at, {
        font: 'sans-400',
        size: 7.8,
        color: theme.muted,
        width: cw,
        maxLines: 2,
      });
    }
    bottom = Math.max(bottom, at);
  });
  return bottom;
}

/** A section heading in sans with a firm rule under it. Returns the y below the rule. */
export function subHead(pdf: Pdf, theme: Theme, text: string, x: number, y: number, w: number) {
  const below = para(pdf, text, x, y, { font: 'sans-600', size: 10, color: theme.ink, width: w });
  rule(pdf, below + 4, theme.railBg, 1, x, w);
  return below + 4;
}
