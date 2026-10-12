// UK house-archetype helpers used when assembling a spec: construction era from OSM tags and storey counts from eave
// heights (priors from core/fit, docs/research/05 §5.1–5.4, §7.3). All derived values are labelled as estimates.
import type { BuiltForm, Era } from '@sunny/sunscan-core';
import { modalEra as coreModalEra, storeysFromEave } from '@sunny/sunscan-core/fit';

const ERA_BREAKS: [number, Era][] = [
  [1918, 'pre-1919'],
  [1944, '1919-1944'],
  [1964, '1945-1964'],
  [1980, '1965-1980'],
  [2000, '1981-2000'],
];

/** Era band of a construction year. */
export function eraOfYear(year: number): Era {
  for (const [last, era] of ERA_BREAKS) if (year <= last) return era;
  return 'post-2000';
}

/**
 * Parse an OSM date-like value into a representative year: '1928', '~1850', 'C18' (-> 1750), '18th century',
 * '1930s' (-> 1935), 'early 1900s', '1890..1900', 'before 1900'.
 */
export function parseYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  const century = /^c\s*(\d{1,2})$/.exec(s) ?? /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:c\b|cent)/.exec(s);
  if (century) {
    const c = Number(century[1]);
    if (c >= 10 && c <= 21) return (c - 1) * 100 + 50;
  }
  const m = /(\d{4})/.exec(s);
  if (m) {
    const y = Number(m[1]);
    if (y >= 1000 && y <= 2100) return /\d{4}s\b/.test(s) ? y + 5 : y;
  }
  return undefined;
}

/** Construction era from OSM tags (start_date, building:start_date, construction_date, building:age, ...). */
export function eraFromTags(tags: Record<string, string>): Era | undefined {
  for (const k of ['start_date', 'building:start_date', 'construction_date', 'building:age', 'year_of_construction', 'building:year']) {
    const y = parseYear(tags[k]);
    if (y !== undefined) return eraOfYear(y);
  }
  return undefined;
}

/** Modal construction era for a built form when nothing is known (core/fit priors). */
export function modalEra(form: BuiltForm | undefined, buildingTag?: string): Era {
  return coreModalEra(form ?? 'unknown', buildingTag === 'bungalow');
}

/**
 * Storey count from an eave height above ground (core/fit `storeysFromEave`, research 05 §7.3); OSM building:levels
 * wins when present and within ±1 of the measurement (or when there is no usable eave height).
 */
export function estimateStoreys(eave: number, era: Era, levelsTag?: number): number {
  const fromEave = storeysFromEave(eave, era);
  if (levelsTag !== undefined && Number.isFinite(levelsTag) && levelsTag >= 1) {
    const lv = Math.min(12, Math.round(levelsTag));
    if (!(eave > 0) || Math.abs(lv - fromEave) <= 1) return lv;
  }
  return fromEave;
}

/** Parse an OSM numeric tag like '2', '2.5', '7 m', '7m' (undefined when not numeric). */
export function numericTag(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(m|metres|meters)?\s*$/i.exec(v);
  return m ? Number(m[1]) : undefined;
}
