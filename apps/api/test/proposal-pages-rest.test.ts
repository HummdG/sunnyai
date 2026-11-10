import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { calc25YearSavings, DEFAULT_ASSUMPTIONS } from '@sunny/quote-engine';
import { describe, expect, it } from 'vitest';

import { MCS_DISCLAIMER } from '../src/proposal/copy.js';
import { themeFor } from '../src/proposal/layout.js';
import {
  captionFor,
  drawRoofPlan,
  facing,
  fitDrawing,
  northArrow,
  shapesFor,
  viewFor,
} from '../src/proposal/plan-drawing.js';
import { drawPerformance, PERFORMANCE_HAS_RAIL } from '../src/proposal/pages/performance.js';
import { cumulativeChart, drawSavings, SAVINGS_HAS_RAIL } from '../src/proposal/pages/savings.js';
import { drawSystem, equipment, SYSTEM_HAS_RAIL } from '../src/proposal/pages/system.js';
import { roofPlanFor } from '../src/proposal/roof-plan.js';
import { docFor, option, outOfBounds, quote, render } from './proposal-fixtures.js';
import { pdfItems, pdfText } from './pdf-text.js';
import { HIP_SPEC, L_SPEC, SEMI_SPEC } from './roof-fixtures.js';

const THEME = themeFor('#0f2a3d');
const text = async (buf: Buffer) => (await pdfText(buf)).join(' ');

/** The verbatim MCS wording from today's renderer. */
const MCS_TEXT =
  'The performance of a solar PV system cannot be predicted with certainty: sunlight varies ' +
  'from place to place and year to year. This estimate follows the MCS method and is ' +
  'guidance only, not a guarantee. Orientation, inclination and shading are estimated ' +
  'from a 3D model of your roof and what you told us; actual performance may be higher or ' +
  'lower once they are confirmed at survey.';

const others = [
  option({
    id: 'starter',
    label: 'Starter',
    isRecommended: false,
    panelCount: 6,
    systemKwp: 2.76,
    batteryType: null,
    batteryCapacityKwh: 0,
    priceGbp: 6150,
    annualGenerationKwh: 2246.2,
    annualSavingsGbp: 512,
    paybackYears: 12.0,
  }),
  option({
    id: 'premium',
    label: 'Premium',
    isRecommended: false,
    panelCount: 14,
    systemKwp: 6.44,
    batteryCapacityKwh: 15.36,
    priceGbp: 17890,
    annualGenerationKwh: 5240.8,
    annualSavingsGbp: 1210,
    paybackYears: null,
  }),
];

const plan = () =>
  roofPlanFor(
    JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'assets', 'sample', 'house.spec.json'), 'utf8'),
    ) as unknown,
    { panelCount: 10, reliable: true, sample: true },
  );

