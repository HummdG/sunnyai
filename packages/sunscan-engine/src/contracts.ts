// Interfaces between the server's data layer (I-DATA: http, geocode, buildings, elevation)
// and the pipeline/API layer (I-API: pipeline, routes, cli). Both sides code against these.
//
// Module entry points (implemented by I-DATA):
//   src/http/index.ts       fetchCached(req: HttpRequest): Promise<HttpResponse>; setHttpMode(m); getHttpMode()
//   src/geocode/index.ts    geocodeUk(q): Promise<GeocodeResult>; suggestUk(q): Promise<Suggestion[]>;
//                           parseUkAddress(s): ParsedUkAddress; nationAt(lat, lon): Promise<Nation | undefined>
//   src/buildings/index.ts  fetchBuildings(req: BuildingsRequest): Promise<BuildingsResult>
//   src/elevation/index.ts  getSurfaceRasters(req: ElevationRequest): Promise<SurfaceRasters | NoCoverage>;
//                           getOstn15(): Promise<Ostn15>
import type { Nation } from '@sunny/sunscan-core';

export type HttpMode = 'live' | 'record' | 'replay';

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'HEAD';
  body?: string; // e.g. Overpass `data=...`
  headers?: Record<string, string>;
  /** Byte range for COG / PMTiles reads (inclusive). */
  range?: [number, number];
  provider: string; // 'nominatim' | 'photon' | 'postcodes.io' | 'overpass' | 'overture' | 'ea-wcs' | 'wales-cog' | 'srsp' | 'esri' | ...
  ttlSec?: number; // cache TTL in record/live modes
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  fromCache: boolean;
  url: string; // final URL (after failover/redirects)
}

export interface ParsedUkAddress {
  raw: string;
  postcode?: string; // normalised 'L25 7SA'
  outward?: string;
  subBuilding?: string;
  houseNumber?: string;
  houseName?: string;
  street?: string;
  localities: string[];
  nationHint?: Nation;
}

export type GeocodeLevel = 'building' | 'address-point' | 'poi' | 'street' | 'postcode' | 'locality' | 'other';

export interface GeocodeCandidate {
  label: string;
  lat: number;
  lon: number;
  level: GeocodeLevel;
  osmRef?: string; // 'way/123' | 'relation/45' | 'node/6'
  score: number;
  reasons: string[];
  sources: string[]; // strategies that produced it ('nominatim-free', 'photon', ...)
}

export interface GeocodeResult {
  query: string;
  parsed: ParsedUkAddress;
  confidence: 'high' | 'medium' | 'low';
  best?: GeocodeCandidate;
  candidates: GeocodeCandidate[];
  postcode?: { postcode: string; lat: number; lon: number; nation?: Nation; eastings?: number; northings?: number };
}

export interface Suggestion {
  label: string;
  kind: 'postcode' | 'address' | 'place';
  lat?: number;
  lon?: number;
  osmRef?: string;
}

export type LonLat = [number, number];

export interface BuildingFeature {
  ref: string; // 'osm:way/123' | 'osm:relation/45' | 'overture:<id>'
  source: 'osm' | 'overture';
  outer: LonLat[]; // open ring (no closing duplicate), any orientation
  holes: LonLat[][];
  tags: Record<string, string>;
  isPart: boolean; // OSM building:part
  score?: number; // target-candidate score (higher = more likely the requested house)
  reasons?: string[];
}

export interface BuildingsRequest {
  lat: number;
  lon: number;
  radius?: number; // default 80 m
  osmRef?: string; // geocoder's OSM object to force-include and prefer, e.g. 'way/516128867'
  parsed?: ParsedUkAddress; // for address-tag matching
}

export interface BuildingsResult {
  center: { lat: number; lon: number };
  target?: string; // ref of the best target candidate
  ambiguous: boolean;
  buildings: BuildingFeature[]; // target candidates + neighbours (+ parts)
  addressNodes: { lon: number; lat: number; tags: Record<string, string> }[];
  entrances: { lon: number; lat: number; tags: Record<string, string> }[];
  roads: { name?: string; kind: string; coords: LonLat[] }[];
  sources: string[]; // e.g. ['overpass:overpass.openstreetmap.fr', 'overture:2026-09-23.1']
  warnings: string[];
}

/** British National Grid (EPSG:27700, OSTN15) bounding box in metres. */
export interface Bbox27700 { minE: number; minN: number; maxE: number; maxN: number }

/** North-up raster in EPSG:27700: originE/originN = top-left corner of the top-left pixel; NaN = nodata. */
export interface BngGrid { width: number; height: number; originE: number; originN: number; res: number; data: Float32Array }

export interface SurfaceRasters {
  dsm: BngGrid; // first-return-type surface
  dtm: BngGrid; // bare earth, same grid as dsm
  dsmLast?: BngGrid; // England only (vegetation mask: dsm - dsmLast > 1 m)
  source: { id: string; title: string; retrievalUrls: string[]; surveyDates?: string[]; retrievedAt: string };
  licence: { id: string; attribution: string };
  coverage: number; // valid fraction within the requested window
  quality: string[];
}

export interface NoCoverage {
  coverage: 0;
  reason: 'no-open-lidar' | 'outside-coverage' | 'source-error';
  detail?: string;
}

export interface ElevationRequest {
  bbox: Bbox27700; // already snapped/expanded by the caller or snapped by the provider
  nation?: Nation;
}

export interface Ostn15 {
  /** WGS84 (treated as ETRS89) lon/lat -> OSGB36 / BNG easting, northing (OSTN15 grid). */
  toBng(lon: number, lat: number): [number, number];
  /** BNG easting, northing -> WGS84 lon/lat. */
  toWgs84(e: number, n: number): [number, number];
}

/**
 * Everything the pipeline needs from the outside world. Injected into the pipeline/app so that tests can run on
 * recorded fixtures. Live implementation: `createProviders()` exported by `src/providers/index.ts` (I-DATA).
 */
export interface Providers {
  geocodeUk(q: string): Promise<GeocodeResult>;
  suggestUk(q: string): Promise<Suggestion[]>;
  nationAt(lat: number, lon: number): Promise<Nation | undefined>;
  fetchBuildings(req: BuildingsRequest): Promise<BuildingsResult>;
  getSurfaceRasters(req: ElevationRequest): Promise<SurfaceRasters | NoCoverage>;
  getOstn15(): Promise<Ostn15>;
  /** Esri/OSM tile proxy for the optional live imagery layer (bytes + content type), or null if unavailable. */
  getImageryTile?(z: number, x: number, y: number): Promise<{ body: Uint8Array; contentType: string } | null>;
}
