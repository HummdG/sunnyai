// Engine-level robustness of the weighted straight skeleton: nearly antiparallel / parallel edge pairs (the walls of
// rotated or re-projected plans), zero-area wavefront cycles, result validation, the dominant-axis retry and the typed
// SkeletonError. See docs/research/03-roof-geometry.md section 8.
import { describe, it, expect } from 'vitest';
import { computeSkeleton, dominantAxis, loopAreaXY, SkeletonError, validateSkeleton, type Skeleton } from '../src/geometry/skeleton.js';
import { buildRoof } from '../src/geometry/roof.js';
import { bboxDiag, polygonArea, type PolygonM, type Vec2 } from '../src/geometry/geom.js';
import { rot, rectPts } from './fixtures/geometry/invariants.js';

/** Independent invariants (as skeleton.test.ts): faces tile the footprint, nodes on their offset lines, bbox, times. */
function invariants(poly: PolygonM, sk: Skeleton) {
  const S = bboxDiag(poly);
  let sA = 0, sAbs = 0, worst = 0;
  for (const f of sk.faces) {
    if (f.w > 0 || f.key === 'cap') {
      const a = f.loops.reduce((s, l) => s + loopAreaXY(sk.nodes, l), 0);
      sA += a; sAbs += Math.abs(a);
    }
    if (f.edge < 0) continue;
    const e = sk.edges[f.edge];
    if (e.profile.length !== 1 || e.virtual) continue;
    for (const l of f.loops) for (const id of l) {
      const n = sk.nodes[id];
      worst = Math.max(worst, Math.abs(e.n[0] * n.x + e.n[1] * n.y - e.c - e.profile[0].w * n.t));
    }
  }
  const xs = poly.outer.map((p) => p[0]), ys = poly.outer.map((p) => p[1]);
  const out = sk.nodes.filter((n) => !(n.x >= Math.min(...xs) - 1e-6 * S && n.x <= Math.max(...xs) + 1e-6 * S && n.y >= Math.min(...ys) - 1e-6 * S && n.y <= Math.max(...ys) + 1e-6 * S));
  const A = polygonArea(poly);
  return { tileErr: Math.max(Math.abs(sA - A), Math.abs(sAbs - A)) / A, planeErr: worst / S, outside: out.length, warnings: sk.stats.warnings };
}

/** 20 x 10 block with a 2.9 x 1.03 bump on the south wall whose side walls lean by +-delta/2 (nearly antiparallel). */
function bump(delta: number, angle = 0.3): PolygonM {
  const d = 1.03, h = (d * Math.tan(delta / 2));
  const pts: Vec2[] = [[0, 0], [8, 0], [8 + h, -d], [10.9 - h, -d], [10.9, 0], [20, 0], [20, 10], [0, 10]];
  return { outer: rot(pts, angle, 4.2, -7.7) };
}

describe('nearly antiparallel walls (the ridge of a rotated plan) never produce runaway vertices', () => {
  for (const delta of [0, 1e-14, 1e-11, 1e-9, 1e-7, 3e-7, 1e-6, 1e-5, 1e-3]) {
    it(`bump with side walls antiparallel to within ${delta} rad: valid skeleton, ridge closed at the bump`, () => {
      for (const w of [1, 0.7]) {
        const poly = bump(delta);
        const sk = computeSkeleton(poly, { weights: () => w });
        const inv = invariants(poly, sk);
        expect(inv.outside).toBe(0);
        expect(inv.warnings).toEqual([]);
        expect(inv.tileErr).toBeLessThan(1e-7);
        expect(inv.planeErr).toBeLessThan(1e-7);
        expect(sk.maxTime).toBeCloseTo(5 / w, 6); // the main body's ridge
      }
    });
  }
  it('rectangles whose long walls are antiparallel to within 1e-12 .. 1e-6 rad: one ridge at the exact height', () => {
    for (const delta of [1e-12, 1e-10, 1e-8, 3e-8, 1e-7, 3e-7, 1e-6]) {
      for (const a of [0, 0.4, 1.3, 2.9]) {
        const pts: Vec2[] = [[0, 0], [12, 0], [12, 7 + 12 * Math.tan(delta)], [0, 7]];
        const poly: PolygonM = { outer: rot(pts, a, -3, 5) };
        for (const weights of [() => 1, (i: number) => (i % 2 ? 0 : 1)]) {
          const sk = computeSkeleton(poly, { weights });
          const inv = invariants(poly, sk);
          expect(inv.outside, `delta ${delta} a ${a}`).toBe(0);
          expect(inv.warnings).toEqual([]);
          expect(inv.tileErr).toBeLessThan(1e-7);
          expect(Math.abs(sk.maxTime - 3.5)).toBeLessThan(1e-5 + 12 * delta);
        }
      }
    }
  });
});

