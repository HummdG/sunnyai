// No reliable, plausible LoD2 fit (spec §5.5–5.6): "fall back to the best of {LoD1.3 prisms at robust heights per
// part, priors}". Both candidates are scored against the DSM over the registered target (robust scale of the
// height residuals about zero, so biased models lose) and the better one is used; near-ties prefer the measured
// LoD1.3 heights.
import type { EdgeKind, PolygonM, ReconstructedPart, Vec2 } from '@sunny/sunscan-core';
import { buildRoof, isSimple, pointInPolygon, polygonArea, type RoofModel } from '@sunny/sunscan-core/geometry';
import { DEFAULTS } from './constants.js';
import { bngToHeightGrid } from './frames.js';
import { mapPolygon, mapRoofComponents } from './geometry.js';
import type { LidarStage } from './lidar.js';
import { median, pixelsInPolygon } from './raster.js';

/** Why fitted parts are not a plausible house: eave < 2 m, ridge below the eave, parts < 4 m², non-finite values. */
export function plausibilityIssues(parts: ReconstructedPart[]): string[] {
  const issues: string[] = [];
  for (const p of parts) {
    const area = polygonArea(p.footprint);
    if (!Number.isFinite(p.eaveHeight) || !Number.isFinite(p.ridgeHeight)) issues.push(`${p.id}: non-finite heights`);
    else {
      if (p.eaveHeight < DEFAULTS.minPlausibleEave) issues.push(`${p.id}: eave ${p.eaveHeight.toFixed(2)} m < ${DEFAULTS.minPlausibleEave} m`);
      if (p.ridgeHeight < p.eaveHeight - 1e-6) issues.push(`${p.id}: ridge ${p.ridgeHeight.toFixed(2)} m below the eave`);
    }
    if (!(area >= DEFAULTS.minPartArea)) issues.push(`${p.id}: ${area.toFixed(1)} m² part`);
  }
  return issues;
}

/** Input of {@link chooseFallback}. */
export interface FallbackInput {
  lidar: LidarStage;
  /** Ground datum (m ODN), when the rasters gave one. */
  ground?: number;
  /** Registration shift applied to the OSM outline (local BNG). */
  shift: Vec2;
  /** Partition of the fit to reuse for LoD1.3 blocks (local BNG, registered), when it is trustworthy. */
  partition?: { id: string; role: ReconstructedPart['role']; footprint: PolygonM; edgeKinds: EdgeKind[] }[];
  /** Kinds of the target's edges (for a single-block fallback). */
  edgeKinds: EdgeKind[];
  bngToEnu?: (p: Vec2) => Vec2;
  /** The priors candidate (final ENU). */
  priors: ReconstructedPart[];
}

/** The chosen fallback, with parts in the final ENU frame. */
export interface FallbackChoice {
  kind: 'lod13' | 'priors';
  parts: ReconstructedPart[];
  notes: string[];
  flags: string[];
  sigma: { lod13?: number; priors?: number };
}

/** 1.4826 · median |r| (robust scale about zero). */
const scale0 = (r: number[]) => 1.4826 * median(r.map(Math.abs));

