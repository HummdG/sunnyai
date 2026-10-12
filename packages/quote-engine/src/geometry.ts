// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\geometry.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type { RoofPlane } from './types.js';

// The BNG <-> WGS84 conversions (proj4) are not ported: the quote engine never
// needs them, and keeping them would add a dependency for nothing.

/**
 * Convert a WGS84 polygon to local metre offsets relative to the centroid.
 * Uses flat-earth approximation — valid at building scale (<500m).
 * Returns [x, z] pairs where x=east, z=south (Three.js convention: +x right, +z toward viewer).
 */
export function wgs84ToLocalMetres(
  polygon: [number, number][],
  centre: [number, number],
): [number, number][] {
  const [cLng, cLat] = centre;
  const cosLat = Math.cos((cLat * Math.PI) / 180);
  return polygon.map(([lng, lat]) => {
    const x = (lng - cLng) * cosLat * 111320;
    const z = (lat - cLat) * 110540 * -1; // invert so +z = south in Three.js
    return [x, z];
  });
}

/**
 * Shoelace formula: signed area of a 2D polygon.
 * Returns positive for CCW, negative for CW.
 */
export function polygonSignedArea(polygon: [number, number][]): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % n]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

export function polygonArea(polygon: [number, number][]): number {
  return Math.abs(polygonSignedArea(polygon));
}

export function polygonCentroid(polygon: [number, number][]): [number, number] {
  const n = polygon.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of polygon) {
    cx += x;
    cy += y;
  }
  return [cx / n, cy / n];
}

/**
 * Length of the longest edge in a polygon (ridge length estimate).
 */
export function polygonPrincipalAxisLength(polygon: [number, number][]): number {
  let maxLen = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = polygon[i]!;
    const [x2, z2] = polygon[(i + 1) % n]!;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > maxLen) maxLen = len;
  }
  return maxLen;
}

/**
 * Find the principal axis of a polygon (direction of the longest bounding edge).
 * Returns angle in radians from +x axis.
 */
export function polygonPrincipalAxis(polygon: [number, number][]): number {
  let maxLen = 0;
  let angle = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = polygon[i]!;
    const [x2, z2] = polygon[(i + 1) % n]!;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > maxLen) {
      maxLen = len;
      angle = Math.atan2(dz, dx);
    }
  }
  return angle;
}

/**
 * Estimate roof planes from a local-metre building footprint polygon.
 * For MVP, generates two simple planes (front and back) split along the ridge.
 * Returns the south-facing plane first.
 *
 * TODO: Replace with LiDAR / OS MasterMap Topography roof data when available.
 */
export function estimateRoofPlanes(
  localPolygon: [number, number][],
  pitchDeg: number,
  wallHeightM: number = 5.5,
): RoofPlane[] {
  const area = polygonArea(localPolygon);
  const principalAxis = polygonPrincipalAxis(localPolygon);

  // Each plane gets roughly half the footprint area, scaled up by 1/cos(pitch)
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const planeAreaM2 = area / 2 / Math.cos(pitchRad);

  // Ridge height above eave
  const cx = Math.cos(principalAxis);
  const cz = Math.sin(principalAxis);
  const ridgeOffset = Math.sqrt(area / 2) * Math.tan(pitchRad);

  // Normal vectors for front (south) and back (north) planes
  const frontNormal: [number, number, number] = [
    cz * Math.sin(pitchRad),
    Math.cos(pitchRad),
    -cx * Math.sin(pitchRad),
  ];

  const backNormal: [number, number, number] = [
    -cz * Math.sin(pitchRad),
    Math.cos(pitchRad),
    cx * Math.sin(pitchRad),
  ];

  // Compass facing: approximate from principal axis
  // Principal axis is along ridge; roof faces perpendicular to ridge
  const frontFacingDeg = ((((principalAxis * 180) / Math.PI + 90) % 360) + 360) % 360;

  const frontOrientationDeg = compassToMcsOrientation(frontFacingDeg);
  const backOrientationDeg = compassToMcsOrientation((frontFacingDeg + 180) % 360);

  const ridgeY = wallHeightM + ridgeOffset;

  return [
    {
      cornersLocal: localPolygon.slice(0, 4),
      facingDeg: frontFacingDeg,
      orientationDeg: frontOrientationDeg,
      tiltDeg: pitchDeg,
      areaM2: planeAreaM2,
      normal: frontNormal,
    },
    {
      cornersLocal: localPolygon.slice(0, 4),
      facingDeg: (frontFacingDeg + 180) % 360,
      orientationDeg: backOrientationDeg,
      tiltDeg: pitchDeg,
      areaM2: planeAreaM2,
      normal: backNormal,
    },
  ];

  void ridgeY; // used in 3D viewer
}

/**
 * Convert compass bearing (0=North) to MCS orientation (0=South).
 */
export function compassToMcsOrientation(compassDeg: number): number {
  return Math.abs(compassDeg - 180);
}

/**
 * Select the best roof plane for solar (closest to south-facing).
 */
export function getBestRoofPlane(planes: RoofPlane[]): RoofPlane {
  return planes.reduce((best, plane) =>
    plane.orientationDeg < best.orientationDeg ? plane : best,
  );
}
