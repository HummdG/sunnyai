// Replay-mode tests on recorded fixtures (fixtures/http): no network access.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SLUGS } from './support/paths.js';
import { geocodeUk, nationAt, suggestUk } from '../src/geocode/index.js';
import { getHttpStats, resetHttpConfig, resetHttpState, setHttpMode } from '../src/http/index.js';
import { EXPECTED, GEOCODE_VARIANTS, loadTestAddresses, SUGGEST_PREFIXES } from './support-data/expectations.js';

beforeAll(() => {
  resetHttpConfig();
  setHttpMode('replay');
  resetHttpState();
});
afterAll(() => resetHttpConfig());

describe('geocodeUk (replay)', () => {
  const addresses = loadTestAddresses();
  it('covers the vendored test addresses', () => expect(addresses.map((a) => a.slug).sort()).toEqual([...SLUGS].sort()));
  for (const a of addresses) {
    it(`${a.slug}: geocodes to the research-verified OSM building with high confidence`, async () => {
      const exp = EXPECTED[a.slug];
      const g = await geocodeUk(a.query);
      expect(g.confidence).toBe('high');
      expect(g.best?.osmRef).toBe(exp.osmRef);
      expect(g.best?.level).toMatch(/building|poi|address-point/);
      expect(g.best!.score).toBeGreaterThanOrEqual(70);
      expect(g.best!.reasons.length).toBeGreaterThan(0);
      expect(g.postcode?.postcode.replace(/\s/g, '')).toBe(a.postcode.replace(/\s/g, ''));
      expect(g.postcode?.nation).toBe(exp.nation);
      expect(g.postcode?.eastings).toBeGreaterThan(0);
      expect(g.parsed.raw).toBe(a.query);
      expect(g.candidates[0]).toEqual(g.best);
    });
  }
  it("Jane Austen's House needs the name-only bounded strategy (free-form and bounded give nothing)", async () => {
    const g = await geocodeUk("Jane Austen's House, Winchester Road, Chawton, Alton GU34 1SD");
    expect(g.best?.sources).toContain('nominatim-name');
    expect(g.best?.reasons.join(' ')).toMatch(/name matches/);
  });
  it('the happy path costs one Nominatim request', async () => {
    resetHttpState();
    await geocodeUk('251 Menlove Avenue, Liverpool L25 7SA');
    expect(getHttpStats().nominatim.fixture).toBe(1);
  });
});

describe('geocodeUk input variants of research 01 §2.6 (replay)', () => {
  for (const [input, ref, confidence] of GEOCODE_VARIANTS) {
    it(`"${input}" -> ${confidence} ${ref ?? 'postcode centroid'}`, async () => {
      const g = await geocodeUk(input);
      expect(g.confidence).toBe(confidence);
      if (ref) expect(g.best?.osmRef).toBe(ref);
      else expect(g.best?.level).toBe('postcode');
    });
  }
  it('Northern Ireland postcodes never expose Irish Grid eastings/northings as BNG', async () => {
    const g = await geocodeUk('BT1 5GS');
    expect(g.postcode).toMatchObject({ postcode: 'BT1 5GS', nation: 'Northern Ireland' });
    expect(g.postcode?.eastings).toBeUndefined();
  });
  it('a non-house feature with the same name (car park) is penalised', async () => {
    const g = await geocodeUk('Carnegie Birthplace, Moodie St, Dunfermline');
    const parking = g.candidates.find((c) => c.reasons.some((r) => /non-house feature \(amenity\/parking\)/.test(r)));
    expect(parking).toBeDefined();
    expect(parking!.score).toBeLessThan(g.best!.score);
  });
  it('a valid but wrong postcode is flagged and lowers confidence', async () => {
    const g = await geocodeUk('20 Forthlin Road, Liverpool L25 7SA');
    expect(g.best?.reasons.join(' ')).toMatch(/postcode differs|far from postcode centroid|m from postcode centroid/);
  });
});

describe('suggestUk (replay)', () => {
  for (const [prefix, kind, fragment] of SUGGEST_PREFIXES) {
    it(`"${prefix}" -> ${kind} suggestions`, async () => {
      const s = await suggestUk(prefix);
      expect(s.length).toBeGreaterThan(0);
      expect(s[0].kind).toBe(kind);
      expect(s[0].label).toContain(fragment);
    });
  }
  it('the address suggestion carries the building reference and position', async () => {
    const [s] = await suggestUk('251 Menl');
    expect(s.osmRef).toBe('way/516128867');
    expect(s.lat).toBeCloseTo(53.3773, 3);
  });
  it('ignores inputs shorter than 3 characters without any request', async () => {
    expect(await suggestUk('L2')).toEqual([]);
  });
});

describe('nationAt (replay)', () => {
  for (const a of loadTestAddresses()) {
    it(`${a.slug}: ${EXPECTED[a.slug].nation}`, async () => {
      const g = await geocodeUk(a.query);
      expect(await nationAt(g.best!.lat, g.best!.lon)).toBe(EXPECTED[a.slug].nation);
    });
  }
});
