// Unit tests of packages/core/src/fit: raster sampling, robust primitives, skeleton time vs closed forms, model
// library, RoofSpec <-> geometry engine consistency, co-registration / ground / pixel selection, partitions,
// priors fallback and reconstruct() edge cases.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bilinear } from '../src/fit/raster.js';
import { arange, madScale, median, profileInit, quantile, irls, irlsNonneg } from '../src/fit/robust.js';
import { makeTimeField } from '../src/fit/timefield.js';
import { makePartGeom, partLibrary, DEFAULT_LIBRARY, ASYM_GABLE_GRID, type ModelDef } from '../src/fit/models.js';
import { summarisePart } from '../src/fit/output.js';
import { coregister } from '../src/fit/coregister.js';
import { estimateGround } from '../src/fit/ground.js';
import { selectPixels, DEFAULT_PIXELS } from '../src/fit/pixels.js';
import { reflexPartitions } from '../src/fit/partitions.js';
import { priorsFallback, storeysFromEave, eaveForStoreys } from '../src/fit/priors.js';
import { reconstruct } from '../src/fit/reconstruct.js';
import { partIssues } from '../src/fit/plausibility.js';
import { simplifyUntil } from '../src/fit/outline.js';
import { polyArea } from '../src/fit/poly.js';
import { buildRoof, type EdgeKind } from '../src/geometry/roof.js';
import { mulberry32, type PolygonM, type Vec2 } from '../src/geometry/geom.js';
import type { HeightGrid, ReconstructedPart } from '../src/types.js';
import { generateCase } from './fixtures/fit/synth.js';

const rot = (pts: Vec2[], a: number, dx = 0, dy = 0): Vec2[] => pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a) + dx, x * Math.sin(a) + y * Math.cos(a) + dy]);
const rectPts = (w: number, h: number): Vec2[] => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
const grid = (w: number, h: number, x0: number, y1: number, f: (x: number, y: number) => number): HeightGrid => {
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = f(x0 + c + 0.5, y1 - r - 0.5);
  return { width: w, height: h, originX: x0, originY: y1, res: 1, data };
};
const attrs = (kinds: EdgeKind[]) => kinds.map((k) => ({ kind: k, cut: false }));
const inside = (poly: PolygonM, n: number, seed: number): Vec2[] => {
  const r = mulberry32(seed), xs = poly.outer.map((p) => p[0]), ys = poly.outer.map((p) => p[1]);
  const out: Vec2[] = [];
  const pin = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = poly.outer.length - 1; i < poly.outer.length; j = i++) {
      const a = poly.outer[i], b = poly.outer[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  while (out.length < n) {
    const x = Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + r() * (Math.max(...ys) - Math.min(...ys));
    if (pin(x, y)) out.push([x, y]);
  }
  return out;
};

describe('fit/raster: bilinear', () => {
  const g: HeightGrid = { width: 3, height: 3, originX: 100, originY: 200, res: 1, data: Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]) };
  it('interpolates between pixel centres (row 0 = north), clamps at the border, NaN outside', () => {
    expect(bilinear(g, 101.5, 198.5)).toBe(4);
    expect(bilinear(g, 102, 198.5)).toBeCloseTo(4.5, 12);
    expect(bilinear(g, 101.5, 198)).toBeCloseTo(5.5, 12);
    expect(bilinear(g, 100.2, 199.8)).toBe(0);
    expect(bilinear(g, 99.9, 198)).toBeNaN();
    expect(bilinear(g, 101, 196.9)).toBeNaN();
  });
  it('ignores nodata corners (renormalised weights)', () => {
    const h = { ...g, data: Float32Array.from([0, 1, 2, 3, 4, NaN, 6, 7, 8]) };
    expect(bilinear(h, 102, 198.5)).toBe(4);
    expect(bilinear(h, 102.5, 198.5)).toBeNaN();
  });
});

