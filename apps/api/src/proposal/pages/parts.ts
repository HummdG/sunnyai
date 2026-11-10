/**
 * Pieces the rail pages share: the main column, the rail's brand mark and
 * figure blocks, and a paragraph that reports where it ended.
 */

import type { ProposalDoc } from '../doc.js';
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
  doc: ProposalDoc,
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