describe('system page', () => {
  const system = (d = docFor(), othersHere = true) =>
    render((pdf) => drawSystem(pdf, d, THEME, { othersHere }));

  it('lists the equipment with warranties from the catalogue', async () => {
    const t = await text(
      await system(docFor({ warranties: { 'PNL-REA460': 25, 'BAT-EVO10': 10, 'EV-7KW': 3 } })),
    );
    expect(t).toContain('Your system');
    expect(t).toContain('PANELS');
    expect(t).toContain('10 × REA 460 W bifacial');
    expect(t).toContain('INVERTER');
    expect(t).toContain('Fox ESS H3 8 kW hybrid');
    expect(t).toContain('BATTERY');
    expect(t).toContain('Fox ESS EVO');
    expect(t).toContain('7 kW EV charger');
    expect(t).toContain('25-year warranty');
    expect(t).toContain('10-year warranty');
    expect(t).toContain('3-year warranty');
    // Services are not equipment.
    expect(t).not.toContain('Administration');
    // A reason from the conversation sits with its item.
    expect(t).toContain('You told us you drive an electric car.');
  });

  it('prints no warranty when the catalogue has none', async () => {
    expect(await text(await system())).not.toContain('warranty');
  });

  it('shows the roof facts and the roof plan, marked Sample', async () => {
    const p = plan();
    expect(p).not.toBeNull();
    const buf = await system(docFor({ roofPlan: p }));
    const t = await text(buf);
    expect(t).toContain('Best-facing roof');
    expect(t).toContain('About 36°');
    expect(t).toContain('Up to 14');
    expect(t).toContain('20 FORTHLIN ROAD · SOUTH ROOF · 42° · 10 PANELS · SAMPLE');
    const rotated = (await pdfItems(buf))
      .flat()
      .filter((i) => i.str.trim() !== '')
      .filter(
        (i) =>
          !(
            Math.abs(i.transform[1]!) < 1e-6 &&
            Math.abs(i.transform[2]!) < 1e-6 &&
            i.transform[0]! > 0
          ),
      )
      .map((i) => i.str);
    expect(rotated).toEqual([]);
  });

  it('compares the other options from their stored figures', async () => {
    const t = await text(await system(docFor({ others })));
    expect(t).toContain('Other options we looked at');
    expect(t).toContain('Starter');
    expect(t).toContain('2.76 kWp');
    expect(t).toContain('£6,150');
    expect(t).toContain('2,246 kWh');
    expect(t).toContain('£512');
    expect(t).toContain('12 years');
    expect(t).toContain('Premium');
    expect(t).toContain('15.4 kWh');
    expect(t).toContain('£17,890');
  });

  it('sets the comparison table with no two words overlapping', async () => {
    const pages = await pdfItems(await system(docFor({ others })));
    const page = pages.find((p) => p.some((i) => i.str === 'Other options we looked at'))!;
    expect(page).toBeDefined();
    const headY = page.find((i) => i.str === 'Other options we looked at')!.y;
    const table = page.filter((i) => i.str.trim() !== '' && i.y < headY);
    expect(table.map((i) => i.str).join(' ')).toContain('A YEAR');
    const clash: string[] = [];
    table.forEach((a, i) => {
      for (const b of table.slice(i + 1)) {
        const xs = a.x < b.x + b.width && b.x < a.x + a.width;
        const ys = a.y < b.y + b.height && b.y < a.y + a.height;
        if (xs && ys) clash.push(`"${a.str}" / "${b.str}"`);
      }
    });
    expect(clash).toEqual([]);
    // Every header line (6.8pt labels) sits clear above the first row's cells.
    const heads = table.filter((i) => i.height < 7);
    const cells = table.filter((i) => i.height >= 7);
    const lowestHead = Math.min(...heads.map((i) => i.y));
    const highestCell = Math.max(...cells.map((i) => i.y + i.height));
    expect(lowestHead - highestCell).toBeGreaterThanOrEqual(3);
  });

  it('matches equipment to the option by name before guessing from the label', () => {
    const d = docFor(
      { warranties: { BAT: 10, INV: 5, EVI: 3 } },
      quote(
        {},
        {
          lineItems: [
            { sku: 'BAT', label: 'Fox ESS EVO battery, inverter-ready', quantity: 1, totalGbp: 1 },
            { sku: 'INV', label: 'Fox ESS H3 8 kW hybrid', quantity: 1, totalGbp: 1 },
            { sku: 'EVI', label: 'EV charger installation', quantity: 1, totalGbp: 1 },
            { sku: 'INST', label: 'Installation', quantity: 1, totalGbp: 1 },
          ],
        },
      ),
    );
    const list = equipment(d);
    const by = (kind: string) => list.find((e) => e.kind === kind);
    expect(by('Inverter')?.warrantyYears).toBe(5);
    expect(by('Battery')?.warrantyYears).toBe(10);
    expect(by('Charger')).toMatchObject({ name: 'EV charger installation', warrantyYears: 3 });
    expect(list.map((e) => e.name)).not.toContain('Installation');
  });

  it('leaves the comparison out when it is shown elsewhere', async () => {
    const t = await text(await system(docFor({ others }), false));
    expect(t).not.toContain('Other options we looked at');
  });

  it('keeps everything inside the page, with a plan and options', async () => {
    const buf = await system(
      docFor({ roofPlan: plan(), others, warranties: { 'PNL-REA460': 25 } }),
    );
    expect(outOfBounds(await pdfItems(buf))).toEqual([]);
    expect(SYSTEM_HAS_RAIL).toBe(false);
  });
});

