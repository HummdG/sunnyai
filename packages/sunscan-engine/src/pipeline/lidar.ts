// LiDAR stage: OSTN15 transform of the target + neighbours to BNG, elevation window (bbox + margin), surface rasters,
// reconstruct in a local BNG frame (origin = rounded target centroid), plus a robust LiDAR top height for priors.
import type { EdgeKind, Nation, PolygonM, PriorContext, ReconstructInput, ReconstructOutput, Vec2 } from '@sunny/sunscan-core';
import { neighbourHeights } from '@sunny/sunscan-core/fit';
import type { Bbox27700, LonLat, NoCoverage, Ostn15, Providers, SurfaceRasters } from '../contracts.js';
import { bngGridBounds, bngToHeightGrid, makeBngLocalFrame, type BngLocalFrame } from './frames.js';
import { isReplayMiss } from './errors.js';
import { bboxOf, centroidOf } from './geometry.js';
import { median, pixelsInPolygon, quantile } from './raster.js';
import type { PipelineLog, ReconstructFn } from './types.js';

/** Outcome of the LiDAR stage. */
export interface LidarStage {
  status: 'fitted' | 'no-coverage' | 'unavailable' | 'fit-error';
  /** NoCoverage reason or error text when status != 'fitted'. */
  reason?: string;
  ostn?: Ostn15;
  bng?: BngLocalFrame;
  rasters?: SurfaceRasters;
  output?: ReconstructOutput;
  /** The requested window (absolute BNG). */
  bbox?: Bbox27700;
  /** Target polygon in the local BNG frame (before registration). */
  targetLocal?: PolygonM;
  timings: Record<string, number>;
  warnings: string[];
}

/** Input of {@link runLidarStage}. */
export interface LidarStageInput {
  providers: Providers;
  nation?: Nation;
  target: { id: string; outer: LonLat[]; holes: LonLat[][]; edgeKinds: EdgeKind[] };
  neighbours: { id: string; outer: LonLat[]; holes: LonLat[][] }[];
  priors: PriorContext;
  margin: number;
  reconstruct: ReconstructFn;
  /** Degradations are logged here (and returned as warnings). */
  log?: PipelineLog;
}

const isNoCoverage = (r: SurfaceRasters | NoCoverage): r is NoCoverage => 'reason' in r && r.coverage === 0;

const since = (t: number) => Math.round((performance.now() - t) * 10) / 10;

/** Run OSTN15 -> window -> rasters -> reconstruct. Never throws for provider failures (they degrade to priors). */
export async function runLidarStage(inp: LidarStageInput): Promise<LidarStage> {
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const log: PipelineLog = inp.log ?? (() => undefined);
  if (inp.nation === 'Northern Ireland') {
    return { status: 'no-coverage', reason: 'no-open-lidar', timings, warnings };
  }
  let t = performance.now();
  let ostn: Ostn15;
  try {
    ostn = await inp.providers.getOstn15();
  } catch (e) {
    if (isReplayMiss(e)) throw e;
    warnings.push(`OSTN15 grid unavailable (${(e as Error).message}) — elevation skipped`);
    log('error', 'OSTN15 grid unavailable: LiDAR skipped, falling back to estimates', e);
    return { status: 'unavailable', reason: 'source-error', timings, warnings };
  } finally {
    timings.ostn15 = since(t);
  }
  // absolute BNG of the target -> window
  let absTarget: Vec2[];
  try {
    absTarget = inp.target.outer.map(([lon, lat]) => {
      const p = ostn.toBng(lon, lat);
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error('outside OSTN15');
      return [p[0], p[1]] as Vec2;
    });
  } catch {
    return { status: 'no-coverage', reason: 'outside-coverage', ostn, timings, warnings };
  }
  const bb = bboxOf([absTarget]);
  const bbox: Bbox27700 = {
    minE: Math.floor(bb.minX - inp.margin),
    minN: Math.floor(bb.minY - inp.margin),
    maxE: Math.ceil(bb.maxX + inp.margin),
    maxN: Math.ceil(bb.maxY + inp.margin),
  };
  t = performance.now();
  let rasters: SurfaceRasters | NoCoverage;
  try {
    rasters = await inp.providers.getSurfaceRasters({ bbox, nation: inp.nation });
  } catch (e) {
    if (isReplayMiss(e)) throw e;
    warnings.push(`elevation service unavailable (${(e as Error).message}) — using estimates`);
    log('error', `elevation provider failed for bbox ${JSON.stringify(bbox)} (nation ${inp.nation ?? '?'}): falling back to estimates`, e);
    return { status: 'unavailable', reason: 'source-error', ostn, bbox, timings, warnings };
  } finally {
    timings.elevation = since(t);
  }
  if (isNoCoverage(rasters)) {
    log(rasters.reason === 'source-error' ? 'warn' : 'info', `no LiDAR for bbox ${JSON.stringify(bbox)}: ${rasters.reason}${rasters.detail ? ` (${rasters.detail})` : ''}`);
    if (rasters.reason === 'source-error') warnings.push(`elevation source error${rasters.detail ? `: ${rasters.detail}` : ''} — using estimates`);
    return { status: 'no-coverage', reason: rasters.reason, ostn, bbox, timings, warnings };
  }
  if (rasters.coverage < 0.95) warnings.push(`LiDAR covers ${Math.round(rasters.coverage * 100)} % of the window`);

  // local BNG frame at the rounded target centroid
  const cAbs = centroidOf({ outer: absTarget });
  const bng = makeBngLocalFrame(ostn, Math.round(cAbs[0]), Math.round(cAbs[1]));
  const local = (ring: LonLat[]) => ring.map((p) => bng.fromLL(p));
  const targetLocal: PolygonM = { outer: local(inp.target.outer), holes: inp.target.holes.map(local) };
  const gb = bngGridBounds(rasters.dsm);
  const inWindow = (poly: PolygonM) => {
    const b = bboxOf([poly.outer]);
    return b.maxX + bng.e0 >= gb.minE - 2 && b.minX + bng.e0 <= gb.maxE + 2 && b.maxY + bng.n0 >= gb.minN - 2 && b.minY + bng.n0 <= gb.maxN + 2;
  };
  const neighbours: ReconstructInput['neighbours'] = [];
  for (const n of inp.neighbours) {
    try {
      const fp: PolygonM = { outer: local(n.outer), holes: n.holes.map(local) };
      if (inWindow(fp)) neighbours.push({ id: n.id, footprint: fp });
    } catch {
      /* neighbour outside OSTN15: ignore */
    }
  }
  const input: ReconstructInput = {
    dsm: bngToHeightGrid(rasters.dsm, bng.e0, bng.n0),
    dtm: bngToHeightGrid(rasters.dtm, bng.e0, bng.n0),
    ...(rasters.dsmLast ? { dsmLast: bngToHeightGrid(rasters.dsmLast, bng.e0, bng.n0) } : {}),
    target: { id: inp.target.id, footprint: targetLocal, edgeKinds: inp.target.edgeKinds },
    neighbours,
    priors: inp.priors,
  };
  t = performance.now();
  try {
    const output = await inp.reconstruct(input);
    timings.reconstruct = since(t);
    return { status: 'fitted', ostn, bng, rasters, output, bbox, targetLocal, timings, warnings };
  } catch (e) {
    timings.reconstruct = since(t);
    warnings.push(`roof fit failed (${(e as Error).message}) — using estimates`);
    log('error', 'reconstruct threw: falling back to estimates', e);
    return { status: 'fit-error', reason: (e as Error).message, ostn, bng, rasters, bbox, targetLocal, timings, warnings };
  }
}

