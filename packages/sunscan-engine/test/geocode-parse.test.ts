import { describe, expect, it } from 'vitest';
import {
  expandStreetAbbrev, extractPostcode, isNonHouse, isPostcodePrefix, nameSimilar, nationFromCountry, nationFromPostcodeArea,
  normalisePostcode, parseUkAddress, parseUkAddressDetailed, photonUrl, postcodeRelation, sameHouseNumber, viewboxAround,
  nominatimSearchUrl,
} from '../src/geocode/index.js';

describe('UK postcodes', () => {
  it('normalises and validates postcodes', () => {
    expect(normalisePostcode('l257sa')).toBe('L25 7SA');
    expect(normalisePostcode('EC1A1BB')).toBe('EC1A 1BB');
    expect(normalisePostcode('W1A 0AX')).toBe('W1A 0AX');
    expect(normalisePostcode('GIR0AA')).toBe('GIR 0AA');
    expect(normalisePostcode('QA1 1AA')).toBeNull(); // Q never first
    expect(normalisePostcode('L25 7SC')).toBeNull(); // inward letters never C
    expect(normalisePostcode('hello')).toBeNull();
  });
  it('finds postcodes in free text, fixes the O->0 slip, detects trailing outward codes', () => {
    expect(extractPostcode('5 Cwmdonkin Drive, SA2 ORA').pc).toMatchObject({ postcode: 'SA2 0RA', corrected: 'inward "ORA" -> "0RA"', sector: 'SA2 0', area: 'SA' });
    expect(extractPostcode('48 Doughty St, London WC1N2LX')).toMatchObject({ pc: { postcode: 'WC1N 2LX' }, rest: '48 Doughty St, London' });
    expect(extractPostcode('251 Menlove Ave, Liverpool L25')).toMatchObject({ outwardOnly: 'L25', rest: '251 Menlove Ave, Liverpool' });
    expect(extractPostcode('WC1N 2')).toMatchObject({ outwardOnly: 'WC1N', rest: '' });
    expect(extractPostcode('Hill Top, Near Sawrey').pc).toBeUndefined();
  });
  it('recognises postcode prefixes for type-ahead', () => {
    for (const s of ['L25', 'WC1N 2', 'SA2 0R', 'l25 7sa', 'EC1A']) expect(isPostcodePrefix(s)).toBe(true);
    for (const s of ['251 Menl', 'Hill Top', 'Menlove', '12']) expect(isPostcodePrefix(s)).toBe(false);
  });
  it('derives nation hints from postcode areas and countries', () => {
    expect(nationFromPostcodeArea('BT')).toBe('Northern Ireland');
    expect(nationFromPostcodeArea('KY')).toBe('Scotland');
    expect(nationFromPostcodeArea('G')).toBe('Scotland');
    expect(nationFromPostcodeArea('SA')).toBe('Wales');
    expect(nationFromPostcodeArea('L')).toBe('England');
    expect(nationFromPostcodeArea('JE')).toBeUndefined();
    expect(nationFromCountry('Scotland')).toBe('Scotland');
    expect(nationFromCountry('Channel Islands')).toBeUndefined();
  });
});

