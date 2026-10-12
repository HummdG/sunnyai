// UK geocoding chain (spec §5.1, research 01 §2.5):
//   parse -> postcodes.io -> Nominatim S1 free-form, S2 bounded (postcode +-1.5 km), S3 name-only bounded, S4 structured
//   -> Photon (typo-tolerant) -> postcode rank check -> merge strategies -> confidence high / medium / low.
// Production mode stops at the first strategy that yields a candidate scoring >= 70 (1 Nominatim call on the happy path).
import type { GeocodeCandidate, GeocodeResult } from '../contracts.js';
import { parseUkAddressDetailed, type ParsedAddressDetail } from './address.js';
import { fromNominatim, fromPhoton, isHouseLevel, scoreCandidate, type RawCandidate } from './candidates.js';
import { haversineM, nationFromCountry, nominatimSearch, photonSearch, postcodesIo, viewboxAround } from './clients.js';

/** Options of {@link geocodeUk}. */
export interface GeocodeOptions {
  /** Run every strategy (research/diagnostics) instead of stopping at the first strong hit. */
  exhaustive?: boolean;
  /** Check the rank of the input postcode among the nearest postcodes of the best candidates (default true). */
  postcodeRankCheck?: boolean;
}

const GOOD = 70;

interface PostcodeAnchor {
  centroid?: { lat: number; lon: number };
  info?: GeocodeResult['postcode'];
  notes: string[];
}

async function resolvePostcode(p: ParsedAddressDetail): Promise<PostcodeAnchor> {
  const notes: string[] = [];
  if (p.postcode) {
    const r = await postcodesIo.lookup(p.postcode);
    const res = r.status === 200 ? r.data?.result : undefined;
    if (res && res.latitude != null && res.longitude != null) {
      const nation = nationFromCountry(res.country);
      // NI eastings/northings are Irish Grid, not BNG: never expose them as BNG
      const en = nation !== 'Northern Ireland' && res.eastings != null && res.northings != null ? { eastings: res.eastings, northings: res.northings } : {};
      return {
        centroid: { lat: res.latitude, lon: res.longitude },
        info: { postcode: res.postcode, lat: res.latitude, lon: res.longitude, ...(nation ? { nation } : {}), ...en },
        notes,
      };
    }
    const t = await postcodesIo.terminated(p.postcode);
    const tr = t.status === 200 ? t.data?.result : undefined;
    if (tr && Number.isFinite(tr.latitude) && Number.isFinite(tr.longitude)) {
      notes.push(`postcode ${p.postcode} is terminated; using its last centroid`);
      return { centroid: { lat: tr.latitude, lon: tr.longitude }, info: { postcode: p.postcode, lat: tr.latitude, lon: tr.longitude }, notes };
    }
    notes.push(`postcode ${p.postcode} not found (typo?): ignored for validation`);
    return { notes };
  }
  if (p.outward) {
    const r = await postcodesIo.outcode(p.outward);
    const o = r.status === 200 ? r.data?.result : undefined;
    if (o && o.latitude != null && o.longitude != null) {
      notes.push(`outward code ${p.outward} only: district centroid used for biasing`);
      return { info: { postcode: p.outward, lat: o.latitude, lon: o.longitude, ...(nationFromCountry(o.country?.[0]) ? { nation: nationFromCountry(o.country?.[0]) } : {}) }, notes };
    }
  }
  return { notes };
}

