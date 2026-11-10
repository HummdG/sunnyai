/**
 * Running costs (the `performance` switch): the current heating and its cost
 * a year, the heat pump's cost a year, the difference and the seasonal
 * efficiency (SCOP) used, then the prices behind them, the assumptions the
 * estimate made and the date of the prices. Full width, no rail.
 */

import { DATA_EFFECTIVE_FROM } from '@sunny/heat-pump-engine';

import { gbp, longDate, num } from '../copy.js';
import type { Theme } from '../layout.js';
import { FULL_W, FULL_X, keyValues, pageTitle, para, plainPage, subHead } from '../pages/parts.js';

import { fuelWords, type HeatPumpProposalDoc } from './doc.js';

type Pdf = PDFKit.PDFDocument;

/** Running costs has no rail: stamp it with `footer(..., { hasRail: false })`. */
export const HP_RUNNING_COSTS_HAS_RAIL = false;

/** `Fuel and electricity prices as at 1 October 2026.` */
export function pricesDateLine(): string {
  return `Fuel and electricity prices as at ${longDate(new Date(`${DATA_EFFECTIVE_FROM}T00:00:00Z`))}.`;
}

/** `12.3p per kWh`. */
const pence = (p: number) => `${num(p, 1)}p per kWh`;

/** The cost table, as label and value rows. */
export function runningCostRows(doc: HeatPumpProposalDoc): [string, string][] {
  const o = doc.option;
  const r = doc.quote.estimate.runningCost;
  const diff = o.currentCostGbp - o.runningCostGbp;
  return [
    [`${fuelWords(doc.currentFuel)}, now`, `${gbp(o.currentCostGbp)} a year`],
    ['Heat pump', `${gbp(o.runningCostGbp)} a year`],
    ['Difference', diff >= 0 ? `${gbp(diff)} a year lower` : `${gbp(-diff)} a year higher`],
    ['Seasonal efficiency used (SCOP)', num(doc.quote.estimate.scop, 1)],
    ['Current fuel price', pence(r.fuelPencePerKwh)],
    ['Electricity price', pence(r.elecPencePerKwh)],
    ['Current heating efficiency', `${Math.round(r.boilerEfficiency * 100)}%`],
  ];
}

export function drawRunningCosts(pdf: Pdf, doc: HeatPumpProposalDoc, theme: Theme): void {
  plainPage(pdf);
  const x = FULL_X;
  const w = FULL_W;
  let y = pageTitle(pdf, theme, `Running costs · ${doc.reference}`, 'Running ', 'costs');
  y = subHead(pdf, theme, 'Your heating, a year', x, y + 16, w);
  y = keyValues(pdf, theme, runningCostRows(doc), x, y, w, 180);

  const text = { font: 'sans-400', size: 8.6, color: theme.ink, width: w, lineGap: 2 };
  const assumptions = doc.quote.estimate.assumptions;
  if (assumptions.length > 0) {
    y = subHead(pdf, theme, 'What we assumed', x, y + 24, w) + 7;
    for (const a of assumptions) y = para(pdf, a, x, y, text) + 4;
  }
  y = para(pdf, pricesDateLine(), x, y + 14, { ...text, color: theme.muted });
  para(
    pdf,
    'These are estimates for a typical year. What you pay depends on the weather, your ' +
      'tariff and how you heat your home.',
    x,
    y + 4,
    { ...text, color: theme.muted },
  );
}