describe('parseUkAddress', () => {
  it('parses the 9 test address formats', () => {
    expect(parseUkAddress('251 Menlove Avenue, Liverpool L25 7SA')).toEqual({
      raw: '251 Menlove Avenue, Liverpool L25 7SA', postcode: 'L25 7SA', outward: 'L25', houseNumber: '251', street: 'Menlove Avenue',
      localities: ['Liverpool'], nationHint: 'England',
    });
    expect(parseUkAddress("Jane Austen's House, Winchester Road, Chawton, Alton GU34 1SD")).toMatchObject({
      houseName: "Jane Austen's House", street: 'Winchester Road', localities: ['Chawton', 'Alton'], postcode: 'GU34 1SD',
    });
    expect(parseUkAddress('Hill Top, Near Sawrey, Ambleside LA22 0LF')).toMatchObject({ houseName: 'Hill Top', localities: ['Near Sawrey', 'Ambleside'] });
    expect(parseUkAddress('Andrew Carnegie Birthplace Museum, Moodie Street, Dunfermline KY12 7PL')).toMatchObject({
      houseName: 'Andrew Carnegie Birthplace Museum', street: 'Moodie Street', nationHint: 'Scotland',
    });
    expect(parseUkAddress('5 Cwmdonkin Drive, Swansea SA2 0RA')).toMatchObject({ houseNumber: '5', street: 'Cwmdonkin Drive', nationHint: 'Wales' });
  });
  it('handles sub-buildings, abbreviations, comma-less input and outward-only codes', () => {
    expect(parseUkAddress('Flat 2, 48 Doughty St, London WC1N2LX')).toMatchObject({ subBuilding: 'Flat 2', houseNumber: '48', street: 'Doughty Street', postcode: 'WC1N 2LX' });
    expect(parseUkAddress('2/1, 10 Moodie Street, Dunfermline').subBuilding).toBe('2/1');
    expect(parseUkAddress('Ground Floor Flat, 3 High St').subBuilding).toBe('Ground Floor Flat');
    expect(parseUkAddress('251 menlove avenue liverpool l257sa')).toMatchObject({ houseNumber: '251', street: 'Menlove Avenue', localities: ['Liverpool'], postcode: 'L25 7SA' });
    expect(parseUkAddress('10-12 Market Pl')).toMatchObject({ houseNumber: '10-12', street: 'Market Place' });
    expect(parseUkAddress('20 Forthlin Rd, L18 9TN')).toMatchObject({ street: 'Forthlin Road', postcode: 'L18 9TN', localities: [] });
    expect(parseUkAddressDetailed('l257sa').kind).toBe('postcode-only');
    expect(parseUkAddressDetailed('L25').kind).toBe('outward-only');
    expect(parseUkAddressDetailed('Down House, Downe').kind).toBe('name');
    expect(parseUkAddressDetailed('Heol y Coed, Cardiff').street).toBe('Heol Y Coed');
    expect(expandStreetAbbrev('Moodie St')).toBe('Moodie Street');
  });
});

describe('matching helpers and URLs', () => {
  it('compares names, numbers and postcodes like the research scoring', () => {
    expect(nameSimilar("Jane Austen's House", "Jane Austen's House Museum")).toBe(true);
    expect(nameSimilar('Down House', '2 Down House Cottage')).toBe(false);
    expect(nameSimilar('Menlove Avenue', 'Menlove Ave')).toBe(true);
    expect(sameHouseNumber('48', '48-49')).toBe(true);
    expect(sameHouseNumber('48', '10;48')).toBe(true);
    expect(sameHouseNumber('47', '48-49')).toBe(false);
    expect(postcodeRelation('L18 9TN', 'L18 9TL')).toBe('same-sector');
    expect(postcodeRelation('L18 9TN', 'L18 9TN')).toBe('exact');
    expect(postcodeRelation('L18 9TN', 'L25 7SA')).toBe('different');
    expect(isNonHouse('amenity/parking')).toBe(true);
    expect(isNonHouse('place/house')).toBe(false);
    expect(isNonHouse('tourism/museum')).toBe(false);
  });
  it('builds policy-compliant geocoder URLs', () => {
    const n = nominatimSearchUrl({ q: '251 Menlove Avenue' });
    expect(n).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?format=jsonv2/);
    expect(n).toContain('countrycodes=gb');
    expect(n).not.toMatch(/email/i);
    expect(photonUrl('251 Menl', { lat: 54, lon: -2.5, zoom: 5 })).toContain('bbox=-8.75%2C49.8%2C1.9%2C60.95');
    const [x1, y1, x2, y2] = viewboxAround(51.5, -0.1, 1500).split(',').map(Number);
    expect(y1 - y2).toBeCloseTo(3000 / 111_320, 4);
    expect(x2 - x1).toBeGreaterThan(y1 - y2);
  });
});
