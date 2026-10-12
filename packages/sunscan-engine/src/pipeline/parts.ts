// Building parts of the spec (final ENU frame): storeys, materials, overhang, chimneys, fit report per part.
import type {
  BuildingPartSpec,
  ChimneySpec,
  Era,
  FitPartReport,
  HeightSource,
  Nation,
  ReconstructedPart,
  RoofSpec,
  Vec2,
} from '@sunny/sunscan-core';
import { pointInPolygon } from '@sunny/sunscan-core/geometry';
import { estimateStoreys, numericTag } from './archetype.js';
import { centroidOf, orientWithKinds, roundTo, roundVec } from './geometry.js';
import { materialsFor } from './materials.js';

/** Everything a part needs besides its geometry. */
export interface PartContext {
  /** Era used for storey heights and material defaults (tagged, else modal for the built form). */
  era: Era;
  nation?: Nation;
  /** Tags of the target building (materials, building:levels). */
  tags: Record<string, string>;
  source: { heights: HeightSource; roof: HeightSource };
  /** Storey count of the main part when already decided (e.g. by the priors fallback). */
  mainStoreys?: number;
}

const roundRoof = (r: RoofSpec): RoofSpec => {
  const out: RoofSpec = { ...r };
  for (const k of ['pitchDeg', 'hipPitchDeg', 'lowerPitchDeg', 'upperPitchDeg', 'breakHeight', 'apexHeight', 'parapetHeight', 'halfHipFraction'] as const) {
    const v = out[k];
    if (typeof v === 'number') out[k] = roundTo(v, 3);
  }
  if (out.components) {
    out.components = out.components.map((c) => ({
      ...c, pitchDeg: roundTo(c.pitchDeg, 3),
      footprint: { outer: c.footprint.outer.map((q) => roundVec(q)), holes: (c.footprint.holes ?? []).map((h) => h.map((q) => roundVec(q))) },
    }));
  }
  return out;
};

/** Index of the part that should own a chimney centred at `c` (containing part, else the nearest centroid). */
export function partForPoint(parts: { footprint: BuildingPartSpec['footprint'] }[], c: Vec2): number {
  const inside = parts.findIndex((p) => pointInPolygon(c, p.footprint));
  if (inside >= 0) return inside;
  let best = 0;
  let bd = Infinity;
  parts.forEach((p, i) => {
    const q = centroidOf(p.footprint);
    const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
    if (d < bd) (bd = d), (best = i);
  });
  return best;
}

/**
 * Turn reconstructed/prior parts (already in final ENU, heights above the ground datum) into BuildingPartSpecs:
 * oriented footprints (mm), storeys from the eave height (OSM building:levels when consistent), materials,
 * 0.25 m overhang (0 for flat roofs) and chimneys assigned to the part containing them.
 */
export function partSpecs(parts: ReconstructedPart[], chimneys: ChimneySpec[], ctx: PartContext): BuildingPartSpec[] {
  const levels = numericTag(ctx.tags['building:levels']);
  const ids = new Set<string>();
  const specs: BuildingPartSpec[] = parts.map((p, i) => {
    const o = orientWithKinds(p.footprint, p.edgeKinds);
    let id = p.id || (i === 0 ? 'main' : `part-${i}`);
    while (ids.has(id)) id = `${id}-${i}`;
    ids.add(id);
    const eave = roundTo(Math.max(0.5, p.eaveHeight), 3);
    const isMain = p.role === 'main' || i === 0;
    const storeys =
      isMain && ctx.mainStoreys !== undefined ? ctx.mainStoreys : !isMain && eave < 3.5 ? 1 : estimateStoreys(eave, ctx.era, isMain ? levels : undefined);
    return {
      id,
      role: p.role,
      footprint: { outer: o.poly.outer.map((q) => roundVec(q)), holes: (o.poly.holes ?? []).map((h) => h.map((q) => roundVec(q))) },
      edgeKinds: o.kinds ?? o.poly.outer.map(() => 'eave'),
      baseHeight: 0,
      eaveHeight: eave,
      roof: roundRoof(p.roof),
      storeys,
      overhang: p.roof.type === 'flat' ? 0 : 0.25,
      material: materialsFor(ctx.tags, ctx.era, ctx.nation, p.roof.type),
      chimneys: [],
      source: { ...ctx.source },
    };
  });
  for (const c of chimneys) {
    if (!specs.length) break;
    const spec = specs[partForPoint(specs, c.center)];
    spec.chimneys.push({
      center: roundVec(c.center),
      width: roundTo(c.width, 2),
      depth: roundTo(c.depth, 2),
      angleDeg: roundTo(c.angleDeg, 1),
      top: roundTo(c.top, 2),
      source: c.source,
    });
  }
  return specs;
}

/** FitReport.parts from the reconstructed parts (ids as in the spec). */
export function fitPartReports(parts: ReconstructedPart[], specs: BuildingPartSpec[]): FitPartReport[] {
  return parts.map((p, i) => ({
    partId: specs[i]?.id ?? p.id,
    family: p.family,
    eaveHeight: roundTo(p.eaveHeight, 3),
    ridgeHeight: roundTo(p.ridgeHeight, 3),
    pitchDeg: roundTo(p.roof.pitchDeg ?? 0, 2),
    ...(p.roof.upperPitchDeg !== undefined ? { upperPitchDeg: roundTo(p.roof.upperPitchDeg, 2) } : {}),
    ...(p.roof.components?.some((c) => c.role === 'cross') ? { crossPitchDeg: roundTo(p.roof.components.find((c) => c.role === 'cross')!.pitchDeg, 2) } : {}),
    ...(p.eaveSE !== undefined && Number.isFinite(p.eaveSE) ? { eaveSE: roundTo(p.eaveSE, 3) } : {}),
    ...(p.pitchSE !== undefined && Number.isFinite(p.pitchSE) ? { pitchSE: roundTo(p.pitchSE, 2) } : {}),
  }));
}
