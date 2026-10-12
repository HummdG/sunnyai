// Types of the server pipeline (I-API): request/result of buildModel and the injectable stage functions.
// Core contracts (HouseModelSpec, ReconstructInput/Output, ...) live in @sunscan/core; provider contracts in ../contracts.ts.
import type {
  BuiltForm,
  EdgeKind,
  HouseModelSpec,
  PolygonM,
  PriorContext,
  ReconstructedPart,
  ReconstructInput,
  ReconstructOutput,
  Vec2,
} from '@sunny/sunscan-core';
import type { BuildingsResult, GeocodeResult, LonLat, Providers } from '../contracts.js';

/** Tunables of one model build (all optional; defaults in brackets). */
export interface BuildModelOptions {
  /** Overpass search radius around the point in metres [80]. */
  radius?: number;
  /** Neighbours within this distance of the target become context buildings [50]. */
  neighbourRadius?: number;
  /** Margin added around the target footprint for the LiDAR window, metres [24]. */
  lidarMargin?: number;
  /** Include the terrain grid [true]. */
  terrain?: boolean;
  /** Half-size of the terrain grid in metres [30]. */
  terrainHalfSize?: number;
  /** Include LiDAR evidence samples [true]. */
  evidence?: boolean;
  /** Maximum number of evidence samples [4000]. */
  maxEvidence?: number;
  /** Reference the live aerial ground texture (spec.context.imagery) when imagery is available [true]. */
  imagery?: boolean;
  /** Half-size of the aerial ground texture square in metres [60]. */
  imageryHalfSize?: number;
}

/** Input of {@link BuildModelFn}: a point plus an optional explicit target (OSM/Overture ref or user-drawn outline). */
export interface BuildModelRequest {
  lat: number;
  lon: number;
  /** 'osm:way/123' | 'way/123' | 'overture:<id>' — the building the user confirmed. */
  buildingRef?: string;
  /** User-drawn outline [lon, lat][] (open or closed ring); wins over buildingRef. */
  footprint?: LonLat[];
  /** The address text the user typed. */
  address?: string;
  /** The geocoder result for `address` (gives postcode, nation, confidence). */
  geocode?: GeocodeResult;
  /** Pre-fetched buildings around the point (skips a provider call). */
  buildings?: BuildingsResult;
  options?: BuildModelOptions;
}

/** How the pipeline reached its main decisions (for reports and tests; not part of the spec). */
export interface BuildDiagnostics {
  /** Street-facing edge detection: method ('entrance' | 'road' | 'nearest-road' | 'longest-edge') and reasons. */
  front?: { method: FrontEdgeResult['method']; reasons: string[]; streetName?: string };
  /** Party walls / built form: reasons from the footprint analysis; terraceBlock = multi-dwelling outline. */
  footprint: { builtForm: BuiltForm; terraceBlock: boolean; reasons: string[] };
  /** Which model was used for the parts: the LoD2 fit, LoD1.3 blocks or priors. */
  parts: 'fit' | 'lod13' | 'priors';
}

/** Output of {@link BuildModelFn}. */
export interface BuildModelResult {
  spec: HouseModelSpec;
  /** Milliseconds per stage ('buildings', 'footprint', 'elevation', 'reconstruct', ..., 'total'). */
  timings: Record<string, number>;
  warnings: string[];
  diagnostics?: BuildDiagnostics;
}

/** core/fit `reconstruct` (sync or async). */
export type ReconstructFn = (input: ReconstructInput) => ReconstructOutput | Promise<ReconstructOutput>;

/** What a priors fallback may return; normalised by the pipeline adapter (core/fit returns the object form). */
export type PriorsFallbackResult = ReconstructedPart | ReconstructedPart[] | { parts: ReconstructedPart[]; notes?: string[]; storeys?: number };

/** core/fit `priorsFallback(PriorContext, footprint, edgeKinds)` — footprint in local ENU metres. */
export type PriorsFallbackFn = (
  ctx: PriorContext,
  footprint: PolygonM,
  edgeKinds: EdgeKind[],
) => PriorsFallbackResult | Promise<PriorsFallbackResult>;

/** A building prepared for footprint analysis, in one local metric frame. */
export interface AnalysisBuilding {
  id: string;
  footprint: PolygonM;
  tags: Record<string, string>;
  isPart: boolean;
  source: 'osm' | 'overture' | 'drawn';
}

/** Input of {@link AnalyseFootprintFn}: the target, every other building and the address nodes (same frame). */
export interface FootprintContext {
  target: AnalysisBuilding;
  others: AnalysisBuilding[];
  addressNodes: { xy: Vec2; tags: Record<string, string> }[];
}

/** Party walls and built form of the target footprint. */
export interface FootprintAnalysis {
  /** One kind per target edge (outer ring first, then holes): 'party' or 'eave'. */
  edgeKinds: EdgeKind[];
  /** Indices of party edges. */
  partyEdges: number[];
  builtForm: BuiltForm;
  /** Ids of buildings sharing >= 2 m of wall with the target (dwellings and ancillary). */
  attached: string[];
  /** The target polygon probably covers several dwellings (a whole terrace row mapped as one way). */
  terraceBlock: boolean;
  reasons: string[];
}

/** Party-wall + built-form analysis (default: core/footprint analyseFootprint through an adapter). */
export type AnalyseFootprintFn = (ctx: FootprintContext) => FootprintAnalysis;

/** Input of {@link FrontEdgeFn} (local metres). */
export interface FrontEdgeInput {
  footprint: PolygonM;
  edgeKinds: EdgeKind[];
  roads: { name?: string; kind: string; line: Vec2[] }[];
  entrances: { xy: Vec2; tags: Record<string, string> }[];
  /** addr:street of the target (doubles the score of a road with that name). */
  street?: string;
}

/** The street-facing edge of a footprint. */
export interface FrontEdgeResult {
  edge: number;
  method: 'entrance' | 'road' | 'nearest-road' | 'longest-edge';
  entrance?: Vec2;
  streetName?: string;
  reasons: string[];
}

/** Street-facing edge detection (default: core/footprint frontEdge through an adapter). */
export type FrontEdgeFn = (input: FrontEdgeInput) => FrontEdgeResult | undefined;

/**
 * Footprint regularisation after the party-wall analysis (drop tiny/collinear vertices, orthogonalise near-right
 * angles); per-edge kinds are carried over to the new edges. Default: core/footprint regularizeFootprintDetailed.
 */
export type RegularizeFootprintFn = (footprint: PolygonM, edgeKinds: EdgeKind[]) => { footprint: PolygonM; edgeKinds: EdgeKind[] };

/** Logger for degradations (provider failures that trigger fallbacks, rejected fits). */
export type PipelineLog = (level: 'info' | 'warn' | 'error', message: string, err?: unknown) => void;

/** Dependencies of buildModel. Only `providers` is required; the core stages default to @sunscan/core. */
export interface BuildModelDeps {
  providers: Providers;
  /** Where degradations are logged (default: console.warn / console.error). */
  log?: PipelineLog;
  reconstruct?: ReconstructFn;
  /** Label recorded as FitReport.method when `reconstruct` is injected. */
  reconstructLabel?: string;
  priorsFallback?: PriorsFallbackFn;
  analyseFootprint?: AnalyseFootprintFn;
  frontEdge?: FrontEdgeFn;
  regularizeFootprint?: RegularizeFootprintFn;
  now?: () => Date;
}

/** The pipeline entry point. */
export type BuildModelFn = (req: BuildModelRequest, deps: BuildModelDeps) => Promise<BuildModelResult>;
