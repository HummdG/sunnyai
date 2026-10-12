// Shared contracts for SunScanV2 (server <-> core <-> web).
//
// Frames & units
//  - WGS84 lat/lon for anything that leaves the server as geography.
//  - Local ENU metres for all house geometry: x = east, y = north, z = up, origin = HouseModelSpec.origin.
//  - Heights inside a HouseModelSpec are metres relative to the house ground datum
//    (HouseModelSpec.groundElevation, metres above Ordnance Datum Newlyn when known).
//  - three.js / glTF world = (x = east, y = up, z = -north). Conversion happens only in the web app / exporters.
//  - British National Grid (EPSG:27700, OSTN15) is used only inside the server's LiDAR code.
import type { PolygonM, Ring, Vec2, Vec3 } from './geometry/geom.js';
import type { EdgeKind, FaceKind, RoofParams, RoofType } from './geometry/roof.js';

export type { PolygonM, Ring, Vec2, Vec3, EdgeKind, FaceKind, RoofParams, RoofType };

// ----------------------------------------------------------------------------------------------
// House model specification (small, JSON-serialisable, editable, versioned)
// ----------------------------------------------------------------------------------------------

export type Nation = 'England' | 'Wales' | 'Scotland' | 'Northern Ireland';
export type BuiltForm = 'detached' | 'semi-detached' | 'end-terrace' | 'mid-terrace' | 'block' | 'unknown';
export type Era = 'pre-1919' | '1919-1944' | '1945-1964' | '1965-1980' | '1981-2000' | 'post-2000' | 'unknown';
export type WallMaterial = 'brick' | 'render' | 'stone' | 'timber' | 'pebbledash';
export type RoofMaterial = 'tile' | 'slate' | 'flat';
export type HeightSource = 'lidar' | 'osm-tags' | 'prior' | 'user';
export type Confidence = 'measured' | 'high' | 'medium' | 'low' | 'estimated';

/** Roof definition of one part. Same semantics as the geometry engine's RoofParams, minus eaveHeight
 *  (which lives on the part). `type` decides the speed profile; gables/hips/party walls come from edgeKinds. */
export type RoofSpec = Omit<RoofParams, 'eaveHeight'>;

/** A detected or estimated chimney stack (box), local ENU, heights above the ground datum. */
export interface ChimneySpec {
  center: Vec2;
  width: number; // along `angleDeg`
  depth: number;
  angleDeg: number; // rotation of the width axis, degrees counter-clockwise from east
  top: number; // top height above ground datum
  source: 'lidar' | 'prior';
}

export interface BuildingPartSpec {
  id: string; // 'main', 'rear-1', ...
  role: 'main' | 'rear' | 'side' | 'extension' | 'garage' | 'other';
  /** Local ENU metres; outer ring CCW, holes CW, no repeated closing vertex. */
  footprint: PolygonM;
  /** One kind per footprint edge: outer ring edges first (edge i joins vertex i -> i+1), then each hole's edges. */
  edgeKinds: EdgeKind[];
  /** Bottom of the part above the ground datum (0 for parts standing on the ground). */
  baseHeight: number;
  /** Wall-top / eave height above the ground datum (roof plane height at the wall line). */
  eaveHeight: number;
  roof: RoofSpec;
  storeys: number;
  /** Visual eave overhang in metres (rendered roof skin only; the closed solid stays on the wall line). */
  overhang: number;
  material: { wall: WallMaterial; roof: RoofMaterial; wallColour?: string; roofColour?: string };
  chimneys: ChimneySpec[];
  source: { heights: HeightSource; roof: HeightSource };
}

export interface NeighbourSpec {
  id: string; // e.g. 'osm:way/123'
  footprint: PolygonM; // local ENU metres
  /** Representative top height above the ground datum (LiDAR p90 inside, OSM tags, or a prior). */
  height: number;
  eaveHeight?: number;
  roof?: RoofSpec; // optional simple roof (otherwise a flat-topped prism)
  edgeKinds?: EdgeKind[];
  attached: boolean; // shares a party wall with the target
  source: 'osm' | 'overture';
}

/** Terrain heights relative to the ground datum on a regular north-up grid in local ENU metres. */
export interface TerrainGrid {
  originX: number; // x of the west edge of column 0
  originY: number; // y of the north edge of row 0
  cellSize: number;
  width: number;
  height: number;
  /** Row-major (row 0 = north), cell-centre samples; null = unknown. */
  heights: (number | null)[];
  source: string;
}

