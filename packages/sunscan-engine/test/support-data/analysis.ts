// Shared helper for tests and the fixture recorder: run core/footprint analysis on a fetchBuildings result.
import { analyseFootprint, frameAtCentroid, lonLatToLocal, polygonToLocal, type FootprintAnalysis } from '@sunny/sunscan-core/footprint';
import type { PolygonM } from '@sunny/sunscan-core';
import type { BuildingFeature, BuildingsResult } from '../../src/contracts.js';

/** Built-form analysis of the result's target among its neighbours (optionally restricted to some sources). */
export function analyseTarget(result: BuildingsResult, sources: BuildingFeature['source'][] = ['osm', 'overture']): FootprintAnalysis & { target: BuildingFeature; local: PolygonM } {
  const target = result.buildings.find((b) => b.ref === result.target);
  if (!target) throw new Error('no target in buildings result');
  const frame = frameAtCentroid(target.outer, target.holes);
  const local = polygonToLocal(frame, target.outer, target.holes);
  const neighbours = result.buildings
    .filter((b) => b !== target && !b.isPart && sources.includes(b.source))
    .map((b) => ({ id: b.ref, footprint: polygonToLocal(frame, b.outer, b.holes), tags: b.tags }));
  const addressPoints = result.addressNodes.map((n) => ({ xy: lonLatToLocal(frame, [[n.lon, n.lat]])[0], tags: n.tags }));
  const analysis = analyseFootprint(local, neighbours, { targetTags: target.tags, addressPoints });
  return { ...analysis, target, local };
}
