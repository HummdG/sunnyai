// Neighbourhood co-registration (research 05 section 3.8): ONE translation d for the target and all neighbours,
// maximising the mean across-edge nDSM contrast
//     J(d) = mean_b [ n(b - 0.6 nu_b + d) - n(b + 0.6 nu_b + d) ],   n = clip(DSM - DTM, -1, 10), bilinear,
// over points b every 0.25 m along all non-party edges (nu_b = outward normal). Coarse grid +-search @ 0.5 m,
// then +-0.5 m @ 0.1 m around the best; one widening pass (+-2 search) when the optimum is on the boundary.
import type { HeightGrid } from '../types.js';
import type { EdgeKind } from '../geometry/roof.js';
import type { PolygonM, Vec2 } from '../geometry/geom.js';
import { arange } from './robust.js';
import { resampleTo } from './raster.js';
import { ringsOf } from './poly.js';

/** A footprint taking part in the registration (planar coordinates; party edges are skipped). */
export interface CoregFootprint { poly: PolygonM; kinds: EdgeKind[]; isTarget?: boolean }

/** Search settings of the across-edge contrast registration (metres). */
export interface CoregOptions {
  search: number; coarseStep: number; fineRadius: number; fineStep: number;
  edgeOffset: number; spacing: number; minEdge: number; weakPeak: number; maxCoarsePoints: number; widen: boolean;
}
/** Research 05 defaults: +-6 m @ 0.5 m, then +-0.5 m @ 0.1 m; samples every 0.25 m, +-0.6 m across. */
export const DEFAULT_COREG: CoregOptions = {
  search: 6, coarseStep: 0.5, fineRadius: 0.5, fineStep: 0.1, edgeOffset: 0.6, spacing: 0.25, minEdge: 1.0, weakPeak: 1.0,
  maxCoarsePoints: 4000, widen: true,
};

/** Registration outcome: applied shift, peak score / shape, method and quality flags. */
export interface CoregResult {
  /** Translation to ADD to all footprints (planar metres); [0, 0] when registration failed. */
  shift: Vec2;
  /** Best translation found (even when rejected). */
  rawShift: Vec2;
  /** J at the optimum (m). */
  score: number;
  /** Principal standard deviations of the region where J >= 0.95 J* (m). */
  sigmaMajor: number;
  sigmaMinor: number;
  method: 'edge-neighbourhood' | 'target-only' | 'none';
  /** 'on-boundary' | 'weak-peak' | '1d-ambiguous' | 'min-shift' (ambiguous ridge resolved to the smallest
   *  near-optimal translation) | 'no-edges'. */
  flags: string[];
  failed: boolean;
  nSamples: number;
  evaluations: number;
}

interface Samples { fi: Float64Array; gi: Float64Array; fo: Float64Array; go: Float64Array; m: number; neighbours: boolean }

/** Edge sample pairs in fractional pixel coordinates, kept when valid for all shifts up to `reach` metres. */
function edgeSamples(g: HeightGrid, fps: CoregFootprint[], o: CoregOptions, reach: number): Samples {
  const fi: number[] = [], gi: number[] = [], fo: number[] = [], go: number[] = [];
  const marg = reach / g.res + 1e-9;
  const ok = (fx: number, fy: number) => fx >= marg && fy >= marg && fx <= g.width - 1 - marg - 1e-9 && fy <= g.height - 1 - marg - 1e-9;
  let neighbours = false;
  for (const fp of fps) {
    let e = 0;
    for (const r of ringsOf(fp.poly)) {
      for (let i = 0; i < r.length; i++, e++) {
        if (fp.kinds[e] === 'party') continue;
        const a = r[i], b = r[(i + 1) % r.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < o.minEdge) continue;
        const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L;
        const nx = ty, ny = -tx; // outward for CCW outer rings / CW holes
        for (const s of arange(o.spacing, L - o.spacing + 0.01, o.spacing)) {
          const px = a[0] + s * tx, py = a[1] + s * ty;
          const ix = (px - o.edgeOffset * nx - g.originX) / g.res - 0.5, iy = (g.originY - (py - o.edgeOffset * ny)) / g.res - 0.5;
          const ox = (px + o.edgeOffset * nx - g.originX) / g.res - 0.5, oy = (g.originY - (py + o.edgeOffset * ny)) / g.res - 0.5;
          if (!ok(ix, iy) || !ok(ox, oy)) continue;
          fi.push(ix); gi.push(iy); fo.push(ox); go.push(oy);
          if (!fp.isTarget) neighbours = true;
        }
      }
    }
  }
  return { fi: Float64Array.from(fi), gi: Float64Array.from(gi), fo: Float64Array.from(fo), go: Float64Array.from(go), m: fi.length, neighbours };
}

