/**
 * System performance (MCS method): the estimated generation month by month,
 * then the MCS installation data, performance calculation and estimated
 * self-consumption, with the MCS-required wording kept verbatim. Every figure
 * is the stored quote's (its basis and the option), as in the original
 * proposal. Full width, no rail.
 */

import { calcMonthlyGenProfile } from '@sunny/quote-engine';

import { MCS_DISCLAIMER, num } from '../copy.js';
import type { ProposalDoc } from '../doc.js';
import type { Rect, Theme } from '../layout.js';

import { FULL_W, FULL_X, keyValues, pageTitle, para, plainPage, rule, subHead } from './parts.js';

type Pdf = PDFKit.PDFDocument;

/** Performance pages have no rail: stamp them with `footer(..., { hasRail: false })`. */
export const PERFORMANCE_HAS_RAIL = false;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** The MCS tables, from the quote's basis and the option, worded as the original proposal. */
export function mcsRows(doc: ProposalDoc): {
  installation: [string, string][];
  calculation: [string, string][];
  selfConsumptionTitle: string;
  selfConsumption: [string, string][];
} {
  const { basis } = doc.quote;
  const o = doc.option;
  const selfKwh = o.annualGenerationKwh * o.selfConsumptionRate;
  return {
    installation: [
      ['Installed capacity of the PV system', `${num(o.systemKwp, 2)} kWp`],
      ['Orientation of the PV system', `${Math.round(basis.mcsOrientationDeg)}° from south`],
      ['Inclination of the system', `${Math.round(basis.pitchDeg)}° from horizontal`],
      ['Postcode region (MCS zone)', `${basis.mcsZone}: ${basis.regionName}`],
    ],
    calculation: [
      ['kWh per kWp from the MCS zone table (Kk)', `${num(basis.irradianceKwhPerM2)} kWh/kWp`],
      [
        'Shade factor (SF)',
        (1 - basis.shadingLoss).toLocaleString('en-GB', {
          minimumFractionDigits: 3,
          maximumFractionDigits: 3,
        }),
      ],
      [
        'Estimated annual output, after inverter and system losses',
        `${num(Math.round(o.annualGenerationKwh))} kWh`,
      ],
    ],
    selfConsumptionTitle: `C. Estimated self-consumption${o.batteryType ? ' (with battery)' : ''}`,
    selfConsumption: [
      ['Assumed annual electricity use', `${num(Math.round(basis.annualKwh))} kWh`],
      ['Estimated annual generation', `${num(Math.round(o.annualGenerationKwh))} kWh`],
      [
        'Expected self-consumption',
        `${num(Math.round(selfKwh))} kWh (${pct(o.selfConsumptionRate)})`,
      ],
      [
        'Grid independence (self-sufficiency)',
        basis.annualKwh > 0 ? pct(Math.min(1, selfKwh / basis.annualKwh)) : '–',
      ],
      ...(o.batteryCapacityKwh
        ? ([['Battery storage', `${num(o.batteryCapacityKwh, 1)} kWh`]] as [string, string][])
        : []),
    ],
  };
}

/** Twelve bars on a baseline, each with its figure above and its month below. */
function monthlyChart(pdf: Pdf, theme: Theme, values: number[], box: Rect): void {
  const top = box.y + 12;
  const base = box.y + box.h - 14;
  const max = Math.max(...values, 1);
  const step = box.w / values.length;
  values.forEach((v, i) => {
    const h = (v / max) * (base - top);
    const bx = box.x + i * step + step * 0.22;
    pdf
      .save()
      .rect(bx, base - h, step * 0.56, Math.max(h, 0.5))
      .fill(theme.accent)
      .restore();
    pdf
      .font('sans-400')
      .fontSize(6.8)
      .fillColor(theme.muted)
      .text(num(Math.round(v)), box.x + i * step, base - h - 9, {
        width: step,
        align: 'center',
        lineBreak: false,
      });
    pdf
      .font('sans-400')
      .fontSize(7)
      .fillColor(theme.muted)
      .text(MONTHS[i] ?? '', box.x + i * step, base + 4, {
        width: step,
        align: 'center',
        lineBreak: false,
      });
  });
  rule(pdf, base, theme.ink, 0.6, box.x, box.w);
}

export function drawPerformance(pdf: Pdf, doc: ProposalDoc, theme: Theme): void {
  plainPage(pdf);
  const x = FULL_X;
  const w = FULL_W;
  let y = pageTitle(
    pdf,
    theme,
    `Performance · MCS method · ${doc.reference}`,
    'System ',
    'performance',
  );

  y = subHead(pdf, theme, 'Estimated generation by month (kWh)', x, y + 16, w);
  const chartH = 200;
  monthlyChart(pdf, theme, calcMonthlyGenProfile(doc.option.annualGenerationKwh), {
    x,
    y: y + 8,
    w,
    h: chartH,
  });
  y += 8 + chartH;

  const rows = mcsRows(doc);
  const gap = 28;
  const cw = (w - gap) / 2;
  const rx = x + cw + gap;
  const valueW = 100;

  const row1 = y + 30;
  const a = keyValues(
    pdf,
    theme,
    rows.installation,
    x,
    subHead(pdf, theme, 'A. Installation data', x, row1, cw),
    cw,
    valueW,
  );
  const b = keyValues(
    pdf,
    theme,
    rows.calculation,
    rx,
    subHead(pdf, theme, 'B. Performance calculation', rx, row1, cw),
    cw,
    valueW,
  );

  const row2 = Math.max(a, b) + 30;
  keyValues(
    pdf,
    theme,
    rows.selfConsumption,
    x,
    subHead(pdf, theme, rows.selfConsumptionTitle, x, row2, cw),
    cw,
    valueW,
  );
  const about = subHead(pdf, theme, 'About these figures', rx, row2, cw);
  para(pdf, MCS_DISCLAIMER, rx, about + 7, {
    font: 'sans-400',
    size: 8.4,
    color: theme.ink,
    width: cw,
    lineGap: 2,
  });
}
