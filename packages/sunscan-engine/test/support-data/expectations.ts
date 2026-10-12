// Research-verified outcomes for the 9 public test addresses (docs/research/01 §2.6, §3.7; docs/research/02 §9).
import { readFileSync } from 'node:fs';
import { SLUGS } from '../support/paths.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuiltForm, Nation } from '@sunny/sunscan-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..', '..', '..');

/** fixtures/test-addresses.json entry (subset). */
export interface TestAddress { slug: string; query: string; postcode: string }

/** Expected outcome per test address. */
export interface Expectation { osmRef: string; builtForm: BuiltForm; nation: Nation; lidarSource: string; lidarRes: number }

export const EXPECTED: Record<string, Expectation> = {
  'uk-mendips': { osmRef: 'way/516128867', builtForm: 'semi-detached', nation: 'England', lidarSource: 'ea-lidar-composite-2022', lidarRes: 1 },
  'uk-forthlin-road': { osmRef: 'way/516125064', builtForm: 'mid-terrace', nation: 'England', lidarSource: 'ea-lidar-composite-2022', lidarRes: 1 },
  'uk-dickens-museum': { osmRef: 'way/805137285', builtForm: 'mid-terrace', nation: 'England', lidarSource: 'ea-lidar-composite-2022', lidarRes: 1 },
  'uk-jane-austen-house': { osmRef: 'way/293116440', builtForm: 'detached', nation: 'England', lidarSource: 'ea-lidar-composite-2022', lidarRes: 1 },
  'uk-shakespeare-birthplace': { osmRef: 'way/150342334', builtForm: 'detached', nation: 'England', lidarSource: 'ea-lidar-composite-2022', lidarRes: 1 },
  'uk-down-house': { osmRef: 'way/120876216', builtForm: 'detached', nation: 'England', lidarSource: 'ea-lidar-composite-2022', lidarRes: 1 },
  'uk-hill-top': { osmRef: 'way/164730604', builtForm: 'detached', nation: 'England', lidarSource: 'ea-lidar-composite-2022', lidarRes: 1 },
  'wales-dylan-thomas-birthplace': { osmRef: 'way/518358901', builtForm: 'semi-detached', nation: 'Wales', lidarSource: 'wg-lidar-2020-23', lidarRes: 1 },
  'scot-carnegie-birthplace': { osmRef: 'way/429457399', builtForm: 'detached', nation: 'Scotland', lidarSource: 'srsp-phase-5', lidarRes: 0.5 },
};

/** Type-ahead prefixes recorded for the suggest tests: [prefix, expected kind, expected label fragment]. */
export const SUGGEST_PREFIXES: [string, 'postcode' | 'address', string][] = [
  ['WC1N 2', 'postcode', 'WC1N 2'],
  ['251 Menl', 'address', 'Menlove Avenue'],
];

/**
 * Input variants of research 01 §2.6 (typos, missing punctuation, post towns, wrong/partial postcodes, NI):
 * [input, expected OSM building or null (postcode centroid), expected confidence].
 */
export const GEOCODE_VARIANTS: [string, string | null, 'high' | 'medium' | 'low'][] = [
  ['l257sa', null, 'low'],
  ['251 menlove avenue liverpool l257sa', 'way/516128867', 'high'],
  ['Flat 2, 48 Doughty Street, London WC1N 2LX', 'way/805137285', 'high'],
  ['Hill Top, Near Sawrey', 'way/164730604', 'medium'],
  ['Down House, Downe', 'way/120876216', 'medium'],
  ['WC1N 2LX', null, 'low'],
  ['48 Doughty Stret, London', 'way/805137285', 'medium'],
  ['48 Doughty Stret, London WC1N 2LX', 'way/805137285', 'high'],
  ['5 Cwmdonkin Drive, Abertawe SA2 ORA', 'way/518358901', 'high'],
  ['Carnegie Birthplace, Moodie St, Dunfermline', 'way/429457399', 'medium'],
  ['20 Forthlin Rd, L18 9TN', 'way/516125064', 'high'],
  ["Jane Austen's House, Chawton", 'way/293116440', 'medium'],
  ['Jane Austens House, Chawton GU34 1SD', 'way/293116440', 'high'],
  ['251 Menlove Ave, Liverpool L25', 'way/516128867', 'high'],
  ['Shakespeares Birthplace, Henley Street, Stratford upon Avon', 'way/150342334', 'medium'],
  ['20 Forthlin Road, Liverpool L25 7SA', 'way/516125064', 'medium'],
  ['BT1 5GS', null, 'low'],
];

/** Esri World Imagery tile recorded for the imagery-proxy test (z18 tile containing Mendips). */
export const IMAGERY_TILE = { z: 18, x: 128_973, y: 84_935 };

/**
 * The vendored test addresses: the entries of fixtures/sunscan/test-addresses.json whose replay fixtures Sunny carries
 * (see SLUGS in ../support/paths.ts); the other six stay in SunScanV2's own suite.
 */
export function loadTestAddresses(): TestAddress[] {
  const raw = JSON.parse(readFileSync(path.join(REPO, 'fixtures', 'sunscan', 'test-addresses.json'), 'utf8')) as TestAddress[];
  return raw
    .filter((a) => (SLUGS as readonly string[]).includes(a.slug))
    .map((a) => ({ slug: a.slug, query: a.query, postcode: a.postcode }));
}
