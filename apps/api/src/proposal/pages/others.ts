/**
 * "Other options we looked at": the quote's other stored options, compared
 * (size, battery, estimated total, generation, savings a year, payback). Drawn
 * on Your system, or on the Quotation page when Your system is off. Stored
 * figures only.
 */

import { PRICED_BY_INSTALLER, gbp, num } from '../copy.js';
import type { ProposalDoc } from '../doc.js';
import { label, type Theme } from '../layout.js';

import type { QuoteOptionView } from '../../journey/quote.js';

import { measure, para, rule, subHead } from './parts.js';

type Pdf = PDFKit.PDFDocument;

/** An option's estimated total, only when the quote prices it completely. */
function optionTotal(doc: ProposalDoc, o: QuoteOptionView): number | null {
  if (!doc.quote.priced || o.priceGbp === null || o.priceGbp <= 0 || o.installerPriced.length > 0) {
    return null;
  }
  return o.priceIncVatGbp ?? o.priceGbp;
}

/**
 * Draws the table from `y` (the heading sits 24pt below it) in the column
 * `x`..`x + w`. `ensure(h, y)` returns `y` when `h` more points fit, else the
 * top of a continuation page. Returns the y below the table.
 */
export function drawOthers(
  pdf: Pdf,
  doc: ProposalDoc,
  theme: Theme,
  box: { x: number; w: number; y: number },
  ensure: (h: number, y: number) => number,
): number {
  const { x, w } = box;
  let y = box.y;
  if (doc.others.length === 0) return y;
  const narrow = w < 420;
  const cols: { head: string; frac: number; align: 'left' | 'right' }[] = [
    // The Quotation page's column is narrow: give Generation room for its one word.
    { head: 'Option', frac: narrow ? 1.0 : 1.05, align: 'left' },
    { head: 'Size', frac: narrow ? 0.95 : 1.05, align: 'left' },
    { head: 'Battery', frac: narrow ? 0.8 : 0.9, align: 'left' },
    { head: 'Estimated total', frac: narrow ? 1.1 : 1.15, align: 'right' },
    { head: 'Generation', frac: narrow ? 1.2 : 1.05, align: 'right' },
    { head: 'Savings a year', frac: narrow ? 0.95 : 1.0, align: 'right' },
    { head: 'Payback', frac: narrow ? 0.95 : 0.85, align: 'right' },
  ];
  const total = cols.reduce((s, c) => s + c.frac, 0);
  const gap = narrow ? 7 : 14;
  const widths = cols.map((c) => (c.frac / total) * (w + gap) - gap);
  const xs = widths.map((_, i) => x + widths.slice(0, i).reduce((s, cw) => s + cw + gap, 0));
  const cell = { font: 'sans-400', size: narrow ? 7.8 : 8.6, color: theme.ink };
  const rows = doc.others.map((other) => {
    const t = optionTotal(doc, other);
    return [
      other.label,
      `${num(other.systemKwp, 2)} kWp\n${other.panelCount} ${other.panelCount === 1 ? 'panel' : 'panels'}`,
      other.batteryType && other.batteryCapacityKwh > 0
        ? `${num(other.batteryCapacityKwh, 1)} kWh`
        : 'None',
      t !== null ? gbp(t) : PRICED_BY_INSTALLER,
      `${num(Math.round(other.annualGenerationKwh))} kWh`,
      gbp(other.annualSavingsGbp),
      other.paybackYears !== null ? `${num(other.paybackYears, 1)} years` : '–',
    ];
  });
  const rowH = (r: string[]) =>
    Math.max(...r.map((c, i) => measure(pdf, c, { ...cell, width: widths[i]! }))) + 10;
  y = ensure(56 + rowH(rows[0]!), y);
  y = subHead(pdf, theme, 'Other options we looked at', x, y + 24, w) + 7;
  // A header may wrap in its narrow column: the rule goes under the tallest.
  const headTop = y;
  y = Math.max(
    ...cols.map((c, i) =>
      label(pdf, c.head, xs[i]!, headTop, {
        width: widths[i]!,
        color: theme.muted,
        align: c.align,
        ...(narrow ? { size: 6.2 } : {}),
      }),
    ),
  );
  rule(pdf, y, theme.rule, 0.5, x, w);
  for (const r of rows) {
    const h = rowH(r);
    y = ensure(h, y);
    r.forEach((c, i) => {
      para(pdf, c, xs[i]!, y + 5, {
        ...cell,
        font: i === 0 ? 'sans-600' : 'sans-400',
        width: widths[i]!,
        align: cols[i]!.align,
      });
    });
    y += h;
    rule(pdf, y, theme.rule, 0.5, x, w);
  }
  return y;
}