function strided(s: Samples, max: number): Samples {
  if (s.m <= max) return s;
  const step = s.m / max;
  const idx = Array.from({ length: max }, (_, k) => Math.floor(k * step));
  const pick = (a: Float64Array) => Float64Array.from(idx, (i) => a[i]);
  return { fi: pick(s.fi), gi: pick(s.gi), fo: pick(s.fo), go: pick(s.go), m: max, neighbours: s.neighbours };
}

/** Estimate the footprint -> raster translation (research 05 section 3.8). */
export function coregister(dsm: HeightGrid, dtm: HeightGrid, fps: CoregFootprint[], opts: Partial<CoregOptions> = {}): CoregResult {
  const o = { ...DEFAULT_COREG, ...opts };
  const W = dsm.width;
  const dtmV = resampleTo(dtm, dsm);
  const nd = new Float64Array(W * dsm.height);
  for (let i = 0; i < nd.length; i++) {
    const v = dsm.data[i] - dtmV[i];
    nd[i] = v !== v ? NaN : v < -1 ? -1 : v > 10 ? 10 : v;
  }
  let evaluations = 0;
  const J = (s: Samples, dx: number, dy: number): number => {
    evaluations++;
    const sx = dx / dsm.res, sy = -dy / dsm.res;
    let sum = 0, cnt = 0;
    for (let k = 0; k < s.m; k++) {
      const a = bil(nd, W, s.fi[k] + sx, s.gi[k] + sy), b = bil(nd, W, s.fo[k] + sx, s.go[k] + sy);
      if (a === a && b === b) { sum += a - b; cnt++; }
    }
    return cnt ? sum / cnt : -Infinity;
  };
  const fail = (flag: string, m = 0): CoregResult => ({
    shift: [0, 0], rawShift: [0, 0], score: NaN, sigmaMajor: NaN, sigmaMinor: NaN, method: 'none', flags: [flag], failed: true, nSamples: m, evaluations,
  });
  const reach1 = o.search + o.fineRadius + 0.05;
  const base = edgeSamples(dsm, fps, o, reach1);
  if (base.m < 8) return fail('no-edges', base.m);
  const method = base.neighbours ? 'edge-neighbourhood' : 'target-only';
  // coarse pass over [-lim, lim]^2 (optionally skipping the inner square already searched)
  const runCoarse = (s: Samples, lim: number, skipInside: number) => {
    const g = arange(-lim, lim + 1e-9, o.coarseStep);
    const ss = strided(s, o.maxCoarsePoints);
    const pts: { d: Vec2; j: number }[] = [];
    let best: Vec2 = [0, 0], bj = -Infinity;
    for (const dx of g) for (const dy of g) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= skipInside + 1e-9) continue;
      const j = J(ss, dx, dy);
      pts.push({ d: [dx, dy], j });
      if (j > bj) { bj = j; best = [dx, dy]; }
    }
    return { best, bj, pts, lim };
  };
  let coarse = runCoarse(base, o.search, -1);
  let samples = base;
  const onBoundary = (d: Vec2, lim: number) => Math.abs(d[0]) >= lim - 1e-9 || Math.abs(d[1]) >= lim - 1e-9;
  let boundary = onBoundary(coarse.best, o.search);
  if (boundary && o.widen) {
    const wide = edgeSamples(dsm, fps, o, 2 * o.search + o.fineRadius + 0.05);
    if (wide.m >= Math.max(8, 0.5 * base.m)) {
      const inner = runCoarse(wide, o.search, -1);
      const outer = runCoarse(wide, 2 * o.search, o.search);
      const merged = inner.bj >= outer.bj ? inner : outer;
      coarse = { best: merged.best, bj: merged.bj, pts: [...inner.pts, ...outer.pts], lim: 2 * o.search };
      samples = wide;
      boundary = onBoundary(coarse.best, 2 * o.search);
    }
  }
  // fine pass (all samples) around the coarse optimum
  let best: Vec2 = [coarse.best[0], coarse.best[1]];
  let bj = J(samples, best[0], best[1]);
  const fineOff = arange(-o.fineRadius, o.fineRadius + 1e-4, o.fineStep);
  const fine: { d: Vec2; j: number }[] = [];
  const c0 = best;
  for (const ax of fineOff) for (const ay of fineOff) {
    const d: Vec2 = [c0[0] + ax, c0[1] + ay];
    const j = J(samples, d[0], d[1]);
    fine.push({ d, j });
    if (j > bj) { bj = j; best = d; }
  }
  // peak shape: second moment of the region J >= 0.95 J* about the optimum (+ cell variance)
  const region = (pts: { d: Vec2; j: number }[], jstar: number, h: number) => {
    const sel = pts.filter((p) => p.j >= 0.95 * jstar);
    let a = 0, b = 0, c = 0;
    for (const p of sel) {
      const ux = p.d[0] - best[0], uy = p.d[1] - best[1];
      a += ux * ux; b += ux * uy; c += uy * uy;
    }
    const m = Math.max(1, sel.length);
    a = a / m + (h * h) / 12; b /= m; c = c / m + (h * h) / 12;
    const tr = (a + c) / 2, det = Math.sqrt(((a - c) / 2) ** 2 + b * b);
    return { major: Math.sqrt(tr + det), minor: Math.sqrt(Math.max(tr - det, 0)), sel };
  };
  let peak = region(fine, bj, o.fineStep);
  const rim = o.fineRadius - 1e-6;
  const touches = peak.sel.some((p) => Math.abs(p.d[0] - c0[0]) >= rim || Math.abs(p.d[1] - c0[1]) >= rim);
  if (touches && bj > 0) {
    const cj = Math.max(...coarse.pts.map((p) => p.j));
    const pc = region(coarse.pts.filter((p) => Number.isFinite(p.j)), cj, o.coarseStep);
    if (pc.major > peak.major) peak = pc;
  }
  const flags: string[] = [];
  const ambiguous = peak.major > 0.5 && peak.major > 3 * peak.minor;
  let minShift = false;
  if (ambiguous && !boundary && peak.sel.length) {
    // along an ambiguous ridge (e.g. a uniform terrace sliding along the row) J* is arbitrary: OSM imagery offsets
    // are small, so take the smallest near-optimal translation and refine it locally
    const cand = peak.sel.reduce((a, p) => (Math.hypot(p.d[0], p.d[1]) < Math.hypot(a.d[0], a.d[1]) ? p : a));
    if (Math.hypot(cand.d[0], cand.d[1]) < Math.hypot(best[0], best[1]) - 0.25) {
      let b2: Vec2 = [cand.d[0], cand.d[1]], j2 = J(samples, b2[0], b2[1]);
      const cc = b2;
      for (const ax of fineOff) for (const ay of fineOff) {
        const d: Vec2 = [cc[0] + ax, cc[1] + ay];
        const j = J(samples, d[0], d[1]);
        if (j > j2) { j2 = j; b2 = d; }
      }
      if (j2 >= 0.95 * bj) { best = b2; bj = j2; minShift = true; }
    }
  }
  // most severe first (CoregResult.flags[0] becomes FitReport.registration.flag)
  if (boundary) flags.push('on-boundary');
  if (!(bj >= o.weakPeak)) flags.push('weak-peak');
  if (ambiguous) flags.push('1d-ambiguous');
  if (minShift) flags.push('min-shift');
  const failed = boundary || !(bj >= o.weakPeak);
  return {
    shift: boundary ? [0, 0] : [round4(best[0]), round4(best[1])], rawShift: [round4(best[0]), round4(best[1])], score: bj,
    sigmaMajor: peak.major, sigmaMinor: peak.minor, method, flags, failed, nSamples: samples.m, evaluations,
  };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Bilinear sample at fractional (pixel-centre) coordinates; the caller guarantees in-range indices. */
function bil(a: Float64Array, W: number, fx: number, fy: number): number {
  const c = Math.floor(fx), r = Math.floor(fy);
  const tx = fx - c, ty = fy - r;
  const i = r * W + c;
  return (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + W] * (1 - tx) + a[i + W + 1] * tx) * ty;
}
