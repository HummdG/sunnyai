// Unit tests of the pipeline helpers: refs, errors, eras/storeys, materials, frames, context (roads, terrain,
// evidence, neighbour heights), geometry, facade matching, quality/provenance, plausibility, adapters, report.
import { describe, expect, it } from 'vitest';
import { makeFrame } from '@sunny/sunscan-core/geo';
import type { EdgeKind, HouseModelSpec, PolygonM, ReconstructedPart, Vec2 } from '@sunny/sunscan-core';
import type { BngGrid, SurfaceRasters } from '../src/contracts.js';
import { eraFromTags, estimateStoreys, numericTag, parseYear } from '../src/pipeline/archetype.js';
import { annotateBuiltForms } from '../src/pipeline/candidates.js';
import { evidenceFrom, neighbourHeight, roadSpecs, terrainGrid } from '../src/pipeline/context.js';
import { coreFrontEdge, coreRegularize, normalisePriors, pickEntrance } from '../src/pipeline/core-adapters.js';
import { isReplayMiss, PipelineError, toProviderError } from '../src/pipeline/errors.js';
import { matchPartEdge } from '../src/pipeline/facade.js';
import { plausibilityIssues } from '../src/pipeline/fallback.js';
import { bngAngleToEnu, makeBngLocalFrame, sampleBng } from '../src/pipeline/frames.js';
import { cleanFootprint, footprintProblem, kindsForInputOrder, orientWithKinds, roundTo } from '../src/pipeline/geometry.js';
import { materialsFor } from '../src/pipeline/materials.js';
import { buildProvenance, buildQuality, isHeritage, surveyAgeYears, type QualityFacts } from '../src/pipeline/quality.js';
import { renderReport } from '../src/pipeline/report.js';
import { normaliseRef, osmRefOf } from '../src/pipeline/scene.js';
import { linearOstn, stubProviders, syntheticBuildings } from './support/stubs.js';

const rect = (w: number, h: number, x0 = 0, y0 = 0): Vec2[] => [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];

describe('refs and errors', () => {
  it('normalises OSM refs', () => {
    expect(normaliseRef('way/123')).toBe('osm:way/123');
    expect(normaliseRef('W123')).toBe('osm:way/123');
    expect(normaliseRef('r45')).toBe('osm:relation/45');
    expect(normaliseRef('osm:way/1')).toBe('osm:way/1');
    expect(normaliseRef('overture:abc')).toBe('overture:abc');
    expect(osmRefOf('osm:way/9')).toBe('way/9');
    expect(osmRefOf('overture:x')).toBeUndefined();
  });

  it('maps provider errors to 502/504 and keeps PipelineErrors', () => {
    expect(toProviderError(Object.assign(new Error('x'), { name: 'TimeoutError' }), 'geo')).toMatchObject({ status: 504, code: 'upstream-timeout' });
    expect(toProviderError(Object.assign(new Error('x'), { status: 504 }), 'geo').status).toBe(504);
    expect(toProviderError(Object.assign(new Error('x'), { code: 'REPLAY_MISS' }), 'geo')).toMatchObject({ status: 502, code: 'replay-miss' });
    expect(toProviderError(new Error('boom'), 'geo')).toMatchObject({ status: 502, code: 'upstream-error', message: 'geo failed: boom' });
    const keep = new PipelineError(404, 'not-found', 'x');
    expect(toProviderError(keep, 'geo')).toBe(keep);
    expect(isReplayMiss({ name: 'ReplayMissError' })).toBe(true);
    expect(isReplayMiss(new Error('x'))).toBe(false);
  });
});

