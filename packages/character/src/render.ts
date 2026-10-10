// Pure SVG renderer for the Sunny rig.
//
// `renderSunny(rig)` is deterministic and side-effect free: the same rig always
// produces byte-identical SVG. That property is what the animation replay and
// screenshot tests rely on.

import { BODY, BROW, EYE, EYE_HIGHLIGHT, RAY, SMILE_PROFILE, VIEWBOX } from './geometry.js';
import type { BrowRig, EyeRig, PropId, PropRig, RayRig, SmileRig, SunnyRig, Vec2 } from './rig.js';

// ─── small vector helpers ────────────────────────────────────────────────────

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const unit = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** SVG number formatting: trim float noise so output is stable and compact. */
function n(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

const pt = (p: Vec2): string => `${n(p.x)} ${n(p.y)}`;

/**
 * Build a closed path through `points` with rounded corners of radius `radius`.
 * Each corner is replaced by a quadratic curve centred on the vertex.
 */
export function roundedPolygonPath(points: Vec2[], radius: number | number[]): string {
  const count = points.length;
  if (count < 3) return '';
  let d = '';
  for (let i = 0; i < count; i++) {
    const prev = points[(i - 1 + count) % count]!;
    const curr = points[i]!;
    const next = points[(i + 1) % count]!;
    const want = typeof radius === 'number' ? radius : (radius[i] ?? 0);
    const r = Math.min(want, len(sub(prev, curr)) / 2, len(sub(next, curr)) / 2);
    const a = add(curr, mul(unit(sub(prev, curr)), r));
    const b = add(curr, mul(unit(sub(next, curr)), r));
    d += i === 0 ? `M${pt(a)}` : `L${pt(a)}`;
    d += `Q${pt(curr)} ${pt(b)}`;
  }
  return `${d}Z`;
}

/**
 * A smooth interpolating path through `points`, using a Catmull-Rom spline
 * converted to cubic Beziers. The curve passes through every point exactly,
 * which is what lets the reference's sampled centrelines become artwork.
 */
export function smoothPath(points: Vec2[], tension = 1, corners: readonly number[] = []): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M${pt(points[0]!)}L${pt(points[1]!)}`;
  const k = tension / 6;
  let d = `M${pt(points[0]!)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    // Points flagged as corners keep their point: the segment into them is a
    // straight line, so the notch stays an arrow rather than being rounded off.
    if (corners.includes(i + 1)) {
      d += `L${pt(p2)}`;
      continue;
    }
    const c1 = add(p1, mul(sub(p2, p0), k));
    const c2 = sub(p2, mul(sub(p3, p1), k));
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d;
}

// ─── body & rays ─────────────────────────────────────────────────────────────

/**
 * The ray triangle for one ray, in body-local coordinates (origin = body centre,
 * y down). A ray points outward along `angleDeg`, clockwise from up.
 */
export function rayPoints(ray: RayRig): Vec2[] {
  const a = ((ray.angleDeg + ray.rotation) * Math.PI) / 180;
  const dir: Vec2 = { x: Math.sin(a), y: -Math.cos(a) };
  const perp: Vec2 = { x: Math.cos(a), y: Math.sin(a) };

  const baseR = RAY.baseRadius;
  const scale = Math.max(0, ray.lengthScale);
  const tipR = baseR + (RAY.tipRadius + RAY.apexCompensation - baseR) * scale;
  const halfWidth = RAY.baseHalfWidth * Math.max(0, ray.widthScale);

  const base = mul(dir, baseR);
  return [
    add(add(base, mul(perp, -halfWidth)), ray.offset),
    add(mul(dir, tipR), ray.offset),
    add(add(base, mul(perp, halfWidth)), ray.offset),
  ];
}

// ─── face ────────────────────────────────────────────────────────────────────

const K = 0.5523; // circle-to-bezier constant

/**
 * The eye opening: an oval whose widest point sits above the middle and whose
 * lower half narrows, matching the reference's egg-like eye.
 */
export function eyeOutlinePath(eye: EyeRig): string {
  const hw = eye.width / 2;
  const hh = eye.height / 2;
  const yw = EYE.widest * hh; // y of the widest point
  const upperRise = yw + hh; // vertical semi-span of the upper half
  const lowerFall = hh - yw; // vertical semi-span of the lower half
  const lowerW = hw * EYE.taper;
  return [
    `M0 ${n(-hh)}`,
    // Top → right widest.
    `C${n(hw * K)} ${n(-hh)} ${n(hw)} ${n(yw - upperRise * K)} ${n(hw)} ${n(yw)}`,
    // Right widest → bottom.
    `C${n(hw)} ${n(yw + lowerFall * K)} ${n(lowerW * K)} ${n(hh)} 0 ${n(hh)}`,
    // Bottom → left widest.
    `C${n(-lowerW * K)} ${n(hh)} ${n(-hw)} ${n(yw + lowerFall * K)} ${n(-hw)} ${n(yw)}`,
    // Left widest → top.
    `C${n(-hw)} ${n(yw - upperRise * K)} ${n(-hw * K)} ${n(-hh)} 0 ${n(-hh)}`,
    'Z',
  ].join('');
}

/**
 * The cream highlight inside an eye: everything to the left of the measured
 * right-hand boundary, which carries the notch. Rendered clipped to the eye.
 */
export function eyeHighlightPath(eye: EyeRig): string {
  const hw = eye.width / 2;
  const hh = eye.height / 2;
  const width = EYE_HIGHLIGHT.widthFraction * eye.width;
  const stepCount = 24;
  const notchIndex = Math.round(EYE_HIGHLIGHT.notchAt * stepCount);
  const points: Vec2[] = [];
  const corners: number[] = [];
  // The boundary is the eye's own left edge, pushed right by the strip's width,
  // so the cream stays a constant width as the opening tapers. Sampled top to
  // bottom; the whole shape is clipped to the eye afterwards, so closing it
  // well to the left costs nothing.
  for (let i = 0; i <= stepCount; i++) {
    const y = (-1 + (2 * i) / stepCount) * hh;
    const left = -eyeHalfWidthAt(eye, y);
    points.push({ x: left + width, y });
    if (i === notchIndex) {
      // The notch: a sharp point driven right, roughly two thirds across.
      corners.push(points.length);
      points.push({ x: left + eye.width * EYE_HIGHLIGHT.notchReach, y });
    }
  }
  const path = smoothPath(points, 0.6, corners);
  return `${path}L${n(-hw * 3)} ${n(hh)}L${n(-hw * 3)} ${n(-hh)}Z`;
}

/**
 * Half-width of the eye's opening at height `y`, in eye-local coordinates.
 * Mirrors the construction in `eyeOutlinePath`, so the highlight can follow the
 * outline exactly.
 */
function eyeHalfWidthAt(eye: EyeRig, y: number): number {
  const hw = eye.width / 2;
  const hh = eye.height / 2;
  const yw = EYE.widest * hh;
  const inside = (span: number, w: number) => {
    const t = span > 0 ? (y - yw) / span : 0;
    return w * Math.sqrt(Math.max(0, 1 - t * t));
  };
  return y <= yw ? inside(yw + hh, hw) : inside(hh - yw, hw * EYE.taper);
}

// ─── props ───────────────────────────────────────────────────────────────────

/**
 * Props are drawn in body-local coordinates, like the rays. Each path is
 * authored in a frame about 12 units tall centred on the origin, so `scale` is
 * a plain multiplier and a sequence can size one without knowing its geometry.
 */
const PROP_PATHS: Readonly<Record<PropId, { d: string; filled: boolean }>> = {
  // A bold question mark: the bowl, the stem, and a dot.
  'question-mark': {
    d: 'M-3.1-4.4a3.3 3.3 0 1 1 5.1 2.8q-2 1.3-2 3.1M0 5.6v0.1',
    filled: false,
  },
  // A four-pointed sparkle.
  sparkle: {
    d: 'M0-6 1.5-1.5 6 0 1.5 1.5 0 6-1.5 1.5-6 0-1.5-1.5Z',
    filled: true,
  },
  'sweat-drop': {
    d: 'M0-5.2C3.1-0.9 3.6 1 3.6 2.1a3.6 3.6 0 0 1-7.2 0C-3.6 1-3.1-0.9 0-5.2Z',
    filled: true,
  },
  // An outline battery: body plus terminal.
  battery: {
    d: 'M-5.4-2.8h9.2v5.6h-9.2zM3.8-1.1h1.6v2.2h-1.6z',
    filled: false,
  },
  // Sunglasses: two rounded lenses, a bridge and hinged temples. This is the one
  // prop authored wide rather than tall, because it has to span both eyes; the
  // sequence that wears it sets the scale, and `cool` is the only group that
  // does. It is drawn in the body frame like the other props, so the sequence
  // that wears it holds `faceTilt` at zero -- a tilted face would slide the eyes
  // out from behind the lenses.
  sunglasses: {
    d:
      'M-16.5-5.6h15a2.6 2.6 0 0 1 2.6 2.6v6.4a2.6 2.6 0 0 1-2.6 2.6h-15a2.6 2.6 0 0 1-2.6-2.6v-6.4a2.6 2.6 0 0 1 2.6-2.6Z' +
      'M1.5-5.6h15a2.6 2.6 0 0 1 2.6 2.6v6.4a2.6 2.6 0 0 1-2.6 2.6h-15a2.6 2.6 0 0 1-2.6-2.6v-6.4a2.6 2.6 0 0 1 2.6-2.6Z' +
      'M-1.6-3.6h3.2v2.4h-3.2Z' +
      'M-19.1-3.9h-2.3a1.2 1.2 0 0 0-1.2 1.2v1.9a1.2 1.2 0 0 0 1.2 1.2h2.3Z' +
      'M19.1-3.9h2.3a1.2 1.2 0 0 1 1.2 1.2v1.9a1.2 1.2 0 0 1-1.2 1.2h-2.3Z',
    filled: true,
  },
};

function renderProp(prop: PropRig, paint: Paint): string {
  // A prop that has faded to nothing is left out rather than drawn at zero. The
  // difference only matters for the element count, and dropping it keeps a
  // resting character's markup identical to one that never had props at all.
  if (prop.opacity <= 0.001) return '';

  const path = PROP_PATHS[prop.id];
  const transform = [
    `translate(${n(prop.x)} ${n(prop.y)})`,
    `rotate(${n(prop.rotation)})`,
    `scale(${n(prop.scale)})`,
  ].join(' ');
  const draw = path.filled
    ? `fill="${paint.ink}"`
    : `fill="none" stroke="${paint.ink}" stroke-width="2.2" stroke-linecap="round"`;

  // `data-prop` is what makes "which prop is on screen" a fact about the markup
  // rather than something a test has to infer by diffing two SVG strings. The
  // animation contract is entirely about which sequence put which asset in the
  // scene, so that is worth naming in the output.
  return (
    `<g data-prop="${prop.id}" transform="${transform}" opacity="${n(Math.min(1, prop.opacity))}">` +
    `<path d="${path.d}" ${draw}/></g>`
  );
}

/** The brow: an arc bowing upward from its chord. */
export function browPath(brow: BrowRig): string {
  const half = (brow.length * brow.scale) / 2;
  return `M${n(-half)} 0Q0 ${n(-brow.arch * brow.scale * 2)} ${n(half)} 0`;
}

/**
 * The smile: a wide arc below its chord, drawn from the measured centreline.
 * The chord midpoint sits at the origin of the smile's own frame.
 */
export function smilePath(smile: SmileRig): string {
  const half = smile.span / 2;
  const pts = SMILE_PROFILE.map(([u, v]) => ({
    x: u * half,
    y: v * smile.depth,
  }));
  return smoothPath(pts, 0.9);
}

// ─── renderer ────────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Rendered width/height in CSS pixels. Defaults to the viewBox size. */
  size?: number;
  /** Accessible title; omit for decorative use. */
  title?: string;
  /** Extra class on the root <svg>. */
  className?: string;
  /** When false (default) the svg is marked aria-hidden. */
  decorative?: boolean;
  /**
   * Emit colours as CSS custom properties (`--sunny-*`) instead of literal hex.
   * Useful for re-theming a live DOM node without re-rendering, but NOT
   * understood by rasterisers such as resvg, so it is off by default.
   */
  cssVariables?: boolean;
  /**
   * Override the viewBox. Used by tooling to produce tightly-cropped thumbnails
   * for comparison against the reference artwork. Defaults to the full viewBox.
   */
  crop?: { x: number; y: number; width: number; height: number };
  /**
   * Give every generated id a unique suffix so several instances can coexist in
   * one document. Off by default so output stays deterministic for tests.
   */
  uniqueIds?: boolean;
}