describe('the house drawing', () => {
  const BOX = { x: 40, y: 80, w: 300, h: 210 };

  it('looks at the panelled face from its side, from above, turned off square', () => {
    const p = plan()!;
    const view = viewFor(p);
    const main = p.faces.find((f) => f.id === p.mainFace.id)!;
    expect(facing(view, main.normal)).toBe(true);
    // from above, and neither square on nor side on
    expect(view.toward[2]).toBeGreaterThan(0.4);
    const off = Math.abs(((view.bearingDeg - p.mainFace.azimuthDeg + 540) % 360) - 180);
    expect(off).toBeGreaterThanOrEqual(25);
    expect(off).toBeLessThanOrEqual(45);
    // the shapes include every panel and the main face
    const shapes = shapesFor(p, view, THEME);
    expect(shapes.filter((s) => s.cells)).toHaveLength(p.panels.length);
    expect(shapes.some((s) => s.pts === main.outline)).toBe(true);
  });

  it('fits everything, every panel included, inside the box above the caption', () => {
    for (const p of [
      plan()!,
      roofPlanFor(HIP_SPEC, { panelCount: 4, reliable: true })!,
      roofPlanFor(L_SPEC, { panelCount: 4, reliable: true })!,
    ]) {
      const fit = fitDrawing(p, BOX, THEME, 16)!;
      expect(fit).not.toBeNull();
      const inside = ([x, y]: [number, number]) =>
        x >= BOX.x && x <= BOX.x + BOX.w && y >= BOX.y && y <= BOX.y + BOX.h - 16;
      for (const panel of p.panels)
        for (const c of panel.corners) expect(inside(fit.at(c))).toBe(true);
      for (const s of fit.shapes) for (const q of s.pts) expect(inside(fit.at(q))).toBe(true);
      expect(inside([fit.north.cx, fit.north.cy])).toBe(true);
    }
  });

  it('draws terraced neighbours first, light and fading out, their cut ends not drawn', () => {
    for (const p of [plan()!, roofPlanFor(SEMI_SPEC, { panelCount: 10, reliable: true })!]) {
      const shapes = shapesFor(p, viewFor(p), THEME);
      const nbPolys = p.neighbours.flatMap((nb) => [...nb.walls, ...nb.roofs]).map((q) => q.pts);
      const isNb = (s: (typeof shapes)[number]) => nbPolys.includes(s.pts);
      const firstHouse = shapes.findIndex((s) => !isNb(s));
      const nbShapes = shapes.filter(isNb);
      expect(nbShapes.length).toBeGreaterThan(0);
      expect(shapes.slice(0, firstHouse)).toEqual(nbShapes);
      for (const s of nbShapes) {
        expect(s.width).toBeLessThan(0.5);
        expect(s.stroke).not.toBe(THEME.ink);
      }
      // the roof slopes each fade out along the row
      for (const r of p.neighbours.flatMap((nb) => nb.roofs)) {
        const s = shapes.find((x) => x.pts === r.pts);
        if (s) expect(s.fade).toBeDefined();
      }
      for (const nb of p.neighbours) {
        if (nb.cut) expect(shapes.some((s) => s.pts === nb.cut!.pts)).toBe(false);
      }
      // the house's own slopes are outlined in full ink
      for (const f of p.faces) {
        const s = shapes.find((x) => x.pts === f.outline);
        if (s) expect([s.stroke, s.width]).toEqual([THEME.ink, 0.8]);
      }
    }
  });

  it('points a compass needle north, inside the box, with its N', async () => {
    const cases = [
      plan()!,
      roofPlanFor(SEMI_SPEC, { panelCount: 10, reliable: true })!,
      roofPlanFor(HIP_SPEC, { panelCount: 4, reliable: true })!,
      roofPlanFor(L_SPEC, { panelCount: 4, reliable: true })!,
    ];
    const capTop = BOX.y + BOX.h - 16;
    await render((pdf) => {
      for (const p of cases) {
        const fit = fitDrawing(p, BOX, THEME, 16)!;
        const { needle, label: n } = northArrow(pdf, fit, BOX, capTop);
        const inside = ([x, y]: [number, number]) =>
          x >= BOX.x && x <= BOX.x + BOX.w && y >= BOX.y && y <= capTop;
        for (const q of needle) expect(inside(q)).toBe(true);
        expect(inside([n.x, n.y])).toBe(true);
        expect(inside([n.x + n.w, n.y])).toBe(true);
        // tip to tail along north as the drawing projects it (page y runs down)
        const [tip, , tail] = needle;
        const d = [tip[0] - tail[0], tip[1] - tail[1]];
        const north = [
          fit.at([0, 1, 0])[0] - fit.at([0, 0, 0])[0],
          fit.at([0, 1, 0])[1] - fit.at([0, 0, 0])[1],
        ];
        const cos =
          (d[0]! * north[0]! + d[1]! * north[1]!) /
          Math.hypot(d[0]!, d[1]!) /
          Math.hypot(north[0]!, north[1]!);
        expect(cos).toBeGreaterThan(0.999);
        // a needle, not a squashed ring: long and slim
        expect(Math.hypot(d[0]!, d[1]!)).toBeGreaterThan(10);
      }
    });
  });

  it('captions the drawing level, and says flat for a flat roof', async () => {
    const buf = await render((pdf) => drawRoofPlan(pdf, plan()!, BOX, THEME));
    expect(await text(buf)).toContain('20 FORTHLIN ROAD · SOUTH ROOF · 42° · 10 PANELS · SAMPLE');
    for (const item of (await pdfItems(buf)).flat().filter((i) => i.str.trim() !== '')) {
      expect([item.str, item.transform[1], item.transform[2]]).toEqual([item.str, 0, 0]);
    }
    const flat = {
      ...plan()!,
      mainFacing: 'Flat',
      mainFace: { id: 0, pitchDeg: 0, azimuthDeg: NaN },
    };
    expect(captionFor(flat)).toBe('20 Forthlin Road · Flat roof · 10 panels · Sample');
  });

  it('draws a hipped roof and an L-shaped house', async () => {
    for (const spec of [HIP_SPEC, L_SPEC]) {
      const p = roofPlanFor(spec, { panelCount: 4, reliable: true })!;
      const t = await text(await render((pdf) => drawRoofPlan(pdf, p, BOX, THEME)));
      expect(t).toContain('SOUTH ROOF · 35° · 4 PANELS');
    }
  });

  it('leaves a box too small for a drawing at its caption', async () => {
    const t = await text(
      await render((pdf) => drawRoofPlan(pdf, plan()!, { x: 40, y: 80, w: 90, h: 40 }, THEME)),
    );
    expect(t).toContain('SOUTH ROOF');
  });
});

