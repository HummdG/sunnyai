// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\roofCapacity.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import {
  estimateRoofPlanes,
  getBestRoofPlane,
  polygonArea,
  polygonCentroid,
  wgs84ToLocalMetres,
} from '../geometry.js';
import { calculatePanelLayout } from '../panelLayout.js';
import { DEFAULT_PANEL } from '../solarCalculations.js';
import type { GoogleSolarBuildingInsights, PanelPosition, PanelSpec } from '../types.js';
import { azimuthToMcsOrientation } from './deriveGeometry.js';

/** Smallest footprint we'll attempt to size a system on (m²). */
const MIN_FOOTPRINT_M2 = 10;

/**
 * Faces more than this far from due south (MCS convention: 0=S, 90=E/W, 180=N)
 * are treated as north-ish and excluded from the "usable" count. 112.5° is the
 * E/W ↔ NE/NW boundary, so S/E/W faces count and NE/NW/N faces don't. Tunable.
 */
const USABLE_MAX_MCS_ORIENTATION_DEG = 112.5;

export interface RoofCapacity {
  /** Panels that fit on the best single south-facing plane. */
  count: number;
  /** 3D positions for the fitted panels (for the report renderer). */
  positions: PanelPosition[];
}

/**
 * Estimate how many panels realistically fit on a building, working from its
 * WGS84 footprint ring rather than a crude footprint-area heuristic.
 *
 * Pipeline (shared by the v2 journey and the legacy report route): split the
 * footprint into two pitched planes, pick the best south-facing one, then
 * grid-pack panels onto it with the standard 300 mm setback and 20 mm gaps.
 * Using the *primary* footprint ring (not multi-part garages/extensions) keeps
 * the count anchored to one plausible roof slope.
 *
 * NOTE: `estimateRoofPlanes` assumes a symmetric dual-pitch gable and derives
 * the ridge from the longest footprint edge — rough for L-shaped/complex or
 * flat roofs. This matches the legacy behaviour and is acceptable for an
 * indicative estimate; Google Solar's panel count is preferred when available.
 */
export function estimateRoofCapacity(
  footprintWgs84: [number, number][],
  pitchDeg: number,
  panel: PanelSpec = DEFAULT_PANEL,
): RoofCapacity {
  if (!footprintWgs84 || footprintWgs84.length < 3) return { count: 0, positions: [] };

  const centre = polygonCentroid(footprintWgs84);
  const footprintLocal = wgs84ToLocalMetres(footprintWgs84, centre);
  if (polygonArea(footprintLocal) < MIN_FOOTPRINT_M2) return { count: 0, positions: [] };

  const planes = estimateRoofPlanes(footprintLocal, pitchDeg);
  const bestPlane = getBestRoofPlane(planes);
  const layout = calculatePanelLayout(bestPlane, panel);
  return { count: layout.count, positions: layout.positions };
}

/**
 * Count the panels Google fits on the *usable* (south / east / west) faces of
 * its largest modelled layout — a realistic "what may fit" figure.
 *
 * Google's `maxArrayPanelsCount` packs every roof face, including north-facing
 * slopes and outbuildings, which wildly overstates a home's practical capacity.
 * Instead we take the biggest `solarPanelConfigs` entry and sum only the segment
 * summaries whose orientation is within `USABLE_MAX_MCS_ORIENTATION_DEG` of due
 * south. Returns 0 when Google supplies no panel configs (caller falls back to
 * the footprint estimate).
 */
export function usableGoogleSolarPanelCount(
  insights: GoogleSolarBuildingInsights | null | undefined,
): number {
  const configs = insights?.solarPotential.solarPanelConfigs;
  if (!configs?.length) return 0;
  const largest = configs.reduce((a, b) => (b.panelsCount > a.panelsCount ? b : a));
  return largest.roofSegmentSummaries.reduce(
    (sum, seg) =>
      azimuthToMcsOrientation(seg.azimuthDegrees) <= USABLE_MAX_MCS_ORIENTATION_DEG
        ? sum + seg.panelsCount
        : sum,
    0,
  );
}
