// Spec assembly (spec §5.7): parts, fit report, evidence, neighbours, roads, terrain, facade, quality, provenance.
// Everything arrives already registered and in the final ENU frame (origin = registered target centroid).
import type {
  BuiltForm,
  ChimneySpec,
  EdgeKind,
  Era,
  FitReport,
  HouseModelSpec,
  ImageryRef,
  Nation,
  ReconstructedPart,
  ReconstructOutput,
  Vec2,
} from '@sunny/sunscan-core';
import type { LocalFrame } from '@sunny/sunscan-core/geo';
import type { BuildingsResult, LonLat } from '../contracts.js';
import { DEFAULTS, GENERATOR, SPEC_SCHEMA } from './constants.js';
import { evidenceFrom, neighbourSpecs, roadSpecs, terrainGrid, type ContextBuilding } from './context.js';
import { facadeHints, matchPartEdge } from './facade.js';
import { bboxOf, centroidOf, roundTo, roundVec } from './geometry.js';
import type { LidarStage } from './lidar.js';
import { fitPartReports, partSpecs } from './parts.js';
import { buildProvenance, buildQuality, isHeritage, surveyAgeYears } from './quality.js';
import { osmRefOf, toLocal, type SceneBuilding, type TargetChoice } from './scene.js';
import type { BuildModelRequest, FrontEdgeResult } from './types.js';

/** Resolved BuildModelOptions. */
export interface ResolvedOptions {
  radius: number;
  neighbourRadius: number;
  lidarMargin: number;
  terrain: boolean;
  terrainHalfSize: number;
  evidence: boolean;
  maxEvidence: number;
  imagery: boolean;
  imageryHalfSize: number;
}

/** Everything the assembly step needs. */
export interface AssembleInput {
  req: BuildModelRequest;
  now: Date;
  opts: ResolvedOptions;
  buildings?: BuildingsResult;
  target: SceneBuilding;
  how: TargetChoice;
  /** Context candidates with their distance (m) to the target. */
  others: { b: SceneBuilding; d: number }[];
  builtForm: BuiltForm;
  attached: string[];
  terraceBlock: boolean;
  edgeKinds: EdgeKind[];
  front?: FrontEdgeResult;
  frontFrame: LocalFrame;
  street?: string;
  nation?: Nation;
  taggedEra?: Era;
  era: Era;
  roofShape?: string;
  lidar: LidarStage;
  fitLabel: string;
  /** The LoD2 fit was used (reliable and plausible). */
  fitUsed: boolean;
  /** The fitter reported ok, but the parts were rejected as implausible. */
  fitRejected: boolean;
  /** Fallback used instead of a fit: LoD1.3 blocks at robust LiDAR heights or priors. */
  fallback?: 'lod13' | 'priors';
  /** BNG shift applied to the OSM geometry (local BNG metres). */
  shift: Vec2;
  frame: LocalFrame;
  registerLL: (ll: LonLat) => LonLat;
  bngToEnu?: (p: Vec2) => Vec2;
  ground?: number;
  parts: ReconstructedPart[];
  chimneys: ChimneySpec[];
  priorHint?: 'lidar' | 'osm-tags';
  mainStoreys?: number;
  /** Flags raised by the pipeline itself (merged with the fitter's flags). */
  extraFlags: string[];
  extraNotes: string[];
  /** Live aerial ground texture around the origin (never exported), when imagery is available. */
  imagery?: ImageryRef;
  /** LiDAR heights of context buildings that were not part of the fit (Overture outlines). */
  contextHeights?: ReconstructOutput['neighbourHeights'];
}