describe('fit/robust', () => {
  it('median / MAD / quantile follow numpy', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(madScale([1, 2, 3, 4, 100])).toBeCloseTo(1.4826, 12);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7, 12);
  });
  it('Tukey IRLS ignores gross outliers; the active set clamps negative slopes to 0', () => {
    const n = 50, x = Float64Array.from({ length: n }, (_, i) => i / 5), z = Float64Array.from(x, (v, i) => 2 + 0.5 * v + (i % 5 === 0 ? 3 : 0));
    const X = [new Float64Array(n).fill(1), x];
    const o = irls(X, z, 0.25, profileInit(X, z, 0.25, 4.685, arange(0, 71, 1))); // production start: profile over pitch
    expect(o.beta[0]).toBeCloseTo(2, 6);
    expect(o.beta[1]).toBeCloseTo(0.5, 6);
    const zneg = Float64Array.from(x, (v) => 5 - 0.3 * v);
    const c = irlsNonneg(X, zneg, 0.25, [5, 0.1], [1]);
    expect(c.beta[1]).toBe(0);
  });
});

describe('fit/timefield: weighted-skeleton time t_M(p)', () => {
  const a = 0.4;
  const poly: PolygonM = { outer: rot(rectPts(12, 8), a, 3, -2) };
  const uv = (p: Vec2): Vec2 => {
    const x = p[0] - 3, y = p[1] + 2;
    return [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)];
  };
  it('equals the rectangle closed forms inside and extends the faces linearly across walls', () => {
    const gable = makeTimeField(poly, ['eave', 'gable', 'eave', 'gable']);
    const hip = makeTimeField(poly, ['eave', 'eave', 'eave', 'eave']);
    for (const p of inside(poly, 200, 1)) {
      const [u, v] = uv(p);
      expect(gable.at(p[0], p[1])).toBeCloseTo(Math.min(v + 4, 4 - v), 9);
      expect(hip.at(p[0], p[1])).toBeCloseTo(Math.min(v + 4, 4 - v, u + 6, 6 - u), 9);
    }
    expect(gable.tmax).toBeCloseTo(4, 9);
    // 0.3 m outside the S eave (overhang: negative time) and outside the E gable (profile continues)
    const out = (u: number, v: number): Vec2 => [u * Math.cos(a) - v * Math.sin(a) + 3, u * Math.sin(a) + v * Math.cos(a) - 2];
    let p = out(1, -4.3);
    expect(gable.at(p[0], p[1])).toBeCloseTo(-0.3, 9);
    p = out(6.3, 1);
    expect(gable.at(p[0], p[1])).toBeCloseTo(3, 9);
  });
  it('matches the L-infinity oracle on a rotated L (hipped) and survives the rotated-L degeneracy', () => {
    const L0: Vec2[] = [[0, 0], [10, 0], [10, 11], [6, 11], [6, 6], [0, 6]];
    const L: PolygonM = { outer: rot(L0, 1.234567, 412345.0 - 412345.0, 0) };
    const tf = makeTimeField(L, L0.map(() => 'eave'), { cos: Math.cos(1.234567), sin: Math.sin(1.234567) });
    const linf = (x: number, y: number) => {
      let t = Infinity;
      L0.forEach((p, i) => {
        const q = L0[(i + 1) % L0.length], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
        const nx = -dy / len, ny = dx / len, dperp = (x - p[0]) * nx + (y - p[1]) * ny;
        const s = ((x - p[0]) * dx + (y - p[1]) * dy) / len, dpar = Math.max(-s, s - len, 0);
        if (dperp >= 0) t = Math.min(t, Math.max(dperp, dpar));
      });
      return t;
    };
    for (const p of inside({ outer: L0 }, 200, 2)) {
      const [x, y] = rot([p], 1.234567)[0];
      expect(tf.at(x, y)).toBeCloseTo(linf(p[0], p[1]), 8);
    }
    // the engine produced runaway nodes for this rotated L + gable kinds; the library must not lose or crash on it
    const bad: PolygonM = { outer: [[-4.541245885484386, -6.466717476549093], [5.949068244372029, -3.16074409452267], [2.293494512035977, 8.438900653331075], [-1.7403001820202917, 7.167669141839724], [-0.11606962786754593, 2.013759305293206], [-6.572589063609485, -0.020982565241865814]] };
    const lib = partLibrary(makePartGeom(bad, attrs(bad.outer.map(() => 'eave'))), DEFAULT_LIBRARY);
    expect(lib.map((m) => m.label)).toEqual(expect.arrayContaining(['flat', 'gable-u', 'gable-v', 'hip', 'cross-gable']));
  });
});

