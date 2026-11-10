/**
 * The heat pump Estimated quotation, as content for the shared quotation page
 * (`drawQuotationWith` in ../pages/quotation.ts): the option's priced lines,
 * then the Boiler Upgrade Scheme grant as its own deduction row, then the
 * total after the grant. The disclaimer sits just above the total.
 *
 * An option the installer prices (no `priceGbp`) has no total, deposit or
 * balance: "Priced by your installer" stands in their place, and nothing is
 * worked out from a missing figure.
 */

import {
  ESTIMATE,
  PRICED_BY_INSTALLER,
  depositBasis,
  depositSplit,
  gbp,
  goAhead,
} from '../copy.js';
import type { Theme } from '../layout.js';
import type { QuotationContent, QuotationMoney, QuotationRow } from '../pages/quotation.js';

import type { HeatPumpProposalDoc } from './doc.js';
import { drawOptionsCompared } from './system.js';

/** The estimate notice: as the solar one, without the roof. */
export const HEAT_PUMP_NOTICE =
  'This is an estimate, not a final price. It is based on the answers you gave us. Your ' +
  'final price will be confirmed after a survey of your property, and it may go up or down.';

/** The deduction row's label. */
export const GRANT_ROW = 'Boiler Upgrade Scheme grant';

/** Shown when the postcode cannot tell whether the grant applies. */
export const GRANT_UNSURE = 'The Boiler Upgrade Scheme may apply. Your installer will confirm.';

/** `−£7,500`, with a true minus sign (U+2212), never a dash. */
export function deduction(gbpAmount: number): string {
  return `−${gbp(gbpAmount)}`;
}

/**
 * The total after the grant, with its deposit and balance; null unless the
 * option has a whole price. Never worked out from a missing figure.
 */
export function heatPumpMoney(doc: HeatPumpProposalDoc): QuotationMoney | null {
  const o = doc.option;
  if (!doc.quote.priced || o.installerPriced || o.priceGbp === null) return null;
  if (o.priceAfterGrantGbp === null) return null;
  const total = Math.round(o.priceAfterGrantGbp);
  // Lower case, as the solar VAT note: it also follows the deposit basis mid-sentence.
  const label = o.priceLabel.charAt(0).toLowerCase() + o.priceLabel.slice(1);
  const vatNote = o.grantGbp > 0 ? `${label}, after the grant` : label;
  return {
    total,
    totalLabel: ESTIMATE.totalLabel,
    vatNote,
    ...depositSplit(doc.snapshot, total),
  };
}

/** The numbered rows: the priced lines, else what the option includes, priced by the installer. */
function rowsFor(doc: HeatPumpProposalDoc): QuotationRow[] {
  const o = doc.option;
  if (o.lineItems.length === 0) {
    return o.inclusions.map((label) => ({
      label,
      price: PRICED_BY_INSTALLER,
      priced: false,
      reason: null,
    }));
  }
  return o.lineItems.map((item) => ({
    label: item.quantity > 1 ? `${item.quantity} × ${item.label}` : item.label,
    price: item.totalGbp === 0 ? 'Included' : gbp(item.totalGbp),
    priced: true,
    reason: null,
  }));
}

/** The notes: the unsure grant, then the option's and the quote's warnings, once each. */
function notesFor(doc: HeatPumpProposalDoc): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  if (doc.quote.estimate.bus.eligible === 'unsure') add(GRANT_UNSURE);
  for (const w of doc.option.warnings) add(w);
  for (const w of doc.quote.warnings) add(w);
  return out;
}

export function heatPumpQuotation(doc: HeatPumpProposalDoc, theme: Theme): QuotationContent {
  const o = doc.option;
  const m = heatPumpMoney(doc);
  return {
    notice: HEAT_PUMP_NOTICE,
    rows: rowsFor(doc),
    adjustments: o.grantGbp > 0 ? [{ label: GRANT_ROW, amount: deduction(o.grantGbp) }] : [],
    money: m,
    totalLabel: m && o.grantGbp > 0 ? 'Estimated total after the grant' : ESTIMATE.totalLabel,
    noTotal: PRICED_BY_INSTALLER,
    aboveTotal: doc.quote.disclaimer,
    depositBasis: depositBasis(doc),
    goAhead: goAhead(doc),
    notes: notesFor(doc),
    mcsGenerationKwh: null,
    disclaimer: null,
    others: (pdf, box, ensure) => drawOptionsCompared(pdf, doc, theme, box, ensure),
  };
}
