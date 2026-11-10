/**
 * The estimated quotation (always on): the title and the estimate notice, the
 * numbered items with their reasons, the estimated total, the deposit and
 * balance when the total is complete, the validity date and the acceptance
 * block (kept together, so the signature never leaves the figures it signs
 * for), then notes, the MCS block when the Performance page is off, the
 * disclaimer and the terms line. Runs onto a continuation page (rail and all)
 * when it does not fit on one; the terms then start beneath it (see pdf.ts).
 */

import {
  ESTIMATE,
  MCS_DISCLAIMER,
  PRICED_BY_INSTALLER,
  depositBasis,
  gbp,
  goAhead,
  longDate,
  money,
  notes,
  num,
  vatRow,
} from '../copy.js';
import type { ProposalBase, ProposalDoc } from '../doc.js';
import { CONTENT, label, type Theme } from '../layout.js';

import { MAIN_W, MAIN_X, measure, para, railBrand, railItem, railPage, rule } from './parts.js';
import { drawOthers } from './others.js';

type Pdf = PDFKit.PDFDocument;

/** Where the quotation ended, and whether it ran onto a continuation page. */
export interface QuotationEnd {
  y: number;
  continued: boolean;
}

/** `Balance, within 7 days`, or just `Balance` when no timing is set. */
function balanceLabel(due: string): string {
  const t = due.trim();
  return t ? `Balance, ${t}` : 'Balance';
}

/** A numbered item: its label, its price (or "Priced by your installer") and its reason. */
export interface QuotationRow {
  label: string;
  price: string;
  priced: boolean;
  reason: string | null;
}
type Row = QuotationRow;

/** The total, deposit and balance as the page prints them; see `money` in copy.ts. */
export type QuotationMoney = NonNullable<ReturnType<typeof money>>;

/**
 * What the Estimated quotation page says, for any kind of quote. The solar
 * page builds it from the option (`drawQuotation`); the heat pump page builds
 * its own (proposal/heat-pump/quotation-lines.ts).
 */
export interface QuotationContent {
  /** The estimate notice under the title. */
  notice: string;
  rows: QuotationRow[];
  /** A sub-heading set above the items, or absent for none. */
  rowsHeading?: string;
  /**
   * Unnumbered rows after the items: VAT added on top, or a deduction such as
   * the Boiler Upgrade Scheme grant. The amount is printed as given.
   */
  adjustments: { label: string; amount: string }[];
  /** Null when the total is not complete: no total figure, deposit or balance. */
  money: QuotationMoney | null;
  /** The total's label in the main column. */
  totalLabel: string;
  /** Printed in place of the total figure when `money` is null. */
  noTotal: string;
  /** A paragraph set just above the total, or null. */
  aboveTotal: string | null;
  depositBasis: string | null;
  goAhead: string;
  notes: string[];
  /** The MCS block's generation figure; null: the block is never drawn. */
  mcsGenerationKwh: number | null;
  /** The quote's own disclaimer at the foot, or null for none. */
  disclaimer: string | null;
  /** Draws "Other options we looked at" (see others.ts); absent: none here. */
  others?: (
    pdf: Pdf,
    box: { x: number; w: number; y: number },
    ensure: (h: number, y: number) => number,
  ) => number;
}

const NO_TOTAL = 'To be priced by your installer after a survey';

/** The numbered rows: the priced items, else the main components, then installer-priced items. */
function rowsFor(doc: ProposalDoc): Row[] {
  const o = doc.option;
  const reasons = doc.quote.reasons ?? {};
  const rows: Row[] = o.lineItems.map((item) => ({
    label: item.quantity > 1 ? `${item.quantity} × ${item.label}` : item.label,
    price: item.totalGbp === 0 ? 'Included' : gbp(item.totalGbp),
    priced: true,
    reason: reasons[item.sku] ?? null,
  }));
  if (rows.length === 0) {
    // No price list: the system's parts, each priced by the installer.
    const parts = [
      `${o.panelCount} × ${o.panelType ?? 'solar panels'}, ${num(o.systemKwp, 2)} kWp`,
      ...(o.inverterType ? [o.inverterType] : []),
      ...(o.batteryType
        ? [
            o.batteryCapacityKwh > 0
              ? `${o.batteryType}, ${num(o.batteryCapacityKwh, 1)} kWh`
              : o.batteryType,
          ]
        : []),
      'Installation',
    ];
    for (const p of parts) {
      rows.push({ label: p, price: PRICED_BY_INSTALLER, priced: false, reason: null });
    }
  }
  for (const p of o.installerPriced) {
    rows.push({ label: p, price: PRICED_BY_INSTALLER, priced: false, reason: null });
  }
  return rows;
}

