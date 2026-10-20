import { fileURLToPath } from 'node:url';

import { calc25YearSavings, calcMonthlyGenProfile, DEFAULT_ASSUMPTIONS } from '@sunny/quote-engine';
import PDFDocument from 'pdfkit';

import type { QuoteOptionView, QuoteRecord } from '../journey/quote.js';

/**
 * The customer proposal: a PDF of a stored quote, modelled on the installer's
 * own proposal format (a real one -- `Proposal_164_Norwich_Drive.pdf` -- was
 * the reference) and branded as the INSTALLER: their name, colour and contact
 * details. Sunny.ai appears only as a small "Prepared with" line.
 *
 * Every figure comes from the stored quote and the ported SunScan engine; a
 * section we have no data for is left out rather than filled in. The document
 * says plainly, on the first and last pages, that it is indicative and
 * non-binding, subject to a survey.
 */

export interface ProposalRoof {
  bestFacing: string | null;
  pitchDeg: number | null;
  usableRoofAreaM2: number | null;
  estimatedMaxPanels: number | null;
  reliable: boolean;
  label: string | null;
}

export interface ProposalInput {
  quote: QuoteRecord;
  installer: {
    companyName: string;
    /** The installer's brand colour (#rrggbb). */
    colour: string;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  customer: { name: string | null; address: string | null };
  roof: ProposalRoof | null;
  /** When the PDF is generated (shown as "Prepared on"). */
  generatedAt: Date;
}

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
const INK = '#171717';
const MUTED = '#5c5c5c';
const RULE = '#e6e1dc';
const PALE = '#fff6ee';
const PAGE = { width: 595.28, height: 841.89, margin: 48 };
/** The engine's defaults, as the quote used them. */
const INFLATION = DEFAULT_ASSUMPTIONS.energyInflationRate ?? 0.03;
const DEGRADATION = DEFAULT_ASSUMPTIONS.panelDegradationPerYear ?? 0.005;

const gbp = (n: number) =>
  `£${Math.round(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
const num = (n: number, dp = 0) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** A brand colour dark enough to carry text on white (≥ 4.5:1), as the widget does. */
export function textColour(hex: string): string {
  const rgb = /^#([0-9a-f]{6})$/i.exec(hex) ? hex : '#b04e00';
  const channel = (i: number) => parseInt(rgb.slice(1 + i * 2, 3 + i * 2), 16);
  const lum = (r: number, g: number, b: number) => {
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  let [r, g, b] = [channel(0), channel(1), channel(2)];
  for (let i = 0; i < 20 && 1.05 / (lum(r, g, b) + 0.05) < 4.5; i++) {
    r = Math.round(r * 0.9);
    g = Math.round(g * 0.9);
    b = Math.round(b * 0.9);
  }
  const hex2 = (c: number) => c.toString(16).padStart(2, '0');
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** The visitor's chosen package when they picked one, otherwise the recommended option. */
function recommended(quote: QuoteRecord): QuoteOptionView {
  return (
    (quote.chosenOptionId ? quote.options.find((o) => o.id === quote.chosenOptionId) : undefined) ??
    quote.options.find((o) => o.id === quote.recommendedId) ??
    quote.options.find((o) => o.isRecommended) ??
    quote.options[quote.options.length - 1]!
  );
}

function prettyDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Render the proposal; resolves to the PDF bytes. */
export async function renderProposal(input: ProposalInput): Promise<Buffer> {
  const { quote, installer, customer, roof } = input;
  const accent = /^#[0-9a-f]{6}$/i.test(installer.colour) ? installer.colour : '#ff7900';
  const accentText = textColour(accent);
  const best = recommended(quote);
  const chosen = !!quote.chosenOptionId && best.id === quote.chosenOptionId;
  const bestTitle = chosen ? 'Your chosen package' : 'Recommended system';
  const reference = `Q-${quote.id.slice(-8).toUpperCase()}`;
  const forWhom = customer.name ?? customer.address ?? `postcode ${quote.basis.postcode}`;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 92, bottom: 70, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    info: {
      Title: `Solar proposal for ${forWhom}`,
      Author: installer.companyName,
      Creator: 'Sunny.ai',
    },
  });
  doc.registerFont('regular', `${FONT_DIR}PlusJakartaSans-Regular.ttf`);
  doc.registerFont('semibold', `${FONT_DIR}PlusJakartaSans-SemiBold.ttf`);
  doc.registerFont('bold', `${FONT_DIR}PlusJakartaSans-ExtraBold.ttf`);

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = PAGE.margin;
  const width = PAGE.width - PAGE.margin * 2;

  const heading = (text: string) => {
    doc.moveDown(0.6).font('bold').fontSize(20).fillColor(INK).text(text, left, doc.y);
    doc
      .moveTo(left, doc.y + 4)
      .lineTo(left + 48, doc.y + 4)
      .lineWidth(3)
      .strokeColor(accent)
      .stroke();
    doc.moveDown(0.9);
  };
  const subheading = (text: string) => {
    doc.moveDown(0.5).font('semibold').fontSize(12).fillColor(INK).text(text, left, doc.y);
    doc.moveDown(0.3);
  };
  const body = (text: string, options: PDFKit.Mixins.TextOptions = {}) =>
    doc
      .font('regular')
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(text, left, doc.y, { width, lineGap: 2, ...options });

  /** A row of big figures, like the reference's "Recommended System Option". */
  const kpis = (items: Array<[string, string]>) => {
    const y = doc.y;
    const w = width / items.length;
    items.forEach(([value, label], i) => {
      const x = left + i * w;
      doc
        .roundedRect(x + 4, y, w - 8, 72, 10)
        .fillColor(PALE)
        .fill();
      doc
        .font('bold')
        .fontSize(18)
        .fillColor(accentText)
        .text(value, x + 4, y + 14, { width: w - 8, align: 'center' });
      doc
        .font('regular')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(label, x + 10, y + 42, { width: w - 20, align: 'center' });
    });
    doc.y = y + 84;
  };

  /** A two- or more-column table with a shaded header. */
  const table = (
    headers: string[],
    rows: string[][],
    widths: number[],
    align: Array<'left' | 'right'> = [],
  ) => {
    const total = widths.reduce((a, b) => a + b, 0);
    const cols = widths.map((w) => (w / total) * width);
    const draw = (cells: string[], header: boolean) => {
      const heights = cells.map((c, i) =>
        doc
          .font(header ? 'semibold' : 'regular')
          .fontSize(8.5)
          .heightOfString(c, { width: cols[i]! - 12 }),
      );
      const h = Math.max(...heights) + 10;
      if (doc.y + h > PAGE.height - 80) doc.addPage();
      const y = doc.y;
      if (header) doc.rect(left, y, width, h).fillColor(PALE).fill();
      let x = left;
      cells.forEach((c, i) => {
        doc
          .font(header ? 'semibold' : 'regular')
          .fontSize(8.5)
          .fillColor(header ? INK : '#333333')
          .text(c, x + 6, y + 5, { width: cols[i]! - 12, align: align[i] ?? 'left' });
        x += cols[i]!;
      });
      doc
        .moveTo(left, y + h)
        .lineTo(left + width, y + h)
        .lineWidth(0.5)
        .strokeColor(RULE)
        .stroke();
      doc.y = y + h;
    };
    // A label/value table has no header row worth drawing.
    if (headers.some((h) => h !== '')) draw(headers, true);
    for (const r of rows) draw(r, false);
    doc.moveDown(0.6);
  };

  /** A simple bar chart (monthly generation, yearly savings). */
  const bars = (
    labels: string[],
    values: number[],
    opts: { height: number; format: (n: number) => string; colour?: string },
  ) => {
    const top = doc.y + 6;
    const h = opts.height;
    const max = Math.max(...values.map((v) => Math.abs(v)), 1);
    const min = Math.min(0, ...values);
    const span = Math.max(...values, 0) - min || 1;
    const zeroY = top + h * (Math.max(...values, 0) / span);
    const step = width / values.length;
    values.forEach((v, i) => {
      const barH = (Math.abs(v) / span) * h;
      const x = left + i * step + step * 0.18;
      const y = v >= 0 ? zeroY - barH : zeroY;
      doc
        .rect(x, y, step * 0.64, Math.max(barH, 0.5))
        .fillColor(v >= 0 ? (opts.colour ?? accent) : '#c9c2bb')
        .fill();
      const labelY = (v >= 0 ? y : y + barH) - (v >= 0 ? 10 : -2);
      if (values.length <= 12) {
        doc
          .font('regular')
          .fontSize(7)
          .fillColor(MUTED)
          .text(opts.format(v), left + i * step, labelY, { width: step, align: 'center' });
      } else if (i === 0 || i === values.length - 1) {
        // Many bars: label the two ends, in boxes wide enough not to wrap.
        const first = i === 0;
        doc
          .font('semibold')
          .fontSize(7.5)
          .fillColor(INK)
          .text(opts.format(v), first ? left : left + width - 90, labelY, {
            width: 90,
            align: first ? 'left' : 'right',
            lineBreak: false,
          });
      }
      if (labels[i]) {
        doc
          .font('regular')
          .fontSize(7)
          .fillColor(MUTED)
          .text(labels[i], left + i * step, top + h + 4, { width: step, align: 'center' });
      }
    });
    doc
      .moveTo(left, zeroY)
      .lineTo(left + width, zeroY)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.y = top + h + 20;
    void max;
  };

  // ── 1. Cover ──────────────────────────────────────────────────────────────
  {
    const y = doc.y;
    doc.font('semibold').fontSize(9).fillColor(INK).text('Prepared by', left, y);
    doc.font('regular').fontSize(9).fillColor(MUTED);
    doc.text(installer.companyName, left, doc.y);
    for (const line of [installer.phone, installer.email, installer.website]) {
      if (line) doc.text(line, left, doc.y);
    }
    const colX = left + width / 2.6;
    doc.font('semibold').fontSize(9).fillColor(INK).text('For', colX, y);
    doc.font('regular').fontSize(9).fillColor(MUTED);
    if (customer.name) doc.text(customer.name, colX, doc.y);
    doc.text(customer.address ?? `Postcode ${quote.basis.postcode}`, colX, doc.y, {
      width: width / 2.6,
    });
    const refX = left + width * 0.72;
    doc
      .font('semibold')
      .fontSize(9)
      .fillColor(INK)
      .text(`Quote ${reference}`, refX, y, { width: width * 0.28, align: 'right' });
    doc
      .font('regular')
      .fontSize(9)
      .fillColor(MUTED)
      .text(`Prepared on ${prettyDate(input.generatedAt)}`, refX, doc.y, {
        width: width * 0.28,
        align: 'right',
      });
    doc.y = y + 78;

    // The title band, in the installer's colour.
    const bandY = doc.y;
    doc.roundedRect(left, bandY, width, 120, 16).fillColor(accentText).fill();
    doc
      .font('bold')
      .fontSize(26)
      .fillColor('#ffffff')
      .text('Solar Energy System Proposal', left + 24, bandY + 34, { width: width - 48 });
    doc
      .font('regular')
      .fontSize(11)
      .fillColor('#ffffff')
      .text(`For ${forWhom}`, left + 24, bandY + 72, { width: width - 48 });
    doc.y = bandY + 140;

    body(
      `Thank you for asking ${installer.companyName} about solar for your home. This proposal ` +
        'sets out the system we recommend, the alternatives you were shown, what it should ' +
        'generate and save, and the price. It is all based on the details you gave us and a 3D ' +
        'model of your roof. Every figure is an estimate until one of our team has surveyed ' +
        'your property.',
    );
    doc.moveDown(1);

    heading(bestTitle);
    kpis([
      [`${num(best.systemKwp, 2)} kWp`, 'System size'],
      [gbp(best.annualSavingsGbp), 'Estimated yearly bill savings'],
      [best.priceGbp !== null ? gbp(best.priceGbp) : 'On survey', 'System price'],
      [best.paybackYears !== null ? `${num(best.paybackYears, 1)} yrs` : '–', 'Estimated payback'],
    ]);
    body(best.priceLabel, { align: 'center' });

    if (roof) {
      heading('Your roof');
      table(
        ['Measured from open 3D and LiDAR data', ''],
        [
          ['Best-facing roof', roof.bestFacing ?? 'Not determined'],
          ['Roof pitch', roof.pitchDeg !== null ? `About ${Math.round(roof.pitchDeg)}°` : '–'],
          [
            'Usable roof area',
            roof.usableRoofAreaM2 !== null ? `About ${num(roof.usableRoofAreaM2)} m²` : '–',
          ],
          [
            'Panels that should fit',
            roof.estimatedMaxPanels !== null ? `Up to ${roof.estimatedMaxPanels}` : '–',
          ],
          [
            'Confidence',
            roof.reliable ? (roof.label ?? 'Good') : `${roof.label ?? 'Low'}, confirmed at survey`,
          ],
        ],
        [1, 1.4],
      );
    }
  }

  // ── 2. Your solution and the options ─────────────────────────────────────
  doc.addPage();
  heading('Your solution');
  table(
    ['Component', bestTitle],
    [
      [
        'Solar panels',
        `${best.panelCount} × ${best.panelType ?? 'solar panels'}, ${num(best.systemKwp, 2)} kWp in total`,
      ],
      ...(best.inverterType ? [['Inverter', best.inverterType]] : []),
      [
        'Battery',
        best.batteryType
          ? `${best.batteryType}${best.batteryCapacityKwh ? `, ${num(best.batteryCapacityKwh, 1)} kWh` : ''}`
          : 'None in this option',
      ],
      ['Estimated generation', `About ${num(Math.round(best.annualGenerationKwh))} kWh a year`],
      ...(best.inclusions.length > 0 ? [['Included', best.inclusions.join(' · ')]] : []),
    ],
    [1, 2.6],
  );

  heading('Your options');
  body(
    'The three systems you were shown, from the lowest upfront cost to the most ' +
      `self-sufficient. ${chosen ? 'The package you chose' : 'The recommended option'} is marked.`,
  );
  doc.moveDown(0.5);
  table(
    [
      '',
      ...quote.options.map((o) =>
        o.id === best.id && chosen
          ? `${o.label} (your choice)`
          : o.id === best.id && !/recommend/i.test(o.label)
            ? `${o.label} (recommended)`
            : o.label,
      ),
    ],
    [
      ['Panels', ...quote.options.map((o) => `${o.panelCount} · ${num(o.systemKwp, 2)} kWp`)],
      ['Battery', ...quote.options.map((o) => o.batteryType ?? 'None')],
      [
        'Price',
        ...quote.options.map((o) =>
          o.priceGbp !== null ? `${gbp(o.priceGbp)}${o.aboveBudget ? ' *' : ''}` : 'On survey',
        ),
      ],
      [
        'Generation a year',
        ...quote.options.map((o) => `${num(Math.round(o.annualGenerationKwh))} kWh`),
      ],
      ['Self-consumption', ...quote.options.map((o) => pct(o.selfConsumptionRate))],
      ['Savings a year', ...quote.options.map((o) => gbp(o.annualSavingsGbp))],
      [
        'Payback',
        ...quote.options.map((o) =>
          o.paybackYears !== null ? `${num(o.paybackYears, 1)} years` : '–',
        ),
      ],
      ['CO2 saved a year', ...quote.options.map((o) => `${num(o.co2TonnesPerYear, 2)} t`)],
      ...(quote.options.some((o) => o.sentinel)
        ? [
            [
              'With Sentinel optimisation',
              ...quote.options.map((o) =>
                o.sentinel
                  ? `${gbp(o.sentinel.annualSavingsGbp)} a year (+${num(o.sentinel.upliftPercent, o.sentinel.upliftPercent % 1 ? 1 : 0)}%)`
                  : '–',
              ),
            ],
          ]
        : []),
    ],
    [1.3, 1, 1, 1],
  );
  if (quote.options.some((o) => o.aboveBudget)) {
    body('* Above the budget you mentioned.');
  }

  // ── 3. System performance (MCS method) ────────────────────────────────────
  doc.addPage();
  heading('System performance');
  const monthly = calcMonthlyGenProfile(best.annualGenerationKwh);
  subheading('Estimated generation by month (kWh)');
  bars(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monthly,
    {
      height: 120,
      format: (n) => num(n),
    },
  );
  subheading('A. Installation data');
  table(
    ['', ''],
    [
      ['Installed capacity of the PV system', `${num(best.systemKwp, 2)} kWp`],
      ['Orientation of the PV system', `${Math.round(quote.basis.mcsOrientationDeg)}° from south`],
      ['Inclination of the system', `${Math.round(quote.basis.pitchDeg)}° from horizontal`],
      ['Postcode region (MCS zone)', `${quote.basis.mcsZone}: ${quote.basis.regionName}`],
    ],
    [1.6, 1],
  );
  subheading('B. Performance calculation');
  const shadeFactor = 1 - quote.basis.shadingLoss;
  table(
    ['', ''],
    [
      [
        'kWh per kWp from the MCS zone table (Kk)',
        `${num(quote.basis.irradianceKwhPerM2)} kWh/kWp`,
      ],
      ['Shade factor (SF)', num(shadeFactor, 3)],
      [
        'Estimated annual output, after inverter and system losses',
        `${num(Math.round(best.annualGenerationKwh))} kWh`,
      ],
    ],
    [1.6, 1],
  );
  subheading(`C. Estimated self-consumption${best.batteryType ? ' (with battery)' : ''}`);
  const selfKwh = best.annualGenerationKwh * best.selfConsumptionRate;
  table(
    ['', ''],
    [
      ['Assumed annual electricity use', `${num(Math.round(quote.basis.annualKwh))} kWh`],
      ['Estimated annual generation', `${num(Math.round(best.annualGenerationKwh))} kWh`],
      [
        'Expected self-consumption',
        `${num(Math.round(selfKwh))} kWh (${pct(best.selfConsumptionRate)})`,
      ],
      [
        'Grid independence (self-sufficiency)',
        quote.basis.annualKwh > 0 ? pct(Math.min(1, selfKwh / quote.basis.annualKwh)) : '–',
      ],
      ...(best.batteryCapacityKwh
        ? [['Battery storage', `${num(best.batteryCapacityKwh, 1)} kWh`]]
        : []),
    ],
    [1.6, 1],
  );
  body(
    'The performance of a solar PV system cannot be predicted with certainty: sunlight varies ' +
      'from place to place and year to year. This estimate follows the MCS method and is ' +
      'guidance only, not a guarantee. Orientation, inclination and shading are estimated ' +
      'from a 3D model of your roof and what you told us; actual performance may be higher or ' +
      'lower once they are confirmed at survey.',
  );

  // ── 4. Savings, payback and environment ──────────────────────────────────
  doc.addPage();
  heading('Savings and payback');
  const years =
    best.priceGbp !== null
      ? calc25YearSavings(
          best.annualGenerationKwh,
          best.selfConsumptionRate,
          quote.basis.importPence,
          quote.basis.exportPence,
          best.priceGbp,
          INFLATION,
          DEGRADATION,
        )
      : null;
  if (years) {
    const lifetime = years.reduce((sum, y) => sum + y.saving, 0);
    const net = years.at(-1)!.cumulative;
    kpis([
      [gbp(lifetime), 'Bill savings over 25 years'],
      [gbp(best.priceGbp!), 'System price'],
      [gbp(net), 'Estimated net savings'],
    ]);
    subheading('Cumulative savings from going solar (£)');
    bars(
      years.map((y) => (y.year === 1 || y.year % 5 === 0 ? String(y.year) : '')),
      years.map((y) => y.cumulative),
      { height: 130, format: (n) => gbp(n) },
    );
    body(
      `Payback ${best.paybackYears !== null ? `in about ${num(best.paybackYears, 1)} years` : 'not reached within 25 years'}. ` +
        'Estimates do not include replacing equipment outside its warranty.',
    );
  } else {
    body(
      `Estimated bill savings of about ${gbp(best.annualSavingsGbp)} a year. Your installer will ` +
        'confirm the price, and so the payback, after a survey.',
    );
  }

  heading('Environmental benefits');
  kpis([
    [`${num(best.co2TonnesPerYear, 2)} t`, 'CO2 reduced each year'],
    [`${num(best.co2TonnesPerYear * 25, 1)} t`, 'CO2 reduced over 25 years'],
    [
      quote.basis.annualKwh > 0
        ? pct(Math.min(1, best.annualGenerationKwh / quote.basis.annualKwh))
        : '–',
      'Of your yearly use, generated by solar',
    ],
  ]);

  subheading('Assumptions');
  table(
    ['', ''],
    [
      ['Electricity import price', `${num(quote.basis.importPence, 1)}p per kWh`],
      ['Export payment (Smart Export Guarantee)', `${num(quote.basis.exportPence, 1)}p per kWh`],
      ['Energy price rise', `${pct(INFLATION)} a year`],
      ['Panel output decline', `${num(DEGRADATION * 100, 1)}% a year`],
      ['Region', quote.basis.regionName],
    ],
    [1.6, 1],
  );

  // ── 5. Quotation ──────────────────────────────────────────────────────────
  doc.addPage();
  heading('Quotation');
  body(
    `${best.label}: ${best.panelCount} panels, ${num(best.systemKwp, 2)} kWp${best.batteryType ? `, ${best.batteryType}` : ''}.`,
  );
  doc.moveDown(0.5);
  if (best.lineItems.length > 0) {
    table(
      ['Item', 'Qty', 'Price'],
      [
        ...best.lineItems.map((item) => [item.label, String(item.quantity), gbp(item.totalGbp)]),
        ...best.installerPriced.map((label) => [label, '', 'Priced by your installer']),
      ],
      [3, 0.5, 1],
      ['left', 'right', 'right'],
    );
  }
  if (best.priceGbp !== null) {
    const y = doc.y;
    doc.roundedRect(left, y, width, 56, 10).fillColor(PALE).fill();
    doc
      .font('bold')
      .fontSize(16)
      .fillColor(INK)
      .text(`Total system price  ${gbp(best.priceGbp)}`, left + 16, y + 12, { width: width - 32 });
    doc
      .font('regular')
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        best.priceIncVatGbp !== null
          ? `${best.priceLabel}. With VAT: ${gbp(best.priceIncVatGbp)}.`
          : best.priceLabel,
        left + 16,
        y + 34,
        { width: width - 32 },
      );
    doc.y = y + 70;
  } else {
    body('Your installer will price this system after a survey.');
  }
  if (best.sentinel) {
    subheading('Sentinel optimisation (optional)');
    body(
      `With Sentinel, savings could rise by about ${num(best.sentinel.upliftPercent, best.sentinel.upliftPercent % 1 ? 1 : 0)}% to ` +
        `${gbp(best.sentinel.annualSavingsGbp)} a year` +
        (best.sentinel.addedCostGbp >= 1 ? `, for ${gbp(best.sentinel.addedCostGbp)}` : '') +
        '. This is a modelled, indicative figure.',
    );
  }

  subheading('Next steps');
  body(
    `To go ahead, ${installer.companyName} will arrange a survey to confirm your roof, ` +
      'shading and electrics, then send a final, fixed quotation.' +
      (installer.phone || installer.email
        ? ` Contact us on ${[installer.phone, installer.email].filter(Boolean).join(' or ')}.`
        : ''),
  );
  subheading('Important');
  body(
    `${quote.disclaimer} This proposal is not a contract or a binding offer; the final price ` +
      'is confirmed after an on-site structural and shading survey.',
  );

  // ── header and footer on every page ──────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('bold')
      .fontSize(15)
      .fillColor(accentText)
      .text(installer.companyName, left, 36, { width: width * 0.6, lineBreak: false });
    doc
      .font('regular')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(`Solar proposal · ${reference}`, left + width * 0.6, 40, {
        width: width * 0.4,
        align: 'right',
        lineBreak: false,
      });
    doc
      .moveTo(left, 62)
      .lineTo(left + width, 62)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    const footY = PAGE.height - 42;
    doc
      .moveTo(left, footY - 8)
      .lineTo(left + width, footY - 8)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc
      .font('regular')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        [installer.companyName, installer.phone, installer.email].filter(Boolean).join(' · '),
        left,
        footY,
        { width: width * 0.6, lineBreak: false },
      );
    doc.text(
      `Page ${i - range.start + 1} of ${range.count} · Prepared with Sunny.ai`,
      left + width * 0.5,
      footY,
      { width: width * 0.5, align: 'right', lineBreak: false },
    );
    doc.page.margins.bottom = saved;
  }

  doc.end();
  return done;
}
