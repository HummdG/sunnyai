// reconstruct(): footprints + DSM/DTM -> LoD2 roof parts (research 05 section 3.1 pipeline):
//   co-registration (one shift per neighbourhood) -> ground (DTM median inside + ring-plane check) -> pixel
//   selection -> single-part hypotheses (model library) + partition hypotheses (reflex / step cuts) -> two-stage
//   robust-BIC selection -> parts (RoofSpec, heights above ground, SEs), chimneys, neighbour heights, report.
import type { BuiltForm, ChimneySpec, Era, ReconstructInput, ReconstructOutput, ReconstructedPart } from '../types.js';
import type { EdgeKind } from '../geometry/roof.js';
import type { PolygonM, Vec2 } from '../geometry/geom.js';
import { coregister } from './coregister.js';
import { estimateGround } from './ground.js';
import { DEFAULT_PIXELS, selectPixels, subsetPixels, type PixelSet } from './pixels.js';
import { DEFAULT_LIBRARY, type LibraryOptions, type ModelDef, type PartGeom, makePartGeom, partLibrary } from './models.js';
import { DEFAULT_FIT, type FitSettings, type Hyp, fitModel, selectHypotheses, singleHyp } from './select.js';
import { DEFAULT_PARTITION, type Partition, partitionHypotheses, reflexPartitions, stepCutPartitions, surfaceAt } from './partitions.js';
import { summarisePart } from './output.js';
import { detectChimneys } from './chimneys.js';
import { neighbourHeights } from './neighbours.js';
import { builtFormFromKinds, familyFromRoofShape, familyPrior, type PriorFamily } from './priors.js';
import { covariance, madScale, median } from './robust.js';
import { detectPartyEdges, normalizeFootprint, pointInPoly, polyCentroid, segDist2, translatePoly } from './poly.js';
import { pixelCentre, pixelWindow } from './raster.js';
import { maxInside, partIssues } from './plausibility.js';

/** Plausibility issues of output parts (see plausibility.ts `partIssues`), de-duplicated; empty when all pass. */
function partsIssues(parts: ReconstructedPart[], dsm: ReconstructInput['dsm'], ground: number): string[] {
  const out = new Set<string>();
  for (const p of parts) {
    const top = maxInside(dsm, p);
    for (const i of partIssues(p, top === null ? null : top - ground)) out.add(i);
  }
  return [...out];
}

/** Identifier of the fitter implementation (FitReport.method). */
export const FIT_METHOD = 'roofit-ts/1';

/** Largest pixel set used for hypothesis selection (larger sets are thinned deterministically). */
export const MAX_FIT_PIXELS = 600;

const priorFamilyOf = (m: ModelDef): PriorFamily => {
  switch (m.family) {
    case 'gable': case 'crossgable': case 'compound': return 'gable';
    case 'halfhip': return 'half-hip';
    case 'mansard': return m.label.startsWith('gambrel') ? 'gambrel' : 'mansard';
    default: return m.family;
  }
};

/** ln pi(H) per model: family prior for the main part, extension prior (table 5.5 last row) for others. */
function makeLogPrior(input: ReconstructInput, poly: PolygonM, kinds: EdgeKind[]): (m: ModelDef, main: boolean) => number {
  const pr = input.priors;
  if (!input.options?.usePriors || !pr) return () => 0;
  const form: BuiltForm = pr.builtForm && pr.builtForm !== 'unknown' ? pr.builtForm : builtFormFromKinds(poly, kinds);
  const era: Era = pr.era ?? 'unknown';
  const base = familyPrior(form, era, (pr.buildingTag ?? '').toLowerCase() === 'bungalow');
  const tagged = familyFromRoofShape(pr.roofShapeHint);
  const ext: Record<PriorFamily, number> = { gable: 0.25, hip: 0.045, pyramid: 0.005, flat: 0.4, skillion: 0.2, 'half-hip': 0.03, mansard: 0.035, gambrel: 0.035 };
  return (m, main) => {
    const f = priorFamilyOf(m);
    let p = main ? base[f] : ext[f];
    if (main && tagged) p = (tagged === f ? 0.7 : 0) + 0.3 * p;
    return Math.log(Math.max(p, 1e-4));
  };
}

/** Index of the part containing (x, y), else the nearest one. */
function partIndexAt(parts: PartGeom[], x: number, y: number): number {
  const k = parts.findIndex((p) => pointInPoly(x, y, p.poly));
  if (k >= 0) return k;
  let best = 0, bd = Infinity;
  parts.forEach((p, j) => {
    const r = p.poly.outer;
    for (let e = 0; e < r.length; e++) {
      const a = r[e], b = r[(e + 1) % r.length];
      const d = segDist2(x, y, a[0], a[1], b[0], b[1]);
      if (d < bd) { bd = d; best = j; }
    }
  });
  return best;
}

