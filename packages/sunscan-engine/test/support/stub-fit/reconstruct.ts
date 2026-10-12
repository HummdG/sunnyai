// Test stub (deterministic reference fitter, independent of core/fit) implementing the ReconstructInput ->
// ReconstructOutput contract (docs/research/05 §3): neighbourhood edge co-registration, DTM-median ground, eroded
// pixel selection, whole-footprint hypotheses {flat, hip, gable (two orientations)} through the weighted-straight-
// skeleton time field of @sunscan/core/geometry, area-averaged design (3x3 sub-samples), Tukey IRLS at a common scale
// σ*, robust BIC selection, chimneys from positive residual clusters, neighbour heights (p90).
// No partitions / multi-part hypotheses: complex buildings come out with σ* > 0.5 m => unreliable.
import type { ChimneySpec, EdgeKind, HeightGrid, PolygonM, ReconstructedPart, ReconstructInput, ReconstructOutput, RoofType, Vec2 } from '@sunny/sunscan-core';
import { pointInPolygon, skeletonTimeField, type TimeField } from '@sunny/sunscan-core/geometry';
import { minAreaRect } from '@sunny/sunscan-core/geo';
import { mapPolygon, orientWithKinds } from '../../../src/pipeline/geometry.js';
import { coregister } from './coregister.js';
import { mad, median, pixelsInPolygon, quantile, sameGrid, sampleBilinear, type Px } from '../../../src/pipeline/raster.js';
import { robustLineFit, TUKEY_C, type LineFit } from './robust.js';

interface Hyp { label: string; family: string; type: RoofType; kinds: EdgeKind[]; k: number; variants: number; flat: boolean; field?: TimeField }
interface Scored { h: Hyp; tau: Float64Array; fit: LineFit; rbic: number }

const SUB = 3; // sub-samples per pixel side

/** Edge kinds for hypotheses: party edges stay party; free edges become eaves or gables by orientation. */
function hypotheses(poly: PolygonM, kinds: EdgeKind[]): Hyp[] {
  const rect = minAreaRect(poly.outer as [number, number][]);
  const axis = (rect.longAxisBearingDeg * Math.PI) / 180; // compass bearing of the long side
  const dirLong: Vec2 = [Math.sin(axis), Math.cos(axis)];
  const ring = poly.outer;
  const parallelToLong = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return Math.abs(((b[0] - a[0]) * dirLong[0] + (b[1] - a[1]) * dirLong[1]) / L) >= Math.SQRT1_2;
  });
  const holes = kinds.length - ring.length;
  const base = kinds.map((k) => (k === 'party' ? 'party' : 'eave') as EdgeKind);
  const gable = (eaveLong: boolean): EdgeKind[] =>
    base.map((k, i) => (k === 'party' || i >= ring.length ? k : parallelToLong[i] === eaveLong ? 'eave' : 'gable'));
  const out: Hyp[] = [{ label: 'flat', family: 'flat', type: 'flat', kinds: base, k: 1, variants: 1, flat: true }];
  const seen = new Set<string>();
  const add = (label: string, family: string, type: RoofType, ks: EdgeKind[], variants: number) => {
    const key = ks.join(',');
    if (seen.has(key) || !ks.slice(0, ks.length - holes).includes('eave')) return;
    seen.add(key);
    out.push({ label, family, type, kinds: ks, k: 2, variants, flat: false });
  };
  add('hip', 'hip', 'hipped', base, 1);
  add('gable-long', 'gable', 'gabled', gable(true), 2);
  add('gable-short', 'gable', 'gabled', gable(false), 2);
  return out;
}

/** Mean skeleton time over SUB x SUB sub-samples of each pixel (NaN if no sub-sample is inside). */
function designTau(field: TimeField, px: Px[], res: number): Float64Array {
  const tau = new Float64Array(px.length);
  for (let k = 0; k < px.length; k++) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < SUB; i++)
      for (let j = 0; j < SUB; j++) {
        const t = field.t([px[k].x + ((i + 0.5) / SUB - 0.5) * res, px[k].y + ((j + 0.5) / SUB - 0.5) * res]);
        if (t !== null) {
          s += t;
          c++;
        }
      }
    tau[k] = c ? s / c : NaN;
  }
  return tau;
}

