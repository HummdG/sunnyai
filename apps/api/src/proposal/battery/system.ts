/**
 * Your battery (the `system` switch): the existing solar (and whether its
 * size was assumed), its generation and the home's use a year, the
 * recommended size and the battery, then every option compared, then the
 * estimate disclaimer. Full width, no rail. Stored figures only.
 */

import { PRICED_BY_INSTALLER, gbp, num } from '../copy.js';
import { label, type Theme } from '../layout.js';
import {
  FULL_W,
  FULL_X,
  keyValues,
  measure,
  pageTitle,
  para,
  plainPage,
  rule,
  subHead,
} from '../pages/parts.js';

import { kwh, optionPriced, paybackWords, type BatteryProposalDoc } from './doc.js';

type Pdf = PDFKit.PDFDocument;

/** Your battery has no rail: stamp it with `footer(..., { hasRail: false })`. */
export const BATTERY_SYSTEM_HAS_RAIL = false;

/** The home's facts and the battery, as label and value rows. */
export function batteryRows(doc: BatteryProposalDoc): [string, string][] {
  const est = doc.quote.estimate;
  const o = doc.option;
  const kwp = `${num(est.pvKwp, 1)} kWp`;
  return [
    ['Your existing solar', est.pvKwpAssumed ? `${kwp}, assumed` : kwp],
    ['Solar generation a year', `${num(Math.round(est.annualGenerationKwh))} kWh`],
    ['Electricity use a year', `${num(Math.round(est.annualUseKwh))} kWh`],
    ['Recommended battery size', kwh(est.recommendedKwh)],
    ['Battery', o.batteryName],
    ['Battery capacity', kwh(o.capacityKwh)],
  ];
}

/** The most options the table shows, so it always fits on one page. */
export const MAX_COMPARED = 4;

/**
 * Every option (the first four), compared: size, price, saving a year and
 * payback. A price shows only when the quotation would print it. Draws from
 * `y` (the heading 24pt below it) in `x`..`x + w`; `ensure(h, y)` returns `y`
 * when `h` more points fit, else the top of a continuation page. Returns the
 * y below the table.
 */
export function drawBatteryOptions(
  pdf: Pdf,
  doc: BatteryProposalDoc,
  theme: Theme,
  box: { x: number; w: number; y: number },
  ensure: (h: number, y: number) => number,
): number {
  const { x, w } = box;
  let y = box.y;
  const options = doc.quote.options.slice(0, MAX_COMPARED);
  if (options.length < 2) return y;
  const cols: { head: string; frac: number; align: 'left' | 'right' }[] = [
    { head: 'Option', frac: 1.8, align: 'left' },
    { head: 'Size', frac: 0.8, align: 'right' },
    { head: 'Price', frac: 1.1, align: 'right' },
    { head: 'Saving a year', frac: 1, align: 'right' },
    { head: 'Payback', frac: 0.9, align: 'right' },
  ];
  const narrow = w < 420;
  const total = cols.reduce((s, c) => s + c.frac, 0);
  const gap = narrow ? 7 : 14;
  const widths = cols.map((c) => (c.frac / total) * (w + gap) - gap);
  const xs = widths.map((_, i) => x + widths.slice(0, i).reduce((s, cw) => s + cw + gap, 0));
  const cell = { font: 'sans-400', size: narrow ? 7.8 : 8.6, color: theme.ink };
  const rows = options.map((o) => {
    // The labels already name the recommended option; only the visitor's choice is marked.
    const mark = o.id === doc.option.id && doc.chosen ? ' (your choice)' : '';
    const priced = optionPriced(doc.quote, o);
    return [
      `${o.label}${mark}`,
      kwh(o.capacityKwh),
      priced ? gbp(o.priceGbp!) : PRICED_BY_INSTALLER,
      gbp(o.annualSavingsGbp),
      paybackWords(doc.quote, o),
    ];
  });
  const rowH = (r: string[]) =>
    Math.max(...r.map((c, i) => measure(pdf, c, { ...cell, width: widths[i]! }))) + 10;
  y = ensure(56 + rowH(rows[0]!), y);
  y = subHead(pdf, theme, 'Options compared', x, y + 24, w) + 7;
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

export function drawBatterySystem(pdf: Pdf, doc: BatteryProposalDoc, theme: Theme): void {
  plainPage(pdf);
  const x = FULL_X;
  const w = FULL_W;
  let y = pageTitle(pdf, theme, `Your battery · ${doc.reference}`, 'Your ', 'battery');
  y = subHead(pdf, theme, 'Your home and the battery', x, y + 16, w);
  y = keyValues(pdf, theme, batteryRows(doc), x, y, w, 180);
  // One page: at most MAX_COMPARED options, so the table never needs a continuation page.
  y = drawBatteryOptions(pdf, doc, theme, { x, w, y }, (_h, at) => at);
  const about = subHead(pdf, theme, 'About this estimate', x, y + 24, w);
  const text = { font: 'sans-400', size: 8.6, color: theme.ink, width: w, lineGap: 2 };
  para(pdf, doc.quote.disclaimer, x, about + 7, text);
}