describe('fit/models: library per footprint and party walls', () => {
  const labels = (poly: PolygonM, kinds: EdgeKind[]) => partLibrary(makePartGeom(poly, attrs(kinds)), DEFAULT_LIBRARY);
  it('detached rectangle: full family set with variant counts', () => {
    const lib = labels({ outer: rot(rectPts(12, 10), 0.3) }, ['eave', 'eave', 'eave', 'eave']);
    const by = (l: string) => lib.find((m) => m.label === l)!;
    expect(lib.map((m) => m.label).sort()).toEqual(['flat', 'gable-u', 'gable-v', 'gambrel-u', 'gambrel-v', 'half-hip-u', 'half-hip-v', 'hip', 'mansard', 'pyramid',
      'skillion-E', 'skillion-N', 'skillion-S', 'skillion-W', 'gable-u-steep-S', 'gable-u-steep-N', 'gable-v-steep-W', 'gable-v-steep-E',
      // cross gables: L along the long axis at either end (an L along the short axis would make the cross gable the
      // taller one), T on either slope of either main axis
      'cross-gable-L-u-lo', 'cross-gable-L-u-hi', 'cross-gable-T-u-lo', 'cross-gable-T-u-hi', 'cross-gable-T-v-lo', 'cross-gable-T-v-hi'].sort());
    expect(by('cross-gable-L-u-lo').nVariants).toBe(6);
    expect(by('cross-gable-L-u-lo').kinds.filter((k) => k === 'gable')).toHaveLength(3);
    expect(by('gable-u').nVariants).toBe(2);
    // asymmetric gables: one per (axis, steep side), own variant count, same kinds as the symmetric gable
    expect(by('gable-u-steep-N').nVariants).toBe(4);
    expect(by('gable-u-steep-N').kinds).toEqual(by('gable-u').kinds);
    expect(by('gable-u-steep-N').grid).toEqual(ASYM_GABLE_GRID);
    expect(by('skillion-N').nVariants).toBe(4);
    expect(by('mansard').nVariants).toBe(3);
    expect(by('gable-u').kinds.filter((k) => k === 'gable')).toHaveLength(2);
  });
  it('mid-terrace: hip == gable between party walls (deduplicated), no hip-ends', () => {
    const lib = labels({ outer: rectPts(5, 9) }, ['eave', 'party', 'eave', 'party']);
    const ls = lib.map((m) => m.label);
    expect(ls).not.toContain('hip');
    expect(ls.some((l) => l.startsWith('half-hip'))).toBe(false);
    expect(ls).not.toContain('pyramid');
    const g = lib.filter((m) => m.family === 'gable' && !m.steepEdges);
    expect(g).toHaveLength(1);
    expect(g[0].nVariants).toBe(1);
    expect(lib.filter((m) => m.steepEdges).map((m) => m.kinds)).toEqual([g[0].kinds, g[0].kinds]); // steep front or back
    expect(g[0].kinds).toEqual(['eave', 'party', 'eave', 'party']);
    expect(lib.filter((m) => m.family === 'skillion')).toHaveLength(2);
    expect(ls.some((l) => l.startsWith('mansard-'))).toBe(true); // two-pitch between party walls = terrace mansard
  });
  it('semi-detached: hip at the free end and one gable orientation', () => {
    const lib = labels({ outer: rectPts(8, 9) }, ['eave', 'eave', 'eave', 'party']);
    expect(lib.find((m) => m.label === 'hip')!.kinds).toEqual(['eave', 'eave', 'eave', 'party']);
    const g = lib.filter((m) => m.family === 'gable' && !m.steepEdges);
    expect(g).toHaveLength(1);
    expect(g[0].kinds).toEqual(['eave', 'gable', 'eave', 'party']);
  });
  it('L-shape: cross-gable from autoGableKinds, no rectangle closed forms', () => {
    const lib = labels({ outer: [[0, 0], [10, 0], [10, 11], [6, 11], [6, 6], [0, 6]] }, Array(6).fill('eave'));
    expect(lib.map((m) => m.label)).toContain('cross-gable');
    expect(lib.some((m) => m.family === 'halfhip' || m.family === 'pyramid' || m.twoPitch)).toBe(false);
  });
});

