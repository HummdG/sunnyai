/**
 * The house drawn as an architect's axonometric: the real house from its 3D
 * model, seen from above at an angle from the side its panelled roof faces,
 * turned off square so two walls show. Walls in fine ink line on white (the
 * side out of the light a shade darker), roof slopes lightly shaded, the
 * quoted panels on the roof as tinted cells, windows and doors where the model
 * has them, the attached neighbours as faint short stubs, a north arrow laid
 * on the ground plane, and a mono caption underneath. Hidden faces are culled
 * and the rest painted back to front. All text is set level.
 */

import { type Poly3, type RoofPlan, type V3 } from './roof-plan.js';
import { label, type Rect, type Theme } from './layout.js';

type Pdf = PDFKit.PDFDocument;
type Pt = [number, number];

const TEXT = 6.8;
const TRACK = 0.6;
/** Degrees above the horizon the drawing looks down from. */
export const ELEVATION_DEG = 32;
/** Degrees the view turns off square to the main face, so a side wall shows. */
export const TURN_DEG = 36;

// ---- the view ----------------------------------------------------------------

export interface View {
  /** Compass bearing of the viewer from the house. */
  bearingDeg: number;
  /** Screen right, screen up, and towards the viewer, in the model frame. */
  right: V3;
  up: V3;
  toward: V3;
}

const rad = (d: number) => (d * Math.PI) / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function viewAt(bearingDeg: number, elevationDeg = ELEVATION_DEG): View {
  const p = rad(bearingDeg);
  const e = rad(elevationDeg);
  return {
    bearingDeg,
    right: [-Math.cos(p), Math.sin(p), 0],
    up: [-Math.sin(e) * Math.sin(p), -Math.sin(e) * Math.cos(p), Math.cos(e)],
    toward: [Math.cos(e) * Math.sin(p), Math.cos(e) * Math.cos(p), Math.sin(e)],
  };
}

/** A face is drawn when it turns towards the viewer. */
export const facing = (view: View, normal: V3) => dot(view.toward, normal) > 1e-3;

/** The bearing straight out from the main face (south for a flat roof). */
function frontBearing(plan: RoofPlan): number {
  const a = plan.mainFace.azimuthDeg;
  return Number.isFinite(a) && plan.mainFace.pitchDeg >= 5 ? a : 180;
}

/** Projected area of the walls this view sees, outside walls counting more than bare party walls. */
function wallShow(plan: RoofPlan, view: View): number {
  let sum = 0;
  for (const part of plan.parts) {
    for (const w of part.walls) {
      const d = dot(view.toward, w.normal);
      if (d <= 0 || againstNeighbour(plan, w)) continue;
      sum += d * area3(w.pts) * (w.party ? 0.3 : 1);
    }
  }
  return sum;
}

function area3(pts: V3[]): number {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    x += a[1] * b[2] - a[2] * b[1];
    y += a[2] * b[0] - a[0] * b[2];
    z += a[0] * b[1] - a[1] * b[0];
  }
  return Math.hypot(x, y, z) / 2;
}

/**
 * The three-quarter view of the main face: from its side, turned TURN_DEG
 * whichever way shows more outside wall (to the right when even).
 */
export function viewFor(plan: RoofPlan): View {
  const front = frontBearing(plan);
  const a = viewAt(front + TURN_DEG);
  const b = viewAt(front - TURN_DEG);
  return wallShow(plan, b) > wallShow(plan, a) * 1.05 ? b : a;
}

// ---- what gets painted -------------------------------------------------------

export interface Shape {
  pts: V3[];
  fill: string | null;
  stroke: string | null;
  width: number;
  /** Panel cell lines: [cols, rows] across the four corners. */
  cells?: [number, number];
  cellStroke?: string;
}