describe('archetype and materials', () => {
  it('parses construction dates into eras', () => {
    expect(parseYear('1928')).toBe(1928);
    expect(parseYear('C18')).toBe(1750);
    expect(parseYear('18th century')).toBe(1750);
    expect(parseYear('1930s')).toBe(1935);
    expect(parseYear('~1850')).toBe(1850);
    expect(parseYear('unknown')).toBeUndefined();
    expect(eraFromTags({ start_date: 'C18' })).toBe('pre-1919');
    expect(eraFromTags({ 'building:start_date': '1935' })).toBe('1919-1944');
    expect(eraFromTags({ construction_date: '2004' })).toBe('post-2000');
    expect(eraFromTags({})).toBeUndefined();
    expect(numericTag('7 m')).toBe(7);
    expect(numericTag('two')).toBeUndefined();
  });

  it('counts storeys from the eave height, preferring a consistent building:levels tag', () => {
    expect(estimateStoreys(5.2, '1945-1964')).toBe(2);
    expect(estimateStoreys(2.6, '1965-1980')).toBe(1);
    expect(estimateStoreys(8.4, '1945-1964')).toBe(3);
    expect(estimateStoreys(5.2, '1945-1964', 3)).toBe(3); // within ±1: tag wins
    expect(estimateStoreys(5.2, '1945-1964', 6)).toBe(2); // inconsistent tag ignored
  });

  it('picks materials from tags, else regional defaults', () => {
    expect(materialsFor({ 'building:material': 'stone', 'roof:material': 'slate', 'building:colour': '#AA3322' }, 'pre-1919', 'England', 'gabled')).toEqual({ wall: 'stone', roof: 'slate', wallColour: '#aa3322' });
    expect(materialsFor({}, '1919-1944', 'England', 'hipped')).toEqual({ wall: 'brick', roof: 'tile' });
    expect(materialsFor({}, 'pre-1919', 'Scotland', 'gabled')).toEqual({ wall: 'stone', roof: 'slate' });
    expect(materialsFor({ 'roof:material': 'roof_tiles' }, 'post-2000', 'Wales', 'flat').roof).toBe('flat');
  });
});

describe('frames and rasters', () => {
  const grid: BngGrid = { width: 4, height: 3, originE: 1000, originN: 2003, res: 1, data: Float32Array.from([0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23]) };
  it('samples BNG rasters bilinearly between pixel centres', () => {
    expect(sampleBng(grid, 1000.5, 2002.5)).toBeCloseTo(0);
    expect(sampleBng(grid, 1001.0, 2002.0)).toBeCloseTo(5.5);
    expect(sampleBng(grid, 1003.5, 2000.5)).toBeCloseTo(23);
    expect(Number.isNaN(sampleBng(grid, 999, 2002))).toBe(true);
  });

  it('round-trips a local BNG frame and converts angles', () => {
    const f = makeBngLocalFrame(linearOstn, 340000, 386000);
    const p = f.fromLL([-2.9, 53.37]);
    const back = f.toLL(p);
    expect(back[0]).toBeCloseTo(-2.9, 9);
    expect(back[1]).toBeCloseTo(53.37, 9);
    // identity-like transform -> no rotation
    expect(bngAngleToEnu((q) => q, [0, 0], 30)).toBeCloseTo(30, 9);
    // a frame rotated by +2°: angles shift by +2°
    const rot = (q: Vec2): Vec2 => {
      const a = (2 * Math.PI) / 180;
      return [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
    };
    expect(bngAngleToEnu(rot, [5, 5], 10)).toBeCloseTo(12, 6);
  });
});

describe('context', () => {
  it('clips roads to the area around the house', () => {
    const roads = roadSpecs([{ name: 'Long Road', kind: 'residential', line: [[-500, 10], [500, 10]] }, { kind: 'path', line: [[300, 300], [400, 400]] }], 100);
    expect(roads).toHaveLength(1);
    expect(roads[0].line).toEqual([[-100, 10], [100, 10]]);
    expect(roads[0].name).toBe('Long Road');
  });

  it('chooses neighbour heights: LiDAR > height tag > levels > prior', () => {
    const b = { id: 'osm:way/1', source: 'osm' as const, tags: { building: 'house' }, footprint: { outer: rect(5, 5) } };
    expect(neighbourHeight(b, { height: 8.1 }).height).toBe(8.1);
    expect(neighbourHeight({ ...b, tags: { height: '9 m' } }).height).toBe(9);
    const lv = neighbourHeight({ ...b, tags: { 'building:levels': '3' } });
    expect(lv.height).toBeCloseTo(9.9, 9);
    expect(lv.eaveHeight).toBeCloseTo(8.4, 9);
    expect(neighbourHeight({ ...b, tags: { building: 'garage' } }).height).toBe(2.6);
    expect(neighbourHeight(b).height).toBe(7);
  });

  it('samples a north-up terrain grid relative to the ground datum', () => {
    const enu = makeFrame(53.37, -2.9);
    const [e0, n0] = linearOstn.toBng(-2.9, 53.37);
    const size = 80;
    const data = new Float32Array(size * size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) data[r * size + c] = 50 + (size - r) * 0.1; // rises to the north
    const dtm: BngGrid = { width: size, height: size, originE: Math.floor(e0) - 40, originN: Math.floor(n0) + 40, res: 1, data };
    // the origin sits ~40 rows below the top edge: DTM there ≈ 50 + 40 × 0.1 = 54 m = the ground datum
    const t = terrainGrid(dtm, 54, enu, linearOstn, { half: 10, cell: 1, source: 'test' })!;
    expect(t.width).toBe(20);
    expect(t.height).toBe(20);
    expect(t.originX).toBe(-10);
    expect(t.originY).toBe(10);
    const north = t.heights[0]!;
    const south = t.heights[(t.height - 1) * t.width]!;
    expect(north).toBeGreaterThan(south); // row 0 is north
    expect(Math.abs(t.heights[10 * 20 + 10]!)).toBeLessThan(0.2); // ~ ground datum at the origin
    expect(north - south).toBeCloseTo(1.9, 1); // 19 rows × 0.1 m
  });

  it('decimates evidence deterministically', () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, z: 5 + i / 10, residual: 0.01 * i }));
    const ev = evidenceFrom(samples, (p) => p, { max: 4, resolution: 1, source: 'EA', surveyDate: '2019-02-11' })!;
    expect(ev.points).toHaveLength(12);
    expect(ev.residuals).toEqual([0, 0.03, 0.06, 0.09]);
    expect(ev.surveyDate).toBe('2019-02-11');
    expect(evidenceFrom([], (p) => p, { max: 4, resolution: 1, source: 'x' })).toBeUndefined();
  });
});

