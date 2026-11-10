/**
 * The estimated quotation (always on): the title and the estimate notice, the
 * numbered items with their reasons, the estimated total, the deposit and
 * balance when the total is complete, the validity date, notes, the MCS block
 * when the Performance page is off, the acceptance block and the terms line.
 * Runs onto a continuation page (rail and all) when it does not fit on one.
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
} from '../copy.js';
import type { ProposalDoc } from '../doc.js';
import { CONTENT, label, type Theme } from '../layout.js';

import { MAIN_W, MAIN_X, measure, para, railBrand, railItem, railPage, rule } from './parts.js';

type Pdf = PDFKit.PDFDocument;

interface Row {
  label: string;
  price: string;
  priced: boolean;
  reason: string | null;
}

/** The numbered rows: the priced items, else the main components, then installer-priced items. */
function rowsFor(doc: ProposalDoc): Row[] {
  const o = doc.option;
  const reasons = doc.quote.reasons ?? {};
  const rows: Row[] = o.lineItems.map((item) => ({
    label: item.quantity > 1 ? `${item.quantity} × ${item.label}` : item.label,
    price: item.totalGbp > 0 ? gbp(item.totalGbp) : 'Included',
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
  opts: { mcsBlock: boolean; termsFollow: boolean },
): void {
  const m = money(doc);
  drawRail(pdf, doc, theme, railPage(pdf, theme), m);

  const x = MAIN_X;
  const w = MAIN_W;
  const priceW = 104;
  const itemX = x + 26;
  const itemW = w - 26 - priceW - 10;
  const ink = theme.ink;
  const muted = theme.muted;

  let y = label(pdf, `Quotation · ${doc.reference}`, x, CONTENT.top, { width: w, color: muted });

  /** Starts a continuation page when `h` more points will not fit. */
  const ensure = (h: number) => {
    if (y + h <= CONTENT.bottom) return;
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
  y = para(pdf, ESTIMATE.notice, x, y + 9, {
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
  y = head(y);
  rowsFor(doc).forEach((row, i) => {
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

  // ---- total
  ensure(48);
  y += 6;
  rule(pdf, y, theme.railBg, 1.6);
  const totalTop = y + 8;
  let left = para(pdf, ESTIMATE.totalLabel, x, totalTop + 3, {
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
    const r = para(
      pdf,
      'To be priced by your installer after a survey',
      x + w - 170,
      totalTop + 2,
      {
        font: 'sans-400',
        size: 9,
        color: muted,
        width: 170,
        align: 'right',
      },
    );
    y = Math.max(left, r);
  }

  // ---- deposit and balance, only with a complete total
  const moneyRow = (text: string, sub: string, value: string) => {
    const leftW = w - 90;
    const h =
      measure(pdf, text, { font: 'sans-400', size: 9, color: ink, width: leftW }) +
      2 +
      measure(pdf, sub, { font: 'sans-400', size: 7.8, color: muted, width: leftW }) +
      12;
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
    moneyRow(ESTIMATE.depositLabel, `${depositBasis(doc)}, ${m.vatNote}`, gbp(m.deposit));
    moneyRow(`Balance, ${doc.snapshot.balanceDue}`, m.vatNote, gbp(m.balance));
  }

  ensure(24);
  y = para(pdf, `Valid until ${longDate(doc.validUntil)}`, x, y + 12, {
    font: 'sans-600',
    size: 9,
    color: ink,
    width: w,
  });

  // ---- notes
  const small = { font: 'sans-400', size: 8.4, color: ink, width: w, lineGap: 1.5 };
  const list = notes(doc);
  if (list.length > 0) {
    ensure(26 + measure(pdf, list[0]!, small));
    y = label(pdf, 'Notes', x, y + 16, { width: w, color: muted }) + 2;
    for (const n of list) {
      ensure(measure(pdf, n, small) + 4);
      y = para(pdf, n, x, y, small) + 4;
    }
  }

  // ---- MCS, when the Performance page is off
  if (opts.mcsBlock) {
    const mcsText = { ...small, size: 7.8, color: muted };
    ensure(50 + measure(pdf, MCS_DISCLAIMER, mcsText));
    y = label(pdf, 'MCS performance estimate', x, y + 14, { width: w, color: muted }) + 2;
    para(pdf, 'Estimated annual generation', x, y, { ...small, width: w - 150 });
    y = para(pdf, `${num(Math.round(doc.option.annualGenerationKwh))} kWh a year`, x + w - 150, y, {
      font: 'sans-600',
      size: 9,
      color: ink,
      width: 150,
      align: 'right',
    });
    y = para(pdf, MCS_DISCLAIMER, x, y + 4, mcsText);
  }

  // ---- acceptance
  const go = goAhead(doc);
  ensure(70 + measure(pdf, go, small));
  y = label(pdf, 'Acceptance', x, y + 14, { width: w, color: muted });
  const lineY = y + 20;
  const sign = { font: 'sans-400', size: 8.4, color: ink, width: 40 };
  para(pdf, 'Signed', x, lineY - 9, sign);
  rule(pdf, lineY, ink, 0.6, x + 36, w * 0.56 - 36);
  para(pdf, 'Date', x + w * 0.64, lineY - 9, sign);
  rule(pdf, lineY, ink, 0.6, x + w * 0.64 + 28, w * 0.36 - 28);
  y = para(pdf, go, x, lineY + 12, small);

  const fine = { font: 'sans-400', size: 7.6, color: muted, width: w, lineGap: 1 };
  ensure(measure(pdf, doc.quote.disclaimer, fine) + 30);
  y = para(pdf, doc.quote.disclaimer, x, y + 12, fine);
  if (opts.termsFollow) {
    para(pdf, 'Terms and conditions follow.', x, y + 6, { ...fine, font: 'sans-600', color: ink });
  }
}

function drawRail(
  pdf: Pdf,
  doc: ProposalDoc,
  theme: Theme,
  col: { x: number; width: number },
  m: ReturnType<typeof money>,
): void {
  let y = railBrand(pdf, doc, theme, col) + 6;
  y = railItem(
    pdf,
    theme,
    col,
    y,
    ESTIMATE.totalLabel,
    m
      ? { big: gbp(m.total!), lines: [m.vatNote] }
      : { lines: ['To be priced by your installer after a survey'] },
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
      lines: [doc.snapshot.balanceDue],
    });
  }
  y = railItem(pdf, theme, col, y, 'Valid until', { lines: [longDate(doc.validUntil)] });
  railItem(pdf, theme, col, y, 'Quote', { lines: [doc.reference] });
}
