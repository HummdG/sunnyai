/**
 * The roof drawn as an architect's roof plan: white ground inside a thin frame,
 * the house's outside walls as the heavy line (party walls dashed; the cuts between
 * fitted parts are not walls), the
 * attached neighbours in faint line, every roof face in fine ink line (the
 * panelled ones a little heavier), ridges, hips and valleys, the panels as
 * fine-outlined cells with a light accent tint, one dimension along the main
 * eave and one up its rafter (the true slope length), a north arrow turned with
 * the plan, and a mono title block. All text is set level.
 */

import { type RoofPlan } from './roof-plan.js';
import { label, type Rect, type Theme } from './layout.js';

type Pdf = PDFKit.PDFDocument;
type Pt = [number, number];

const TEXT = 6.8;
const TRACK = 0.6;
const TITLE_H = 16;

const metres = (m: number) => `${m.toFixed(1)} m`;

function textWidth(pdf: Pdf, text: string): number {
  return pdf
    .font('mono-400')
    .fontSize(TEXT)
    .widthOfString(text.toUpperCase(), { characterSpacing: TRACK });
}

/** The title block's caption: `ROOF PLAN · SOUTH-FACING · 42° PITCH`, or a flat roof. */
export function planTitle(plan: RoofPlan): string {
  const face = plan.faces.find((f) => f.id === plan.mainFace.id);
  if (plan.mainFacing === 'Flat' || !face || face.pitchDeg < 5) return 'Roof plan · Flat roof';
  return `Roof plan · ${plan.mainFacing}-facing · ${Math.round(face.pitchDeg)}° pitch`;
}

