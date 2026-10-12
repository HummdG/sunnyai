// Footprint regularisation (spec §5.3 "prepare"): drop near-duplicate and collinear (< 5 cm) vertices, snap edges within
// `maxDeviationDeg` of the dominant axis (best-supported edge direction, refined by the fourfold circular mean) to exact
// right angles (each edge rotates about its midpoint; vertices = intersections of consecutive edge lines),
// merge parallel neighbours, drop micro-edges (< minEdge), and refuse any result that changes the area by >= 2 % or is
// not a simple polygon (then only the cleaning steps are applied).
import { isSimple, ringArea, type PolygonM, type Vec2 } from '../geometry/geom.js';

/** Options of {@link regularizeFootprint}. */
export interface RegularizeOptions {
  /** Edges within this angle of the dominant axis (or its perpendicular) are snapped (default 8 deg). */
  maxDeviationDeg?: number;
  /** Edges shorter than this are removed (default 0.3 m). */
  minEdge?: number;
  /** Vertices deviating less than this from the chord of their neighbours are dropped (default 0.05 m). */
  collinearTol?: number;
  /** Maximum relative area change of an accepted result (default 0.02). */
  maxAreaChange?: number;
}

/** Detailed result of {@link regularizeFootprintDetailed}. */
export interface RegularizeResult {
  /** Outer ring CCW, holes CW, no closing duplicate. */
  polygon: PolygonM;
  /** For each output edge (outer edges first, then holes), the input edge indices it derives from. */
  sourceEdges: number[][];
  /** Dominant axis, degrees counter-clockwise from east, in [0, 90). */
  axisDeg: number;
  /** (area_out - area_in) / area_in. */
  areaChange: number;
  /** True when the right-angle snapping was applied (false = cleaning only). */
  orthogonalized: boolean;
  notes: string[];
}

interface Ed { a: Vec2; src: number[] } // edge from vertex a to the next ring vertex
interface Line { psi: number; nx: number; ny: number; c: number; len: number; snapped: boolean; k: number; src: number[]; mx: number; my: number }

const D2R = Math.PI / 180;
const SIN_PAR = Math.sin(3 * D2R);
const polyArea = (p: PolygonM) => Math.abs(ringArea(p.outer)) - (p.holes ?? []).reduce((s, h) => s + Math.abs(ringArea(h)), 0);

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Oriented ring edges with input edge indices; `reverse` maps edges of the reversed ring back to input numbering. */
function orientedEdges(ring: Vec2[], ccw: boolean, base: number): Ed[] {
  const n = ring.length;
  const isCcw = ringArea(ring) > 0;
  if (isCcw === ccw) return ring.map((a, i) => ({ a, src: [base + i] }));
  const rev = ring.slice().reverse();
  return rev.map((a, j) => ({ a, src: [base + ((n - 2 - j + 2 * n) % n)] }));
}

