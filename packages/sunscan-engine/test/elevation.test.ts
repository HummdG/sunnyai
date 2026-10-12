import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dtmKeyFor, eaGetCoverageUrl, EA_LAYERS, emptyGrid, getOstn15, getSurfaceRasters, imageGeoref, osGridLetters, OSTN15_DIR, parseEaTiff,
  parseS3List, pasteInto, providerOrder, readRemoteWindow, RemoteFileError, snapWindow, srspTileStem, srspTileStems, SRSP_DATASETS,
  tilesCovering, validFraction, walesDate, type GeoRaster,
} from '../src/elevation/index.js';
import { configureHttp, getHttpLog, HOST_LIMITS, resetHttpConfig, resetHttpState, setHttpMode } from '../src/http/index.js';
import { REPO } from './support-data/expectations.js';
import { startLocalServer } from './support-data/local-server.js';

const csv = async (f: string) => (await readFile(path.join(OSTN15_DIR, f), 'utf8')).trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe('OSTN15 (official Ordnance Survey test vectors)', () => {
  it('ETRS89 -> OSGB36 (BNG) within 1 cm at all 40 test points', async () => {
    const o = await getOstn15();
    const out = Object.fromEntries((await csv('OSTN15_TestOutput_ETRStoOSGB.txt')).map(([id, e, n]) => [id, [+e, +n]]));
    const input = await csv('OSTN15_TestInput_ETRStoOSGB.txt');
    expect(input).toHaveLength(40);
    let worst = 0;
    for (const [id, lat, lon] of input) {
      const [e, n] = o.toBng(+lon, +lat);
      worst = Math.max(worst, Math.hypot(e - out[id][0], n - out[id][1]));
    }
    expect(worst).toBeLessThan(0.01);
  });
  it('OSGB36 (BNG) -> ETRS89 within 1 cm at all 40 test points', async () => {
    const o = await getOstn15();
    const out = Object.fromEntries((await csv('OSTN15_TestOutput_OSGBtoETRS.txt')).map(([id, la, lo]) => [id, [+la, +lo]]));
    let worst = 0;
    for (const [id, e, n] of await csv('OSTN15_TestInput_OSGBtoETRS.txt')) {
      const [lon, lat] = o.toWgs84(+e, +n);
      const dy = (lat - out[id][0]) * 111_132;
      const dx = (lon - out[id][1]) * 111_320 * Math.cos((lat * Math.PI) / 180);
      worst = Math.max(worst, Math.hypot(dx, dy));
    }
    expect(worst).toBeLessThan(0.01);
  });
  it('matches postcodes.io eastings/northings (OSTN15-derived) and rejects points outside the grid', async () => {
    const o = await getOstn15();
    const [e, n] = o.toBng(-2.880519, 53.376735); // L25 7SA centroid
    expect(Math.hypot(e - 341520, n - 387013)).toBeLessThan(0.1);
    expect(() => o.toBng(2.35, 48.85)).toThrow(RangeError); // Paris
    expect(await getOstn15()).toBe(o); // loaded once
  });
});

