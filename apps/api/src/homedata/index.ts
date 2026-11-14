/**
 * What Sunny can find out about a home from its address, so the visitor is
 * only asked what a homeowner would know.
 *
 * - Solar: Google Solar's roof model (`solar.ts`): panel room, pitch, direction
 *   and shade-aware generation. Replaces the roof size and shading questions.
 * - Heat pump: the home's energy certificate, or its neighbours' (`epc.ts`):
 *   age, walls, loft, glazing, floor area, heating and hot water.
 *
 * Each source is on only when its key is set (`GOOGLE_MAPS_API_KEY`,
 * `EPC_API_TOKEN`). Without one, or when a lookup finds nothing, fails or is
 * slow, the quote falls back to typical values exactly as before: a lookup can
 * save the visitor questions, never cost them their quote.
 *
 * What is found is saved into the session's answers: question ids for the
 * answers it gives (so the flow skips them), and a `journey_` record of where
 * they came from, which the quote and the assistant read back.
 */

import { JOURNEY_KEYS, postcodeFrom } from '../journey/journey.js';

import { httpEpcClient, lookUpEpc, type EpcClient, type EpcLookup } from './epc.js';
import { httpSolarClient, lookUpGoogleRoof, type GoogleRoof, type SolarClient } from './solar.js';

export const HOME_KEYS = {
  /** Google's roof for the session's address (`GoogleRoof`, JSON). */
  solar: JOURNEY_KEYS.homeSolar,
  /** Where the heat pump answers came from (`EpcRecord`, JSON). */
  epc: JOURNEY_KEYS.homeEpc,
} as const;

export interface HomeData {
  epc: EpcClient | null;
  solar: SolarClient | null;
}

/** The sources this deployment has keys for, or null when it has none. */
export function homeDataFromEnv(env: NodeJS.ProcessEnv = process.env): HomeData | null {
  const token = env['EPC_API_TOKEN']?.trim();
  const key = env['GOOGLE_MAPS_API_KEY']?.trim();
  if (!token && !key) return null;
  return {
    epc: token ? httpEpcClient(token) : null,
    solar: key ? httpSolarClient(key) : null,
  };
}

/** The certificate record kept with the session: where the answers came from, never an address. */
export interface EpcRecord {
  source: EpcLookup['source'];
  /** The question ids the record answered, so a new address can take them back. */
  fields: string[];
  registrationDate?: string | null;
  homes?: number;
}

export function parseEpcRecord(raw: string | undefined): EpcRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<EpcRecord>;
    return value.source && Array.isArray(value.fields) ? (value as EpcRecord) : null;
  } catch {
    return null;
  }
}

/** One process's memory of recent lookups, so a page refresh is not another paid call. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, now: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now, value });
  return value;
}

/** For tests: forget every cached lookup. */
export function clearHomeDataCache(): void {
  cache.clear();
}

const normalised = (address: string) =>
  address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface HomeLookup {
  /** Answers to save (only ones the visitor has not given) and the source record. */
  patch: Record<string, string>;
  /** Answers an earlier address's lookup gave, to take back. */
  removed: string[];
  /** One plain sentence on what was found, for the assistant to say once. Null when nothing. */
  found: string | null;
}

const NOTHING: HomeLookup = { patch: {}, removed: [], found: null };

const WALLS_WORDS: Readonly<Record<string, string>> = {
  solid_uninsulated: 'solid walls without insulation',
  solid_insulated: 'insulated solid walls',
  cavity_unfilled: 'unfilled cavity walls',
  cavity_filled: 'filled cavity walls',
  timber_or_modern: 'modern or timber frame walls',
};
const LOFT_WORDS: Readonly<Record<string, string>> = {
  none: 'little or no loft insulation',
  some: 'some loft insulation',
  good: 'a well insulated loft',
};
const GLAZING_WORDS: Readonly<Record<string, string>> = {
  single: 'single glazing',
  double: 'double glazing',
  triple: 'triple glazing',
};

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What the certificate says about the fabric, in plain words. */
export function fabricWords(answers: Record<string, string>): string {
  return listOf(
    [
      WALLS_WORDS[answers['hp_walls'] ?? ''],
      LOFT_WORDS[answers['hp_loft'] ?? ''],
      GLAZING_WORDS[answers['hp_glazing'] ?? ''],
    ].filter((w): w is string => Boolean(w)),
  );
}

