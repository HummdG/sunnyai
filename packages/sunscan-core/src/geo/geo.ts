// Planar/geodetic helpers for building footprints.
// Local frame: x = east (m), y = north (m), origin (lat0, lon0) = target footprint centroid.
// Projection: local tangent-plane / equirectangular using the WGS84 ellipsoid radii of curvature at lat0:
//   M(φ0) = a(1−e²) / (1 − e² sin²φ0)^(3/2)     (meridional radius)
//   N(φ0) = a / sqrt(1 − e² sin²φ0)             (prime-vertical radius)
//   x = N(φ0) · cos φ0 · (λ − λ0)      y = M(φ0) · (φ − φ0)        (angles in radians)
//   inverse: λ = λ0 + x / (N cos φ0),  φ = φ0 + y / M
// Error budget (verified numerically in test/projection-error.test.ts against Karney geodesics):
// sub-millimetre to ~2 mm at 100 m for UK latitudes (dominated by the cos φ variation term ≈ tan φ0 · Δφ).
// Using a *spherical* R=6371008.8 m instead of M/N gives a 0.3–0.6 % scale error (3–6 dm per 100 m) in the UK — do not.

export type LonLat = [number, number];
export type XY = [number, number];

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const D2R = Math.PI / 180;

export interface LocalFrame {
  lat0: number;
  lon0: number;
  M: number;
  N: number;
  toLocal(p: LonLat): XY;
  toLonLat(p: XY): LonLat;
}

export function makeFrame(lat0: number, lon0: number): LocalFrame {
  const s = Math.sin(lat0 * D2R);
  const w = 1 - E2 * s * s;
  const M = (A * (1 - E2)) / Math.pow(w, 1.5);
  const N = A / Math.sqrt(w);
  const cos0 = Math.cos(lat0 * D2R);
  return {
    lat0,
    lon0,
    M,
    N,
    toLocal: ([lon, lat]) => [N * cos0 * (lon - lon0) * D2R, M * (lat - lat0) * D2R],
    toLonLat: ([x, y]) => [lon0 + x / (N * cos0) / D2R, lat0 + y / M / D2R],
  };
}

/** Haversine on the mean sphere — only for coarse validation distances (km scale), never for geometry. */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------- ring utilities (rings are arrays of XY WITHOUT the closing duplicate) ----------

export function openRing<T extends number[]>(ring: T[]): T[] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring.slice();
}

export function closeRing<T extends number[]>(ring: T[]): T[] {
  return ring.length ? [...ring, ring[0]] : ring;
}

