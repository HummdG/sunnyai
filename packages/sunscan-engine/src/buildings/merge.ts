// Merging Overture outlines into the OSM set: keep Overture buildings only where OSM has nothing
// (dedupe by OSM record id and by overlap >= 50 % of either polygon), within the query radius.
import { makeFrame, pointInPolygon, pointPolygonDistance, signedArea, type XY } from '@sunny/sunscan-core/geo';
import type { LonLat } from '../contracts.js';
import type { OvertureBuilding } from './overture.js';

/** A polygon in local metres (outer + holes). */
export interface LocalPoly { outer: XY[]; holes: XY[][] }

const areaOf = (p: LocalPoly) => Math.abs(signedArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);

function bbox(r: XY[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Intersection area of two polygons estimated on a regular sample grid over the bbox overlap (step adapts to the
 * smaller polygon: ~1 000+ samples), returned as fractions of each polygon's area.
 */
export function overlapFractions(a: LocalPoly, b: LocalPoly): { ofA: number; ofB: number; area: number } {
  const ba = bbox(a.outer);
  const bb = bbox(b.outer);
  const minX = Math.max(ba.minX, bb.minX);
  const maxX = Math.min(ba.maxX, bb.maxX);
  const minY = Math.max(ba.minY, bb.minY);
  const maxY = Math.min(ba.maxY, bb.maxY);
  const A = areaOf(a);
  const B = areaOf(b);
  if (minX >= maxX || minY >= maxY || A <= 0 || B <= 0) return { ofA: 0, ofB: 0, area: 0 };
  const step = Math.min(1, Math.max(0.05, Math.sqrt(Math.min(A, B) / 1200)));
  let hits = 0;
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      const p: XY = [x, y];
      if (pointInPolygon(p, a.outer, a.holes) && pointInPolygon(p, b.outer, b.holes)) hits++;
    }
  }
  const inter = hits * step * step;
  return { ofA: Math.min(1, inter / A), ofB: Math.min(1, inter / B), area: inter };
}

/** Result of {@link mergeOverture}. */
export interface OvertureMerge {
  /** Overture buildings kept (not duplicating any OSM outline, within the radius). */
  kept: OvertureBuilding[];
  duplicates: number;
  outside: number;
}

/**
 * Selects Overture buildings that fill gaps in the OSM set: drops those whose OSM record is already present, those
 * overlapping an OSM building by >= `minOverlap` of either polygon, and those farther than `radius` m from the point.
 */
export function mergeOverture(
  lat: number, lon: number, radius: number,
  osm: { osmRef?: string; outer: LonLat[]; holes: LonLat[][] }[],
  overture: OvertureBuilding[],
  minOverlap = 0.5,
): OvertureMerge {
  const frame = makeFrame(lat, lon);
  const loc = (outer: LonLat[], holes: LonLat[][]): LocalPoly => ({ outer: outer.map((c) => frame.toLocal(c)), holes: holes.map((h) => h.map((c) => frame.toLocal(c))) });
  const osmLocal = osm.map((o) => ({ ref: o.osmRef, poly: loc(o.outer, o.holes) })).map((o) => ({ ...o, box: bbox(o.poly.outer) }));
  const osmRefs = new Set(osm.map((o) => o.osmRef).filter((r): r is string => !!r));
  const kept: OvertureBuilding[] = [];
  let duplicates = 0;
  let outside = 0;
  for (const b of overture) {
    if (b.osmRef && osmRefs.has(b.osmRef)) {
      duplicates++;
      continue;
    }
    const p = loc(b.outer, b.holes);
    if (p.outer.length < 3 || areaOf(p) < 1) continue;
    if (pointPolygonDistance([0, 0], p.outer, p.holes) > radius) {
      outside++;
      continue;
    }
    const box = bbox(p.outer);
    const dup = osmLocal.some((o) => {
      if (o.box.maxX < box.minX || o.box.minX > box.maxX || o.box.maxY < box.minY || o.box.minY > box.maxY) return false;
      const f = overlapFractions(p, o.poly);
      return f.ofA >= minOverlap || f.ofB >= minOverlap;
    });
    if (dup) duplicates++;
    else kept.push(b);
  }
  return { kept, duplicates, outside };
}
