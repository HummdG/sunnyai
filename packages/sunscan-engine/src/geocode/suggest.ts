// Type-ahead (postcodes.io autocomplete for postcode-like input, Photon UK-biased otherwise; never Nominatim:
// its usage policy forbids autocomplete) and nation lookup (postcodes.io reverse -> country).
import type { Nation } from '@sunny/sunscan-core';
import type { Suggestion } from '../contracts.js';
import { isPostcodePrefix, normalisePostcode } from './address.js';
import { nationFromCountry, photonSearch, postcodesIo, type PhotonFeature } from './clients.js';

/** Approximate centre of Great Britain, used to bias Photon towards UK results. */
const GB_CENTRE = { lat: 54.0, lon: -2.5 };

function photonKind(f: PhotonFeature): Suggestion['kind'] {
  const t = f.properties.type;
  if (f.properties.osm_value === 'postcode') return 'postcode';
  return t === 'house' || t === 'street' ? 'address' : 'place';
}

function photonLabel(f: PhotonFeature): string {
  const pr = f.properties;
  const line1 = [pr.housenumber, pr.street].filter(Boolean).join(' ');
  const parts = [pr.name && pr.name !== pr.street ? pr.name : undefined, line1 || undefined, pr.city ?? pr.locality ?? pr.district ?? pr.county, pr.postcode];
  return [...new Set(parts.filter((x): x is string => !!x))].join(', ');
}

/**
 * Suggestions for a partially typed UK address (>= 3 characters). Postcode-like input ("WC1N 2", "L25") uses
 * postcodes.io autocomplete; anything else uses Photon restricted to the UK. Results are de-duplicated by label.
 */
export async function suggestUk(q: string, limit = 8): Promise<Suggestion[]> {
  const text = q.replace(/\s+/g, ' ').trim();
  if (text.length < 3) return [];
  const out: Suggestion[] = [];
  if (isPostcodePrefix(text)) {
    const full = normalisePostcode(text);
    const r = await postcodesIo.autocomplete(full ?? text.toUpperCase(), limit);
    for (const pc of r.status === 200 ? (r.data?.result ?? []) : []) out.push({ label: pc, kind: 'postcode' });
    if (out.length) return out.slice(0, limit);
  }
  const r = await photonSearch(text, { lat: GB_CENTRE.lat, lon: GB_CENTRE.lon, zoom: 5, limit: Math.min(limit + 4, 15) });
  const seen = new Set<string>();
  for (const f of r.data?.features ?? []) {
    if ((f.properties.countrycode ?? '').toUpperCase() !== 'GB') continue;
    const label = photonLabel(f);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const t = f.properties.osm_type === 'N' ? 'node' : f.properties.osm_type === 'W' ? 'way' : f.properties.osm_type === 'R' ? 'relation' : undefined;
    out.push({
      label,
      kind: photonKind(f),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      ...(t && f.properties.osm_id ? { osmRef: `${t}/${f.properties.osm_id}` } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Nation containing a WGS84 point, from the nearest postcode centroid (postcodes.io reverse, 2 km, then the
 * 20 km wide search). The point is rounded to 0.001 deg (~100 m) so nearby lookups share one cached request.
 * Returns undefined offshore / outside the UK.
 */
export async function nationAt(lat: number, lon: number): Promise<Nation | undefined> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const rl = Math.round(lat * 1000) / 1000;
  const rn = Math.round(lon * 1000) / 1000;
  for (const wide of [false, true]) {
    const r = await postcodesIo.reverse(rl, rn, 2000, 1, wide);
    const hit = r.status === 200 ? r.data?.result?.[0] : undefined;
    if (hit) return nationFromCountry(hit.country);
  }
  return undefined;
}
