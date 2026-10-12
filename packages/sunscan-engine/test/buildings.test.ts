import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeFrame } from '@sunny/sunscan-core/geo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildFootprintQuery, elementToPolygons, mergeOverture, overlapFractions, OverpassError, overpassQuery, parseOsmElements, parseOsmRef,
  scoreTargets, stitchRings, tilesAround, lonLatToTile, type OsmElement, type OvertureBuilding,
} from '../src/buildings/index.js';
import { configureHttp, getHttpStats, HOST_LIMITS, ReplayMissError, resetHttpConfig, resetHttpState, setHttpMode } from '../src/http/index.js';
import type { LonLat } from '../src/contracts.js';
import { startLocalServer, type LocalServer } from './support-data/local-server.js';

const F = makeFrame(53.4, -2.9);
const ll = (x: number, y: number): LonLat => F.toLonLat([x, y]);
const ring = (pts: [number, number][]): LonLat[] => pts.map(([x, y]) => ll(x, y));
const geom = (pts: [number, number][]) => pts.map(([x, y]) => {
  const [lon, lat] = ll(x, y);
  return { lat, lon };
});
const sq = (x0: number, y0: number, w: number, h: number): [number, number][] => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]];

describe('OSM parsing', () => {
  it('stitches split, reversed multipolygon members and assigns holes', () => {
    const { rings, unclosed } = stitchRings([[[0, 0], [4, 0], [4, 4]], [[0, 4], [0, 0]], [[4, 4], [0, 4]]]);
    expect(unclosed).toEqual([]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    const rel: OsmElement = {
      type: 'relation', id: 7, tags: { type: 'multipolygon', building: 'yes' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: geom([[0, 0], [20, 0], [20, 20]]) },
        { type: 'way', ref: 2, role: 'outer', geometry: geom([[0, 20], [0, 0]]) },
        { type: 'way', ref: 3, role: '', geometry: geom([[20, 20], [0, 20]]) },
        { type: 'way', ref: 4, role: 'inner', geometry: geom(sq(5, 5, 5, 5)) },
        { type: 'way', ref: 5, role: 'outer', geometry: geom(sq(40, 0, 6, 6)) },
      ],
    };
    const polys = elementToPolygons(rel);
    expect(polys.map((p) => p.ref)).toEqual(['relation/7', 'relation/7#2']);
    expect(polys[0].holes).toHaveLength(1);
    expect(polys[0].warnings.join(' ')).toMatch(/empty role/);
    expect(elementToPolygons({ type: 'way', id: 9, tags: { building: 'yes' }, nodes: [1, 2, 3, 4], geometry: geom([[0, 0], [5, 0], [5, 5], [0, 5]]) })).toEqual([]); // unclosed
  });
  it('splits elements into buildings, parts, address points, entrances, roads and other areas', () => {
    const els: OsmElement[] = [
      { type: 'way', id: 1, tags: { building: 'house', 'addr:housenumber': '20' }, nodes: [1, 2, 3, 4, 1], geometry: geom(sq(0, 0, 6, 9)) },
      { type: 'way', id: 2, tags: { 'building:part': 'yes' }, nodes: [1, 2, 3, 4, 1], geometry: geom(sq(0, 0, 3, 3)) },
      { type: 'way', id: 3, tags: { amenity: 'parking', name: 'Car park' }, nodes: [1, 2, 3, 4, 1], geometry: geom(sq(20, 0, 10, 10)) },
      { type: 'way', id: 4, tags: { highway: 'residential', name: 'Forthlin Road' }, geometry: geom([[-50, -5], [50, -5]]) },
      { type: 'node', id: 5, lat: ll(3, 0)[1], lon: ll(3, 0)[0], tags: { entrance: 'main' } },
      { type: 'node', id: 6, lat: ll(2, 2)[1], lon: ll(2, 2)[0], tags: { 'addr:housenumber': '20', 'addr:street': 'Forthlin Road' } },
      { type: 'way', id: 1, tags: { building: 'house' }, nodes: [1, 2, 3, 4, 1], geometry: geom(sq(0, 0, 6, 9)) }, // duplicate
    ];
    const p = parseOsmElements(els);
    expect(p.polygons.map((x) => `${x.ref}:${x.kind}`)).toEqual(['way/1:building', 'way/2:building:part']);
    expect([...p.areas.keys()]).toEqual(['way/3']);
    expect(p.roads).toEqual([expect.objectContaining({ name: 'Forthlin Road', kind: 'residential', ref: 'way/4' })]);
    expect(p.entrances).toHaveLength(1);
    expect(p.addressNodes).toHaveLength(1);
    expect(p.nodes.has('node/5')).toBe(true);
  });
  it('builds the footprint query with all feature classes and the forced geocoder object', () => {
    const q = buildFootprintQuery(53.3697111, -2.8978967, 80, 'way/516125064');
    for (const s of ['way["building"](around:80,53.3697111,-2.8978967)', 'relation["building"]["type"="multipolygon"]', 'way["building:part"]', 'node["addr:housenumber"]', 'node["entrance"]', 'way["highway"~"^(motorway|', 'way(516125064);', 'out geom;', '[timeout:25]']) {
      expect(q).toContain(s);
    }
    expect(parseOsmRef('osm:relation/45')).toEqual({ type: 'relation', id: 45 });
    expect(parseOsmRef('overture:abc')).toBeUndefined();
    expect(buildFootprintQuery(1, 2)).not.toContain('way(');
  });
});

