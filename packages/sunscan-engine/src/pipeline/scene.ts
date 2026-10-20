// Target selection and preparation of the buildings around the point (lon/lat rings, oriented, cleaned).
import { createHash } from 'node:crypto';
import { makeFrame, type LocalFrame } from '@sunny/sunscan-core/geo';
import { pointInPolygon, type PolygonM, type Vec2 } from '@sunny/sunscan-core/geometry';
import type { BuildingFeature, BuildingsResult, LonLat } from '../contracts.js';
import { PipelineError } from './errors.js';
import { centroidOf, dedupeRing, footprintProblem, openRing, polygonDistance, signedArea } from './geometry.js';
import type { BuildModelRequest } from './types.js';

/** A building of the scene with oriented lon/lat rings (outer CCW, holes CW, open). */
export interface SceneBuilding {
  id: string;
  source: 'osm' | 'overture' | 'drawn';
  tags: Record<string, string>;
  isPart: boolean;
  outer: LonLat[];
  holes: LonLat[][];
}

/** How the target was chosen. */
export type TargetChoice = 'drawn' | 'ref' | 'provider' | 'contains' | 'nearest';

/**
 * 'way/1' | 'w1' | 'osm:way/1' -> 'osm:way/1'; the '#k' suffix /api/buildings gives the extra outer rings of a
 * multi-outer relation is kept ('relation/5#2' -> 'osm:relation/5#2'); 'overture:x' and 'drawn:x' unchanged.
 */