/**
 * Reconstruct the target house from a DSM/DTM and OSM footprints (all in one planar metric frame, e.g. a local
 * BNG window). `ok = false` means the caller should fall back to priors (see `priorsFallback`).
 */
export function reconstruct(input: ReconstructInput): ReconstructOutput {
  const o = input.options ?? {};
  const erode = o.erode ?? DEFAULT_PIXELS.erode, erodeParty = o.erodeParty ?? DEFAULT_PIXELS.erodeParty;
  const maxParts = Math.max(1, Math.min(3, Math.round(o.maxParts ?? 3)));
  const settings: FitSettings = DEFAULT_FIT;
  const libOpts: LibraryOptions = { ...DEFAULT_LIBRARY, erode };
  const flags: string[] = [];
  const { dsm, dtm, dsmLast } = input;
  // 1. footprints (oriented, cleaned) and party edges of neighbours without kinds
  const tgt = normalizeFootprint(input.target.footprint, input.target.edgeKinds);
  const nbrs: { id: string; poly: PolygonM; kinds: EdgeKind[]; given: boolean }[] = [];
  for (const n of input.neighbours) {
    try { nbrs.push({ id: n.id, ...normalizeFootprint(n.footprint, n.edgeKinds), given: !!n.edgeKinds?.length }); } catch { flags.push('neighbour-footprint-invalid'); }
  }
  if (nbrs.some((n) => !n.given)) {
    const det = detectPartyEdges([tgt.poly, ...nbrs.map((n) => n.poly)]);
    nbrs.forEach((n, i) => { if (!n.given) n.kinds = det[i + 1].map((p) => (p ? 'party' : 'eave')); });
  }
  // 2. co-registration (one translation for the neighbourhood)
  const reg = coregister(dsm, dtm, [{ poly: tgt.poly, kinds: tgt.kinds, isTarget: true }, ...nbrs], { search: o.searchRadius ?? 6 });
  for (const f of reg.flags) flags.push(`registration-${f}`);
  const shift = reg.shift;
  const registration: ReconstructOutput['registration'] = {
    shift: [shift[0], shift[1]], sigmaMajor: reg.sigmaMajor, sigmaMinor: reg.sigmaMinor, method: reg.method,
    ...(reg.flags.length ? { flag: reg.flags[0] } : {}),
  };
  const T = translatePoly(tgt.poly, shift[0], shift[1]);
  const others = nbrs.map((n) => ({ ...n, poly: translatePoly(n.poly, shift[0], shift[1]) }));
  // 3. ground
  const gr = estimateGround(dtm, T, others.map((n) => n.poly));
  if (gr.mismatch) flags.push('ground-mismatch');
  const ground = gr.ground;
  // 4. local frame + pixels
  const origin = polyCentroid(T);
  const L = translatePoly(T, -origin[0], -origin[1]);
  // sub-samples every ~0.25 m (Q = 4 at 1 m, 2 at 0.5 m)
  const Q = Math.max(1, Math.min(4, Math.round(4 * dsm.res)));
  const pix = selectPixels(dsm, L, tgt.kinds, origin, { ...DEFAULT_PIXELS, erode, erodeParty, Q }, dsmLast);
  if (pix.nVegetation) flags.push('vegetation-masked');
  if (pix.nNodata) flags.push('dsm-nodata');
  let ps = pix.set;
  if (ps.n > MAX_FIT_PIXELS) {
    const n0 = ps.n;
    ps = subsetPixels(ps, Array.from({ length: MAX_FIT_PIXELS }, (_, k) => Math.floor((k * n0) / MAX_FIT_PIXELS)));
    flags.push('pixels-subsampled');
  }
  const nbh = Number.isFinite(ground) ? neighbourHeights(dsm, others, ground, dsmLast) : [];
  if (ps.n < 6 || !Number.isFinite(ground)) {
    return failedOutput(input, T, tgt.kinds, ground, gr.check, registration, nbh, flags, ps, origin, reg.failed);
  }
  // 5. hypotheses
  const main = makePartGeom(L, tgt.kinds.map((k) => ({ kind: k === 'party' ? 'party' : 'eave', cut: false })));
  const logPrior = makeLogPrior(input, L, tgt.kinds);
  const set = { n: ps.n, S2: ps.S2, sub: ps.sub, z: ps.z };
  const hyps: Hyp<PartGeom>[] = partLibrary(main, libOpts).map((m) => singleHyp(fitModel(m, set, settings.sigma0, settings.c), main, logPrior(m, true)));
  if (maxParts >= 2) {
    const popts = { ...DEFAULT_PARTITION, maxParts };
    const partitions: Partition[] = [...reflexPartitions(main, popts), ...stepCutPartitions(main, ps, settings, libOpts, popts)];
    for (const h of partitionHypotheses(partitions, ps, settings, libOpts, popts)) {
      const mainIdx = mainPartIndex(h.parts.map((p) => p.part));
      h.logPrior = h.parts.reduce((s, p, j) => s + logPrior(p.model, j === mainIdx), 0);
      hyps.push(h);
    }
  }
  // 6. selection; physically implausible configurations get zero prior: the first hypothesis (RBIC order, top 12)
  //    whose parts all pass the plausibility gate is reported, else the best one with ok = false
  const sel = selectHypotheses(hyps, ps.z, settings);
  const sigma = sel.sigma;
  const build = (h: Hyp<PartGeom>) => buildParts(h, ps, sigma, ground, origin);
  let chosen = sel.index, built = build(hyps[chosen]), issues = partsIssues(built.parts, dsm, ground);
  if (issues.length) {
    const ranked = hyps.map((_, i) => i).filter((i) => Number.isFinite(hyps[i].crit)).sort((a, b) => hyps[a].crit - hyps[b].crit || a - b);
    for (const i of ranked.slice(0, 12)) {
      if (i === sel.index) continue;
      const b = build(hyps[i]);
      if (partsIssues(b.parts, dsm, ground).length) continue;
      chosen = i; built = b; issues = [];
      flags.push('implausible-best-replaced');
      break;
    }
  }
  const best = hyps[chosen];
  const parts = built.parts;
  for (const nte of built.notes) if (!flags.includes(nte)) flags.push(nte);
  let nIn = 0, ss = 0;
  for (let k = 0; k < ps.n; k++) if (best.w[k] > 1e-6) { nIn++; ss += best.r[k] * best.r[k]; }
  const inlierFraction = nIn / ps.n;
  const rmse = nIn ? Math.sqrt(ss / nIn) : NaN;
  // sigma* comes from the stage-1 best hypothesis, which need not be the reported one (e.g. a better-fitting
  // compound partition that loses on the criterion): the reported fit's own robust scale must pass as well
  const sigmaReported = madScale(best.r);
  const unreliable = sigma > 0.5 || sigmaReported > 0.5 || inlierFraction < 0.7 || ps.n < 15;
  if (unreliable) flags.push('fit-unreliable');
  if (sigma > 0.5 || sigmaReported > 0.5 || issues.length) flags.push('outside-library');
  if (issues.length) flags.push('implausible-part', ...issues);
  if (ps.n < 15) flags.push('few-pixels');
  if (best.kind === 'partition') flags.push('partitioned');
  // 7. fitted surface, chimneys, samples
  const geoms = best.parts.map((p) => p.part);
  const surface = (x: number, y: number) => {
    const j = best.parts.length === 1 ? 0 : partIndexAt(geoms, x, y);
    const p = best.parts[j];
    const t = p.model.times(Float64Array.of(x, y), p.g)[0];
    return surfaceAt(p.model, p.g, p.beta, t);
  };
  // eave lines of the fitted roof along the target outline (multi-part: every free edge)
  const eaveMask = tgt.kinds.map((k, i) => k !== 'party' && (best.kind !== 'single' || best.parts[0].model.family === 'flat' || best.parts[0].model.kinds[i] === 'eave'));
  const chimneys: ChimneySpec[] = detectChimneys(dsm, L, tgt.kinds, eaveMask, origin, surface, ground, sigma, main.frame, dsmLast);
  const samples = Array.from({ length: ps.n }, (_, k) => ({ x: ps.cx[k] + origin[0], y: ps.cy[k] + origin[1], z: ps.z[k] - ground, residual: best.r[k] }));
  // 8. report (alternatives relative to the reported hypothesis; negative when a better one was implausible)
  const seen = new Set<string>([best.label]);
  const alternatives = hyps
    .map((h, i) => ({ h, i })).filter(({ h, i }) => i !== chosen && Number.isFinite(h.crit)).sort((p, q) => p.h.crit - q.h.crit)
    .filter(({ h }) => (seen.has(h.label) ? false : (seen.add(h.label), true))).slice(0, 5)
    .map(({ h }) => ({ label: h.label, deltaCriterion: h.crit - best.crit }));
  return {
    ok: !unreliable && !reg.failed && !issues.length, ground, groundCheck: gr.check, registration, parts, chimneys, neighbourHeights: nbh,
    report: { sigma, rmse, inlierFraction, nPixels: ps.n, pModel: sel.post[chosen], unreliable, selected: best.label, alternatives },
    samples, flags: [...new Set(flags)],
  };
}

