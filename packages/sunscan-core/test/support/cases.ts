// Test footprints (local metres, x = east, y = north). Outer CCW, holes CW.
import { mulberry32, ringArea, isSimple, type PolygonM, type Ring, type Vec2 } from '../../src/geometry/geom.js';

export const rect = (w: number, h: number, x0 = 0, y0 = 0): Ring => [
  [x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h],
];

/** 10 x 6 m rectangle, long axis east-west. Edges: 0 = front (south), 1 = east, 2 = back (north), 3 = west. */
export const RECT_10x6: PolygonM = { outer: rect(10, 6) };
export const SQUARE_8: PolygonM = { outer: rect(8, 8) };

/** L: main 10x6 + rear wing 4 wide x 5 deep on the east side.
 *  Edges: 0 front, 1 east (full 11 m), 2 wing back, 3 wing west side, 4 main back (west part), 5 west end. */
export const L_SHAPE: PolygonM = { outer: [[0, 0], [10, 0], [10, 11], [6, 11], [6, 6], [0, 6]] };

/** T: main 12x6 + centred rear wing 4 x 5.
 *  Edges: 0 front, 1 east end, 2 back-east, 3 wing east side, 4 wing back, 5 wing west side, 6 back-west, 7 west end. */
export const T_SHAPE: PolygonM = { outer: [[0, 0], [12, 0], [12, 6], [8, 6], [8, 11], [4, 11], [4, 6], [0, 6]] };

export const U_SHAPE: PolygonM = { outer: [[0, 0], [12, 0], [12, 9], [9, 9], [9, 4], [3, 4], [3, 9], [0, 9]] };

/** UK mid-terrace with rear outrigger (one polygon). Street along x, front at y = 0.
 *  Edges: 0 front, 1 east party wall (full depth incl. outrigger), 2 outrigger back, 3 outrigger west side,
 *  4 main back (west part), 5 west party wall. */
export const TERRACE_OUTRIGGER: PolygonM = {
  outer: [[0, 0], [5.5, 0], [5.5, 13], [2.5, 13], [2.5, 8], [0, 8]],
};

/** Detached house with a canted (45 deg) front bay window. */
export const BAY_HOUSE: PolygonM = {
  outer: [[0, 0], [2, 0], [2.9, -0.9], [4.1, -0.9], [5, 0], [9, 0], [9, 7], [0, 7]],
};

/** Courtyard building: 20 x 16 with an 8 x 6 hole. */
export const COURTYARD: PolygonM = {
  outer: rect(20, 16),
  holes: [[[6, 5], [6, 11], [14, 11], [14, 5]]], // CW
};

/** Hole close to one side (hole wavefront collides with the outer wavefront early). */
export const COURTYARD_OFFSET: PolygonM = {
  outer: rect(18, 12),
  holes: [[[2, 2], [2, 6], [7, 6], [7, 2]]],
};

export const PLUS: PolygonM = {
  outer: [[6, 0], [12, 0], [12, 6], [18, 6], [18, 12], [12, 12], [12, 18], [6, 18], [6, 12], [0, 12], [0, 6], [6, 6]],
};

export const H_SHAPE: PolygonM = {
  outer: [[0, 0], [4, 0], [4, 5], [10, 5], [10, 0], [14, 0], [14, 14], [10, 14], [10, 9], [4, 9], [4, 14], [0, 14]],
};

export const E_SHAPE: PolygonM = {
  outer: [[0, 0], [14, 0], [14, 4], [4, 4], [4, 7], [11, 7], [11, 10], [4, 10], [4, 13], [14, 13], [14, 17], [0, 17]],
};

/** Exactly collinear extra vertices. */
export const COLLINEAR: PolygonM = { outer: [[0, 0], [5, 0], [10, 0], [10, 3], [10, 6], [4, 6], [0, 6]] };

/** Rectangle whose front edge has a mid vertex displaced by `e` (positive = outward bulge = convex). */
export const nearCollinear = (e: number): PolygonM => ({ outer: [[0, 0], [5, -e], [10, 0], [10, 6], [0, 6]] });

/** Rectangle with a chamfered NE corner of size c (very short edge). */
export const chamfer = (c: number): PolygonM => ({ outer: [[0, 0], [10, 0], [10, 6 - c], [10 - c, 6], [0, 6]] });

/** Rectangle with a tiny rectangular notch (c x c) in the back wall. */
export const notch = (c: number): PolygonM => ({
  outer: [[0, 0], [10, 0], [10, 6], [5 + c, 6], [5 + c, 6 - c], [5, 6 - c], [5, 6], [0, 6]],
});

export function regularPolygon(n: number, r: number, phase = 0.1): PolygonM {
  const outer: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (2 * Math.PI * i) / n;
    outer.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return { outer };
}

/** Random star-shaped polygon (many reflex vertices). */
export function randomStar(n: number, seed: number, R = 9): PolygonM {
  const rnd = mulberry32(seed);
  const outer: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * (i + 0.45 * rnd())) / n;
    const r = R * (0.55 + 0.45 * rnd());
    outer.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return { outer };
}

