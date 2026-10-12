// createProviders(): the live Providers implementation wired to the HTTP layer, exercised in replay mode.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Providers } from '../src/contracts.js';
import { elevationBboxForBuildings } from '../src/elevation/index.js';
import { getHttpLog, resetHttpConfig, resetHttpState, setHttpMode } from '../src/http/index.js';
import { createProviders, ESRI_ATTRIBUTION, ESRI_MAX_ZOOM, getImageryTile } from '../src/providers/index.js';
import { EXPECTED, IMAGERY_TILE } from './support-data/expectations.js';

beforeAll(() => {
  resetHttpConfig();
  setHttpMode('replay');
  resetHttpState();
});
afterAll(() => resetHttpConfig());

describe('createProviders', () => {
  it('implements every member of the Providers contract', () => {
    const p = createProviders();
    const members: (keyof Providers)[] = ['geocodeUk', 'suggestUk', 'nationAt', 'fetchBuildings', 'getSurfaceRasters', 'getOstn15', 'getImageryTile'];
    for (const m of members) expect(typeof p[m]).toBe('function');
  });
  it('lets tests override individual providers', async () => {
    const p = createProviders({ nationAt: async () => 'Wales' });
    expect(await p.nationAt(53.4, -2.9)).toBe('Wales');
    expect(typeof p.geocodeUk).toBe('function');
  });
  it('runs geocode -> buildings -> OSTN15 -> LiDAR end to end on fixtures (Forthlin Road)', async () => {
    const p = createProviders();
    const g = await p.geocodeUk('20 Forthlin Road, Liverpool L18 9TN');
    expect(g.best?.osmRef).toBe(EXPECTED['uk-forthlin-road'].osmRef);
    const b = await p.fetchBuildings({ lat: g.best!.lat, lon: g.best!.lon, osmRef: g.best!.osmRef, parsed: g.parsed });
    expect(b.target).toBe('osm:way/516125064');
    const ostn = await p.getOstn15();
    const [e, n] = ostn.toBng(g.best!.lon, g.best!.lat);
    expect(e).toBeGreaterThan(340_000);
    expect(n).toBeGreaterThan(386_000);
    const back = ostn.toWgs84(e, n);
    expect(back[0]).toBeCloseTo(g.best!.lon, 8);
    const r = await p.getSurfaceRasters({ bbox: elevationBboxForBuildings(b, ostn), nation: g.postcode?.nation });
    expect(r.coverage).toBeGreaterThanOrEqual(0.95);
    expect(await p.nationAt(g.best!.lat, g.best!.lon)).toBe('England');
    expect((await p.suggestUk('WC1N 2'))[0].kind).toBe('postcode');
  });
});

describe('getImageryTile (Esri World Imagery proxy)', () => {
  it('returns the recorded JPEG tile', async () => {
    const t = await createProviders().getImageryTile!(IMAGERY_TILE.z, IMAGERY_TILE.x, IMAGERY_TILE.y);
    expect(t?.contentType).toMatch(/^image\//);
    expect(t!.body.byteLength).toBeGreaterThan(1000);
    expect([t!.body[0], t!.body[1]]).toEqual([0xff, 0xd8]); // JPEG SOI
    const log = getHttpLog().filter((x) => x.provider === 'esri');
    expect(log.at(-1)?.url).toBe(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${IMAGERY_TILE.z}/${IMAGERY_TILE.y}/${IMAGERY_TILE.x}`);
    expect(ESRI_ATTRIBUTION).toMatch(/Esri/);
  });
  it('rejects invalid tile coordinates and zooms beyond 19 without any request', async () => {
    resetHttpState();
    expect(await getImageryTile(ESRI_MAX_ZOOM + 1, 0, 0)).toBeNull();
    expect(await getImageryTile(3, 8, 0)).toBeNull();
    expect(await getImageryTile(3, -1, 0)).toBeNull();
    expect(await getImageryTile(3.5, 1, 1)).toBeNull();
    expect(getHttpLog()).toHaveLength(0);
  });
  it('degrades to null (optional layer) when a tile is unavailable', async () => {
    expect(await getImageryTile(19, 1, 1)).toBeNull(); // not recorded: replay miss -> null
  });
});
