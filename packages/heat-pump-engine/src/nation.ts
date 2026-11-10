import type { Nation } from './types.js';

const SCOTLAND = new Set([
  'AB',
  'DD',
  'DG',
  'EH',
  'FK',
  'G',
  'HS',
  'IV',
  'KA',
  'KW',
  'KY',
  'ML',
  'PA',
  'PH',
  'TD',
  'ZE',
]);
/**
 * DG and TD straddle England and Scotland. SY spans Shropshire and Powys, but
 * England and Wales are both in the grant, so SY reads as England.
 */
const BORDER = new Set(['DG', 'TD']);
/** The Isle of Man, Jersey and Guernsey: not in the UK grant schemes. */
const CROWN_DEPENDENCIES = new Set(['IM', 'JE', 'GY']);
const WALES = new Set(['CF', 'LD', 'LL', 'NP', 'SA']);

/** The postcode area: the leading letters of the outward code, or null if unparseable. */
export function postcodeArea(postcode: string): string | null {
  const m = /^\s*([A-Za-z]{1,2})\d/.exec(postcode);
  return m ? m[1]!.toUpperCase() : null;
}

export function nationOf(postcode: string): Nation {
  const area = postcodeArea(postcode);
  if (!area) return 'unknown';
  if (BORDER.has(area)) return 'border';
  if (SCOTLAND.has(area)) return 'scotland';
  if (area === 'BT') return 'northern_ireland';
  if (CROWN_DEPENDENCIES.has(area)) return 'crown_dependency';
  if (WALES.has(area)) return 'wales';
  return 'england';
}