/** Positive residual clusters (8-connected) of 0.25–4 m² rising >= max(0.8 m, 3σ) above the fitted roof. */
function detectChimneys(px: Px[], z: Float64Array, residuals: Float64Array, sigma: number, res: number, angleDeg: number): ChimneySpec[] {
  const thr = Math.max(0.8, 3 * sigma);
  const hot = new Map<string, number>();
  px.forEach((p, k) => {
    if (residuals[k] > thr) hot.set(`${p.col},${p.row}`, k);
  });
  const seen = new Set<string>();
  const out: ChimneySpec[] = [];
  for (const [key, k0] of hot) {
    if (seen.has(key)) continue;
    const stack = [k0];
    const members: number[] = [];
    seen.add(key);
    while (stack.length) {
      const k = stack.pop()!;
      members.push(k);
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++) {
          const nk = `${px[k].col + dc},${px[k].row + dr}`;
          const m = hot.get(nk);
          if (m !== undefined && !seen.has(nk)) {
            seen.add(nk);
            stack.push(m);
          }
        }
    }
    const area = members.length * res * res;
    if (area < 0.25 || area > 4) continue;
    const cx = members.reduce((s, k) => s + px[k].x, 0) / members.length;
    const cy = members.reduce((s, k) => s + px[k].y, 0) / members.length;
    const size = Math.max(0.6, Math.min(1.5, Math.sqrt(area)));
    out.push({ center: [cx, cy], width: size, depth: size, angleDeg, top: Math.max(...members.map((k) => z[k])), source: 'lidar' });
  }
  return out.sort((a, b) => b.top - a.top).slice(0, 4);
}

const failure = (ground: number, registration: ReconstructOutput['registration'], flags: string[], nPixels = 0): ReconstructOutput => ({
  ok: false,
  ground,
  groundCheck: null,
  registration,
  parts: [],
  chimneys: [],
  neighbourHeights: [],
  report: { sigma: NaN, rmse: NaN, inlierFraction: 0, nPixels, pModel: 0, unreliable: true, selected: 'none', alternatives: [] },
  samples: [],
  flags,
});

