// The part of the core the strict root project uses (`sunny-facade` export
// condition on `./model`, `./layout` and `./types`): rebuilding a house from a
// stored spec.json and laying a quote's panels out on it, for the proposal
// PDF's roof plan. Hand-written so the root never compiles the vendored
// geometry; `facade-check.ts` fails the SunScan typecheck if the
// implementation stops satisfying anything declared here.

type Vec3 = [number, number, number];

/**
 * A parsed `spec.json` as the root sees it: only the fields it checks before
 * handing the spec on. The real spec has many more; the root reads it from
 * storage as untrusted JSON, so it checks this much and catches a throw.
 */
export interface HouseModelSpec {
  schema: 'sunscan.house/1';
  parts: unknown[];
  origin: { lat: number; lon: number };
  context: object;
}

export interface MeshLayer {
  id: string;
  kind: string;
  material: string;
  partId?: string;
  /** Local ENU metres (x east, y north, z up). Length 3n. */
  positions: Float32Array;
  indices: Uint32Array;
  /** 'roof' / 'roof-skin' layers: the RoofFaceInfo id of each triangle. */
  triangleTags?: Uint32Array;
}

export interface RoofFaceInfo {
  id: number;
  partId: string;
  kind: string;
  pitchDeg: number;
  /** Compass bearing of the downslope direction (0 = N, 90 = E); NaN for flat. */
  azimuthDeg: number;
  area: number;
  planArea: number;
  centroid: Vec3;
  normal: Vec3;
}

export interface HouseMesh {
  layers: MeshLayer[];
  roofFaces: RoofFaceInfo[];
}

export declare function synthesizeHouse(spec: HouseModelSpec): HouseMesh;

export declare const PANEL_LAYOUT: {
  readonly edgeSetbackM: number;
  readonly panelLongM: number;
  readonly panelShortM: number;
  readonly gapM: number;
  readonly liftM: number;
};

export interface PanelPlacement {
  faceId: number;
  /** Panel centre, local ENU metres, lifted off the roof by PANEL_LAYOUT.liftM. */
  center: Vec3;
  /** Unit vectors in ENU: along the eave, up the slope, out of the roof. */
  across: Vec3;
  up: Vec3;
  normal: Vec3;
  widthM: number;
  heightM: number;
  row: number;
  col: number;
}

export interface PanelLayoutOptions {
  count: number;
  planeIds?: readonly number[];
  moduleLongM?: number;
  moduleShortM?: number;
}

export interface PanelLayout {
  placements: PanelPlacement[];
  perPlane: { faceId: number; count: number; capacity: number }[];
  unplaced: number;
}

/** `mesh` is always one `synthesizeHouse` returned. */
export declare function layoutPanels(mesh: HouseMesh, opts: PanelLayoutOptions): PanelLayout;
