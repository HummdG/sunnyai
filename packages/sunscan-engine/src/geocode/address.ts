// UK postcode + free-text address parsing (heuristic, no external data). Port of research/footprints/src/uk-address.ts.
import type { Nation } from '@sunny/sunscan-core';
import type { ParsedUkAddress } from '../contracts.js';

// Outward formats A9, A99, AA9, AA99, A9A, AA9A; inward 9AA. Royal Mail / BS7666 letter restrictions:
// pos1 not Q V X; pos2 (letter) not I J Z; pos3 (A9A) in ABCDEFGHJKPSTUW; pos4 (AA9A) in ABEHMNPRVWXY;
// inward letters never C I K M O V. Special: GIR 0AA.
const OUTWARD = '(?:[A-PR-UWYZ][0-9][0-9]?|[A-PR-UWYZ][A-HK-Y][0-9][0-9]?|[A-PR-UWYZ][0-9][A-HJKPSTUW]|[A-PR-UWYZ][A-HK-Y][0-9][ABEHMNPRVWXY])';
const INWARD = '[0-9][ABD-HJLNP-UW-Z]{2}';
/** Strict full-postcode pattern ("L25 7SA", "EC1A 1BB", "GIR 0AA"; space optional). */
export const POSTCODE_RE = new RegExp(`^(?:GIR ?0AA|${OUTWARD} ?${INWARD})$`, 'i');
// tolerant finder: missing space and the common O->0 / I,L->1 slip in the inward digit
const FIND_RE = new RegExp(`(?:^|[^A-Z0-9])(${OUTWARD})\\s*([0-9OIL][ABD-HJLNP-UW-Z]{2})(?=$|[^A-Z0-9])`, 'i');
const OUTWARD_ONLY_RE = new RegExp(`(?:^|[\\s,])(${OUTWARD})\\s*$`, 'i');
const PREFIX_RE = new RegExp(`^(?:${OUTWARD})(?:\\s*[0-9][A-Z]{0,2})?$`, 'i');
const OUTWARD_FULL_RE = new RegExp(`^(${OUTWARD})(?:\\s+[0-9])?$`, 'i');

/** Postcode found in free text. */
export interface FoundPostcode {
  postcode: string; // normalised "AA9A 9AA"
  outward: string;
  inward: string;
  sector: string; // "WC1N 2"
  area: string; // letters of the outward code
  corrected?: string; // e.g. 'inward "ORA" -> "0RA"'
}

/** Detailed parse result (superset of the contract's ParsedUkAddress). */
export interface ParsedAddressDetail extends ParsedUkAddress {
  postcodeInfo?: FoundPostcode;
  kind: 'postcode-only' | 'outward-only' | 'number-street' | 'name' | 'name-street' | 'street-only' | 'freeform';
}

/** Normalises a postcode ("l257sa" -> "L25 7SA"); null when it is not a valid full postcode. */
export function normalisePostcode(s: string): string | null {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length < 5 || c.length > 7) return null;
  const pc = `${c.slice(0, -3)} ${c.slice(-3)}`;
  return POSTCODE_RE.test(pc) ? pc : null;
}

/** True for a (partial) postcode being typed: "L25", "WC1N 2", "SA2 0R". */
export function isPostcodePrefix(s: string): boolean {
  return PREFIX_RE.test(s.trim());
}

const SCOT = new Set(['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE']);
const WALES = new Set(['CF', 'LD', 'LL', 'NP', 'SA']);
const CROWN = new Set(['GY', 'JE', 'IM']);

/** Nation hint from a postcode area (letters). Only a hint: SY, CH, HR, LD, TD straddle borders; postcodes.io is authoritative. */
export function nationFromPostcodeArea(area: string): Nation | undefined {
  const a = area.toUpperCase();
  if (a === 'BT') return 'Northern Ireland';
  if (SCOT.has(a)) return 'Scotland';
  if (WALES.has(a)) return 'Wales';
  if (CROWN.has(a) || !/^[A-Z]{1,2}$/.test(a)) return undefined;
  return 'England';
}

