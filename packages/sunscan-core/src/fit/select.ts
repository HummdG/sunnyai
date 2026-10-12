// Robust fitting of one model (nonlinear grid x profile initialisation x Tukey IRLS) and two-stage robust-BIC
// model selection on a common pixel set (research 05 sections 3.3-3.5; fit.py `fit_part_model`, `_fit_aligned`).
import { type Design, TUKEY_C, arange, irlsNonneg, madScale, profileInit, profileInit2, robustCost } from './robust.js';
import { type ModelDef, type RectSpec, nParams, nonnegCols, rectLibrary } from './models.js';

/** Pixels of a fit: n pixels x S2 sub-samples (interleaved x, y in `sub`), observed heights z. */
export interface SampleSet { n: number; S2: number; sub: Float64Array; z: Float64Array }

/** Robust-fit and selection constants (research 05 section 3.4-3.5). */
export interface FitSettings {
  sigma0: number; // provisional scale (m)
  sigmaMin: number;
  c: number; // Tukey constant
  variantPrior: boolean;
  minStep: number; // data-driven cuts must separate surfaces by >= minStep (m)
}
/** sigma0 0.25 m, sigma* >= 0.05 m, Tukey c = 4.685, variant prior on, data cuts need a >= 1 m step. */
export const DEFAULT_FIT: FitSettings = { sigma0: 0.25, sigmaMin: 0.05, c: TUKEY_C, variantPrior: true, minStep: 1.0 };

const DEG_POS = arange(0, 71, 1);
const DEG_NEG = arange(-30, 71, 1);

/** Area-averaged regression features of a model from sub-sample times t (n * S2), optionally masked. */
export function featureColumns(m: ModelDef, t: Float64Array, n: number, S2: number, g: number, mask?: Uint8Array): Float64Array[] {
  if (m.family === 'flat') return [];
  const f1 = new Float64Array(n);
  if (m.twoPitch) {
    const f2 = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let a = 0, b = 0;
      for (let j = 0; j < S2; j++) {
        const i = k * S2 + j;
        if (mask && !mask[i]) continue;
        const tt = t[i];
        a += Math.min(tt, g);
        b += Math.max(tt - g, 0);
      }
      f1[k] = a / S2; f2[k] = b / S2;
    }
    return [f1, f2];
  }
  for (let k = 0; k < n; k++) {
    let a = 0;
    for (let j = 0; j < S2; j++) {
      const i = k * S2 + j;
      if (mask && !mask[i]) continue;
      a += t[i];
    }
    f1[k] = a / S2;
  }
  return [f1];
}

/** Best fit of one model over its nonlinear grid (design, coefficients, residuals, weights, robust cost). */
export interface ModelFit { model: ModelDef; g: number; X: Design; beta: number[]; r: Float64Array; w: Float64Array; cost: number }

/** Best robust fit of one model over its nonlinear grid at a fixed scale sigma. */
export function fitModel(m: ModelDef, set: SampleSet, sigma: number, c = TUKEY_C): ModelFit {
  const ones = new Float64Array(set.n).fill(1);
  const grid = m.grid.length ? m.grid : [0];
  const tFixed = m.gDependent ? null : m.times(set.sub, 0);
  const scratch = new Float64Array(set.n);
  const fitAt = (g: number): ModelFit => {
    const t = tFixed ?? m.times(set.sub, g);
    const X: Design = [ones, ...featureColumns(m, t, set.n, set.S2, g)];
    const b0 = m.twoPitch ? profileInit2(X, set.z, sigma, c, scratch)
      : profileInit(X, set.z, sigma, c, m.family === 'gable' && m.allowNeg ? DEG_NEG : DEG_POS, scratch);
    const o = irlsNonneg(X, set.z, sigma, b0, nonnegCols(m), c);
    let cost = robustCost(o.r, sigma, c);
    if (m.twoPitch && o.beta[1] < o.beta[2] - 0.05) cost = Infinity; // the lower slope must be the steeper one
    return { model: m, g, X, beta: o.beta, r: o.r, w: o.w, cost };
  };
  const fits = grid.map(fitAt);
  let best = fits.reduce((a, b) => (b.cost < a.cost ? b : a));
  if (m.refine) {
    // coarse-to-fine: refine around the best 3 coarse values
    const tried = new Set(grid);
    for (const f of [...fits].sort((a, b) => a.cost - b.cost).slice(0, 3)) {
      for (const g of m.refine(f.g)) {
        if (tried.has(g)) continue;
        tried.add(g);
        const r = fitAt(g);
        if (r.cost < best.cost) best = r;
      }
    }
  }
  return best;
}

/** One part of a hypothesis: model, nonlinear value and current coefficients. */
export interface PartChoice<P = unknown> { model: ModelDef; g: number; beta: number[]; part: P }

/** A roof hypothesis on the common pixel set (single part or a partition with a joint design). */
export interface Hyp<P = unknown> {
  kind: 'single' | 'partition';
  label: string;
  parts: PartChoice<P>[];
  nCuts: number;
  X: Design;
  /** Column range [start, end) of each part in X. */
  slices: [number, number][];
  beta: number[];
  r: Float64Array;
  w: Float64Array;
  cost: number;
  crit: number;
  /** ln pi(H): optional family prior. */
  logPrior: number;
  /** Data-driven cut validation: median height step between the part surfaces along the cut (m), evaluated
   *  with the hypothesis' current coefficients. */
  cutStep?: () => number;
  /** Opaque payload for the caller (e.g. partition geometry). */
  meta?: unknown;
}

