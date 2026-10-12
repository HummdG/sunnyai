// Robust estimation primitives: Tukey-biweight IRLS with an active-set sign constraint, profile-likelihood
// initialisation, medians / MAD / quantiles and a small dense solver. Dependency-free and deterministic.
// Numerics deliberately mirror research/methods/roofit/fit.py (and research/methods/ts/roofit-core.ts) so the
// Python oracle fixtures reproduce to ~1e-10 m (see test/fit-parity.test.ts).

/** Tukey biweight tuning constant (95 % Gaussian efficiency). */
export const TUKEY_C = 4.685;

/** numpy.arange(start, stop, step) semantics for floats: ceil((stop - start) / step) values start + i * step. */
export function arange(start: number, stop: number, step: number): number[] {
  const n = Math.max(0, Math.ceil((stop - start) / step));
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = start + i * step;
  return out;
}

/** k-th smallest (0-based) of a[lo..hi] by Hoare quickselect; partially reorders `a` so that a[i] <= a[k] for i < k. */
function quickselect(a: Float64Array, lo: number, hi: number, k: number): number {
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i]; a[i] = a[j]; a[j] = t;
        i++; j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}

/** Median of the first n entries of `a` (destroys their order). Same value as numpy.median. NaN for n = 0. */
export function medianInPlace(a: Float64Array, n = a.length): number {
  if (n <= 0) return NaN;
  const h = n >> 1;
  const hi = quickselect(a, 0, n - 1, h);
  if (n % 2) return hi;
  let lo = -Infinity;
  for (let i = 0; i < h; i++) if (a[i] > lo) lo = a[i];
  return 0.5 * (lo + hi);
}

/** Median of finite-or-not values (copied; NaN entries must be filtered by the caller). */
export function median(a: ArrayLike<number>): number {
  return medianInPlace(Float64Array.from(a), a.length);
}

/** 1.4826 * median absolute deviation about the median (consistent sigma for Gaussian data). */
export function madScale(r: ArrayLike<number>): number {
  const n = r.length;
  if (!n) return NaN;
  const buf = Float64Array.from(r);
  const m = medianInPlace(buf, n);
  for (let i = 0; i < n; i++) buf[i] = Math.abs(r[i] - m);
  return 1.4826 * medianInPlace(buf, n);
}

/** Quantile with linear interpolation between order statistics (numpy default), q in [0, 1]. */
export function quantile(values: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(values).sort();
  const n = s.length;
  if (!n) return NaN;
  const pos = Math.min(Math.max(q, 0), 1) * (n - 1);
  const i = Math.floor(pos), f = pos - i;
  return i + 1 < n ? s[i] + f * (s[i + 1] - s[i]) : s[i];
}

/** 2 x Tukey biweight rho: ~u^2 for small u, bounded by c^2 / 3. */
export function rhoTilde(u: number, c = TUKEY_C): number {
  const a = Math.min(Math.abs(u) / c, 1);
  const b = 1 - a * a;
  return ((c * c) / 3) * (1 - b * b * b);
}

/** Sum of rhoTilde(r / sigma) over residuals. */
export function robustCost(r: ArrayLike<number>, sigma: number, c = TUKEY_C): number {
  let s = 0;
  for (let k = 0; k < r.length; k++) s += rhoTilde(r[k] / sigma, c);
  return s;
}

/** Solve A x = b by Gaussian elimination with partial pivoting (A is p x p, small). */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    const tmp = M[k]; M[k] = M[p]; M[p] = tmp;
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Inverse of a small symmetric positive-definite matrix (Gauss-Jordan); null when singular. */
export function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (!(Math.abs(M[p][k]) > 1e-300)) return null;
    const tmp = M[k]; M[k] = M[p]; M[p] = tmp;
    const d = M[k][k];
    for (let j = 0; j < 2 * n; j++) M[k][j] /= d;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const f = M[i][k];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) M[i][j] -= f * M[k][j];
    }
  }
  return M.map((row) => row.slice(n));
}

/** Column-major design matrix: X[j][k] = column j, row k. */
export type Design = Float64Array[];

/** Coefficients, residuals, final Tukey weights and the scale used. */
export interface IrlsResult { beta: number[]; r: Float64Array; w: Float64Array; sigma: number }
/** Iteration cap and optional MAD scale re-estimation per iteration. */
export interface IrlsOptions { iters?: number; updateScale?: boolean; sigmaMin?: number }

