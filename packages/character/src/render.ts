// Pure SVG renderer for the Sunny rig.
//
// `renderSunny(rig)` is deterministic and side-effect free: the same rig always
// produces byte-identical SVG. That property is what the animation replay and
// screenshot tests rely on.

import { BODY, BROW, EYE, EYE_HIGHLIGHT, RAY, SMILE_PROFILE, VIEWBOX } from './geometry.js';
import type { BrowRig, EyeRig, PropId, PropRig, RayRig, SmileRig, SunnyRig, Vec2 } from './rig.js';
import { SUNNY_THEME } from './tokens.js';

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
 * a plain multiplier and a sequence can size one without knowing its geometry --
 * except the pieces of scenery, which say so in their own comments.
 *
 * Three paintings, and the third exists because the first two are not enough for
 * furniture. `filled: false` draws an ink stroke, which is right for a mark --
 * a question mark, the temple of a pair of glasses -- and `filled: true` draws a
 * solid ink mass, which is right for a small sign like a sparkle. Neither can
 * draw an *object*: the character's own language is a black outline around a
 * flat fill, so furniture drawn as a black silhouette reads as a hole in the
 * scene and a chair drawn in hairlines disappears at launcher size. `surface`
 * is the third painting -- an outline around the theme's surface colour -- and
 * it is what makes a prop look like something the character owns rather than
 * something stamped on top of them. It re-tints with the theme, so a tenant's
 * purple character gets a lilac chair.
 */