interface Paint {
  body: string;
  ray: string;
  ink: string;
  highlight: string;
}

function painters(rig: SunnyRig, cssVariables: boolean): Paint {
  if (cssVariables) {
    return {
      body: 'var(--sunny-body)',
      ray: 'var(--sunny-ray)',
      ink: 'var(--sunny-ink)',
      highlight: 'var(--sunny-highlight)',
    };
  }
  return {
    body: rig.theme.body,
    ray: rig.theme.ray,
    ink: rig.theme.ink,
    highlight: rig.theme.highlight,
  };
}

let instanceCounter = 0;

function renderEye(side: 'left' | 'right', eye: EyeRig, paint: Paint, uid: string): string {
  const closed = Math.max(0, Math.min(1, eye.closed));
  const outline = eyeOutlinePath(eye);
  const clipId = `sunny-eye-${uid}-${side}`;
  // A blink collapses the eye about its own centre line.
  const scaleY = eye.scaleY * (1 - closed * 0.94);
  const transform = [
    `translate(${n(eye.x)} ${n(eye.y)})`,
    `rotate(${n(eye.rotation)})`,
    `scale(${n(eye.scaleX)} ${n(scaleY)})`,
  ].join(' ');
  // Gaze nudges the highlight, which is what reads as the eye looking around.
  const gazeX = eye.gaze.x * eye.width * 0.1;
  const gazeY = eye.gaze.y * eye.height * 0.06;
  return [
    `<g transform="${transform}">`,
    `<clipPath id="${clipId}"><path d="${outline}"/></clipPath>`,
    // Base: the whole opening reads dark, so the crescent is simply whatever
    // the highlight does not cover.
    `<path d="${outline}" fill="${paint.ink}"/>`,
    `<g clip-path="url(#${clipId})">`,
    `<path d="${eyeHighlightPath(eye)}" transform="translate(${n(gazeX)} ${n(gazeY)})" fill="${paint.highlight}"/>`,
    `</g>`,
    // The outline is re-stroked on top, so the highlight can never eat into it.
    `<path d="${outline}" fill="none" stroke="${paint.ink}" stroke-width="${n(EYE.strokeWidth * 2)}"/>`,
    `</g>`,
  ].join('');
}