export interface ImageryRef {
  /** URL served by our server (live layer only; never embedded in exports by default). */
  url: string;
  /** Local ENU bounds covered by the image: [minX, minY, maxX, maxY]. */
  bounds: [number, number, number, number];
  attribution: string;
  exportable: boolean;
}

export interface RoadSpec { name?: string; kind: string; line: Vec2[] }

export interface FacadeHints {
  /** Footprint edge (index into the part's edges) facing the street, i.e. the front door side. */
  front?: { partId: string; edge: number };
  /** OSM entrance node in local ENU, if mapped. */
  entrance?: Vec2;
  streetName?: string;
}

export interface FitPartReport {
  partId: string;
  family: string; // e.g. 'gable-u', 'hip', 'skillion-S', 'flat', 'half-hip', 'mansard-hip'
  eaveHeight: number; // above ground datum
  ridgeHeight: number; // above ground datum
  pitchDeg: number;
  upperPitchDeg?: number;
  crossPitchDeg?: number; // compound (cross-gable) roofs: pitch of the cross gable
  eaveSE?: number;
  pitchSE?: number;
}

export interface FitReport {
  method: string; // e.g. 'roofit-ts/1'
  registration: {
    shift: Vec2; // metres applied to the OSM footprints (local ENU)
    sigmaMajor: number;
    sigmaMinor: number;
    method: 'edge-neighbourhood' | 'target-only' | 'none';
    flag?: string; // 'on-boundary', 'weak-peak', '1d-ambiguous', ...
  };
  sigma: number; // robust residual scale (m)
  rmse: number; // inlier RMSE (m)
  inlierFraction: number;
  nPixels: number;
  pModel: number; // posterior of the selected hypothesis (not a reliable failure flag on its own)
  unreliable: boolean; // sigma > 0.5 || inlierFraction < 0.7 || nPixels < 15
  selected: string; // label of the selected hypothesis
  alternatives: { label: string; deltaCriterion: number }[];
  parts: FitPartReport[];
}

export interface LidarEvidence {
  /** Flattened local ENU samples [x0, y0, z0, x1, y1, z1, ...]; z above the ground datum. */
  points: number[];
  /** Optional per-sample residual (observed - fitted), metres. */
  residuals?: number[];
  resolution: number; // m
  source: string;
  surveyDate?: string;
}

export interface QualityReport {
  geocode: 'high' | 'medium' | 'low' | 'manual';
  footprint: Confidence;
  heights: Confidence;
  roof: Confidence;
  openings: 'procedural';
  interior: 'procedural';
  /** Machine-readable flags, e.g. 'lidar-unavailable', 'fit-unreliable', 'registration-ambiguous',
   *  'survey-old', 'terrace-block', 'footprint-from-overture', 'footprint-user-drawn', 'outside-library'. */
  flags: string[];
  /** Human-readable notes shown in the UI. */
  notes: string[];
}

export interface SourceRecord {
  id: string; // 'osm', 'ea-lidar-composite-2022', 'postcodes.io', ...
  title: string;
  licence: string; // 'ODbL-1.0', 'OGL-UK-3.0', ...
  attribution: string;
  url?: string;
  date?: string; // survey/extract date
}

export interface HouseModelSpec {
  schema: 'sunscan.house/1';
  id: string; // 'osm:way/516125064' | 'overture:<id>' | 'drawn:<hash>'
  address: { input?: string; display: string; postcode?: string; nation?: Nation };
  /** WGS84 of the local ENU origin (target footprint centroid after co-registration). */
  origin: { lat: number; lon: number };
  /** Ground datum in metres above ODN (DTM median under the house); null when unknown. */
  groundElevation: number | null;
  builtForm: BuiltForm;
  era: Era;
  parts: BuildingPartSpec[];
  facade: FacadeHints;
  context: {
    neighbours: NeighbourSpec[];
    terrain?: TerrainGrid;
    imagery?: ImageryRef;
    roads?: RoadSpec[];
  };
  fit?: FitReport;
  evidence?: LidarEvidence;
  quality: QualityReport;
  provenance: SourceRecord[];
  generatedAt: string; // ISO timestamp
  generator: string; // 'sunscan-server/0.1.0'
}

// ----------------------------------------------------------------------------------------------
// Synthesis output (renderer-agnostic meshes produced by core from a HouseModelSpec)
// ----------------------------------------------------------------------------------------------

