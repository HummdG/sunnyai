import { describe, expect, it } from 'vitest';
import {
  analyseFootprint, expandHouseNumbers, frameAtCentroid, isAncillaryTags, localToLonLat, lonLatToLocal, normaliseStreetName,
  polygonToLocal, sharedLengthBetween, sharedPiecesOnEdge, unionIntervals, type FootprintNeighbour,
} from '../src/footprint/index.js';
import { makeFrame } from '../src/geo/geo.js';
import { ringArea, type PolygonM, type Vec2 } from '../src/geometry/geom.js';

const rect = (x0: number, y0: number, w: number, h: number): PolygonM => ({ outer: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]] });
const nb = (id: string, p: PolygonM, tags: Record<string, string> = { building: 'house' }): FootprintNeighbour => ({ id, footprint: p, tags });
/** Row of 6 x 9 m houses along x starting at x = 0. */
const row = (n: number, gap = 0) => Array.from({ length: n }, (_, i) => rect(i * (6 + gap), 0, 6, 9));

describe('shared wall pieces', () => {
  it('detects exact, offset (<= 0.3 m) and partial shared walls, rejects larger offsets and skewed walls', () => {
    const A = rect(0, 0, 8, 10).outer;
    const edge = (ring: Vec2[]) => sharedPiecesOnEdge(A[1], A[2], ring, 'n'); // east wall x = 8
    expect(edge(rect(8, 0, 8, 10).outer)[0]).toMatchObject({ t0: 0, t1: 10, length: 10, orientation: 'opposite' });
    expect(edge(rect(8.2, 0, 8, 10).outer)[0].length).toBeCloseTo(10, 9);
    expect(edge(rect(8.5, 0, 8, 10).outer)).toEqual([]);
    expect(edge(rect(8, 6, 8, 8).outer)[0].length).toBeCloseTo(4, 9);
    expect(edge(rect(8, 9.6, 8, 8).outer)).toEqual([]); // 0.4 m overlap < 0.5 m: corner touch
    const skew: Vec2[] = [[8, 0], [16, 0], [16, 10], [8 + 10 * Math.tan((15 * Math.PI) / 180), 10]]; // west wall 15 deg off
    expect(sharedPiecesOnEdge(A[1], A[2], skew, 'n')).toEqual([]);
    expect(unionIntervals([[0, 2], [1, 3], [5, 6]])).toEqual({ total: 4, merged: [[0, 3], [5, 6]] });
    expect(sharedLengthBetween(A, rect(8, 0, 8, 10).outer)).toBeCloseTo(10, 9);
  });
});

