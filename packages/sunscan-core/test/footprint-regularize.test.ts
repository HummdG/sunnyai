import { describe, expect, it } from 'vitest';
import { mapEdgeKinds, regularizeFootprint, regularizeFootprintDetailed } from '../src/footprint/index.js';
import { isSimple, mulberry32, polygonArea, ringArea, type PolygonM, type Vec2 } from '../src/geometry/geom.js';

const rot = (p: Vec2[], deg: number, c: Vec2 = [0, 0]): Vec2[] => {
  const a = (deg * Math.PI) / 180;
  return p.map(([x, y]) => [c[0] + (x - c[0]) * Math.cos(a) - (y - c[1]) * Math.sin(a), c[1] + (x - c[0]) * Math.sin(a) + (y - c[1]) * Math.cos(a)]);
};
/** Interior angle at every vertex, degrees. */
const angles = (r: Vec2[]) => r.map((v, i) => {
  const p = r[(i - 1 + r.length) % r.length];
  const n = r[(i + 1) % r.length];
  const a = Math.atan2(p[1] - v[1], p[0] - v[0]) - Math.atan2(n[1] - v[1], n[0] - v[0]);
  return Math.abs((((a * 180) / Math.PI) % 360 + 360) % 360);
});
const isRight = (deg: number) => Math.abs(deg - 90) < 1e-6 || Math.abs(deg - 270) < 1e-6;
const edgeLens = (r: Vec2[]) => r.map((v, i) => Math.hypot(r[(i + 1) % r.length][0] - v[0], r[(i + 1) % r.length][1] - v[1]));