export function drawQuotation(
  pdf: Pdf,
  doc: ProposalDoc,
  theme: Theme,
  opts: { mcsBlock: boolean; termsFollow: boolean; othersHere?: boolean },
): QuotationEnd {
  const vat = vatRow(doc);
  return drawQuotationWith(
    pdf,
    doc,
    theme,
    {
      notice: ESTIMATE.notice,
      rows: rowsFor(doc),
      adjustments: vat ? [{ label: vat.label, amount: gbp(vat.amount) }] : [],
      money: money(doc),
      totalLabel: ESTIMATE.totalLabel,
      noTotal: NO_TOTAL,
      aboveTotal: null,
      depositBasis: depositBasis(doc),
      goAhead: goAhead(doc),
      notes: notes(doc),
      mcsGenerationKwh: doc.option.annualGenerationKwh,
      disclaimer: doc.quote.disclaimer,
      others: (p, box, ensure) => drawOthers(p, doc, theme, box, ensure),
    },
    opts,
  );
}

/** Draws the Estimated quotation from its content: solar and heat pump alike. */
export function drawQuotationWith(
  pdf: Pdf,
  doc: ProposalBase,
  theme: Theme,
  content: QuotationContent,
  opts: { mcsBlock: boolean; termsFollow: boolean; othersHere?: boolean },
): QuotationEnd {
  const m = content.money;
  drawRail(pdf, doc, theme, railPage(pdf, theme), m, content.noTotal);

  const x = MAIN_X;
  const w = MAIN_W;
  const priceW = 104;
  const itemX = x + 26;
  const itemW = w - 26 - priceW - 10;
  const ink = theme.ink;
  const muted = theme.muted;

  let y = label(pdf, `Quotation · ${doc.reference}`, x, CONTENT.top, { width: w, color: muted });
  let continued = false;

  /** Starts a continuation page when `h` more points will not fit. */
  const ensure = (h: number) => {
    if (y + h <= CONTENT.bottom) return;
    continued = true;
    pdf.addPage();
    const col = railPage(pdf, theme);
    railBrand(pdf, doc, theme, col);
    y = label(pdf, `${ESTIMATE.title}, continued · ${doc.reference}`, x, CONTENT.top, {
      width: w,
      color: muted,
    });
    y += 10;
  };

  // ---- title and notice
  y += 12;
  pdf.font('sans-300').fontSize(24).fillColor(ink);
  const [light, bold] = ['Estimated ', 'quotation'];
  pdf.text(light, x, y, { continued: true, lineBreak: false });
  pdf.font('sans-800').text(bold, { lineBreak: false });
  y += pdf.currentLineHeight(true) + 12;
  rule(pdf, y, ink, 0.8);
  y = para(pdf, content.notice, x, y + 9, {
    font: 'sans-400',
    size: 10,
    color: ink,
    width: w,
    lineGap: 2,
  });
  rule(pdf, y + 7, ink, 0.8);
  y += 18;

  // ---- items
  const head = (at: number) => {
    label(pdf, '#', x, at, { width: 20, color: muted });
    label(pdf, 'Item', itemX, at, { width: itemW, color: muted });
    const below = label(pdf, 'Price', x + w - priceW, at, {
      width: priceW,
      align: 'right',
      color: muted,
    });
    rule(pdf, below + 1, theme.railBg, 1);
    return below + 6;
  };
  if (content.rowsHeading) {
    y = para(pdf, content.rowsHeading, x, y, {
      font: 'sans-600',
      size: 9.5,
      color: ink,
      width: w,
    });
    y += 6;
  }
  y = head(y);
  content.rows.forEach((row, i) => {
    const labelOpts = { font: 'sans-400', size: 9, color: ink, width: itemW, lineGap: 1 };
    const reasonOpts = { font: 'sans-400', size: 7.6, color: theme.accent, width: itemW };
    const priceOpts = row.priced
      ? { font: 'sans-600', size: 9, color: ink, width: priceW, align: 'right' as const }
      : { font: 'sans-400', size: 8, color: muted, width: priceW, align: 'right' as const };
    const h =
      Math.max(
        measure(pdf, row.label, labelOpts) +
          (row.reason ? 2 + measure(pdf, row.reason, reasonOpts) : 0),
        measure(pdf, row.price, priceOpts),
      ) + 9;
    if (y + h > CONTENT.bottom) {
      ensure(h + 30);
      y = head(y);
    }
    const top = y + 4.5;
    label(pdf, String(i + 1).padStart(2, '0'), x, top + 1.5, { width: 20, color: muted });
    const ly = para(pdf, row.label, itemX, top, labelOpts);
    if (row.reason) para(pdf, row.reason, itemX, ly + 2, reasonOpts);
    para(pdf, row.price, x + w - priceW, top, priceOpts);
    y += h;
    rule(pdf, y, theme.rule);
  });

  // ---- VAT added on top of the ex-VAT item prices; deductions such as a grant
  for (const adj of content.adjustments) {
    ensure(24);
    const top = y + 4.5;
    para(pdf, adj.label, itemX, top, { font: 'sans-400', size: 9, color: ink, width: itemW });
    para(pdf, adj.amount, x + w - priceW, top, {
      font: 'sans-600',
      size: 9,
      color: ink,
      width: priceW,
      align: 'right',
    });
    y += measure(pdf, adj.label, { font: 'sans-400', size: 9, color: ink, width: itemW }) + 9;
    rule(pdf, y, theme.rule);
  }

  // ---- a paragraph the kind sets just above its total
  const small = { font: 'sans-400', size: 8.4, color: ink, width: w, lineGap: 1.5 };
  if (content.aboveTotal) {
    const above = { ...small, size: 8, color: muted };
    ensure(measure(pdf, content.aboveTotal, above) + 12);
    y = para(pdf, content.aboveTotal, x, y + 10, above);
  }

  // ---- the figures and the signature, kept on one page when they fit on one
  const go = content.goAhead;
  const depositH =
    m !== null && m.deposit !== null && m.balance !== null
      ? 8 +
        moneyRowH(pdf, ESTIMATE.depositLabel, `${content.depositBasis}, ${m.vatNote}`, w - 90) +
        moneyRowH(pdf, balanceLabel(doc.snapshot.balanceDue), m.vatNote, w - 90)
      : 0;
  const acceptH = ACCEPT_H + measure(pdf, go, small);
  ensure(48 + depositH + VALID_H + acceptH);

  // ---- total
  ensure(48);
  y += 6;
  rule(pdf, y, theme.railBg, 1.6);
  const totalTop = y + 8;
  let left = para(pdf, content.totalLabel, x, totalTop + 3, {
    font: 'sans-600',
    size: 10.5,
    color: ink,
    width: w - 150,
  });
  if (m) {
    left = para(pdf, m.vatNote, x, left, {
      font: 'sans-400',
      size: 8,
      color: muted,
      width: w - 150,
    });
    para(pdf, gbp(m.total!), x + w - 150, totalTop, {
      font: 'sans-800',
      size: 19,
      color: ink,
      width: 150,
      align: 'right',
    });
    y = Math.max(left, totalTop + 24);
  } else {
    const r = para(pdf, content.noTotal, x + w - 170, totalTop + 2, {
      font: 'sans-400',
      size: 9,
      color: muted,
      width: 170,
      align: 'right',
    });
    y = Math.max(left, r);
  }

  // ---- deposit and balance, only with a complete total
  const moneyRow = (text: string, sub: string, value: string) => {
    const leftW = w - 90;
    const h = moneyRowH(pdf, text, sub, leftW);
    ensure(h);
    const top = y + 6;
    const below = para(pdf, text, x, top, { font: 'sans-400', size: 9, color: ink, width: leftW });
    para(pdf, sub, x, below + 2, { font: 'sans-400', size: 7.8, color: muted, width: leftW });
    para(pdf, value, x + w - priceW, top, {
      font: 'sans-600',
      size: 10,
      color: ink,
      width: priceW,
      align: 'right',
    });
    y += h;
    rule(pdf, y, theme.rule);
  };
  if (m && m.deposit !== null && m.balance !== null) {
    y += 8;
    rule(pdf, y, theme.rule);
    moneyRow(ESTIMATE.depositLabel, `${content.depositBasis}, ${m.vatNote}`, gbp(m.deposit));
    moneyRow(balanceLabel(doc.snapshot.balanceDue), m.vatNote, gbp(m.balance));
  }

  ensure(VALID_H);
  y = para(pdf, `Valid until ${longDate(doc.validUntil)}`, x, y + 10, {
    font: 'sans-600',
    size: 9,
    color: ink,
    width: w,
  });

  // ---- acceptance
  ensure(acceptH);
  y = label(pdf, 'Acceptance', x, y + 12, { width: w, color: muted });
  const lineY = y + 18;
  const sign = { font: 'sans-400', size: 8.4, color: ink, width: 40 };
  para(pdf, 'Signed', x, lineY - 9, sign);
  rule(pdf, lineY, ink, 0.6, x + 36, w * 0.56 - 36);
  para(pdf, 'Date', x + w * 0.64, lineY - 9, sign);
  rule(pdf, lineY, ink, 0.6, x + w * 0.64 + 28, w * 0.36 - 28);
  y = para(pdf, go, x, lineY + 10, small);

  // ---- notes
  const list = content.notes;
  if (list.length > 0) {
    ensure(24 + measure(pdf, list[0]!, small));
    y = label(pdf, 'Notes', x, y + 12, { width: w, color: muted }) + 2;
    for (const n of list) {
      ensure(measure(pdf, n, small) + 4);
      y = para(pdf, n, x, y, small) + 4;
    }
  }

  // ---- MCS, when the Performance page is off
  if (opts.mcsBlock && content.mcsGenerationKwh !== null) {
    const mcsText = { ...small, size: 7.8, color: muted };
    ensure(40 + measure(pdf, MCS_DISCLAIMER, mcsText));
    y = label(pdf, 'MCS performance estimate', x, y + 10, { width: w, color: muted }) + 2;
    para(pdf, 'Estimated annual generation', x, y, { ...small, width: w - 150 });
    y = para(pdf, `${num(Math.round(content.mcsGenerationKwh))} kWh a year`, x + w - 150, y, {
      font: 'sans-600',
      size: 9,
      color: ink,
      width: 150,
      align: 'right',
    });
    y = para(pdf, MCS_DISCLAIMER, x, y + 3, mcsText);
  }

  // ---- other options, when Your system is off
  if (opts.othersHere && content.others) {
    y = content.others(pdf, { x, w, y }, (h, at) => {
      y = at;
      ensure(h);
      return y;
    });
  }

  const fine = { font: 'sans-400', size: 7.6, color: muted, width: w, lineGap: 1 };
  if (content.disclaimer) {
    ensure(measure(pdf, content.disclaimer, fine) + 14);
    y = para(pdf, content.disclaimer, x, y + 10, fine);
  }
  // On a continuation page the terms start right here instead (see pdf.ts).
  if (opts.termsFollow && !continued) {
    ensure(16);
    y = para(pdf, 'Terms and conditions follow.', x, y + 6, {
      ...fine,
      font: 'sans-600',
      color: ink,
    });
  }
  return { y, continued };
}