export function normaliseRef(ref: string): string {
  const r = ref.trim();
  if (/^(osm|overture|drawn):/.test(r)) return r;
  const m = /^(way|relation|node)\/(\d+)(#\d+)?$/i.exec(r) ?? /^([wrn])(\d+)(#\d+)?$/i.exec(r);
  if (m) {
    const t = m[1].toLowerCase();
    const type = t === 'w' ? 'way' : t === 'r' ? 'relation' : t === 'n' ? 'node' : t;
    return `osm:${type}/${m[2]}${m[3] ?? ''}`;
  }
  return r;
}

/** 'osm:way/1' | 'osm:relation/5#2' -> 'way/1' | 'relation/5' (the OSM object providers take as osmRef), else undefined. */
export function osmRefOf(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const m = /^osm:((?:way|relation|node)\/\d+)(?:#\d+)?$/.exec(normaliseRef(ref));
  return m ? m[1] : undefined;
}

const orientLL = (ring: LonLat[], ccw: boolean): LonLat[] => ((signedArea(ring) > 0) === ccw ? ring : ring.slice().reverse());

/** Clean + orient a lon/lat ring (drops closing vertex and ~1 cm duplicates); undefined if degenerate. */
export function cleanLLRing(ring: readonly LonLat[], ccw: boolean): LonLat[] | undefined {
  const r = dedupeRing(openRing(ring.map((p) => [p[0], p[1]] as LonLat)), 1e-7);
  if (r.length < 3 || Math.abs(signedArea(r)) < 1e-12) return undefined;
  return orientLL(r, ccw);
}

/** Convert a provider feature into a scene building (undefined if its geometry is unusable). */
export function featureToScene(f: BuildingFeature): SceneBuilding | undefined {
  const outer = cleanLLRing(f.outer, true);
  if (!outer) return undefined;
  const holes = f.holes.map((h) => cleanLLRing(h, false)).filter((h): h is LonLat[] => !!h);
  return { id: normaliseRef(f.ref), source: f.source, tags: f.tags ?? {}, isPart: !!f.isPart, outer, holes };
}

/** A local ENU frame at the area centroid of a lon/lat polygon. */
export function frameAtCentroid(outer: LonLat[], holes: LonLat[][] = []): LocalFrame {
  const f0 = makeFrame(outer[0][1], outer[0][0]);
  const c = centroidOf({ outer: outer.map((p) => f0.toLocal(p) as Vec2), holes: holes.map((h) => h.map((p) => f0.toLocal(p) as Vec2)) });
  const [lon, lat] = f0.toLonLat(c);
  return makeFrame(lat, lon);
}

/** Project a scene building into a local frame. */
export function toLocal(frame: LocalFrame, b: Pick<SceneBuilding, 'outer' | 'holes'>): PolygonM {
  return { outer: b.outer.map((p) => frame.toLocal(p) as Vec2), holes: b.holes.map((h) => h.map((p) => frame.toLocal(p) as Vec2)) };
}

/** Back-project a local polygon into lon/lat rings. */
export function toLL(frame: LocalFrame, p: PolygonM): { outer: LonLat[]; holes: LonLat[][] } {
  return { outer: p.outer.map((q) => frame.toLonLat(q) as LonLat), holes: (p.holes ?? []).map((h) => h.map((q) => frame.toLonLat(q) as LonLat)) };
}

/** Building from a user-drawn outline; id = 'drawn:' + hash of the rounded coordinates. */
export function drawnBuilding(footprint: LonLat[]): SceneBuilding {
  const outer = cleanLLRing(footprint, true);
  if (!outer) throw new PipelineError(422, 'invalid-footprint', 'drawn footprint needs at least 3 distinct, non-collinear vertices');
  const f = frameAtCentroid(outer);
  const problem = footprintProblem({ outer: outer.map((p) => f.toLocal(p) as Vec2) });
  if (problem) throw new PipelineError(422, 'invalid-footprint', `drawn footprint rejected: ${problem}`);
  const hash = createHash('sha1')
    .update(outer.map(([x, y]) => `${x.toFixed(7)},${y.toFixed(7)}`).join(';'))
    .digest('hex')
    .slice(0, 12);
  return { id: `drawn:${hash}`, source: 'drawn', tags: { building: 'house' }, isPart: false, outer, holes: [] };
}

/** The chosen target, all other buildings, and how the choice was made. */
export interface TargetSelection {
  target: SceneBuilding;
  others: SceneBuilding[];
  how: TargetChoice;
  warnings: string[];
}

/**
 * Choose the target: user-drawn footprint > explicit buildingRef > provider's best candidate > building containing
 * the point > nearest building within 25 m. Throws 404 for an unknown buildingRef and 422 when nothing qualifies.
 */
export function selectTarget(req: BuildModelRequest, buildings: BuildingsResult | undefined): TargetSelection {
  const warnings: string[] = [];
  const all = (buildings?.buildings ?? []).map(featureToScene).filter((b): b is SceneBuilding => !!b);
  const dropped = (buildings?.buildings.length ?? 0) - all.length;
  if (dropped > 0) warnings.push(`${dropped} building(s) with unusable geometry ignored`);
  let target: SceneBuilding | undefined;
  let how: TargetChoice;
  if (req.footprint && req.footprint.length) {
    target = drawnBuilding(req.footprint);
    how = 'drawn';
  } else if (req.buildingRef) {
    const ref = normaliseRef(req.buildingRef);
    target = all.find((b) => b.id === ref);
    if (!target) {
      // an OSM building cannot be found while OpenStreetMap (Overpass) is down: that is an outage, not a bad request
      const overpassDown = !!buildings && ref.startsWith('osm:') && !buildings.sources.some((x) => x.startsWith('overpass'));
      if (overpassDown) {
        throw new PipelineError(502, 'upstream-error', `OpenStreetMap (Overpass) is unavailable, so building ${ref} could not be loaded. Try again in a minute`);
      }
      throw new PipelineError(404, 'building-not-found', `building ${ref} not found near ${req.lat.toFixed(6)}, ${req.lon.toFixed(6)}`);
    }
    how = 'ref';
  } else {
    const point: LonLat = [req.lon, req.lat];
    const f = makeFrame(req.lat, req.lon);
    const houses = all.filter((b) => !b.isPart);
    const providerRef = buildings?.target ? normaliseRef(buildings.target) : undefined;
    target = providerRef ? houses.find((b) => b.id === providerRef) : undefined;
    how = 'provider';
    if (!target) {
      target = houses.find((b) => pointInPolygon(f.toLocal(point) as Vec2, toLocal(f, b)));
      how = 'contains';
    }
    if (!target) {
      let best: { b: SceneBuilding; d: number } | undefined;
      const pt: PolygonM = { outer: [[-0.01, -0.01], [0.01, -0.01], [0.01, 0.01], [-0.01, 0.01]] };
      for (const b of houses) {
        const d = polygonDistance(toLocal(f, b), pt, 25);
        if (d <= 25 && (!best || d < best.d)) best = { b, d };
      }
      target = best?.b;
      how = 'nearest';
    }
    if (!target) throw new PipelineError(422, 'no-building', `no building footprint at or near ${req.lat.toFixed(6)}, ${req.lon.toFixed(6)}. Draw the outline on the map`);
    if (how !== 'provider') warnings.push(`target chosen by ${how === 'contains' ? 'point-in-polygon' : 'proximity'} (no provider candidate)`);
  }
  const frame = frameAtCentroid(target.outer, target.holes);
  const targetPoly = toLocal(frame, target);
  let others = all.filter((b) => b.id !== target!.id);
  if (how === 'drawn') {
    // the drawn outline replaces whatever buildings it covers
    others = others.filter((b) => {
      const c = centroidOf(toLocal(frame, b));
      return !pointInPolygon(c, targetPoly);
    });
  } else {
    // building:part polygons inside the target belong to the target, not to the neighbourhood
    others = others.filter((b) => !(b.isPart && pointInPolygon(centroidOf(toLocal(frame, b)), targetPoly)));
  }
  return { target, others, how, warnings };
}
