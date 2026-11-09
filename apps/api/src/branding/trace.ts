import type { Mask } from './image.js';

export type Polygon = Array<[number, number]>;

const ISO = 0.5;
const MIN_AREA = 4;
const EPSILON = 0.35;

function area(p: Polygon): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % p.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

function lineDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / len;
}

/** Douglas-Peucker on an open run of points, keeping both ends. */
function simplifyRun(pts: Polygon, eps: number): Polygon {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let max = eps;
    for (let i = a + 1; i < b; i++) {
      const d = lineDistance(pts[i]!, pts[a]!, pts[b]!);
      if (d > max) {
        max = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Closed-polygon Douglas-Peucker: split at the point farthest from the first. */
function simplifyClosed(p: Polygon, eps: number): Polygon {
  let far = 0;
  let max = -1;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i]![0] - p[0]![0], p[i]![1] - p[0]![1]);
    if (d > max) {
      max = d;
      far = i;
    }
  }
  const first = simplifyRun(p.slice(0, far + 1), eps);
  const second = simplifyRun([...p.slice(far), p[0]!], eps);
  return [...first, ...second.slice(1, -1)];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Marching squares at iso 0.5 over the mask's pixel centres (pixel i sits at
 * i + 0.5), with everything outside the mask read as 0 so edge shapes close.
 * Coordinates come back rounded to 0.1 px, exactly as `outlinePath` writes them,
 * so verification checks the outline that is actually served.
 */
export function traceMask(m: Mask): Polygon[] {
  const { width: w, height: h, coverage } = m;
  // Padded sample grid: sample (I, J) is pixel (I - 1, J - 1).
  const W = w + 2;
  const H = h + 2;
  const v = (I: number, J: number): number =>
    I < 1 || J < 1 || I > w || J > h ? 0 : coverage[(J - 1) * w + (I - 1)]!;
  const inside = (I: number, J: number): boolean => v(I, J) >= ISO;

  const points = new Map<number, [number, number]>();
  const links = new Map<number, number[]>();
  const t = (a: number, b: number): number => (a === b ? 0.5 : (ISO - a) / (b - a));

  // Edge ids: horizontal from (I, J) to (I + 1, J) is even, vertical to (I, J + 1) is odd.
  const hEdge = (I: number, J: number): number => {
    const id = (J * W + I) * 2;
    if (!points.has(id)) points.set(id, [I - 0.5 + t(v(I, J), v(I + 1, J)), J - 0.5]);
    return id;
  };
  const vEdge = (I: number, J: number): number => {
    const id = (J * W + I) * 2 + 1;
    if (!points.has(id)) points.set(id, [I - 0.5, J - 0.5 + t(v(I, J), v(I, J + 1))]);
    return id;
  };
  const link = (a: number, b: number): void => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };

  for (let J = 0; J < H - 1; J++) {
    for (let I = 0; I < W - 1; I++) {
      const tl = inside(I, J);
      const tr = inside(I + 1, J);
      const br = inside(I + 1, J + 1);
      const bl = inside(I, J + 1);
      if (tl === tr && tr === br && br === bl) continue;
      const top = tl !== tr ? hEdge(I, J) : -1;
      const bottom = bl !== br ? hEdge(I, J + 1) : -1;
      const left = tl !== bl ? vEdge(I, J) : -1;
      const right = tr !== br ? vEdge(I + 1, J) : -1;
      if (top >= 0 && bottom >= 0 && left >= 0 && right >= 0) {
        // Saddle: cut off the corners that disagree with the cell's average.
        const centre = (v(I, J) + v(I + 1, J) + v(I + 1, J + 1) + v(I, J + 1)) / 4 >= ISO;
        if (tl !== centre) link(top, left);
        if (tr !== centre) link(top, right);
        if (br !== centre) link(right, bottom);
        if (bl !== centre) link(bottom, left);
      } else {
        const ends = [top, right, bottom, left].filter((e) => e >= 0);
        link(ends[0]!, ends[1]!);
      }
    }
  }

  const polys: Polygon[] = [];
  const seen = new Set<number>();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const ring: Polygon = [];
    let prev = -1;
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      ring.push(points.get(cur)!);
      const next = links.get(cur)!.find((n) => n !== prev && !seen.has(n));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (Math.abs(area(ring)) < MIN_AREA) continue;
    const simple = simplifyClosed(ring, EPSILON).map(([x, y]): [number, number] => [
      round1(x),
      round1(y),
    ]);
    if (simple.length >= 3) polys.push(simple);
  }
  return polys;
}

const fmt = (n: number): string => String(round1(n));

/** One `M … L … Z` subpath per polygon, in the image's pixel space. */
export function outlinePath(polys: Polygon[]): string {
  return polys.map((p) => `M${p.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' L')} Z`).join(' ');
}

/**
 * Rasterise the polygons even-odd at 4 x 4 per pixel and compare them with the
 * binarised mask. `farMismatch` counts disagreeing pixels more than 1.5 px from
 * the mask's boundary, the ones a viewer would see as the outline missing the logo.
 */
export function verifyTrace(polys: Polygon[], m: Mask): { iou: number; farMismatch: number } {
  const { width: w, height: h, coverage } = m;
  const SS = 4;
  const hits = new Uint16Array(w * h);
  const edges: Array<[number, number, number, number]> = [];
  for (const p of polys)
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % p.length]!;
      if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]);
    }

  const xs: number[] = [];
  for (let sy = 0; sy < h * SS; sy++) {
    const y = (sy + 0.5) / SS;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if (y0 > y !== y1 > y) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    const row = Math.floor(sy / SS) * w;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Subsample columns whose centre (c + 0.5) / SS lies in [xs[k], xs[k + 1]).
      const c0 = Math.max(0, Math.ceil(xs[k]! * SS - 0.5));
      const c1 = Math.min(w * SS, Math.ceil(xs[k + 1]! * SS - 0.5));
      for (let c = c0; c < c1; c++) hits[row + Math.floor(c / SS)]!++;
    }
  }

  const traced = (i: number): boolean => hits[i]! >= (SS * SS) / 2;
  const masked = (i: number): boolean => coverage[i]! >= 0.5;
  const set = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && masked(y * w + x);
  // A boundary pixel differs from at least one 4-neighbour (outside counts as unset).
  const boundary = (x: number, y: number): boolean => {
    const s = set(x, y);
    return set(x - 1, y) !== s || set(x + 1, y) !== s || set(x, y - 1) !== s || set(x, y + 1) !== s;
  };

  let both = 0;
  let either = 0;
  let farMismatch = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = traced(i);
      const b = masked(i);
      if (a && b) both++;
      if (a || b) either++;
      if (a === b) continue;
      // Pixel centres within 1.5 px are exactly the 3 x 3 neighbourhood.
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1 && !near; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && boundary(nx, ny)) near = true;
        }
      if (!near) farMismatch++;
    }
  return { iou: either === 0 ? 1 : both / either, farMismatch };
}
