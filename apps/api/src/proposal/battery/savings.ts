/**
 * Savings (the `savings` or `performance` switch): the option's saving a
 * year from storing the home's own solar, from charging at the cheap rate
 * (on a time-of-use tariff only), the total and the payback; then the rates
 * the estimate used, with the date of the dated ones just beneath, and what
 * it assumed. Full width, no rail.
 *
 * Only the battery data is dated (the solar yield and the time-of-use rates):
 * the import and export prices are regional averages with no date, so the
 * date line names exactly what it dates.
 */

import type { BatteryTariff } from '@sunny/quote-engine';

import { batteryDataEffectiveFrom } from '../../journey/battery/record.js';
import { gbp, longDate, num } from '../copy.js';
import type { Theme } from '../layout.js';
import { FULL_W, FULL_X, keyValues, pageTitle, para, plainPage, subHead } from '../pages/parts.js';

import { paybackWords, type BatteryProposalDoc } from './doc.js';

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

/** Whether the estimate used a time-of-use pair (cheap and peak rates). */
function timeOfUse(doc: BatteryProposalDoc): boolean {
  const est = doc.quote.estimate;
  return est.offPeakPence !== null && est.peakPence !== null;
}

/**
 * `Solar yield and time-of-use rates as at 1 October 2026.` (a time-of-use
 * tariff) or `Solar yield as at 1 October 2026.`, from the date stored on the
 * quote when it was made. A row from before that was stored: today's data date.
 */
export function dataDateLine(doc: BatteryProposalDoc): string {
  const date = doc.quote.dataEffectiveFrom ?? batteryDataEffectiveFrom(doc.quote.tariff);
  const what = timeOfUse(doc) ? 'Solar yield and time-of-use rates' : 'Solar yield';
  return `${what} as at ${longDate(new Date(`${date}T00:00:00Z`))}.`;
}

/** `24.5p per kWh`. */
const pence = (p: number) => `${num(p, 1)}p per kWh`;

/** The saving table, as label and value rows. */
export function savingRows(doc: BatteryProposalDoc): [string, string][] {
  const o = doc.option;
  const payback = paybackWords(doc.quote, o);
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
    // From the regional tariff table for the postcode, never the visitor's own bill.
    ['Electricity price, regional average', pence(est.importPence)],
    ['Export payment, regional average', pence(est.exportPence)],
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
  y = para(pdf, dataDateLine(doc), x, y + 8, { ...text, color: theme.muted });

  const assumptions = doc.quote.estimate.assumptions;
  if (assumptions.length > 0) {
    y = subHead(pdf, theme, 'What we assumed', x, y + 24, w) + 7;
    for (const a of assumptions) y = para(pdf, a, x, y, text) + 4;
  }
  para(
    pdf,
    'These are estimates for a typical year. What you save depends on the weather, your ' +
      'tariff and when you use your electricity.',
    x,
    y + 14,
    { ...text, color: theme.muted },
  );
}