/** Removes near-duplicate and collinear vertices, merging the source edges of the joined edges. */
function clean(edges: Ed[], tol: number): Ed[] {
  const r = edges.map((e) => ({ a: e.a, src: e.src.slice() }));
  let changed = true;
  while (changed && r.length > 3) {
    changed = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const prev = r[(i - 1 + r.length) % r.length];
      const next = r[(i + 1) % r.length];
      if (Math.hypot(r[i].a[0] - prev.a[0], r[i].a[1] - prev.a[1]) < 1e-3 || segDist(r[i].a, prev.a, next.a) < tol) {
        prev.src.push(...r[i].src);
        r.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return r;
}

function mkLine(psi: number, mx: number, my: number, len: number, snapped: boolean, k: number, src: number[]): Line {
  const nx = -Math.sin(psi);
  const ny = Math.cos(psi);
  return { psi, nx, ny, c: nx * mx + ny * my, len, snapped, k, src, mx, my };
}

function mergeLines(l1: Line, l2: Line): Line {
  const w = l1.len + l2.len;
  const mx = (l1.mx * l1.len + l2.mx * l2.len) / w;
  const my = (l1.my * l1.len + l2.my * l2.len) / w;
  const sameAxis = l1.snapped && l2.snapped && ((l1.k - l2.k) % 4 + 4) % 4 === 0;
  const psi = sameAxis ? l1.psi : Math.atan2(l1.len * Math.sin(l1.psi) + l2.len * Math.sin(l2.psi), l1.len * Math.cos(l1.psi) + l2.len * Math.cos(l2.psi));
  return mkLine(psi, mx, my, w, sameAxis, l1.k, [...l1.src, ...l2.src]);
}

function intersect(l1: Line, l2: Line): Vec2 {
  const det = l1.nx * l2.ny - l1.ny * l2.nx;
  return [(l1.c * l2.ny - l2.c * l1.ny) / det, (l1.nx * l2.c - l2.nx * l1.c) / det];
}

/** Orthogonalises one ring; returns null when the ring cannot be regularised safely (caller falls back). */
function snapRing(edges: Ed[], theta: number, maxDev: number, minEdge: number): { ring: Vec2[]; src: number[][] } | null {
  const n0 = edges.length;
  let lines: Line[] = edges.map((e, i) => {
    const b = edges[(i + 1) % n0].a;
    const phi = Math.atan2(b[1] - e.a[1], b[0] - e.a[0]);
    const k = Math.round((phi - theta) / (Math.PI / 2));
    const dev = phi - theta - k * (Math.PI / 2);
    const snapped = Math.abs(dev) <= maxDev;
    return mkLine(snapped ? theta + k * (Math.PI / 2) : phi, (e.a[0] + b[0]) / 2, (e.a[1] + b[1]) / 2, Math.hypot(b[0] - e.a[0], b[1] - e.a[1]), snapped, k, e.src.slice());
  });
  for (let guard = 0; guard < 10_000; guard++) {
    const n = lines.length;
    if (n < 3) return null;
    let merged = false;
    for (let i = 0; i < n && !merged; i++) {
      const j = (i + 1) % n;
      const s = Math.sin(lines[j].psi - lines[i].psi);
      const c = Math.cos(lines[j].psi - lines[i].psi);
      if (Math.abs(s) < SIN_PAR) {
        if (c < 0) return null; // spike / zero-width slot
        const m = mergeLines(lines[i], lines[j]);
        if (j === 0) lines = [m, ...lines.slice(1, n - 1)];
        else lines.splice(i, 2, m);
        merged = true;
      }
    }
    if (merged) continue;
    const verts = lines.map((l, i) => intersect(lines[(i - 1 + n) % n], l));
    let worst = -1;
    let worstLen = Infinity;
    for (let i = 0; i < n; i++) {
      const v0 = verts[i];
      const v1 = verts[(i + 1) % n];
      const signed = (v1[0] - v0[0]) * Math.cos(lines[i].psi) + (v1[1] - v0[1]) * Math.sin(lines[i].psi);
      if (signed < worstLen) (worstLen = signed), (worst = i);
    }
    if (worstLen >= minEdge) return { ring: verts, src: lines.map((l) => l.src) };
    if (n <= 3) return null;
    const prev = lines[(worst - 1 + n) % n];
    const next = lines[(worst + 1) % n];
    (prev.len >= next.len ? prev : next).src.push(...lines[worst].src);
    lines.splice(worst, 1);
  }
  return null;
}

/** Angular distance (rad) between direction phi and the nearest of axis c, c + 90deg, c + 180deg, c + 270deg. */
function axisDistance(phi: number, c: number): number {
  const q = Math.PI / 2;
  const d = (((phi - c) % q) + q) % q;
  return Math.min(d, q - d);
}

/**
 * Dominant axis (rad): the edge direction (mod 90deg) supported by the most edge length within `maxDev`
 * (weights 1 - (dev/maxDev)^2), refined by the fourfold circular mean (theta = 1/4 atan2(sum L sin 4phi, sum L cos 4phi))
 * of its supporting edges. Unlike a global fourfold mean, two edge families 14 deg apart cannot pull the axis between them.
 */
function dominantAxis(rings: Ed[][], maxDev: number): number {
  const edges: { phi: number; len: number }[] = [];
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i].a;
    const b = ring[(i + 1) % ring.length].a;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > 1e-9) edges.push({ phi: Math.atan2(b[1] - a[1], b[0] - a[0]), len });
  }
  if (!edges.length) return 0;
  const tol = Math.max(maxDev, 1e-6);
  let best = edges[0].phi;
  let bestScore = -Infinity;
  for (const cand of edges) {
    let score = 0;
    for (const e of edges) {
      const d = axisDistance(e.phi, cand.phi);
      if (d <= tol) score += e.len * (1 - (d / tol) ** 2);
    }
    if (score > bestScore + 1e-9) (bestScore = score), (best = cand.phi);
  }
  let sx = 0;
  let sy = 0;
  for (const e of edges) {
    if (axisDistance(e.phi, best) > tol) continue;
    sx += e.len * Math.cos(4 * (e.phi - best));
    sy += e.len * Math.sin(4 * (e.phi - best));
  }
  return best + Math.atan2(sy, sx) / 4;
}