describe('performance page', () => {
  const performance = (d = docFor()) => render((pdf) => drawPerformance(pdf, d, THEME));

  it('keeps the MCS wording verbatim', async () => {
    expect(MCS_DISCLAIMER).toBe(MCS_TEXT);
    const t = await text(await performance());
    expect(t).toContain(MCS_TEXT);
  });

  it('shows the monthly chart and the MCS data and calculation', async () => {
    const t = await text(await performance());
    expect(t).toContain('Estimated generation by month (kWh)');
    for (const m of ['Jan', 'Jun', 'Dec']) expect(t).toContain(m);
    expect(t).toContain('A. Installation data');
    expect(t).toContain('Installed capacity of the PV system');
    expect(t).toContain('4.6 kWp');
    expect(t).toContain('0° from south');
    expect(t).toContain('36° from horizontal');
    expect(t).toContain('2: East England');
    expect(t).toContain('B. Performance calculation');
    expect(t).toContain('900 kWh/kWp');
    expect(t).toContain('Shade factor (SF)');
    expect(t).toContain('1.000');
    expect(t).toContain('3,743 kWh');
    expect(t).toContain('C. Estimated self-consumption (with battery)');
    expect(t).toContain('2,695 kWh (72%)');
    expect(t).toContain('Battery storage');
  });

  it('keeps everything inside the page', async () => {
    expect(outOfBounds(await pdfItems(await performance()))).toEqual([]);
    expect(PERFORMANCE_HAS_RAIL).toBe(false);
  });
});