describe('raster georeferencing and windows', () => {
  it('derives bounds via getBoundingBox for EA (ModelTransformation, +Y resolution) and tiepoint COG-style files', async () => {
    const ea = await (await fromArrayBuffer(ab(await readFile(path.join(REPO, 'fixtures/sunscan/raw/uk-mendips/dsm.tif'))))).getImage();
    expect(ea.getResolution()[1]).toBeGreaterThan(0); // the geotiff.js quirk
    expect(imageGeoref(ea)).toMatchObject({ minX: 341417, minY: 387024, maxX: 341513, maxY: 387120, resX: 1, resY: 1, northUp: true });
    const cog = await (await fromArrayBuffer(ab(await readFile(path.join(REPO, 'fixtures/sunscan/raw/scot-carnegie-birthplace/dsm.tif'))))).getImage();
    expect(cog.getResolution()[1]).toBeLessThan(0);
    expect(imageGeoref(cog)).toMatchObject({ minX: 309078, maxY: 687134, resX: 0.5, resY: 0.5, northUp: true });
  });
  it('treats EA "all zeros without a nodata tag" as no data, and maps -3.4e38 sentinels to NaN', async () => {
    // writeArrayBuffer mutates its metadata argument: build a fresh object per call
    const meta = (extra: Record<string, string> = {}) => ({ width: 4, height: 4, ModelPixelScale: [1, 1, 0], ModelTiepoint: [0, 0, 0, 1000, 2004, 0], GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 27700, BitsPerSample: [32], SampleFormat: [3], ...extra });
    const tile = { minE: 1000, minN: 2000, maxE: 1004, maxN: 2004 };
    const zeros = await parseEaTiff(writeArrayBuffer(new Float32Array(16), meta()), tile);
    expect(zeros!.data.every(Number.isNaN)).toBe(true);
    const vals = new Float32Array(16).fill(12.5);
    vals[3] = -3.4028234663852886e38;
    const r = await parseEaTiff(writeArrayBuffer(vals, meta({ GDAL_NODATA: '-3.4028234663852886e+38\u0000' })), tile);
    expect(r!.data.filter(Number.isNaN)).toHaveLength(1);
    expect(r!.data[0]).toBe(12.5);
  });
  it('snaps windows outward to the 16 m lattice and guards their size', () => {
    expect(snapWindow({ minE: 341401.4, minN: 387020.2, maxE: 341530.9, maxN: 387139.5 })).toEqual({ minE: 341392, minN: 387008, maxE: 341536, maxN: 387152 });
    expect(() => snapWindow({ minE: 0, minN: 0, maxE: 5000, maxN: 10 })).toThrow(/exceeds/);
    expect(() => snapWindow({ minE: 10, minN: 0, maxE: 5, maxN: 10 })).toThrow(/invalid bbox/);
    expect(tilesCovering({ minE: 100, minN: 100, maxE: 300, maxN: 140 }, 128)).toEqual([
      { minE: 0, minN: 0, maxE: 128, maxN: 128 }, { minE: 128, minN: 0, maxE: 256, maxN: 128 }, { minE: 256, minN: 0, maxE: 384, maxN: 128 },
      { minE: 0, minN: 128, maxE: 128, maxN: 256 }, { minE: 128, minN: 128, maxE: 256, maxN: 256 }, { minE: 256, minN: 128, maxE: 384, maxN: 256 },
    ]);
  });
  it('mosaics north-up, south-up and slightly mis-scaled sources by nearest neighbour', () => {
    const g = emptyGrid({ minE: 0, minN: 0, maxE: 4, maxN: 4 }, 1);
    const src = (northUp: boolean, res = 1): GeoRaster => ({
      width: 2, height: 4, minX: 0, minY: 0, maxX: 2 * res, maxY: 4 * res, resX: res, resY: res, northUp, nodataTag: null,
      data: Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    expect(pasteInto(g, src(true))).toBe(8);
    expect(g.data[0]).toBe(1); // top-left = northern row
    expect(g.data[3 * 4 + 1]).toBe(8);
    expect(validFraction(g)).toBe(0.5);
    const s = emptyGrid({ minE: 0, minN: 0, maxE: 2, maxN: 4 }, 1);
    pasteInto(s, src(false));
    expect(s.data[0]).toBe(7); // south-up source: last row is north
    const odd = emptyGrid({ minE: 0, minN: 0, maxE: 2, maxN: 4 }, 1);
    pasteInto(odd, src(true, 1.0000026)); // phase-1 style geotransform
    expect([...odd.data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('provider helpers', () => {
  it('builds integer-metre native-CRS EA requests with DEFLATE', () => {
    const u = eaGetCoverageUrl(EA_LAYERS.dsm, { minE: 341376, minN: 387072, maxE: 341504, maxN: 387200 });
    expect(u).toContain('CoverageId=df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m');
    expect(u).toContain('subset=E(341376,341504)&subset=N(387072,387200)');
    expect(u).toContain('geotiff:compression=DEFLATE');
    expect(u).not.toMatch(/outputCrs|subsettingCrs/);
  });
  it('names OS grid squares and SRSP tiles', () => {
    expect(osGridLetters(309159, 687002)).toBe('NT');
    expect(osGridLetters(264075, 193190)).toBe('SS');
    expect(osGridLetters(341520, 387013)).toBe('SJ');
    expect(osGridLetters(530783, 182202)).toBe('TQ');
    expect(srspTileStem(5000, 309100, 687100)).toBe('NT08NE');
    expect(srspTileStem(1000, 309100, 687100)).toBe('NT0987');
    expect(srspTileStem(10000, 309100, 687100)).toBe('NT08');
    const p5 = SRSP_DATASETS.find((d) => d.id === 'phase-5')!;
    expect(srspTileStems(p5, { minE: 309040, minN: 687008, maxE: 309216, maxN: 687184 })).toEqual(['NT08NE']);
    expect(srspTileStems(p5, { minE: 304990, minN: 687008, maxE: 305020, maxN: 687184 })).toEqual(['NT08NW', 'NT08NE']);
    expect(dtmKeyFor('lidar/phase-5/dsm/27700/gridded/NT08NE_50CM_DSM_PHASE5.tif')).toBe('lidar/phase-5/dtm/27700/gridded/NT08NE_50CM_DTM_PHASE5.tif');
    expect(dtmKeyFor('lidar/national-lidar-programme/dsm/27700/gridded/NT0987_50cm_DSM_ScotlandNationalLiDAR.tif')).toContain('/dtm/27700/gridded/NT0987_50cm_DTM_');
  });
  it('parses S3 ListObjectsV2 responses and Welsh catalogue dates', () => {
    const xml = '<ListBucketResult><Contents><Key>lidar/phase-5/dsm/27700/gridded/NT08NE_50CM_DSM_PHASE5.tif</Key><Size>407699451</Size></Contents><Contents><Key>a&amp;b.tif</Key><Size>1285</Size></Contents></ListBucketResult>';
    expect(parseS3List(xml)).toEqual([{ key: 'lidar/phase-5/dsm/27700/gridded/NT08NE_50CM_DSM_PHASE5.tif', size: 407699451 }, { key: 'a&b.tif', size: 1285 }]);
    expect(walesDate('13-01-2022')).toBe('2022-01-13');
  });
  it('orders providers by nation with border fallbacks; Northern Ireland has no open LiDAR (no request made)', async () => {
    const w = (e: number, n: number) => ({ minE: e, minN: n, maxE: e + 100, maxN: n + 100 });
    expect(providerOrder('England', w(530000, 182000))).toEqual(['ea']);
    expect(providerOrder('England', w(335000, 370000))).toEqual(['ea', 'wales']);
    expect(providerOrder('Wales', w(264000, 193000))).toEqual(['wales', 'ea']);
    expect(providerOrder('Scotland', w(309000, 687000))).toEqual(['scotland']);
    expect(providerOrder('Scotland', w(330000, 600000))).toEqual(['scotland', 'ea']);
    expect(providerOrder('Northern Ireland', w(0, 0))).toEqual([]);
    resetHttpState();
    expect(await getSurfaceRasters({ bbox: w(330000, 530000), nation: 'Northern Ireland' })).toMatchObject({ coverage: 0, reason: 'no-open-lidar' });
    expect(getHttpLog()).toHaveLength(0);
  });
});

describe('COG range reads through fetchCached (local server)', () => {
  let dir: string;
  let file: Buffer;
  const server = startLocalServer(async (req, res) => {
    if (!req.url?.startsWith('/cog.tif')) {
      res.statusCode = 404;
      res.end('missing');
      return;
    }
    const m = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range ?? ''));
    const a = m ? +m[1] : 0;
    const b = m ? Math.min(+m[2], file.length - 1) : file.length - 1;
    res.statusCode = m ? 206 : 200;
    res.setHeader('etag', '"cog-v1"');
    if (m) res.setHeader('content-range', `bytes ${a}-${b}/${file.length}`);
    res.end(file.subarray(a, b + 1));
  });
  beforeAll(async () => {
    file = await readFile(path.join(REPO, 'fixtures/sunscan/raw/scot-carnegie-birthplace/dsm.tif'));
    dir = await mkdtemp(path.join(tmpdir(), 'sunscan-cog-'));
    configureHttp({ mode: 'live', cacheDir: path.join(dir, 'c'), fixturesDir: path.join(dir, 'f'), hostLimits: { ...HOST_LIMITS } });
    resetHttpState();
  });
  afterAll(async () => {
    await (await server).close();
    await rm(dir, { recursive: true, force: true });
    resetHttpConfig();
  });
  it('reads a window identical to a full in-memory decode, using aligned 64 KiB blocks pinned to the ETag', async () => {
    const s = await server;
    const win = { minE: 309100, minN: 687050, maxE: 309150, maxN: 687100 };
    const { raster } = await readRemoteWindow(`${s.url}/cog.tif`, 'test-cog', win);
    const local = await (await fromArrayBuffer(ab(file))).getImage();
    const g = imageGeoref(local);
    const full = (await local.readRasters({ samples: [0] }))[0] as Float32Array;
    expect(raster).not.toBeNull();
    expect([raster!.minX, raster!.maxY, raster!.width, raster!.height]).toEqual([309100, 687100, 100, 100]);
    const c0 = (309100 - g.minX) / 0.5;
    const r0 = (g.maxY - 687100) / 0.5;
    for (const [r, c] of [[0, 0], [50, 50], [99, 99], [10, 70]]) expect(raster!.data[r * 100 + c]).toBe(full[(r0 + r) * g.width + c0 + c]);
    const ranges = getHttpLog().filter((e) => e.provider === 'test-cog').map((e) => e.range!);
    expect(ranges.every(([a, b]) => a % 65536 === 0 && b - a + 1 <= 65536)).toBe(true);
    expect(getHttpLog().some((e) => e.url.endsWith('#etag=%22cog-v1%22'))).toBe(true);
  });
  it('reports missing remote files', async () => {
    const s = await server;
    await expect(readRemoteWindow(`${s.url}/missing.tif`, 'test-cog', { minE: 0, minN: 0, maxE: 1, maxN: 1 })).rejects.toBeInstanceOf(RemoteFileError);
  });
});

describe('replay guard', () => {
  it('getSurfaceRasters never falls back silently on a replay miss', async () => {
    resetHttpConfig();
    setHttpMode('replay');
    await expect(getSurfaceRasters({ bbox: { minE: 100000, minN: 100000, maxE: 100100, maxN: 100100 }, nation: 'England' })).rejects.toThrow(/replay miss/i);
    resetHttpConfig();
  });
});