/**
 * Robust LiDAR top height (≈ ridge) of a footprint for the priors fallback: p95 of (DSM − ground) over pixels whose
 * centres lie inside the (registered) footprint; undefined with fewer than 10 valid pixels or outside 2–60 m.
 */
export function lidarTopHeight(stage: LidarStage, footprintLocal: PolygonM, ground: number | undefined): number | undefined {
  if (!stage.rasters || !stage.bng) return undefined;
  const dsm = bngToHeightGrid(stage.rasters.dsm, stage.bng.e0, stage.bng.n0);
  const dtm = bngToHeightGrid(stage.rasters.dtm, stage.bng.e0, stage.bng.n0);
  const g = ground !== undefined && Number.isFinite(ground) ? ground : median(pixelsInPolygon(dtm, footprintLocal).map((p) => dtm.data[p.idx]));
  if (!Number.isFinite(g)) return undefined;
  const vals = pixelsInPolygon(dsm, footprintLocal)
    .map((p) => dsm.data[p.idx] - g)
    .filter(Number.isFinite);
  if (vals.length < 10) return undefined;
  const h = quantile(vals, 0.95);
  return h >= 2 && h <= 60 ? h : undefined;
}

/**
 * LiDAR heights (p90 above `ground`, eave ≈ p10) of context buildings that were not handed to the fitter (Overture
 * outlines), registered with the fitter's shift — the same measure core/fit reports for its neighbours.
 */
export function lidarContextHeights(
  stage: LidarStage, buildings: { id: string; outer: LonLat[]; holes: LonLat[][] }[], shift: Vec2, ground: number,
): ReconstructOutput['neighbourHeights'] {
  if (!stage.rasters || !stage.bng || !buildings.length || !Number.isFinite(ground)) return [];
  const bng = stage.bng;
  const dsm = bngToHeightGrid(stage.rasters.dsm, bng.e0, bng.n0);
  const dsmLast = stage.rasters.dsmLast ? bngToHeightGrid(stage.rasters.dsmLast, bng.e0, bng.n0) : undefined;
  const polys: { id: string; poly: PolygonM; kinds: EdgeKind[] }[] = [];
  for (const b of buildings) {
    try {
      const local = (ring: LonLat[]) => ring.map((p) => { const q = bng.fromLL(p); return [q[0] + shift[0], q[1] + shift[1]] as Vec2; });
      const poly: PolygonM = { outer: local(b.outer), holes: b.holes.map(local) };
      polys.push({ id: b.id, poly, kinds: [...poly.outer, ...(poly.holes ?? []).flat()].map(() => 'eave' as const) });
    } catch {
      /* outside OSTN15: no height */
    }
  }
  return neighbourHeights(dsm, polys, ground, dsmLast).filter((h) => Number.isFinite(h.height) && h.height > 1 && h.height < 120);
}
