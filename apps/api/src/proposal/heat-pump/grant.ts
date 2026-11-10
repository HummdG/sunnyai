/**
 * Boiler Upgrade Scheme (the `savings` switch): whether the home looks
 * eligible, the amount, the reasons the estimate gave, and how the grant is
 * paid. Full width, no rail.
 */

import { gbp } from '../copy.js';
import type { Theme } from '../layout.js';
import { FULL_W, FULL_X, keyValues, pageTitle, para, plainPage, subHead } from '../pages/parts.js';

import type { HeatPumpProposalDoc } from './doc.js';
import { GRANT_UNSURE } from './quotation-lines.js';

type Pdf = PDFKit.PDFDocument;

/** The grant page has no rail: stamp it with `footer(..., { hasRail: false })`. */
export const HP_GRANT_HAS_RAIL = false;

/** How the grant is paid: fixed wording. */
export const GRANT_PAID = 'The installer applies for the grant and it comes off your invoice.';

/** Eligibility and amount, as label and value rows. */
export function grantRows(doc: HeatPumpProposalDoc): [string, string][] {
  const bus = doc.quote.estimate.bus;
  if (bus.eligible === true) {
    return [
      ['Eligibility', 'Eligible'],
      ['Grant', gbp(bus.amountGbp)],
    ];
  }
  if (bus.eligible === 'unsure') {
    return [
      ['Eligibility', 'To be confirmed'],
      ['Grant', `Up to ${gbp(bus.amountGbp)}, not deducted`],
    ];
  }
  return [
    ['Eligibility', 'Not eligible'],
    ['Grant', 'None'],
  ];
}

export function drawGrant(pdf: Pdf, doc: HeatPumpProposalDoc, theme: Theme): void {
  plainPage(pdf);
  const x = FULL_X;
  const w = FULL_W;
  const bus = doc.quote.estimate.bus;
  let y = pageTitle(
    pdf,
    theme,
    `Boiler Upgrade Scheme · ${doc.reference}`,
    'Boiler Upgrade ',
    'Scheme',
  );
  y = subHead(pdf, theme, 'Your grant', x, y + 16, w);
  y = keyValues(pdf, theme, grantRows(doc), x, y, w, 180);

  const text = { font: 'sans-400', size: 9, color: theme.ink, width: w, lineGap: 2 };
  if (bus.reasons.length > 0) {
    y = subHead(pdf, theme, 'Why', x, y + 24, w) + 7;
    for (const r of bus.reasons) y = para(pdf, r, x, y, text) + 4;
  }
  if (bus.eligible === 'unsure') y = para(pdf, GRANT_UNSURE, x, y + 14, text);
  if (bus.eligible !== false) {
    para(pdf, GRANT_PAID, x, y + 14, { ...text, font: 'sans-600' });
  }
}
