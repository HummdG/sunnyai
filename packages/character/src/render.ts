// Pure SVG renderer for the Sunny rig.
//
// `renderSunny(rig)` is deterministic and side-effect free: the same rig always
// produces byte-identical SVG. That property is what the animation replay and
// screenshot tests rely on.

import { EYE, EYE_HIGHLIGHT, RAY, SMILE_PROFILE, VIEWBOX } from './geometry.js';
import type { BrowRig, EyeRig, PropId, PropRig, RayRig, SmileRig, SunnyRig, Vec2 } from './rig.js';
import { SUNNY_THEME } from './tokens.js';
import { armParts, legMarkup, limbRayIndices } from './limbs.js';
import { toViewBox } from './rig.js';
import {
  tracedBody,
  tracedBrowPart,
  tracedEyePart,
  tracedMouthPart,
  tracedRayPart,
  type PartDrawing,
} from './traced-render.js';

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
const PROP_PATHS: Readonly<
  Record<PropId, { d: string; filled: boolean; surface?: boolean; colour?: string }>
> = {
  // A bold question mark: the bowl, the stem, and a dot.
  'question-mark': {
    d: 'M-3.1-4.4a3.3 3.3 0 1 1 5.1 2.8q-2 1.3-2 3.1M0 5.6v0.1',
    filled: false,
  },
  // The eureka lightbulb from the pose sheet: a round glass bulb, a waisted
  // neck and a ribbed screw base. Surface-painted so it reads as an object.
  lightbulb: {
    d:
      'M0-11C5.6-11 9-7 9-2.6 9 1 7 3 5.4 4.8 4.4 6 4 7.2 4 8.4H-4C-4 7.2-4.4 6-5.4 4.8-7 3-9 1-9-2.6-9-7-5.6-11 0-11Z' +
      'M-4 9.4H4V11H-4Z' +
      'M-3.4 12H3.4L2.4 14.4H-2.4Z',
    filled: true,
    surface: true,
    // Yellow, as on the sheet: a pale bulb read as a white blob at launcher size.
    colour: '#FFD54A',
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
  // Held props from the sheet, drawn by their own art functions below (fixed
  // colours: a book is blue whatever the theme). The paths are unused.
  book: { d: '', filled: true },
  'book-page': { d: '', filled: true },
  laptop: { d: '', filled: true },
  magnifier: { d: '', filled: true },
  clipboard: { d: '', filled: true },
  envelope: { d: '', filled: true },
  paintbrush: { d: '', filled: true },
  padlock: { d: '', filled: true },
  'price-tag': { d: '', filled: true },
  plug: { d: '', filled: true },
  phone: { d: '', filled: true },
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
    ? `fill="${path.colour ?? paint.highlight}" stroke="${paint.ink}" stroke-width="2.2" stroke-linejoin="round"`
    : path.filled
      ? `fill="${paint.ink}"`
      : `fill="none" stroke="${paint.ink}" stroke-width="2.2" stroke-linecap="round"`;

  // `data-prop` is what makes "which prop is on screen" a fact about the markup
  // rather than something a test has to infer by diffing two SVG strings. The
  // animation contract is entirely about which sequence put which asset in the
  // scene, so that is worth naming in the output.
  const custom = PROP_ART[prop.id];
  const art = custom ? custom(paint) : `<path d="${path.d}" ${draw}/>`;
  return (
    `<g data-prop="${prop.id}" transform="${transform}" opacity="${n(Math.min(1, prop.opacity))}">` +
    art +
    `</g>`
  );
}

/** Props drawn behind Sunny (furniture Sunny sits in). */
export const BEHIND_PROPS: readonly PropId[] = ['deckchair'];
/** Props held in front of the body, under the hands that hold them. */
export const HELD_PROPS: readonly PropId[] = [
  'book',
  'book-page',
  'laptop',
  'magnifier',
  'clipboard',
  'envelope',
  'paintbrush',
  'padlock',
  'price-tag',
  'plug',
  'phone',
];
/** Props worn on the face, drawn in the face frame so they follow its tilt. */
export const FACE_PROPS: readonly PropId[] = ['sunglasses'];

/**
 * Classic 1930s/wayfarer shades, authored in the face frame: the two lenses sit
 * over the traced eyes when the prop is placed at the eyes' midpoint with the
 * eye line's tilt (see the cool-shades sequence). Black lenses with a thick
 * frame, a bridge, short temples and a cheeky glint on each lens.
 */
const SUNGLASSES_ART = (paint: Paint): string => {
  const lens = (cx: number): string =>
    `M${cx - 13.5} -8.5C${cx - 4} -10 ${cx + 4} -10 ${cx + 13} -8.5` +
    `C${cx + 13.5} -2 ${cx + 12} 6 ${cx + 7.5} 9C${cx + 3} 11 ${cx - 5} 11 ${cx - 9} 8.5` +
    `C${cx - 12.5} 6 ${cx - 14} -2 ${cx - 13.5} -8.5Z`;
  const glint = (cx: number): string => `M${cx - 8} -4.5L${cx - 4} -7M${cx - 8.5} 0L${cx - 7} -1.4`;
  return (
    `<path d="${lens(-15.5)}${lens(15.5)}" fill="#1B1B1F" stroke="${paint.ink}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M-2.4 -6.5C-1 -8.6 1 -8.6 2.4 -6.5" fill="none" stroke="${paint.ink}" stroke-width="3.2" stroke-linecap="round"/>` +
    `<path d="M-28.6 -8L-34 -7M28.6 -8L34 -7" fill="none" stroke="${paint.ink}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="${glint(-15.5)}${glint(15.5)}" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>`
  );
};

/**
 * A striped seaside deckchair from the pose sheet, side on, facing left:
 * a wooden frame (a long back rail, a front leg and the seat strut) and a
 * blue-and-white canvas sling running from the top of the back rail, sagging
 * under the seat, to the front bar. Authored so a reclining Sunny's body
 * centre sits at the origin, in the sling. Fixed colours: a deckchair is a
 * deckchair whatever the installer's theme.
 */
const DECKCHAIR_ART = (paint: Paint): string => {
  const wood = '#C98B4A';
  const rail = (d: string, w: number): string =>
    `<path d="${d}" fill="none" stroke="${paint.ink}" stroke-width="${w + 4.6}" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="${wood}" stroke-width="${w}" stroke-linecap="round"/>`;
  // Canvas centreline: from the top crossbar, down behind the back, under the
  // seat and up to the front bar.
  const sling = 'M44 -62C52 -20 52 30 24 50C2 64 -30 52 -50 34';
  return (
    // Back leg / rail and the front leg, behind the canvas.
    rail('M46 -64L78 76', 5) +
    rail('M-50 34L-70 78', 5) +
    rail('M-40 36L32 78', 4.2) +
    // The canvas: an inked band, white, then blue stripes as dashes along it.
    `<path d="${sling}" fill="none" stroke="${paint.ink}" stroke-width="24" stroke-linecap="butt"/>` +
    `<path d="${sling}" fill="none" stroke="#FFFFFF" stroke-width="19.4" stroke-linecap="butt"/>` +
    `<path d="${sling}" fill="none" stroke="#2F6FD6" stroke-width="19.4" stroke-dasharray="9 9" stroke-linecap="butt"/>` +
    // The crossbars at each end of the canvas.
    rail('M38 -64L52 -60', 3.6) +
    rail('M-54 30L-44 40', 3.6)
  );
};

/**
 * An open book held up in both hands (sheet: third row, second): a blue cover
 * behind two white pages with a few lines of text and the spine down the
 * middle. Authored about its centre, about 56 units across.
 */
const BOOK_ART = (paint: Paint): string => {
  const ink = paint.ink;
  const cover = 'M-31 -17L0 -13L31 -17L31 18L0 22L-31 18Z';
  const pages = 'M-27.5 -14.5L0 -10.5L27.5 -14.5L27.5 15L0 19L-27.5 15Z';
  const lines = [-7, -2, 3, 8].map((y) => `M-23 ${y - 2.6}L-5 ${y}M5 ${y}L23 ${y - 2.6}`).join('');
  return (
    `<path d="${cover}" fill="#2F6FD6" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<path d="${pages}" fill="#FFFFFF" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>` +
    `<path d="M0 -10.5L0 19" stroke="${ink}" stroke-width="1.8"/>` +
    `<path d="${lines}" stroke="#9AA3AF" stroke-width="1.4" stroke-linecap="round"/>`
  );
};

/** A page mid-turn, lifting off the right-hand page. */
const BOOK_PAGE_ART = (paint: Paint): string =>
  `<path d="M0 -10.5C8 -20 18 -22 22 -20L22 10C16 8 8 10 0 19Z" fill="#FFFFFF" stroke="${paint.ink}" stroke-width="1.8" stroke-linejoin="round"/>`;

/**
 * A laptop on the lap, seen from the side so the visitor sees the back of the
 * lid and the keyboard edge (sheet: third row, third). About 60 units across.
 */
const LAPTOP_ART = (paint: Paint): string => {
  const ink = paint.ink;
  return (
    `<path d="M-6 -24L32 -20L28 12L-10 12Z" fill="#B7BCC4" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<circle cx="11" cy="-5" r="3.2" fill="#E6E9ED"/>` +
    `<path d="M-34 12L30 12L34 19L-30 19Z" fill="#9AA0A8" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>`
  );
};

/**
 * A magnifying glass (sheet: third row, fourth): a thick grey rim round a pale
 * glass with a glint, and a wooden handle running down to the lower left.
 * The origin is the centre of the glass.
 */
const MAGNIFIER_ART = (paint: Paint): string => {
  const ink = paint.ink;
  return (
    `<path d="M-9 9L-22 22" stroke="${ink}" stroke-width="9.4" stroke-linecap="round"/>` +
    `<path d="M-9 9L-22 22" stroke="#9A6334" stroke-width="5.2" stroke-linecap="round"/>` +
    `<circle r="14" fill="#DDEFFF" fill-opacity="0.55" stroke="${ink}" stroke-width="7.6"/>` +
    `<circle r="14" fill="none" stroke="#A9AFB7" stroke-width="3.6"/>` +
    `<path d="M-7 -5C-5 -8.5 -1.5 -10 2 -9.6" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>`
  );
};

/** An inked shape: a path filled `fill` with the character's ink line. */
const inked = (paint: Paint, d: string, fill: string, width = 2.4): string =>
  `<path d="${d}" fill="${fill}" stroke="${paint.ink}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
const stroked = (paint: Paint, d: string, width = 2): string =>
  `<path d="${d}" fill="none" stroke="${paint.ink}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A clipboard with a ticked list: qualifying an enquiry. About 30 by 40. */
const CLIPBOARD_ART = (paint: Paint): string =>
  inked(
    paint,
    'M-15 -18Q-15 -21 -12 -21H12Q15 -21 15 -18V19Q15 22 12 22H-12Q-15 22 -15 19Z',
    '#C98B4A',
  ) +
  inked(paint, 'M-11 -15H11V18H-11Z', '#FFFFFF', 1.8) +
  inked(paint, 'M-6 -24H6V-17H-6Z', '#B7BCC4', 2) +
  stroked(paint, 'M-8 -8L-6 -6L-3 -10M-8 0L-6 2L-3 -2M-8 8L-6 10L-3 6', 1.8).replace(
    paint.ink,
    '#FF7900',
  ) +
  stroked(paint, 'M0 -8H8M0 0H8M0 8H6', 1.4).replace(paint.ink, '#9AA3AF');

/** A sealed envelope: a lead, handed over. About 40 by 26. */
const ENVELOPE_ART = (paint: Paint): string =>
  inked(paint, 'M-20 -13H20V13H-20Z', '#FFFDF7') +
  stroked(paint, 'M-20 -13L0 3L20 -13M-20 13L-6 0M20 13L6 0', 1.8) +
  `<circle cx="0" cy="3" r="4.6" fill="#FF7900" stroke="${paint.ink}" stroke-width="1.8"/>`;

/** A paintbrush, loaded with orange: Sunny wearing your colours. */
const PAINTBRUSH_ART = (paint: Paint): string =>
  inked(paint, 'M-2.4 4L2.4 4L1.6 24Q0 26 -1.6 24Z', '#C98B4A', 2) +
  inked(paint, 'M-3 -4H3V4H-3Z', '#B7BCC4', 2) +
  inked(paint, 'M-3 -4Q-5 -14 0 -22Q5 -14 3 -4Z', '#FF7900', 2);

/** A padlock: privacy and trust. About 26 by 30. */
const PADLOCK_ART = (paint: Paint): string =>
  stroked(paint, 'M-8 -2V-9Q-8 -17 0 -17Q8 -17 8 -9V-2', 6.4) +
  `<path d="M-8 -2V-9Q-8 -17 0 -17Q8 -17 8 -9V-2" fill="none" stroke="#B7BCC4" stroke-width="2.6" stroke-linecap="round"/>` +
  inked(
    paint,
    'M-13 -3Q-13 -5 -11 -5H11Q13 -5 13 -3V13Q13 15 11 15H-11Q-13 15 -13 13Z',
    '#FFC94A',
  ) +
  inked(paint, 'M0 2.5A2.6 2.6 0 1 0 0.01 2.5ZM-1.2 3.5H1.2L1.8 9H-1.8Z', paint.ink, 1);

/** A swing tag on a string: a price. About 34 by 22. */
const PRICE_TAG_ART = (paint: Paint): string =>
  inked(paint, 'M-17 -9H9L17 0L9 9H-17Z', '#FFFDF7') +
  `<circle cx="9" cy="0" r="2.4" fill="#FBF4E8" stroke="${paint.ink}" stroke-width="1.6"/>` +
  stroked(paint, 'M-12 -3H2M-12 3H-2', 1.6).replace(paint.ink, '#FF7900');

/** A plug on its cable: integrations. The cable trails down and away. */
const PLUG_ART = (paint: Paint): string =>
  stroked(paint, 'M0 10C0 24 -16 22 -18 34', 4.8) +
  `<path d="M0 10C0 24 -16 22 -18 34" fill="none" stroke="#FF7900" stroke-width="2.2" stroke-linecap="round"/>` +
  inked(paint, 'M-4 -18V-11M4 -18V-11', '#B7BCC4', 2.4) +
  inked(paint, 'M-8 -11H8V5Q8 10 3 10H-3Q-8 10 -8 5Z', '#B7BCC4');

/** A phone with a notification: the lead arriving. About 22 by 40. */
const PHONE_ART = (paint: Paint): string =>
  inked(
    paint,
    'M-11 -20Q-11 -23 -8 -23H8Q11 -23 11 -20V20Q11 23 8 23H-8Q-11 23 -11 20Z',
    paint.ink,
  ) +
  inked(paint, 'M-8 -18H8V17H-8Z', '#FFFDF7', 1) +
  inked(
    paint,
    'M-6 -12H6Q7 -12 7 -11V-5Q7 -4 6 -4H-2L-5 -1V-4H-6Q-7 -4 -7 -5V-11Q-7 -12 -6 -12Z',
    '#FF7900',
    1.4,
  );

/** Props with art of their own rather than a single painted path. */
const PROP_ART: Readonly<Partial<Record<PropId, (paint: Paint) => string>>> = {
  sunglasses: (paint) => SUNGLASSES_ART(paint),
  deckchair: (paint) => DECKCHAIR_ART(paint),
  book: BOOK_ART,
  'book-page': BOOK_PAGE_ART,
  laptop: LAPTOP_ART,
  magnifier: MAGNIFIER_ART,
  clipboard: CLIPBOARD_ART,
  envelope: ENVELOPE_ART,
  paintbrush: PAINTBRUSH_ART,
  padlock: PADLOCK_ART,
  'price-tag': PRICE_TAG_ART,
  plug: PLUG_ART,
  phone: PHONE_ART,
};

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
  /**
   * A fixed id prefix, for a long-lived view that patches one SVG in place
   * frame after frame. `uniqueIds` mints a new prefix per call, which would
   * rewrite every clip-path reference on every frame.
   */
  idPrefix?: string;
  /**
   * The line "boil" of a hand-inked cartoon: pass a small integer that changes
   * a few times a second (see `cartoonClock`) and the ink shimmers between that
   * many drawings. Omit for a perfectly still line, e.g. in tests.
   */
  boil?: number;
  /**
   * Draw the rubber-hose arms, hands and legs. Off by default: on 2026-10-14
   * the owner asked for the limbs to go entirely, so Sunny is drawn as the
   * logo -- a sun and its rays -- and acts with its face, its rays, its bounce
   * and its props. The limb rig is still computed (sequences pose it), so
   * turning this on again is the whole of bringing them back.
   */
  limbs?: boolean;
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

/**
 * The character as named parts: what `renderSunny` joins into one string, and
 * what a live view (`createSunnyView`) patches part by part so a frame only
 * touches the DOM that actually changed.
 */
export interface SunnyParts {
  /** Attributes of the root <svg>. */
  svgAttributes: string;
  /** An optional <title>. */
  label: string;
  /** The body transform (position, rotation, squash/stretch). */
  root: string;
  /** The face group's transform. */
  faceTransform: string;
  /** Parts drawn in the viewBox frame, behind the body (the legs). */
  under: Array<[string, PartDrawing]>;
  /** Parts in the body frame, behind the face (rays, arms behind, the body). */
  behind: Array<[string, PartDrawing]>;
  /** Face parts, in the face frame. */
  face: Array<[string, PartDrawing]>;
  /** Parts over the face (arms in front, props). */
  over: Array<[string, PartDrawing]>;
}

export function renderSunnyParts(rig: SunnyRig, options: RenderOptions = {}): SunnyParts {
  const viewBox = options.crop
    ? `${n(options.crop.x)} ${n(options.crop.y)} ${n(options.crop.width)} ${n(options.crop.height)}`
    : `0 0 ${VIEWBOX} ${VIEWBOX}`;
  const size = options.size ?? VIEWBOX;
  const paint = painters(rig, options.cssVariables ?? false);
  const uid =
    options.idPrefix !== undefined
      ? options.idPrefix
      : options.uniqueIds
        ? `u${instanceCounter++}-`
        : '';
  const boil = options.boil;
  const squash = 1 - rig.squash;
  const stretch = 1 + rig.stretch;

  // The whole character is authored about the origin; the root transform places
  // it in the viewBox. Rays, body and face all share the body-local frame.
  const root = [
    `translate(${n(rig.x)} ${n(rig.y)})`,
    `rotate(${n(rig.rotation)})`,
    `scale(${n(rig.scale * stretch)} ${n(rig.scale * squash)})`,
  ].join(' ');

  // Limbs grow out of rays (limbs.ts): a ray a limb has taken over is not
  // drawn as a triangle. Legs live in the viewBox frame so the feet stay
  // planted while the body bobs; arms live in the body frame.
  const showLimbs = (options.limbs ?? false) && rig.limbs.visible;
  const hidden = showLimbs ? limbRayIndices(rig.limbs) : [];
  const limbPaint = { limb: paint.ray, ink: paint.ink };
  const toVB = (p: { x: number; y: number }) => toViewBox(rig, p);
  const leg = (side: 'left' | 'right'): string =>
    showLimbs
      ? legMarkup(rig.limbs.legs[side], side, rig.rays, toVB, rig.scale, limbPaint, boil)
      : '';
  // An arm's tube grows from its ray, behind the body; its hand is drawn in
  // front of the body when the pose says so (a fist on the hip, a hand under
  // the chin), otherwise with the tube.
  const arms = {
    left: showLimbs ? armParts(rig.limbs.arms.left, 'left', rig.rays, limbPaint, boil) : null,
    right: showLimbs ? armParts(rig.limbs.arms.right, 'right', rig.rays, limbPaint, boil) : null,
  };
  const armIn = (side: 'left' | 'right', front: boolean): string => {
    const parts = arms[side];
    if (!parts) return '';
    // armParts puts the hand in `hand` only when it belongs in front of the
    // body (and in `tube` otherwise), so the layering follows its morph.
    if (front) return parts.hand;
    return parts.tube;
  };

  const named = options.title !== undefined && options.title !== '';
  const decorative = options.decorative ?? !named;
  const label = named && !decorative ? `<title>${escapeXml(options.title ?? '')}</title>` : '';
  // Accessibility is derived, not asserted twice: a title implies a labelled
  // image; otherwise the drawing is decorative and hidden from assistive tech.
  const aria = decorative
    ? 'aria-hidden="true" focusable="false"'
    : `role="img" aria-label="${escapeXml(options.title ?? 'Sunny')}"`;

  const behindProps = rig.props
    .filter((prop) => BEHIND_PROPS.includes(prop.id))
    .map((prop) => renderProp(prop, paint))
    .join('');

  return {
    svgAttributes: `xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${n(size)}" height="${n(size)}" ${aria}${options.className ? ` class="${escapeXml(options.className)}"` : ''}`,
    label,
    root,
    faceTransform: `rotate(${n(rig.faceTilt)})`,
    under: [
      // Furniture goes under everything, legs included: Sunny's legs stretch
      // out *over* the front of the deckchair, as on the sheet. The chair is
      // authored in the body frame, so it carries the root transform here.
      [
        'props-behind',
        plain(behindProps === '' ? '' : `<g transform="${root}">${behindProps}</g>`),
      ],
      ['leg-left', plain(leg('left'))],
      ['leg-right', plain(leg('right'))],
    ],
    behind: [
      ...rig.rays.map((_, index): [string, PartDrawing] => [
        `ray-${index}`,
        hidden.includes(index) ? EMPTY : tracedRayPart(rig, index, paint, boil),
      ]),
      ['arm-left', plain(armIn('left', false))],
      ['arm-right', plain(armIn('right', false))],
      ['body', plain(tracedBody(paint, boil))],
    ],
    face: [
      ['eye-left', tracedEyePart('left', rig.eyes.left, paint, uid, boil)],
      ['eye-right', tracedEyePart('right', rig.eyes.right, paint, uid, boil)],
      ['brow-left', tracedBrowPart('left', rig.brows.left, paint, boil)],
      ['brow-right', tracedBrowPart('right', rig.brows.right, paint, boil)],
      ['mouth', tracedMouthPart(rig, paint, boil)],
      [
        'face-props',
        plain(
          rig.props
            .filter((prop) => FACE_PROPS.includes(prop.id))
            .map((prop) => renderProp(prop, paint))
            .join(''),
        ),
      ],
    ],
    over: [
      [
        'props-held',
        plain(
          rig.props
            .filter((prop) => HELD_PROPS.includes(prop.id))
            .map((prop) => renderProp(prop, paint))
            .join(''),
        ),
      ],
      ['arm-front-left', plain(armIn('left', true))],
      ['arm-front-right', plain(armIn('right', true))],
      // Props sit in the body frame rather than the face frame: a question mark
      // or a held prop should not tilt with the head.
      [
        'props',
        plain(
          rig.props
            .filter(
              (prop) =>
                !BEHIND_PROPS.includes(prop.id) &&
                !FACE_PROPS.includes(prop.id) &&
                !HELD_PROPS.includes(prop.id),
            )
            .map((prop) => renderProp(prop, paint))
            .join(''),
        ),
      ],
    ],
  };
}

const EMPTY: PartDrawing = { transform: '', inner: '' };
const plain = (inner: string): PartDrawing => ({ transform: '', inner });

const wrap = (parts: Array<[string, PartDrawing]>): string =>
  parts
    .map(
      ([key, p]) =>
        `<g data-part="${key}"${p.transform ? ` transform="${p.transform}"` : ''}>${p.inner}</g>`,
    )
    .join('');

/** Join a rig's parts into one SVG string. */
export function joinSunnyParts(p: SunnyParts): string {
  return [
    `<svg ${p.svgAttributes}>`,
    p.label,
    `<g data-layer="under">${wrap(p.under)}</g>`,
    `<g data-layer="root" transform="${p.root}">`,
    wrap(p.behind),
    `<g data-layer="face" transform="${p.faceTransform}">${wrap(p.face)}</g>`,
    wrap(p.over),
    `</g>`,
    `</svg>`,
  ].join('');
}

/**
 * Render a rig to an SVG string.
 */
export function renderSunny(rig: SunnyRig, options: RenderOptions = {}): string {
  return joinSunnyParts(renderSunnyParts(rig, options));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