/** Output parts of a hypothesis (main part first, then extensions by area) with SEs from sigma*^2 (X^T W X)^-1. */
function buildParts(best: Hyp<PartGeom>, ps: PixelSet, sigma: number, ground: number, origin: Vec2): { parts: ReconstructedPart[]; notes: string[] } {
  const active: number[] = [];
  const dropped = new Set<number>();
  best.parts.forEach((p, j) => {
    const [a] = best.slices[j];
    if (p.model.family !== 'flat' && p.beta[1] === 0 && !(p.model.family === 'gable' && p.model.allowNeg)) dropped.add(a + 1);
    if (p.model.twoPitch && p.beta[2] === 0) dropped.add(a + 2);
  });
  for (let c = 0; c < best.X.length; c++) if (!dropped.has(c)) active.push(c);
  const cov = covariance(best.X, best.w, sigma, active);
  const partCov = (j: number): number[][] | null => {
    if (!cov) return null;
    const [a, b] = best.slices[j];
    const cols = Array.from({ length: b - a }, (_, i) => active.indexOf(a + i));
    return cols.map((ci) => cols.map((cj) => (ci >= 0 && cj >= 0 ? cov[ci][cj] : NaN)));
  };
  const mainIdx = best.kind === 'single' ? 0 : mainPartIndex(best.parts.map((p) => p.part));
  const order = best.parts.map((_, j) => j).sort((a, b) => (a === mainIdx ? -1 : b === mainIdx ? 1 : best.parts[b].part.area - best.parts[a].part.area));
  const parts: ReconstructedPart[] = [], notes: string[] = [];
  order.forEach((j, rank) => {
    const p = best.parts[j];
    const [a, b] = best.slices[j];
    let fs = 0, ts = 0;
    for (let k = 0; k < ps.n; k++) { fs += best.X[a][k]; if (b - a > 1) ts += best.X[a + 1][k]; }
    const meanT = best.kind === 'single' ? ts / ps.n : fs > 0 ? ts / fs : 0;
    const sum = summarisePart(p.part, p.model, p.g, p.beta, partCov(j), ground, origin, rank === 0 ? 'main' : `ext-${rank}`, rank === 0 ? 'main' : 'extension', p.model.family === 'flat' ? 0 : meanT);
    notes.push(...sum.notes);
    parts.push(sum.part);
  });
  return { parts, notes };
}