describe('savings page', () => {
  const savings = (d = docFor()) => render((pdf) => drawSavings(pdf, d, THEME));
  const years = calc25YearSavings(
    3743.4,
    0.72,
    24.5,
    15,
    13277,
    DEFAULT_ASSUMPTIONS.energyInflationRate ?? 0.03,
    DEFAULT_ASSUMPTIONS.panelDegradationPerYear ?? 0.005,
  );

  it('formats the negative start as -£ and the 25-year figures', async () => {
    const first = Math.round(years[0]!.cumulative);
    expect(first).toBeLessThan(0);
    const t = await text(await savings());
    expect(t).toContain(`-£${Math.abs(first).toLocaleString('en-GB')}`);
    expect(t).not.toContain('£-');
    expect(t).toContain('YEAR-ONE SAVING');
    expect(t).toContain('£929');
    const lifetime = Math.round(years.reduce((s, y) => s + y.saving, 0));
    expect(t).toContain(`£${lifetime.toLocaleString('en-GB')}`);
    expect(t).toContain('Payback in about 11.2 years.');
    expect(t).toContain('Environmental benefits');
    expect(t).toContain('0.78 t');
    expect(t).toContain('Assumptions');
    expect(t).toContain('24.5p per kWh');
    expect(t).toContain('3% a year');
  });

  it('draws the chart labels clear of the bars and the axis', () => {
    const chart = cumulativeChart(
      years.map((y) => y.cumulative),
      { x: 40, y: 300, w: 515, h: 170 },
      (s) => s.length * 4.2,
    );
    expect(chart.labels.map((l) => l.text)).toContain(
      `-£${Math.abs(Math.round(years[0]!.cumulative)).toLocaleString('en-GB')}`,
    );
    const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const l of chart.labels) {
      for (const b of chart.bars) expect(hit(l, b), l.text).toBe(false);
      expect(l.y > chart.zeroY || l.y + l.h < chart.zeroY, `${l.text} crosses the axis`).toBe(true);
      expect(l.x).toBeGreaterThanOrEqual(40);
      expect(l.x + l.w).toBeLessThanOrEqual(555);
    }
  });

  it('says the installer will confirm the payback on an unpriced quote', async () => {
    const unpriced = quote({ priced: false, pricing: null }, { priceGbp: null, lineItems: [] });
    const t = await text(await savings(docFor({}, unpriced)));
    expect(t).toContain(
      'Your installer will confirm the price, and so the payback, after a survey.',
    );
    expect(t).not.toContain('£-');
  });

  const UNPRICED_SENTENCE =
    'Your installer will confirm the price, and so the payback, after a survey.';

  it('gives no 25-year figures when the quote is not priced, even with a price', async () => {
    const t = await text(await savings(docFor({}, quote({ priced: false }))));
    expect(t).toContain(UNPRICED_SENTENCE);
    expect(t).not.toContain('Net savings over 25 years');
    expect(t).not.toContain('Cumulative savings');
  });

  it('gives no 25-year figures while the installer still prices an item', async () => {
    const t = await text(
      await savings(docFor({}, quote({}, { installerPriced: ['Scaffolding'] }))),
    );
    expect(t).toContain(UNPRICED_SENTENCE);
    expect(t).not.toContain('Net savings over 25 years');
  });

  it('says the net figure is after the price before VAT when VAT is added', async () => {
    const vat = await text(await savings(docFor({}, quote({}, { priceIncVatGbp: 15932.4 }))));
    expect(vat).toContain('after the system price before VAT');
    const noVat = await text(await savings());
    expect(noVat).toContain('after the system price');
    expect(noVat).not.toContain('before VAT');
  });

  it('keeps everything inside the page', async () => {
    expect(outOfBounds(await pdfItems(await savings()))).toEqual([]);
    expect(SAVINGS_HAS_RAIL).toBe(false);
  });

  it('writes no em dash in our copy', async () => {
    const all = [
      await text(await savings()),
      await text(await render((pdf) => drawPerformance(pdf, docFor(), THEME))),
      await text(
        await render((pdf) =>
          drawSystem(pdf, docFor({ roofPlan: plan(), others }), THEME, { othersHere: true }),
        ),
      ),
    ].join(' ');
    expect(all).not.toContain('—');
  });
});