describe('geometry helpers', () => {
  it('orients polygons and maps edge kinds both ways', () => {
    const cw: PolygonM = { outer: rect(4, 3).slice().reverse() };
    const kinds: EdgeKind[] = ['party', 'eave', 'eave', 'gable'];
    const o = orientWithKinds(cw, kinds);
    expect(o.poly.outer).toEqual(rect(4, 3).slice().reverse().reverse());
    expect(kindsForInputOrder(cw, o.kinds!)).toEqual(kinds);
  });

  it('cleans and validates footprints', () => {
    const noisy: PolygonM = { outer: [[0, 0], [5, 0.01], [10, 0], [10, 6], [0, 6], [0, 0]] };
    expect(cleanFootprint(noisy)!.outer).toHaveLength(4);
    expect(footprintProblem({ outer: rect(1, 1) })).toMatch(/too small/);
    expect(footprintProblem({ outer: [[0, 0], [10, 0], [10, 10], [4, -5], [0, 10]] })).toMatch(/self-intersects/);
    expect(footprintProblem({ outer: rect(8, 6) })).toBeUndefined();
    expect(Object.is(roundTo(-0.0001, 2), -0)).toBe(false);
  });

  it('matches the front edge onto a part edge', () => {
    const part = { id: 'main', role: 'main', footprint: { outer: rect(8, 6, 0.4, 0.2) }, edgeKinds: ['eave', 'party', 'eave', 'party'] } as unknown as HouseModelSpec['parts'][number];
    expect(matchPartEdge([0, 0], [8, 0], [part])).toEqual({ partId: 'main', edge: 0 });
    expect(matchPartEdge([8, 0], [8, 6], [part])).toBeUndefined(); // party edge never fronts
  });
});

