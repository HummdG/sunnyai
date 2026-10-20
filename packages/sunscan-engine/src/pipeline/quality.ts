// Quality report (confidence levels, machine-readable flags, human-readable notes) and provenance/licences.
import type { Confidence, FitReport, Nation, QualityReport, SourceRecord } from '@sunny/sunscan-core';
import type { GeocodeResult, SurfaceRasters } from '../contracts.js';
import { ATTRIBUTION, DEFAULTS } from './constants.js';

/** Facts gathered by the pipeline that drive the quality report. */
export interface QualityFacts {
  geocode?: GeocodeResult;
  /** The user picked or drew the building (not the geocoder's choice). */
  manualTarget: boolean;
  targetSource: 'osm' | 'overture' | 'drawn';
  targetAmbiguous: boolean;
  terraceBlock: boolean;
  nation?: Nation;
  lidar: { status: 'fitted' | 'no-coverage' | 'unavailable' | 'fit-error'; reason?: string; rasters?: SurfaceRasters };
  /** The LoD2 fit was used for the parts (reliable and plausible). */
  fitUsed: boolean;
  /** LoD1.3 blocks at robust LiDAR heights were used. */
  blocksUsed?: boolean;
  fit?: FitReport;
  priorsUsed: boolean;
  /** Where the priors' heights were scaled from. */
  priorHeightHint?: 'lidar' | 'osm-tags';
  roofTagged: boolean;
  heritage: boolean;
  frontMethod?: 'entrance' | 'road' | 'nearest-road' | 'longest-edge';
  registrationShift?: number;
  surveyAgeYears?: number;
  extraFlags: string[];
  extraNotes: string[];
}

const NOTES: Record<string, string> = {
  'lidar-unavailable': 'No open LiDAR for this location, so heights and roof are estimates from UK house-type priors.',
  'fit-unreliable': 'The LiDAR roof fit is unreliable (complex or heritage roof outside the model library, or a footprint mismatch), so the roof shown is an approximation.',
  'fit-failed': 'The LiDAR roof fit failed, so the roof shown is an estimate.',
  'registration-ambiguous': 'Footprint ↔ LiDAR alignment is ambiguous (typical of terraces), so only the well-constrained shift was applied.',
  'registration-large-shift': 'The OSM outline needed a large shift (> 3 m) to match the LiDAR. Please check the outline.',
  'terrace-block': 'The OSM outline covers several dwellings (a terrace row or a block of flats); it is modelled as one block.',
  'footprint-from-overture': 'Footprint from Overture Maps (OSM had no outline here).',
  'footprint-user-drawn': 'Footprint drawn by the user.',
  'target-ambiguous': 'Several buildings matched the address. Please confirm the building on the map.',
  'survey-old': 'The LiDAR survey is several years old, so recent extensions may be missing.',
  'heritage-building': 'Listed / heritage building: roofs of this kind are often outside the model library.',
  'front-edge-guessed': 'No street or entrance data: the front of the house was guessed.',
  'lidar-partial-coverage': 'LiDAR covers only part of the area around the house.',
};

/** True for OSM tags that mark a heritage / listed / historic building. */
export function isHeritage(tags: Record<string, string>): boolean {
  return !!(tags.heritage || tags['listed_status'] || tags['HE_ref'] || tags['historic'] || tags['heritage:operator'] || tags['ref:GB:nhle'] || tags['ref:GB:hb']);
}

/** Survey age in years (newest survey date) or undefined. */
export function surveyAgeYears(rasters: SurfaceRasters | undefined, now: Date): number | undefined {
  const dates = (rasters?.source.surveyDates ?? []).map((d) => Date.parse(d)).filter(Number.isFinite);
  if (!dates.length) return undefined;
  return (now.getTime() - Math.max(...dates)) / (365.25 * 24 * 3600 * 1000);
}

