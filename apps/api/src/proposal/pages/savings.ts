/**
 * Savings and payback: year-one and 25-year figures, the cumulative savings
 * chart, the payback line, the environmental figures and the assumptions.
 * The 25-year figures come from the engine's `calc25YearSavings` on the
 * stored quote, as the original proposal did. Full width, no rail.
 *
 * The chart's end labels sit beyond the end of their bar (below a negative
 * bar, above a positive one), in a band kept clear for them, so they never
 * touch a bar or the axis; negatives read `-£12,348`.
 */

import { calc25YearSavings, DEFAULT_ASSUMPTIONS } from '@sunny/quote-engine';

import { gbp, num, totalComplete } from '../copy.js';
import type { ProposalDoc } from '../doc.js';
import type { Rect, Theme } from '../layout.js';

import {
  FULL_W,
  FULL_X,
  figures,
  keyValues,
  pageTitle,
  para,
  plainPage,
  rule,
  subHead,
} from './parts.js';

type Pdf = PDFKit.PDFDocument;

/** Savings pages have no rail: stamp them with `footer(..., { hasRail: false })`. */
export const SAVINGS_HAS_RAIL = false;

/** The engine's defaults, as the quote used them. */
const INFLATION = DEFAULT_ASSUMPTIONS.energyInflationRate ?? 0.03;
const DEGRADATION = DEFAULT_ASSUMPTIONS.panelDegradationPerYear ?? 0.005;
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

const LABEL_H = 9;
const BAND = 13;

interface Placed extends Rect {
  text: string;
}

const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The cumulative chart's geometry inside `box`: a bar per year, the zero
 * axis, the first and last values as labels clear of every bar and the axis,
 * and the year marks under the plot.
 */
export function cumulativeChart(
  values: number[],
  box: Rect,
  textWidth: (s: string) => number,
): { bars: Rect[]; zeroY: number; labels: Placed[]; years: Placed[] } {
  const top = box.y + BAND;
  const bottom = box.y + box.h - BAND - 12;
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const zeroY = top + (bottom - top) * (hi / span);
  const step = box.w / Math.max(values.length, 1);
  const bars = values
    .map((v) => {
      const h = (Math.abs(v) / span) * (bottom - top);
      return { v, h };
    })
    .map(({ v, h }, i) => ({
      x: box.x + i * step + step * 0.18,
      y: v >= 0 ? zeroY - h : zeroY,
      w: step * 0.64,
      h: Math.max(h, 0.5),
    }));

  const labels: Placed[] = [];
  const ends = values.length > 1 ? [0, values.length - 1] : values.length ? [0] : [];
  for (const i of ends) {
    const v = values[i]!;
    const bar = bars[i]!;
    const text = gbp(v);
    const w = textWidth(text);
    const first = i === 0;
    const lx = Math.min(Math.max(first ? bar.x : bar.x + bar.w - w, box.x), box.x + box.w - w);
    const candidates = [
      v >= 0 ? bar.y - LABEL_H - 2 : bar.y + bar.h + 2, // beyond the bar's end
      v >= 0 ? zeroY + 2 : zeroY - LABEL_H - 2, // the other side of the axis
      box.y, // the band above the plot
    ];
    let placed: Placed | null = null;
    for (const ly of candidates) {
      const r = { text, x: lx, y: ly, w, h: LABEL_H };
      const crossesAxis = r.y <= zeroY && r.y + r.h >= zeroY;
      const inBox = r.y >= box.y && r.y + r.h <= bottom + BAND;
      if (
        inBox &&
        !crossesAxis &&
        !bars.some((b) => hits(r, b)) &&
        !labels.some((l) => hits(r, l))
      ) {
        placed = r;
        break;
      }
    }
    labels.push(placed ?? { text, x: lx, y: box.y, w, h: LABEL_H });
  }

  const years: Placed[] = [];
  values.forEach((_, i) => {
    const year = i + 1;
    if (year !== 1 && year % 5 !== 0) return;
    years.push({ text: String(year), x: box.x + i * step, y: box.y + box.h - 9, w: step, h: 8 });
  });
  return { bars, zeroY, labels, years };
}

