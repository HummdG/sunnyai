// Keyless geocoder clients (postcodes.io, Nominatim, Photon), all through fetchCached.
// Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/): max 1 req/s for the whole
// application (enforced by the HTTP layer), identifying User-Agent, results cached, attribution, NO autocomplete.
import type { Nation } from '@sunny/sunscan-core';
import { bodyJson, fetchCached, qs } from '../http/index.js';

/** Public Nominatim instance (OSMF usage policy applies). */
export const NOMINATIM = 'https://nominatim.openstreetmap.org';
/** postcodes.io API (keyless; GB data OGL, NI data ONSPD licence). */
export const POSTCODES_IO = 'https://api.postcodes.io';
/** Public Photon instance by komoot (fair use, no SLA). */
export const PHOTON = 'https://photon.komoot.io';

/** Great Britain + NI (+ margin), lon/lat. */
export const UK_BBOX = { minLon: -8.75, minLat: 49.8, maxLon: 1.9, maxLat: 60.95 };

/** Nominatim jsonv2 search/lookup result (subset). */
export interface NominatimResult {
  place_id: number;
  osm_type?: 'node' | 'way' | 'relation';
  osm_id?: number;
  lat: string;
  lon: string;
  category: string;
  type: string;
  place_rank: number;
  importance?: number;
  addresstype?: string;
  name?: string;
  display_name: string;
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
  namedetails?: Record<string, string> | null;
}

/** postcodes.io postcode record (subset). */
export interface PostcodesIoPostcode {
  postcode: string;
  quality?: number;
  eastings: number | null;
  northings: number | null;
  country: string;
  longitude: number | null;
  latitude: number | null;
  distance?: number;
  [k: string]: unknown;
}

/** Photon GeoJSON feature (subset). */
export interface PhotonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    osm_type?: 'N' | 'W' | 'R';
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    [k: string]: unknown;
  };
}

/** Result of a JSON API call: HTTP status + parsed body (null when the body is not JSON). */
export interface JsonResult<T> {
  status: number;
  data: T | null;
  url: string;
}

async function getJson<T>(provider: string, url: string): Promise<JsonResult<T>> {
  const res = await fetchCached({ url, provider, headers: { Accept: 'application/json' } });
  return { status: res.status, data: bodyJson<T>(res), url };
}

/** Maps postcodes.io `country` to a Nation (Channel Islands / Isle of Man -> undefined). */
export function nationFromCountry(country: string | undefined | null): Nation | undefined {
  switch ((country ?? '').trim().toLowerCase()) {
    case 'england': return 'England';
    case 'wales': return 'Wales';
    case 'scotland': return 'Scotland';
    case 'northern ireland': return 'Northern Ireland';
    default: return undefined;
  }
}

const enc = encodeURIComponent;
type PcResp<T> = { status: number; result?: T | null; error?: string };

/** postcodes.io endpoints used by the geocoder (GB data OGL; NI "BT" data ONSPD licence). */
export const postcodesIo = {
  /** `/postcodes/{pc}` (404 when unknown). */
  lookup: (pc: string) => getJson<PcResp<PostcodesIoPostcode>>('postcodes.io', `${POSTCODES_IO}/postcodes/${enc(pc)}`),
  /** `/terminated_postcodes/{pc}`: last known centroid of a terminated postcode. */
  terminated: (pc: string) =>
    getJson<PcResp<{ postcode: string; latitude: number; longitude: number }>>('postcodes.io', `${POSTCODES_IO}/terminated_postcodes/${enc(pc)}`),
  /** `/outcodes/{outcode}`: outward-code centroid. */
  outcode: (oc: string) =>
    getJson<PcResp<{ outcode: string; latitude: number | null; longitude: number | null; country?: string[] }>>('postcodes.io', `${POSTCODES_IO}/outcodes/${enc(oc)}`),
  /** Reverse geocode: nearest postcode centroids (radius clamped to 2000 m, limit to 100 by the API). */
  reverse: (lat: number, lon: number, radius = 2000, limit = 10, widesearch = false) =>
    getJson<PcResp<PostcodesIoPostcode[]>>('postcodes.io',
      `${POSTCODES_IO}/postcodes?${qs({ lon: lon.toFixed(6), lat: lat.toFixed(6), radius, limit, widesearch: widesearch ? 'true' : undefined })}`),
  /** Postcode type-ahead (`WC1N 2` -> `WC1N 2AA`, ...). */
  autocomplete: (partial: string, limit = 10) =>
    getJson<PcResp<string[]>>('postcodes.io', `${POSTCODES_IO}/postcodes/${enc(partial)}/autocomplete?limit=${limit}`),
};

const NOMINATIM_COMMON = { format: 'jsonv2', addressdetails: 1, extratags: 1, namedetails: 1, countrycodes: 'gb', 'accept-language': 'en-GB' };

/** Nominatim `/search` URL (free-form `q` or structured fields; never both). */
export function nominatimSearchUrl(params: Record<string, string | number | undefined>): string {
  return `${NOMINATIM}/search?${qs({ ...NOMINATIM_COMMON, limit: 5, ...params })}`;
}

/** Nominatim forward search (server-side only, cached, paced to <= 1 req/s by the HTTP layer). */
export function nominatimSearch(params: Record<string, string | number | undefined>): Promise<JsonResult<NominatimResult[]>> {
  return getJson<NominatimResult[]>('nominatim', nominatimSearchUrl(params));
}

/** Options of a Photon search. */
export interface PhotonOptions { lat?: number; lon?: number; zoom?: number; limit?: number; lang?: string; layers?: string[] }

/** Photon `/api` URL restricted to the UK bounding box (optionally location-biased). */
export function photonUrl(q: string, o: PhotonOptions = {}): string {
  const p = new URLSearchParams();
  p.set('q', q);
  p.set('limit', String(o.limit ?? 5));
  p.set('lang', o.lang ?? 'en');
  if (o.lat != null && o.lon != null) {
    p.set('lat', o.lat.toFixed(6));
    p.set('lon', o.lon.toFixed(6));
    if (o.zoom != null) p.set('zoom', String(o.zoom));
  }
  p.set('bbox', `${UK_BBOX.minLon},${UK_BBOX.minLat},${UK_BBOX.maxLon},${UK_BBOX.maxLat}`);
  for (const l of o.layers ?? []) p.append('layer', l);
  return `${PHOTON}/api?${p.toString()}`;
}

/** Photon search (typo-tolerant; fair-use public instance). */
export function photonSearch(q: string, o: PhotonOptions = {}): Promise<JsonResult<{ type: 'FeatureCollection'; features: PhotonFeature[] }>> {
  return getJson('photon', photonUrl(q, o));
}

/** Viewbox string `x1,y1,x2,y2` of +-halfM metres around a point (Nominatim bounded search). */
export function viewboxAround(lat: number, lon: number, halfM: number): string {
  const dLat = halfM / 111_320;
  const dLon = halfM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return `${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)},${(lat - dLat).toFixed(5)}`;
}

/** Haversine distance (m) on the mean sphere: coarse validation distances only, never geometry. */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371008.8;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