describe('regularizeFootprint', () => {
  it('snaps a noisy rotated rectangle to exact right angles about its dominant axis', () => {
    const noisy: Vec2[] = rot([[0, 0], [10, 0.25], [9.9, 6.1], [-0.15, 5.95]], 30);
    const r = regularizeFootprintDetailed({ outer: noisy });
    expect(r.orthogonalized).toBe(true);
    expect(r.polygon.outer).toHaveLength(4);
    expect(angles(r.polygon.outer).every(isRight)).toBe(true);
    expect(r.axisDeg).toBeGreaterThan(29);
    expect(r.axisDeg).toBeLessThan(32);
    expect(Math.abs(r.areaChange)).toBeLessThan(0.02);
    expect(ringArea(r.polygon.outer)).toBeGreaterThan(0);
  });
  it('merges collinear vertices, drops micro-edges and keeps real chamfers', () => {
    const L: Vec2[] = [[0, 0], [5, 0.02], [10, 0], [10, 4], [10.15, 4], [10.15, 6], [4, 6], [4, 12], [0, 12]];
    const r = regularizeFootprintDetailed({ outer: rot(L, -12) });
    expect(r.orthogonalized).toBe(true);
    expect(r.polygon.outer).toHaveLength(6); // L-shape: the 0.15 m jog and the collinear vertex are gone
    expect(angles(r.polygon.outer).every(isRight)).toBe(true);
    expect(Math.min(...edgeLens(r.polygon.outer))).toBeGreaterThanOrEqual(0.3);
    const chamfer: Vec2[] = [[0, 0], [10, 0], [10, 6], [2, 6], [0, 4]]; // 45 deg, 2.8 m: a real bay corner
    const c = regularizeFootprint({ outer: chamfer });
    expect(c.outer).toHaveLength(5);
    const micro: Vec2[] = [[0, 0], [10, 0], [10, 6], [0.15, 6], [0, 5.85]]; // 0.2 m chamfer: digitising noise
    expect(regularizeFootprint({ outer: micro }).outer).toHaveLength(4);
  });
  it('does not snap edges deviating more than maxDeviationDeg', () => {
    const para: Vec2[] = [[0, 0], [10, 0], [12, 8], [2, 8]]; // sides 14 deg off the perpendicular
    const r = regularizeFootprintDetailed({ outer: para });
    const a = angles(r.polygon.outer);
    expect(a.some((x) => Math.abs(x - 90) > 10)).toBe(true);
    expect(Math.abs(r.areaChange)).toBeLessThan(1e-9);
  });
  it('refuses results that change the area by more than the limit (cleaning only)', () => {
    const noisy: Vec2[] = rot([[0, 0], [10, 0.5], [10.3, 6.4], [-0.4, 6]], 5); // snapping changes the area by ~3e-4
    expect(regularizeFootprintDetailed({ outer: noisy }).orthogonalized).toBe(true);
    const r = regularizeFootprintDetailed({ outer: noisy }, { maxAreaChange: 1e-5 });
    expect(r.orthogonalized).toBe(false);
    expect(r.notes.join(' ')).toMatch(/rejected/);
    expect(Math.abs(r.areaChange)).toBeLessThan(1e-5);
  });
  it('handles holes (outer CCW, holes CW) and leaves exact rectangles untouched', () => {
    const outer = rot([[0, 0], [20, 0], [20, 20], [0, 20]], 3);
    const hole = rot([[6, 6], [6, 14.1], [14, 14], [14.1, 6]], 3);
    const r = regularizeFootprint({ outer, holes: [hole] });
    expect(ringArea(r.outer)).toBeGreaterThan(0);
    expect(ringArea(r.holes![0])).toBeLessThan(0);
    expect(angles(r.holes![0]).every(isRight)).toBe(true);
    const exact: PolygonM = { outer: [[0, 0], [8, 0], [8, 6], [0, 6]] };
    const e = regularizeFootprintDetailed(exact);
    expect(Math.abs(e.areaChange)).toBeLessThan(1e-12);
    expect(polygonArea(e.polygon)).toBeCloseTo(48, 9);
  });
  it('maps per-edge kinds through merges and orientation changes', () => {
    // clockwise input with a collinear vertex on the party wall (edges 1 and 2 are both party)
    const cw: PolygonM = { outer: [[0, 0], [0, 9], [3, 9], [6, 9], [6, 0]] };
    const kinds = ['eave', 'party', 'party', 'eave', 'eave'];
    const r = regularizeFootprintDetailed(cw);
    expect(r.polygon.outer).toHaveLength(4);
    const mapped = mapEdgeKinds(r, kinds, cw);
    expect(mapped.filter((k) => k === 'party')).toHaveLength(1);
    const north = r.polygon.outer.findIndex((v, i) => {
      const w = r.polygon.outer[(i + 1) % 4];
      return Math.abs(v[1] - 9) < 1e-9 && Math.abs(w[1] - 9) < 1e-9;
    });
    expect(mapped[north]).toBe('party');
  });
  it('fuzz: 400 noisy rotated orthogonal footprints stay simple, keep >= minEdge and change area < 2 %', () => {
    const rnd = mulberry32(42);
    const shapes = [
      (a: number, b: number) => [[0, 0], [a, 0], [a, b], [0, b]] as Vec2[],
      (a: number, b: number) => [[0, 0], [a, 0], [a, b * 0.4], [a * 0.5, b * 0.4], [a * 0.5, b], [0, b]] as Vec2[],
      (a: number, b: number) => [[0, 0], [a, 0], [a, b], [a * 0.7, b], [a * 0.7, b * 1.4], [a * 0.3, b * 1.4], [a * 0.3, b], [0, b]] as Vec2[],
    ];
    let snapped = 0;
    for (let k = 0; k < 400; k++) {
      const base = shapes[k % shapes.length](5 + rnd() * 10, 4 + rnd() * 8).map(([x, y]) => [x + (rnd() - 0.5) * 0.06, y + (rnd() - 0.5) * 0.06] as Vec2);
      const outer = rot(base, rnd() * 180, [3, 3]);
      const r = regularizeFootprintDetailed({ outer });
      expect(isSimple(r.polygon)).toBe(true);
      expect(Math.abs(r.areaChange)).toBeLessThan(0.02);
      expect(ringArea(r.polygon.outer)).toBeGreaterThan(0);
      expect(Math.min(...edgeLens(r.polygon.outer))).toBeGreaterThanOrEqual(0.3 - 1e-9);
      if (r.orthogonalized && angles(r.polygon.outer).every(isRight)) snapped++;
    }
    expect(snapped / 400).toBeGreaterThan(0.97);
  });
});
