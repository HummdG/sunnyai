/**
 * Sunny's hands and shoes, built from shapes rather than traced from pixels.
 *
 * The first hands were crops of `reference_poses.png` run through a tracer:
 * ~50 px of source per hand, so every bump of JPEG noise became a bump in the
 * outline and the result read as a blob. The owner disliked them outright. The
 * sheet's hands are simple: a round palm, four sausage fingers with a thick
 * ink line, a stubby thumb -- which is exactly what this file builds, from
 * capsules and ellipses, so every hand shares the same line weight and finger
 * size and can swap with another without changing character.
 *
 * Three paths per drawing:
 *
 * - `ink` -- every part grown by the outline width. Drawn in ink, it is the
 *   silhouette with its outline.
 * - `fill` -- every part at its true size, unioned into one orange shape.
 * - `lines` -- thin ink creases over the fill: where one finger lies against
 *   the next, and along a thumb folded over the front -- the sheet's interior
 *   lines, which a filled silhouette alone cannot show.
 *
 * Every subpath winds the same way (clockwise on screen), so the nonzero fill
 * rule unions them. Only absolute M/L/C/Z commands are emitted, because the
 * boil (`boil.ts`) jitters every number in the path and would corrupt an arc's
 * flags.
 *
 * Hands: wrist at the origin, pointing up (-y), about 26 units long; drawn for
 * the right-hand side of the screen and mirrored for the left. Shoes: ankle at
 * the origin, toe along +x, sole at about y = +6.
 */

interface Vec2 {
  x: number;
  y: number;
}

export interface HandArt {
  ink: string;
  fill: string;
  /**
   * Interior ink lines drawn over the fill: the creases between fingers and
   * round a thumb folded across the palm. Empty when a shape has none.
   */
  lines: string;
  /** Width of the wrist opening, which the arm's tube flares to meet. */
  joint: number;
}

/** The ink line around a hand, in art units (a hand is drawn at ~1.5x). */
const OUTLINE = 1.75;
/** Half the weight of an interior line (a crease between fingers). */
const CREASE = 0.55;
/** Cubic control-point factor for a quarter circle. */
const K = 0.5523;

const r2 = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
const pt = (p: Vec2): string => `${r2(p.x)} ${r2(p.y)}`;

/**
 * A stadium (a sausage) from `a` to `b`, radius `r`, clockwise on screen.
 * Built from two semicircles of cubic quarter-arcs joined by straight sides.
 */
function capsule(a: Vec2, b: Vec2, r: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  const u = { x: dx / len, y: dy / len };
  // `n` is u rotated a quarter turn clockwise on screen (y down).
  const n = { x: -u.y, y: u.x };
  const at = (c: Vec2, ux: number, nx: number): Vec2 => ({
    x: c.x + u.x * ux * r + n.x * nx * r,
    y: c.y + u.y * ux * r + n.y * nx * r,
  });
  // Start on b's -n side, sweep round b's cap to its +n side, back down the +n
  // side to a, round a's cap, and close.
  const p0 = at(b, 0, -1);
  const p1 = at(b, 1, 0);
  const p2 = at(b, 0, 1);
  const p3 = at(a, 0, 1);
  const p4 = at(a, -1, 0);
  const p5 = at(a, 0, -1);
  return [
    `M${pt(p0)}`,
    `C${pt(at(b, K, -1))} ${pt(at(b, 1, -K))} ${pt(p1)}`,
    `C${pt(at(b, 1, K))} ${pt(at(b, K, 1))} ${pt(p2)}`,
    `L${pt(p3)}`,
    `C${pt(at(a, -K, 1))} ${pt(at(a, -1, K))} ${pt(p4)}`,
    `C${pt(at(a, -1, -K))} ${pt(at(a, -K, -1))} ${pt(p5)}`,
    'Z',
  ].join('');
}