/** Pick LoD1.3 blocks or the priors model, whichever explains the LiDAR better. */
export function chooseFallback(inp: FallbackInput): FallbackChoice {
  const { lidar, ground, bngToEnu } = inp;
  const notes: string[] = [];
  const flags: string[] = [];
  const priorsOnly = (why?: string): FallbackChoice => {
    if (why) notes.push(why);
    return { kind: 'priors', parts: inp.priors, notes, flags, sigma: {} };
  };
  if (!lidar.rasters || !lidar.bng || !lidar.targetLocal || ground === undefined || !bngToEnu) return priorsOnly();
  const dsm = bngToHeightGrid(lidar.rasters.dsm, lidar.bng.e0, lidar.bng.n0);
  const target = mapPolygon(lidar.targetLocal, ([x, y]) => [x + inp.shift[0], y + inp.shift[1]]);
  const heights = (poly: PolygonM, erode: number) =>
    pixelsInPolygon(dsm, poly, [], erode)
      .map((p) => ({ x: p.x, y: p.y, z: dsm.data[p.idx] - ground }))
      .filter((p) => Number.isFinite(p.z));

  // LoD1.3 blocks: robust (median) height per part of the trusted partition, else one block for the whole outline
  const usable = inp.partition?.length && inp.partition.every((p) => polygonArea(p.footprint) >= DEFAULTS.minPartArea && isSimple(p.footprint));
  const polys = usable ? inp.partition! : [{ id: 'main', role: 'main' as const, footprint: target, edgeKinds: inp.edgeKinds }];
  const blocks: { poly: PolygonM; part: ReconstructedPart }[] = [];
  const dropped: string[] = [];
  for (const p of polys) {
    let vals = heights(p.footprint, 0.5);
    if (vals.length < 4) vals = heights(p.footprint, 0);
    const h = vals.length >= 4 ? median(vals.map((v) => v.z)) : NaN;
    if (!(h >= DEFAULTS.minPlausibleEave)) {
      dropped.push(`${p.id}${Number.isFinite(h) ? ` (${h.toFixed(1)} m)` : ' (no data)'}`);
      continue;
    }
    const part: ReconstructedPart = {
      id: p.id,
      role: p.role,
      footprint: p.footprint,
      edgeKinds: p.edgeKinds.map((k) => (k === 'party' ? 'party' : 'eave')),
      roof: { type: 'flat' },
      eaveHeight: h,
      ridgeHeight: h,
      family: 'lod1.3-block',
    };
    blocks.push({ poly: p.footprint, part });
  }
  if (!blocks.length) {
    flags.push('building-missing-in-lidar');
    return priorsOnly('The LiDAR shows no building of house height inside the outline (built after the survey, or a wrong outline).');
  }
  if (dropped.length) {
    flags.push('part-not-in-lidar');
    notes.push(`Left out part(s) with no house height in the LiDAR: ${dropped.join(', ')}.`);
  }

  // score both candidates on the target's pixels (model height 0 where a candidate has no building)
  let px = heights(target, 0.5);
  if (px.length < 15) px = heights(target, 0);
  const roofs: RoofModel[] = [];
  for (const p of inp.priors) {
    try {
      roofs.push(buildRoof(p.footprint, p.edgeKinds, { ...p.roof, eaveHeight: p.eaveHeight }));
    } catch {
      /* unbuildable prior part: scores as ground */
    }
  }
  const rBlocks: number[] = [];
  const rPriors: number[] = [];
  for (const p of px) {
    const q: Vec2 = [p.x, p.y];
    const b = blocks.find((x) => pointInPolygon(q, x.poly));
    rBlocks.push(p.z - (b ? b.part.eaveHeight : 0));
    const e = bngToEnu(q);
    let s = 0;
    for (const m of roofs) {
      const h = m.heightAt(e);
      if (h !== null) s = Math.max(s, h);
    }
    rPriors.push(p.z - s);
  }
  const sigma = { lod13: scale0(rBlocks), priors: scale0(rPriors) };
  const fmt = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)} m` : 'n/a');
  if (!(sigma.priors < sigma.lod13 - 0.05)) {
    notes.push(`No reliable roof shape: LoD1.3 blocks at robust LiDAR heights (residual scale ${fmt(sigma.lod13)}; priors model ${fmt(sigma.priors)}).`);
    return { kind: 'lod13', parts: blocks.map((b) => ({ ...b.part, footprint: mapPolygon(b.part.footprint, bngToEnu), roof: mapRoofComponents(b.part.roof, bngToEnu) })), notes, flags, sigma };
  }
  notes.push(`No reliable roof shape: UK priors scaled to the LiDAR (residual scale ${fmt(sigma.priors)}; LoD1.3 blocks ${fmt(sigma.lod13)}).`);
  return { kind: 'priors', parts: inp.priors, notes, flags, sigma };
}