function mergeCandidates(raw: RawCandidate[]): GeocodeCandidate[] {
  const byKey = new Map<string, RawCandidate[]>();
  for (const c of raw) {
    const k = c.osmRef ?? `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  const merged: GeocodeCandidate[] = [];
  for (const cs of byKey.values()) {
    const best = cs.slice().sort((a, b) => b.score - a.score)[0];
    const sources = [...new Set(cs.map((c) => c.source))];
    const agree = sources.length > 1 ? 5 : 0;
    merged.push({
      label: best.label,
      lat: best.lat,
      lon: best.lon,
      level: best.level,
      ...(best.osmRef ? { osmRef: best.osmRef } : {}),
      score: best.score + agree,
      reasons: agree ? [...best.reasons, `found by ${sources.length} strategies`] : best.reasons,
      sources,
    });
  }
  return merged.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/**
 * Geocodes a UK address to the most likely building-level OSM object with explainable evidence.
 * Low confidence falls back to the postcode centroid (the UI then asks the user to pick the building on the map).
 */
export async function geocodeUk(query: string, opts: GeocodeOptions = {}): Promise<GeocodeResult> {
  const p = parseUkAddressDetailed(query);
  const anchor = await resolvePostcode(p);
  const centroid = anchor.centroid;
  const raw: RawCandidate[] = [];
  const isGood = () => !opts.exhaustive && raw.some((c) => c.score >= GOOD);
  const addNominatim = async (source: string, params: Record<string, string | number | undefined>) => {
    const r = await nominatimSearch(params);
    for (const hit of Array.isArray(r.data) ? r.data : []) raw.push(scoreCandidate(fromNominatim(hit, source, p), p, centroid));
  };
  const pc = p.postcode;
  const numStreet = p.houseNumber && p.street ? `${p.houseNumber} ${p.street}` : p.street;
  const houseStr = p.houseNumber && p.street ? numStreet : p.houseName && p.street ? `${p.houseName}, ${p.street}` : (p.houseName ?? p.street);
  const freeForm = [p.houseName, numStreet, ...p.localities, pc].filter(Boolean).join(', ');
  const hasHouseTerms = p.kind !== 'postcode-only' && p.kind !== 'outward-only' && freeForm.length > 0;

  if (hasHouseTerms) await addNominatim('nominatim-free', { q: freeForm });
  // bounded to the postcode area, WITHOUT town names (post towns are often absent from OSM's admin hierarchy)
  if (hasHouseTerms && !isGood() && centroid && houseStr) {
    await addNominatim('nominatim-bounded', { q: houseStr, viewbox: viewboxAround(centroid.lat, centroid.lon, 1500), bounded: 1 });
  }
  // a partial POI/house name matches only without address terms ("Jane Austen's House" vs "... House Museum")
  if (hasHouseTerms && !isGood() && centroid && p.houseName && p.houseName !== houseStr) {
    await addNominatim('nominatim-name', { q: p.houseName, viewbox: viewboxAround(centroid.lat, centroid.lon, 1500), bounded: 1 });
  }
  if (hasHouseTerms && !isGood() && (p.street || p.houseName)) {
    await addNominatim('nominatim-structured', { street: numStreet, amenity: p.houseName, city: p.localities.at(-1), postalcode: pc });
  }
  if (hasHouseTerms && !isGood()) {
    const bias = centroid ?? (anchor.info ? { lat: anchor.info.lat, lon: anchor.info.lon } : undefined);
    const o = bias ? { lat: bias.lat, lon: bias.lon, zoom: 16 } : {};
    let r = await photonSearch(freeForm, o);
    // Photon is strict on postcode tokens: retry without the postcode when nothing matched
    if ((r.data?.features?.length ?? 0) === 0 && pc) r = await photonSearch([p.houseName, numStreet, ...p.localities].filter(Boolean).join(', '), o);
    for (const f of r.data?.features ?? []) {
      if ((f.properties.countrycode ?? 'GB').toUpperCase() === 'GB') raw.push(scoreCandidate(fromPhoton(f, 'photon', p), p, centroid));
    }
  }
  // postcode rank check: adapts to rural vs urban postcode sizes
  if (opts.postcodeRankCheck !== false && pc && centroid) {
    const top = raw.filter((c) => isHouseLevel(c.level)).sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    for (const c of top) {
      const k = `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const r = await postcodesIo.reverse(c.lat, c.lon, 2000, 10);
      const list = r.status === 200 ? (r.data?.result ?? []) : [];
      const idx = list.findIndex((x) => x.postcode.replace(/\s/g, '') === pc.replace(/\s/g, ''));
      for (const same of raw) if (`${same.lat.toFixed(6)},${same.lon.toFixed(6)}` === k) {
        same.postcodeRank = idx >= 0 ? idx + 1 : null;
        scoreCandidate(same, p, centroid);
      }
      if (seen.size >= 2) break;
    }
  }
  const candidates = mergeCandidates(raw);
  const result: GeocodeResult = { query, parsed: stripDetail(p), confidence: 'low', candidates, ...(anchor.info ? { postcode: anchor.info } : {}) };
  const best = candidates[0];
  if (best && best.score >= GOOD && best.level !== 'street' && best.level !== 'postcode') {
    const rival = candidates.find((c) => c !== best && c.score >= best.score - 10 && isHouseLevel(c.level) && haversineM(c, best) > 50);
    if (rival) best.reasons = [...best.reasons, `rival ${rival.osmRef ?? rival.label} (score ${rival.score}) > 50 m away`];
    result.best = best;
    result.confidence = rival ? 'medium' : 'high';
  } else if (best && best.score >= 40 && best.level !== 'postcode') {
    result.best = best;
    result.confidence = 'medium';
  } else if (anchor.info) {
    const fallback: GeocodeCandidate = {
      label: `${anchor.info.postcode} (postcode centroid)`, lat: anchor.info.lat, lon: anchor.info.lon, level: 'postcode', score: 0,
      reasons: ['no building-level match: postcode centroid, pick the building on the map', ...anchor.notes], sources: ['postcodes.io'],
    };
    result.best = fallback;
    result.candidates = [...candidates, fallback];
  } else if (best) {
    result.best = best;
  }
  return result;
}

function stripDetail(p: ParsedAddressDetail): GeocodeResult['parsed'] {
  const { postcodeInfo: _i, kind: _k, ...rest } = p;
  return rest;
}