describe('result validation, dominant-axis retry and SkeletonError', () => {
  it('validateSkeleton flags runaway nodes, impossible times and broken tilings', () => {
    const poly: PolygonM = { outer: rot(rectPts(10, 6), 0.5) };
    const sk = computeSkeleton(poly, { weights: () => 1 });
    expect(validateSkeleton(sk, poly)).toEqual([]);
    const far: Skeleton = { ...sk, nodes: sk.nodes.map((n, i) => (i === sk.nodes.length - 1 ? { ...n, x: 4e8 } : n)) };
    expect(validateSkeleton(far, poly).join(' ')).toMatch(/outside/);
    const late: Skeleton = { ...sk, nodes: sk.nodes.map((n) => (n.t > 0 ? { ...n, t: 50 } : n)) };
    expect(validateSkeleton(late, poly).join(' ')).toMatch(/time/);
    const torn: Skeleton = { ...sk, faces: sk.faces.slice(1) };
    expect(validateSkeleton(torn, poly).join(' ')).toMatch(/tile|area/);
  });
  it('the dominant axis of a rotated plan is its wall direction (mod 90 deg)', () => {
    for (const a of [0, 0.2, 0.7, 1.5, 2.6]) {
      const ax = dominantAxis({ outer: rot([[0, 0], [10, 0], [10, 11], [6, 11], [6, 6], [0, 6]], a) });
      const d = ((ax - a) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2);
      expect(Math.min(d, Math.PI / 2 - d)).toBeLessThan(1e-9);
    }
  });
  it('a forced dominant-axis attempt returns the same skeleton in the caller frame', () => {
    const poly: PolygonM = { outer: rot([[0, 0], [10, 0], [10, 11], [6, 11], [6, 6], [0, 6]], 0.83, 12, -4) };
    const a = computeSkeleton(poly, { weights: (i) => (i === 1 ? 0 : 1) });
    const b = computeSkeleton(poly, { weights: (i) => (i === 1 ? 0 : 1), alignSnap: 1e-6 });
    expect(b.stats.notes.join(' ')).toMatch(/dominant-axis/);
    const key = (s: Skeleton) => s.nodes.filter((n) => n.t > 1e-9).map((n) => [n.x, n.y, n.t].map((v) => v.toFixed(6)).join(',')).sort();
    expect(key(b)).toEqual(key(a));
    expect(b.poly.outer.every((p, i) => Math.hypot(p[0] - poly.outer[i][0], p[1] - poly.outer[i][1]) < 1e-6)).toBe(true);
    expect(validateSkeleton(b, b.poly)).toEqual([]);
  });
  it('throws a typed SkeletonError (never garbage) when no attempt validates', () => {
    const poly: PolygonM = { outer: rot([[0, 0], [10, 0], [10, 11], [6, 11], [6, 6], [0, 6]], 0.4) };
    let err: unknown;
    try { computeSkeleton(poly, { weights: () => 1, maxEvents: 0 }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SkeletonError);
    const se = err as SkeletonError;
    expect(se.name).toBe('SkeletonError');
    expect(se.issues.join(' ')).toMatch(/too many events/);
    expect(se.attempts).toBeGreaterThanOrEqual(2);
  });
  it('buildRoof surfaces SkeletonError instead of returning an exploding roof', () => {
    // a self-overlapping outline cannot be skeletonised; buildRoof must throw the typed error
    const bow: PolygonM = { outer: [[0, 0], [10, 0], [10, 6], [4, -3], [0, 6]] };
    expect(() => buildRoof(bow, ['eave', 'eave', 'eave', 'eave', 'eave'], { type: 'hipped', eaveHeight: 5, pitchDeg: 35 })).toThrow(SkeletonError);
  });
});