export type MaterialKey =
  | 'wall-brick' | 'wall-render' | 'wall-stone' | 'wall-timber' | 'wall-pebbledash'
  | 'roof-tile' | 'roof-slate' | 'roof-flat' | 'roof-underside'
  | 'glass' | 'frame' | 'door' | 'sill'
  | 'floor-slab' | 'interior-wall' | 'stair' | 'room-floor'
  | 'chimney'
  | 'neighbour-wall' | 'neighbour-roof' | 'terrain';

export type LayerKind =
  | 'solid' // closed watertight building solid (floor + walls + roof faces) – used for export/printing
  | 'walls' | 'roof' | 'roof-skin' | 'openings' | 'floors' | 'interior' | 'stairs' | 'chimneys'
  | 'neighbours' | 'terrain';

export interface MeshLayer {
  id: string; // unique within a HouseMesh, e.g. 'main/walls', 'main/storey-1/interior-walls'
  kind: LayerKind;
  material: MaterialKey;
  partId?: string;
  storey?: number; // for per-storey layers (floors, interior, openings)
  /** Local ENU metres (x east, y north, z up above the ground datum). Length 3n. */
  positions: Float32Array;
  normals: Float32Array; // length 3n, unit, outward
  /** Metre-based UVs (walls: u along the wall, v up; roofs/floors: plan x/y). Length 2n. */
  uvs: Float32Array;
  indices: Uint32Array; // CCW seen from outside (right-handed in ENU)
  /**
   * Optional per-triangle tag (NO_TAG = 0xFFFFFFFF where not applicable). Meaning by layer kind:
   * 'walls' → footprint edge index of the part; 'roof' / 'roof-skin' → RoofFaceInfo.id;
   * 'openings' → index into HouseMesh.openings; room floors ('interior', material 'room-floor') → index into
   * HouseMesh.rooms; 'neighbours' → index into spec.context.neighbours.
   */
  triangleTags?: Uint32Array;
}

/** Exact storey levels used by the synthesis (lets viewers cut away by storey without re-deriving them). */
export interface StoreyLevel {
  partId: string;
  storey: number; // 0 = ground floor
  floorZ: number; // finished floor level above the ground datum
  ceilingZ: number;
  inRoof: boolean; // storey (partly) inside the roof space (attic / 1.5-storey)
}

export interface RoofFaceInfo {
  id: number;
  partId: string;
  kind: FaceKind;
  pitchDeg: number;
  azimuthDeg: number; // compass bearing of the downslope direction (0 = N, 90 = E); NaN for flat
  area: number; // 3D m2
  planArea: number; // horizontal projection m2
  centroid: Vec3;
  normal: Vec3;
}

export interface RoomInfo {
  id: string;
  partId: string;
  storey: number; // 0 = ground floor
  label: string; // 'living room', 'kitchen', 'bedroom 1', 'hall', 'landing', 'bathroom', ...
  polygon: Vec2[]; // local ENU, CCW
  area: number;
  floorZ: number;
  ceilingZ: number;
  estimated: true;
}

export interface OpeningInfo {
  id: string;
  partId: string;
  type: 'window' | 'door';
  storey: number;
  edge: number; // footprint edge index of the part
  center: Vec3; // centre of the opening on the wall plane
  width: number;
  height: number;
  facingDeg: number; // compass bearing of the outward wall normal
  estimated: true;
}

export interface HouseStats {
  footprintArea: number; // m2, sum over parts (plan)
  grossFloorArea: number; // m2, sum of storey slab areas
  volume: number; // m3 of the closed solids
  eaveHeight: number; // main part, above ground datum
  ridgeHeight: number; // max roof height above ground datum
  roofArea: number; // 3D m2 of pitched + flat roof faces
  roofPlanArea: number;
  wallArea: number; // external wall area (excluding party walls)
  partyWallArea: number;
  storeys: number;
  windows: number;
  doors: number;
}

export interface HouseMesh {
  layers: MeshLayer[];
  roofFaces: RoofFaceInfo[];
  rooms: RoomInfo[];
  openings: OpeningInfo[];
  /** Storey levels per part (optional for backwards compatibility; populated by core/model). */
  levels?: StoreyLevel[];
  stats: HouseStats;
  /** Result of validating each part's closed solid (watertight 2-manifold, outward, positive volume). */
  validation: { solidsWatertight: boolean; issues: string[] };
}

export interface SynthesisOptions {
  openings?: boolean; // default true
  floors?: boolean; // default true
  interior?: boolean; // default true
  chimneys?: boolean; // default true
  roofSkin?: boolean; // default true (overhang skin with thickness)
  neighbours?: boolean; // default true
  terrain?: boolean; // default true
}

