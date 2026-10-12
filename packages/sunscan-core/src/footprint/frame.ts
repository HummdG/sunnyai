// WGS84 <-> local ENU helpers for footprints, built on core/geo makeFrame (ellipsoidal tangent plane, <= 1.4 mm/100 m).
import { makeFrame, polygonCentroid, type LocalFrame, type LonLat } from '../geo/geo.js';
import { orientPolygon, type PolygonM, type Vec2 } from '../geometry/geom.js';

export type { LocalFrame, LonLat };

/** Drops a closing duplicate vertex (first == last) if present. */
export function openLonLatRing(ring: LonLat[]): LonLat[] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring.slice();
}

/** Converts a lon/lat ring (or line) to local metres in `frame` (x = east, y = north). Order is preserved. */
export function lonLatToLocal(frame: LocalFrame, ring: LonLat[]): Vec2[] {
  return ring.map((c) => frame.toLocal(c) as Vec2);
}

/** Converts local metres back to lon/lat. */
export function localToLonLat(frame: LocalFrame, ring: Vec2[]): LonLat[] {
  return ring.map((p) => frame.toLonLat(p));
}

/** Converts a lon/lat polygon to a local PolygonM (closing duplicates removed, outer CCW, holes CW). */
export function polygonToLocal(frame: LocalFrame, outer: LonLat[], holes: LonLat[][] = []): PolygonM {
  return orientPolygon({
    outer: lonLatToLocal(frame, openLonLatRing(outer)),
    holes: holes.map((h) => lonLatToLocal(frame, openLonLatRing(h))).filter((h) => h.length >= 3),
  });
}

/** Local frame whose origin is the area centroid of a lon/lat polygon (the spec's target-centroid origin). */
export function frameAtCentroid(outer: LonLat[], holes: LonLat[][] = []): LocalFrame {
  const ring = openLonLatRing(outer);
  const lat0 = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const lon0 = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const f0 = makeFrame(lat0, lon0);
  const c = polygonCentroid(lonLatToLocal(f0, ring), holes.map((h) => lonLatToLocal(f0, openLonLatRing(h))));
  const [lon, lat] = f0.toLonLat(c);
  return makeFrame(lat, lon);
}