/** Main part of a partition: largest plan area. */
function mainPartIndex(parts: PartGeom[]): number {
  let k = 0;
  parts.forEach((p, j) => { if (p.area > parts[k].area) k = j; });
  return k;
}

/** Output when no roof can be fitted: LoD1 flat prism at the median inside DSM height (if any), ok = false. */
function failedOutput(
  input: ReconstructInput, T: PolygonM, kinds: EdgeKind[], ground: number, check: number | null, registration: ReconstructOutput['registration'],
  nbh: ReconstructOutput['neighbourHeights'], flags: string[], ps: PixelSet, origin: Vec2, regFailed: boolean,
): ReconstructOutput {
  flags.push('fit-unreliable', ps.n === 0 ? 'no-pixels' : 'few-pixels');
  if (regFailed && !flags.some((f) => f.startsWith('registration-'))) flags.push('registration-failed');
  const vals: number[] = [];
  const dsm = input.dsm;
  const bb = T.outer.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const win = pixelWindow(dsm, bb[0], bb[1], bb[2], bb[3]);
  if (win) for (let r = win.r0; r <= win.r1; r++) for (let c = win.c0; c <= win.c1; c++) {
    const [x, y] = pixelCentre(dsm, c, r);
    const z = dsm.data[r * dsm.width + c];
    if (Number.isFinite(z) && pointInPoly(x, y, T)) vals.push(z);
  }
  const parts: ReconstructedPart[] = [];
  if (vals.length && Number.isFinite(ground)) {
    const h = median(vals) - ground;
    parts.push({ id: 'main', role: 'main', footprint: T, edgeKinds: kinds.map((k) => (k === 'party' ? 'party' : 'eave')), roof: { type: 'flat' }, eaveHeight: h, ridgeHeight: h, family: 'flat' });
    const issues = partsIssues(parts, dsm, ground);
    if (issues.length) flags.push('implausible-part', 'outside-library', ...issues);
  }
  return {
    ok: false, ground, groundCheck: check, registration, parts, chimneys: [], neighbourHeights: nbh,
    report: { sigma: 0, rmse: 0, inlierFraction: 0, nPixels: ps.n, pModel: 0, unreliable: true, selected: 'none', alternatives: [] },
    samples: Array.from({ length: ps.n }, (_, k) => ({ x: ps.cx[k] + origin[0], y: ps.cy[k] + origin[1], z: ps.z[k] - ground, residual: NaN })),
    flags,
  };
}
