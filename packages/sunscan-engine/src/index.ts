// @sunny/sunscan-engine — the SunScan address -> 3D house pipeline, as a library.
//
// Vendored from SunScanV2 apps/server (see docs/integration/sunscan-contract.md
// for provenance). SunScanV2 served this through its own Fastify app; here the
// app, its routes and its CLI are dropped and Sunny's API calls the pipeline
// directly, through the same providers and the same cached / recorded / replayed
// HTTP layer (SUNSCAN_HTTP_MODE = live | record | replay).
//
// Every provider is open UK data and needs no key: Nominatim, Photon and
// postcodes.io (geocoding), Overpass and Overture (footprints), Environment
// Agency / Welsh Government / Scottish Remote Sensing Portal LiDAR (heights),
// and Esri World Imagery tiles (optional ground texture).

export type * from './contracts.js';
export * from './pipeline/index.js';
export { createProviders, getImageryTile, ESRI_ATTRIBUTION } from './providers/index.js';
export { geocodeUk, suggestUk, nationAt } from './geocode/index.js';
export { fetchBuildings } from './buildings/index.js';
export {
  configureHttp,
  getHttpConfig,
  getHttpMode,
  setHttpMode,
  getHttpStats,
  resetHttpState,
  parseHttpMode,
  isReplayMiss,
  ReplayMissError,
  type HttpConfig,
} from './http/index.js';