/** FitReport from the reconstruct output (undefined when no roof estimate exists). */
function fitReport(a: AssembleInput, out: ReconstructOutput, specs: ReturnType<typeof partSpecs>): FitReport | undefined {
  if (out.report.selected === 'none' || !Number.isFinite(out.report.sigma)) return undefined;
  const c = a.lidar.targetLocal ? centroidOf(a.lidar.targetLocal) : ([0, 0] as Vec2);
  let shiftEnu: Vec2 = [0, 0];
  if (a.bngToEnu) {
    const p0 = a.bngToEnu(c);
    const p1 = a.bngToEnu([c[0] + a.shift[0], c[1] + a.shift[1]]);
    shiftEnu = [p1[0] - p0[0], p1[1] - p0[1]];
  }
  const fin = (v: number) => (Number.isFinite(v) ? roundTo(v, 3) : 0);
  return {
    method: a.fitLabel,
    registration: {
      shift: roundVec(shiftEnu),
      sigmaMajor: fin(out.registration.sigmaMajor),
      sigmaMinor: fin(out.registration.sigmaMinor),
      method: out.registration.method,
      ...(out.registration.flag ? { flag: out.registration.flag } : {}),
    },
    sigma: fin(out.report.sigma),
    rmse: fin(Number.isFinite(out.report.rmse) ? out.report.rmse : out.report.sigma),
    inlierFraction: fin(out.report.inlierFraction),
    nPixels: out.report.nPixels,
    pModel: Number.isFinite(out.report.pModel) ? roundTo(out.report.pModel, 4) : 0,
    unreliable: out.report.unreliable || !out.ok || a.fitRejected,
    selected: out.report.selected,
    alternatives: out.report.alternatives.map((x) => ({ label: x.label, deltaCriterion: Number.isFinite(x.deltaCriterion) ? roundTo(x.deltaCriterion, 2) : 0 })),
    parts: a.fitUsed ? fitPartReports(a.parts, specs) : fitPartReports(out.parts, []),
  };
}

/** Display string for the address. */
function displayAddress(req: BuildModelRequest, tags: Record<string, string>): string {
  if (req.geocode?.best?.label) return req.geocode.best.label;
  const first = [tags['addr:housenumber'] ?? tags['addr:housename'] ?? tags.name, tags['addr:street']].filter(Boolean).join(' ');
  const parts = [first, tags['addr:city'], tags['addr:postcode']].filter((s) => !!s && s.trim());
  if (parts.length) return parts.join(', ');
  if (req.address) return req.address;
  return `${req.lat.toFixed(6)}, ${req.lon.toFixed(6)}`;
}