/** Tukey-biweight IRLS from beta0 (fit.py `irls`): stops after `iters` or when max |d beta| < 1e-5. */
export function irls(X: Design, z: Float64Array, sigma: number, beta0: number[], c = TUKEY_C, opt: IrlsOptions = {}): IrlsResult {
  const n = z.length, p = X.length, iters = opt.iters ?? 40;
  let beta = beta0.slice();
  let sg = sigma;
  const r = new Float64Array(n), w = new Float64Array(n);
  const resid = () => {
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += X[j][k] * beta[j];
      r[k] = z[k] - s;
    }
  };
  const weights = () => {
    const cs = c * sg;
    for (let k = 0; k < n; k++) {
      const u = r[k] / cs;
      const t = Math.max(1 - u * u, 0);
      w[k] = t * t;
    }
  };
  for (let it = 0; it < iters; it++) {
    resid();
    if (opt.updateScale) sg = Math.max(opt.sigmaMin ?? 0.05, madScale(r));
    weights();
    let cnt = 0;
    for (let k = 0; k < n; k++) if (w[k] > 1e-6) cnt++;
    if (cnt < p + 1) break;
    const A: number[][] = [];
    const b: number[] = new Array(p).fill(0);
    for (let i = 0; i < p; i++) {
      const Xi = X[i];
      const row = new Array<number>(p).fill(0);
      for (let j = 0; j < p; j++) {
        const Xj = X[j];
        let s = 0;
        for (let k = 0; k < n; k++) s += Xi[k] * w[k] * Xj[k];
        row[j] = s + (i === j ? 1e-8 : 0);
      }
      A.push(row);
      let s = 0;
      for (let k = 0; k < n; k++) s += Xi[k] * w[k] * z[k];
      b[i] = s;
    }
    const bn = solveLinear(A, b);
    if (!bn.every(Number.isFinite)) break;
    let delta = 0;
    for (let i = 0; i < p; i++) delta = Math.max(delta, Math.abs(bn[i] - beta[i]));
    beta = bn;
    if (delta < 1e-5) break;
  }
  resid();
  weights();
  return { beta, r, w, sigma: sg };
}

/** IRLS with an active-set non-negativity constraint on the listed columns (fit.py `irls_nonneg`): if any of
 *  them ends negative, they are fixed at 0 and the reduced model is refitted from the initial values. */
export function irlsNonneg(X: Design, z: Float64Array, sigma: number, beta0: number[], nonneg: number[], c = TUKEY_C, opt: IrlsOptions = {}): IrlsResult {
  const out = irls(X, z, sigma, beta0, c, opt);
  const bad = nonneg.filter((j) => out.beta[j] < 0);
  if (!bad.length) return out;
  const keep: number[] = [];
  for (let j = 0; j < X.length; j++) if (!bad.includes(j)) keep.push(j);
  const o2 = irls(keep.map((j) => X[j]), z, sigma, keep.map((j) => beta0[j]), c, opt);
  const beta = new Array<number>(X.length).fill(0);
  keep.forEach((j, i) => (beta[j] = o2.beta[i]));
  return { beta, r: o2.r, w: o2.w, sigma: o2.sigma };
}

/** Robust start for single-slope models [1, f]: grid over pitch angles (deg), e = median(z - s f). */
export function profileInit(X: Design, z: Float64Array, sigma: number, c: number, degs: number[], scratch?: Float64Array): number[] {
  const n = z.length;
  const buf = scratch && scratch.length >= n ? scratch : new Float64Array(n);
  if (X.length === 1) {
    buf.set(z);
    return [medianInPlace(buf, n)];
  }
  const f = X[1];
  const R = new Float64Array(n);
  let best = Infinity, out = [0, 0];
  for (const d of degs) {
    const s = Math.tan((d * Math.PI) / 180);
    for (let k = 0; k < n; k++) R[k] = z[k] - s * f[k];
    buf.set(R);
    const e = medianInPlace(buf, n);
    let cost = 0;
    for (let k = 0; k < n; k++) cost += rhoTilde((R[k] - e) / sigma, c);
    if (cost < best) { best = cost; out = [e, s]; }
  }
  return out;
}

const INIT2_D1 = arange(20, 86, 5);
const INIT2_D2 = arange(0, 46, 5);

/** Robust start for two-pitch models [1, min(t,b), max(t-b,0)]: grid lower 20..85 deg x upper 0..45 deg (5 deg). */
export function profileInit2(X: Design, z: Float64Array, sigma: number, c: number, scratch?: Float64Array): number[] {
  const n = z.length;
  const buf = scratch && scratch.length >= n ? scratch : new Float64Array(n);
  const R = new Float64Array(n);
  let best = Infinity, out = [0, 0, 0];
  for (const d1 of INIT2_D1) {
    const a = Math.tan((d1 * Math.PI) / 180);
    for (const d2 of INIT2_D2) {
      const b = Math.tan((d2 * Math.PI) / 180);
      for (let k = 0; k < n; k++) R[k] = z[k] - a * X[1][k] - b * X[2][k];
      buf.set(R);
      const e = medianInPlace(buf, n);
      let cost = 0;
      for (let k = 0; k < n; k++) cost += rhoTilde((R[k] - e) / sigma, c);
      if (cost < best) { best = cost; out = [e, a, b]; }
    }
  }
  return out;
}

/** sigma^2 (X^T W X)^-1 restricted to the given columns (others treated as fixed); null when singular. */
export function covariance(X: Design, w: Float64Array, sigma: number, cols: number[]): number[][] | null {
  const p = cols.length;
  if (!p) return [];
  const n = w.length;
  const A: number[][] = [];
  for (let a = 0; a < p; a++) {
    const row = new Array<number>(p).fill(0);
    for (let b = 0; b < p; b++) {
      const Xa = X[cols[a]], Xb = X[cols[b]];
      let s = 0;
      for (let k = 0; k < n; k++) s += Xa[k] * w[k] * Xb[k];
      row[b] = s;
    }
    A.push(row);
  }
  const inv = invertMatrix(A);
  return inv ? inv.map((row) => row.map((v) => v * sigma * sigma)) : null;
}