describe('core adapters', () => {
  it('normalises priors results of several shapes', () => {
    const part = { id: 'main', role: 'main', footprint: { outer: rect(5, 5) }, edgeKinds: [], roof: { type: 'flat' }, eaveHeight: 5, ridgeHeight: 5, family: 'flat' } as ReconstructedPart;
    expect(normalisePriors(part)?.parts).toHaveLength(1);
    expect(normalisePriors([part])?.parts).toHaveLength(1);
    expect(normalisePriors({ parts: [part], notes: ['n'], storeys: 2 })).toEqual({ parts: [part], notes: ['n'], storeys: 2 });
    expect(normalisePriors({ parts: [] })).toBeUndefined();
    expect(normalisePriors(42)).toBeUndefined();
  });

  it('finds the front edge from an entrance or the street', () => {
    const footprint: PolygonM = { outer: rect(8, 6) };
    const kinds: EdgeKind[] = ['eave', 'party', 'eave', 'party'];
    const roads = [{ name: 'High Street', kind: 'residential', line: [[-20, 20], [30, 20]] as Vec2[] }];
    expect(coreFrontEdge({ footprint, edgeKinds: kinds, roads, entrances: [] })).toMatchObject({ edge: 2, method: 'road', streetName: 'High Street' });
    const entrances = [{ xy: [4, 0.2] as Vec2, tags: { entrance: 'main' } }];
    expect(pickEntrance({ footprint, edgeKinds: kinds, roads, entrances })?.tags.entrance).toBe('main');
    expect(coreFrontEdge({ footprint, edgeKinds: kinds, roads, entrances })).toMatchObject({ edge: 0, method: 'entrance', entrance: [4, 0.2] });
  });

  it('regularises outlines while carrying edge kinds', () => {
    const skew: PolygonM = { outer: [[0, 0], [8, 0.15], [8, 6], [0, 6]] };
    const r = coreRegularize(skew, ['eave', 'party', 'eave', 'gable']);
    expect(r.footprint.outer).toHaveLength(4);
    expect(r.edgeKinds).toHaveLength(4);
    expect(r.edgeKinds.filter((k) => k === 'party')).toHaveLength(1);
  });

  it('annotates candidate buildings with their built form', () => {
    const res = syntheticBuildings(53.4, -2.98);
    const out = annotateBuiltForms(res);
    expect(out.find((b) => b.ref === 'osm:way/1')?.builtForm).toBe('semi-detached');
  });
});

