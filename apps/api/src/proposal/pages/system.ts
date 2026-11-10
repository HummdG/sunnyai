/**
 * Your system: one entry per main component (panels, inverter, battery, and
 * other equipment on the quote) with its warranty where the catalogue carries
 * one and the stored reason it is there; the roof facts beside the real roof
 * plan; and, when it belongs here, "Other options we looked at" from the
 * quote's other stored options. Full width, no rail.
 */

import { num, systemLine } from '../copy.js';
import type { ProposalDoc } from '../doc.js';
import { CONTENT, label, type Theme } from '../layout.js';
import { drawRoofPlan } from '../plan-drawing.js';

import type { QuoteLineItem } from '../../journey/quote.js';

import {
  FULL_W,
  FULL_X,
  keyValues,
  keyValuesHeight,
  measure,
  pageTitle,
  para,
  plainPage,
  rule,
  subHead,
} from './parts.js';
import { drawOthers } from './others.js';

type Pdf = PDFKit.PDFDocument;

/** System pages have no rail: stamp them with `footer(..., { hasRail: false })`. */
export const SYSTEM_HAS_RAIL = false;

interface Entry {
  kind: string;
  name: string;
  detail: string | null;
  reason: string | null;
  warrantyYears: number | null;
}

/** Fees and works, not equipment: left off the equipment list. */
const SERVICE =
  /scaffold|admin|\bdno\b|labou?r|survey|delivery|commission|certific|notification|\bfee\b|waste|travel|building control|\bmcs\b|design|electrical works|\bvat\b/i;
/** Installation is a service unless the line names the equipment installed. */
const INSTALL = /install/i;
const NAMES_EQUIPMENT =
  /charg|batter|inverter|panel|module|optimi[sz]er|diverter|isolator|meter|monitor|mesh|heat pump|kit\b/i;
const PANEL = /\bpanels?\b|\bmodules?\b|\d\s?W\b/;
const INVERTER = /inverter/i;
const BATTERY = /batter(y|ies)/i;
/** An EV charger, not a roof's "tile charge". */
const CHARGER = /\bcharg(er|ers|ing)\b/i;
const PV_SYSTEM = /\bsolar pv system\b/i;