describe('target candidates and Overture merging', () => {
  const ctx = { addressNodes: [], nodes: new Map(), areas: new Map() };
  const b = (ref: string, pts: [number, number][], tags: Record<string, string> = { building: 'house' }, source: 'osm' | 'overture' = 'osm') =>
    ({ ref: `${source}:${ref}`, ...(source === 'osm' ? { osmRef: ref } : {}), source, tags, outer: ring(pts.slice(0, -1)), holes: [], isPart: false });
  const [lon0, lat0] = ll(3, 4);
  it('prefers the geocoder object, then containment, address and name evidence; flags ambiguity', () => {
    const houses = [b('way/1', sq(0, 0, 6, 9)), b('way/2', sq(6, 0, 6, 9), { building: 'house', 'addr:housenumber': '22', 'addr:street': 'Forthlin Road' })];
    const r1 = scoreTargets(lat0, lon0, houses, { ...ctx, osmRef: 'way/2' });
    expect(r1.ranked[0].ref).toBe('osm:way/2');
    expect(r1.ranked[0].reasons).toContain('geocoder returned this building');
    expect(r1.ambiguous).toBe(false);
    const r2 = scoreTargets(lat0, lon0, houses, ctx);
    expect(r2.ranked[0].ref).toBe('osm:way/1');
    expect(r2.ranked[0].reasons).toContain('contains the geocoded point');
    const r3 = scoreTargets(lat0, lon0, houses, { ...ctx, parsed: { raw: '', houseNumber: '20', street: 'Forthlin Road', localities: [] } });
    expect(r3.ranked.find((c) => c.ref === 'osm:way/2')!.reasons.join(' ')).toMatch(/same street but other number/);
    const garage = scoreTargets(lat0, lon0, [b('way/3', sq(0, 0, 6, 9), { building: 'garage' })], ctx);
    expect(garage.ranked[0].reasons.join(' ')).toMatch(/ancillary/);
    const far = scoreTargets(...ll(100, 100).reverse() as [number, number], houses, ctx);
    expect(far.ambiguous).toBe(true);
  });
  it('measures polygon overlap and keeps only Overture outlines that fill OSM gaps', () => {
    const A = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][], holes: [] };
    const B = { outer: [[5, 0], [15, 0], [15, 10], [5, 10]] as [number, number][], holes: [] };
    const o = overlapFractions(A, B);
    expect(o.ofA).toBeCloseTo(0.5, 2);
    expect(o.ofB).toBeCloseTo(0.5, 2);
    const osm = [{ osmRef: 'way/1', outer: ring(sq(0, 0, 6, 9).slice(0, -1)), holes: [] }];
    const ov = (id: string, pts: [number, number][], osmRef?: string): OvertureBuilding => ({ id, outer: ring(pts.slice(0, -1)), holes: [], tags: { building: 'yes' }, datasets: ['Microsoft ML Buildings'], ...(osmRef ? { osmRef } : {}) });
    const m = mergeOverture(lat0, lon0, 80, osm, [
      ov('dup', sq(0.2, 0.1, 6, 9)), // ~94 % overlap
      ov('same-record', sq(30, 30, 5, 5), 'way/1'),
      ov('blob', sq(-1, -1, 14, 11)), // swallows the OSM house (>= 50 % of the OSM polygon)
      ov('neighbour', sq(6, 0, 6, 9)),
      ov('far', sq(300, 300, 6, 9)),
    ]);
    expect(m.kept.map((x) => x.id)).toEqual(['neighbour']);
    expect(m.duplicates).toBe(3);
    expect(m.outside).toBe(1);
  });
  it('lists the z14 tiles around a point', () => {
    expect(lonLatToTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
    expect(tilesAround(53.3772527, -2.8813616, 80)).toEqual([{ x: 8060, y: 5308 }]);
    const t = lonLatToTile(-2.8813616, 53.3772527, 14);
    const cornerLon = (t.x / 2 ** 14) * 360 - 180; // west edge of the tile
    expect(tilesAround(53.3772527, cornerLon, 80).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Overpass failover (local endpoints)', () => {
  let server: LocalServer;
  let dir: string;
  const okJson = JSON.stringify({ version: 0.6, osm3s: { timestamp_osm_base: '2026-10-08T00:00:00Z' }, elements: [{ type: 'node', id: 1, lat: 1, lon: 2, tags: { entrance: 'yes' } }] });
  let tooMany = 0;
  beforeAll(async () => {
    server = await startLocalServer((req, res) => {
      const p = req.url ?? '';
      if (p.startsWith('/504')) (res.statusCode = 504), res.end('Dispatcher_Client::request_read_and_idx::timeout');
      else if (p.startsWith('/429')) {
        if (tooMany-- > 0) (res.statusCode = 429), res.setHeader('retry-after', '0'), res.end('rate_limited');
        else res.end(okJson);
      } else if (p.startsWith('/remark')) res.end(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 26 seconds.' }));
      else if (p.startsWith('/html')) res.end('<html>error</html>');
      else res.end(okJson);
    });
  });
  afterAll(async () => {
    await server.close();
    resetHttpConfig();
  });
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sunscan-ovp-'));
    configureHttp({ mode: 'live', cacheDir: path.join(dir, 'c'), fixturesDir: path.join(dir, 'f'), backoffBaseMs: 1, hostLimits: { ...HOST_LIMITS } });
    resetHttpState();
    server.requests.length = 0;
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));
  const ep = (p: string) => `${server.url}/${p}/api/interpreter`;

  it('moves on immediately after 504, a failed-remark 200 and non-JSON answers', async () => {
    const r = await overpassQuery('[out:json];node(1);out;', { endpoints: [ep('504'), ep('remark'), ep('html'), ep('ok')], passes: 1 });
    expect(r.endpoint).toBe(ep('ok'));
    expect(r.elements).toHaveLength(1);
    expect(r.osmBase).toBe('2026-10-08T00:00:00Z');
    expect(r.attempts.map((a) => a.status)).toEqual([504, 200, 200, 200]);
    expect(server.requests.filter((x) => x.url.startsWith('/504'))).toHaveLength(1); // never retried
    expect(server.requests[0].body).toMatch(/^data=/);
  });
  it('retries a 429 once on the same host', async () => {
    tooMany = 1;
    const r = await overpassQuery('[out:json];node(2);out;', { endpoints: [ep('429'), ep('ok')], passes: 1 });
    expect(r.endpoint).toBe(ep('429'));
    expect(server.requests.filter((x) => x.url.startsWith('/429'))).toHaveLength(2);
  });
  it('answers a repeated query from the cache of whichever endpoint succeeded, without touching failing hosts', async () => {
    await overpassQuery('[out:json];node(3);out;', { endpoints: [ep('504'), ep('ok')], passes: 1 });
    const n = server.requests.length;
    const again = await overpassQuery('[out:json];node(3);out;', { endpoints: [ep('504'), ep('ok')], passes: 1 });
    expect(again.fromCache).toBe(true);
    expect(server.requests.length).toBe(n);
  });
  it('throws OverpassError when every endpoint fails, and replays recorded failover sequences', async () => {
    await expect(overpassQuery('[out:json];node(4);out;', { endpoints: [ep('504'), ep('remark')], passes: 1 })).rejects.toBeInstanceOf(OverpassError);
    setHttpMode('record');
    const rec = await overpassQuery('[out:json];node(5);out;', { endpoints: [ep('504'), ep('ok')], passes: 1 });
    setHttpMode('replay');
    resetHttpState();
    const n = server.requests.length;
    const rep = await overpassQuery('[out:json];node(5);out;', { endpoints: [ep('504'), ep('ok')], passes: 1 });
    expect(rep.elements).toEqual(rec.elements);
    expect(server.requests.length).toBe(n);
    expect(getHttpStats().overpass.fixture).toBeGreaterThan(0);
    await expect(overpassQuery('[out:json];node(6);out;', { endpoints: [ep('504'), ep('ok')], passes: 1 })).rejects.toBeInstanceOf(ReplayMissError);
  });
});