describe('plausibility, quality and provenance', () => {
  const part = (over: Partial<ReconstructedPart>): ReconstructedPart => ({ id: 'main', role: 'main', footprint: { outer: rect(8, 6) }, edgeKinds: ['eave', 'eave', 'eave', 'eave'], roof: { type: 'hipped', pitchDeg: 35 }, eaveHeight: 5, ridgeHeight: 8, family: 'hip', ...over });
  it('flags implausible parts', () => {
    expect(plausibilityIssues([part({})])).toEqual([]);
    expect(plausibilityIssues([part({ eaveHeight: 1.2 })])).toEqual(['main: eave 1.20 m < 2 m']);
    expect(plausibilityIssues([part({ ridgeHeight: 4 })])).toEqual(['main: ridge 4.00 m below the eave']);
    expect(plausibilityIssues([part({ id: 'ext-1', footprint: { outer: rect(1.5, 2) } })])).toEqual(['ext-1: 3.0 m² part']);
    expect(plausibilityIssues([part({ eaveHeight: NaN })])).toEqual(['main: non-finite heights']);
  });

  const facts = (over: Partial<QualityFacts> = {}): QualityFacts => ({
    manualTarget: false, targetSource: 'osm', targetAmbiguous: false, terraceBlock: false,
    lidar: { status: 'fitted' }, fitUsed: false, priorsUsed: false, roofTagged: false, heritage: false, extraFlags: [], extraNotes: [], ...over,
  });

  it('derives confidences and flags', () => {
    const ni = buildQuality(facts({ lidar: { status: 'no-coverage', reason: 'no-open-lidar' }, nation: 'Northern Ireland', priorsUsed: true }));
    expect(ni.flags).toContain('lidar-unavailable');
    expect(ni.heights).toBe('estimated');
    expect(ni.geocode).toBe('manual');
    const blocks = buildQuality(facts({ blocksUsed: true, terraceBlock: true, targetSource: 'overture' }));
    expect(blocks).toMatchObject({ heights: 'medium', roof: 'low', footprint: 'low' });
    expect(blocks.flags).toEqual(expect.arrayContaining(['fit-unreliable', 'terrace-block', 'footprint-from-overture']));
    const err = buildQuality(facts({ lidar: { status: 'fit-error' } }));
    expect(err.flags).toContain('fit-failed');
    expect(buildQuality(facts({ frontMethod: 'longest-edge', surveyAgeYears: 8, registrationShift: 3.5 })).flags).toEqual(
      expect.arrayContaining(['front-edge-guessed', 'survey-old', 'registration-large-shift']),
    );
  });

  it('recognises heritage tags and survey ages', () => {
    expect(isHeritage({ heritage: '2' })).toBe(true);
    expect(isHeritage({ listed_status: 'Grade I' })).toBe(true);
    expect(isHeritage({ building: 'house' })).toBe(false);
    const r = { source: { surveyDates: ['2017-12-07', '2020-12-12'] } } as unknown as SurfaceRasters;
    expect(surveyAgeYears(r, new Date('2026-12-12T00:00:00Z'))).toBeCloseTo(6, 1);
    expect(surveyAgeYears(undefined, new Date())).toBeUndefined();
  });

  it('lists sources and licences', async () => {
    const geocode = await stubProviders().geocodeUk('x');
    const rasters = { source: { id: 'ea-lidar-composite-2022', title: 'EA', retrievalUrls: ['https://e'], surveyDates: ['2019-02-11'], retrievedAt: '' }, licence: { id: 'OGL-UK-3.0', attribution: '© EA' } } as unknown as SurfaceRasters;
    const p = buildProvenance({ usedOsm: true, usedOverture: true, overtureRelease: '2026-09-23.1', geocode, rasters, priorsUsed: false });
    expect(p.map((s) => s.id)).toEqual(['osm', 'overture-buildings', 'postcodes.io', 'nominatim', 'ea-lidar-composite-2022']);
    expect(p.find((s) => s.id === 'ea-lidar-composite-2022')).toMatchObject({ licence: 'OGL-UK-3.0', date: '2019-02-11' });
  });
});

describe('report', () => {
  it('renders the main sections', () => {
    const spec = {
      schema: 'sunscan.house/1', id: 'osm:way/1', address: { display: 'A | B', postcode: 'L1 1AA', nation: 'England' }, origin: { lat: 53.4, lon: -2.98 },
      groundElevation: null, builtForm: 'detached', era: 'unknown', facade: {}, context: { neighbours: [] },
      parts: [{ id: 'main', role: 'main', footprint: { outer: rect(8, 6) }, edgeKinds: ['eave', 'eave', 'eave', 'eave'], baseHeight: 0, eaveHeight: 5.1, roof: { type: 'hipped', pitchDeg: 35 }, storeys: 2, overhang: 0.25, material: { wall: 'brick', roof: 'tile' }, chimneys: [], source: { heights: 'prior', roof: 'prior' } }],
      quality: { geocode: 'manual', footprint: 'medium', heights: 'estimated', roof: 'estimated', openings: 'procedural', interior: 'procedural', flags: ['lidar-unavailable'], notes: ['n1'] },
      provenance: [{ id: 'osm', title: 'OpenStreetMap', licence: 'ODbL-1.0', attribution: '© OSM' }], generatedAt: '2026-10-08T12:00:00.000Z', generator: 'sunscan-server/0.1.0',
    } as unknown as HouseModelSpec;
    const md = renderReport(spec, { timings: { total: 12.3 }, warnings: ['w1'], files: [{ name: 'spec.json', bytes: 10 }] });
    expect(md).toContain('# House model: A \\| B');
    expect(md).toContain('| main | main | 5.10 | hipped | 35.0 | 2 | brick / tile | 0 | prior / prior |');
    expect(md).toContain('No LiDAR roof fit');
    expect(md).toContain('`lidar-unavailable`');
    expect(md).toContain('| total | 12.3 |');
    expect(md).toContain('- w1');
  });
});