function isService(label: string): boolean {
  return SERVICE.test(label) || (INSTALL.test(label) && !NAMES_EQUIPMENT.test(label));
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The equipment entries, from the option and its line items. */
export function equipment(doc: ProposalDoc): Entry[] {
  const o = doc.option;
  const reasons = doc.quote.reasons ?? {};
  const items = [...o.lineItems];
  const takeWhere = (test: (item: QuoteLineItem) => boolean): QuoteLineItem | null => {
    const i = items.findIndex(test);
    return i < 0 ? null : items.splice(i, 1)[0]!;
  };
  /** The item named exactly like the option's component, then one containing the name. */
  const byName = (name: string | null): QuoteLineItem | null => {
    if (!name) return null;
    const n = norm(name);
    return takeWhere((it) => norm(it.label) === n) ?? takeWhere((it) => norm(it.label).includes(n));
  };
  const byLabel = (found: QuoteLineItem | null, re: RegExp) =>
    found ?? takeWhere((it) => re.test(it.label));
  const warranty = (item: QuoteLineItem | null) =>
    item ? (doc.warranties?.[item.sku] ?? null) : null;
  const reason = (item: QuoteLineItem | null) => (item ? (reasons[item.sku] ?? null) : null);

  const out: Entry[] = [];
  // Names first, for all three, so a label regex never takes another
  // component's line (a battery "inverter-ready" is not the inverter).
  let inverterItem = o.inverterType ? byName(o.inverterType) : null;
  let batteryItem = o.batteryType ? byName(o.batteryType) : null;
  let panelItem = byName(o.panelType);
  if (o.inverterType) inverterItem = byLabel(inverterItem, INVERTER);
  if (o.batteryType) batteryItem = byLabel(batteryItem, BATTERY);
  panelItem = byLabel(panelItem, PANEL);

  out.push({
    kind: 'Panels',
    name: `${o.panelCount} × ${o.panelType ?? 'solar panels'}`,
    detail: `${num(o.systemKwp, 2)} kWp in total`,
    reason: reason(panelItem),
    warrantyYears: warranty(panelItem),
  });
  if (o.inverterType) {
    out.push({
      kind: 'Inverter',
      name: o.inverterType,
      detail: null,
      reason: reason(inverterItem),
      warrantyYears: warranty(inverterItem),
    });
  }
  if (o.batteryType) {
    out.push({
      kind: 'Battery',
      name: o.batteryType,
      detail: o.batteryCapacityKwh > 0 ? `${num(o.batteryCapacityKwh, 1)} kWh of storage` : null,
      reason: reason(batteryItem),
      warrantyYears: warranty(batteryItem),
    });
  }
  for (const item of items) {
    if (isService(item.label)) continue;
    // The PV system line is the panels' base price: the Panels entry already covers it.
    if (panelItem && PV_SYSTEM.test(item.label)) continue;
    out.push({
      kind: CHARGER.test(item.label) ? 'Charger' : 'Also included',
      name: item.quantity > 1 ? `${item.quantity} × ${item.label}` : item.label,
      detail: null,
      reason: reason(item),
      warrantyYears: warranty(item),
    });
  }
  return out;
}

function roofRows(doc: ProposalDoc): [string, string][] {
  const r = doc.roofFacts;
  if (!r) return [];
  return [
    ['Best-facing roof', r.bestFacing ?? 'Not determined'],
    ['Roof pitch', r.pitchDeg !== null ? `About ${Math.round(r.pitchDeg)}°` : '–'],
    ['Usable roof area', r.usableRoofAreaM2 !== null ? `About ${num(r.usableRoofAreaM2)} m²` : '–'],
    [
      'Panels that should fit',
      r.estimatedMaxPanels !== null ? `Up to ${r.estimatedMaxPanels}` : '–',
    ],
    ['Confidence', r.reliable ? (r.label ?? 'Good') : `${r.label ?? 'Low'}, confirmed at survey`],
  ];
}

export function drawSystem(
  pdf: Pdf,
  doc: ProposalDoc,
  theme: Theme,
  opts: { othersHere: boolean },
): void {
  plainPage(pdf);
  const x = FULL_X;
  const w = FULL_W;
  const o = doc.option;
  let y = pageTitle(pdf, theme, `Your system · ${doc.reference}`, 'Your ', 'system');
  y = para(
    pdf,
    `${num(o.systemKwp, 2)} kWp · ${systemLine(doc)} · about ${num(Math.round(o.annualGenerationKwh))} kWh a year`,
    x,
    y + 2,
    { font: 'sans-400', size: 10, color: theme.muted, width: w },
  );

  const ensure = (h: number) => {
    if (y + h <= CONTENT.bottom) return;
    pdf.addPage();
    plainPage(pdf);
    y = label(pdf, `Your system, continued · ${doc.reference}`, x, CONTENT.top, {
      width: w,
      color: theme.muted,
    });
  };

  // ---- equipment
  const kindW = 92;
  const warrW = 110;
  const nameX = x + kindW;
  const nameW = w - kindW - warrW - 10;
  const nameO = { font: 'sans-600', size: 9.4, color: theme.ink, width: nameW };
  const detailO = { font: 'sans-400', size: 8.2, color: theme.muted, width: nameW };
  const reasonO = { font: 'sans-400', size: 7.8, color: theme.accent, width: nameW };
  y = subHead(pdf, theme, 'Equipment', x, y + 20, w);
  for (const e of equipment(doc)) {
    const h =
      measure(pdf, e.name, nameO) +
      (e.detail ? 1 + measure(pdf, e.detail, detailO) : 0) +
      (e.reason ? 2 + measure(pdf, e.reason, reasonO) : 0) +
      13;
    ensure(h);
    const top = y + 6.5;
    label(pdf, e.kind, x, top + 2, { width: kindW - 8, color: theme.muted });
    let at = para(pdf, e.name, nameX, top, nameO);
    if (e.detail) at = para(pdf, e.detail, nameX, at + 1, detailO);
    if (e.reason) para(pdf, e.reason, nameX, at + 2, reasonO);
    if (e.warrantyYears !== null) {
      para(pdf, `${e.warrantyYears}-year warranty`, x + w - warrW, top + 0.5, {
        font: 'sans-400',
        size: 8.6,
        color: theme.ink,
        width: warrW,
        align: 'right',
      });
    }
    y += h;
    rule(pdf, y, theme.rule, 0.5, x, w);
  }

  // ---- the roof
  const facts = roofRows(doc);
  if (facts.length > 0 || doc.roofPlan) {
    const planW = 300;
    const factsX = doc.roofPlan ? x + planW + 22 : x;
    const factsW = doc.roofPlan ? w - planW - 22 : 300;
    const factsH = keyValuesHeight(pdf, facts, factsW, 90) + 26;
    const planH = doc.roofPlan ? 210 : 0;
    ensure(30 + Math.max(planH, factsH));
    y = subHead(pdf, theme, 'Your roof', x, y + 22, w);
    const top = y + 10;
    if (doc.roofPlan) drawRoofPlan(pdf, doc.roofPlan, { x, y: top, w: planW, h: planH }, theme);
    let fy = top - 4;
    if (facts.length > 0) {
      fy = keyValues(pdf, theme, facts, factsX, fy, factsW, 90);
      fy = para(pdf, 'Measured from open 3D and LiDAR data.', factsX, fy + 6, {
        font: 'sans-400',
        size: 7.6,
        color: theme.muted,
        width: factsW,
      });
    }
    y = Math.max(top + planH, fy);
  }

  // ---- other options
  if (opts.othersHere) {
    y = drawOthers(pdf, doc, theme, { x, w, y }, (h, at) => {
      y = at;
      ensure(h);
      return y;
    });
  }
}
