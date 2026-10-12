import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { computeSkeleton, loopAreaXY, type Skeleton } from '../src/geometry/skeleton.js';
import { buildRoof, type EdgeKind } from '../src/geometry/roof.js';
import { envelopeHeight, linfHeight } from './support/alternatives.js';
import { RECT_10x6, SQUARE_8, regularPolygon, randomOrtho, randomStar, noisy, L_SHAPE, T_SHAPE, rect } from './support/cases.js';
import { polygonArea, bboxDiag, isSimple, mulberry32, pointInPolygon, type PolygonM, type Vec2 } from '../src/geometry/geom.js';

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const nodeSet = (sk: Skeleton) => sk.nodes.filter((n) => n.t > 1e-9).map((n) => [n.x, n.y, n.t].map((v) => +v.toFixed(6)).join(','));

/** Independent invariants: projected faces tile the footprint; every face node lies on its edge's offset line. */
function invariants(poly: PolygonM, sk: Skeleton) {
  const S = bboxDiag(poly);
  let sA = 0, sAbs = 0, worst = 0;
  for (const f of sk.faces) {
    // sloped faces + flat caps (regions enclosed only by vertical edges stop moving and get a flat top)
    for (const l of f.loops) { const a = loopAreaXY(sk.nodes, l); if (f.w > 0 || f.key === 'cap') { sA += a; sAbs += Math.abs(a); } }
    if (f.edge < 0) continue;
    const e = sk.edges[f.edge];
    if (e.profile.length !== 1) continue;
    for (const l of f.loops) for (const id of l) {
      const n = sk.nodes[id];
      worst = Math.max(worst, Math.abs(e.n[0] * n.x + e.n[1] * n.y - e.c - e.profile[0].w * n.t));
    }
  }
  const A = polygonArea(poly);
  return { tileErr: Math.max(Math.abs(sA - A), Math.abs(sAbs - A)) / A, planeErr: worst / S, warnings: sk.stats.warnings, minT: Math.min(...sk.nodes.map((n) => n.t)) };
}

describe('weighted straight skeleton: exact small cases', () => {
  it('10x6 hipped: ridge (3,3)-(7,3) at t = 3', () => {
    const sk = computeSkeleton(RECT_10x6, { weights: () => 1 });
    expect(nodeSet(sk).sort()).toEqual(['3,3,3', '7,3,3']);
    expect(sk.faces).toHaveLength(4);
  });
  it('10x6 gabled (short edges w = 0): ridge runs gable to gable', () => {
    const sk = computeSkeleton(RECT_10x6, { weights: (i) => (i % 2 ? 0 : 1) });
    expect(nodeSet(sk).sort()).toEqual(['0,3,3', '10,3,3']);
  });
  it('square: 4-way event -> single apex', () => {
    const sk = computeSkeleton(SQUARE_8, { weights: () => 1 });
    expect(nodeSet(sk)).toEqual(['4,4,4']);
  });
  it('regular 40-gon: 40-way event -> single apex, 40 triangular faces', () => {
    const p = regularPolygon(40, 8);
    const sk = computeSkeleton(p, { weights: () => 1 });
    expect(sk.nodes.filter((n) => n.t > 1e-6)).toHaveLength(1);
    expect(sk.faces.every((f) => f.loops[0].length === 3)).toBe(true);
  });
  it('skillion (one moving edge) on a rectangle is a single plane', () => {
    const sk = computeSkeleton(RECT_10x6, { weights: (i) => (i === 0 ? 1 : 0) });
    const sloped = sk.faces.filter((f) => f.w > 0);
    expect(sloped).toHaveLength(1);
    expect(near(loopAreaXY(sk.nodes, sloped[0].loops[0]), 60)).toBe(true);
  });
  it('collinear edges with different speeds get a vertical riser', () => {
    const sk = computeSkeleton({ outer: [[0, 0], [10, 0], [10, 6], [5, 6], [0, 6]] }, { weights: (i) => (i === 3 ? 0 : 1) });
    expect(sk.stats.risers).toBe(1);
    expect(invariants({ outer: [[0, 0], [10, 0], [10, 6], [5, 6], [0, 6]] }, sk).tileErr).toBeLessThan(1e-12);
  });
});

// CGAL oracle (GPL wrapper) is a test-only, optional dev dependency: the comparison runs only where
// `straight-skeleton@3` is installed (e.g. research/roofs); it is never shipped with the product.
const requireCjs = createRequire(import.meta.url);
const hasCgal = (() => { try { requireCjs.resolve('straight-skeleton'); return true; } catch { return false; } })();