/** Reference stub: minimal LiDAR roof fit implementing the core/fit `reconstruct` contract (deterministic). */
export function stubReconstruct(input: ReconstructInput): ReconstructOutput {
  const { dsm, dtm } = input;
  const ndsm = (x: number, y: number) => sampleBilinear(dsm, x, y) - sampleBilinear(dtm, x, y);
  const target = orientWithKinds(input.target.footprint, input.target.edgeKinds);
  const kinds = target.kinds ?? target.poly.outer.map(() => 'eave' as EdgeKind);
  const neighbours = input.neighbours.map((n) => ({ id: n.id, ...orientWithKinds(n.footprint, n.edgeKinds) }));

  // [A] co-registration of the neighbourhood (one translation)
  const coreg = coregister(ndsm, [{ poly: target.poly, kinds }, ...neighbours.map((n) => ({ poly: n.poly, kinds: n.kinds }))], {
    search: input.options?.searchRadius ?? 6,
  });
  const reg = coreg.registration;
  const shiftP = (p: PolygonM) => mapPolygon(p, ([x, y]) => [x + reg.shift[0], y + reg.shift[1]]);
  const fp = shiftP(target.poly);
  const flags: string[] = reg.flag ? [`registration-${reg.flag}`] : [];

  // [B] ground = DTM median inside the footprint; cross-check: DTM median in a 1-3 m ring outside all footprints
  const inside = pixelsInPolygon(dtm, fp);
  const ground = median(inside.map((p) => dtm.data[p.idx]));
  if (!Number.isFinite(ground)) return failure(NaN, reg, [...flags, 'no-dtm-under-footprint']);
  const groundCheck = ringGround(dtm, fp, neighbours.map((n) => shiftP(n.poly)));
  if (groundCheck !== null && Math.abs(groundCheck - ground) > 0.5) flags.push('ground-mismatch');

  // [D] pixel selection: eroded 0.5 m from free edges, 0.25 m from party edges; vegetation/overhang mask if dsmLast
  const erode = input.options?.erode ?? 0.5;
  const erodeParty = input.options?.erodeParty ?? 0.25;
  const last = input.dsmLast && sameGrid(dsm, input.dsmLast) ? input.dsmLast : undefined;
  const px = pixelsInPolygon(dsm, fp, kinds, erode, erodeParty).filter((p) => {
    const v = dsm.data[p.idx];
    if (!Number.isFinite(v)) return false;
    return !(last && Number.isFinite(last.data[p.idx]) && v - last.data[p.idx] > 1);
  });
  const z = Float64Array.from(px, (p) => dsm.data[p.idx] - ground);
  if (px.length < 15) return failure(ground, reg, [...flags, 'too-few-pixels'], px.length);

  // [E] hypotheses + [G] robust fits at sigma0 = 0.25 m, then common scale sigma*
  const hyps = hypotheses(target.poly, kinds);
  const scored: Scored[] = [];
  for (const h of hyps) {
    let tau: Float64Array = new Float64Array(px.length);
    if (!h.flat) {
      try {
        h.field = skeletonTimeField(fp, h.kinds, Math.max(0.5, dsm.res));
        tau = designTau(h.field, px, dsm.res);
      } catch {
        continue; // skeleton failure on a degenerate footprint: skip the hypothesis
      }
      const fill = median(tau);
      for (let k = 0; k < tau.length; k++) if (!Number.isFinite(tau[k])) tau[k] = fill;
    }
    scored.push({ h, tau, fit: robustLineFit(z, tau, 0.25, h.flat), rbic: Infinity });
  }
  const n = px.length;
  const best1 = scored.reduce((a, b) => (b.fit.cost + b.h.k * Math.log(n) < a.fit.cost + a.h.k * Math.log(n) ? b : a));
  const sigma = Math.max(0.05, 1.4826 * mad(best1.fit.residuals));
  for (const s of scored) {
    s.fit = robustLineFit(z, s.tau, sigma, s.h.flat, { e: s.fit.e, s: s.fit.s });
    s.rbic = s.fit.cost + s.h.k * Math.log(n) + 2 * Math.log(s.h.variants);
  }
  scored.sort((a, b) => a.rbic - b.rbic);
  const minR = scored[0].rbic;
  const wsum = scored.reduce((acc, s) => acc + Math.exp(-(s.rbic - minR) / 2), 0);
  const best = scored[0];
  const pModel = 1 / wsum;
  const inlierFraction = best.fit.inliers / n;
  let rss = 0;
  let nin = 0;
  for (const r of best.fit.residuals) if (Math.abs(r) < TUKEY_C * sigma) (rss += r * r), nin++;
  const rmse = nin ? Math.sqrt(rss / nin) : NaN;
  const unreliable = sigma > 0.5 || inlierFraction < 0.7 || n < 15;

  // [I] outputs
  const pitchDeg = (Math.atan(best.fit.s) * 180) / Math.PI;
  const isFlat = best.h.flat || pitchDeg < 5;
  const tmax = !isFlat && best.h.field ? best.h.field.skeleton.maxTime : 0;
  const eave = best.fit.e;
  if (!(eave > 1.5)) flags.push('building-missing-in-lidar');
  const part: ReconstructedPart = {
    id: 'main',
    role: 'main',
    footprint: fp,
    edgeKinds: isFlat ? kinds.map((k) => (k === 'party' ? 'party' : 'eave')) : best.h.kinds,
    roof: isFlat ? { type: 'flat' } : { type: best.h.type, pitchDeg },
    eaveHeight: eave,
    ridgeHeight: isFlat ? eave : eave + best.fit.s * tmax,
    family: isFlat ? 'flat' : best.h.label,
    eaveSE: Math.sqrt(best.fit.cov[0]),
    ...(isFlat ? {} : { pitchSE: ((Math.sqrt(best.fit.cov[2]) / (1 + best.fit.s ** 2)) * 180) / Math.PI }),
  };
  const axisDeg = 90 - minAreaRect(fp.outer as [number, number][]).longAxisBearingDeg;
  const chimneys = unreliable ? [] : detectChimneys(px, z, best.fit.residuals, sigma, dsm.res, axisDeg);
  const neighbourHeights = neighbours.flatMap((nb) => {
    const vals = pixelsInPolygon(dsm, shiftP(nb.poly)).map((p) => dsm.data[p.idx] - ground);
    const h = vals.filter(Number.isFinite).length >= 4 ? quantile(vals, 0.9) : NaN;
    return Number.isFinite(h) ? [{ id: nb.id, height: h }] : [];
  });
  return {
    ok: !unreliable && eave > 1.5,
    ground,
    groundCheck,
    registration: reg,
    parts: [part],
    chimneys,
    neighbourHeights,
    report: {
      sigma,
      rmse,
      inlierFraction,
      nPixels: n,
      pModel,
      unreliable,
      selected: part.family,
      alternatives: scored.slice(1).map((s) => ({ label: s.h.label, deltaCriterion: s.rbic - minR })),
    },
    samples: px.map((p, k) => ({ x: p.x, y: p.y, z: z[k], residual: best.fit.residuals[k] })),
    flags,
  };
}

/** Median DTM in the ring 1–3 m outside the footprint, excluding pixels within 0.5 m of any footprint (or null). */
function ringGround(dtm: HeightGrid, fp: PolygonM, others: PolygonM[]): number | null {
  const grow = (p: PolygonM, d: number): PolygonM => {
    const c = p.outer.reduce((s, q) => [s[0] + q[0] / p.outer.length, s[1] + q[1] / p.outer.length], [0, 0]);
    // approximate offset by radial scaling about the vertex mean (adequate for a cross-check)
    return mapPolygon(p, ([x, y]) => {
      const dx = x - c[0];
      const dy = y - c[1];
      const r = Math.hypot(dx, dy) || 1;
      return [c[0] + dx * (1 + d / r), c[1] + dy * (1 + d / r)];
    });
  };
  const outer = grow(fp, 3);
  const vals: number[] = [];
  const all = [fp, ...others].map((p) => grow(p, 0.5));
  const innerFp = grow(fp, 1);
  for (const p of pixelsInPolygon(dtm, outer)) {
    const q: Vec2 = [p.x, p.y];
    if (pointInPolygon(q, innerFp) || all.some((a) => pointInPolygon(q, a))) continue;
    vals.push(dtm.data[p.idx]);
  }
  const m = median(vals);
  return vals.length >= 5 && Number.isFinite(m) ? m : null;
}
