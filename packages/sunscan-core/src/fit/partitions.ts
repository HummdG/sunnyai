// Multi-part hypotheses (research 05 section 3.9): reflex-vertex cuts (extend each edge incident to a reflex
// vertex into the interior) and data-driven step cuts on near-rectangles (robust planes either side of a line
// disagree by > 0.8 m), up to 3 parts. Each part's candidate models are fitted on its core pixels (>= 0.5 m from
// cuts); the top 2 per part are combined and fitted jointly on the common pixel set with mixed-pixel fractions:
//     z_k = sum_j [ f_kj e_j + s_j tau_kj ],  f_kj = fraction of pixel k's sub-samples in part j.
import type { Vec2 } from '../geometry/geom.js';
import { type Design, irls, median, arange } from './robust.js';
import { type LibraryOptions, type ModelDef, type PartGeom, makePartGeom, nParams, partLibrary } from './models.js';
import { type PixelSet, subsetPixels } from './pixels.js';
import { type FitSettings, type Hyp, type ModelFit, featureColumns, fitModel, refitHyp } from './select.js';
import { lineRingCrossings, pointInPoly, pointInRing, rayHit, reflexVertices, segDist2, splitRing, toU, toV } from './poly.js';

/** A split of a footprint into 2-3 parts along internal cuts. */
export interface Partition {
  parts: PartGeom[];
  nCuts: number;
  /** Internal cut segments (local metres). */
  cuts: { a: Vec2; b: Vec2 }[];
  /** Data-driven (height-step) cut: accepted only if the fitted surfaces differ by >= minStep along it. */
  dataCut: boolean;
}

/** Partition search limits (research 05 section 3.9). */
export interface PartitionOptions {
  maxParts: number;
  minPartArea: number; // m2
  minChord: number; // m
  maxCuts: number; // reflex cuts considered (shortest first)
  erodeCut: number; // core pixels keep this distance from cuts
  minCore: number; // min core pixels per part
  stepThresh: number; // data-driven step threshold (m)
  maxPartitions: number; // reflex partitions kept (fewest parts, then shortest total cut length)
}
/** At most 3 parts, parts >= 5 m2, 6 shortest reflex cuts, 12 partitions, 0.5 m core erosion. */
export const DEFAULT_PARTITION: PartitionOptions = { maxParts: 3, minPartArea: 5, minChord: 1, maxCuts: 6, erodeCut: 0.5, minCore: 4, stepThresh: 0.8, maxPartitions: 12 };

const sameChord = (p: { a: Vec2; b: Vec2 }, q: { a: Vec2; b: Vec2 }) => {
  const eq = (u: Vec2, v: Vec2) => Math.hypot(u[0] - v[0], u[1] - v[1]) < 1e-6;
  return (eq(p.a, q.a) && eq(p.b, q.b)) || (eq(p.a, q.b) && eq(p.b, q.a));
};

