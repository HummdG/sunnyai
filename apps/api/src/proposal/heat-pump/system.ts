/**
 * Your heat pump (the `system` switch): the recommended size, the estimated
 * peak heat loss, the floor area (and whether it was assumed from bedrooms),
 * the unit, then every option compared, then the estimate disclaimer. Full
 * width, no rail. Stored figures only.
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

import { kw, type HeatPumpProposalDoc } from './doc.js';

type Pdf = PDFKit.PDFDocument;

/** Your heat pump has no rail: stamp it with `footer(..., { hasRail: false })`. */
export const HP_SYSTEM_HAS_RAIL = false;

/** The sizing facts, as label and value rows. */
export function sizingRows(doc: HeatPumpProposalDoc): [string, string][] {
  const est = doc.quote.estimate;
  const o = doc.option;
  const area = `${num(Math.round(est.floorAreaM2))} m²`;
  return [
    ['Recommended heat pump size', kw(est.recommendedKw)],
    ['Estimated peak heat loss', kw(est.peakHeatLossKw)],
    ['Floor area', est.floorAreaAssumed ? `${area}, assumed from bedrooms` : area],
    ['Heat pump', o.unitName],
    ['Heat pump output', kw(o.outputKw)],
    ['Space heating a year', `${num(Math.round(est.annualSpaceHeatKwh))} kWh`],
    ['Hot water a year', `${num(Math.round(est.annualHotWaterKwh))} kWh`],
  ];
}

/**
 * Every option, compared: price, grant, price after the grant and running
 * cost a year. Draws from `y` (the heading 24pt below it) in `x`..`x + w`;
 * `ensure(h, y)` returns `y` when `h` more points fit, else the top of a
 * continuation page. Returns the y below the table.
 */
export function drawOptionsCompared(
  pdf: Pdf,
  doc: HeatPumpProposalDoc,
  theme: Theme,
  box: { x: number; w: number; y: number },
  ensure: (h: number, y: number) => number,
): number {
  const { x, w } = box;
  let y = box.y;
  const options = doc.quote.options;
  if (options.length < 2) return y;
  const cols: { head: string; frac: number; align: 'left' | 'right' }[] = [
    { head: 'Option', frac: 1.8, align: 'left' },
    { head: 'Price', frac: 1, align: 'right' },
    { head: 'Grant', frac: 0.9, align: 'right' },
    { head: 'After the grant', frac: 1.1, align: 'right' },
    { head: 'Running cost', frac: 1.1, align: 'right' },
  ];
  const narrow = w < 420;
  const total = cols.reduce((s, c) => s + c.frac, 0);
  const gap = narrow ? 7 : 14;
  const widths = cols.map((c) => (c.frac / total) * (w + gap) - gap);
  const xs = widths.map((_, i) => x + widths.slice(0, i).reduce((s, cw) => s + cw + gap, 0));
  const cell = { font: 'sans-400', size: narrow ? 7.8 : 8.6, color: theme.ink };
  const rows = options.map((o) => {
    const mark = o.id === doc.option.id ? (doc.chosen ? ' (your choice)' : ' (recommended)') : '';
    const priced = o.priceGbp !== null && !o.installerPriced;
    return [
      `${o.label}${mark}`,
      priced ? gbp(o.priceGbp!) : PRICED_BY_INSTALLER,
      o.grantGbp > 0 ? gbp(o.grantGbp) : 'None',
      priced && o.priceAfterGrantGbp !== null ? gbp(o.priceAfterGrantGbp) : PRICED_BY_INSTALLER,
      gbp(o.runningCostGbp),
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

export function drawHeatPumpSystem(pdf: Pdf, doc: HeatPumpProposalDoc, theme: Theme): void {
  plainPage(pdf);
  const x = FULL_X;
  const w = FULL_W;
  let y = pageTitle(pdf, theme, `Your heat pump · ${doc.reference}`, 'Your ', 'heat pump');
  y = subHead(pdf, theme, 'Sizing', x, y + 16, w);
  y = keyValues(pdf, theme, sizingRows(doc), x, y, w, 220);
  // One page: the table is short, so it never needs a continuation page.
  y = drawOptionsCompared(pdf, doc, theme, { x, w, y }, (_h, at) => at);
  const about = subHead(pdf, theme, 'About this estimate', x, y + 24, w);
  const text = { font: 'sans-400', size: 8.6, color: theme.ink, width: w, lineGap: 2 };
  para(pdf, doc.quote.disclaimer, x, about + 7, text);
}