/** Signed area (shoelace). > 0 => counter-clockwise (x east, y north). */
export function signedArea(ring: XY[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function ensureCCW(ring: XY[]): XY[] {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}
export function ensureCW(ring: XY[]): XY[] {
  return signedArea(ring) > 0 ? ring.slice().reverse() : ring;
}

export function perimeter(ring: XY[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) s += dist(ring[i], ring[(i + 1) % n]);
  return s;
}

export function dist(a: XY, b: XY) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Area centroid of a simple polygon (outer ring), falls back to vertex mean for degenerate rings. */
export function centroid(ring: XY[]): XY {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-12) {
    const m = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [m[0] / ring.length, m[1] / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Polygon (outer + holes) area-weighted centroid in local metres. */
export function polygonCentroid(outer: XY[], holes: XY[][] = []): XY {
  const parts = [{ r: outer, s: 1 }, ...holes.map((h) => ({ r: h, s: -1 }))];
  let A = 0,
    X = 0,
    Y = 0;
  for (const { r, s } of parts) {
    const a = Math.abs(signedArea(r)) * s;
    const c = centroid(r);
    A += a;
    X += c[0] * a;
    Y += c[1] * a;
  }
  return A ? [X / A, Y / A] : centroid(outer);
}

/** Ray-casting point-in-ring (boundary points may go either way). */
export function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: XY, outer: XY[], holes: XY[][] = []) {
  return pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h));
}

export function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** 0 if inside, else distance to the nearest edge. */
export function pointPolygonDistance(p: XY, outer: XY[], holes: XY[][] = []): number {
  if (pointInPolygon(p, outer, holes)) return 0;
  let d = Infinity;
  for (const r of [outer, ...holes]) for (let i = 0; i < r.length; i++) d = Math.min(d, pointSegmentDistance(p, r[i], r[(i + 1) % r.length]));
  return d;
}

/** Andrew's monotone chain convex hull, CCW, no duplicate closing point. */
export function convexHull(points: XY[]): XY[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Bearing (azimuth, degrees clockwise from north, 0..360) of the vector a->b in the local frame. */
export function bearingDeg(a: XY, b: XY): number {
  const az = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return (az + 360) % 360;
}

export interface MinAreaRect {
  center: XY;
  length: number; // long side (m)
  width: number; // short side (m)
  area: number;
  /** axis bearing of the long side, folded into [0,180) degrees from north */
  longAxisBearingDeg: number;
  corners: XY[]; // CCW
}

/** Minimum-area enclosing rectangle via rotating calipers over the convex hull edges. */
export function minAreaRect(points: XY[]): MinAreaRect {
  const hull = convexHull(points);
  let best: MinAreaRect | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i],
      b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang),
      s = Math.sin(ang);
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * c + p[1] * s;
      const v = -p[0] * s + p[1] * c;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const du = maxU - minU,
      dv = maxV - minV;
    const area = du * dv;
    if (!best || area < best.area - 1e-9) {
      const toXY = (u: number, v: number): XY => [u * c - v * s, u * s + v * c];
      const corners = [toXY(minU, minV), toXY(maxU, minV), toXY(maxU, maxV), toXY(minU, maxV)];
      const center = toXY((minU + maxU) / 2, (minV + maxV) / 2);
      // long axis direction vector
      const longIsU = du >= dv;
      const dir: XY = longIsU ? [c, s] : [-s, c];
      let brg = (Math.atan2(dir[0], dir[1]) * 180) / Math.PI; // azimuth of dir
      brg = ((brg % 180) + 180) % 180;
      best = { center, length: Math.max(du, dv), width: Math.min(du, dv), area, longAxisBearingDeg: brg, corners };
    }
  }
  return best!;
}

/** Remove vertices whose perpendicular deviation from the chord of their neighbours is below tol (m). */
export function removeCollinear(ring: XY[], tol = 0.05): XY[] {
  let r = ring.slice();
  let changed = true;
  while (changed && r.length > 3) {
    changed = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const prev = r[(i - 1 + r.length) % r.length];
      const next = r[(i + 1) % r.length];
      if (pointSegmentDistance(r[i], prev, next) < tol || dist(prev, r[i]) < 1e-3) {
        r.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return r;
}

export function bboxOf(points: XY[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Clip a ring to an axis-aligned box (Sutherland–Hodgman; exact for convex clip windows).
 * Use client-side after projection instead of Overpass `out geom(s,w,n,e)`, which returns
 * null-padded coordinate arrays (verified) that cannot be re-assembled into valid rings.
 */
export function clipRingToBox(ring: XY[], box: { minX: number; minY: number; maxX: number; maxY: number }): XY[] {
  const edges: [(p: XY) => boolean, (a: XY, b: XY) => XY][] = [
    [(p) => p[0] >= box.minX, (a, b) => [box.minX, a[1] + ((b[1] - a[1]) * (box.minX - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= box.maxX, (a, b) => [box.maxX, a[1] + ((b[1] - a[1]) * (box.maxX - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= box.minY, (a, b) => [a[0] + ((b[0] - a[0]) * (box.minY - a[1])) / (b[1] - a[1]), box.minY]],
    [(p) => p[1] <= box.maxY, (a, b) => [a[0] + ((b[0] - a[0]) * (box.maxY - a[1])) / (b[1] - a[1]), box.maxY]],
  ];
  let out = ring.slice();
  for (const [inside, cut] of edges) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i],
        prev = inp[(i - 1 + inp.length) % inp.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

export const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
export const roundXY = (p: number[], d = 3): XY => [round(p[0], d), round(p[1], d)];