/** k_H: parameters of all parts plus one per cut. */
export const hypK = (h: Hyp): number => h.parts.reduce((s, p) => s + nParams(p.model), 0) + h.nCuts;

/** Single-part hypothesis from a model fit. */
export function singleHyp<P>(f: ModelFit, part: P, logPrior = 0): Hyp<P> {
  return {
    kind: 'single', label: f.model.label, parts: [{ model: f.model, g: f.g, beta: f.beta.slice(), part }], nCuts: 0,
    X: f.X, slices: [[0, f.X.length]], beta: f.beta.slice(), r: f.r, w: f.w, cost: f.cost, crit: Infinity, logPrior,
  };
}

/** (Re)fit a hypothesis' joint design at scale sigma from its current coefficients; updates cost and parts. */
export function refitHyp(h: Hyp, z: Float64Array, sigma: number, c = TUKEY_C): void {
  const nn: number[] = [];
  h.parts.forEach((p, j) => nn.push(...nonnegCols(p.model, h.slices[j][0])));
  const o = irlsNonneg(h.X, z, sigma, h.beta, nn, c);
  h.beta = o.beta; h.r = o.r; h.w = o.w;
  h.cost = robustCost(o.r, sigma, c);
  h.parts.forEach((p, j) => {
    const [a, b] = h.slices[j];
    p.beta = o.beta.slice(a, b);
    if (p.model.twoPitch && p.beta[1] < p.beta[2] - 0.05) h.cost = Infinity;
  });
}

/** Selected hypothesis, its index, the common scale sigma*, posteriors and the stage-1 best. */
export interface Selection<P = unknown> { best: Hyp<P>; index: number; sigma: number; post: number[]; best1: Hyp<P> }

/**
 * Two-stage selection: hypotheses arrive fitted at the provisional scale (cost set); sigma* = max(sigmaMin,
 * 1.4826 MAD) of the best stage-1 hypothesis (cost + k ln n); stage 2 refits all at sigma* and scores
 * RBIC = sum rho~(r / sigma*) + k ln n + 2 sum ln V - 2 ln pi(H) (+inf for invalid data cuts).
 */
export function selectHypotheses<P>(hyps: Hyp<P>[], z: Float64Array, s: FitSettings = DEFAULT_FIT): Selection<P> {
  const n = z.length, lnN = Math.log(n);
  let best1 = hyps[0];
  for (const h of hyps) if (h.cost + hypK(h) * lnN < best1.cost + hypK(best1) * lnN) best1 = h;
  const sigma = Math.max(s.sigmaMin, madScale(best1.r));
  for (const h of hyps) {
    refitHyp(h, z, sigma, s.c);
    let crit = h.cost + hypK(h) * lnN;
    if (s.variantPrior) for (const p of h.parts) crit += 2 * Math.log(p.model.nVariants);
    crit -= 2 * h.logPrior;
    if (h.cutStep && Number.isFinite(crit) && !(h.cutStep() >= s.minStep)) crit = Infinity;
    h.crit = crit;
  }
  let index = 0;
  for (let i = 1; i < hyps.length; i++) if (hyps[i].crit < hyps[index].crit) index = i;
  const cmin = hyps[index].crit;
  const ws = hyps.map((h) => (Number.isFinite(h.crit) ? Math.exp(-(h.crit - cmin) / 2) : 0));
  const tot = ws.reduce((a, b) => a + b, 0);
  return { best: hyps[index], index, sigma, post: ws.map((w) => w / tot), best1 };
}

/** Result of the Python-oracle-compatible rectangle fitter. */
export interface RectOracleResult {
  label: string; beta: number[]; g: number | null; sigma: number; pBest: number; ridge: number; pitchDeg: number | null;
  all: { label: string; crit: number }[];
}

/**
 * Single-part model selection on one rectangle (no partitions, no co-registration), sub-samples given in the
 * rectangle's (u, v) frame. Mirrors research/methods/ts/roofit-core.ts `fitRect` (Python oracle parity).
 */
export function fitRectangleOracle(rect: RectSpec, sub: Float64Array, n: number, S2: number, z: Float64Array, erode = 0.5, s: FitSettings = DEFAULT_FIT): RectOracleResult {
  const set: SampleSet = { n, S2, sub, z };
  const hyps = rectLibrary(rect, { erode }).map((m) => singleHyp(fitModel(m, set, s.sigma0, s.c), null));
  const sel = selectHypotheses(hyps, z, s);
  const b = sel.best.parts[0];
  const fam = b.model.family;
  const tmax = fam === 'flat' ? 0 : b.model.tmax(b.g);
  const beta = b.beta;
  const ridge = fam === 'flat' ? beta[0]
    : b.model.twoPitch ? beta[0] + beta[1] * Math.min(tmax, b.g) + beta[2] * Math.max(tmax - b.g, 0) : beta[0] + beta[1] * tmax;
  return {
    label: b.model.label, beta: beta.slice(), g: b.model.grid.length ? b.g : null, sigma: sel.sigma, pBest: sel.post[sel.index], ridge,
    pitchDeg: fam === 'flat' ? null : (Math.atan(beta[1]) * 180) / Math.PI,
    all: hyps.map((h) => ({ label: h.label, crit: h.crit })),
  };
}
