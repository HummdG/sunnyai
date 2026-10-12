// buildModel: point (+ confirmed building or drawn outline) -> HouseModelSpec (spec §5 pipeline).
//   buildings -> target -> local ENU frame -> party walls + built form -> regularisation + front edge -> nation ->
//   OSTN15 + elevation window -> reconstruct (local BNG) -> {fit | close approximation | priors} -> back to
//   WGS84/ENU about the registered target centroid -> assembly (terrain, roads, facade, quality, provenance, evidence).
import type { ChimneySpec, EdgeKind, Nation, PolygonM, PriorContext, ReconstructedPart, Vec2 } from '@sunny/sunscan-core';
import type { LonLat, Providers } from '../contracts.js';
import { eraFromTags, modalEra, numericTag } from './archetype.js';
import { assembleSpec, type ResolvedOptions } from './assemble.js';
import { DEFAULTS, UK_BOUNDS } from './constants.js';
import { lod1Fallback, normalisePriors, resolveAnalyse, resolveFrontEdge, resolvePriors, resolveReconstruct, resolveRegularize } from './core-adapters.js';
import { isReplayMiss, PipelineError, toProviderError } from './errors.js';
import { chooseFallback, plausibilityIssues } from './fallback.js';
import { bngAngleToEnu, bngToHeightGrid, isFinitePair } from './frames.js';
import { mapPolygon, mapRoofComponents, orientWithKinds, polygonDistance, roundTo } from './geometry.js';
import { imageryAvailable, imageryRef, ORTHO_MAX_HALF, ORTHO_MIN_HALF } from '../imagery/ortho.js';
import { lidarContextHeights, lidarTopHeight, runLidarStage, type LidarStage } from './lidar.js';
import { median, pixelsInPolygon } from './raster.js';
import { frameAtCentroid, osmRefOf, selectTarget, toLL, toLocal, type SceneBuilding } from './scene.js';
import type { BuildDiagnostics, BuildModelDeps, BuildModelRequest, BuildModelResult, PipelineLog } from './types.js';

const since = (t: number) => Math.round((performance.now() - t) * 10) / 10;

/** Reject requests outside the UK or with malformed numbers (400 / 422). */
export function validateRequest(req: BuildModelRequest): void {
  if (!Number.isFinite(req.lat) || !Number.isFinite(req.lon)) throw new PipelineError(400, 'bad-request', 'lat and lon must be finite numbers');
  if (req.lat < UK_BOUNDS.minLat || req.lat > UK_BOUNDS.maxLat || req.lon < UK_BOUNDS.minLon || req.lon > UK_BOUNDS.maxLon) {
    throw new PipelineError(422, 'outside-uk', `point ${req.lat}, ${req.lon} is outside the United Kingdom`);
  }
  if (req.footprint && req.footprint.some((p) => !Array.isArray(p) || !isFinitePair(p))) {
    throw new PipelineError(400, 'bad-request', 'footprint must be an array of [lon, lat] pairs');
  }
}

/** Resolve request options against the defaults. */
export function resolveOptions(o: BuildModelRequest['options'] = {}): ResolvedOptions {
  return {
    radius: o.radius ?? DEFAULTS.radius,
    neighbourRadius: o.neighbourRadius ?? DEFAULTS.neighbourRadius,
    lidarMargin: o.lidarMargin ?? DEFAULTS.lidarMargin,
    terrain: o.terrain ?? DEFAULTS.terrain,
    terrainHalfSize: o.terrainHalfSize ?? DEFAULTS.terrainHalfSize,
    evidence: o.evidence ?? DEFAULTS.evidence,
    maxEvidence: o.maxEvidence ?? DEFAULTS.maxEvidence,
    imagery: o.imagery ?? DEFAULTS.imagery,
    imageryHalfSize: Math.min(ORTHO_MAX_HALF, Math.max(ORTHO_MIN_HALF, o.imageryHalfSize ?? DEFAULTS.imageryHalfSize)),
  };
}