/** Random rectilinear (orthogonal) polygon traced from a grown blob of grid cells. */
export function randomOrtho(seed: number, minV = 30, maxV = 60, cell = 1.5): PolygonM {
  for (let attempt = 0; attempt < 500; attempt++) {
    const rnd = mulberry32(seed * 7919 + attempt);
    const W = 16, H = 12;
    const g: boolean[][] = Array.from({ length: H }, () => Array(W).fill(false));
    let cx = W >> 1, cy = H >> 1;
    g[cy][cx] = true;
    const target = 45 + Math.floor(rnd() * 25);
    let count = 1;
    while (count < target) {
      // pick a random filled cell and grow in a random direction
      const fx = Math.floor(rnd() * W), fy = Math.floor(rnd() * H);
      if (!g[fy][fx]) continue;
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rnd() * 4)];
      const nx = fx + dx, ny = fy + dy;
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || g[ny][nx]) continue;
      g[ny][nx] = true;
      count++;
    }
    // fill holes (cells not reachable from outside)
    const out: boolean[][] = Array.from({ length: H }, () => Array(W).fill(false));
    const stack: [number, number][] = [[0, 0]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (x < 0 || y < 0 || x >= W || y >= H || out[y][x] || g[y][x]) continue;
      out[y][x] = true;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!out[y][x]) g[y][x] = true;
    // reject diagonal-only contacts (non-manifold vertices)
    let bad = false;
    for (let y = 0; y < H - 1 && !bad; y++)
      for (let x = 0; x < W - 1; x++) {
        const a = g[y][x], b = g[y][x + 1], c = g[y + 1][x], d = g[y + 1][x + 1];
        if ((a && d && !b && !c) || (b && c && !a && !d)) { bad = true; break; }
      }
    if (bad) continue;
    // boundary edges with interior on the left (CCW)
    const next = new Map<string, Vec2>();
    const key = (p: Vec2) => `${p[0]},${p[1]}`;
    let start: Vec2 | null = null;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!g[y][x]) continue;
        const f = (yy: number, xx: number) => yy >= 0 && xx >= 0 && yy < H && xx < W && g[yy][xx];
        if (!f(y - 1, x)) { next.set(key([x, y]), [x + 1, y]); start ??= [x, y]; }
        if (!f(y, x + 1)) next.set(key([x + 1, y]), [x + 1, y + 1]);
        if (!f(y + 1, x)) next.set(key([x + 1, y + 1]), [x, y + 1]);
        if (!f(y, x - 1)) next.set(key([x, y + 1]), [x, y]);
      }
    const pts: Vec2[] = [];
    let p = start!;
    do { pts.push(p); p = next.get(key(p))!; } while (key(p) !== key(start!) && pts.length < 10000);
    if (pts.length !== next.size) continue; // more than one boundary loop
    // merge collinear
    const ring: Ring = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) ring.push([b[0] * cell, b[1] * cell]);
    }
    if (ring.length >= minV && ring.length <= maxV && ringArea(ring) > 0) return { outer: ring };
  }
  throw new Error('randomOrtho: no polygon found');
}

/** Jitter vertices (survey noise) and insert near-collinear points on long edges. */
export function noisy(p: PolygonM, seed: number, jitter = 0.02, insertEvery = 3): PolygonM {
  const rnd = mulberry32(seed);
  const outer: Ring = [];
  const n = p.outer.length;
  for (let i = 0; i < n; i++) {
    const a = p.outer[i], b = p.outer[(i + 1) % n];
    outer.push([a[0] + (rnd() - 0.5) * 2 * jitter, a[1] + (rnd() - 0.5) * 2 * jitter]);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > insertEvery) {
      const t = 0.3 + 0.4 * rnd();
      outer.push([a[0] + (b[0] - a[0]) * t + (rnd() - 0.5) * 2 * jitter, a[1] + (b[1] - a[1]) * t + (rnd() - 0.5) * 2 * jitter]);
    }
  }
  return { outer, holes: p.holes };
}

export interface NamedCase { name: string; poly: PolygonM; note?: string }

export function surveyCases(): NamedCase[] {
  const cases: NamedCase[] = [
    { name: 'rect 10x6', poly: RECT_10x6 },
    { name: 'square 8x8', poly: SQUARE_8, note: '4-way event' },
    { name: 'L-shape', poly: L_SHAPE },
    { name: 'T-shape', poly: T_SHAPE },
    { name: 'U-shape', poly: U_SHAPE },
    { name: 'terrace+outrigger', poly: TERRACE_OUTRIGGER },
    { name: 'bay window house', poly: BAY_HOUSE },
    { name: 'plus (equal arms)', poly: PLUS, note: 'multi-way degenerate' },
    { name: 'H-shape', poly: H_SHAPE },
    { name: 'E-shape', poly: E_SHAPE },
    { name: 'courtyard (hole)', poly: COURTYARD },
    { name: 'offset hole', poly: COURTYARD_OFFSET },
    { name: 'collinear vertices', poly: COLLINEAR },
    { name: 'near-collinear 1e-9', poly: nearCollinear(1e-9) },
    { name: 'near-collinear 1e-6', poly: nearCollinear(1e-6) },
    { name: 'near-collinear 1e-3', poly: nearCollinear(1e-3) },
    { name: 'near-collinear -1e-3 (reflex)', poly: nearCollinear(-1e-3) },
    { name: 'short edge 1 mm', poly: chamfer(0.001) },
    { name: 'short edge 1 cm', poly: chamfer(0.01) },
    { name: 'notch 1 cm', poly: notch(0.01) },
    { name: 'regular 40-gon', poly: regularPolygon(40, 8), note: '40-way event' },
    { name: 'regular 60-gon', poly: regularPolygon(60, 8) },
    { name: 'star 40 (seed 1)', poly: randomStar(40, 1) },
    { name: 'star 60 (seed 2)', poly: randomStar(60, 2) },
    { name: 'ortho ~40 (seed 1)', poly: randomOrtho(1) },
    { name: 'ortho ~40 (seed 2)', poly: randomOrtho(2) },
    { name: 'noisy L (2 cm)', poly: noisy(L_SHAPE, 5) },
    { name: 'noisy T (2 cm)', poly: noisy(T_SHAPE, 6) },
  ];
  for (const c of cases) if (!isSimple(c.poly)) throw new Error(`case ${c.name} is not simple`);
  return cases;
}