const hex = (s: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
/** `a` mixed towards `b` by t (0 is a, 1 is b). */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [hex(a), hex(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i]! - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const NEIGHBOUR_LINE = '#bcc6cc';
const SHADE = '#7d878e';

/** Everything to paint, back to front, culled to what the view sees. */
export function shapesFor(plan: RoofPlan, view: View, theme: Theme): Shape[] {
  const depth = (p: V3) => dot(view.toward, p);
  const mid = (pts: V3[]) => pts.reduce((s, p) => s + depth(p), 0) / pts.length;
  // Light from high over the main face's side, from the far side of the turn.
  const front = rad(frontBearing(plan));
  const turn = rad(view.bearingDeg) - front;
  const lb = front - Math.sign(Math.sin(turn) || 1) * rad(40);
  const light: V3 = (() => {
    const v: V3 = [Math.sin(lb) * 0.7, Math.cos(lb) * 0.7, 0.75];
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l, v[2] / l];
  })();
  const lit = (n: V3) => Math.max(0, Math.min(1, dot(n, light)));

  const groups: { depth: number; shapes: Shape[] }[] = [];

  // the attached neighbours, faint
  for (const nb of plan.neighbours) {
    const shapes: Shape[] = [];
    const seen = (q: Poly3) => facing(view, q.normal);
    const byDepth = (list: Poly3[]) => list.filter(seen).sort((x, y) => mid(x.pts) - mid(y.pts));
    for (const w of byDepth(nb.walls)) {
      shapes.push({ pts: w.pts, fill: '#ffffff', stroke: NEIGHBOUR_LINE, width: 0.4 });
    }
    if (nb.cut && seen(nb.cut)) {
      shapes.push({ pts: nb.cut.pts, fill: '#ffffff', stroke: NEIGHBOUR_LINE, width: 0.3 });
    }
    for (const r of byDepth(nb.roofs)) {
      shapes.push({ pts: r.pts, fill: '#f6f7f8', stroke: NEIGHBOUR_LINE, width: 0.4 });
    }
    // Behind the house whatever their depth: they only ever abut it, and the house is the subject.
    groups.push({ depth: depth(nb.centroid) - 1e6, shapes });
  }

  // the house, part by part
  for (const part of plan.parts) {
    const shapes: Shape[] = [];
    const walls = part.walls
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => facing(view, w.normal) && !againstNeighbour(plan, w))
      .sort((x, y) => mid(x.w.pts) - mid(y.w.pts));
    for (const { w, i } of walls) {
      const tone = lit(w.normal) > 0.25 ? '#fbfbfb' : '#eceef0';
      shapes.push({ pts: w.pts, fill: tone, stroke: theme.ink, width: 0.65 });
      for (const o of plan.openings) {
        if (o.partId !== part.id || o.wall !== i) continue;
        shapes.push({
          pts: o.pts,
          fill: o.kind === 'window' ? '#e4e9ec' : '#d9dee1',
          stroke: theme.ink,
          width: 0.35,
        });
      }
    }
    const faces = plan.faces
      .filter((f) => f.partId === part.id && facing(view, f.normal))
      .sort((x, y) => mid(x.outline) - mid(y.outline));
    for (const f of faces) {
      const shade = mix('#ffffff', SHADE, 0.12 + 0.3 * (1 - lit(f.normal)));
      shapes.push({ pts: f.outline, fill: shade, stroke: theme.ink, width: 0.8 });
      for (const p of plan.panels) {
        if (p.faceId !== f.id) continue;
        shapes.push({
          pts: p.corners,
          fill: mix(theme.accent, '#ffffff', 0.68),
          stroke: theme.accent,
          width: 0.45,
          cells: p.portrait ? [2, 4] : [4, 2],
          cellStroke: mix(theme.accent, '#ffffff', 0.35),
        });
      }
    }
    groups.push({ depth: depth(part.centroid), shapes });
  }
  groups.sort((a, b) => a.depth - b.depth);
  return groups.flatMap((g) => g.shapes);
}

/** A wall standing on the line an attached neighbour shares: inside the terrace, not drawn. */
function againstNeighbour(plan: RoofPlan, w: Poly3): boolean {
  const lowest = Math.min(...w.pts.map((p) => p[2]));
  const foot = w.pts.filter((p) => p[2] < lowest + 0.01);
  return plan.neighbours.some(({ shared: [a, b] }) =>
    foot.every((p) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < 0.3;
    }),
  );
}

// ---- fitting it to the box ---------------------------------------------------