export function drawSavings(pdf: Pdf, doc: ProposalDoc, theme: Theme): void {
  plainPage(pdf);
  const x = FULL_X;
  const w = FULL_W;
  const o = doc.option;
  const basis = doc.quote.basis;
  let y = pageTitle(
    pdf,
    theme,
    `Savings · 25-year estimate · ${doc.reference}`,
    'Savings and ',
    'payback',
  );

  // Only a complete total gives 25-year figures. They use the price before
  // VAT, as the original proposal did, and the label says so when VAT is added.
  const years =
    totalComplete(doc) && o.priceGbp !== null
      ? calc25YearSavings(
          o.annualGenerationKwh,
          o.selfConsumptionRate,
          basis.importPence,
          basis.exportPence,
          o.priceGbp,
          INFLATION,
          DEGRADATION,
        )
      : null;
  const body = { font: 'sans-400', size: 9, color: theme.ink, width: w, lineGap: 2 };

  if (years && years.length > 0) {
    const lifetime = years.reduce((sum, yr) => sum + yr.saving, 0);
    const net = years.at(-1)!.cumulative;
    y = figures(
      pdf,
      theme,
      [
        { key: 'Year-one saving', value: gbp(o.annualSavingsGbp), sub: 'on your bills' },
        { key: 'Bill savings over 25 years', value: gbp(lifetime) },
        {
          key: 'Net savings over 25 years',
          value: gbp(net),
          sub:
            o.priceIncVatGbp !== null
              ? 'after the system price before VAT'
              : 'after the system price',
        },
        o.paybackYears !== null
          ? { key: 'Payback', value: `${num(o.paybackYears, 1)} years` }
          : { key: 'Payback', value: 'Not reached', sub: 'within 25 years' },
      ],
      x,
      y + 18,
      w,
    );

    y = subHead(pdf, theme, 'Cumulative savings from going solar (£)', x, y + 24, w);
    const box = { x, y: y + 8, w, h: 180 };
    pdf.font('sans-600').fontSize(7.5);
    const chart = cumulativeChart(
      years.map((yr) => yr.cumulative),
      box,
      (s) => pdf.font('sans-600').fontSize(7.5).widthOfString(s),
    );
    chart.bars.forEach((b, i) => {
      pdf
        .save()
        .rect(b.x, b.y, b.w, b.h)
        .fill(years[i]!.cumulative >= 0 ? theme.accent : '#aebbc5')
        .restore();
    });
    rule(pdf, chart.zeroY, theme.ink, 0.6, x, w);
    for (const l of chart.labels) {
      pdf.font('sans-600').fontSize(7.5).fillColor(theme.ink).text(l.text, l.x, l.y, {
        lineBreak: false,
      });
    }
    for (const yr of chart.years) {
      pdf.font('sans-400').fontSize(7).fillColor(theme.muted).text(yr.text, yr.x, yr.y, {
        width: yr.w,
        align: 'center',
        lineBreak: false,
      });
    }
    y = box.y + box.h;
    y = para(
      pdf,
      `Payback ${o.paybackYears !== null ? `in about ${num(o.paybackYears, 1)} years` : 'not reached within 25 years'}. ` +
        'Estimates do not include replacing equipment outside its warranty.',
      x,
      y + 10,
      body,
    );
  } else {
    y = figures(
      pdf,
      theme,
      [{ key: 'Year-one saving', value: gbp(o.annualSavingsGbp), sub: 'on your bills' }],
      x,
      y + 18,
      (w - 48) / 4,
    );
    y = para(
      pdf,
      `Estimated bill savings of about ${gbp(o.annualSavingsGbp)} a year. Your installer will ` +
        'confirm the price, and so the payback, after a survey.',
      x,
      y + 12,
      body,
    );
  }

  y = subHead(pdf, theme, 'Environmental benefits', x, y + 26, w);
  y = figures(
    pdf,
    theme,
    [
      { key: 'CO2 reduced each year', value: `${num(o.co2TonnesPerYear, 2)} t` },
      { key: 'CO2 reduced over 25 years', value: `${num(o.co2TonnesPerYear * 25, 1)} t` },
      {
        key: 'Of your yearly use, generated by solar',
        value:
          basis.annualKwh > 0 ? pct(Math.min(1, o.annualGenerationKwh / basis.annualKwh)) : '–',
      },
    ],
    x,
    y + 12,
    w,
  );

  y = subHead(pdf, theme, 'Assumptions', x, y + 26, w);
  keyValues(
    pdf,
    theme,
    [
      ['Electricity import price', `${num(basis.importPence, 1)}p per kWh`],
      ['Export payment (Smart Export Guarantee)', `${num(basis.exportPence, 1)}p per kWh`],
      ['Energy price rise', `${pct(INFLATION)} a year`],
      ['Panel output decline', `${num(DEGRADATION * 100, 1)}% a year`],
      ['Region', basis.regionName],
    ],
    x,
    y,
    w,
    160,
  );
}
