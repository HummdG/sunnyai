// Replay-mode tests of getSurfaceRasters on the recorded EA WCS / Welsh COG / SRSP S3 fixtures (no network).
import { pointInRing, type XY } from '@sunny/sunscan-core/geo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchBuildings } from '../src/buildings/index.js';
import type { Bbox27700, BuildingsResult, GeocodeResult, NoCoverage, SurfaceRasters } from '../src/contracts.js';
import { elevationBboxForBuildings, getOstn15, getSurfaceRasters, gridBounds } from '../src/elevation/index.js';
import { geocodeUk } from '../src/geocode/index.js';
import { getHttpStats, resetHttpConfig, resetHttpState, setHttpMode } from '../src/http/index.js';
import { EXPECTED, loadTestAddresses } from './support-data/expectations.js';

beforeAll(() => {
  resetHttpConfig();
  setHttpMode('replay');
  resetHttpState();
});
afterAll(() => resetHttpConfig());

async function scene(query: string): Promise<{ g: GeocodeResult; b: BuildingsResult; ring: XY[] }> {
  const g = await geocodeUk(query);
  const b = await fetchBuildings({ lat: g.best!.lat, lon: g.best!.lon, osmRef: g.best!.osmRef, parsed: g.parsed });
  const ostn = await getOstn15();
  const target = b.buildings.find((x) => x.ref === b.target)!;
  return { g, b, ring: target.outer.map(([lon, lat]) => ostn.toBng(lon, lat)) };
}

const isRasters = (r: SurfaceRasters | NoCoverage): r is SurfaceRasters => r.coverage > 0;

/** nDSM (DSM - DTM) values at pixel centres inside a BNG ring. */
function ndsmInside(r: SurfaceRasters, ring: XY[]): number[] {
  const out: number[] = [];
  const g = r.dsm;
  for (let row = 0; row < g.height; row++) {
    for (let col = 0; col < g.width; col++) {
      const p: XY = [g.originE + (col + 0.5) * g.res, g.originN - (row + 0.5) * g.res];
      if (!pointInRing(p, ring)) continue;
      const i = row * g.width + col;
      const v = g.data[i] - r.dtm.data[i];
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out.sort((a, b) => a - b);
}

describe('getSurfaceRasters (replay)', () => {
  for (const a of loadTestAddresses()) {
    const exp = EXPECTED[a.slug];
    it(`${a.slug}: ${exp.lidarSource} covers the target and its neighbours`, async () => {
      const { g, b, ring } = await scene(a.query);
      const bbox = elevationBboxForBuildings(b, await getOstn15());
      const r = await getSurfaceRasters({ bbox, nation: g.postcode?.nation });
      expect(isRasters(r)).toBe(true);
      if (!isRasters(r)) return;
      expect(r.source.id).toBe(exp.lidarSource);
      expect(r.coverage).toBeGreaterThanOrEqual(0.95);
      expect(r.dsm.res).toBe(exp.lidarRes);
      for (const grid of [r.dtm, ...(r.dsmLast ? [r.dsmLast] : [])]) {
        expect([grid.width, grid.height, grid.originE, grid.originN, grid.res]).toEqual([r.dsm.width, r.dsm.height, r.dsm.originE, r.dsm.originN, r.dsm.res]);
      }
      expect(r.dsm.data).toHaveLength(r.dsm.width * r.dsm.height);
      expect(r.dsm.width % 16).toBe(0);
      expect(r.dsm.height % 16).toBe(0);
      const gb = gridBounds(r.dsm);
      expect(gb.minE).toBeLessThanOrEqual(bbox.minE);
      expect(gb.minN).toBeLessThanOrEqual(bbox.minN);
      expect(gb.maxE).toBeGreaterThanOrEqual(bbox.maxE);
      expect(gb.maxN).toBeGreaterThanOrEqual(bbox.maxN);
      expect(Number.isInteger(gb.minE) && Number.isInteger(gb.maxN)).toBe(true);
      // the house is in the LiDAR: roof heights above ground inside the OSM footprint
      const ndsm = ndsmInside(r, ring);
      expect(ndsm.length).toBeGreaterThan(30 / (r.dsm.res * r.dsm.res));
      const median = ndsm[Math.floor(ndsm.length / 2)];
      expect(median).toBeGreaterThan(3);
      expect(median).toBeLessThan(20);
      // terrain heights in metres above ODN, plausible for the UK
      const dtm = [...r.dtm.data].filter(Number.isFinite);
      expect(Math.min(...dtm)).toBeGreaterThan(-5);
      expect(Math.max(...dtm)).toBeLessThan(400);
      expect(r.licence.id).toBe('OGL-UK-3.0');
      expect(r.licence.attribution.length).toBeGreaterThan(20);
      expect(r.source.retrievalUrls.length).toBeGreaterThan(0);
      expect(r.source.surveyDates?.length).toBeGreaterThan(0);
      expect(r.dsmLast !== undefined).toBe(exp.nation === 'England');
    });
  }
  it('serves any window inside the recorded area (e.g. the pipeline window: target bbox +- 14 m)', async () => {
    for (const a of loadTestAddresses()) {
      const { g, ring } = await scene(a.query);
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      const bbox: Bbox27700 = { minE: Math.floor(Math.min(...xs) - 14), minN: Math.floor(Math.min(...ys) - 14), maxE: Math.ceil(Math.max(...xs) + 14), maxN: Math.ceil(Math.max(...ys) + 14) };
      const r = await getSurfaceRasters({ bbox, nation: g.postcode?.nation });
      expect(r.coverage, a.slug).toBeGreaterThanOrEqual(0.95);
    }
  });
  it('EA survey vintage and last-return DSM (vegetation mask) for Mendips', async () => {
    const { g, b } = await scene('251 Menlove Avenue, Liverpool L25 7SA');
    const r = await getSurfaceRasters({ bbox: elevationBboxForBuildings(b, await getOstn15()), nation: g.postcode?.nation });
    expect(isRasters(r) && r.source.surveyDates).toEqual(['2019-02-11']);
    expect(isRasters(r) && r.source.retrievalUrls.every((u) => u.includes('geotiff:compression=DEFLATE'))).toBe(true);
    expect(getHttpStats()['ea-wcs'].replayMiss).toBe(0);
  });
});