/** Finds a full postcode anywhere in free text; returns it with the remaining text, or a trailing outward code. */
export function extractPostcode(text: string): { pc?: FoundPostcode; rest: string; outwardOnly?: string } {
  const up = text.toUpperCase();
  const m = FIND_RE.exec(up);
  if (m) {
    const outward = m[1].toUpperCase();
    let inward = m[2].toUpperCase();
    let corrected: string | undefined;
    if (/^[OIL]/.test(inward)) {
      const fixed = (inward[0] === 'O' ? '0' : '1') + inward.slice(1);
      corrected = `inward "${inward}" -> "${fixed}"`;
      inward = fixed;
    }
    const postcode = `${outward} ${inward}`;
    if (POSTCODE_RE.test(postcode)) {
      const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length))
        .replace(/\s*,\s*,/g, ',').replace(/[\s,]+$/, '').replace(/^[\s,]+/, '').trim();
      const area = outward.replace(/[0-9].*$/, '');
      return { pc: { postcode, outward, inward, sector: `${outward} ${inward[0]}`, area, ...(corrected ? { corrected } : {}) }, rest };
    }
  }
  const whole = OUTWARD_FULL_RE.exec(text.trim());
  if (whole) return { rest: '', outwardOnly: whole[1].toUpperCase() };
  const o = OUTWARD_ONLY_RE.exec(up);
  if (o && /\d/.test(o[1]) && !/^\d+$/.test(text.trim())) {
    // a trailing outward code as its own word ("..., Liverpool L25")
    return { rest: text.slice(0, o.index).replace(/[\s,]+$/, '').trim(), outwardOnly: o[1].toUpperCase() };
  }
  return { rest: text.trim() };
}

const STREET_SUFFIXES = new Set([
  'road', 'street', 'avenue', 'lane', 'drive', 'close', 'way', 'crescent', 'grove', 'place', 'terrace', 'gardens', 'court',
  'square', 'mews', 'row', 'walk', 'park', 'view', 'rise', 'hill', 'green', 'parade', 'gate', 'vale', 'end', 'wynd', 'brae',
  'loan', 'vennel', 'causeway', 'boulevard', 'broadway', 'circus', 'embankment', 'quay', 'wharf', 'yard', 'path', 'passage',
  'alley', 'approach', 'bank', 'bridge', 'chase', 'common', 'croft', 'dale', 'fold', 'garth', 'heights', 'meadow', 'meadows',
  'mount', 'orchard', 'paddock', 'pathway', 'promenade', 'reach', 'ride', 'ridge', 'side', 'spur', 'strand', 'turn', 'villas',
  'heol', 'ffordd', 'stryd', 'lon', 'rhodfa', 'cilgant',
]);
const ABBREV: Record<string, string> = {
  rd: 'Road', st: 'Street', ave: 'Avenue', av: 'Avenue', ln: 'Lane', dr: 'Drive', cl: 'Close', cres: 'Crescent', cresc: 'Crescent',
  gr: 'Grove', gro: 'Grove', pl: 'Place', tce: 'Terrace', terr: 'Terrace', gdns: 'Gardens', ct: 'Court', sq: 'Square',
  pde: 'Parade', wy: 'Way', hl: 'Hill', pk: 'Park',
};
const WELSH_LEAD = /^(heol|ffordd|stryd|lon|rhodfa)\s/i;
const SUB_BUILDING_RE =
  /^(?:(flat|apartment|apt|unit|suite|room|maisonette|studio|floor)\s*\.?\s*([0-9]+[a-z]?|[a-z]|[0-9]+\/[0-9]+)|(ground floor flat|first floor flat|basement flat|lower ground floor|ground floor|first floor|second floor|top floor|basement|garden flat|top flat)(?:\s+flat)?|([0-9]+\/[0-9]+)|([0-9]+f[0-9]+)|(\d+(?:st|nd|rd|th)\s+floor))\b[\s,]*/i;

/** Expands a trailing street-type abbreviation ("Doughty St" -> "Doughty Street"). */
export function expandStreetAbbrev(s: string): string {
  const words = s.trim().split(/\s+/);
  const last = words[words.length - 1].replace(/\.$/, '').toLowerCase();
  if (words.length > 1 && ABBREV[last]) words[words.length - 1] = ABBREV[last];
  return words.join(' ');
}

