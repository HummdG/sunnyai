// Built form per target candidate for GET /api/buildings (so the map can label "semi-detached", "mid-terrace", ...).
import type { BuiltForm } from '@sunny/sunscan-core';
import type { BuildingFeature, BuildingsResult } from '../contracts.js';
import { polygonDistance } from './geometry.js';
import { featureToScene, frameAtCentroid, normaliseRef, toLocal } from './scene.js';
import { coreAnalyseFootprint } from './core-adapters.js';
import type { AnalyseFootprintFn } from './types.js';

/** A building feature with the built form of candidate targets. */
export type AnnotatedBuilding = BuildingFeature & { builtForm?: BuiltForm };

/**
 * Add `builtForm` to the provider's target and to the best-scored candidates (at most `max`), using the same
 * party-wall analysis as the pipeline. Other features are returned unchanged.
 */
export function annotateBuiltForms(result: BuildingsResult, analyse: AnalyseFootprintFn = coreAnalyseFootprint, max = 10): AnnotatedBuilding[] {
  const scenes = result.buildings.map((f) => ({ f, s: featureToScene(f) }));
  const targetRef = result.target ? normaliseRef(result.target) : undefined;
  const ranked = scenes
    .filter((x) => x.s && !x.s.isPart && (x.s.id === targetRef || typeof x.f.score === 'number'))
    .sort((a, b) => (a.s!.id === targetRef ? -1 : b.s!.id === targetRef ? 1 : (b.f.score ?? -Infinity) - (a.f.score ?? -Infinity)))
    .slice(0, max);
  const forms = new Map<BuildingFeature, BuiltForm>();
  for (const { f, s } of ranked) {
    if (!s) continue;
    try {
      const frame = frameAtCentroid(s.outer, s.holes);
      const poly = toLocal(frame, s);
      const others = scenes
        .filter((o) => o.s && o.s !== s)
        .map((o) => ({ id: o.s!.id, footprint: toLocal(frame, o.s!), tags: o.s!.tags, isPart: o.s!.isPart, source: o.s!.source }))
        .filter((o) => polygonDistance(poly, o.footprint, 60) <= 60);
      const addressNodes = result.addressNodes.map((n) => ({ xy: frame.toLocal([n.lon, n.lat]) as [number, number], tags: n.tags }));
      forms.set(f, analyse({ target: { id: s.id, footprint: poly, tags: s.tags, isPart: false, source: s.source }, others, addressNodes }).builtForm);
    } catch {
      /* unusable geometry: leave unannotated */
    }
  }
  return result.buildings.map((f) => (forms.has(f) ? { ...f, builtForm: forms.get(f)! } : f));
}