/** Proper crossing of two segments (shared endpoints / touching do not count). */
function properCross(p: { a: Vec2; b: Vec2 }, q: { a: Vec2; b: Vec2 }): boolean {
  const o = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const e = 1e-9;
  const d1 = o(p.a, p.b, q.a), d2 = o(p.a, p.b, q.b), d3 = o(q.a, q.b, p.a), d4 = o(q.a, q.b, p.b);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

/** Partitions from reflex-vertex cuts (2-part per cut, 3-part per non-crossing pair). */
export function reflexPartitions(part: PartGeom, o: PartitionOptions = DEFAULT_PARTITION): Partition[] {
  if ((part.poly.holes ?? []).length || o.maxParts < 2) return [];
  const r = part.poly.outer, n = r.length;
  let cuts: { a: Vec2; b: Vec2; len: number }[] = [];
  for (const i of reflexVertices(r)) {
    const prev = r[(i - 1 + n) % n], cur = r[i], next = r[(i + 1) % n];
    const li = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]), lo = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const dirs: Vec2[] = [[(cur[0] - prev[0]) / li, (cur[1] - prev[1]) / li], [(cur[0] - next[0]) / lo, (cur[1] - next[1]) / lo]];
    for (const d of dirs) {
      const hit = rayHit(r, cur[0], cur[1], d[0], d[1], [(i - 1 + n) % n, i]);
      if (!hit || hit.s < o.minChord) continue;
      const c = { a: [cur[0], cur[1]] as Vec2, b: [hit.x, hit.y] as Vec2, len: hit.s };
      if (!cuts.some((q) => sameChord(q, c))) cuts.push(c);
    }
  }
  cuts = cuts.sort((p, q) => p.len - q.len).slice(0, o.maxCuts);
  const out: Partition[] = [];
  const okArea = (rings: { ring: Vec2[] }[]) => rings.every((x) => polyAreaRing(x.ring) >= o.minPartArea);
  for (const c of cuts) {
    const s = splitRing(r, part.attrs, c.a, c.b);
    if (!s || !okArea(s)) continue;
    out.push({ parts: s.map((x) => makePartGeom({ outer: x.ring }, x.attrs)), nCuts: 1, cuts: [{ a: c.a, b: c.b }], dataCut: false });
  }
  if (o.maxParts >= 3) {
    for (let i = 0; i < cuts.length; i++) for (let j = i + 1; j < cuts.length; j++) {
      const c1 = cuts[i], c2 = cuts[j];
      if (properCross(c1, c2)) continue;
      const s1 = splitRing(r, part.attrs, c1.a, c1.b);
      if (!s1) continue;
      const mid: Vec2 = [(c2.a[0] + c2.b[0]) / 2, (c2.a[1] + c2.b[1]) / 2];
      const k = s1.findIndex((x) => pointInRing(mid[0], mid[1], x.ring));
      if (k < 0) continue;
      const s2 = splitRing(s1[k].ring, s1[k].attrs, c2.a, c2.b);
      if (!s2) continue;
      const rings = [s1[1 - k], s2[0], s2[1]];
      if (!okArea(rings)) continue;
      out.push({ parts: rings.map((x) => makePartGeom({ outer: x.ring }, x.attrs)), nCuts: 2, cuts: [{ a: c1.a, b: c1.b }, { a: c2.a, b: c2.b }], dataCut: false });
    }
  }
  const cutLen = (p: Partition) => p.cuts.reduce((a, c) => a + Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]), 0);
  return out.map((p, i) => ({ p, i })).sort((x, y) => x.p.nCuts - y.p.nCuts || cutLen(x.p) - cutLen(y.p) || x.i - y.i).slice(0, o.maxPartitions).map((x) => x.p);
}

const polyAreaRing = (r: Vec2[]) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1];
  return Math.abs(s / 2);
};

/** Pixel indices of `part` whose centres are inside it and >= erodeCut from every cut segment. */
export function corePixels(part: PartGeom, p: Partition, ps: PixelSet, erodeCut: number): number[] {
  const idx: number[] = [];
  for (let k = 0; k < ps.n; k++) {
    const x = ps.cx[k], y = ps.cy[k];
    if (!pointInPoly(x, y, part.poly)) continue;
    if (p.cuts.every((c) => segDist2(x, y, c.a[0], c.a[1], c.b[0], c.b[1]) >= erodeCut * erodeCut)) idx.push(k);
  }
  return idx;
}

/** Sub-sample -> part assignment and per-part fractions for the joint design. */
export interface JointContext {
  partition: Partition;
  n: number;
  S2: number;
  masks: Uint8Array[];
  frac: Float64Array[];
  subIdx: Int32Array[];
  subPts: Float64Array[];
  cache: Map<string, Float64Array>;
}