describe('fit/output: emitted RoofSpec + edge kinds rebuild exactly the fitted surface', () => {
  const check = (poly: PolygonM, kinds: EdgeKind[], seed: number) => {
    const part = makePartGeom(poly, attrs(kinds));
    const lib = partLibrary(part, DEFAULT_LIBRARY);
    const pts = inside(poly, 120, seed);
    const flatPts = Float64Array.from(pts.flat());
    let checked = 0;
    for (const m of lib) {
      if (m.family === 'flat') continue;
      const g = m.grid.length ? m.grid[Math.floor(m.grid.length / 2)] : 0;
      const beta = m.twoPitch ? [5, Math.tan((68 * Math.PI) / 180), Math.tan((22 * Math.PI) / 180)] : [5, Math.tan((37 * Math.PI) / 180)];
      const s = summarisePart(part, m as ModelDef, g, beta, null, 0, [0, 0], 'main', 'main', 1);
      const roof = buildRoof(s.part.footprint, s.part.edgeKinds, { ...s.part.roof, eaveHeight: s.part.eaveHeight });
      expect(roof.skeleton.stats.warnings, m.label).toEqual([]);
      const t = m.times(flatPts, g);
      pts.forEach((p, k) => {
        const fit = m.twoPitch ? beta[0] + beta[1] * Math.min(t[k], g) + beta[2] * Math.max(t[k] - g, 0) : beta[0] + beta[1] * t[k];
        expect(roof.heightAt(p)!, `${m.label} at ${p}`).toBeCloseTo(fit, 6);
      });
      expect(Math.max(...roof.vertices.map((v) => v[2]))).toBeCloseTo(s.part.ridgeHeight, 6);
      checked++;
    }
    return checked;
  };
  it('rectangle: gable, hip, skillion, half-hip, pyramid, mansard, gambrel', () => {
    expect(check({ outer: rot(rectPts(12, 9), 0.7, 5, 5) }, ['eave', 'eave', 'eave', 'eave'], 3)).toBeGreaterThanOrEqual(13);
  });
  it('semi-detached rectangle and L-shaped plan', () => {
    expect(check({ outer: rectPts(8, 9.5) }, ['eave', 'eave', 'eave', 'party'], 4)).toBeGreaterThanOrEqual(8);
    expect(check({ outer: [[0, 0], [10, 0], [10, 11], [6, 11], [6, 6], [0, 6]] }, Array(6).fill('eave'), 5)).toBeGreaterThanOrEqual(5);
  });
});

