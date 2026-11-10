/**
 * The house drawn as an architect's axonometric: the real house from its 3D
 * model, seen from above at an angle from the side its panelled roof faces,
 * turned off square so two walls show. Walls in fine ink line on white (the
 * side out of the light a shade darker), roof slopes lightly shaded, the
 * quoted panels on the roof as tinted cells, windows and doors where the model
 * has them, the attached neighbours as the rest of the row (drawn light and
 * fading out a short way along, so the house reads as one in its terrace), a
 * compass needle for north, and a mono caption underneath. Hidden faces are culled
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
  /**
   * Fades to white across the face, from the line through `from` to the line
   * through `to`, both running along `iso` (an attached neighbour running out).
   */
  fade?: { from: V3; to: V3; iso: V3 };
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

const NEIGHBOUR_LINE = '#aab4ba';
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

  const roofTone = (n: V3) => mix('#ffffff', SHADE, 0.12 + 0.3 * (1 - lit(n)));

  // The attached neighbours: the same row, drawn light and fading out a short
  // way along, so the house reads as one in a terrace. Their cut ends are not
  // drawn; the fade ends them.
  for (const nb of plan.neighbours) {
    const shapes: Shape[] = [];
    const seen = (q: Poly3) => facing(view, q.normal);
    const byDepth = (list: Poly3[]) => list.filter(seen).sort((x, y) => mid(x.pts) - mid(y.pts));
    const fade = (q: Poly3) => fadeAcross(q, nb.shared[0], nb.away, nb.reach);
    for (const w of byDepth(nb.walls)) {
      const fill = lit(w.normal) > 0.25 ? '#f8f9fa' : '#f1f3f4';
      shapes.push({ pts: w.pts, fill, stroke: NEIGHBOUR_LINE, width: 0.4, ...fade(w) });
    }
    for (const r of byDepth(nb.roofs)) {
      const fill = mix(roofTone(r.normal), '#ffffff', 0.35);
      shapes.push({ pts: r.pts, fill, stroke: NEIGHBOUR_LINE, width: 0.4, ...fade(r) });
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
      shapes.push({ pts: f.outline, fill: roofTone(f.normal), stroke: theme.ink, width: 0.8 });
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

/**
 * The fade across a neighbour's face: from where it meets the party line to
 * `reach` metres away, along the face (none for a face square to the row).
 */
function fadeAcross(q: Poly3, at: [number, number], away: [number, number], reach: number) {
  const a: V3 = [away[0], away[1], 0];
  const n = q.normal;
  const k = dot(n, a);
  const u: V3 = [a[0] - n[0] * k, a[1] - n[1] * k, a[2] - n[2] * k];
  const gain = dot(u, a);
  if (gain < 0.1) return {};
  const dist = (p: V3) => (p[0] - at[0]) * away[0] + (p[1] - at[1]) * away[1];
  const p0 = q.pts.reduce((best, p) => (dist(p) < dist(best) ? p : best));
  const s = (reach - dist(p0)) / gain;
  const iso: V3 = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  return {
    fade: { from: p0, to: [p0[0] + u[0] * s, p0[1] + u[1] * s, p0[2] + u[2] * s] as V3, iso },
  };
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
  // Fit the house itself: faded neighbours run on past the frame and are
  // softened at its edges, so they never shrink the house.
  const own = shapes.filter((s) => !s.fade);
  const pts = (own.length > 0 ? own : shapes).flatMap((s) => s.pts.map(flat));
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

// ---- the north arrow -------------------------------------------------------------

/**
 * The north arrow: a slim needle (tip, left, tail, right) along north as the
 * drawing projects it, at the corner the fit left free, and where its N goes
 * (its top left and width), kept inside the box above the caption.
 */
export function northArrow(
  pdf: Pdf,
  fit: Fitted,
  box: Rect,
  capTop: number,
): { needle: [Pt, Pt, Pt, Pt]; label: { x: number; y: number; w: number } } {
  const { cx, cy } = fit.north;
  const n: V3 = [0, 1, 0];
  let d: Pt = [dot(fit.view.right, n), -dot(fit.view.up, n)];
  const dl = Math.hypot(d[0], d[1]);
  d = dl > 1e-6 ? [d[0] / dl, d[1] / dl] : [0, -1];
  const p: Pt = [-d[1], d[0]];
  const r = NORTH_R - 2;
  const w = r * 0.32;
  const needle: [Pt, Pt, Pt, Pt] = [
    [cx + d[0] * r, cy + d[1] * r],
    [cx + p[0] * w, cy + p[1] * w],
    [cx - d[0] * r, cy - d[1] * r],
    [cx - p[0] * w, cy - p[1] * w],
  ];
  const nW = textWidth(pdf, 'N');
  const reach = r + 5;
  const x = Math.min(Math.max(cx + d[0] * reach - nW / 2, box.x), box.x + box.w - nW - 2);
  const y = Math.min(Math.max(cy + d[1] * reach - TEXT / 2, box.y), capTop - TEXT - 2);
  return { needle, label: { x, y, w: nW } };
}

// ---- drawing -------------------------------------------------------------------

const SOFT = 28;

/** White washes over each edge of the frame, clear inside to solid at the edge. */
function softenEdges(pdf: Pdf, f: Rect): void {
  const sides: [number, number, number, number, number, number, number, number][] = [
    // rect x, y, w, h, then gradient from (x1, y1) to the edge (x2, y2)
    [f.x, f.y, SOFT, f.h, f.x + SOFT, f.y, f.x, f.y],
    [f.x + f.w - SOFT, f.y, SOFT, f.h, f.x + f.w - SOFT, f.y, f.x + f.w, f.y],
    [f.x, f.y, f.w, SOFT, f.x, f.y + SOFT, f.x, f.y],
    [f.x, f.y + f.h - SOFT, f.w, SOFT, f.x, f.y + f.h - SOFT, f.x, f.y + f.h],
  ];
  for (const [x, y, w, h, x1, y1, x2, y2] of sides) {
    const g = pdf.linearGradient(x1, y1, x2, y2).stop(0, '#ffffff', 0).stop(1, '#ffffff', 1);
    pdf.rect(x, y, w, h).fill(g);
  }
}

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
  const paint = (colour: string, s: Shape) => {
    if (!s.fade) return colour;
    const [x1, y1] = fit.at(s.fade.from);
    const [tx, ty] = fit.at(s.fade.to);
    const f = s.fade.from;
    const [ix, iy] = fit.at([f[0] + s.fade.iso[0], f[1] + s.fade.iso[1], f[2] + s.fade.iso[2]]);
    // across the projected lines of equal distance from the party wall
    let g: Pt = [-(iy - y1), ix - x1];
    const gl = Math.hypot(g[0], g[1]);
    if (gl < 1e-9) return colour;
    g = [g[0] / gl, g[1] / gl];
    const l = (tx - x1) * g[0] + (ty - y1) * g[1];
    return pdf
      .linearGradient(x1, y1, x1 + g[0] * l, y1 + g[1] * l)
      .stop(0, colour)
      .stop(0.4, colour)
      .stop(1, '#ffffff');
  };
  // Neighbours come first; once they are down, soften the frame's edges so a
  // neighbour cut by the frame fades out instead of stopping hard.
  const frame: Rect = { x: box.x, y: box.y, w: box.w, h: capTop - box.y - 1 };
  let softened = !fit.shapes.some((s) => s.fade);
  for (const s of fit.shapes) {
    if (!softened && !s.fade) {
      softenEdges(pdf, frame);
      softened = true;
    }
    if (s.pts.length < 3) continue;
    if (s.fill) {
      path(s.pts);
      pdf.fillColor(paint(s.fill, s)).fill();
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
      pdf.lineWidth(s.width).strokeColor(paint(s.stroke, s)).stroke();
    }
  }
  pdf.restore();

  // ---- north arrow: a compass needle pointing north as the drawing has it, the N past its tip
  const arrow = northArrow(pdf, fit, box, capTop);
  pdf.save().lineWidth(0.5).strokeColor(theme.ink).lineJoin('miter');
  const [tip, left, tail, right] = arrow.needle;
  pdf
    .moveTo(tip[0], tip[1])
    .lineTo(left[0], left[1])
    .lineTo(right[0], right[1])
    .closePath()
    .fillAndStroke(theme.ink, theme.ink);
  pdf
    .moveTo(tail[0], tail[1])
    .lineTo(left[0], left[1])
    .lineTo(right[0], right[1])
    .closePath()
    .fillAndStroke('#ffffff', theme.ink);
  pdf.restore();
  const n = arrow.label;
  label(pdf, 'N', n.x - 1, n.y, { width: n.w + 2, align: 'center', color: theme.ink, size: TEXT });

  pdf.x = saveX;
  pdf.y = saveY;
}
