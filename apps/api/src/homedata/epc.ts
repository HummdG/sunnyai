/**
 * The home's energy certificate (EPC), read from the government's register of
 * energy performance data for England and Wales, as heat pump answers.
 *
 * A homeowner rarely knows whether their cavity walls were filled or how deep
 * the loft insulation is, but the home's EPC usually records both, with its
 * age, floor area, glazing and heating. When the home has no certificate, the
 * certificates of the homes around it (same postcode) stand in for the things
 * a street shares: when they were built and how they were built. What one
 * household chose (its heating, its hot water) is never taken from a neighbour.
 *
 * The register: https://get-energy-performance-data.communities.gov.uk
 * (bearer token from the service's account page, `EPC_API_TOKEN`). Certificate
 * JSON varies by schema (RdSAP 17 to 21, SAP), and a description is either a
 * string or `{ value, language }`; everything here reads both. The parsers are
 * pure so they can be tested against the register's published samples.
 *
 * Address lines from the register are licensed only for energy-efficiency
 * purposes: they are used to find this home's certificate and are never stored,
 * shown or passed on. Neighbours are counted, never named.
 */

import type { AgeBand, Emitters, Fuel, Glazing, Loft, Walls } from '@sunny/heat-pump-engine';

export const EPC_BASE = 'https://api.get-energy-performance-data.communities.gov.uk';

/** One row of a postcode search. */
export interface EpcSearchRow {
  certificateNumber: string;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  addressLine4: string | null;
  postcode: string | null;
  registrationDate: string | null;
  uprn: number | string | null;
}

/** A certificate as the register returns it (its schema decides the fields). */
export type EpcCertificate = Record<string, unknown>;

export interface EpcClient {
  /** The domestic certificates lodged for a postcode, newest and oldest alike. */
  search(postcode: string): Promise<EpcSearchRow[]>;
  /** One certificate by its number, or null when the register has none. */
  certificate(certificateNumber: string): Promise<EpcCertificate | null>;
}

const TIMEOUT_MS = 4000;

