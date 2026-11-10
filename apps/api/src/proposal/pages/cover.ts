/**
 * Page 1, the cover (always on): the dark rail with the key figures and the
 * short estimate notice; the main column with the date line, the system in
 * plain words, the real roof plan when there is one, and the letter.
 */

import {
  ESTIMATE,
  gbp,
  headline,
  letterParagraphs,
  longDate,
  money,
  num,
  signOff,
  systemLine,
} from '../copy.js';
import type { ProposalBase, ProposalDoc } from '../doc.js';
import { CONTENT, label, type Theme } from '../layout.js';
import { drawRoofPlan } from '../plan-drawing.js';
import type { RoofPlan } from '../roof-plan.js';

import { MAIN_W, MAIN_X, measure, para, railBrand, railItem, railPage } from './parts.js';

type Pdf = PDFKit.PDFDocument;

const LETTER = { font: 'sans-400', size: 9.2, lineGap: 2.2 } as const;
const PARA_GAP = 6;

/** A figure block for the rail: its key and what `railItem` sets under it. */
export interface RailFigure {
  key: string;
  parts: { big?: string; lines?: string[]; strong?: string[]; maxLines?: number };
}

/**
 * What the cover says, for any kind of quote: the date line, the headline,
 * the roof plan when there is one, the letter and sign-off, and the rail's
 * figures (between "Prepared for" and the estimated total).
 */
export interface CoverContent {
  dateLine: string;
  headline: { kicker: string; light: string; bold: string };
  roofPlan: RoofPlan | null;
  paragraphs: string[];
  signOff: string[];
  /** "Prepared for" falls back to this postcode with no name or address. */
  postcode: string;
  figures: RailFigure[];
  total: RailFigure['parts'];
}

export function drawCover(pdf: Pdf, doc: ProposalDoc, theme: Theme): void {
  const o = doc.option;
  const m = money(doc);
  drawCoverWith(pdf, doc, theme, {
    dateLine: `Estimate · ${longDate(new Date(doc.quote.createdAt))}`,
    headline: headline(doc),
    roofPlan: doc.roofPlan,
    paragraphs: letterParagraphs(doc),
    signOff: signOff(doc),
    postcode: doc.quote.basis.postcode,
    figures: [
      {
        key: doc.chosen ? 'Your choice' : 'Recommended',
        parts: { big: `${num(o.systemKwp, 2)} kWp`, lines: [systemLine(doc)] },
      },
      {
        key: 'Generation',
        parts: { big: num(Math.round(o.annualGenerationKwh)), lines: ['kWh a year'] },
      },
      { key: 'Year-one saving', parts: { big: gbp(o.annualSavingsGbp) } },
    ],
    total: m
      ? { big: gbp(m.total!), lines: [m.vatNote] }
      : { lines: ['To be priced by your installer after a survey'] },
  });
}

/** Draws a cover from its content: the solar cover and the heat pump cover alike. */
export function drawCoverWith(
  pdf: Pdf,
  doc: ProposalBase,
  theme: Theme,
  content: CoverContent,
): void {
  const col = railPage(pdf, theme);
  drawRail(pdf, doc, theme, col, content);

  // ---- main column
  const x = MAIN_X;
  const w = MAIN_W;
  let y = label(pdf, content.dateLine, x, CONTENT.top, {
    width: w,
    color: theme.muted,
  });
  const h = content.headline;
  y = para(pdf, h.kicker, x, y + 14, { font: 'sans-600', size: 10, color: theme.accent, width: w });
  if (h.light) {
    y = para(pdf, h.light, x, y + 4, { font: 'sans-300', size: 26, color: theme.ink, width: w });
    y -= 6;
  }
  y = para(pdf, h.bold, x, y + 4, { font: 'sans-800', size: 26, color: theme.ink, width: w });

  const paragraphs = content.paragraphs;
  const sign = content.signOff;
  const body = { ...LETTER, color: theme.ink, width: w };
  const letterH =
    paragraphs.reduce((sum, p) => sum + measure(pdf, p, body) + PARA_GAP, 0) +
    8 +
    sign.reduce((sum, l) => sum + measure(pdf, l, { ...body, size: 8.6 }) + 1, 0);

  // The plan takes the room the letter leaves, up to a comfortable size.
  y += 18;
  const room = CONTENT.bottom - y - letterH - 22;
  const planH = Math.min(300, room);
  if (content.roofPlan && planH >= 130) {
    drawRoofPlan(pdf, content.roofPlan, { x, y, w, h: planH }, theme);
    y += planH + 22;
  }

  for (const p of paragraphs) y = para(pdf, p, x, y, body) + PARA_GAP;
  y += 8;
  sign.forEach((line, i) => {
    y =
      para(pdf, line, x, y, {
        ...body,
        font: i === 0 ? 'sans-600' : 'sans-400',
        size: i === 0 ? 9.2 : 8.6,
        color: i === 0 ? theme.ink : theme.muted,
      }) + 1;
  });
}

function drawRail(
  pdf: Pdf,
  doc: ProposalBase,
  theme: Theme,
  col: { x: number; width: number },
  content: CoverContent,
): void {
  let y = railBrand(pdf, doc, theme, col) + 6;

  const address = (doc.customer.address ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const forWhom = doc.customer.name?.trim() || null;
  y = railItem(pdf, theme, col, y, 'Prepared for', {
    strong: forWhom ? [forWhom] : address.length ? [] : [`Postcode ${content.postcode}`],
    lines: address,
    maxLines: 3,
  });
  for (const f of content.figures) y = railItem(pdf, theme, col, y, f.key, f.parts);
  y = railItem(pdf, theme, col, y, ESTIMATE.totalLabel, content.total);
  // The short notice, beside the figures it qualifies.
  y = para(pdf, ESTIMATE.coverNotice, col.x, y + 6, {
    font: 'sans-600',
    size: 8.6,
    color: theme.railText,
    width: col.width,
    lineGap: 1,
  });
  railItem(pdf, theme, col, y, 'Quote', {
    lines: [doc.reference, `Valid until ${longDate(doc.validUntil)}`],
  });
}