/** An ellipse centred on `c`, rotated `deg`, clockwise on screen. */
function ellipse(c: Vec2, rx: number, ry: number, deg = 0): string {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const at = (x: number, y: number): Vec2 => ({
    x: c.x + x * cos - y * sin,
    y: c.y + x * sin + y * cos,
  });
  const q = [at(rx, 0), at(0, ry), at(-rx, 0), at(0, -ry)];
  return [
    `M${pt(q[0]!)}`,
    `C${pt(at(rx, ry * K))} ${pt(at(rx * K, ry))} ${pt(q[1]!)}`,
    `C${pt(at(-rx * K, ry))} ${pt(at(-rx, ry * K))} ${pt(q[2]!)}`,
    `C${pt(at(-rx, -ry * K))} ${pt(at(-rx * K, -ry))} ${pt(q[3]!)}`,
    `C${pt(at(rx * K, -ry))} ${pt(at(rx, -ry * K))} ${pt(q[0]!)}`,
    'Z',
  ].join('');
}

/** A part of a hand: drawn grown for the ink, true (or slimmed) for the fill. */
type Part =
  | { kind: 'capsule'; a: Vec2; b: Vec2; r: number; finger?: boolean }
  | { kind: 'ellipse'; c: Vec2; rx: number; ry: number; deg?: number; finger?: boolean };

/** A crease: a short thin stroke from one point to another. */
type Line = readonly [Vec2, Vec2];

function partPath(p: Part, grow: number): string {
  return p.kind === 'capsule'
    ? capsule(p.a, p.b, p.r + grow)
    : ellipse(p.c, p.rx + grow, p.ry + grow, p.deg ?? 0);
}

function build(parts: readonly Part[], joint: number, lines: readonly Line[] = []): HandArt {
  return {
    ink: parts.map((p) => partPath(p, OUTLINE)).join(''),
    fill: parts.map((p) => partPath(p, 0)).join(''),
    lines: lines.map(([from, to]) => capsule(from, to, CREASE)).join(''),
    joint,
  };
}

/**
 * The crease down the side of a finger that lies against its neighbour: along
 * the finger's edge on `side` (-1 left, +1 right), from where it leaves the
 * palm (`from`) to where its tip starts rounding off (`to`), as fractions of
 * its length.
 */
function edge(f: Part, side: -1 | 1, from = 0.15, to = 0.72): Line {
  if (f.kind !== 'capsule') throw new Error('edge() needs a finger');
  const dx = f.b.x - f.a.x;
  const dy = f.b.y - f.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * side * (f.r - 0.15);
  const ny = (dx / len) * side * (f.r - 0.15);
  const at = (t: number): Vec2 => ({ x: f.a.x + dx * t + nx, y: f.a.y + dy * t + ny });
  return [at(from), at(to)];
}

const P = (x: number, y: number): Vec2 => ({ x, y });

/** The heel of the hand and the cuff the arm's tube meets. */
const wrist: Part = { kind: 'capsule', a: P(0, 1), b: P(0, -4), r: 4.1 };
const palm = (rx = 7.6, ry = 7.1, cy = -9): Part => ({ kind: 'ellipse', c: P(0, cy), rx, ry });

/** A straight finger from `base` along `deg` (0 = up, + = clockwise). */
function finger(base: Vec2, deg: number, length: number, r = 2.45): Part {
  const a = (deg * Math.PI) / 180;
  return {
    kind: 'capsule',
    a: base,
    b: { x: base.x + Math.sin(a) * length, y: base.y - Math.cos(a) * length },
    r,
    finger: true,
  };
}

/** A curled finger: a knuckle bump. */
const knuckle = (x: number, y: number, rx = 2.5, ry = 2.9, deg = 0): Part => ({
  kind: 'ellipse',
  c: P(x, y),
  rx,
  ry,
  deg,
  finger: true,
});