export function drawRoofPlan(pdf: Pdf, plan: RoofPlan, box: Rect, theme: Theme): void {
  const saveX = pdf.x;
  const saveY = pdf.y;
  const face = plan.faces.find((f) => f.id === plan.mainFace.id);
  const flat = plan.mainFacing === 'Flat' || !face || face.pitchDeg < 5;
  const eaveText = `${flat ? 'Edge' : 'Eave'} ${metres(plan.mainFace.eaveM)}`;
  const rafterText = `${flat ? 'Depth' : 'Rafter'} ${metres(plan.mainFace.rafterM)}`;

  // ---- frame and title block
  pdf.save().lineWidth(0.5).strokeColor(theme.ink);
  pdf.rect(box.x, box.y, box.w, box.h).stroke();
  pdf
    .moveTo(box.x, box.y + box.h - TITLE_H)
    .lineTo(box.x + box.w, box.y + box.h - TITLE_H)
    .stroke();
  pdf.restore();
  const titleY = box.y + box.h - TITLE_H + (TITLE_H - TEXT) / 2 - 0.5;
  const sampleW = plan.sample ? textWidth(pdf, 'Sample') + 4 : 0;
  label(pdf, planTitle(plan), box.x + 8, titleY, {
    width: box.w - 16 - sampleW - 8,
    color: theme.ink,
    size: TEXT,
  });
  if (plan.sample) {
    label(pdf, 'Sample', box.x + box.w - 8 - sampleW, titleY, {
      width: sampleW,
      align: 'right',
      color: theme.accent,
      size: TEXT,
    });
  }

  // ---- the drawing area and its scale
  const area: Rect = { x: box.x, y: box.y, w: box.w, h: box.h - TITLE_H };
  const rafterW = textWidth(pdf, rafterText);
  const pad = { l: rafterW + 24, r: 36, t: 14, b: 26 };
  const iw = area.w - pad.l - pad.r;
  const ih = area.h - pad.t - pad.b;
  if (iw <= 0 || ih <= 0) {
    // Too small a box to draw a plan in: leave it at the frame and title.
    pdf.x = saveX;
    pdf.y = saveY;
    return;
  }
  const { minX, minY, maxX, maxY } = plan.bounds;
  const dx = Math.max(maxX - minX, 0.01);
  const dy = Math.max(maxY - minY, 0.01);
  const s = Math.min(iw / dx, ih / dy);
  const ox = area.x + pad.l + (iw - dx * s) / 2;
  const oy = area.y + pad.t + (ih - dy * s) / 2;
  const at = ([x, y]: [number, number]): Pt => [ox + (x - minX) * s, oy + (maxY - y) * s];
  const path = (pts: [number, number][], close = true) => {
    const [first, ...rest] = pts.map(at);
    pdf.moveTo(first![0], first![1]);
    for (const p of rest) pdf.lineTo(p[0], p[1]);
    if (close) pdf.closePath();
  };

  // ---- attached neighbours, faint and clipped to the frame
  pdf.save();
  pdf.rect(area.x + 0.5, area.y + 0.5, area.w - 1, area.h - 1).clip();
  for (const ring of plan.neighbours) {
    if (ring.length < 3) continue;
    // a light hatch marks the house next door, as on a site plan
    pdf.save();
    path(ring);
    pdf.clip();
    pdf.lineWidth(0.3).strokeColor(theme.rule);
    for (let k = -area.h; k < area.w; k += 4) {
      pdf
        .moveTo(area.x + k, area.y + area.h)
        .lineTo(area.x + k + area.h, area.y)
        .stroke();
    }
    pdf.restore();
    path(ring);
    pdf.lineWidth(0.5).strokeColor(theme.rule).stroke();
  }
  pdf.restore();

  // ---- the house's outside walls: the heaviest line (party walls follow the faces)
  const seg = (w: RoofPlan['walls'][number]) => {
    const [a, b] = [at(w.from), at(w.to)];
    pdf.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke();
  };
  pdf.save().lineWidth(1.4).lineCap('square').strokeColor(theme.ink);
  for (const w of plan.walls) if (!w.party) seg(w);
  pdf.restore();

  // ---- roof faces, ridges, hips and valleys
  for (const f of plan.faces) {
    if (f.outline.length < 3) continue;
    pdf.save();
    path(f.outline);
    pdf
      .lineWidth(f.panelled ? 0.8 : 0.45)
      .lineJoin('miter')
      .strokeColor(theme.ink)
      .stroke();
    pdf.restore();
  }
  for (const l of plan.lines) {
    pdf.save().lineWidth(0.6).strokeColor(theme.ink);
    if (l.kind === 'valley') pdf.dash(2.5, { space: 1.5 });
    path([l.from, l.to], false);
    pdf.stroke().restore();
  }

  // ---- party walls, dashed on a clean ground so the dash reads over the verge line
  pdf.save().lineWidth(1.8).lineCap('butt').strokeColor('#ffffff');
  for (const w of plan.walls) if (w.party) seg(w);
  pdf.restore();
  pdf.save().lineWidth(1.4).lineCap('butt').strokeColor(theme.ink).dash(3, { space: 2 });
  for (const w of plan.walls) if (w.party) seg(w);
  pdf.restore();

  // ---- panels: fine-outlined cells with a light tint
  for (const panel of plan.panels) {
    if (panel.length < 3) continue;
    pdf.save();
    path(panel);
    pdf.fillOpacity(0.16).fill(theme.accent).restore();
    pdf.save();
    path(panel);
    pdf.lineWidth(0.3).strokeColor(theme.accent).stroke().restore();
  }

  // ---- dimensions
  const dim = theme.muted;
  const tick = (x: number, y: number) =>
    pdf
      .moveTo(x - 2.2, y + 2.2)
      .lineTo(x + 2.2, y - 2.2)
      .stroke();
  const knockout = (x: number, y: number, w: number) =>
    pdf
      .save()
      .rect(x - 2.5, y - 1.5, w + 5, TEXT + 3)
      .fill('#ffffff')
      .restore();
  const drawn = [
    ...plan.footprints.flatMap((f) => f.outline),
    ...plan.faces.flatMap((f) => f.outline),
  ].map(at);
  const bottom = Math.max(...drawn.map((p) => p[1]));
  const left = Math.min(...drawn.map((p) => p[0]));

  // along the main eave, under the drawing
  const [e0, e1] = plan.mainFace.eave.map(at) as [Pt, Pt];
  const [ea, eb] = e0[0] <= e1[0] ? [e0, e1] : [e1, e0];
  const dimY = bottom + 9;
  pdf.save().lineWidth(0.4).strokeColor(dim);
  pdf
    .moveTo(ea[0], ea[1] + 2)
    .lineTo(ea[0], dimY + 3)
    .stroke();
  pdf
    .moveTo(eb[0], eb[1] + 2)
    .lineTo(eb[0], dimY + 3)
    .stroke();
  pdf
    .moveTo(ea[0] - 3, dimY)
    .lineTo(eb[0] + 3, dimY)
    .stroke();
  tick(ea[0], dimY);
  tick(eb[0], dimY);
  pdf.restore();
  const eaveW = textWidth(pdf, eaveText);
  const eaveX = (ea[0] + eb[0]) / 2 - eaveW / 2;
  knockout(eaveX, dimY + 3.5, eaveW);
  label(pdf, eaveText, eaveX, dimY + 3.5, { width: eaveW + 2, color: dim, size: TEXT });

  // up the main face's rafter, to the left of the drawing
  const mainOutline = (face?.outline ?? []).map(at);
  const top = mainOutline.length > 0 ? Math.min(...mainOutline.map((p) => p[1])) : ea[1];
  const topLeft = mainOutline.length > 0 ? Math.min(...mainOutline.map((p) => p[0])) : ea[0];
  const dimX = left - 9;
  pdf.save().lineWidth(0.4).strokeColor(dim);
  pdf
    .moveTo(ea[0] - 2, ea[1])
    .lineTo(dimX - 3, ea[1])
    .stroke();
  pdf
    .moveTo(topLeft - 2, top)
    .lineTo(dimX - 3, top)
    .stroke();
  pdf
    .moveTo(dimX, ea[1] + 3)
    .lineTo(dimX, top - 3)
    .stroke();
  tick(dimX, ea[1]);
  tick(dimX, top);
  pdf.restore();
  const rafterX = dimX - 5 - rafterW;
  const rafterY = (ea[1] + top) / 2 - TEXT / 2;
  knockout(rafterX, rafterY, rafterW);
  label(pdf, rafterText, rafterX, rafterY, { width: rafterW + 2, color: dim, size: TEXT });

  // ---- north arrow, turned with the plan
  const r = (plan.rotationDeg * Math.PI) / 180;
  const d: Pt = [-Math.sin(r), -Math.cos(r)]; // plan north on the page (y down)
  const cx = area.x + area.w - 18;
  const cy = area.y + 26;
  const tip: Pt = [cx + d[0] * 7, cy + d[1] * 7];
  const tail: Pt = [cx - d[0] * 7, cy - d[1] * 7];
  const side: Pt = [-d[1], d[0]];
  pdf.save().lineWidth(0.5).strokeColor(theme.ink);
  pdf.circle(cx, cy, 7).fillAndStroke('#ffffff', theme.ink);
  pdf.moveTo(tail[0], tail[1]).lineTo(tip[0], tip[1]).stroke();
  pdf
    .moveTo(tip[0], tip[1])
    .lineTo(cx + side[0] * 3, cy + side[1] * 3)
    .lineTo(cx, cy)
    .closePath()
    .fill(theme.ink);
  pdf.restore();
  const nW = textWidth(pdf, 'N');
  const nX = cx + d[0] * 13 - nW / 2;
  const nY = cy + d[1] * 13 - TEXT / 2;
  knockout(nX, nY, nW);
  label(pdf, 'N', nX - 1, nY, { width: nW + 2, align: 'center', color: theme.ink, size: TEXT });

  pdf.x = saveX;
  pdf.y = saveY;
}
