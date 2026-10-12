// Test stub (reference fitter): one rigid translation for all footprints of a neighbourhood that maximises the mean
// across-edge nDSM contrast (docs/research/05 §3.8; coarse 0.5 m over ±6 m, then 0.1 m over ±0.5 m).
import type { EdgeKind, FitReport, PolygonM, Vec2 } from '@sunny/sunscan-core';
import { pointInPolygon } from '@sunny/sunscan-core/geometry';
import { orientWithKinds } from '../../../src/pipeline/geometry.js';

/** Result of the co-registration search. */
export interface CoregResult {
  registration: FitReport['registration'];
  /** Mean edge contrast at the optimum (m). */
  score: number;
  /** Number of boundary samples used. */
  samples: number;
}

interface Probe { x: number; y: number; nx: number; ny: number }

const OFFSET = 0.6; // m either side of the wall line
const STEP = 0.5; // m between boundary samples

/**
 * Search the translation d (applied to every footprint) maximising J(d) = mean[n(b - 0.6ν + d) - n(b + 0.6ν + d)]
 * over boundary samples b of all free edges (ν outward normal, n = clip(DSM - DTM, -1, 10)).
 * Flags: 'on-boundary' / 'weak-peak' (shift not applied), '1d-ambiguous' (only the across-row component applied).
 */
export function coregister(
  ndsm: (x: number, y: number) => number,
  footprints: { poly: PolygonM; kinds?: EdgeKind[] }[],
  opts: { search?: number; coarse?: number; fine?: number; minScore?: number } = {},
): CoregResult {
  const search = opts.search ?? 6;
  const coarse = opts.coarse ?? 0.5;
  const fine = opts.fine ?? 0.1;
  const minScore = opts.minScore ?? 1.0;
  const polys = footprints.map((f) => orientWithKinds(f.poly, f.kinds));
  const probes: Probe[] = [];
  polys.forEach(({ poly, kinds }, fi) => {
    const r = poly.outer;
    for (let i = 0; i < r.length; i++) {
      if (kinds?.[i] === 'party') continue;
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1) continue;
      const dx = (b[0] - a[0]) / L;
      const dy = (b[1] - a[1]) / L;
      const nx = dy; // outward normal of a CCW ring
      const ny = -dx;
      const count = Math.max(1, Math.floor(L / STEP));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) * (L / count);
        const x = a[0] + dx * t;
        const y = a[1] + dy * t;
        const out: Vec2 = [x + nx * OFFSET, y + ny * OFFSET];
        // skip shared walls: the outside probe falls into another footprint
        if (polys.some((p, pj) => pj !== fi && pointInPolygon(out, p.poly))) continue;
        probes.push({ x, y, nx, ny });
      }
    }
  });
  const none = (flag: string): CoregResult => ({
    registration: { shift: [0, 0], sigmaMajor: NaN, sigmaMinor: NaN, method: 'none', flag },
    score: 0,
    samples: probes.length,
  });
  if (probes.length < 8) return none('too-few-edges');
  const n = (x: number, y: number) => {
    const v = ndsm(x, y);
    return Number.isFinite(v) ? Math.max(-1, Math.min(10, v)) : NaN;
  };
  const J = (dx: number, dy: number) => {
    let s = 0;
    let c = 0;
    for (const p of probes) {
      const vin = n(p.x - p.nx * OFFSET + dx, p.y - p.ny * OFFSET + dy);
      const vout = n(p.x + p.nx * OFFSET + dx, p.y + p.ny * OFFSET + dy);
      if (Number.isNaN(vin) || Number.isNaN(vout)) continue;
      s += vin - vout;
      c++;
    }
    return c >= Math.max(8, probes.length * 0.25) ? s / c : -Infinity;
  };
  const steps = Math.round(search / coarse);
  const grid: { dx: number; dy: number; j: number }[] = [];
  let best = { dx: 0, dy: 0, j: -Infinity };
  for (let i = -steps; i <= steps; i++)
    for (let k = -steps; k <= steps; k++) {
      const g = { dx: i * coarse, dy: k * coarse, j: J(i * coarse, k * coarse) };
      grid.push(g);
      if (g.j > best.j || (g.j === best.j && Math.hypot(g.dx, g.dy) < Math.hypot(best.dx, best.dy))) best = g;
    }
  if (!Number.isFinite(best.j)) return none('no-data');
  const onBoundary = Math.abs(best.dx) >= search - 1e-9 || Math.abs(best.dy) >= search - 1e-9;
  // spread of the >= 95 % region -> 2-D uncertainty
  const region = grid.filter((g) => Number.isFinite(g.j) && g.j >= 0.95 * best.j);
  const mx = region.reduce((s, g) => s + g.dx, 0) / region.length;
  const my = region.reduce((s, g) => s + g.dy, 0) / region.length;
  let sxx = (coarse * coarse) / 12;
  let syy = sxx;
  let sxy = 0;
  for (const g of region) {
    sxx += ((g.dx - mx) ** 2) / region.length;
    syy += ((g.dy - my) ** 2) / region.length;
    sxy += ((g.dx - mx) * (g.dy - my)) / region.length;
  }
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(1e-6, tr / 2 - disc);
  const sigmaMajor = Math.sqrt(l1);
  const sigmaMinor = Math.sqrt(l2);
  // fine search around the coarse optimum
  let fb = best;
  const fs = Math.round(coarse / fine);
  for (let i = -fs; i <= fs; i++)
    for (let k = -fs; k <= fs; k++) {
      const dx = best.dx + i * fine;
      const dy = best.dy + k * fine;
      const j = J(dx, dy);
      if (j > fb.j) fb = { dx, dy, j };
    }
  const method = footprints.length > 1 ? 'edge-neighbourhood' : 'target-only';
  let shift: Vec2 = [fb.dx, fb.dy];
  let flag: string | undefined;
  if (onBoundary) flag = 'on-boundary';
  else if (fb.j < minScore) flag = 'weak-peak';
  else if (sigmaMajor > 0.75 && sigmaMajor > 2.5 * sigmaMinor) {
    flag = '1d-ambiguous';
    // keep only the well-constrained component (along the minor axis of the ambiguity ellipse)
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // major-axis direction
    const m: Vec2 = [-Math.sin(ang), Math.cos(ang)];
    const proj = shift[0] * m[0] + shift[1] * m[1];
    shift = [proj * m[0], proj * m[1]];
  }
  if (flag === 'on-boundary' || flag === 'weak-peak') shift = [0, 0];
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    registration: { shift: [r3(shift[0]), r3(shift[1])], sigmaMajor: r3(sigmaMajor), sigmaMinor: r3(sigmaMinor), method, ...(flag ? { flag } : {}) },
    score: fb.j,
    samples: probes.length,
  };
}
