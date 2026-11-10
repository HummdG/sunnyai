/**
 * The roof plan drawn like an architect's plan: each roof face holding panels
 * as a thin outline, the panels on it, overall dimensions, the facing and
 * pitch, and a north marker. `RoofPlan.dimensions` are the axis-aligned plan
 * bounds, so they are labelled as overall width and depth, never as eave or
 * ridge lengths. A sample roof says `Sample`.
 */

import { facingWord, type RoofPlan } from './roof-plan.js';
import { label, type Rect, type Theme } from './layout.js';

type Pdf = PDFKit.PDFDocument;

const metres = (m: number) => `${m.toLocaleString('en-GB', { maximumFractionDigits: 1 })} m`;

/** The face the plan is captioned by: the one facing `mainFacing`, else the first. */
function mainFace(plan: RoofPlan): RoofPlan['faces'][number] | undefined {
  return (
    plan.faces.find((f) =>
      plan.mainFacing === 'Flat' ? f.pitchDeg < 5 : facingWord(f.azimuthDeg) === plan.mainFacing,
    ) ?? plan.faces[0]
  );
}

export function drawRoofPlan(pdf: Pdf, plan: RoofPlan, box: Rect, theme: Theme): void {
  const saveX = pdf.x;
  const saveY = pdf.y;
  pdf.save().rect(box.x, box.y, box.w, box.h).fillAndStroke('#f6f9fb', theme.rule).restore();

  const pad = { l: 16, r: 34, t: 26, b: 30 };
  const iw = box.w - pad.l - pad.r;
  const ih = box.h - pad.t - pad.b;
  const { minX, minY, maxX, maxY } = plan.bounds;
  const dx = Math.max(maxX - minX, 0.01);
  const dy = Math.max(maxY - minY, 0.01);
  const s = Math.min(iw / dx, ih / dy);
  const ox = box.x + pad.l + (iw - dx * s) / 2;
  const oy = box.y + pad.t + (ih - dy * s) / 2;
  const at = ([x, y]: [number, number]): [number, number] => [
    ox + (x - minX) * s,
    oy + (maxY - y) * s,
  ];
  const polygon = (pts: [number, number][]) => {
    const [first, ...rest] = pts.map(at);
    pdf.moveTo(first![0], first![1]);
    for (const p of rest) pdf.lineTo(p[0], p[1]);
    pdf.closePath();
  };

  for (const face of plan.faces) {
    if (face.outline.length < 3) continue;
    pdf.save();
    polygon(face.outline);
    pdf.lineWidth(0.9).lineJoin('round').fillAndStroke('#ffffff', theme.railBg).restore();
  }
  for (const panel of plan.panels) {
    if (panel.length < 3) continue;
    pdf.save();
    polygon(panel);
    pdf.lineWidth(0.35).fillOpacity(0.9).fillAndStroke(theme.accent, '#ffffff').restore();
  }

  const left = ox;
  const right = ox + dx * s;
  const top = oy;
  const bottom = oy + dy * s;
  const tick = 3;
  const dim = theme.muted;
  pdf.save().lineWidth(0.4).strokeColor(dim);
  // overall width, under the drawing
  const wy = bottom + 9;
  pdf.moveTo(left, wy).lineTo(right, wy).stroke();
  pdf
    .moveTo(left, wy - tick)
    .lineTo(left, wy + tick)
    .stroke();
  pdf
    .moveTo(right, wy - tick)
    .lineTo(right, wy + tick)
    .stroke();
  // overall depth, to the right
  const dxr = right + 9;
  pdf.moveTo(dxr, top).lineTo(dxr, bottom).stroke();
  pdf
    .moveTo(dxr - tick, top)
    .lineTo(dxr + tick, top)
    .stroke();
  pdf
    .moveTo(dxr - tick, bottom)
    .lineTo(dxr + tick, bottom)
    .stroke();
  pdf.restore();

  label(pdf, `Overall width ${metres(plan.dimensions.widthM)}`, left, wy + 5, {
    width: Math.max(right - left, 90),
    align: right - left >= 90 ? 'center' : 'left',
    color: dim,
  });
  const depthText = `Overall depth ${metres(plan.dimensions.depthM)}`;
  const midY = (top + bottom) / 2;
  pdf.save().rotate(90, { origin: [dxr + 5, midY] });
  label(pdf, depthText, dxr + 5 - 60, midY - 1, { width: 120, align: 'center', color: dim });
  pdf.restore();

  const face = mainFace(plan);
  const facing = plan.mainFacing === 'Flat' ? 'Flat roof' : `${plan.mainFacing}-facing`;
  const caption = face ? `${facing} · ${Math.round(face.pitchDeg)}° pitch` : facing;
  label(pdf, caption, box.x + 10, box.y + 9, { width: box.w * 0.6, color: theme.ink });

  // north marker, top right
  const nx = box.x + box.w - 16;
  const ny = box.y + 9;
  label(pdf, 'N', nx - 10, ny, { width: 20, align: 'center', color: theme.ink });
  pdf
    .save()
    .moveTo(nx, ny + 9)
    .lineTo(nx - 3, ny + 17)
    .lineTo(nx + 3, ny + 17)
    .closePath()
    .fill(theme.ink)
    .restore();
  if (plan.sample) {
    label(pdf, 'Sample', box.x + box.w - 90, box.y + 9, {
      width: 60,
      align: 'right',
      color: theme.accent,
    });
  }
  pdf.x = saveX;
  pdf.y = saveY;
}
