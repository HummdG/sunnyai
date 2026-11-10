/**
 * The words on a battery option on the lead page, as plain strings, so the
 * tests read them without a browser.
 */

import { money } from './heat-pump-lead-text.js';

interface Priced {
  priceGbp: number | null;
  /** Optional on rows saved before the flag existed. */
  installerPriced?: boolean;
}

const unpriced = (o: Priced) => o.installerPriced === true || o.priceGbp === null;

/** The price, or that the installer sets it at the survey (never a partial price). */
export function batteryPriceText(o: Priced): string {
  return unpriced(o) ? 'Priced at survey' : `About ${money(o.priceGbp!)}`;
}

/** The yearly saving, with the cheap-rate charging part when there is one. */
export function batterySavingsText(annualSavingsGbp: number, shiftSavingGbp: number): string {
  const saving = Math.round(annualSavingsGbp);
  if (saving <= 0) return 'None estimated';
  const shift = Math.round(shiftSavingGbp);
  return shift > 0
    ? `About ${money(saving)} a year, about ${money(shift)} of it from cheap-rate charging`
    : `About ${money(saving)} a year`;
}

/** Years to pay back, for a priced option that has them. */
export function batteryPaybackText(o: Priced & { paybackYears: number | null }): string {
  if (unpriced(o) || o.paybackYears === null) return 'Not estimated';
  const n = o.paybackYears;
  return `About ${n.toLocaleString('en-GB', { maximumFractionDigits: 1 })} ${n === 1 ? 'year' : 'years'}`;
}