describe('fit/coregister, ground, pixels', () => {
  it('recovers a 2 m neighbourhood offset; flags flat rasters and footprints off the raster', () => {
    const { input, truth } = generateCase('hip', 77, { misreg: 2 });
    const r = coregister(input.dsm, input.dtm, [{ poly: input.target.footprint, kinds: input.target.edgeKinds, isTarget: true }, ...input.neighbours.map((n) => ({ poly: n.footprint, kinds: n.edgeKinds ?? n.footprint.outer.map(() => 'eave' as EdgeKind) }))]);
    expect(Math.hypot(r.shift[0] - truth.correction[0], r.shift[1] - truth.correction[1])).toBeLessThan(0.2);
    expect(r.failed).toBe(false);
    expect(r.sigmaMajor).toBeLessThan(0.5);
    const flat = grid(60, 60, 0, 60, () => 20);
    const fp = { poly: { outer: [[20, 20], [32, 20], [32, 30], [20, 30]] as Vec2[] }, kinds: ['eave', 'eave', 'eave', 'eave'] as EdgeKind[], isTarget: true };
    const w = coregister(flat, flat, [fp]);
    expect(w.flags).toContain('weak-peak');
    expect(w.failed).toBe(true);
    const off = coregister(flat, flat, [{ ...fp, poly: { outer: fp.poly.outer.map(([x, y]) => [x + 500, y] as Vec2) } }]);
    expect(off.method).toBe('none');
    expect(off.flags).toContain('no-edges');
  });
  it('ground = DTM median inside, cross-checked by the ring plane; a raised platform is flagged', () => {
    const plane = (x: number, y: number) => 50 + 0.05 * x + 0.02 * y;
    const sq: PolygonM = { outer: [[20, 20], [30, 20], [30, 28], [20, 28]] };
    const dtm = grid(50, 50, 0, 50, plane);
    const g = estimateGround(dtm, sq, []);
    expect(g.ground).toBeCloseTo(plane(25, 24), 1);
    expect(g.check!).toBeCloseTo(plane(25, 24), 2);
    expect(g.mismatch).toBe(false);
    const raised = grid(50, 50, 0, 50, (x, y) => plane(x, y) + (x > 20 && x < 30 && y > 20 && y < 28 ? 1 : 0));
    expect(estimateGround(raised, sq, []).mismatch).toBe(true);
  });
  it('keeps pixel centres >= 0.5 m from free and >= 0.25 m from party edges; drops vegetation', () => {
    const poly: PolygonM = { outer: rot(rectPts(10, 8), 0.3) };
    const kinds: EdgeKind[] = ['eave', 'eave', 'eave', 'party'];
    const dsm = grid(30, 30, -15, 15, () => 10);
    const last = grid(30, 30, -15, 15, (x) => (x > 2 ? 7 : 10));
    const sel = selectPixels(dsm, poly, kinds, [0, 0], DEFAULT_PIXELS, last);
    expect(sel.nVegetation).toBeGreaterThan(5);
    expect(sel.set.n).toBeGreaterThan(20);
    const d = (x: number, y: number, a: Vec2, b: Vec2) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
    };
    for (let k = 0; k < sel.set.n; k++) {
      const x = sel.set.cx[k], y = sel.set.cy[k];
      expect(x).toBeLessThanOrEqual(2);
      poly.outer.forEach((a, i) => expect(d(x, y, a, poly.outer[(i + 1) % 4])).toBeGreaterThanOrEqual(kinds[i] === 'party' ? 0.25 : 0.5));
    }
    expect(sel.set.sub.length).toBe(sel.set.n * 16 * 2);
  });
});

describe('fit/partitions: reflex-vertex cuts', () => {
  it('an L gives two 2-part partitions and one 3-part partition that tile the footprint', () => {
    const L: PolygonM = { outer: [[0, 0], [10, 0], [10, 11], [6, 11], [6, 6], [0, 6]] };
    const ps = reflexPartitions(makePartGeom(L, attrs(Array(6).fill('eave'))));
    expect(ps.map((p) => p.parts.length).sort()).toEqual([2, 2, 3]);
    for (const p of ps) {
      expect(p.parts.reduce((s, q) => s + q.area, 0)).toBeCloseTo(80, 9);
      expect(p.parts.every((q) => q.attrs.some((x) => x.cut))).toBe(true);
      expect(p.dataCut).toBe(false);
    }
  });
});