function renderBrow(brow: BrowRig, paint: Paint): string {
  return [
    `<g transform="translate(${n(brow.x)} ${n(brow.y)}) rotate(${n(brow.rotation)})">`,
    `<path d="${browPath(brow)}" fill="none" stroke="${paint.ink}" stroke-width="${n(BROW.strokeWidth)}" stroke-linecap="round"/>`,
    `</g>`,
  ].join('');
}

function renderSmile(smile: SmileRig, paint: Paint): string {
  return [
    `<g transform="translate(${n(smile.x)} ${n(smile.y)}) rotate(${n(smile.rotation)})">`,
    `<path d="${smilePath(smile)}" fill="none" stroke="${paint.ink}" stroke-width="${n(smile.strokeWidth)}" stroke-linecap="round"/>`,
    `</g>`,
  ].join('');
}

/**
 * Render a rig to an SVG string.
 */
export function renderSunny(rig: SunnyRig, options: RenderOptions = {}): string {
  const viewBox = options.crop
    ? `${n(options.crop.x)} ${n(options.crop.y)} ${n(options.crop.width)} ${n(options.crop.height)}`
    : `0 0 ${VIEWBOX} ${VIEWBOX}`;
  const size = options.size ?? VIEWBOX;
  const paint = painters(rig, options.cssVariables ?? false);
  const uid = options.uniqueIds ? `u${instanceCounter++}-` : '';
  const squash = 1 - rig.squash;
  const stretch = 1 + rig.stretch;

  // The whole character is authored about the origin; the root transform places
  // it in the viewBox. Rays, body and face all share the body-local frame.
  const root = [
    `translate(${n(rig.x)} ${n(rig.y)})`,
    `rotate(${n(rig.rotation)})`,
    `scale(${n(rig.scale * stretch)} ${n(rig.scale * squash)})`,
  ].join(' ');

  // Each ray is painted twice: the outlined shape first, then the orange fill on
  // top. That leaves the outline entirely outside the fill, which is what the
  // reference artwork does (its ray outline sits outside the orange, unlike the
  // body outline, which is centred on its path).
  const rays = rig.rays
    .filter((r) => r.visible && r.lengthScale > 0.01)
    .map((r) => {
      const d = roundedPolygonPath(rayPoints(r), [
        RAY.apexRadius,
        RAY.cornerRadius,
        RAY.cornerRadius,
      ]);
      return (
        `<path d="${d}" fill="none" stroke="${paint.ink}" stroke-width="${n(RAY.strokeWidth)}" stroke-linejoin="round"/>` +
        `<path d="${d}" fill="${paint.ray}"/>`
      );
    })
    .join('');

  const face = [
    renderEye('left', rig.eyes.left, paint, uid),
    renderEye('right', rig.eyes.right, paint, uid),
    renderBrow(rig.brows.left, paint),
    renderBrow(rig.brows.right, paint),
    renderSmile(rig.smile, paint),
  ].join('');

  // Props sit in the body frame rather than the face frame: a question mark or a
  // held prop should not tilt with the head.
  const props = rig.props.map((prop) => renderProp(prop, paint)).join('');

  // Accessibility is derived, not asserted twice.
  //
  // This used to default to `aria-hidden` unconditionally, which meant
  // `renderSunny(rig, { title: 'Sunny' })` produced an SVG that was hidden from
  // assistive technology *and* carried a title -- markup whose label nothing
  // could ever read. Naming the character is a statement that it is content, so
  // a title now implies a labelled image; `aria-hidden` is what you get when
  // neither a title nor `decorative: false` says otherwise. An explicit
  // `decorative: true` alongside a title wins, and the title is dropped rather
  // than left as unreachable markup.
  const named = options.title !== undefined && options.title !== '';
  const decorative = options.decorative ?? !named;
  const label = named && !decorative ? `<title>${escapeXml(options.title ?? '')}</title>` : '';
  const aria = decorative
    ? 'aria-hidden="true" focusable="false"'
    : `role="img" aria-label="${escapeXml(options.title ?? 'Sunny')}"`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${n(size)}" height="${n(size)}" ${aria}${options.className ? ` class="${escapeXml(options.className)}"` : ''}>`,
    label,
    `<g transform="${root}">`,
    `<g>${rays}</g>`,
    `<circle cx="0" cy="0" r="${n(BODY.radius)}" fill="${paint.body}" stroke="${paint.ink}" stroke-width="${n(BODY.strokeWidth)}"/>`,
    `<g transform="rotate(${n(rig.faceTilt)})">${face}</g>`,
    props,
    `</g>`,
    `</svg>`,
  ].join('');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