/** Build the QualityReport (confidence per aspect + flags + notes). */
export function buildQuality(f: QualityFacts): QualityReport {
  const flags = new Set<string>(f.extraFlags);
  const notes: string[] = [];
  const lidarMissing = f.lidar.status === 'no-coverage' || f.lidar.status === 'unavailable';
  if (lidarMissing) flags.add('lidar-unavailable');
  if (f.lidar.status === 'fit-error') flags.add('fit-failed');
  if (f.fit?.unreliable || (f.lidar.status === 'fitted' && !f.fitUsed)) flags.add('fit-unreliable');
  const regFlag = f.fit?.registration.flag;
  if (regFlag) flags.add('registration-ambiguous');
  if ((f.registrationShift ?? 0) > DEFAULTS.largeShift) flags.add('registration-large-shift');
  if (f.terraceBlock) flags.add('terrace-block');
  if (f.targetSource === 'overture') flags.add('footprint-from-overture');
  if (f.targetSource === 'drawn') flags.add('footprint-user-drawn');
  if (f.targetAmbiguous) flags.add('target-ambiguous');
  if (f.heritage) flags.add('heritage-building');
  if (f.frontMethod === 'longest-edge') flags.add('front-edge-guessed');
  if (f.surveyAgeYears !== undefined && f.surveyAgeYears > DEFAULTS.surveyOldYears) flags.add('survey-old');
  if (f.lidar.rasters && f.lidar.rasters.coverage < 0.95) flags.add('lidar-partial-coverage');
  for (const fl of flags) if (NOTES[fl]) notes.push(NOTES[fl]);
  if (lidarMissing && f.nation === 'Northern Ireland') notes.push('Northern Ireland has no inland open LiDAR.');
  if (f.lidar.status === 'no-coverage' && f.lidar.reason && f.nation !== 'Northern Ireland') notes.push(`Elevation: ${f.lidar.reason}.`);
  if (f.fit && f.fit.unreliable && Number.isFinite(f.fit.sigma)) notes.push(`Fit residual scale σ* = ${f.fit.sigma.toFixed(2)} m (reliable below 0.5 m).`);
  notes.push(...f.extraNotes);

  const geocode: QualityReport['geocode'] = f.manualTarget || !f.geocode ? 'manual' : f.geocode.confidence;
  let footprint: Confidence =
    f.targetSource === 'drawn' ? 'low' : f.targetSource === 'overture' ? 'medium' : f.fit && !regFlag && f.lidar.status === 'fitted' ? 'high' : 'medium';
  if (f.terraceBlock) footprint = 'low';
  let heights: Confidence;
  let roof: Confidence;
  if (f.fitUsed && f.fit && !f.fit.unreliable) {
    heights = 'measured';
    roof = f.fit.pModel >= 0.95 ? 'high' : f.fit.pModel >= 0.8 ? 'medium' : 'low';
  } else if (f.blocksUsed) {
    heights = 'medium';
    roof = 'low';
  } else {
    heights = f.priorHeightHint === 'lidar' ? 'medium' : f.priorHeightHint === 'osm-tags' ? 'low' : 'estimated';
    roof = f.roofTagged ? 'low' : 'estimated';
  }
  return { geocode, footprint, heights, roof, openings: 'procedural', interior: 'procedural', flags: [...flags], notes };
}

/** Facts for the provenance list. */
export interface ProvenanceFacts {
  usedOsm: boolean;
  usedOverture: boolean;
  overtureRelease?: string;
  osmBase?: string;
  geocode?: GeocodeResult;
  rasters?: SurfaceRasters;
  priorsUsed: boolean;
}

/** Sources and licences embedded in the spec (spec §10). */
export function buildProvenance(p: ProvenanceFacts): SourceRecord[] {
  const out: SourceRecord[] = [];
  if (p.usedOsm || p.geocode)
    out.push({ id: 'osm', title: 'OpenStreetMap', licence: 'ODbL-1.0', attribution: ATTRIBUTION.osm, url: 'https://www.openstreetmap.org/copyright', ...(p.osmBase ? { date: p.osmBase } : {}) });
  if (p.usedOverture)
    out.push({ id: 'overture-buildings', title: 'Overture Maps buildings', licence: 'ODbL-1.0', attribution: ATTRIBUTION.overture, url: 'https://overturemaps.org', ...(p.overtureRelease ? { date: p.overtureRelease } : {}) });
  if (p.geocode?.postcode)
    out.push({ id: 'postcodes.io', title: 'postcodes.io (ONS Postcode Directory)', licence: 'OGL-UK-3.0', attribution: ATTRIBUTION.postcodes, url: 'https://postcodes.io' });
  if (p.geocode?.best) {
    const s = p.geocode.best.sources.join(' ');
    if (/nominatim/i.test(s)) out.push({ id: 'nominatim', title: 'Nominatim geocoder (OpenStreetMap data)', licence: 'ODbL-1.0', attribution: ATTRIBUTION.osm, url: 'https://nominatim.org' });
    if (/photon/i.test(s)) out.push({ id: 'photon', title: 'Photon geocoder by komoot (OpenStreetMap data)', licence: 'ODbL-1.0', attribution: ATTRIBUTION.osm, url: 'https://photon.komoot.io' });
  }
  if (p.rasters) {
    const dates = p.rasters.source.surveyDates ?? [];
    out.push({
      id: p.rasters.source.id,
      title: p.rasters.source.title,
      licence: p.rasters.licence.id,
      attribution: p.rasters.licence.attribution,
      ...(p.rasters.source.retrievalUrls[0] ? { url: p.rasters.source.retrievalUrls[0] } : {}),
      ...(dates.length ? { date: dates.length > 1 ? `${dates[0]}..${dates[dates.length - 1]}` : dates[0] } : {}),
    });
  }
  if (p.priorsUsed)
    out.push({ id: 'sunscan-uk-priors', title: 'SunScan UK house-type priors (EHS, RdSAP, BS 5534; estimates)', licence: 'n/a', attribution: 'Estimated values, not measured' });
  return out;
}