describe('weighted straight skeleton vs independent oracles', () => {
  let SkeletonBuilder: any;
  beforeAll(async () => {
    if (!hasCgal) return;
    (globalThis as any).self ??= globalThis;
    (globalThis as any).window ??= globalThis;
    SkeletonBuilder = requireCjs('straight-skeleton').SkeletonBuilder;
    await SkeletonBuilder.init();
  });

  it.skipIf(!hasCgal)('equal weights: node sets match CGAL (straight-skeleton@3) on 120 random polygons', () => {
    let compared = 0;
    for (let i = 0; i < 120; i++) {
      const rnd = mulberry32(i + 5000);
      const poly: PolygonM = i % 3 === 0 ? randomStar(8 + Math.floor(rnd() * 40), i) : i % 3 === 1 ? randomOrtho(i + 300, 8, 50) : { outer: rect(20, 14), holes: [rect(4 + 4 * rnd(), 3 + 3 * rnd(), 3 + 6 * rnd(), 3 + 4 * rnd()).reverse()] };
      if (!isSimple(poly)) continue;
      // CGAL wrapper serialises input as float32: give both the same float32-exact input
      const p32: PolygonM = { outer: poly.outer.map(([x, y]) => [Math.fround(x), Math.fround(y)] as Vec2), holes: (poly.holes ?? []).map((h) => h.map(([x, y]) => [Math.fround(x), Math.fround(y)] as Vec2)) };
      const cg = SkeletonBuilder.buildFromPolygon([[...p32.outer, p32.outer[0]], ...(p32.holes ?? []).map((h) => [...h, h[0]])]);
      if (!cg) continue;
      const sk = computeSkeleton(p32, { weights: () => 1 });
      const S = bboxDiag(poly), tol = 2e-6 * S;
      const A = sk.nodes.filter((n) => n.t > tol), B = cg.vertices.filter((v: number[]) => v[2] > tol);
      for (const v of B) expect(A.some((n) => near(n.x, v[0], tol) && near(n.y, v[1], tol) && near(n.t, v[2], tol))).toBe(true);
      for (const n of A) expect(B.some((v: number[]) => near(n.x, v[0], tol) && near(n.y, v[1], tol) && near(n.t, v[2], tol))).toBe(true);
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('convex polygons, random per-edge weights incl. 0: roof == lower envelope of the eave planes', () => {
    for (let i = 0; i < 200; i++) {
      const rnd = mulberry32(i + 9000);
      const n = 3 + Math.floor(rnd() * 12);
      const angles = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b);
      const R = 4 + 6 * rnd();
      const poly: PolygonM = { outer: angles.map((a) => [R * Math.cos(a), R * Math.sin(a)] as Vec2) };
      if (Math.abs(polygonArea(poly)) < 1 || !isSimple(poly)) continue;
      const pitches: number[] = poly.outer.map(() => (rnd() < 0.25 ? 90 : 15 + 60 * rnd())); // 90 = vertical (gable / party)
      if (!pitches.some((p) => p !== 90)) pitches[0] = 30;
      const kinds: EdgeKind[] = pitches.map((p) => (p === 90 ? 'gable' : 'eave'));
      const roof = buildRoof(poly, kinds, { type: 'skeleton', eaveHeight: 0, edgePitchDeg: pitches.map((p) => (p === 90 ? undefined : p)) }, { collinearTolDeg: 0 });
      // weighted envelope: z = min_e tan(p_e) * dist(p, line_e) over eaves
      const env = (p: Vec2) => Math.min(...poly.outer.map((a, k) => {
        if (kinds[k] !== 'eave') return Infinity;
        const b = poly.outer[(k + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const d = ((p[0] - a[0]) * -(b[1] - a[1]) + (p[1] - a[1]) * (b[0] - a[0])) / L;
        return Math.tan((pitches[k] * Math.PI) / 180) * d;
      }));
      for (let s = 0; s < 40; s++) {
        const p: Vec2 = [(rnd() * 2 - 1) * R, (rnd() * 2 - 1) * R];
        if (!pointInPolygon(p, poly)) continue;
        const h = roof.heightAt(p);
        expect(h).not.toBeNull();
        expect(Math.abs(h! - env(p))).toBeLessThan(1e-7 * R);
      }
    }
  });

  it('rectilinear polygons (hipped): roof == tan(p) * L_inf distance to the boundary', () => {
    const tanP = Math.tan((35 * Math.PI) / 180);
    for (let i = 0; i < 40; i++) {
      const poly = randomOrtho(i + 77, 6, 60);
      const roof = buildRoof(poly, poly.outer.map(() => 'eave'), { type: 'hipped', eaveHeight: 0, pitchDeg: 35 });
      const ref = linfHeight(poly, tanP);
      const rnd = mulberry32(i);
      const xs = poly.outer.map((p) => p[0]), ys = poly.outer.map((p) => p[1]);
      for (let s = 0; s < 200; s++) {
        const p: Vec2 = [Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys))];
        const r = ref(p);
        if (r === null) continue;
        expect(Math.abs(roof.heightAt(p)! - r)).toBeLessThan(1e-9);
      }
    }
  });

  it('non-convex polygons with random kinds/weights: faces tile the footprint, every node on its face plane', () => {
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const rnd = mulberry32(i + 123);
      const poly: PolygonM = i % 3 === 0 ? randomStar(6 + Math.floor(rnd() * 40), i + 1) : i % 3 === 1 ? randomOrtho(i + 11, 6, 50) : noisy(i % 2 ? L_SHAPE : T_SHAPE, i, 0.05);
      if (!isSimple(poly)) continue;
      const w: number[] = poly.outer.map(() => (rnd() < 0.3 ? 0 : 0.3 + 2 * rnd()));
      if (!w.some((x) => x !== 0)) w[0] = 1;
      const sk = computeSkeleton(poly, { weights: (k) => w[k] });
      const inv = invariants(poly, sk);
      expect(inv.warnings).toEqual([]);
      expect(inv.tileErr).toBeLessThan(1e-9);
      expect(inv.planeErr).toBeLessThan(1e-9);
      expect(inv.minT).toBeGreaterThanOrEqual(0);
      n++;
    }
    expect(n).toBeGreaterThan(250);
  });

  it('envelope (d) is NOT valid for non-convex shapes (documented failure)', () => {
    const roof = buildRoof(L_SHAPE, Array(6).fill('eave'), { type: 'hipped', eaveHeight: 0, pitchDeg: 45 });
    const env = envelopeHeight(L_SHAPE, Array(6).fill('eave'), 1);
    // a point in the main body near the extension of the wing's inner wall (x = 6)
    expect(Math.abs(roof.heightAt([6.05, 2])! - env([6.05, 2])!)).toBeGreaterThan(1.5);
  });
});