/** The caption: `20 FORTHLIN ROAD · SOUTH ROOF · 42° · 10 PANELS`, plus `· SAMPLE`. */
export function captionFor(plan: RoofPlan, withAddress = true): string {
  const flat = plan.mainFacing === 'Flat' || plan.mainFace.pitchDeg < 5;
  const n = plan.panels.length;
  return [
    ...(withAddress && plan.address ? [plan.address] : []),
    flat ? 'Flat roof' : `${plan.mainFacing} roof`,
    ...(flat ? [] : [`${Math.round(plan.mainFace.pitchDeg)}°`]),
    `${n} ${n === 1 ? 'panel' : 'panels'}`,
    ...(plan.sample ? ['Sample'] : []),
  ].join(' · ');
}

export interface Fitted {
  view: View;
  shapes: Shape[];
  /** Model point to page point. */
  at: (p: V3) => Pt;
  /** Where the drawing may go. */
  area: Rect;
  north: { cx: number; cy: number };
}

const NORTH_R = 9;
const PAD = 8;

/** The drawing scaled to fit the box above the caption, with room for the north arrow. */
export function fitDrawing(
  plan: RoofPlan,
  box: Rect,
  theme: Theme,
  captionH: number,
): Fitted | null {
  const area: Rect = {
    x: box.x + PAD,
    y: box.y + PAD,
    w: box.w - 2 * PAD,
    h: box.h - captionH - 2 * PAD,
  };
  if (area.w < 40 || area.h < 40) return null;
  const view = viewFor(plan);
  const shapes = shapesFor(plan, view, theme);
  const flat = (p: V3): Pt => [dot(view.right, p), dot(view.up, p)];
  const pts = shapes.flatMap((s) => s.pts.map(flat));
  if (pts.length === 0) return null;
  const minX = Math.min(...pts.map((p) => p[0]));
  const maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  const maxY = Math.max(...pts.map((p) => p[1]));
  const dx = Math.max(maxX - minX, 0.01);
  const dy = Math.max(maxY - minY, 0.01);
  // Leave a corner for the north arrow when the drawing would run into it.
  const slot = 2 * NORTH_R + 6;
  const options = [
    { w: area.w - slot, h: area.h },
    { w: area.w, h: area.h - slot },
  ];
  const s = Math.max(...options.map((o) => Math.min(o.w / dx, o.h / dy)));
  const ox = area.x + (area.w - dx * s) / 2;
  const oy = area.y + (area.h - dy * s) / 2;
  const at = (p: V3): Pt => {
    const [x, y] = flat(p);
    return [ox + (x - minX) * s, oy + (maxY - y) * s];
  };
  // The emptiest top corner of the box for the arrow.
  const page = pts.map(([x, y]) => [ox + (x - minX) * s, oy + (maxY - y) * s] as Pt);
  const corners: Pt[] = [
    [area.x + area.w - NORTH_R - 1, area.y + NORTH_R + 4],
    [area.x + NORTH_R + 1, area.y + NORTH_R + 4],
    [area.x + area.w - NORTH_R - 1, area.y + area.h - NORTH_R - 1],
    [area.x + NORTH_R + 1, area.y + area.h - NORTH_R - 1],
  ];
  const clearance = (c: Pt) => Math.min(...page.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
  const best = corners.reduce((a, b) => (clearance(b) > clearance(a) + 4 ? b : a));
  return { view, shapes, at, area, north: { cx: best[0], cy: best[1] } };
}

// ---- drawing -------------------------------------------------------------------

function textWidth(pdf: Pdf, text: string): number {
  return pdf
    .font('mono-400')
    .fontSize(TEXT)
    .widthOfString(text.toUpperCase(), { characterSpacing: TRACK });
}

export function drawRoofPlan(pdf: Pdf, plan: RoofPlan, box: Rect, theme: Theme): void {
  const saveX = pdf.x;
  const saveY = pdf.y;

  // ---- the caption, under a hairline
  let caption = captionFor(plan);
  if (textWidth(pdf, caption) > box.w) caption = captionFor(plan, false);
  const capW = box.w;
  const capH =
    pdf
      .font('mono-400')
      .fontSize(TEXT)
      .heightOfString(caption.toUpperCase(), { width: capW, characterSpacing: TRACK }) + 7;
  const capTop = box.y + box.h - capH;
  pdf.save().lineWidth(0.5).strokeColor(theme.ink);
  pdf
    .moveTo(box.x, capTop)
    .lineTo(box.x + box.w, capTop)
    .stroke();
  pdf.restore();
  label(pdf, caption, box.x, capTop + 5, { width: capW, color: theme.ink, size: TEXT });

  const fit = fitDrawing(plan, box, theme, capH);
  if (!fit) {
    pdf.x = saveX;
    pdf.y = saveY;
    return;
  }

  pdf.save();
  pdf.rect(box.x, box.y, box.w, capTop - box.y - 1).clip();
  pdf.lineJoin('round').lineCap('round');
  const path = (pts: V3[]) => {
    const [first, ...rest] = pts.map(fit.at);
    pdf.moveTo(first![0], first![1]);
    for (const p of rest) pdf.lineTo(p[0], p[1]);
    pdf.closePath();
  };
  for (const s of fit.shapes) {
    if (s.pts.length < 3) continue;
    if (s.fill) {
      path(s.pts);
      pdf.fillColor(s.fill).fill();
    }
    if (s.cells && s.cellStroke && s.pts.length === 4) {
      const [a, b, c, d] = s.pts.map(fit.at) as [Pt, Pt, Pt, Pt];
      const lerp = (p: Pt, q: Pt, t: number): Pt => [
        p[0] + (q[0] - p[0]) * t,
        p[1] + (q[1] - p[1]) * t,
      ];
      pdf.lineWidth(0.2).strokeColor(s.cellStroke);
      const [cols, rows] = s.cells;
      for (let i = 1; i < cols; i++) {
        const p = lerp(a, b, i / cols);
        const q = lerp(d, c, i / cols);
        pdf.moveTo(p[0], p[1]).lineTo(q[0], q[1]).stroke();
      }
      for (let j = 1; j < rows; j++) {
        const p = lerp(a, d, j / rows);
        const q = lerp(b, c, j / rows);
        pdf.moveTo(p[0], p[1]).lineTo(q[0], q[1]).stroke();
      }
    }
    if (s.stroke && s.width > 0) {
      path(s.pts);
      pdf.lineWidth(s.width).strokeColor(s.stroke).stroke();
    }
  }
  pdf.restore();

  // ---- north arrow, on the ground plane
  const { cx, cy } = fit.north;
  const ground = (x: number, y: number): Pt => [
    dot(fit.view.right, [x, y, 0]),
    -dot(fit.view.up, [x, y, 0]),
  ];
  // scale the ground circle so its widest reach is NORTH_R
  const ring = Array.from({ length: 48 }, (_, k) => {
    const t = (k / 48) * 2 * Math.PI;
    return ground(Math.cos(t), Math.sin(t));
  });
  const reach = Math.max(...ring.map((p) => Math.hypot(p[0], p[1])));
  const k = NORTH_R / reach;
  const on = ([x, y]: Pt): Pt => [cx + x * k, cy + y * k];
  pdf.save().lineWidth(0.5).strokeColor(theme.ink);
  ring.forEach((p, i) => {
    const q = on(p);
    if (i === 0) pdf.moveTo(q[0], q[1]);
    else pdf.lineTo(q[0], q[1]);
  });
  pdf.closePath().stroke();
  const tip = on(ground(0, 1.2));
  const tail = on(ground(0, -1));
  const left = on(ground(-0.3, 0.5));
  const right = on(ground(0.3, 0.5));
  const centre = on(ground(0, 0));
  pdf.moveTo(tail[0], tail[1]).lineTo(tip[0], tip[1]).stroke();
  pdf
    .moveTo(tip[0], tip[1])
    .lineTo(left[0], left[1])
    .lineTo(right[0], right[1])
    .closePath()
    .fillAndStroke(theme.ink, theme.ink);
  pdf.restore();
  // the N just beyond the tip, level
  const dir: Pt = [tip[0] - centre[0], tip[1] - centre[1]];
  const dl = Math.hypot(dir[0], dir[1]) || 1;
  const nW = textWidth(pdf, 'N');
  const nx = Math.min(Math.max(tip[0] + (dir[0] / dl) * 6 - nW / 2, box.x), box.x + box.w - nW - 2);
  const ny = Math.min(Math.max(tip[1] + (dir[1] / dl) * 6 - TEXT / 2, box.y), capTop - TEXT - 2);
  label(pdf, 'N', nx - 1, ny, { width: nW + 2, align: 'center', color: theme.ink, size: TEXT });

  pdf.x = saveX;
  pdf.y = saveY;
}