/** Assign every sub-sample to the part containing it (else the nearest) and derive per-pixel fractions. */
export function jointContext(p: Partition, ps: PixelSet): JointContext {
  const N = ps.n * ps.S2, m = p.parts.length;
  const assign = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    const x = ps.sub[2 * i], y = ps.sub[2 * i + 1];
    let a = p.parts.findIndex((q) => pointInPoly(x, y, q.poly));
    if (a < 0) {
      let bd = Infinity;
      p.parts.forEach((q, j) => {
        const r = q.poly.outer;
        for (let e = 0; e < r.length; e++) {
          const s = r[e], t = r[(e + 1) % r.length];
          const d = segDist2(x, y, s[0], s[1], t[0], t[1]);
          if (d < bd) { bd = d; a = j; }
        }
      });
    }
    assign[i] = a;
  }
  const masks: Uint8Array[] = [], frac: Float64Array[] = [], subIdx: Int32Array[] = [], subPts: Float64Array[] = [];
  for (let j = 0; j < m; j++) {
    const mask = new Uint8Array(N), f = new Float64Array(ps.n), ids: number[] = [];
    for (let i = 0; i < N; i++) if (assign[i] === j) { mask[i] = 1; ids.push(i); f[Math.floor(i / ps.S2)] += 1 / ps.S2; }
    const pts = new Float64Array(2 * ids.length);
    ids.forEach((i, k) => { pts[2 * k] = ps.sub[2 * i]; pts[2 * k + 1] = ps.sub[2 * i + 1]; });
    masks.push(mask); frac.push(f); subIdx.push(Int32Array.from(ids)); subPts.push(pts);
  }
  return { partition: p, n: ps.n, S2: ps.S2, masks, frac, subIdx, subPts, cache: new Map() };
}

function partTimes(ctx: JointContext, j: number, m: ModelDef, g: number): Float64Array {
  const key = `${j}|${m.label}|${m.gDependent ? g : ''}`;
  let t = ctx.cache.get(key);
  if (!t) {
    const tc = m.times(ctx.subPts[j], g);
    t = new Float64Array(ctx.n * ctx.S2);
    ctx.subIdx[j].forEach((i, k) => { t![i] = tc[k]; });
    ctx.cache.set(key, t);
  }
  return t;
}

/** Joint design [f_j, features_j]_j for one model per part. */
export function jointDesign(ctx: JointContext, choices: { model: ModelDef; g: number }[]): { X: Design; slices: [number, number][] } {
  const X: Design = [], slices: [number, number][] = [];
  choices.forEach((c, j) => {
    const start = X.length;
    X.push(ctx.frac[j]);
    X.push(...featureColumns(c.model, partTimes(ctx, j, c.model, c.g), ctx.n, ctx.S2, c.g, ctx.masks[j]));
    slices.push([start, X.length]);
  });
  return { X, slices };
}

/** Fitted roof height of one part at a point. */
export function surfaceAt(m: ModelDef, g: number, beta: number[], t: number): number {
  if (m.family === 'flat') return beta[0];
  if (m.twoPitch) return beta[0] + beta[1] * Math.min(t, g) + beta[2] * Math.max(t - g, 0);
  return beta[0] + beta[1] * t;
}

/** Median |surface_A - surface_B| along the (first) cut of a 2-part hypothesis. */
export function cutStep(h: Hyp, p: Partition): number {
  const c = p.cuts[0];
  const L = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
  if (L < 1.2 || h.parts.length < 2) return 0;
  const dx = (c.b[0] - c.a[0]) / L, dy = (c.b[1] - c.a[1]) / L;
  const pts = new Float64Array(30);
  for (let k = 0; k < 15; k++) {
    const s = 0.5 + ((L - 1) * k) / 14;
    pts[2 * k] = c.a[0] + s * dx; pts[2 * k + 1] = c.a[1] + s * dy;
  }
  const [A, B] = h.parts;
  const ta = A.model.times(pts, A.g), tb = B.model.times(pts, B.g);
  const d: number[] = [];
  for (let k = 0; k < 15; k++) d.push(Math.abs(surfaceAt(A.model, A.g, A.beta, ta[k]) - surfaceAt(B.model, B.g, B.beta, tb[k])));
  return median(d);
}

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, l) => acc.flatMap((a) => l.map((x) => [...a, x])), [[]]);
}