describe('analyseFootprint: party walls and built form', () => {
  it('detached: no shared wall', () => {
    const r = analyseFootprint(rect(0, 0, 6, 9), [nb('b', rect(10, 0, 6, 9))]);
    expect(r.builtForm).toBe('detached');
    expect(r.edgeKinds).toEqual(['eave', 'eave', 'eave', 'eave']);
    expect(r.attached).toEqual([]);
  });
  it('semi-detached: one attached neighbour without further attachments', () => {
    const [a, b] = row(2);
    const r = analyseFootprint(a, [nb('b', b), nb('far', rect(30, 0, 6, 9))]);
    expect(r.builtForm).toBe('semi-detached');
    expect(r.edgeKinds).toEqual(['eave', 'party', 'eave', 'eave']);
    expect(r.sharedLength[1]).toBeCloseTo(9, 9);
    expect(r.partyNeighbours[1]).toEqual(['b']);
    expect(r.attached).toEqual(['b']);
  });
  it('end-terrace vs mid-terrace via the neighbour\'s own attachments', () => {
    const houses = row(4);
    const ns = (skip: number) => houses.map((p, i) => nb(`h${i}`, p)).filter((_, i) => i !== skip);
    expect(analyseFootprint(houses[0], ns(0)).builtForm).toBe('end-terrace');
    const mid = analyseFootprint(houses[1], ns(1));
    expect(mid.builtForm).toBe('mid-terrace');
    expect(mid.edgeKinds).toEqual(['eave', 'party', 'eave', 'party']);
    expect(mid.attached.sort()).toEqual(['h0', 'h2']);
    expect(analyseFootprint(houses[3], ns(3)).builtForm).toBe('end-terrace');
  });
  it('ancillary neighbours (garage, shed, tiny buildings, parts) never create party walls', () => {
    const house = rect(0, 0, 6, 9);
    const garage = rect(6, 0, 3, 6);
    const r = analyseFootprint(house, [nb('g', garage, { building: 'garage' }), nb('s', rect(-3, 0, 3, 4), { building: 'yes' }), nb('p', rect(0, 9, 6, 3), { 'building:part': 'yes' })]);
    expect(r.builtForm).toBe('detached');
    expect(r.edgeKinds.every((k) => k === 'eave')).toBe(true);
    expect(r.ancillaryAttached.sort()).toEqual(['g', 'p', 's']);
    expect(r.reasons.join(' ')).toMatch(/ancillary/);
  });
  it('tolerates digitising gaps up to 0.3 m but not 0.5 m', () => {
    expect(analyseFootprint(rect(0, 0, 6, 9), [nb('b', rect(6.25, 0, 6, 9))]).builtForm).toBe('semi-detached');
    expect(analyseFootprint(rect(0, 0, 6, 9), [nb('b', rect(6.5, 0, 6, 9))]).builtForm).toBe('detached');
  });
  it('a side becomes wholly party only when >= 60 % is shared; attachment needs >= 2 m', () => {
    const t = rect(0, 0, 6, 10);
    const p40 = analyseFootprint(t, [nb('b', rect(6, 6, 6, 9))]); // shares 4 m of the 10 m east wall
    expect(p40.edgeKinds[1]).toBe('eave');
    expect(p40.sharedLength[1]).toBeCloseTo(4, 9);
    expect(p40.builtForm).toBe('semi-detached');
    expect(p40.reasons.join(' ')).toMatch(/partly shared/);
    const p70 = analyseFootprint(t, [nb('b', rect(6, 3, 6, 9))]);
    expect(p70.edgeKinds[1]).toBe('party');
    expect(p70.sharedFraction[1]).toBeCloseTo(0.7, 9);
    const touch = analyseFootprint(t, [nb('b', rect(6, 8.5, 6, 9))]); // 1.5 m shared
    expect(touch.builtForm).toBe('detached');
  });
  it('multi-dwelling outlines and corner blocks are classified as block', () => {
    const t = rect(0, 0, 18, 9);
    expect(analyseFootprint(t, [], { targetTags: { building: 'terrace', 'addr:housenumber': '1-3' } }).builtForm).toBe('block');
    expect(analyseFootprint(t, [], { targetTags: { building: 'terrace' }, addressNumbersInside: ['1', '2', '3'] }).builtForm).toBe('block');
    expect(analyseFootprint(t, [], { targetTags: { building: 'house', 'addr:housenumber': '48' }, addressNumbersInside: ['48-49'] }).builtForm).toBe('detached');
    const corner = analyseFootprint(rect(0, 0, 6, 9), [nb('e', rect(6, 0, 6, 9)), nb('n', rect(0, 9, 6, 9))]);
    expect(corner.builtForm).toBe('block'); // attached on two adjacent sides (90 deg apart)
    const three = analyseFootprint(rect(0, 0, 6, 9), [nb('e', rect(6, 0, 6, 9)), nb('w', rect(-6, 0, 6, 9)), nb('n', rect(0, 9, 6, 9))]);
    expect(three.builtForm).toBe('block');
  });
  it('flags multi-dwelling outlines (multiDwelling) separately from corner blocks', () => {
    const t = rect(0, 0, 18, 9);
    const pt = (x: number, y: number, tags: Record<string, string>) => ({ xy: [x, y] as Vec2, tags });
    const multi = (p: PolygonM, opts: Parameters<typeof analyseFootprint>[2], nbs: FootprintNeighbour[] = []) => analyseFootprint(p, nbs, opts);
    // (a) own number list, (b) block of flats, (c) distinct numbers inside, (d) row of named cottages, (e) large terrace
    const yes: [string, ReturnType<typeof analyseFootprint>][] = [
      ['own list', multi(t, { targetTags: { building: 'yes', 'addr:housenumber': '2;4;6' } })],
      ['apartments', multi(rect(0, 0, 14, 12), { targetTags: { building: 'apartments', 'addr:housenumber': '7' } })],
      ['numbers inside (legacy strings)', multi(t, { targetTags: { building: 'terrace' }, addressNumbersInside: ['1', '2', '3'] })],
      ['own number + another inside', multi(t, { targetTags: { building: 'house', 'addr:housenumber': '20' }, addressPoints: [pt(3, 4.5, { 'addr:housenumber': '20' }), pt(15, 4.5, { 'addr:housenumber': '24' })] })],
      ['row of named cottages', multi(rect(0, 0, 24, 7), { targetTags: { building: 'yes' }, addressPoints: [pt(3, 3.5, { 'addr:housename': 'Rose Cottage' }), pt(12, 3.5, { 'addr:housename': 'Ivy Cottage' })] })],
      ['large unnumbered terrace', multi(rect(0, 0, 20, 9), { targetTags: { building: 'terrace' } })],
    ];
    for (const [name, r] of yes) {
      expect(r.multiDwelling, name).toBe(true);
      expect(r.builtForm, name).toBe('block');
      expect(r.reasons.join(' '), name).toMatch(/several dwellings/);
    }
    const no: [string, ReturnType<typeof analyseFootprint>][] = [
      // 48 Doughty Street: the museum node "48-49" inside the house numbered 48 is one dwelling
      ['own number + museum range node', multi(rect(0, 0, 6, 10.4), { targetTags: { building: 'house', 'addr:housenumber': '48' }, addressPoints: [pt(3, 5, { 'addr:housenumber': '48-49', tourism: 'museum' })] })],
      // a neighbour's address node digitised on the shared wall (0.2 m inside) is ignored
      ['stray node at the party wall', multi(rect(0, 0, 6, 9), { targetTags: { building: 'house', 'addr:housenumber': '20' }, addressPoints: [pt(5.8, 4.5, { 'addr:housenumber': '22' }), pt(9, 4.5, { 'addr:housenumber': '22' })] }, [nb('n', rect(6, 0, 6, 9))])],
      ['long single house, one address point', multi(rect(0, 0, 21, 6), { targetTags: { building: 'yes' }, addressPoints: [pt(10, 3, { 'addr:housenumber': '5' })] })],
      ['small unnumbered terrace house', multi(rect(0, 0, 5, 9), { targetTags: { building: 'terrace' } })],
      ['semi with its own number', multi(rect(0, 0, 7, 9), { targetTags: { building: 'semidetached_house', 'addr:housenumber': '251' } }, [nb('n', rect(7, 0, 7, 9))])],
    ];
    for (const [name, r] of no) expect(r.multiDwelling, name).toBe(false);
    expect(no[1][1].builtForm).toBe('semi-detached');
    // attached on two adjacent sides: a corner 'block' built form, but one dwelling
    const corner = analyseFootprint(rect(0, 0, 6, 9), [nb('e', rect(6, 0, 6, 9)), nb('n', rect(0, 9, 6, 9))]);
    expect(corner.builtForm).toBe('block');
    expect(corner.multiDwelling).toBe(false);
  });
  it('keeps the caller\'s edge order for clockwise input and covers hole edges', () => {
    const cw: PolygonM = { outer: [[0, 0], [0, 9], [6, 9], [6, 0]] }; // edge 2 = east wall
    const r = analyseFootprint(cw, [nb('b', rect(6, 0, 6, 9))]);
    expect(r.edgeKinds).toEqual(['eave', 'eave', 'party', 'eave']);
    const holed: PolygonM = { outer: rect(0, 0, 20, 20).outer, holes: [[[5, 5], [5, 15], [15, 15], [15, 5]]] };
    const h = analyseFootprint(holed, [nb('court', rect(5, 5, 10, 10))]);
    expect(h.edgeKinds).toHaveLength(8);
    expect(h.edgeKinds.slice(4).every((k) => k === 'party')).toBe(true);
  });
  it('reports tag disagreements', () => {
    const r = analyseFootprint(rect(0, 0, 6, 9), [], { targetTags: { building: 'semidetached_house' } });
    expect(r.builtForm).toBe('detached');
    expect(r.reasons.join(' ')).toMatch(/OSM tags suggest semi-detached/);
  });
});