/** Default pipeline logger (console). */
export const consoleLog: PipelineLog = (level, message, err) => {
  const detail = err === undefined ? '' : ` — ${err instanceof Error ? err.message : String(err)}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(`[sunscan pipeline] ${message}${detail}`);
};

/** Nation: geocoder's postcode nation, else providers.nationAt, else the postcode-area hint. */
async function resolveNation(req: BuildModelRequest, providers: Providers, warnings: string[], log: PipelineLog): Promise<Nation | undefined> {
  const pc = req.geocode?.postcode?.nation;
  if (pc) return pc;
  try {
    const n = await providers.nationAt(req.lat, req.lon);
    if (n) return n;
  } catch (e) {
    if (isReplayMiss(e)) throw e;
    warnings.push(`nation lookup failed (${(e as Error).message})`);
    log('warn', 'nation lookup failed', e);
  }
  return req.geocode?.parsed?.nationHint;
}

/** The priors candidate (final ENU): injected / core priors, else an LoD1 block model; failures are logged. */
async function priorsCandidate(
  deps: BuildModelDeps,
  ctx: PriorContext,
  footprint: PolygonM,
  edgeKinds: EdgeKind[],
  warnings: string[],
  log: PipelineLog,
): Promise<{ parts: ReconstructedPart[]; notes: string[]; storeys?: number }> {
  const pri = resolvePriors(deps);
  let norm: ReturnType<typeof normalisePriors>;
  try {
    norm = normalisePriors(await pri.fn(ctx, footprint, edgeKinds));
    if (!norm) {
      warnings.push(`priors fallback (${pri.label}) returned no usable parts — using a block model`);
      log('warn', `priors fallback (${pri.label}) returned no usable parts`);
    }
  } catch (e) {
    warnings.push(`priors fallback (${pri.label}) failed (${(e as Error).message}) — using a block model`);
    log('error', `priors fallback (${pri.label}) failed`, e);
  }
  return norm ?? { parts: [lod1Fallback(footprint, edgeKinds, ctx.heightHint)], notes: ['Block model (no usable roof estimate).'] };
}

/** Ground datum in m ODN: the fitter's ground, else the DTM median under the target, else undefined. */
function groundDatum(lidar: LidarStage): number | undefined {
  const g = lidar.output?.ground;
  if (g !== undefined && Number.isFinite(g)) return g;
  if (!lidar.rasters || !lidar.bng || !lidar.targetLocal) return undefined;
  const dtm = bngToHeightGrid(lidar.rasters.dtm, lidar.bng.e0, lidar.bng.n0);
  const m = median(pixelsInPolygon(dtm, lidar.targetLocal).map((p) => dtm.data[p.idx]));
  return Number.isFinite(m) ? m : undefined;
}

/** Build a HouseModelSpec for the house at (lat, lon). See {@link BuildModelRequest} and spec §5. */
export async function buildModel(req: BuildModelRequest, deps: BuildModelDeps): Promise<BuildModelResult> {
  const t0 = performance.now();
  const now = (deps.now ?? (() => new Date()))();
  const opts = resolveOptions(req.options);
  validateRequest(req);
  const timings: Record<string, number> = {};
  const warnings: string[] = [];
  const extraNotes: string[] = [];
  const log = deps.log ?? consoleLog;

  // 1. buildings around the point (forcing the confirmed / geocoded OSM object into the result)
  let t = performance.now();
  let buildings = req.buildings;
  if (!buildings) {
    const osmRef = osmRefOf(req.buildingRef) ?? (req.footprint?.length ? undefined : req.geocode?.best?.osmRef);
    try {
      buildings = await deps.providers.fetchBuildings({
        lat: req.lat,
        lon: req.lon,
        radius: opts.radius,
        ...(osmRef ? { osmRef } : {}),
        ...(req.geocode?.parsed ? { parsed: req.geocode.parsed } : {}),
      });
    } catch (e) {
      if (!req.footprint?.length || isReplayMiss(e)) throw toProviderError(e, 'building lookup');
      warnings.push(`building lookup failed (${(e as Error).message}) — modelling the drawn outline without neighbours`);
      log('warn', 'building lookup failed; drawn outline modelled without neighbours', e);
    }
  }
  timings.buildings = since(t);
  if (buildings) warnings.push(...buildings.warnings);

  // 2. target, 3. party walls + built form on the cleaned outline (provisional ENU frame at the target centroid)
  t = performance.now();
  const sel = selectTarget(req, buildings);
  warnings.push(...sel.warnings);
  let target: SceneBuilding = sel.target;
  const frame0 = frameAtCentroid(target.outer, target.holes);
  // optional live ground texture: probe the imagery tile under the house while the other stages run
  const imageryProbe = opts.imagery ? imageryAvailable(deps.providers, frame0.lat0, frame0.lon0) : Promise.resolve(false);
  const poly0 = toLocal(frame0, target);
  const others = sel.others.map((b) => {
    const poly = toLocal(frame0, b);
    return { b, poly, d: polygonDistance(poly0, poly, DEFAULTS.fitNeighbourRadius) };
  });
  const analysis = resolveAnalyse(deps)({
    target: { id: target.id, footprint: poly0, tags: target.tags, isPart: false, source: target.source },
    others: others.filter((o) => o.d <= 60).map((o) => ({ id: o.b.id, footprint: o.poly, tags: o.b.tags, isPart: o.b.isPart, source: o.b.source })),
    addressNodes: (buildings?.addressNodes ?? []).map((n) => ({ xy: frame0.toLocal([n.lon, n.lat]) as Vec2, tags: n.tags })),
  });
  const nEdges = (p: PolygonM) => p.outer.length + (p.holes ?? []).reduce((s, h) => s + h.length, 0);
  let edgeKinds: EdgeKind[] = analysis.edgeKinds;
  if (edgeKinds.length !== nEdges(poly0)) {
    warnings.push(`footprint analysis returned ${edgeKinds.length} edge kinds for ${nEdges(poly0)} edges — party walls ignored`);
    edgeKinds = Array.from({ length: nEdges(poly0) }, () => 'eave' as const);
  }
  // regularise (orthogonalise near-right angles) carrying the edge kinds over; keep the outline as lon/lat
  let polyR = poly0;
  try {
    const r = resolveRegularize(deps)(poly0, edgeKinds);
    const o = orientWithKinds(r.footprint, r.edgeKinds);
    if (o.poly.outer.length >= 3 && o.kinds && o.kinds.length === nEdges(o.poly)) {
      polyR = o.poly;
      edgeKinds = o.kinds;
      target = { ...target, ...toLL(frame0, polyR) };
    }
  } catch (e) {
    warnings.push(`footprint regularisation failed (${(e as Error).message}) — using the outline as mapped`);
  }
  const street = target.tags['addr:street'] ?? req.geocode?.parsed?.street;
  const front = resolveFrontEdge(deps)({
    footprint: polyR,
    edgeKinds,
    roads: (buildings?.roads ?? []).map((r) => ({ ...(r.name ? { name: r.name } : {}), kind: r.kind, line: r.coords.map((c) => frame0.toLocal(c) as Vec2) })),
    entrances: (buildings?.entrances ?? []).map((e) => ({ xy: frame0.toLocal([e.lon, e.lat]) as Vec2, tags: e.tags })),
    ...(street ? { street } : {}),
  });
  timings.footprint = since(t);

  // 4. nation, era, priors context
  t = performance.now();
  const nation = await resolveNation(req, deps.providers, warnings, log);
  timings.nation = since(t);
  const taggedEra = eraFromTags(target.tags);
  const era = taggedEra ?? modalEra(analysis.builtForm, target.tags.building);
  const levels = numericTag(target.tags['building:levels'] ?? target.tags.num_floors);
  const osmHeight = numericTag(target.tags.height);
  const roofShape = target.tags['roof:shape'] ?? target.tags.roof_shape;
  const priorCtx: PriorContext = {
    builtForm: analysis.builtForm,
    ...(taggedEra ? { era: taggedEra } : {}),
    ...(levels !== undefined ? { storeysHint: levels } : {}),
    ...(osmHeight !== undefined ? { heightHint: osmHeight, heightHintSource: 'osm' as const } : {}),
    ...(roofShape ? { roofShapeHint: roofShape } : {}),
    ...(target.tags.building ? { buildingTag: target.tags.building } : {}),
  };

  // 5. LiDAR: OSTN15 -> window -> rasters -> reconstruct in a local BNG frame. Only surveyed (OSM) outlines take part
  //    in the joint co-registration: Overture's ML-traced outlines carry their own offsets and bias the shared shift
  //    (20 Forthlin Road: σ* 0.64 m with them, 0.28 m without); they stay context (party walls, heights below).
  const recon = resolveReconstruct(deps);
  const lidar = await runLidarStage({
    providers: deps.providers,
    ...(nation ? { nation } : {}),
    target: { id: target.id, outer: target.outer, holes: target.holes, edgeKinds },
    neighbours: others
      .filter((o) => !o.b.isPart && o.b.source !== 'overture' && o.d <= DEFAULTS.fitNeighbourRadius)
      .map((o) => ({ id: o.b.id, outer: o.b.outer, holes: o.b.holes })),
    priors: priorCtx,
    margin: opts.lidarMargin,
    reconstruct: recon.fn,
    log,
  });
  Object.assign(timings, lidar.timings);
  warnings.push(...lidar.warnings);
  const out = lidar.output;
  const bng = lidar.bng;
  const reg = out?.registration;
  const regTrusted =
    !!reg && reg.method !== 'none' && reg.flag !== 'on-boundary' && reg.flag !== 'weak-peak' &&
    !(out?.flags ?? []).some((f) => /^registration-(on-boundary|weak-peak|failed)/.test(f));
  // a usable LoD2 fit must be reliable AND plausible as a house (spec §5.5); otherwise it is rejected
  const issues = out ? plausibilityIssues(out.parts) : [];
  const fitOk = !!out && !!bng && out.ok && out.parts.length > 0 && issues.length === 0 && Number.isFinite(out.ground);
  const fitRejected = !!out && out.ok && !fitOk;
  const extraFlags: string[] = [];
  if (out && !fitOk && issues.length) {
    extraNotes.push(`Fitted roof rejected as implausible: ${issues.join('; ')}.`);
    log('warn', `fit for ${target.id} rejected as implausible: ${issues.join('; ')}`);
  }
  // the shift the fitter applied to its parts (always with fitted parts; otherwise only when trustworthy)
  const shift: Vec2 = reg && (fitOk || regTrusted) && isFinitePair(reg.shift) ? [reg.shift[0], reg.shift[1]] : [0, 0];
  const registerLL = (ll: LonLat): LonLat => {
    if (!bng || (!shift[0] && !shift[1])) return ll;
    try {
      const p = bng.fromLL(ll);
      return bng.toLL([p[0] + shift[0], p[1] + shift[1]]);
    } catch {
      return ll;
    }
  };

  // 6. final ENU frame about the registered target centroid
  const regTarget = { outer: target.outer.map(registerLL), holes: target.holes.map((h) => h.map(registerLL)) };
  const frame = frameAtCentroid(regTarget.outer, regTarget.holes);
  const bngToEnu = bng ? (p: Vec2): Vec2 => frame.toLocal(bng.toLL(p)) as Vec2 : undefined;
  const ground = groundDatum(lidar);

  // 7. parts: the LoD2 fit, else the best of {LoD1.3 blocks at robust LiDAR heights, priors} (spec §5.5–5.6)
  let parts: ReconstructedPart[];
  let chimneys: ChimneySpec[] = [];
  let fallback: 'lod13' | 'priors' | undefined;
  let priorHint: 'lidar' | 'osm-tags' | undefined;
  let mainStoreys: number | undefined;
  if (fitOk && out && bngToEnu) {
    parts = out.parts.map((p) => ({ ...p, footprint: mapPolygon(p.footprint, bngToEnu), roof: mapRoofComponents(p.roof, bngToEnu) }));
    chimneys = out.chimneys.map((c) => ({ ...c, center: bngToEnu(c.center), angleDeg: bngAngleToEnu(bngToEnu, c.center, c.angleDeg) }));
  } else {
    t = performance.now();
    if (out && !out.ok) log('warn', `no reliable roof fit for ${target.id} (σ* ${Number.isFinite(out.report.sigma) ? out.report.sigma.toFixed(3) : 'n/a'} m, flags ${out.flags.join(',') || 'none'}) — falling back`);
    const top = lidar.targetLocal ? lidarTopHeight(lidar, mapPolygon(lidar.targetLocal, ([x, y]) => [x + shift[0], y + shift[1]]), ground) : undefined;
    priorHint = top !== undefined ? 'lidar' : osmHeight !== undefined ? 'osm-tags' : undefined;
    const ctx: PriorContext = top !== undefined ? { ...priorCtx, heightHint: top, heightHintSource: 'lidar' } : priorCtx;
    const pri = await priorsCandidate(deps, ctx, toLocal(frame, regTarget), edgeKinds, warnings, log);
    const usePartition = !!out && regTrusted && out.parts.length > 0 && issues.length === 0;
    const choice = chooseFallback({
      lidar,
      ...(ground !== undefined ? { ground } : {}),
      shift,
      ...(usePartition ? { partition: out!.parts } : {}),
      edgeKinds,
      ...(bngToEnu ? { bngToEnu } : {}),
      priors: pri.parts,
    });
    fallback = choice.kind;
    parts = choice.parts;
    extraFlags.push(...choice.flags);
    extraNotes.push(...choice.notes);
    if (choice.kind === 'priors') {
      mainStoreys = pri.storeys;
      // the priors word their height note by ctx.heightHintSource ('lidar' | 'osm'); with LiDAR rasters present, their
      // generic 'no elevation data' label does not apply (TODO core/fit: derive that label from heightHintSource too)
      extraNotes.push(...(lidar.rasters ? pri.notes.filter((n) => !/no elevation data/i.test(n)) : pri.notes));
    }
    timings.fallback = since(t);
  }

  // context heights of the outlines kept out of the fit (Overture), measured the same way (p90 above the ground)
  const contextHeights =
    ground !== undefined
      ? lidarContextHeights(lidar, others.filter((o) => !o.b.isPart && o.b.source === 'overture' && o.d <= opts.neighbourRadius).map((o) => o.b), shift, ground)
      : [];

  // 8. assemble (the imagery reference is centred on the final ENU origin, rounded like spec.origin)
  t = performance.now();
  const imagery = (await imageryProbe) ? imageryRef(roundTo(frame.lat0, 8), roundTo(frame.lon0, 8), opts.imageryHalfSize) : undefined;
  const spec = assembleSpec({
    req, now, opts,
    ...(buildings ? { buildings } : {}),
    target, how: sel.how,
    others: others.map((o) => ({ b: o.b, d: o.d })),
    builtForm: analysis.builtForm, attached: analysis.attached, terraceBlock: analysis.terraceBlock, edgeKinds,
    ...(front ? { front } : {}), frontFrame: frame0,
    ...(street ? { street } : {}),
    ...(nation ? { nation } : {}),
    ...(taggedEra ? { taggedEra } : {}), era,
    ...(roofShape ? { roofShape } : {}),
    lidar, fitLabel: recon.label, fitUsed: fitOk, fitRejected, shift, frame, registerLL,
    ...(bngToEnu ? { bngToEnu } : {}),
    ...(ground !== undefined ? { ground } : {}),
    parts, chimneys,
    ...(fallback ? { fallback } : {}),
    ...(priorHint && fallback === 'priors' ? { priorHint } : {}),
    ...(mainStoreys !== undefined ? { mainStoreys } : {}),
    extraFlags,
    extraNotes,
    contextHeights,
    ...(imagery ? { imagery } : {}),
  });
  timings.assemble = since(t);
  timings.total = since(t0);
  const diagnostics: BuildDiagnostics = {
    ...(front ? { front: { method: front.method, reasons: front.reasons, ...(front.streetName ? { streetName: front.streetName } : {}) } } : {}),
    footprint: { builtForm: analysis.builtForm, terraceBlock: analysis.terraceBlock, reasons: analysis.reasons },
    parts: fallback ?? 'fit',
  };
  return { spec, timings, warnings: [...new Set(warnings)], diagnostics };
}
