// packages/core/test/clip.test.ts
import { describe, it, expect } from 'vitest';
import { clipHalfPlane, convexIntersect, convexMinus, ringArea2 } from '../src/geometry/clip.js';
import type { Vec2 } from '../src/geometry/geom.js';

const sq = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const area = (rs: Vec2[][]) => rs.reduce((s, r) => s + ringArea2(r), 0);

describe('geometry/clip', () => {
  it('clips a square by a half-plane', () => {
    const r = clipHalfPlane(sq(0, 0, 2, 2), { n: [1, 0], c: 0.5 });
    expect(ringArea2(r)).toBeCloseTo(3, 12);
    expect(ringArea2(clipHalfPlane(sq(0, 0, 2, 2), { n: [1, 0], c: 5 }))).toBe(0);
  });
  it('intersects convex polygons (rotated)', () => {
    const a = sq(0, 0, 4, 4);
    const b: Vec2[] = [[2, -1], [5, 2], [2, 5], [-1, 2]]; // diamond centred (2,2)
    const i = convexIntersect(a, b);
    expect(ringArea2(i)).toBeCloseTo(16 - 4 * 0.5, 9); // corners cut: 4 triangles of area 0.5
    expect(ringArea2(i)).toBeGreaterThan(0);
  });
  it('a \\ b tiles exactly with a ∩ b', () => {
    const a = sq(0, 0, 10, 6), b = sq(4, -1, 7, 3);
    const parts = convexMinus(a, b);
    expect(area(parts) + ringArea2(convexIntersect(a, b))).toBeCloseTo(60, 9);
    for (const p of parts) expect(ringArea2(p)).toBeGreaterThan(0);
  });
  it('a \\ b is empty when b covers a and a when disjoint', () => {
    expect(convexMinus(sq(1, 1, 2, 2), sq(0, 0, 3, 3))).toEqual([]);
    expect(area(convexMinus(sq(0, 0, 1, 1), sq(5, 5, 6, 6)))).toBeCloseTo(1, 12);
  });
});