/** Stage-1 partition hypotheses: per-part core fits (top 2) combined into joint fits at sigma0. */
export function partitionHypotheses(partitions: Partition[], ps: PixelSet, s: FitSettings, lib: LibraryOptions, o: PartitionOptions = DEFAULT_PARTITION, topK = 2): Hyp<PartGeom>[] {
  const hyps: Hyp<PartGeom>[] = [];
  for (const p of partitions) {
    const tops: ModelFit[][] = [];
    let ok = true;
    for (const part of p.parts) {
      const core = corePixels(part, p, ps, o.erodeCut);
      if (core.length < o.minCore) { ok = false; break; }
      const set = subsetPixels(ps, core);
      const lnN = Math.log(set.n);
      const fits = partLibrary(part, { ...lib, butterfly: false, asymGable: false }).map((m) => fitModel(m, set, s.sigma0, s.c));
      fits.sort((a, b) => a.cost + nParams(a.model) * lnN - (b.cost + nParams(b.model) * lnN));
      tops.push(fits.slice(0, topK));
    }
    if (!ok) continue;
    const ctx = jointContext(p, ps);
    for (const combo of cartesian(tops)) {
      const { X, slices } = jointDesign(ctx, combo);
      const beta = combo.flatMap((f) => f.beta);
      const h: Hyp<PartGeom> = {
        kind: 'partition', label: combo.map((f) => f.model.label).join('+'),
        parts: combo.map((f, j) => ({ model: f.model, g: f.g, beta: f.beta.slice(), part: p.parts[j] })), nCuts: p.nCuts,
        X, slices, beta, r: new Float64Array(ps.n), w: new Float64Array(ps.n), cost: Infinity, crit: Infinity, logPrior: 0, meta: p,
      };
      if (p.dataCut) h.cutStep = () => cutStep(h, p);
      refitHyp(h, ps.z, s.sigma0, s.c);
      hyps.push(h);
    }
  }
  return hyps;
}

/** Cheap score of a partition (best simple model per part on its core, then a joint fit): lower is better. */
function quickScore(p: Partition, ps: PixelSet, s: FitSettings, lib: LibraryOptions, o: PartitionOptions): number {
  const simple: LibraryOptions = { ...lib, butterfly: false, closedForms: false, twoPitch: false, asymGable: false, crossGable: false };
  const fits: ModelFit[] = [];
  for (const part of p.parts) {
    const core = corePixels(part, p, ps, o.erodeCut);
    if (core.length < o.minCore) return Infinity;
    const set = subsetPixels(ps, core);
    const lnN = Math.log(set.n);
    const f = partLibrary(part, simple).map((m) => fitModel(m, set, s.sigma0, s.c));
    f.sort((a, b) => a.cost + nParams(a.model) * lnN - (b.cost + nParams(b.model) * lnN));
    fits.push(f[0]);
  }
  const ctx = jointContext(p, ps);
  const { X, slices } = jointDesign(ctx, fits);
  const h: Hyp = {
    kind: 'partition', label: '', parts: fits.map((f) => ({ model: f.model, g: f.g, beta: f.beta.slice(), part: null })), nCuts: 1,
    X, slices, beta: fits.flatMap((f) => f.beta), r: new Float64Array(ps.n), w: new Float64Array(ps.n), cost: Infinity, crit: Infinity, logPrior: 0,
  };
  refitHyp(h, ps.z, s.sigma0, s.c);
  return h.cost + (fits.reduce((a, f) => a + nParams(f.model), 0) + 1) * Math.log(ps.n);
}

/**
 * Robust height step across the line x = c: for strips of constant along-line position y_j (9 strips), robust lines
 * z = a + b (x - c) are fitted to the pixels of each band (c - band <= x < c - 0.25 and c + 0.25 < x <= c + band)
 * and extrapolated to the line; the step is the median |a_left - a_right| over strips with data on both sides.
 * Unlike one plane per band (fit.py `step_cuts`), a ridge crossing the line cannot masquerade as a step, while a
 * slope continuing across the line still agrees at x = c (no step).
 */