describe('fit/priors: no-LiDAR fallback and storeys', () => {
  it('storeysFromEave picks the closest plinth + N ff - 0.1', () => {
    expect(storeysFromEave(5.14, '1945-1964')).toBe(2);
    expect(storeysFromEave(2.7, 'post-2000')).toBe(1);
    expect(storeysFromEave(8.0, 'post-2000')).toBe(3);
    expect(storeysFromEave(6.35, 'pre-1919')).toBe(2);
    expect(storeysFromEave(Number.NaN)).toBe(1);
    expect(eaveForStoreys(2, 'pre-1919')).toBeCloseTo(6.35, 12);
  });
  it('mid-terrace: modal pre-1919 era, gable between the party walls, labelled estimate', () => {
    const r = priorsFallback({ footprint: { outer: rectPts(5, 9) }, edgeKinds: ['eave', 'party', 'eave', 'party'], builtForm: 'mid-terrace' });
    expect(r.source).toBe('prior');
    expect(r.label).toMatch(/estimated/);
    expect(r.era).toBe('pre-1919');
    expect(r.eraAssumed).toBe(true);
    expect(r.storeys).toBe(2);
    const p = r.parts[0];
    expect(p.roof.type).toBe('gabled');
    expect(p.edgeKinds).toEqual(['eave', 'party', 'eave', 'party']);
    expect(p.eaveHeight).toBeCloseTo(6.35, 9);
    expect(p.ridgeHeight).toBeCloseTo(6.35 + 4.5 * Math.tan((35 * Math.PI) / 180), 6);
    expect(p.eaveSE).toBe(0.6);
  });
  it('OSM tags win: roof:shape, building:levels, height', () => {
    const fp = { outer: rectPts(10, 8) }, kinds: EdgeKind[] = ['eave', 'eave', 'eave', 'eave'];
    expect(priorsFallback({ footprint: fp, edgeKinds: kinds, builtForm: 'detached', roofShapeHint: 'hipped' }).parts[0].roof.type).toBe('hipped');
    expect(priorsFallback({ footprint: fp, edgeKinds: kinds, builtForm: 'detached', roofShapeHint: 'flat' }).parts[0].roof.type).toBe('flat');
    const lv = priorsFallback({ footprint: fp, edgeKinds: kinds, builtForm: 'detached', era: '1981-2000', storeysHint: 3 });
    expect(lv.storeys).toBe(3);
    expect(lv.parts[0].eaveHeight).toBeCloseTo(eaveForStoreys(3, '1981-2000'), 9);
    const h = priorsFallback({ footprint: fp, edgeKinds: kinds, builtForm: 'detached', era: 'post-2000', heightHint: 9 });
    expect(h.parts[0].ridgeHeight).toBeCloseTo(9, 6);
    expect(h.storeys).toBe(2);
    const sq = priorsFallback({ footprint: { outer: rectPts(9, 8.5) }, edgeKinds: kinds });
    expect(sq.builtForm).toBe('detached');
    expect(sq.parts[0].roof.type).toBe('hipped'); // aspect < 1.25, no party walls
    const semi = priorsFallback({ footprint: { outer: rectPts(8, 9) }, edgeKinds: ['eave', 'eave', 'eave', 'party'], era: '1919-1944' });
    expect(semi.builtForm).toBe('semi-detached');
    expect(semi.parts[0].roof.type).toBe('hipped');
    expect(semi.parts[0].roof.pitchDeg).toBe(42);
  });
});

describe('fit/reconstruct: robustness and determinism', () => {
  it('is deterministic and returns an oriented footprint with aligned kinds for CW input with a closing vertex', () => {
    const { input } = generateCase('semi_hip', 11);
    const cw = [...input.target.footprint.outer].reverse();
    const kindsCW: EdgeKind[] = cw.map((_, j) => input.target.edgeKinds[(((cw.length - 2 - j) % cw.length) + cw.length) % cw.length]);
    const a = reconstruct({ ...input, target: { ...input.target, footprint: { outer: [...cw, cw[0]] }, edgeKinds: [...kindsCW, 'eave'] } });
    const b = reconstruct(input);
    expect(a.report.selected).toBe('hip');
    expect(a.parts[0].edgeKinds.filter((k) => k === 'party')).toHaveLength(1);
    expect(JSON.stringify(reconstruct(input))).toBe(JSON.stringify(b));
    expect(a.parts[0].eaveHeight).toBeCloseTo(b.parts[0].eaveHeight, 6);
  });
  it('degrades gracefully: no pixels, tiny footprints and nodata', () => {
    const { input } = generateCase('gable_long', 12);
    const far = reconstruct({ ...input, target: { ...input.target, footprint: { outer: input.target.footprint.outer.map(([x, y]) => [x + 5000, y] as Vec2) } } });
    expect(far.ok).toBe(false);
    expect(far.parts).toHaveLength(0);
    expect(far.flags).toContain('fit-unreliable');
    const c = input.target.footprint.outer.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
    const tiny = reconstruct({ ...input, target: { id: 't', footprint: { outer: rot(rectPts(2.2, 2.2), 0, c[0], c[1]) }, edgeKinds: ['eave', 'eave', 'eave', 'eave'] } });
    expect(tiny.ok).toBe(false);
    expect(tiny.parts[0]?.roof.type).toBe('flat');
    const holes = new Float32Array(input.dsm.data);
    for (let i = 0; i < holes.length; i += 7) holes[i] = NaN;
    const nd = reconstruct({ ...input, dsm: { ...input.dsm, data: holes } });
    expect(nd.flags).toContain('dsm-nodata');
    expect(nd.report.selected).toBe('gable-u');
  });
  it('optional family priors (usePriors) keep a clear LiDAR answer', () => {
    const { input } = generateCase('mid_terrace', 13);
    const out = reconstruct({ ...input, priors: { builtForm: 'mid-terrace', era: 'pre-1919', roofShapeHint: 'gabled' }, options: { usePriors: true } });
    expect(out.ok).toBe(true);
    expect(out.parts[0].roof.type).toBe('gabled');
  });
});

