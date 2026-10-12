// Test stub (reference fitter): Tukey-biweight robust line fit (research 05 §3.4).
import { median } from '../../../src/pipeline/raster.js';

/** Tukey biweight tuning constant (95 % efficiency). */
export const TUKEY_C = 4.685;

/** Bounded Tukey loss rho~(u) = (c²/3)[1 - (1 - (u/c)²)³] (≈ u² near 0, c²/3 beyond c). */
export function rhoTukey(u: number, c = TUKEY_C): number {
  const a = Math.abs(u);
  if (a >= c) return (c * c) / 3;
  const t = 1 - (u / c) ** 2;
  return ((c * c) / 3) * (1 - t * t * t);
}

/** Tukey IRLS weight (1 - (u/c)²)² inside c, 0 outside. */
export function weightTukey(u: number, c = TUKEY_C): number {
  const a = Math.abs(u);
  if (a >= c) return 0;
  const t = 1 - (u / c) ** 2;
  return t * t;
}

/** Result of a robust fit z = e + s·tau. */
export interface LineFit {
  e: number;
  s: number;
  residuals: Float64Array;
  cost: number; // sum of rho~(r/sigma)
  inliers: number; // pixels with non-zero weight
  /** sigma² (XᵀWX)⁻¹ as [var(e), cov(e,s), var(s)] (var(s) = 0 for flat). */
  cov: [number, number, number];
}

/**
 * Robust fit of z = e + s·tau (s >= 0; `flat` forces s = 0): profile initialisation over pitch 0..70° (or the given
 * start), then Tukey IRLS (c = 4.685) at a fixed scale `sigma` (docs/research/05 §3.4).
 */
export function robustLineFit(z: Float64Array, tau: Float64Array, sigma: number, flat: boolean, start?: { e: number; s: number }): LineFit {
  const n = z.length;
  const tmp = new Float64Array(n);
  const costOf = (e: number, s: number) => {
    let c = 0;
    for (let k = 0; k < n; k++) c += rhoTukey((z[k] - e - s * tau[k]) / sigma);
    return c;
  };
  let e: number;
  let s: number;
  if (start) ({ e, s } = start);
  else if (flat) {
    e = median(z);
    s = 0;
  } else {
    let best = { e: median(z), s: 0, c: Infinity };
    for (let deg = 0; deg <= 70; deg++) {
      const ss = Math.tan((deg * Math.PI) / 180);
      for (let k = 0; k < n; k++) tmp[k] = z[k] - ss * tau[k];
      const ee = median(tmp);
      const c = costOf(ee, ss);
      if (c < best.c) best = { e: ee, s: ss, c };
    }
    ({ e, s } = best);
  }
  let S0 = 0, S1 = 0, S2 = 0;
  for (let it = 0; it < 60; it++) {
    S0 = 0; S1 = 0; S2 = 0;
    let Sz = 0, Stz = 0;
    for (let k = 0; k < n; k++) {
      const w = weightTukey((z[k] - e - s * tau[k]) / sigma);
      S0 += w; S1 += w * tau[k]; S2 += w * tau[k] * tau[k]; Sz += w * z[k]; Stz += w * tau[k] * z[k];
    }
    if (S0 <= 1e-12) break;
    let ne: number;
    let ns: number;
    const det = S0 * S2 - S1 * S1;
    if (flat || det <= 1e-9 * Math.max(1, S0 * S2)) {
      ns = 0;
      ne = Sz / S0;
    } else {
      ns = (S0 * Stz - S1 * Sz) / det;
      ne = (Sz - ns * S1) / S0;
      if (ns < 0) {
        ns = 0;
        ne = Sz / S0;
      }
    }
    const delta = Math.max(Math.abs(ne - e), Math.abs(ns - s));
    e = ne;
    s = ns;
    if (delta < 1e-5) break;
  }
  const residuals = new Float64Array(n);
  let inliers = 0;
  for (let k = 0; k < n; k++) {
    residuals[k] = z[k] - e - s * tau[k];
    if (Math.abs(residuals[k] / sigma) < TUKEY_C) inliers++;
  }
  const det = S0 * S2 - S1 * S1;
  const s2 = sigma * sigma;
  const cov: [number, number, number] =
    flat || det <= 1e-12 ? [S0 > 0 ? s2 / S0 : NaN, 0, 0] : [(s2 * S2) / det, (-s2 * S1) / det, (s2 * S0) / det];
  return { e, s, residuals, cost: costOf(e, s), inliers, cov };
}