/** Space the validity line takes; and the acceptance block, less its go-ahead line. */
const VALID_H = 22;
const ACCEPT_H = 52;

function moneyRowH(pdf: Pdf, text: string, sub: string, width: number): number {
  return (
    measure(pdf, text, { font: 'sans-400', size: 9, color: '', width }) +
    2 +
    measure(pdf, sub, { font: 'sans-400', size: 7.8, color: '', width }) +
    12
  );
}

function drawRail(
  pdf: Pdf,
  doc: ProposalBase,
  theme: Theme,
  col: { x: number; width: number },
  m: QuotationMoney | null,
  noTotal: string,
): void {
  let y = railBrand(pdf, doc, theme, col) + 6;
  y = railItem(
    pdf,
    theme,
    col,
    y,
    ESTIMATE.totalLabel,
    m ? { big: gbp(m.total!), lines: [m.vatNote] } : { lines: [noTotal] },
  );
  if (m && m.deposit !== null && m.balance !== null) {
    const rule = doc.snapshot.deposit;
    y = railItem(
      pdf,
      theme,
      col,
      y,
      rule.kind === 'percent' ? `Deposit · ${rule.percent}%` : 'Deposit · fixed',
      { big: gbp(m.deposit), lines: ['once your survey has confirmed the final price'] },
    );
    y = railItem(pdf, theme, col, y, 'Balance', {
      big: gbp(m.balance),
      lines: doc.snapshot.balanceDue.trim() ? [doc.snapshot.balanceDue] : [],
    });
  }
  y = railItem(pdf, theme, col, y, 'Valid until', { lines: [longDate(doc.validUntil)] });
  railItem(pdf, theme, col, y, 'Quote', { lines: [doc.reference] });
}
