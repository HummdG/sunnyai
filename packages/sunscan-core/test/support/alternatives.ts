// Alternative roof constructions, implemented only to compare them with the weighted skeleton (approach a).
//   (b) unweighted skeleton + "gable post-processing" (Streets GL / OSM2World / blender-osm style)
//   (c) decomposition into convex/rectangular parts + per-part parametric roofs + union by height-field max
//   (d) lower envelope of the eave planes  h(p) = min_e tan(pitch) * dist(p, line_e)
import { computeSkeleton, type Skeleton } from '../../src/geometry/skeleton.js';
import { type PolygonM, type Vec2, dot, normalize, sub, pointInPolygon } from '../../src/geometry/geom.js';
import type { EdgeKind } from '../../src/geometry/roof.js';

interface Line { n: Vec2; c: number; a: Vec2; b: Vec2 }
function lines(poly: PolygonM): Line[] {
  const out: Line[] = [];
  for (const r of [poly.outer, ...(poly.holes ?? [])])
    r.forEach((a, i) => {
      const b = r[(i + 1) % r.length];
      const d = normalize(sub(b, a));
      const n: Vec2 = [-d[1], d[0]];
      out.push({ n, c: dot(n, a), a, b });
    });
  return out;
}

/** (d) Lower envelope of the eave planes (relative height above the eave, slope tanP). */
export function envelopeHeight(poly: PolygonM, kinds: EdgeKind[], tanP: number): (p: Vec2) => number | null {
  const L = lines(poly).filter((_, i) => kinds[i] === 'eave');
  return (p) => (pointInPolygon(p, poly) ? tanP * Math.min(...L.map((l) => dot(l.n, p) - l.c)) : null);
}

/** (d') Euclidean distance to the nearest eave SEGMENT (medial-axis roof: conical near reflex corners). */
export function segmentDistanceHeight(poly: PolygonM, kinds: EdgeKind[], tanP: number): (p: Vec2) => number | null {
  const L = lines(poly).filter((_, i) => kinds[i] === 'eave');
  const dseg = (p: Vec2, a: Vec2, b: Vec2) => {
    const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
    return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
  };
  return (p) => (pointInPolygon(p, poly) ? tanP * Math.min(...L.map((l) => dseg(p, l.a, l.b))) : null);
}

/** (c, rectilinear hipped) max over ALL inscribed axis-aligned rectangles of their hip roofs
 *  == tanP * L_inf distance to the polygon boundary (largest centred square that fits). */
export function linfHeight(poly: PolygonM, tanP: number): (p: Vec2) => number | null {
  const segs = lines(poly);
  const dInf = (p: Vec2, a: Vec2, b: Vec2) => {
    // L_inf distance from p to an axis-aligned segment
    if (Math.abs(a[1] - b[1]) < 1e-12) {
      const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]);
      return Math.max(Math.abs(p[1] - a[1]), p[0] < x1 ? x1 - p[0] : p[0] > x2 ? p[0] - x2 : 0);
    }
    const y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
    return Math.max(Math.abs(p[0] - a[0]), p[1] < y1 ? y1 - p[1] : p[1] > y2 ? p[1] - y2 : 0);
  };
  return (p) => (pointInPolygon(p, poly) ? tanP * Math.min(...segs.map((s) => dInf(p, s.a, s.b))) : null);
}

/** (c) Union by max of convex parts, each with an envelope roof over its own sides (kind per side). */
export interface Part { poly: PolygonM; kinds: EdgeKind[] }
export function unionMaxHeight(fp: PolygonM, parts: Part[], tanP: number): (p: Vec2) => number | null {
  const fns = parts.map((pt) => ({ inside: (p: Vec2) => pointInPolygon(p, pt.poly), h: envelopeHeight(pt.poly, pt.kinds, tanP) }));
  return (p) => {
    if (!pointInPolygon(p, fp)) return null;
    let best = -Infinity;
    for (const f of fns) if (f.inside(p)) best = Math.max(best, f.h(p) ?? -Infinity);
    return best === -Infinity ? 0 : best;
  };
}

