// Small planar-geometry helpers used by the pipeline (local metres or lon/lat rings; rings are open).
import { polygonCentroid, removeCollinear } from '@sunny/sunscan-core/geo';
import { distPointSeg, isSimple, pointInPolygon, polygonArea, type EdgeKind, type PolygonM, type Ring, type RoofParams, type Vec2 } from '@sunny/sunscan-core/geometry';
import type { LonLat } from '../contracts.js';

/** Signed shoelace area (> 0 = counter-clockwise for x east / y north, also for [lon, lat]). */
export function signedArea(ring: readonly (readonly [number, number])[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Drop a repeated closing vertex. */
export function openRing<T extends readonly [number, number]>(ring: readonly T[]): T[] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring.slice();
}

/** Remove consecutive vertices closer than `tol` (same units as the ring). */
export function dedupeRing<T extends readonly [number, number]>(ring: readonly T[], tol: number): T[] {
  const out: T[] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= tol) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < tol) out.pop();
  return out;
}

/** Edge index of the reversed ring that corresponds to edge `j` of the original ring (n vertices). */
export function reversedEdgeIndex(j: number, n: number): number {
  return (((n - 2 - j) % n) + n) % n;
}

/**
 * Orient a polygon (outer CCW, holes CW) and remap per-edge kinds accordingly
 * (kinds: outer ring edges first, then each hole's edges).
 */
export function orientWithKinds(poly: PolygonM, kinds?: EdgeKind[]): { poly: PolygonM; kinds?: EdgeKind[] } {
  const rings = [poly.outer, ...(poly.holes ?? [])];
  const outRings: Ring[] = [];
  const outKinds: EdgeKind[] = [];
  let base = 0;
  rings.forEach((r, ri) => {
    const n = r.length;
    const wantCcw = ri === 0;
    const isCcw = signedArea(r) > 0;
    const ks = kinds ? kinds.slice(base, base + n) : [];
    if (isCcw === wantCcw) {
      outRings.push(r.map((p) => [p[0], p[1]] as Vec2));
      outKinds.push(...ks);
    } else {
      outRings.push(r.slice().reverse().map((p) => [p[0], p[1]] as Vec2));
      if (kinds) for (let j = 0; j < n; j++) outKinds.push(ks[reversedEdgeIndex(j, n)] ?? 'eave');
    }
    base += n;
  });
  return { poly: { outer: outRings[0], holes: outRings.slice(1) }, kinds: kinds ? outKinds : undefined };
}

/**
 * Inverse of {@link orientWithKinds}: given kinds computed on the oriented copy of `input`, return them in the edge
 * order of `input` itself (rings that were reversed get their kinds re-indexed).
 */
export function kindsForInputOrder<T>(input: PolygonM, orientedKinds: T[]): T[] {
  const rings = [input.outer, ...(input.holes ?? [])];
  const out: T[] = [];
  let base = 0;
  rings.forEach((r, ri) => {
    const n = r.length;
    const flipped = (signedArea(r) > 0) !== (ri === 0);
    for (let j = 0; j < n; j++) out.push(orientedKinds[base + (flipped ? reversedEdgeIndex(j, n) : j)]);
    base += n;
  });
  return out;
}

/** Area-weighted centroid of a polygon with holes. */
export function centroidOf(poly: PolygonM): Vec2 {
  const c = polygonCentroid(poly.outer as [number, number][], (poly.holes ?? []) as [number, number][][]);
  return [c[0], c[1]];
}

/** Axis-aligned bounding box of rings. */
export function bboxOf(rings: readonly (readonly (readonly [number, number])[])[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return { minX, minY, maxX, maxY };
}

/**
 * Minimum distance between two polygons' outer rings (0 when they touch or overlap).
 * If the bounding boxes are further apart than `maxDist`, the (lower-bound) bbox gap is returned without refinement.
 */
export function polygonDistance(a: PolygonM, b: PolygonM, maxDist = Infinity): number {
  const ba = bboxOf([a.outer]);
  const bb = bboxOf([b.outer]);
  const gap = Math.max(0, bb.minX - ba.maxX, ba.minX - bb.maxX, bb.minY - ba.maxY, ba.minY - bb.maxY);
  if (gap > maxDist) return gap;
  return ringDistance(a.outer, b.outer, b, a);
}

function ringDistance(ra: Ring, rb: Ring, pb: PolygonM, pa: PolygonM): number {
  if (ra.some((p) => pointInPolygon(p, pb)) || rb.some((p) => pointInPolygon(p, pa))) return 0;
  let d = Infinity;
  for (const p of ra) for (let j = 0; j < rb.length; j++) d = Math.min(d, distPointSeg(p, rb[j], rb[(j + 1) % rb.length]));
  for (const p of rb) for (let j = 0; j < ra.length; j++) d = Math.min(d, distPointSeg(p, ra[j], ra[(j + 1) % ra.length]));
  return d;
}

/**
 * Clean a footprint for modelling: drop vertices closer than 1 cm and near-collinear vertices (< 5 cm deviation),
 * orient outer CCW / holes CW. Returns undefined if the result is degenerate.
 */
export function cleanFootprint(poly: PolygonM): PolygonM | undefined {
  const clean = (r: Ring): Ring | undefined => {
    const d = dedupeRing(openRing(r), 0.01);
    if (d.length < 3) return undefined;
    const c = removeCollinear(d as [number, number][], 0.05) as Vec2[];
    return c.length >= 3 && Math.abs(signedArea(c)) > 0.05 ? c : undefined;
  };
  const outer = clean(poly.outer);
  if (!outer) return undefined;
  const holes = (poly.holes ?? []).map(clean).filter((h): h is Ring => !!h);
  return orientWithKinds({ outer, holes }).poly;
}

/** Validation of a user-drawn or provider footprint: >= 3 vertices, simple, 4 m² < area < 20 000 m². */
export function footprintProblem(poly: PolygonM): string | undefined {
  if (poly.outer.length < 3) return 'needs at least 3 distinct vertices';
  const area = polygonArea(poly);
  if (!(area > 4)) return `area ${area.toFixed(1)} m² is too small`;
  if (area > 20000) return `area ${Math.round(area)} m² is too large for a house`;
  if (!isSimple(poly)) return 'outline self-intersects';
  return undefined;
}

/** Round a 2-vector to `d` decimals. */
export function roundVec(p: readonly [number, number], d = 3): Vec2 {
  const f = 10 ** d;
  return [Math.round(p[0] * f) / f + 0, Math.round(p[1] * f) / f + 0]; // + 0 turns -0 into 0
}

/** Round a number to `d` decimals. */
export function roundTo(v: number, d = 3): number {
  const f = 10 ** d;
  return Math.round(v * f) / f + 0; // + 0 turns -0 into 0
}

/** Map every vertex of a polygon. */
export function mapPolygon(poly: PolygonM, f: (p: Vec2) => Vec2): PolygonM {
  return { outer: poly.outer.map(f), holes: (poly.holes ?? []).map((h) => h.map(f)) };
}

/** A roof with its compound-roof component footprints mapped by `f` (the part footprint's transform); unchanged without components. */
export function mapRoofComponents<R extends Omit<RoofParams, 'eaveHeight'>>(roof: R, f: (p: Vec2) => Vec2): R {
  if (!roof.components?.length) return roof;
  return { ...roof, components: roof.components.map((c) => ({ ...c, footprint: mapPolygon(c.footprint, f) })) };
}

/** Map every vertex of a lon/lat ring list. */
export function mapLL(ring: readonly LonLat[], f: (p: LonLat) => LonLat): LonLat[] {
  return ring.map((p) => f(p));
}
