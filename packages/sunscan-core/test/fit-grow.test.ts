// Outline growth: a map outline that stops short of the roof the LiDAR sees (stale or offset mapping) is pushed
// out to where the roof really ends, before the roof is fitted. Seen on 3A Downs Walk, Peacehaven: the south
// eave of the OSM outline sat ~1 m inside the roof, the equal-eave gable could only reach the 3.7 m eave by
// making the south slope 63 degrees, and the house was reported with no usable roof at all.
import { describe, it, expect } from 'vitest';
import { growOutline } from '../src/fit/grow.js';
import type { HeightGrid } from '../src/types.js';
import type { PolygonM } from '../src/geometry/geom.js';

const RES = 0.5;
const ORIGIN_X = -10;
const ORIGIN_Y = 22;
const SIZE = 80;

/** A grid whose height at (x, y) is f(x, y). */
function grid(f: (x: number, y: number) => number): HeightGrid {
  const data = new Float32Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) data[r * SIZE + c] = f(ORIGIN_X + (c + 0.5) * RES, ORIGIN_Y - (r + 0.5) * RES);
  }
  return { width: SIZE, height: SIZE, originX: ORIGIN_X, originY: ORIGIN_Y, res: RES, data };
}

/** A 14 x 12 m house, x 0..14, y 0..12: gable with a ridge along x at y = 6, 35 degree slopes, 3.5 m eaves. */
const house = (x: number, y: number) =>
  x >= 0 && x <= 14 && y >= 0 && y <= 12 ? 3.5 + Math.tan((35 * Math.PI) / 180) * (6 - Math.abs(y - 6)) : 0;
const ground = grid(() => 0);
const rect = (x0: number, y0: number, x1: number, y1: number): PolygonM => ({
  outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
  holes: [],
});
const ALL_FREE = ['eave', 'gable', 'eave', 'gable'] as const;

function bounds(p: PolygonM) {
  const xs = p.outer.map((v) => v[0]);
  const ys = p.outer.map((v) => v[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('growOutline', () => {
  it('pushes a short eave edge out to where the roof really ends', () => {
    const dsm = grid(house);
    const short = rect(0, 1.5, 14, 12); // the south edge stops 1.5 m inside the roof
    const out = growOutline(short, [...ALL_FREE], dsm, ground, undefined, []);
    const b = bounds(out.poly);
    expect(out.grown).toBe(true);
    expect(b.minY).toBeGreaterThan(-0.6);
    expect(b.minY).toBeLessThan(0.6);
    // the other three edges were already right and stay put
    expect(b.maxY).toBeCloseTo(12, 1);
    expect(b.minX).toBeCloseTo(0, 1);
    expect(b.maxX).toBeCloseTo(14, 1);
  });

  it('leaves an outline that already fits the roof alone', () => {
    const out = growOutline(rect(0, 0, 14, 12), [...ALL_FREE], grid(house), ground, undefined, []);
    expect(out.grown).toBe(false);
    expect(bounds(out.poly)).toEqual({ minX: 0, maxX: 14, minY: 0, maxY: 12 });
  });

  it('does not grow into the house next door', () => {
    // a neighbour built hard against the south wall, as tall as the eaves
    const dsm = grid((x, y) => (x >= 0 && x <= 14 && y >= -6 && y < 0 ? 4 : house(x, y)));
    const out = growOutline(rect(0, 1.5, 14, 12), [...ALL_FREE], dsm, ground, undefined, [rect(0, -6, 14, 0)]);
    expect(bounds(out.poly).minY).toBeGreaterThan(-0.6);
  });

  it('does not grow into trees: the last return sees through them', () => {
    const trees = (x: number, y: number) => (x >= 0 && x <= 14 && y >= -4 && y < 0 ? 8 : 0);
    const dsm = grid((x, y) => Math.max(house(x, y), trees(x, y)));
    const dsmLast = grid(house);
    const out = growOutline(rect(0, 0, 14, 12), [...ALL_FREE], dsm, ground, dsmLast, []);
    expect(out.grown).toBe(false);
  });

  it('never moves a party wall', () => {
    const out = growOutline(rect(0, 1.5, 14, 12), ['party', 'gable', 'eave', 'gable'], grid(house), ground, undefined, []);
    expect(bounds(out.poly).minY).toBeCloseTo(1.5, 1);
  });
});