export interface PostProcessResult {
  applicable: boolean;
  reason?: string;
  skeleton: Skeleton;
  nodesXYZ: [number, number, number][]; // after moving apexes (z = tanP * t)
  faces: number[][]; // node loops
  maxNonPlanar: number; // m
  maxPitchErrDeg: number; // eave faces: |LS-plane slope - design pitch|
  heightAt: (p: Vec2) => number | null;
}

/** (b) Unweighted skeleton, then for every vertical edge whose face is a triangle, slide the apex onto the edge. */
export function gablePostProcess(poly: PolygonM, kinds: EdgeKind[], tanP: number): PostProcessResult {
  const sk = computeSkeleton(poly, { weights: () => 1 });
  const xyz: [number, number, number][] = sk.nodes.map((n) => [n.x, n.y, tanP * n.t]);
  const faces = sk.faces.map((f) => f.loops[0]);
  const L = lines(poly);
  let applicable = true, reason = '';
  for (const f of sk.faces) {
    if (kinds[f.edge] === 'eave') continue;
    const loop = f.loops[0];
    if (f.loops.length !== 1 || loop.length !== 3) { applicable = false; reason = `edge ${f.edge} face has ${loop.length} vertices (not a hip triangle)`; continue; }
    const apex = loop.find((id) => sk.nodes[id].t > 1e-9)!;
    const l = L[f.edge];
    const p: Vec2 = [xyz[apex][0], xyz[apex][1]];
    const dd = dot(l.n, p) - l.c; // move onto the edge line along -n
    xyz[apex] = [p[0] - l.n[0] * dd, p[1] - l.n[1] * dd, xyz[apex][2]];
  }
  // planarity of every face after the move
  let maxNP = 0;
  for (const loop of faces) maxNP = Math.max(maxNP, nonPlanarity(loop.map((i) => xyz[i])));
  let maxPitchErr = 0;
  const design = (Math.atan(tanP) * 180) / Math.PI;
  sk.faces.forEach((f, k) => {
    if (kinds[f.edge] !== 'eave') return;
    const P = faces[k].map((i) => xyz[i]);
    const z0 = planeLS(P, [0, 0]), zx = planeLS(P, [1, 0]) - z0, zy = planeLS(P, [0, 1]) - z0;
    maxPitchErr = Math.max(maxPitchErr, Math.abs((Math.atan(Math.hypot(zx, zy)) * 180) / Math.PI - design));
  });
  // height query: plan-view point location in the moved faces; height by barycentric interpolation on a fan
  const heightAt = (p: Vec2) => {
    if (!pointInPolygon(p, poly)) return null;
    for (const loop of faces) {
      const ring = loop.map((i) => [xyz[i][0], xyz[i][1]] as Vec2);
      if (!pointInPolygon(p, { outer: ring })) continue;
      // least-squares plane of the (possibly non-planar) face
      return planeLS(loop.map((i) => xyz[i]), p);
    }
    return null;
  };
  return { applicable, reason, skeleton: sk, nodesXYZ: xyz, faces, maxNonPlanar: maxNP, maxPitchErrDeg: maxPitchErr, heightAt };
}

function nonPlanarity(P: [number, number, number][]): number {
  if (P.length <= 3) return 0;
  const c = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length, s[2] + p[2] / P.length], [0, 0, 0]);
  // Newell normal
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return Math.max(...P.map((p) => Math.abs(((p[0] - c[0]) * nx + (p[1] - c[1]) * ny + (p[2] - c[2]) * nz) / l)));
}

function planeLS(P: [number, number, number][], p: Vec2): number {
  const n = P.length;
  const mx = P.reduce((s, q) => s + q[0], 0) / n, my = P.reduce((s, q) => s + q[1], 0) / n, mz = P.reduce((s, q) => s + q[2], 0) / n;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const q of P) { const dx = q[0] - mx, dy = q[1] - my, dz = q[2] - mz; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * dz; syz += dy * dz; }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-12) return mz;
  const a = (syy * sxz - sxy * syz) / det, b = (sxx * syz - sxy * sxz) / det;
  return mz + a * (p[0] - mx) + b * (p[1] - my);
}
