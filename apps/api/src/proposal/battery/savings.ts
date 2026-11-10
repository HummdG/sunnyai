/**
 * Savings (the `savings` or `performance` switch): the option's saving a
 * year from storing the home's own solar, from charging at the cheap rate
 * (on a time-of-use tariff only), the total and the payback; then the rates
 * the estimate used and their date, and what it assumed. Full width, no rail.
 */

import {
  ANNUAL_YIELD_KWH_PER_KWP,
  TIME_OF_USE_RATES,
  type BatteryTariff,
} from '@sunny/quote-engine';

import { gbp, longDate, num } from '../copy.js';
import type { Theme } from '../layout.js';
import { FULL_W, FULL_X, keyValues, pageTitle, para, plainPage, subHead } from '../pages/parts.js';

import { years, type BatteryProposalDoc } from './doc.js';

type Pdf = PDFKit.PDFDocument;

/** Savings has no rail: stamp it with `footer(..., { hasRail: false })`. */
export const BATTERY_SAVINGS_HAS_RAIL = false;

const TARIFF_WORDS: Record<BatteryTariff, string> = {
  standard: 'Standard single rate',
  economy7: 'Economy 7',
  smart_tou: 'Smart time-of-use',
  import_export: 'Import and export',
  already_exports: 'Already paid for export',
  unknown: 'Not known, taken as single rate',
};

/** Whether the quote's tariff has a cheap rate the battery can charge at. */
function timeOfUse(doc: BatteryProposalDoc): boolean {
  const est = doc.quote.estimate;
  return est.offPeakPence !== null && est.peakPence !== null;
}

/**
 * `Rates as at 1 October 2026.`: the latest `effectiveFrom` of the battery
 * data the estimate used, the solar yield and, on a time-of-use tariff, its
 * rates.
 */
export function ratesDateLine(doc: BatteryProposalDoc): string {
  const t = doc.quote.tariff;
  const dates = [ANNUAL_YIELD_KWH_PER_KWP.effectiveFrom];
  if (timeOfUse(doc) && (t === 'economy7' || t === 'smart_tou')) {
    dates.push(TIME_OF_USE_RATES[t].effectiveFrom);
  }
  const latest = dates.sort().at(-1)!;
  return `Rates as at ${longDate(new Date(`${latest}T00:00:00Z`))}.`;
}

/** `24.5p per kWh`. */
const pence = (p: number) => `${num(p, 1)}p per kWh`;

/** The saving table, as label and value rows. */
export function savingRows(doc: BatteryProposalDoc): [string, string][] {
  const o = doc.option;
  const priced = o.priceGbp !== null && !o.installerPriced;
  const payback =
    priced && o.paybackYears !== null
      ? years(o.paybackYears)
      : priced
        ? 'Not estimated'
        : 'Once your installer has priced it';
  const rows: [string, string][] = [
    ['Storing your own solar', `${gbp(o.selfUseSavingGbp)} a year`],
  ];
  if (timeOfUse(doc)) rows.push(['Charging at the cheap rate', `${gbp(o.shiftSavingGbp)} a year`]);
  rows.push(['Total saving', `${gbp(o.annualSavingsGbp)} a year`], ['Payback', payback]);
  return rows;
}

/** The rates behind the saving, as label and value rows. */
export function rateRows(doc: BatteryProposalDoc): [string, string][] {
  const est = doc.quote.estimate;
  const rows: [string, string][] = [
    ['Your tariff', TARIFF_WORDS[doc.quote.tariff]],
    ['Electricity price', pence(est.importPence)],
    ['Export payment', pence(est.exportPence)],
  ];
  if (est.offPeakPence !== null && est.peakPence !== null) {
    rows.push(['Cheap rate', pence(est.offPeakPence)], ['Peak rate', pence(est.peakPence)]);
  }
  return rows;
}

export function drawBatterySavings(pdf: Pdf, doc: BatteryProposalDoc, theme: Theme): void {
  plainPage(pdf);
  const x = FULL_X;
  const w = FULL_W;
  let y = pageTitle(pdf, theme, `Savings · ${doc.reference}`, 'Your ', 'savings');
  y = subHead(pdf, theme, `Savings a year with the ${doc.option.batteryName}`, x, y + 16, w);
  y = keyValues(pdf, theme, savingRows(doc), x, y, w, 180);
  y = subHead(pdf, theme, 'Rates used', x, y + 24, w);
  y = keyValues(pdf, theme, rateRows(doc), x, y, w, 180);

  const text = { font: 'sans-400', size: 8.6, color: theme.ink, width: w, lineGap: 2 };
  const assumptions = doc.quote.estimate.assumptions;
  if (assumptions.length > 0) {
    y = subHead(pdf, theme, 'What we assumed', x, y + 24, w) + 7;
    for (const a of assumptions) y = para(pdf, a, x, y, text) + 4;
  }
  y = para(pdf, ratesDateLine(doc), x, y + 14, { ...text, color: theme.muted });
  para(
    pdf,
    'These are estimates for a typical year. What you save depends on the weather, your ' +
      'tariff and when you use your electricity.',
    x,
    y + 4,
    { ...text, color: theme.muted },
  );
}