/** The register over HTTP. A 404 is "nothing lodged", not an error. */
export function httpEpcClient(
  token: string,
  fetchFn: typeof fetch = fetch,
  base: string = EPC_BASE,
): EpcClient {
  const get = async (path: string): Promise<unknown> => {
    const response = await fetchFn(`${base}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`EPC register answered ${response.status}`);
    return response.json();
  };
  return {
    async search(postcode) {
      const q = new URLSearchParams({ postcode: postcode.trim(), page_size: '200' });
      const body = (await get(`/api/domestic/search?${q}`)) as { data?: unknown } | null;
      return Array.isArray(body?.data) ? (body.data as EpcSearchRow[]) : [];
    },
    async certificate(certificateNumber) {
      const q = new URLSearchParams({ certificate_number: certificateNumber });
      const body = (await get(`/api/certificate?${q}`)) as { data?: unknown } | null;
      const data = body?.data;
      return data && typeof data === 'object' ? (data as EpcCertificate) : null;
    },
  };
}

// ── Reading a certificate ────────────────────────────────────────────────────

/** A description, whether the schema stores a string or `{ value, language }`. */
export function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = value.value;
    return typeof inner === 'string' ? inner.trim() || null : null;
  }
  return null;
}

/** The first element's description of a list field (walls, roofs, main heating). */
function firstDescription(cert: EpcCertificate, key: string): string | null {
  const list = cert[key];
  if (Array.isArray(list)) {
    for (const item of list) {
      const text = textOf((item as { description?: unknown } | null)?.description);
      if (text) return text;
    }
    return null;
  }
  return textOf((list as { description?: unknown } | null)?.description);
}

/** SAP's construction age bands (England and Wales), as their first year. */
const AGE_LETTER_FROM: Readonly<Record<string, number>> = {
  A: 1800,
  B: 1900,
  C: 1930,
  D: 1950,
  E: 1967,
  F: 1976,
  G: 1983,
  H: 1991,
  I: 1996,
  J: 2003,
  K: 2007,
  L: 2012,
  M: 2023,
};

/** A build year as the heat pump estimate's age band. */
export function ageBandOfYear(year: number): AgeBand {
  if (year < 1919) return 'pre_1919';
  if (year < 1945) return '1919_1944';
  if (year < 1965) return '1945_1964';
  if (year < 1983) return '1965_1982';
  if (year < 1996) return '1983_1995';
  if (year < 2007) return '1996_2006';
  return '2007_on';
}

/**
 * The age band: from the main building part's SAP letter, or a year written in
 * it ("England and Wales: 1950-1966"). A SAP certificate is a new build's, so
 * without a band its registration year stands in.
 */
export function ageBandOf(cert: EpcCertificate): AgeBand | null {
  const parts = Array.isArray(cert['sap_building_parts'])
    ? (cert['sap_building_parts'] as Array<Record<string, unknown>>)
    : [];
  const raw =
    textOf(parts[0]?.['construction_age_band']) ??
    textOf(cert['construction_age_band']) ??
    (typeof parts[0]?.['construction_year'] === 'number'
      ? String(parts[0]['construction_year'])
      : null);
  const schema = textOf(cert['schema_type']) ?? '';
  if (/^SAP/i.test(schema)) {
    const year = Number(textOf(cert['registration_date'])?.slice(0, 4));
    if (Number.isFinite(year) && year > 1990) return ageBandOfYear(year);
  }
  if (raw) {
    const letter = /^[A-M]$/i.exec(raw.trim());
    if (letter) return ageBandOfYear(AGE_LETTER_FROM[letter[0].toUpperCase()]!);
    const year = /\b(1[6-9]\d\d|20\d\d)\b/.exec(raw);
    if (year) return ageBandOfYear(Number(year[1]));
    if (/before 1900/i.test(raw)) return 'pre_1919';
  }
  return null;
}

/** The main walls, as the estimate's wall types. */
export function wallsOf(description: string | null): Walls | null {
  if (!description) return null;
  const d = description.toLowerCase();
  if (/thermal transmittance|timber frame|system built|park home/.test(d)) {
    return 'timber_or_modern';
  }
  const insulated = /filled cavity|insulated|with (internal|external) insulation/.test(d);
  const uninsulated = /no insulation|uninsulated|not insulated/.test(d);
  if (/cavity/.test(d)) {
    if (uninsulated) return 'cavity_unfilled';
    return insulated ? 'cavity_filled' : 'cavity_unfilled';
  }
  if (/solid brick|sandstone|limestone|granite|whinstone|cob|stone/.test(d)) {
    if (uninsulated) return 'solid_uninsulated';
    return insulated ? 'solid_insulated' : 'solid_uninsulated';
  }
  return null;
}

/** The loft, as none, some or good insulation. */
export function loftOf(description: string | null): Loft | null {
  if (!description) return null;
  const d = description.toLowerCase();
  // Another home above loses no heat through the roof.
  if (/another dwelling above|other premises above/.test(d)) return 'good';
  if (/thermal transmittance/.test(d)) return 'good';
  const mm = /(\d{2,3})\+?\s*mm/.exec(d);
  if (mm) {
    const depth = Number(mm[1]);
    if (depth < 50) return 'none';
    return depth >= 200 ? 'good' : 'some';
  }
  if (/no insulation|uninsulated/.test(d)) return 'none';
  if (/limited insulation/.test(d)) return 'some';
  if (/insulated/.test(d)) return 'good';
  return null;
}

/** The glazing. Partial double glazing reads as single: most of the heat goes through the rest. */
export function glazingOf(description: string | null): Glazing | null {
  if (!description) return null;
  const d = description.toLowerCase();
  if (/triple/.test(d)) return 'triple';
  if (/partial/.test(d)) return 'single';
  if (/double|secondary|multiple glazing|high performance/.test(d)) return 'double';
  if (/single/.test(d)) return 'single';
  return null;
}

/** How the home is heated, from the main heating's description. */
export function fuelOf(description: string | null): Fuel | null {
  if (!description) return null;
  const d = description.toLowerCase();
  if (/heat pump/.test(d)) return 'heat_pump';
  if (/storage heater/.test(d)) return 'electric_storage';
  if (/mains gas/.test(d)) return 'gas';
  if (/\blpg\b|bottled gas/.test(d)) return 'lpg';
  if (/\boil\b/.test(d)) return 'oil';
  if (/electric/.test(d)) return 'electric_direct';
  if (/coal|anthracite|wood|smokeless|biomass|dual fuel|community/.test(d)) return 'other';
  return null;
}

/** What heats the rooms. Storage and room heaters are swapped out, so they say nothing. */
export function emittersOf(description: string | null): Emitters | null {
  if (!description) return null;
  const d = description.toLowerCase();
  if (/underfloor/.test(d)) return 'underfloor';
  if (/radiators/.test(d)) return 'radiators_standard';
  return null;
}

/**
 * A hot water cylinder or a combi. RdSAP's cylinder size is 1 for none, 2 or
 * more for a cylinder; an immersion heater always heats a cylinder. Without
 * either, "from main system" could be both, so it says nothing.
 */
export function hotWaterOf(cert: EpcCertificate): 'cylinder' | 'combi' | null {
  const heating = (cert['sap_heating'] ?? null) as Record<string, unknown> | null;
  const size = Number(textOf(heating?.['cylinder_size']) ?? heating?.['cylinder_size']);
  const water = (
    textOf((cert['hot_water'] as { description?: unknown } | null)?.description) ?? ''
  ).toLowerCase();
  if (/immersion/.test(water)) return 'cylinder';
  if (Number.isFinite(size) && size >= 2) return 'cylinder';
  if (size === 1 && /main system/.test(water)) return 'combi';
  return null;
}

/** The kind of home, as Sunny's property type options. */
export function propertyTypeOf(dwelling: string | null): string | null {
  if (!dwelling) return null;
  const d = dwelling.toLowerCase();
  if (/flat|maisonette/.test(d)) return 'flat';
  if (/bungalow/.test(d)) return 'bungalow';
  if (/semi/.test(d)) return 'semi';
  if (/terrace/.test(d)) return 'terraced';
  if (/detached/.test(d)) return 'detached';
  if (/house|park home/.test(d)) return 'other';
  return null;
}

/** The fields a street shares: when and how its homes were built. */
export const SHARED_FIELDS = ['hp_age', 'hp_walls', 'hp_loft', 'hp_glazing'] as const;

/** Every heat pump answer one certificate gives, keyed by question id. */
export function answersFromCertificate(cert: EpcCertificate): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (id: string, value: string | null) => {
    if (value) out[id] = value;
  };
  put('property_type', propertyTypeOf(textOf(cert['dwelling_type'])));
  put('hp_age', ageBandOf(cert));
  const area = Number(textOf(cert['total_floor_area']) ?? cert['total_floor_area']);
  if (Number.isFinite(area) && area >= 20 && area <= 1000)
    out['hp_floor_area'] = String(Math.round(area));
  put('hp_walls', wallsOf(firstDescription(cert, 'walls')));
  put('hp_loft', loftOf(firstDescription(cert, 'roofs')));
  put(
    'hp_glazing',
    glazingOf(firstDescription(cert, 'window') ?? firstDescription(cert, 'windows')),
  );
  const heating = firstDescription(cert, 'main_heating');
  put('hp_current_heating', fuelOf(heating));
  put('hp_emitters', emittersOf(heating));
  put('hp_hot_water', hotWaterOf(cert));
  return out;
}

// ── Finding this home ────────────────────────────────────────────────────────

const STREET_WORDS: Readonly<Record<string, string>> = {
  rd: 'road',
  st: 'street',
  dr: 'drive',
  ave: 'avenue',
  av: 'avenue',
  ln: 'lane',
  cl: 'close',
  cres: 'crescent',
  ct: 'court',
  pl: 'place',
  gdns: 'gardens',
  tce: 'terrace',
  sq: 'square',
};

const POSTCODE_IN = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(POSTCODE_IN, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => STREET_WORDS[t] ?? t);
}

const isNumber = (t: string) => /^\d+[a-z]?$/.test(t);
const IGNORED = new Set(['flat', 'apartment', 'the', 'and', 'of', 'unit']);

/**
 * Whether a register row is the visitor's home. Numbered homes match on every
 * number (house and flat) and a shared street word; a named home matches on
 * its name. Anything less is someone else's home, and someone else's walls
 * are worse than a typical guess.
 */
export function isSameHome(row: EpcSearchRow, address: string): boolean {
  const lines = [row.addressLine1, row.addressLine2, row.addressLine3]
    .filter((l): l is string => typeof l === 'string')
    .join(' ');
  const rowTokens = tokens(lines);
  const visitor = tokens(address);
  if (rowTokens.length === 0 || visitor.length === 0) return false;
  const rowNumbers = rowTokens.filter(isNumber);
  const visitorNumbers = visitor.filter(isNumber);
  const words = (list: string[]) =>
    list.filter((t) => !isNumber(t) && t.length > 1 && !IGNORED.has(t));
  const visitorWords = new Set(words(visitor));
  const rowWords = words(rowTokens);
  if (rowNumbers.length > 0 || visitorNumbers.length > 0) {
    const same =
      rowNumbers.length === visitorNumbers.length &&
      rowNumbers.every((n) => visitorNumbers.includes(n));
    return same && rowWords.some((w) => visitorWords.has(w));
  }
  // A named home ("Rose Cottage, Mill Lane"): its first line's words, all of them.
  const name = words(tokens(row.addressLine1 ?? ''));
  return name.length >= 2 && name.every((w) => visitorWords.has(w));
}

function newestFirst(a: EpcSearchRow, b: EpcSearchRow): number {
  return (b.registrationDate ?? '').localeCompare(a.registrationDate ?? '');
}

/** One row per home (its newest certificate), so a home lodged three times counts once. */
function latestPerHome(rows: EpcSearchRow[]): EpcSearchRow[] {
  const seen = new Set<string>();
  const out: EpcSearchRow[] = [];
  for (const row of [...rows].sort(newestFirst)) {
    const key =
      row.uprn !== null && row.uprn !== undefined && String(row.uprn) !== ''
        ? `u${String(row.uprn)}`
        : `a${tokens([row.addressLine1, row.addressLine2].filter(Boolean).join(' ')).join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * The answer most of the neighbours share, field by field: at least two
 * certificates and at least half of those that say anything about it.
 */
export function sharedAnswers(
  certificates: readonly Record<string, string>[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of SHARED_FIELDS) {
    const counts = new Map<string, number>();
    let said = 0;
    for (const answers of certificates) {
      const value = answers[field];
      if (!value) continue;
      said++;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    if (best && n >= 2 && n * 2 >= said) out[field] = best;
  }
  return out;
}

export type EpcLookup =
  | { source: 'own'; answers: Record<string, string>; registrationDate: string | null }
  | { source: 'neighbours'; answers: Record<string, string>; homes: number }
  | { source: 'none' };

/** Neighbours read: enough to see a pattern, few enough to answer in a moment. */
const NEIGHBOURS_READ = 8;

/** The home's certificate, else what its neighbours share, else nothing. */
export async function lookUpEpc(
  client: EpcClient,
  address: string,
  postcode: string,
): Promise<EpcLookup> {
  const rows = latestPerHome(await client.search(postcode));
  const own = rows.find((row) => isSameHome(row, address));
  if (own) {
    const cert = await client.certificate(own.certificateNumber);
    const answers = cert ? answersFromCertificate(cert) : {};
    if (Object.keys(answers).length > 0) {
      return { source: 'own', answers, registrationDate: own.registrationDate ?? null };
    }
  }
  const neighbours = rows.filter((row) => row !== own).slice(0, NEIGHBOURS_READ);
  if (neighbours.length < 2) return { source: 'none' };
  const certs = await Promise.all(
    neighbours.map((row) => client.certificate(row.certificateNumber).catch(() => null)),
  );
  const read = certs.filter((c): c is EpcCertificate => c !== null).map(answersFromCertificate);
  const answers = sharedAnswers(read);
  return Object.keys(answers).length > 0
    ? { source: 'neighbours', answers, homes: read.length }
    : { source: 'none' };
}