/** The open hand: fingers fanned, thumb out (sheet: the wave, the jump). */
const OPEN_F = [
  finger(P(-5, -12.5), -26, 9.5),
  finger(P(-1.7, -14), -8, 11),
  finger(P(1.7, -14), 8, 10.5),
  finger(P(5, -12.5), 25, 8.5, 2.3),
] as const;
const open = build([...OPEN_F, finger(P(-6, -6.5), -72, 7.5, 2.6), palm(), wrist], 8.2, [
  edge(OPEN_F[1], -1, 0.2, 0.4),
  edge(OPEN_F[2], -1, 0.2, 0.45),
  edge(OPEN_F[3], -1, 0.2, 0.35),
]);

/** Relaxed: fingers together and a touch shorter, thumb lying close. */
const RELAXED_F = [
  finger(P(-4.8, -13), -11, 8.6),
  finger(P(-1.6, -14.2), -3.5, 9.6),
  finger(P(1.6, -14.2), 3.5, 9.2),
  finger(P(4.8, -13), 11, 7.8, 2.3),
] as const;
const relaxed = build(
  [...RELAXED_F, finger(P(-6.2, -7), -48, 6.2, 2.5), palm(7.4, 7.2), wrist],
  8.2,
  [
    edge(RELAXED_F[1], -1, 0.25, 0.8),
    edge(RELAXED_F[2], -1, 0.25, 0.8),
    edge(RELAXED_F[3], -1, 0.25, 0.75),
  ],
);

/** Creases between knuckles in a row: short strokes down from each gap. */
function knuckleGaps(xs: readonly number[], top: number, depth = 2.6): Line[] {
  const out: Line[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x = (xs[i]! + xs[i + 1]!) / 2;
    out.push([P(x, top), P(x, top + depth)]);
  }
  return out;
}

/** A thumb folded over the front of a fist, with its own line along the bottom. */
const FOLDED_THUMB: Part = {
  kind: 'capsule',
  a: P(-7.4, -8.4),
  b: P(-0.6, -12),
  r: 2.5,
  finger: true,
};
const foldedThumbLine: Line = [P(-6.6, -5.9), P(0.4, -9.6)];

/** A fist: knuckles across the top, thumb wrapped over the front (sheet: cheer). */
const fist = build(
  [
    knuckle(-5.4, -15.3),
    knuckle(-1.8, -16.2),
    knuckle(1.8, -16.2),
    knuckle(5.4, -15.3, 2.4, 2.7),
    FOLDED_THUMB,
    palm(8.4, 8, -9.5),
    wrist,
  ],
  8.4,
  [...knuckleGaps([-5.4, -1.8, 1.8, 5.4], -15.6), foldedThumbLine],
);

/** A grip round a handle or a string: a fist turned so the fingers wrap. */
const grip = build(
  [
    knuckle(6.2, -15, 2.6, 2.4, 20),
    knuckle(7.6, -11.4, 2.6, 2.4, 10),
    knuckle(7.8, -7.8, 2.6, 2.4),
    knuckle(6.8, -4.4, 2.4, 2.2, -10),
    finger(P(-5.6, -11), -30, 6.5, 2.5),
    palm(7.8, 8.2, -9.5),
    wrist,
  ],
  8.4,
  [
    [P(4.8, -13.2), P(7.4, -13.4)],
    [P(5.4, -9.6), P(8, -9.6)],
    [P(5.2, -6.1), P(7.8, -6)],
  ],
);

/** The finger-gun: index straight out, thumb cocked, the rest curled (sheet: top right). */
const POINT_INDEX = finger(P(1.4, -14), 0, 13.5, 2.5);
const point = build(
  [
    POINT_INDEX,
    knuckle(5.6, -13.4, 2.6, 2.3, 15),
    knuckle(6.6, -10.2, 2.6, 2.3),
    knuckle(6.4, -7, 2.4, 2.2, -10),
    finger(P(-5.4, -10.5), -24, 8.5, 2.6),
    palm(7.4, 7.6, -9.5),
    wrist,
  ],
  8.2,
  [edge(POINT_INDEX, 1, 0.05, 0.35), [P(4.4, -11.8), P(7, -11.8)], [P(4.6, -8.6), P(7.2, -8.6)]],
);