/** Build the HouseModelSpec. */
export function assembleSpec(a: AssembleInput): HouseModelSpec {
  const { req, target, frame, registerLL, lidar } = a;
  const out = lidar.output;
  const toEnu = (ll: LonLat): Vec2 => frame.toLocal(ll) as Vec2;
  const tags = target.tags;
  const specs = partSpecs(a.parts, a.chimneys, {
    era: a.era,
    ...(a.nation ? { nation: a.nation } : {}),
    tags,
    source: a.fitUsed
      ? { heights: 'lidar', roof: 'lidar' }
      : a.fallback === 'lod13'
        ? { heights: 'lidar', roof: 'prior' }
        : { heights: a.priorHint === 'lidar' ? 'lidar' : a.priorHint === 'osm-tags' ? 'osm-tags' : 'prior', roof: a.roofShape ? 'osm-tags' : 'prior' },
    ...(a.mainStoreys !== undefined ? { mainStoreys: a.mainStoreys } : {}),
  });
  const fit = out ? fitReport(a, out, specs) : undefined;
  const notes = [...a.extraNotes];
  if (out && !fit) notes.push(`No LiDAR roof estimate${out.flags.length ? ` (${out.flags.join(', ')})` : ''}.`);
  const evidence =
    a.opts.evidence && out && a.bngToEnu && lidar.rasters
      ? evidenceFrom(out.samples, a.bngToEnu, {
          max: a.opts.maxEvidence,
          resolution: lidar.rasters.dsm.res,
          source: lidar.rasters.source.title,
          ...(lidar.rasters.source.surveyDates?.length ? { surveyDate: lidar.rasters.source.surveyDates[lidar.rasters.source.surveyDates.length - 1] } : {}),
        })
      : undefined;

  // context: neighbours (registered like the target), roads, terrain
  const ctxBuildings: ContextBuilding[] = a.others
    .filter((o) => !o.b.isPart && o.d <= a.opts.neighbourRadius)
    .map((o) => ({ id: o.b.id, source: o.b.source, tags: o.b.tags, footprint: toLocal(frame, { outer: o.b.outer.map(registerLL), holes: o.b.holes.map((h) => h.map(registerLL)) }) }));
  const measured = [...(out && Number.isFinite(out.ground) ? out.neighbourHeights : []), ...(a.contextHeights ?? [])];
  const neighbours = neighbourSpecs(ctxBuildings, new Set(a.attached), measured);
  const roads = roadSpecs((a.buildings?.roads ?? []).map((r) => ({ ...(r.name ? { name: r.name } : {}), kind: r.kind, line: r.coords.map((c) => toEnu(registerLL(c))) })));
  const box = bboxOf([target.outer.map((p) => toEnu(registerLL(p)))]);
  const half = Math.max(a.opts.terrainHalfSize, Math.ceil(Math.max(-box.minX, box.maxX, -box.minY, box.maxY) + 10));
  const terrain =
    a.opts.terrain && lidar.rasters && lidar.ostn && a.ground !== undefined
      ? terrainGrid(lidar.rasters.dtm, a.ground, frame, lidar.ostn, { half, cell: DEFAULTS.terrainCell, source: lidar.rasters.source.title })
      : undefined;

  // facade: front edge of the (regularised) outline -> matching part edge
  let front: { partId: string; edge: number } | undefined;
  const r = target.outer;
  if (a.front && a.front.edge < r.length) front = matchPartEdge(toEnu(registerLL(r[a.front.edge])), toEnu(registerLL(r[(a.front.edge + 1) % r.length])), specs);
  const entrance = a.front?.entrance ? toEnu(registerLL(a.frontFrame.toLonLat(a.front.entrance) as LonLat)) : undefined;
  const facade = facadeHints(front, entrance, a.front?.streetName ?? a.street);

  const age = surveyAgeYears(lidar.rasters, a.now);
  const quality = buildQuality({
    ...(req.geocode ? { geocode: req.geocode } : {}),
    manualTarget: a.how === 'drawn' || (a.how === 'ref' && osmRefOf(req.buildingRef) !== req.geocode?.best?.osmRef),
    targetSource: target.source,
    targetAmbiguous: a.how === 'provider' && !!a.buildings?.ambiguous,
    terraceBlock: a.terraceBlock,
    ...(a.nation ? { nation: a.nation } : {}),
    lidar: { status: lidar.status, ...(lidar.reason ? { reason: lidar.reason } : {}), ...(lidar.rasters ? { rasters: lidar.rasters } : {}) },
    fitUsed: a.fitUsed,
    blocksUsed: a.fallback === 'lod13',
    ...(fit ? { fit } : {}),
    priorsUsed: a.fallback === 'priors',
    ...(a.priorHint ? { priorHeightHint: a.priorHint } : {}),
    roofTagged: !!a.roofShape,
    heritage: isHeritage(tags),
    ...(a.front ? { frontMethod: a.front.method } : {}),
    registrationShift: Math.hypot(a.shift[0], a.shift[1]),
    ...(age !== undefined ? { surveyAgeYears: age } : {}),
    extraFlags: [...(out?.flags ?? []), ...a.extraFlags],
    extraNotes: notes,
  });
  const usedOverture = target.source === 'overture' || ctxBuildings.some((b) => b.source === 'overture');
  const release = a.buildings?.sources.find((s) => s.startsWith('overture:'))?.slice('overture:'.length);
  const provenance = buildProvenance({
    usedOsm: target.source === 'osm' || ctxBuildings.some((b) => b.source === 'osm'),
    usedOverture,
    ...(usedOverture && release ? { overtureRelease: release } : {}),
    ...(req.geocode ? { geocode: req.geocode } : {}),
    ...(lidar.rasters ? { rasters: lidar.rasters } : {}),
    priorsUsed: a.fallback === 'priors',
  });
  const postcode = req.geocode?.postcode?.postcode ?? req.geocode?.parsed?.postcode ?? tags['addr:postcode'];
  const input = req.address ?? req.geocode?.query;
  return {
    schema: SPEC_SCHEMA,
    id: target.id,
    address: { ...(input ? { input } : {}), display: displayAddress(req, tags), ...(postcode ? { postcode } : {}), ...(a.nation ? { nation: a.nation } : {}) },
    origin: { lat: roundTo(frame.lat0, 8), lon: roundTo(frame.lon0, 8) },
    groundElevation: a.ground !== undefined ? roundTo(a.ground, 3) : null,
    builtForm: a.builtForm,
    era: a.taggedEra ?? 'unknown',
    parts: specs,
    facade,
    context: { neighbours, ...(terrain ? { terrain } : {}), ...(a.imagery ? { imagery: a.imagery } : {}), ...(roads.length ? { roads } : {}) },
    ...(fit ? { fit } : {}),
    ...(evidence ? { evidence } : {}),
    quality,
    provenance,
    generatedAt: a.now.toISOString(),
    generator: GENERATOR,
  };
}
