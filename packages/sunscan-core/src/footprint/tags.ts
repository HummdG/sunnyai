// OSM tag helpers for footprints (pure, browser-safe).

/** building=* values that are never dwellings: they neither create party walls nor change the built form. */
export const ANCILLARY_BUILDINGS: ReadonlySet<string> = new Set([
  'garage', 'garages', 'shed', 'carport', 'roof', 'hut', 'greenhouse', 'glasshouse', 'outbuilding', 'service', 'kiosk',
  'toilets', 'container', 'static_caravan', 'conservatory', 'cabin', 'boathouse', 'storage_tank', 'transformer_tower',
  'bunker', 'construction', 'ruins', 'barn', 'stable', 'cowshed', 'farm_auxiliary', 'shelter', 'bicycle_shelter',
  'allotment_house', 'tent', 'bridge', 'gatehouse', 'water_tower', 'silo', 'sty', 'pavilion',
]);

/** True when tags describe an ancillary structure (garage, shed, ...) or a building part rather than a building. */
export function isAncillaryTags(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const b = tags.building;
  if (!b || b === 'no') return !!tags['building:part'] && tags['building:part'] !== 'no';
  return ANCILLARY_BUILDINGS.has(b);
}

/**
 * Expands an addr:housenumber value into numbers: "48" -> [48]; "48-49" -> [48, 49]; "10;12" -> [10, 12];
 * "10A" -> [10]. Ranges longer than 50 numbers keep only their start.
 */
export function expandHouseNumbers(s?: string): number[] {
  if (!s) return [];
  const out = new Set<number>();
  for (const part of s.split(/[;,]/)) {
    const m = /^\s*(\d+)\s*[a-z]?\s*(?:[-–]\s*(\d+)\s*[a-z]?)?\s*$/i.exec(part);
    if (!m) continue;
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    if (b >= a && b - a <= 50) for (let i = a; i <= b; i++) out.add(i);
    else out.add(a);
  }
  return [...out];
}

/** Lower-case street name with apostrophes/punctuation removed and common abbreviations expanded. */
export function normaliseStreetName(s?: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\bst\b\.?/g, 'street').replace(/\brd\b\.?/g, 'road').replace(/\bave?\b\.?/g, 'avenue')
    .replace(/\bln\b\.?/g, 'lane').replace(/\bdr\b\.?/g, 'drive').replace(/\bcres\b\.?/g, 'crescent')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
