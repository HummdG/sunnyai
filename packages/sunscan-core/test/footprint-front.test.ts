import { describe, expect, it } from 'vitest';
import { frontEdge, type FrontRoad } from '../src/footprint/index.js';
import type { EdgeKind, PolygonM, Vec2 } from '../src/types.js';

// 8 x 10 m house, CCW from the south-west corner: edge 0 = south, 1 = east, 2 = north, 3 = west
const house: PolygonM = { outer: [[0, 0], [8, 0], [8, 10], [0, 10]] };
const eaves: EdgeKind[] = ['eave', 'eave', 'eave', 'eave'];
const road = (name: string | undefined, kind: string, line: Vec2[]): FrontRoad => ({ name, kind, line });
const south = (d: number, name = 'Forthlin Road', kind = 'residential') => road(name, kind, [[-50, -d], [60, -d]]);
const north = (d: number, name?: string, kind = 'residential') => road(name, kind, [[-50, 10 + d], [60, 10 + d]]);

describe('frontEdge', () => {
  it('faces the only street; the back is the opposite wall', () => {
    const r = frontEdge(house, eaves, [south(8)])!;
    expect(r).toMatchObject({ edge: 0, back: 2, method: 'road', road: 'Forthlin Road' });
    expect(r.score).toBeCloseTo(1 / 8, 2);
  });
  it('an entrance node on a wall fixes the front', () => {
    const r = frontEdge(house, eaves, [south(8)], [8.02, 5])!;
    expect(r).toMatchObject({ edge: 1, back: 3, method: 'entrance' });
    expect(frontEdge(house, eaves, [south(8)], [20, 5])!.method).toBe('road'); // too far from any wall
  });
  it('prefers the addr:street road (x2) and penalises service/footway (x0.5)', () => {
    expect(frontEdge(house, eaves, [south(8), north(5)])!.edge).toBe(2); // nearer unnamed street
    expect(frontEdge(house, eaves, [south(8), north(5)], undefined, 'Forthlin Rd')!.edge).toBe(0); // 2/8 > 1/5
    expect(frontEdge(house, eaves, [north(3, undefined, 'footway'), south(5)])!.edge).toBe(0); // 0.5/3 < 1/5
  });
  it('a hit on the addr:street road outranks nearer minor ways (garden paths)', () => {
    const roads = [north(3, undefined, 'path'), south(40, 'Luxted Road')];
    expect(frontEdge(house, eaves, roads)!.edge).toBe(2); // 0.5/3 > 1/40
    const r = frontEdge(house, eaves, roads, undefined, 'Luxted Road')!;
    expect(r.edge).toBe(0);
    expect(r.reasons[0]).toMatch(/addr:street/);
  });
  it('never picks a party wall: terraces choose between the two free walls', () => {
    const terrace: EdgeKind[] = ['eave', 'party', 'eave', 'party'];
    const r = frontEdge(house, terrace, [road('High Street', 'residential', [[20, -50], [20, 60]]), south(6)])!;
    expect(r.edge).toBe(0);
    expect(r.back).toBe(2);
    expect(frontEdge(house, ['party', 'party', 'party', 'party'], [south(5)])).toBeNull();
  });
  it('falls back to the road nearest in front of a wall, then to the longest free wall', () => {
    const diagonal = road('Lane', 'residential', [[70, -70], [140, -10]]); // no ray hits within 60 m
    const r = frontEdge(house, eaves, [diagonal])!;
    expect(r.method).toBe('nearest-road');
    expect([0, 1]).toContain(r.edge);
    const none = frontEdge(house, eaves, [])!;
    expect(none.method).toBe('longest-edge');
    expect([1, 3]).toContain(none.edge); // the 10 m walls
  });
  it('works for clockwise rings (outward normals follow the orientation)', () => {
    const cw: PolygonM = { outer: [[0, 0], [0, 10], [8, 10], [8, 0]] }; // edge 3 = south wall (8,0)->(0,0)
    const r = frontEdge(cw, eaves, [south(8)])!;
    expect(r.edge).toBe(3);
    expect(r.back).toBe(1);
  });
});