describe('tags and frame helpers', () => {
  it('expands house numbers and recognises ancillary tags', () => {
    expect(expandHouseNumbers('48-49')).toEqual([48, 49]);
    expect(expandHouseNumbers('10;12')).toEqual([10, 12]);
    expect(expandHouseNumbers('10A')).toEqual([10]);
    expect(expandHouseNumbers(undefined)).toEqual([]);
    expect(isAncillaryTags({ building: 'garage' })).toBe(true);
    expect(isAncillaryTags({ building: 'house' })).toBe(false);
    expect(isAncillaryTags({ 'building:part': 'yes' })).toBe(true);
    expect(normaliseStreetName("Doughty St.")).toBe('doughty street');
  });
  it('converts lon/lat rings to local ENU and back (mm round trip), orients polygons, centres frames', () => {
    const f = makeFrame(53.37, -2.88);
    const ring: [number, number][] = [[-2.8801, 53.3701], [-2.8799, 53.3701], [-2.8799, 53.3702], [-2.8801, 53.3702], [-2.8801, 53.3701]];
    const back = localToLonLat(f, lonLatToLocal(f, ring));
    back.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(ring[i][0], 12);
      expect(p[1]).toBeCloseTo(ring[i][1], 12);
    });
    const poly = polygonToLocal(f, ring.slice().reverse());
    expect(poly.outer).toHaveLength(4); // closing duplicate dropped
    expect(ringArea(poly.outer)).toBeGreaterThan(0); // CCW
    const fc = frameAtCentroid(ring);
    const c = polygonToLocal(fc, ring).outer.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
    expect(Math.hypot(c[0], c[1])).toBeLessThan(1e-6);
  });
});