// ----------------------------------------------------------------------------------------------
// Rasters & reconstruction (core/fit). Planar metric frame shared by rasters and polygons.
// ----------------------------------------------------------------------------------------------

/** North-up raster in a planar metric frame (x right/east, y up/north). */
export interface HeightGrid {
  width: number;
  height: number;
  originX: number; // x of the left edge of column 0
  originY: number; // y of the top edge of row 0
  res: number; // pixel size in metres (square pixels)
  /** Row-major, row 0 = top (north); values in metres; NaN = nodata. */
  data: Float32Array;
}

export interface PriorContext {
  builtForm?: BuiltForm;
  era?: Era;
  storeysHint?: number; // e.g. OSM building:levels
  heightHint?: number; // e.g. OSM height, or a robust LiDAR top height when the fit was rejected
  heightHintSource?: 'osm' | 'lidar'; // provenance of heightHint (affects notes/labels)
  roofShapeHint?: string; // OSM roof:shape
  buildingTag?: string; // OSM building=*
}

export interface ReconstructInput {
  dsm: HeightGrid;
  dtm: HeightGrid;
  /** Optional last-return DSM (England): dsm - dsmLast > 1 m marks vegetation/overhangs. */
  dsmLast?: HeightGrid;
  target: { id: string; footprint: PolygonM; edgeKinds: EdgeKind[] };
  /** Neighbouring footprints within ~100 m (same frame), used for joint co-registration and context heights. */
  neighbours: { id: string; footprint: PolygonM; edgeKinds?: EdgeKind[] }[];
  priors?: PriorContext;
  options?: { searchRadius?: number; erode?: number; erodeParty?: number; maxParts?: number; usePriors?: boolean };
}

export interface ReconstructedPart {
  id: string;
  role: BuildingPartSpec['role'];
  footprint: PolygonM; // registered, same planar frame as the input
  edgeKinds: EdgeKind[];
  roof: RoofSpec;
  eaveHeight: number; // metres ABOVE THE GROUND estimate
  ridgeHeight: number; // metres above the ground estimate
  family: string;
  pitchSE?: number;
  eaveSE?: number;
}

// ----------------------------------------------------------------------------------------------
// Interior layout (core/interior) — pure 2D layout; meshing happens in core/model.
// ----------------------------------------------------------------------------------------------

export interface InteriorInput {
  partId: string;
  footprint: PolygonM; // local ENU, the part's footprint (external wall line)
  edgeKinds: EdgeKind[];
  frontEdge?: number; // street-facing edge index of this part (main part); undefined for rear parts
  storeys: number;
  /** Per storey: finished floor level and ceiling height above the ground datum. */
  levels: { floorZ: number; ceilingZ: number }[];
  wallThickness: number; // external wall thickness (m), rooms are laid out inside the inset footprint
  era: Era;
  builtForm: BuiltForm;
  role: BuildingPartSpec['role'];
  /** Optional attached rear part (outrigger/extension) so the plan can put the kitchen/bathroom there. */
  rearPart?: { partId: string; footprint: PolygonM; storeys: number };
}

export interface InteriorWall {
  storey: number;
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** Door openings along the wall: `at` = distance from a to the opening centre (m). */
  doors: { at: number; width: number; height: number }[];
}

export interface StairFlight {
  storey: number; // the flight starts on this storey and climbs to storey + 1
  start: Vec2; // centre of the bottom of the first riser
  direction: Vec2; // unit vector (plan) of travel up the flight
  width: number;
  risers: number;
  riserHeight: number;
  going: number;
  /** Plan rectangle occupied by the flight (CCW). */
  polygon: Vec2[];
}

export interface InteriorLayout {
  rooms: RoomInfo[]; // storey-tagged, labelled, estimated
  walls: InteriorWall[];
  stairs: StairFlight[];
  warnings: string[];
}

export interface ReconstructOutput {
  ok: boolean; // false => caller should fall back to priors
  ground: number; // absolute (raster units, m ODN)
  groundCheck: number | null; // ring-plane cross-check
  registration: FitReport['registration'];
  parts: ReconstructedPart[];
  chimneys: ChimneySpec[]; // in the input planar frame, top above ground estimate
  /** Heights relative to the TARGET's ground estimate (`ground`), not each neighbour's own ground. */
  neighbourHeights: { id: string; height: number; eaveHeight?: number }[];
  report: Omit<FitReport, 'registration' | 'parts' | 'method'>;
  /** Samples used by the fit (planar frame), z above ground estimate, with residuals. */
  samples: { x: number; y: number; z: number; residual: number }[];
  flags: string[];
}
