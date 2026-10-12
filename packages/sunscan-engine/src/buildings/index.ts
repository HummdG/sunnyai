// fetchBuildings (spec §5.2): Overpass (failover) -> stitched OSM outlines + address/entrance nodes + roads,
// Overture PMTiles outlines merged where OSM has none (missing target or neighbours), target-candidate scoring.
import type { BuildingFeature, BuildingsRequest, BuildingsResult } from '../contracts.js';
import { isReplayMiss } from '../http/index.js';
import { scoreTargets, type BuildingInput } from './candidates.js';
import { mergeOverture } from './merge.js';
import { parseOsmElements, type ParsedOsm } from './osm.js';
import { fetchOvertureBuildings, OVERTURE_RELEASE, type OvertureBuilding } from './overture.js';
import { buildFootprintQuery, overpassQuery, type OverpassOptions } from './overpass.js';

export { buildFootprintQuery, overpassQuery, parseOsmRef, OVERPASS_ENDPOINTS, ROAD_KINDS, OverpassError, type OverpassResult, type OverpassAttempt, type OverpassOptions } from './overpass.js';
export { parseOsmElements, elementToPolygons, stitchRings, ringContainsLonLat, type OsmElement, type OsmPolygon, type OsmPoint, type OsmRoad, type ParsedOsm } from './osm.js';
export { fetchOvertureBuildings, decodeBuildingTile, tilesAround, lonLatToTile, CachedPmtilesSource, decompressPmtiles, OVERTURE_BUILDINGS_URL, OVERTURE_RELEASE, OVERTURE_ZOOM, type OvertureBuilding } from './overture.js';
export { mergeOverture, overlapFractions, type OvertureMerge, type LocalPoly } from './merge.js';
export { scoreTargets, type BuildingInput, type ScoredCandidate, type ScoringContext } from './candidates.js';

/** Default search radius (m): target, neighbours and the neighbours' neighbours (end-terrace vs semi). */
export const DEFAULT_RADIUS = 80;
/** An OSM building within this distance (m) of the point counts as "OSM has a building here". */
const NEAR_M = 5;

/** Options of {@link fetchBuildings}. */
export interface FetchBuildingsOptions {
  /** Merge Overture outlines (default true). */
  overture?: boolean;
  overpass?: OverpassOptions;
}

const EMPTY: ParsedOsm = { polygons: [], addressNodes: [], entrances: [], roads: [], nodes: new Map(), areas: new Map() };

/**
 * Building outlines around a point, ranked as candidates for the requested house (score + reasons), with the
 * geocoder's OSM object forced in and preferred. Overture fills gaps; partial provider outages become warnings.
 */
export async function fetchBuildings(req: BuildingsRequest, opts: FetchBuildingsOptions = {}): Promise<BuildingsResult> {
  if (!Number.isFinite(req.lat) || !Number.isFinite(req.lon) || Math.abs(req.lat) > 90 || Math.abs(req.lon) > 180) {
    throw new RangeError(`fetchBuildings: invalid point (${req.lat}, ${req.lon})`);
  }
  const radius = Math.min(250, Math.max(10, Math.round(req.radius ?? DEFAULT_RADIUS)));
  const warnings: string[] = [];
  const sources: string[] = [];
  let osm = EMPTY;
  let osmOk = false;
  try {
    const res = await overpassQuery(buildFootprintQuery(req.lat, req.lon, radius, req.osmRef), opts.overpass);
    osm = parseOsmElements(res.elements);
    osmOk = true;
    sources.push(`overpass:${new URL(res.endpoint).host}${res.osmBase ? `@${res.osmBase}` : ''}`);
    for (const p of osm.polygons) for (const w of p.warnings) warnings.push(`osm:${p.ref}: ${w}`);
  } catch (e) {
    if (isReplayMiss(e)) throw e;
    warnings.push(`OpenStreetMap (Overpass) unavailable: ${(e as Error).message}`);
  }
  let overture: OvertureBuilding[] = [];
  let overtureOk = false;
  if (opts.overture !== false) {
    try {
      overture = await fetchOvertureBuildings(req.lat, req.lon, radius + 30);
      overtureOk = true;
      sources.push(`overture:${OVERTURE_RELEASE}`);
    } catch (e) {
      if (isReplayMiss(e)) throw e;
      warnings.push(`Overture buildings unavailable: ${(e as Error).message}`);
    }
  }
  if (!osmOk && !overtureOk) throw new Error(`fetchBuildings: no building source available (${warnings.join('; ')})`);

  const inputs: BuildingInput[] = osm.polygons.map((p) => ({
    ref: `osm:${p.ref}`, osmRef: p.ref, source: 'osm', tags: p.tags, outer: p.outer, holes: p.holes, isPart: p.kind === 'building:part',
  }));
  const osmBuildings = inputs.filter((b) => !b.isPart);
  if (overture.length) {
    const merged = mergeOverture(req.lat, req.lon, radius, osmBuildings, overture);
    for (const b of merged.kept) {
      inputs.push({ ref: `overture:${b.id}`, source: 'overture', tags: b.tags, outer: b.outer, holes: b.holes, isPart: false });
    }
    if (merged.kept.length) warnings.push(`${merged.kept.length} Overture outline(s) added where OSM has no building`);
  }
  const { ranked, ambiguous } = scoreTargets(req.lat, req.lon, inputs, {
    osmRef: req.osmRef, parsed: req.parsed, addressNodes: osm.addressNodes, nodes: osm.nodes, areas: osm.areas,
  });
  const nearOsm = ranked.some((c) => c.ref.startsWith('osm:') && c.distance <= NEAR_M);
  if (!nearOsm) warnings.push('no OSM building at the point: candidates may come from Overture (footprint-from-overture)');
  const byRef = new Map(ranked.map((c) => [c.ref, c]));
  const features: BuildingFeature[] = inputs.map((b) => {
    const s = byRef.get(b.ref);
    return { ref: b.ref, source: b.source, outer: b.outer, holes: b.holes, tags: b.tags, isPart: b.isPart, ...(s ? { score: s.score, reasons: s.reasons } : {}) };
  });
  features.sort((x, y) => Number(x.isPart) - Number(y.isPart) || (y.score ?? -Infinity) - (x.score ?? -Infinity) || x.ref.localeCompare(y.ref));
  const target = ranked[0]?.ref;
  if (!target) warnings.push('no building outline found near the point');
  return {
    center: { lat: req.lat, lon: req.lon },
    ...(target ? { target } : {}),
    ambiguous,
    buildings: features,
    addressNodes: osm.addressNodes.map((n) => ({ lon: n.lon, lat: n.lat, tags: n.tags })),
    entrances: osm.entrances.map((n) => ({ lon: n.lon, lat: n.lat, tags: n.tags })),
    roads: osm.roads.map((r) => ({ ...(r.name ? { name: r.name } : {}), kind: r.kind, coords: r.coords })),
    sources,
    warnings,
  };
}