describe('fit/plausibility: implausible parts never come back ok', () => {
  const part = (over: Partial<ReconstructedPart>): ReconstructedPart => ({
    id: 'main', role: 'main', footprint: { outer: rectPts(10, 8) }, edgeKinds: ['eave', 'gable', 'eave', 'gable'],
    roof: { type: 'gabled', pitchDeg: 40 }, eaveHeight: 5, ridgeHeight: 8.4, family: 'gable-u', ...over,
  });
  it('flags low eaves, inverted ridges, tiny parts, over-steep roofs and ridges above every DSM return', () => {
    expect(partIssues(part({}), 8.6)).toEqual([]);
    expect(partIssues(part({ eaveHeight: 0.5, ridgeHeight: 3.9 }), 4)).toContain('implausible-eave');
    expect(partIssues(part({ ridgeHeight: 4 }), 8)).toContain('implausible-ridge');
    expect(partIssues(part({ footprint: { outer: rectPts(1.8, 2) } }), 8.6)).toContain('implausible-area');
    expect(partIssues(part({ roof: { type: 'gabled', pitchDeg: 75 } }), 8.6)).toContain('implausible-pitch');
    expect(partIssues(part({ roof: { type: 'mansard', pitchDeg: 78, lowerPitchDeg: 78, upperPitchDeg: 20, breakHeight: 2 } }), 8.6)).toEqual([]);
    expect(partIssues(part({ ridgeHeight: 19 }), 8.6)).toContain('ridge-above-data');
  });
  it('a 1.6 m high shed footprint fits but is returned ok = false with implausible-part / implausible-eave', () => {
    const fp: Vec2[] = [[40, 40], [50, 40], [50, 48], [40, 48]];
    const z = (x: number, y: number) => 30 + (x > 40 && x < 50 && y > 40 && y < 48 ? 1.6 : 0);
    const out = reconstruct({ dsm: grid(90, 90, 0, 90, z), dtm: grid(90, 90, 0, 90, () => 30), target: { id: 's', footprint: { outer: fp }, edgeKinds: ['eave', 'eave', 'eave', 'eave'] }, neighbours: [] });
    expect(out.report.unreliable).toBe(false);
    expect(out.parts[0].eaveHeight).toBeLessThan(2);
    expect(out.ok).toBe(false);
    expect(out.flags).toEqual(expect.arrayContaining(['implausible-part', 'implausible-eave', 'outside-library']));
  });
});