/** The sentence a heat pump visitor is told, once, about what the records said. */
export function epcSentence(record: EpcRecord, answers: Record<string, string>): string | null {
  const fabric = fabricWords(answers);
  if (record.source === 'own') {
    const year = record.registrationDate?.slice(0, 4);
    const lead = year ? `The home's ${year} energy certificate` : "The home's energy certificate";
    return fabric ? `${lead} shows ${fabric}.` : `${lead} filled in most of the details.`;
  }
  if (record.source === 'neighbours') {
    return fabric
      ? `There is no energy certificate for this home, so I used nearby homes' certificates, which show ${fabric}.`
      : null;
  }
  return null;
}

/** The estimate's note on where its home details came from, or null when nothing was found. */
export function epcAssumption(record: EpcRecord | null): string | null {
  if (!record || record.fields.length === 0) return null;
  if (record.source === 'own') {
    const year = record.registrationDate?.slice(0, 4);
    return `Home details are from the home's energy certificate${year ? ` (${year})` : ''}. Work done since then is checked at the survey.`;
  }
  if (record.source === 'neighbours') {
    return `This home has no energy certificate, so its age, walls, loft and glazing are estimated from ${record.homes ?? 'several'} nearby homes' certificates.`;
  }
  return null;
}

async function heatPumpLookup(
  epc: EpcClient,
  address: string,
  answers: Record<string, string>,
  now: number,
): Promise<HomeLookup> {
  const postcode = postcodeFrom(address);
  const previous = parseEpcRecord(answers[HOME_KEYS.epc]);
  // The earlier address's answers go; anything the visitor said themselves stays.
  const removed = previous?.fields ?? [];
  const kept = Object.fromEntries(Object.entries(answers).filter(([k]) => !removed.includes(k)));
  if (!postcode) return { ...NOTHING, removed };
  const found = await cached(`epc:${normalised(address)}`, now, () =>
    lookUpEpc(epc, address, postcode),
  );
  const fresh =
    found.source === 'none'
      ? {}
      : Object.fromEntries(Object.entries(found.answers).filter(([k]) => kept[k] === undefined));
  const record: EpcRecord = {
    source: found.source,
    fields: Object.keys(fresh),
    ...(found.source === 'own' ? { registrationDate: found.registrationDate } : {}),
    ...(found.source === 'neighbours' ? { homes: found.homes } : {}),
  };
  return {
    patch: { ...fresh, [HOME_KEYS.epc]: JSON.stringify(record) },
    removed: removed.filter((k) => !(k in fresh)),
    found: epcSentence(record, { ...kept, ...fresh }),
  };
}

async function solarLookup(solar: SolarClient, address: string, now: number): Promise<HomeLookup> {
  const roof = await cached<GoogleRoof | null>(`solar:${normalised(address)}`, now, () =>
    lookUpGoogleRoof(solar, address),
  );
  if (!roof) return { patch: {}, removed: [HOME_KEYS.solar], found: null };
  return {
    patch: { [HOME_KEYS.solar]: JSON.stringify(roof) },
    removed: [],
    found:
      roof.usablePanels > 0
        ? `Google's roof model shows room for about ${roof.usablePanels} panels on the sunnier faces, and it allows for shade.`
        : "Google's roof model shows no south, east or west facing roof space, so a specialist will need to look.",
  };
}

/**
 * Look the home up for a workflow that just took its address. Never throws:
 * a failed or slow source is logged and the visitor carries on as before.
 */
export async function lookUpHome(
  home: HomeData | null | undefined,
  engine: 'solar' | 'heat_pump' | 'battery',
  address: string,
  answers: Record<string, string>,
  opts: { now?: number; warn?: (object: object, message: string) => void } = {},
): Promise<HomeLookup> {
  const now = opts.now ?? Date.now();
  try {
    if (engine === 'heat_pump' && home?.epc)
      return await heatPumpLookup(home.epc, address, answers, now);
    if (engine === 'solar' && home?.solar) return await solarLookup(home.solar, address, now);
  } catch (error) {
    opts.warn?.({ err: error, engine }, 'home data lookup failed; carrying on without it');
  }
  return NOTHING;
}