function stepAcross(x: Float64Array, y: Float64Array, z: Float64Array, c: number, ylines: number[], half: number, band: number, cT: number): number {
  const d: number[] = [];
  for (const yl of ylines) {
    const a: number[] = [];
    for (const sgn of [-1, 1]) {
      const idx: number[] = [];
      for (let k = 0; k < x.length; k++) {
        const xv = x[k];
        if (Math.abs(y[k] - yl) > half) continue;
        if (sgn < 0 ? xv >= c - band && xv < c - 0.25 : xv > c + 0.25 && xv <= c + band) idx.push(k);
      }
      if (idx.length < 3) break;
      let xmin = Infinity, xmax = -Infinity;
      for (const k of idx) { xmin = Math.min(xmin, x[k]); xmax = Math.max(xmax, x[k]); }
      if (xmax - xmin < 0.9) break;
      const zz = Float64Array.from(idx, (k) => z[k]);
      const X = [new Float64Array(idx.length).fill(1), Float64Array.from(idx, (k) => x[k] - c)];
      a.push(irls(X, zz, 0.3, [median(zz), 0], cT, { iters: 15 }).beta[0]);
    }
    if (a.length === 2) d.push(Math.abs(a[0] - a[1]));
  }
  return d.length >= 3 ? median(d) : 0;
}

/** Data-driven step cuts on a near-rectangular part (research 05 section 3.9 item 2 + refinement by quick joint fits). */
export function stepCutPartitions(part: PartGeom, ps: PixelSet, s: FitSettings, lib: LibraryOptions, o: PartitionOptions = DEFAULT_PARTITION, minLen = 2, band = 2): Partition[] {
  if ((part.poly.holes ?? []).length || part.rectangularity < lib.nearRect || o.maxParts < 2) return [];
  const f = part.frame;
  const U = Float64Array.from(ps.cx, (x, k) => toU(f, x, ps.cy[k]));
  const V = Float64Array.from(ps.cx, (x, k) => toV(f, x, ps.cy[k]));
  const out: Partition[] = [];
  for (const axis of [0, 1] as const) {
    const lo = axis === 0 ? part.u0 : part.v0, hi = axis === 0 ? part.u1 : part.v1;
    if (hi - lo < 2 * minLen + 0.5) continue;
    const x = axis === 0 ? U : V, y = axis === 0 ? V : U;
    const ylo = axis === 0 ? part.v0 : part.u0, yhi = axis === 0 ? part.v1 : part.u1;
    const ylines = Array.from({ length: 9 }, (_, k) => ylo + 0.5 + ((yhi - ylo - 1) * k) / 8);
    const half = Math.max(0.6, (yhi - ylo - 1) / 16);
    const cs = arange(lo + minLen, hi - minLen + 1e-9, 0.25);
    const steps = cs.map((c) => stepAcross(x, y, ps.z, c, ylines, half, band, s.c));
    const order = cs.map((_, i) => i).sort((a, b) => steps[b] - steps[a]);
    const chosen: number[] = [];
    for (const i of order) {
      if (!(steps[i] >= o.stepThresh)) break;
      if (chosen.every((j) => Math.abs(cs[i] - cs[j]) > 1.5)) chosen.push(i);
      if (chosen.length >= 2) break;
    }
    for (const i of chosen) {
      let best: Partition | null = null, bs = Infinity;
      for (const c of arange(cs[i] - 0.5, cs[i] + 0.501, 0.25)) {
        if (c < lo + 1.5 || c > hi - 1.5) continue;
        const cr = lineRingCrossings(part.poly.outer, f, c, axis === 0 ? 'u' : 'v');
        if (cr.length !== 2) continue;
        const sp = splitRing(part.poly.outer, part.attrs, cr[0], cr[1]);
        if (!sp || sp.some((q) => polyAreaRing(q.ring) < o.minPartArea)) continue;
        const p: Partition = { parts: sp.map((q) => makePartGeom({ outer: q.ring }, q.attrs)), nCuts: 1, cuts: [{ a: cr[0], b: cr[1] }], dataCut: true };
        const sc = quickScore(p, ps, s, lib, o);
        if (sc < bs) { bs = sc; best = p; }
      }
      if (best) out.push(best);
    }
  }
  return out;
}