describe('fit/priors: complex outlines', () => {
  // Down House outline (local BNG metres, from the I-API replay): the raw hip skeleton has runaway nodes
  const DOWN: Vec2[] = [[-4.471, -5.516], [-5.175, -6.258], [-4.886, -9.103], [-2.133, -11.714], [0.561, -11.661], [1.475, -10.697], [7.303, -16.224], [14.535, -8.599], [15.28, -9.306],
    [17.284, -7.194], [16.537, -6.486], [17.481, -5.491], [0.422, 10.688], [-2.401, 16.744], [-11.799, 9.775], [-17.501, 3.763], [-10.471, -2.905], [-8.934, -1.284]];
  const sane = (p: ReconstructedPart) => {
    const rm = buildRoof(p.footprint, p.edgeKinds, { ...p.roof, eaveHeight: p.eaveHeight });
    const xs = p.footprint.outer.map((q) => q[0]), ys = p.footprint.outer.map((q) => q[1]);
    expect(rm.skeleton.stats.warnings).toEqual([]);
    for (const [x, y] of rm.vertices) {
      expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-3);
      expect(x).toBeLessThanOrEqual(Math.max(...xs) + 1e-3);
      expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-3);
      expect(y).toBeLessThanOrEqual(Math.max(...ys) + 1e-3);
    }
  };
  it('defaults complex outlines to a hipped roof the engine can build', () => {
    const r0 = priorsFallback({ footprint: { outer: DOWN }, edgeKinds: DOWN.map(() => 'eave'), builtForm: 'detached' });
    expect(r0.parts[0].roof.type).toBe('hipped');
    sane(r0.parts[0]);
    // exact (unrounded) outlines from the I-API replay. These once needed outline simplification; the engine now
    // builds them raw (robustRoof's snapped retries). The simplification path itself is covered by the
    // simplifyUntil test below; here any simplification that does happen must still keep the plan within 10 %.
    const fx: Record<string, { footprint: PolygonM; edgeKinds: EdgeKind[] }> = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/fit/complex-outlines.json', import.meta.url)), 'utf8'));
    for (const [slug, c] of Object.entries(fx)) {
      const r = priorsFallback({ footprint: c.footprint, edgeKinds: c.edgeKinds, builtForm: 'detached' });
      const p = r.parts[0];
      expect(p.roof.type, slug).toBe('hipped');
      expect(r.family).toBe('hip');
      expect(r.notes.join(' ')).toMatch(/complex outline/);
      expect(Math.abs(polyArea(p.footprint) - polyArea(c.footprint)) / polyArea(c.footprint)).toBeLessThan(0.1);
      expect(p.ridgeHeight - p.eaveHeight).toBeGreaterThan(1);
      expect(p.ridgeHeight - p.eaveHeight).toBeLessThan(8);
      sane(p);
    }
  });
  it('keeps flat for roof:shape=flat and very large footprints; LiDAR height hints are labelled as such', () => {
    expect(priorsFallback({ footprint: { outer: DOWN }, edgeKinds: DOWN.map(() => 'eave'), roofShapeHint: 'flat' }).parts[0].roof.type).toBe('flat');
    const big = priorsFallback({ footprint: { outer: rectPts(40, 30) }, edgeKinds: ['eave', 'eave', 'eave', 'eave'] });
    expect(big.parts[0].roof.type).toBe('flat');
    const l = priorsFallback({ footprint: { outer: rectPts(10, 8) }, edgeKinds: ['eave', 'eave', 'eave', 'eave'], heightHint: 8.5, heightHintSource: 'lidar' });
    expect(l.notes.join(' ')).toMatch(/LiDAR top height/);
    expect(l.notes.join(' ')).not.toMatch(/OSM height/);
    expect(l.parts[0].ridgeHeight).toBeCloseTo(8.5, 6);
  });
  it('simplifyUntil removes the least significant vertices, keeps kinds aligned and the area within 10 %', () => {
    const ring: Vec2[] = [[0, 0], [10, 0], [10, 5], [10.2, 5.1], [10, 5.2], [10, 8], [0, 8]];
    const kinds: EdgeKind[] = ['eave', 'party', 'party', 'party', 'party', 'eave', 'eave'];
    const s = simplifyUntil({ outer: ring }, kinds, (p) => p.outer.length <= 5)!;
    expect(s.removed).toBeGreaterThanOrEqual(2);
    expect(s.poly.outer.length).toBe(s.kinds.length);
    expect(s.kinds.filter((k) => k === 'party')).toHaveLength(1);
    expect(Math.abs(polyArea(s.poly) - 80)).toBeLessThan(0.5);
  });
});