/** One finger raised -- "I've got it" (sheet: second row, third). */
const INDEX_F = finger(P(-0.8, -14.5), -3, 13, 2.5);
const index = build(
  [
    INDEX_F,
    knuckle(3.4, -15.2, 2.3, 2.7),
    knuckle(6.2, -13.4, 2.3, 2.6, 20),
    knuckle(7.4, -10.2, 2.2, 2.4, 35),
    FOLDED_THUMB,
    palm(7.6, 7.6, -9.5),
    wrist,
  ],
  8.2,
  [edge(INDEX_F, 1, 0.05, 0.3), [P(4.9, -14.6), P(4.4, -12.4)], foldedThumbLine],
);

/**
 * Thumbs up: the fist turned side-on, fingers stacked down the front and the
 * thumb standing short and fat on top (sheet: top row, third).
 */
const thumb = build(
  [
    { kind: 'ellipse', c: P(2.6, -14.6), rx: 6.4, ry: 2.9, finger: true },
    { kind: 'ellipse', c: P(3, -10.6), rx: 6.6, ry: 2.9, finger: true },
    { kind: 'ellipse', c: P(2.8, -6.6), rx: 6.3, ry: 2.8, finger: true },
    finger(P(-2.6, -15), -4, 8.5, 3.1),
    palm(7.2, 7.8, -10),
    wrist,
  ],
  8.4,
  [
    [P(0, -12.6), P(8.4, -12.6)],
    [P(0.2, -8.6), P(8.6, -8.6)],
    [P(0.4, -4.7), P(7.8, -4.7)],
  ],
);

/** The peace sign: two fingers in a V, the rest curled (sheet: bottom left). */
const PEACE_F = [
  finger(P(-2.1, -14.5), -14, 12.5, 2.4),
  finger(P(2.1, -14.5), 14, 12.5, 2.4),
] as const;
const peace = build(
  [
    ...PEACE_F,
    knuckle(5.6, -13, 2.3, 2.5, 20),
    knuckle(7, -9.8, 2.2, 2.4, 35),
    FOLDED_THUMB,
    palm(7.6, 7.6, -9.5),
    wrist,
  ],
  8.2,
  [edge(PEACE_F[0], 1, 0.05, 0.2), [P(5.8, -11.6), P(4.6, -10)], foldedThumbLine],
);

/**
 * The shoe: a big bean with a flat sole, the toe rounder and taller than the
 * heel (every shoe on the sheet). Built as a heel, a toe and a sole bar so the
 * ink grows evenly round the whole shape.
 */
const SHOE_PARTS: readonly Part[] = [
  { kind: 'ellipse', c: P(7.5, 1.6), rx: 12.4, ry: 6.6, deg: -3 },
  { kind: 'ellipse', c: P(-3, 2.6), rx: 5.6, ry: 4.6 },
  { kind: 'capsule', a: P(-4, 4.4), b: P(14, 4.4), r: 3.6 },
  { kind: 'capsule', a: P(0, 0), b: P(0, -4.5), r: 4.2 },
];
const shoe: HandArt = {
  ink: SHOE_PARTS.map((p) => partPath(p, OUTLINE * 0.85)).join(''),
  fill: SHOE_PARTS.map((p) => partPath(p, 0)).join(''),
  lines: '',
  joint: 8.4,
};

export const HANDS = {
  open,
  relaxed,
  fist,
  grip,
  point,
  index,
  thumb,
  peace,
  shoe,
} as const satisfies Record<string, HandArt>;

/**
 * The "smear": the hand pinched to a mitten for the frame or two in which one
 * hand shape turns into another. Animators draw a smear so a change of shape
 * reads as fast motion rather than a cut; this is the vector equivalent.
 */
export const SMEAR: HandArt = build(
  [{ kind: 'ellipse', c: P(0, -11.5), rx: 6.4, ry: 10.5 }, palm(7, 6.8), wrist],
  8.2,
);
