/**
 * The battery Estimated quotation, as content for the shared quotation page
 * (`drawQuotationWith` in ../pages/quotation.ts): the option's priced lines
 * and the total. There is no grant. The disclaimer sits just above the total.
 *
 * An option the installer prices (no `priceGbp`) has no total, deposit or
 * balance: "Priced by your installer" stands in their place, any lines with
 * figures sit under "Priced so far", and nothing is worked out from a
 * missing figure.
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

import { kwh, optionPriced, type BatteryProposalDoc } from './doc.js';
import { drawBatteryOptions } from './system.js';

/** The estimate notice: as the solar one, without the roof. */
export const BATTERY_NOTICE =
  'This is an estimate, not a final price. It is based on the answers you gave us. Your ' +
  'final price will be confirmed after a survey of your property, and it may go up or down.';

/**
 * The total with its deposit and balance; null unless the option has a whole
 * price. Never worked out from a missing figure.
 */
export function batteryMoney(doc: BatteryProposalDoc): QuotationMoney | null {
  const o = doc.option;
  if (!optionPriced(doc.quote, o)) return null;
  const total = Math.round(o.priceGbp!);
  // Lower case, as the solar VAT note: it also follows the deposit basis mid-sentence.
  const vatNote = o.priceLabel.charAt(0).toLowerCase() + o.priceLabel.slice(1);
  return {
    total,
    totalLabel: ESTIMATE.totalLabel,
    vatNote,
    ...depositSplit(doc.snapshot, total),
  };
}

/** The numbered rows: the priced lines, else the battery itself, priced by the installer. */
function rowsFor(doc: BatteryProposalDoc): QuotationRow[] {
  const o = doc.option;
  if (o.lineItems.length === 0) {
    return [
      {
        label: `${o.batteryName}, ${kwh(o.capacityKwh)} battery`,
        price: PRICED_BY_INSTALLER,
        priced: false,
        reason: null,
      },
    ];
  }
  return o.lineItems.map((item) => ({
    label: item.quantity > 1 ? `${item.quantity} × ${item.label}` : item.label,
    price: item.totalGbp === 0 ? 'Included' : gbp(item.totalGbp),
    priced: true,
    reason: null,
  }));
}

/** The notes: the option's and the quote's warnings, once each. */
function notesFor(doc: BatteryProposalDoc): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const w of doc.option.warnings) add(w);
  for (const w of doc.quote.warnings) add(w);
  return out;
}

export function batteryQuotation(doc: BatteryProposalDoc, theme: Theme): QuotationContent {
  const o = doc.option;
  const m = batteryMoney(doc);
  return {
    notice: BATTERY_NOTICE,
    rows: rowsFor(doc),
    // Lines with figures under an option the installer prices are only part of it.
    ...(m === null && o.lineItems.length > 0 ? { rowsHeading: 'Priced so far' } : {}),
    adjustments: [],
    money: m,
    totalLabel: ESTIMATE.totalLabel,
    noTotal: PRICED_BY_INSTALLER,
    aboveTotal: doc.quote.disclaimer,
    depositBasis: depositBasis(doc),
    goAhead: goAhead(doc),
    notes: notesFor(doc),
    mcsGenerationKwh: null,
    disclaimer: null,
    others: (pdf, box, ensure) => drawBatteryOptions(pdf, doc, theme, box, ensure),
  };
}