const titleCase = (s: string) => s.replace(/\b([a-z])([a-z']*)/gi, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
const isSuffix = (w: string) => {
  const x = w.replace(/\.$/, '').toLowerCase();
  return STREET_SUFFIXES.has(x) || ABBREV[x] != null;
};
const looksLikeStreet = (s: string) => {
  const w = s.trim().split(/\s+/);
  return (w.length >= 2 && isSuffix(w[w.length - 1])) || WELSH_LEAD.test(s.trim());
};

/** Detailed parse of a UK address line (postcode with O->0 fix, sub-building, number/name, street, localities). */
export function parseUkAddressDetailed(input: string): ParsedAddressDetail {
  const clean = input.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  const { pc, rest, outwardOnly } = extractPostcode(clean);
  let parts = rest.split(',').map((s) => s.trim()).filter(Boolean);
  const out: ParsedAddressDetail = { raw: input, localities: [], kind: 'freeform' };
  if (pc) {
    out.postcode = pc.postcode;
    out.outward = pc.outward;
    out.postcodeInfo = pc;
    out.nationHint = nationFromPostcodeArea(pc.area);
  } else if (outwardOnly) {
    out.outward = outwardOnly;
    out.nationHint = nationFromPostcodeArea(outwardOnly.replace(/[0-9].*$/, ''));
  }
  if (!parts.length) {
    out.kind = pc ? 'postcode-only' : outwardOnly ? 'outward-only' : 'freeform';
    return out;
  }
  const sb = SUB_BUILDING_RE.exec(parts[0]);
  if (sb && sb[0].trim()) {
    out.subBuilding = titleCase(sb[0].replace(/[\s,]+$/, ''));
    parts[0] = parts[0].slice(sb[0].length).trim();
    if (!parts[0]) parts.shift();
  }
  const num = /^(\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?)\s*,?\s+(.+)$/i.exec(parts[0] ?? '');
  if (num) {
    out.houseNumber = num[1].replace(/\s+/g, '').replace('–', '-').toUpperCase();
    out.street = titleCase(expandStreetAbbrev(num[2]));
    parts = parts.slice(1);
  } else if (/^\d+[a-z]?$/i.test(parts[0] ?? '') && parts[1]) {
    out.houseNumber = parts[0].toUpperCase();
    out.street = titleCase(expandStreetAbbrev(parts[1]));
    parts = parts.slice(2);
  } else if (parts[0] && !looksLikeStreet(parts[0])) {
    out.houseName = parts[0];
    parts = parts.slice(1);
    if (parts[0] && looksLikeStreet(parts[0])) {
      out.street = titleCase(expandStreetAbbrev(parts[0]));
      parts = parts.slice(1);
    } else if (parts[0]) {
      const n2 = /^(\d+[a-z]?)\s+(.+)$/i.exec(parts[0]);
      if (n2) {
        out.houseNumber = n2[1].toUpperCase();
        out.street = titleCase(expandStreetAbbrev(n2[2]));
        parts = parts.slice(1);
      }
    }
  } else if (parts[0]) {
    out.street = titleCase(expandStreetAbbrev(parts[0]));
    parts = parts.slice(1);
  }
  // comma-less input: "menlove avenue liverpool" -> street "Menlove Avenue", locality "Liverpool"
  if (out.street) {
    const w = out.street.split(/\s+/);
    let cut = -1;
    for (let i = 1; i < w.length - 1; i++) if (isSuffix(w[i])) cut = i;
    if (cut > 0) {
      out.street = titleCase(expandStreetAbbrev(w.slice(0, cut + 1).join(' ')));
      parts = [titleCase(w.slice(cut + 1).join(' ')), ...parts];
    }
  }
  out.localities = parts;
  out.kind = out.houseNumber && out.street ? 'number-street'
    : out.houseName && out.street ? 'name-street'
    : out.houseName ? 'name'
    : out.street ? 'street-only' : 'freeform';
  return out;
}

/** Parses a UK address line into the contract shape (spec §5.1). */
export function parseUkAddress(input: string): ParsedUkAddress {
  const d = parseUkAddressDetailed(input);
  const out: ParsedUkAddress = { raw: d.raw, localities: d.localities };
  for (const k of ['postcode', 'outward', 'subBuilding', 'houseNumber', 'houseName', 'street', 'nationHint'] as const) {
    if (d[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = d[k];
  }
  return out;
}