const PROP_PATHS: Readonly<Record<PropId, { d: string; filled: boolean; surface?: boolean }>> = {
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
  // A folding deckchair, drawn open and reclined: a fabric sling running out to
  // the foot end, a back leaning away to the upper left, a bar across the top of
  // it, and a leg frame underneath.
  //
  // Authored in the *body* frame rather than its own, which is the only prop that
  // does so, and for a reason that is really a constraint: this one is furniture
  // a 47-unit-radius body has to sit *in*, so its geometry is not about a chair's
  // proportions, it is about where a seat's front edge and a back's inner edge
  // land relative to the sun's silhouette. Authoring it in place means the
  // sequence that deploys it places it at the origin and the numbers here are the
  // composition.
  //
  // The back is not placed by eye. A straight back that leans up and to the left
  // and is anchored under the body *must* cross the silhouette, because the
  // circle bulges further out at shoulder height than any chord can: a line from
  // under her bottom to above her head is either vertical, or it passes through
  // her. The back below is the line that clears the circle all the way along --
  // it runs at a distance of ~50 from the centre against a radius of 47.26, so it
  // is a tangent with about 2.7 units of clearance -- and the lean that falls out
  // of that constraint (~30 degrees off vertical) is a deckchair's recline, not a
  // compromise. Attempts to draw it steeper put the panel across her eye.
  //
  // The sling's front edge sits just below her bottom edge rather than through
  // it, so the whole chair reads as supporting her from underneath and nothing is
  // drawn against her face. It is filled rather than stroked because at launcher
  // size a line drawing of a chair is a tangle of hairlines: see D-20.
  //
  // The unfold is the prop's own transform, not articulation: the chair scales up
  // from a third and rotates into place, so it whips open rather than hinging. A
  // real fold would need props made of parts, which the model does not have.
  deckchair: {
    d:
      // The back panel, tangent to the silhouette, leaning up-left.
      'M-38.5 35-66.5-19-89.5-7-61.5 47Z' +
      // The sling: the seat, running back under her from the knee.
      'M-60 47 27.4 56 28.6 68-59 59Z' +
      // ...and the foot section, turned up at the knee.
      'M24.7 57 60.7 33 67.3 43 31.3 67Z' +
      // Legs and the cross-brace under the sling.
      'M-29.9 53.9-35.9 79.9-39.7 78.7-33.7 52.7Z' +
      'M25.9 65.9 30.9 87.9 27.1 89.1 22.1 67.1Z' +
      'M-40 72h74v3h-74Z',
    filled: true,
    surface: true,
  },
  // A balloon, drawn at the size it is used at (the second prop authored in the
  // body frame, and for the same kind of reason the deckchair is): a balloon is
  // *held against the character* -- it rises past her rays and its knot hangs
  // over her shoulder -- so its scale is a fact about the composition rather
  // than about the prop. The origin is the balloon's own centre rather than the
  // bottom of a string, because that is the point a tap hits and the point the
  // pop bursts from.
  //
  // A balloon is the clearest case for the `surface` painting: it is an object
  // with an inside, so it takes the tenant's surface colour rather than being
  // inked, and a hollow outline of a balloon at launcher size reads as a ring.
  //
  // There is no string, and that is a decision rather than an omission. A string
  // drawn in this path would carry the character's own ink weight -- 2.2 units,
  // the same as the balloon's outline, because a path here has exactly one
  // stroke -- and at the sizes this is actually seen a 2-unit line twelve units
  // long is a black smear beside the balloon rather than a string. The measured
  // versions of both are in the commit that added this. A round envelope, a
  // taper and a knot read as a balloon on their own.
  balloon: {
    d:
      // The envelope: round at the top, tapering to the neck.
      'M0-15.4C7.9-15.4 13.6-9.4 13.6-2.2 13.6 6.4 7.2 13.6 3.4 16.6L-3.4 16.6' +
      'C-7.2 13.6-13.6 6.4-13.6-2.2-13.6-9.4-7.9-15.4 0-15.4Z' +
      // The knot at the neck.
      'M-3.4 15.4H3.4L1.6 19.6H-1.6Z',
    filled: true,
    surface: true,
  },
  // A ping-pong bat, held upright: the blade, then a short handle. Authored tall
  // rather than wide -- the second prop that is, after the deckchair's scenery --
  // because the ball has to meet the blade's *face*, and A09's rules decide
  // whether it did by comparing y against the bat's half-length. The bat is
  // `surface`-painted for the reason the balloon is: it is an object with an
  // inside, and a black silhouette at the end of a ray would read as another ray.
  // Its half-length is the number the rules are told (see `@sunny/games`), so
  // lengthening the blade here without changing `PADDLE_HALF` there would put the
  // bounce either inside the bat or short of it.
  paddle: {
    d:
      'M-7-17H7A1.6 1.6 0 0 1 8.6-15.4V7.4A1.6 1.6 0 0 1 7 9H-7A1.6 1.6 0 0 1-8.6 7.4V-15.4A1.6 1.6 0 0 1-7-17Z' +
      'M-3.4 9H3.4V14A3.4 3.4 0 0 1-3.4 14Z',
    filled: true,
    surface: true,
  },
  // ── A11, the plant ─────────────────────────────────────────────────────────
  //
  // Three props rather than one, because the row names four stages -- "seed,
  // shine, sprout, flower" -- and the model cannot morph a prop: a prop is one
  // path with one transform, so a plant that grows has to be a plant that is
  // *replaced* by the next one. The staging is therefore a cross-fade: each
  // stage is its own prop, faded in as the one before it fades out, which is
  // also why the three share an origin.
  //
  // **The seed and the seedling are solid ink marks**, the way the sparkle and
  // the sweat-drop are: both are small, and a 2.2-unit outline around a 9-unit
  // object is a smudge rather than an inside. The flower is the first thing in
  // this moment big enough to have one.
  //
  // A seed is a teardrop standing on its point -- round above, pointed below --
  // so the point is the end that goes into the ground.
  seed: {
    d: 'M0 4.4C2.8 1.6 3.6-0.2 3.6-1.6A3.6 3.6 0 0 0-3.6-1.6C-3.6-0.2-2.8 1.6 0 4.4Z',
    filled: true,
  },
  // The sprout and the flower are authored **with their origin at the base**,
  // unlike every other prop here, which is centred on itself. A plant grows from
  // where it is planted: with the origin at the base the `scale` a sequence
  // animates is the plant growing rather than the plant inflating, and the two
  // stages share a planting point as a consequence of their geometry instead of
  // by a constant someone has to keep in step. Both are `surface`-painted,
  // because they are objects with an inside: a stem drawn as a bare ink line is
  // a mark, and a flower made of marks is a doodle rather than a plant.
  //
  // Both are drawn *upright*, and it is the sequence that leans one outward.
  // That is the opposite of the deckchair, which is authored in the body frame
  // because the body has to sit in it; a plant has no such relationship with the
  // character and is a plain object standing beside her.
  //
  // The stem is 4 units wide rather than a hairline for the same reason: the
  // outline is 2.2 units, and a 2-unit stem would be all outline.
  //
  // The seedling is smaller than the flowering plant on purpose -- a shoot and a
  // flower are the same plant, and a seedling drawn at the size of the thing it
  // becomes is not a seed that grew.
  //
  // The leaves are short next to the stem, which is a decision about the scene
  // rather than about the plant: a leaf reaching 12 units to the side is a leaf
  // that lands across one of the character's rays, and a stem with wings is
  // worse in this composition than a stem with leaves. Both stages keep them
  // short for the same reason, and the flower's are the seedling's scaled up so
  // the cross-fade from one to the other is a plant getting bigger.
  //
  // The bloom is six petals of radius 6 on a ring of radius 8 about (0, -30):
  // big enough at launcher size that the cream inside each petal reads, and
  // small enough that the six outlines crossing in the middle read as petals
  // rather than as a scribble. The centre they leave uncovered is the flower's
  // middle, which is why there is no disc drawn there, and the ring is centred
  // on the stem rather than offset to one side so that the flower leans away
  // from the character as one object instead of the head drooping off its own
  // stalk.
  sprout: {
    d:
      // The stem, from the planting point up.
      'M-1.6 0H1.6V-8H-1.6Z' +
      // One leaf to each side, the right one set higher, because a seedling
      // whose leaves are level reads as a machine part rather than a plant.
      'M-0.9-4.7C-2.8-6.1-5.8-5.9-6.6-4.4-5.5-2.9-2.7-3.1-0.8-4.4Z' +
      'M0.9-7.8C2.8-9.2 5.8-9 6.6-7.6 5.5-6 2.7-6.2 0.8-7.6Z',
    filled: true,
  },
  flower: {
    d:
      // The stem, with its two leaves where the seedling had them.
      'M-2 0H2V-22H-2Z' +
      'M-1.3-6.8C-4-8.6-8.3-8.4-9.4-6.3-7.8-4.2-3.8-4.4-1.1-6.3Z' +
      'M1.3-11.2C4-13.1 8.3-12.9 9.4-10.8 7.8-8.6 3.8-8.8 1.1-10.8Z' +
      // The bloom: a ring of six petals of radius 6 about (0, -30), which
      // `sequences.ts` is told as `BLOOM_UP` so the gaze can be aimed at it.
      'M2-30a6 6 0 1 0 12 0 6 6 0 1 0-12 0Z' +
      'M-2-23.1a6 6 0 1 0 12 0 6 6 0 1 0-12 0Z' +
      'M-10-23.1a6 6 0 1 0 12 0 6 6 0 1 0-12 0Z' +
      'M-14-30a6 6 0 1 0 12 0 6 6 0 1 0-12 0Z' +
      'M-10-36.9a6 6 0 1 0 12 0 6 6 0 1 0-12 0Z' +
      'M-2-36.9a6 6 0 1 0 12 0 6 6 0 1 0-12 0Z',
    filled: true,
    surface: true,
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
  const draw = path.surface
    ? `fill="${paint.highlight}" stroke="${paint.ink}" stroke-width="2.2" stroke-linejoin="round"`
    : path.filled
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

/**
 * The colour forms a theme value may take.
 *
 * Written as an allow-list rather than a set of banned characters because what
 * it has to guarantee is a negative: whatever matches cannot contain `"`, `'`,
 * `<`, `>`, `&`, `;`, `{`, `}` or `\`, so it cannot close the quoted attribute
 * it is painted into, open an element, or start a new declaration. Every branch
 * ends at the same place -- a value that matches is a colour and nothing else.
 *
 * `var()` is deliberately accepted only as a bare token reference. A fallback
 * (`var(--x, #fff)`) adds a comma and a nested value for no benefit here, and
 * the narrower branch is easier to be sure of than a broader one.
 */
const SAFE_PAINT =
  /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z][a-zA-Z0-9-]{0,31}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([#a-zA-Z0-9%\s.,/+-]*\)|var\(--[a-zA-Z0-9-]{1,32}\))$/;

/**
 * `value` when it is a colour that is safe to paint, `fallback` otherwise.
 *
 * The theme is the one string a tenant controls that the renderer interpolates
 * into markup -- `fill="${paint.body}"`, `stroke="${paint.ink}"` -- so a value
 * that can close the quote is an element, not a colour. Rejecting it here keeps
 * that from being true of the output.
 *
 * This is a second line, not the first: the API validates a tenant's colour
 * against the widget schema before serving it. It is here because the renderer
 * must not depend on its caller having validated anything -- `renderSunny` is a
 * public export and has more than one way in.
 */
export function safePaint(value: string, fallback: string): string {
  return SAFE_PAINT.test(value) ? value : fallback;
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
  // A rejected paint falls back to the canonical token rather than to nothing:
  // the character is still drawn, in the brand colour, so a tenant with a bad
  // colour sees a different orange rather than a hole where the body was.
  return {
    body: safePaint(rig.theme.body, SUNNY_THEME.body),
    ray: safePaint(rig.theme.ray, SUNNY_THEME.ray),
    ink: safePaint(rig.theme.ink, SUNNY_THEME.ink),
    highlight: safePaint(rig.theme.highlight, SUNNY_THEME.highlight),
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