/** Cleaning-only fallback: removes micro-edges by deleting the vertex whose removal changes the area least. */
function dropMicroEdges(edges: Ed[], minEdge: number): Ed[] {
  const r = edges.map((e) => ({ a: e.a, src: e.src.slice() }));
  for (let guard = 0; guard < 10_000 && r.length > 3; guard++) {
    let i = -1;
    let best = Infinity;
    for (let k = 0; k < r.length; k++) {
      const b = r[(k + 1) % r.length].a;
      const l = Math.hypot(b[0] - r[k].a[0], b[1] - r[k].a[1]);
      if (l < best) (best = l), (i = k);
    }
    if (best >= minEdge) break;
    const j = (i + 1) % r.length;
    const tri = (k: number) => {
      const p = r[(k - 1 + r.length) % r.length].a;
      const q = r[(k + 1) % r.length].a;
      return Math.abs((q[0] - p[0]) * (r[k].a[1] - p[1]) - (q[1] - p[1]) * (r[k].a[0] - p[0])) / 2;
    };
    const del = tri(i) <= tri(j) ? i : j;
    r[(del - 1 + r.length) % r.length].src.push(...r[del].src);
    r.splice(del, 1);
  }
  return r;
}

/** Regularises a footprint and reports how output edges map to input edges (see {@link RegularizeResult}). */
export function regularizeFootprintDetailed(poly: PolygonM, opts: RegularizeOptions = {}): RegularizeResult {
  const maxDev = (opts.maxDeviationDeg ?? 8) * D2R;
  const minEdge = opts.minEdge ?? 0.3;
  const tol = opts.collinearTol ?? 0.05;
  const maxChange = opts.maxAreaChange ?? 0.02;
  const notes: string[] = [];
  const inputRings = [poly.outer, ...(poly.holes ?? [])];
  let base = 0;
  const cleaned = inputRings.map((ring, idx) => {
    const e = clean(orientedEdges(ring, idx === 0, base), tol);
    base += ring.length;
    return e;
  });
  const theta = dominantAxis(cleaned, maxDev);
  const axisDeg = (((theta / D2R) % 90) + 90) % 90;
  const area0 = polyArea(poly);
  const build = (rings: { ring: Vec2[]; src: number[][] }[]): RegularizeResult & { ok: boolean } => {
    const polygon: PolygonM = { outer: rings[0].ring, holes: rings.slice(1).map((r) => r.ring) };
    const change = area0 > 0 ? (polyArea(polygon) - area0) / area0 : 0;
    const orientOk = ringArea(polygon.outer) > 0 && (polygon.holes ?? []).every((h) => ringArea(h) < 0);
    const ok = orientOk && rings.every((r) => r.ring.length >= 3) && isSimple(polygon) && Math.abs(change) < maxChange;
    return { polygon, sourceEdges: rings.flatMap((r) => r.src), axisDeg, areaChange: change, orthogonalized: false, notes, ok };
  };
  const snapped = cleaned.map((ring) => snapRing(ring, theta, maxDev, minEdge));
  if (snapped.every((s) => s)) {
    const res = build(snapped as { ring: Vec2[]; src: number[][] }[]);
    if (res.ok) {
      const { ok: _ok, ...out } = res;
      return { ...out, orthogonalized: true };
    }
    notes.push(`orthogonalisation rejected (area change ${(res.areaChange * 100).toFixed(2)} % or invalid ring)`);
  } else notes.push('orthogonalisation not applicable (spike or degenerate ring)');
  const fallback = build(cleaned.map((ring) => {
    const r = dropMicroEdges(ring, minEdge);
    return { ring: r.map((e) => e.a), src: r.map((e) => e.src) };
  }));
  if (fallback.ok) {
    const { ok: _ok, ...out } = fallback;
    return out;
  }
  notes.push('micro-edge removal rejected: returning the cleaned input');
  const { ok: _ok, ...plain } = build(cleaned.map((ring) => ({ ring: ring.map((e) => e.a), src: ring.map((e) => e.src) })));
  return plain;
}

/** Regularised footprint (outer CCW, holes CW). Area change is always < `maxAreaChange` (2 %). */
export function regularizeFootprint(poly: PolygonM, opts: RegularizeOptions = {}): PolygonM {
  return regularizeFootprintDetailed(poly, opts).polygon;
}

/** Maps per-edge kinds of the input polygon onto a regularised polygon (each output edge takes the kind of its longest source edge). */
export function mapEdgeKinds<T>(result: RegularizeResult, inputKinds: T[], input: PolygonM): T[] {
  const lens: number[] = [];
  for (const ring of [input.outer, ...(input.holes ?? [])]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      lens.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
  }
  return result.sourceEdges.map((src) => {
    let best = src[0];
    for (const s of src) if ((lens[s] ?? 0) > (lens[best] ?? 0)) best = s;
    return inputKinds[best];
  });
}
