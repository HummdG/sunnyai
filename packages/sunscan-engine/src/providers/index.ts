// Live Providers implementation (contracts.ts): geocoding, buildings, elevation, OSTN15 and the optional Esri imagery
// tile proxy, all through the cached / recorded / replayed HTTP layer.
import type { Providers } from '../contracts.js';
import { fetchBuildings } from '../buildings/index.js';
import { getOstn15, getSurfaceRasters } from '../elevation/index.js';
import { geocodeUk, nationAt, suggestUk } from '../geocode/index.js';
import { fetchCached, getHttpMode, isReplayMiss, peekCached } from '../http/index.js';
import { ESRI_IMAGERY_ATTRIBUTION } from '../imagery/ortho.js';

/** Esri World Imagery tile endpoint (z/y/x). Live map layer only; never embedded in exports. */
export const ESRI_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
/** Attribution required whenever the Esri layer is shown. */
export const ESRI_ATTRIBUTION = ESRI_IMAGERY_ATTRIBUTION;
/** Highest zoom proxied. */
export const ESRI_MAX_ZOOM = 19;
const IMAGERY_TTL_SEC = 7 * 86_400;

/**
 * Esri World Imagery tile via the cache (provider 'esri', TTL 7 days); null for invalid coordinates, z > 19,
 * non-image answers, network failures, or missing fixtures in replay mode (the imagery layer is optional).
 */
export async function getImageryTile(z: number, x: number, y: number): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > ESRI_MAX_ZOOM) return null;
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return null;
  try {
    const req = { url: `${ESRI_IMAGERY_URL}/${z}/${y}/${x}`, provider: 'esri', ttlSec: IMAGERY_TTL_SEC, headers: { Accept: 'image/*' } };
    // optional layer: in replay mode an unrecorded tile is simply unavailable (no replay-miss noise)
    const res = getHttpMode() === 'replay' ? await peekCached(req) : await fetchCached(req);
    if (!res) return null;
    const contentType = res.headers['content-type'] ?? '';
    if (res.status !== 200 || !/^image\//i.test(contentType) || !res.body.byteLength) return null;
    return { body: res.body, contentType };
  } catch (e) {
    if (!isReplayMiss(e)) console.warn(`[imagery] tile ${z}/${x}/${y} unavailable: ${(e as Error).message}`);
    return null;
  }
}

/** Creates the live Providers (optionally overriding individual members, e.g. in tests). */
export function createProviders(overrides: Partial<Providers> = {}): Providers {
  return {
    geocodeUk: (q) => geocodeUk(q),
    suggestUk: (q) => suggestUk(q),
    nationAt: (lat, lon) => nationAt(lat, lon),
    fetchBuildings: (req) => fetchBuildings(req),
    getSurfaceRasters: (req) => getSurfaceRasters(req),
    getOstn15: () => getOstn15(),
    getImageryTile: (z, x, y) => getImageryTile(z, x, y),
    ...overrides,
  };
}
