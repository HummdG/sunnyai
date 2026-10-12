// The adapter's public types. Self-contained on purpose: the strict root project
// reads them through `public.d.ts` without compiling the vendored engine, and the
// shapes mirror `@sunny/contracts`' sunscan schemas (a test pins the two).

export type SunScanStatus = 'queued' | 'running' | 'succeeded' | 'low-confidence' | 'failed';
export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'flat';
export type ConfidenceLevel = 'measured' | 'high' | 'medium' | 'low' | 'estimated' | 'manual';

export interface RoofPlaneSummary {
  id: number;
  partId: string;
  pitchDeg: number;
  azimuthDeg: number | null;
  facing: Facing;
  areaM2: number;
  planAreaM2: number;
  /**
   * The plane's extent along the eave and up the slope, measured from the
   * model's roof triangles: the geometry a roof-capacity calculation packs
   * panels into. Bounding extents, so a hip's triangle reads as its rectangle;
   * `fillRatio` says how much of that rectangle the plane really covers.
   */
  widthM: number;
  slopeLengthM: number;
  fillRatio: number;
  /**
   * Area left for panels after the edge setback (ROOF_LAYOUT.edgeSetbackM from
   * every edge), scaled by `fillRatio`. Zero for planes not `suitable`.
   */
  usableAreaM2: number;
  /** Panels of ROOF_LAYOUT's module size that fit the usable rectangle (better orientation), estimate. */
  maxPanels: number;
  suitable: boolean;
}

/**
 * The layout assumptions behind `usableAreaM2` and `maxPanels`. Stated, not
 * hidden: a quote that packs a different module, or uses the installer's own
 * setback, should recompute from `widthM` / `slopeLengthM` / `fillRatio`.
 */
export const ROOF_LAYOUT = {
  /** Clearance kept from every roof edge (ridge, eaves, verges, hips). */
  edgeSetbackM: 0.4,
  /** A typical residential module (about 1.72 m x 1.13 m, 400-450 W). */
  panelLongM: 1.722,
  panelShortM: 1.134,
} as const;

export const INDICATIVE_LABEL = 'Indicative — subject to an on-site survey' as const;

export interface AssessmentSummary {
  address: string;
  postcode: string | null;
  builtForm: string;
  era: string;
  storeys: number;
  roofType: string;
  eaveHeightM: number;
  roofPlanes: RoofPlaneSummary[];
  suitableRoofAreaM2: number;
  /** Sum of the suitable planes' `usableAreaM2`. */
  usableRoofAreaM2: number;
  /** Sum of the suitable planes' `maxPanels` -- an upper estimate before any survey. */
  estimatedMaxPanels: number;
  /** The largest suitable plane by usable area, or null. */
  mainPlaneId: number | null;
  bestFacing: Facing | null;
  /** What sits on or overshadows the roof, as far as the model knows. */
  obstructions: { chimneys: number };
  /**
   * Shading is not simulated. These flags pass on what the engine noticed
   * ('vegetation-masked', taller neighbours) and always include
   * 'shading-not-assessed' so nobody reads their absence as "no shade".
   */
  shadingFlags: string[];
  confidence: {
    geocode: ConfidenceLevel;
    footprint: ConfidenceLevel;
    heights: ConfidenceLevel;
    roof: ConfidenceLevel;
  };
  reliable: boolean;
  flags: string[];
  notes: string[];
  sources: { id: string; title: string; licence: string; attribution: string }[];
  label: typeof INDICATIVE_LABEL;
}

/** Where to assess: an address (optionally with its postcode) or a point. */
export interface AssessmentTarget {
  address?: string;
  postcode?: string;
  lat?: number;
  lon?: number;
}

export interface AssessmentError {
  code:
    | 'address-required'
    | 'address-not-found'
    | 'address-ambiguous'
    | 'outside-uk'
    | 'no-building'
    | 'provider-unavailable'
    | 'engine-error';
  message: string;
}

/** One stored assessment. Tenant-scoped: every read names the tenant. */
export interface AssessmentRecord {
  id: string;
  tenantId: string;
  status: SunScanStatus;
  createdAt: string;
  updatedAt: string;
  target: AssessmentTarget;
  /** The chat session that asked, when one did. */
  sessionId: string | null;
  summary: AssessmentSummary | null;
  error: AssessmentError | null;
  /** Artefact names stored for this assessment ('spec.json', 'model.glb'). */
  artefacts: string[];
  engine: string;
}

/** Tenant-scoped persistence for assessment records. */
export interface AssessmentRepository {
  save(record: AssessmentRecord): Promise<void>;
  get(tenantId: string, id: string): Promise<AssessmentRecord | null>;
}

/**
 * Where the model files go: disk for the file store, an object store (Cloud
 * Storage) in production. Keyed by tenant first so a path never crosses tenants.
 */
export interface ArtefactStore {
  put(tenantId: string, assessmentId: string, name: string, bytes: Uint8Array): Promise<void>;
  get(tenantId: string, assessmentId: string, name: string): Promise<Uint8Array | null>;
}

/** Runs jobs off the request path. In-process today; Cloud Tasks behind the same shape later. */
export interface JobQueue {
  enqueue(job: () => Promise<void>): void;
  /** Resolves when every queued job has finished (tests, graceful shutdown). */
  idle(): Promise<void>;
}

export interface EngineOutcome {
  summary: AssessmentSummary;
  /** The engine's HouseModelSpec, as JSON (the 3D viewer rebuilds the mesh from it). */
  specJson: string;
  /** The rendered model as binary glTF. */
  glb: Uint8Array;
}

/** The pipeline behind the adapter: address in, summary + model out. */
export interface SunScanEngine {
  readonly version: string;
  assess(target: AssessmentTarget): Promise<EngineOutcome>;
}

export interface SunScanService {
  readonly engineVersion: string;
  startAssessment(
    tenantId: string,
    target: AssessmentTarget,
    meta?: { sessionId?: string | null },
  ): Promise<AssessmentRecord>;
  getAssessment(tenantId: string, id: string): Promise<AssessmentRecord | null>;
  getArtefact(
    tenantId: string,
    id: string,
    name: 'spec.json' | 'model.glb',
  ): Promise<Uint8Array | null>;
  /** Waits up to `timeoutMs` for the job to reach a final status; returns the latest record. */
  waitFor(tenantId: string, id: string, timeoutMs: number): Promise<AssessmentRecord | null>;
  /** Resolves when the queue is empty. */
  idle(): Promise<void>;
}

/**
 * What a downstream consumer (the quote journey) receives for a finished
 * assessment: the summary plus the id it came from. Stable: fields are added,
 * never renamed or removed.
 */
export interface RoofAssessmentSummary extends AssessmentSummary {
  assessmentId: string;
  status: SunScanStatus;
}

export const FINAL_STATUSES: readonly SunScanStatus[] = ['succeeded', 'low-confidence', 'failed'];
