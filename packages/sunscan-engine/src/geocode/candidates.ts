// Geocoder hit classification + explainable evidence scoring (research 01 §2.5).
import type { GeocodeLevel } from '../contracts.js';
import type { ParsedAddressDetail } from './address.js';
import { haversineM, type NominatimResult, type PhotonFeature } from './clients.js';

/** Internal candidate (before merging strategies). */
export interface RawCandidate {
  source: string;
  lat: number;
  lon: number;
  osmRef?: string; // 'way/123'
  level: GeocodeLevel;
  label: string;
  houseNumber?: string;
  name?: string;
  street?: string;
  postcode?: string;
  osmClass?: string;
  match: { houseNumber: boolean; houseName: boolean; street: boolean; postcode: 'exact' | 'same-sector' | 'same-district' | 'different' | 'missing' };
  distanceToPostcodeM?: number;
  /** 1 = the input postcode is the nearest postcode centroid to this candidate (postcodes.io reverse). */
  postcodeRank?: number | null;
  score: number;
  reasons: string[];
}

const STOP = new Set(['the', 'house', 'museum', 's', 'of']);

/** Lower-case, apostrophe-free, abbreviation-expanded text. */
export const normText = (s?: string) =>
  (s ?? '').toLowerCase().replace(/[’']/g, '').replace(/\bst\b\.?/g, 'street').replace(/\brd\b\.?/g, 'road')
    .replace(/\bave?\b\.?/g, 'avenue').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const tokenSet = (s?: string) => new Set(normText(s).split(' ').filter((w) => w && !/^\d+[a-z]?$/.test(w) && !STOP.has(w)));

/**
 * Name similarity: token overlap >= 0.6 of the LARGER significant-token set (ignoring "house", "museum", "the", "s",
 * "of", numbers). "Jane Austen's House" ~ "Jane Austen's House Museum"; "Down House" !~ "2 Down House Cottage".
 */
export function nameSimilar(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return normText(a) === normText(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size) >= 0.6;
}

/** True when house number `want` is contained in `have` ("48" in "48-49", "10;12", "10A"). */
export function sameHouseNumber(want?: string, have?: string): boolean {
  if (!want || !have) return false;
  const w = want.toUpperCase().replace(/\s+/g, '');
  return have.toUpperCase().replace(/\s+/g, '').split(/[;,]/).some((x) => {
    if (x === w) return true;
    const m = /^(\d+)[A-Z]?[-–](\d+)[A-Z]?$/.exec(x);
    const v = parseInt(w, 10);
    return !!m && v >= +m[1] && v <= +m[2];
  });
}

/** Relation between the input postcode and a result postcode. */
export function postcodeRelation(input?: string, found?: string): RawCandidate['match']['postcode'] {
  if (!input || !found) return 'missing';
  const a = input.toUpperCase().replace(/\s+/g, '');
  const b = found.toUpperCase().replace(/\s+/g, '');
  if (a === b) return 'exact';
  if (a.slice(0, -2) === b.slice(0, -2)) return 'same-sector';
  if (a.slice(0, -3) === b.slice(0, -3)) return 'same-district';
  return 'different';
}

// Features that can carry a house-like name/address but are never the house itself
// (verified: "Carnegie Birthplace" is also the name of an amenity=parking way next to the museum).
const NON_HOUSE = /^(amenity\/(parking|parking_space|bicycle_parking|motorcycle_parking|parking_entrance|bench|waste_basket|grave_yard|bus_station|taxi)|highway\/|leisure\/(park|garden|pitch|playground|nature_reserve|common|recreation_ground)|landuse\/|natural\/|waterway\/|railway\/|boundary\/|public_transport\/|place\/(?!house$))/;

/** True for OSM classes ("key/value") that are never a dwelling. */
export const isNonHouse = (cls: string) => NON_HOUSE.test(cls);

function levelOfNominatim(r: NominatimResult): GeocodeLevel {
  if (!r.osm_type) return r.category === 'place' && r.type === 'postcode' ? 'postcode' : 'other';
  if (r.addresstype === 'postcode' || r.type === 'postcode') return 'postcode';
  if (r.place_rank >= 30 && !r.extratags?.building && isNonHouse(`${r.category}/${r.type}`)) return 'other';
  if (r.place_rank >= 30) {
    if (r.extratags?.building || r.category === 'building') return 'building';
    if (r.category === 'place' && r.type === 'house') return 'address-point';
    return r.address?.house_number ? 'address-point' : 'poi';
  }
  if (r.place_rank >= 26) return 'street';
  return 'locality';
}

/** Converts a Nominatim hit into a candidate (matches computed against the parsed input). */
export function fromNominatim(r: NominatimResult, source: string, p: ParsedAddressDetail): RawCandidate {
  const a = r.address ?? {};
  const nm = r.name || r.namedetails?.name;
  const road = a.road ?? a.pedestrian ?? a.footway;
  return {
    source,
    lat: +r.lat,
    lon: +r.lon,
    ...(r.osm_type && r.osm_id ? { osmRef: `${r.osm_type}/${r.osm_id}` } : {}),
    level: levelOfNominatim(r),
    label: r.display_name,
    houseNumber: a.house_number,
    name: nm,
    street: road,
    postcode: a.postcode,
    osmClass: `${r.category}/${r.type}`,
    match: {
      houseNumber: sameHouseNumber(p.houseNumber, a.house_number),
      houseName: !!p.houseName && (nameSimilar(p.houseName, nm) || Object.values(r.namedetails ?? {}).some((v) => nameSimilar(p.houseName, v)) || nameSimilar(p.houseName, a.house_name)),
      street: !!p.street && nameSimilar(p.street, road),
      postcode: postcodeRelation(p.postcode, a.postcode),
    },
    score: 0,
    reasons: [],
  };
}

/** Converts a Photon feature into a candidate. */
export function fromPhoton(f: PhotonFeature, source: string, p: ParsedAddressDetail): RawCandidate {
  const pr = f.properties;
  const t = pr.osm_type === 'N' ? 'node' : pr.osm_type === 'W' ? 'way' : pr.osm_type === 'R' ? 'relation' : undefined;
  const cls = `${pr.osm_key}/${pr.osm_value}`;
  const level: GeocodeLevel = isNonHouse(cls) && pr.osm_key !== 'building' ? 'other'
    : pr.type === 'house' ? (pr.osm_key === 'building' ? 'building' : pr.osm_key === 'place' ? 'address-point' : pr.housenumber ? 'address-point' : 'poi')
    : pr.type === 'street' ? 'street'
    : pr.osm_value === 'postcode' ? 'postcode' : 'locality';
  return {
    source,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    ...(t && pr.osm_id ? { osmRef: `${t}/${pr.osm_id}` } : {}),
    level,
    label: [pr.name, [pr.housenumber, pr.street].filter(Boolean).join(' '), pr.city ?? pr.locality ?? pr.district, pr.postcode].filter(Boolean).join(', '),
    houseNumber: pr.housenumber,
    name: pr.name,
    street: pr.street,
    postcode: pr.postcode,
    osmClass: cls,
    match: {
      houseNumber: sameHouseNumber(p.houseNumber, pr.housenumber),
      houseName: !!p.houseName && nameSimilar(p.houseName, pr.name),
      street: !!p.street && nameSimilar(p.street, pr.street ?? pr.name),
      postcode: postcodeRelation(p.postcode, pr.postcode),
    },
    score: 0,
    reasons: [],
  };
}

/** True for levels that can be the house itself. */
export const isHouseLevel = (l: GeocodeLevel) => l === 'building' || l === 'address-point' || l === 'poi';

/** Scores a candidate in place with the additive evidence table of research 01 §2.5 and returns it. */
export function scoreCandidate(c: RawCandidate, p: ParsedAddressDetail, centroid?: { lat: number; lon: number }): RawCandidate {
  const r: string[] = [];
  let s = 0;
  const house = isHouseLevel(c.level);
  if (house && p.houseNumber && c.match.houseNumber) (s += 45), r.push('house number matches');
  else if (house && p.houseNumber && c.houseNumber && !c.match.houseNumber) (s -= 40), r.push(`house number differs (${c.houseNumber})`);
  if (house && p.houseName && c.match.houseName) (s += 40), r.push('house/POI name matches');
  if (house && !p.houseNumber && !p.houseName) (s += 10), r.push('house-level object');
  if (c.match.street) (s += 10), r.push('street matches');
  else if (p.street && c.street) (s -= 10), r.push(`street differs (${c.street})`);
  if (c.level === 'building') (s += 10), r.push('result is the building polygon itself');
  if (c.level === 'street') (s -= 10), r.push('street-level only');
  if (c.level === 'postcode' || c.level === 'locality') (s -= 30), r.push(`${c.level}-level only`);
  if (c.level === 'other') (s -= 40), r.push(`non-house feature (${c.osmClass})`);
  if (c.match.postcode === 'exact') (s += 15), r.push('postcode equal');
  else if (c.match.postcode === 'same-sector') (s += 5), r.push('postcode same sector');
  else if (c.match.postcode === 'different') (s -= 10), r.push(`postcode differs (${c.postcode})`);
  if (centroid) {
    const d = haversineM(c, centroid);
    c.distanceToPostcodeM = Math.round(d);
    if (d <= 150) (s += 15), r.push(`<=150 m from postcode centroid (${Math.round(d)} m)`);
    else if (d <= 400) (s += 10), r.push(`<=400 m from postcode centroid (${Math.round(d)} m)`);
    else if (d <= 1500) r.push(`${Math.round(d)} m from postcode centroid`);
    else (s -= 30), r.push(`far from postcode centroid (${Math.round(d)} m)`);
  }
  if (c.postcodeRank != null && c.postcodeRank <= 3) (s += 10), r.push(`input postcode is #${c.postcodeRank} nearest to this point`);
  c.score = s;
  c.reasons = r;
  return c;
}
