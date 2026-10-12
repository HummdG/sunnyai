/**
 * From a 3D roof assessment (SunScanV2, via `@sunny/sunscan-adapter`) to the
 * roof the quote engine prices on.
 *
 * The assessment measures the roof; the engine (SunScan v1, ported in
 * `@sunny/quote-engine`) needs a pitch, an MCS orientation, a panel count and a
 * confidence. Two decisions live here:
 *
 * - **Panel capacity is recomputed with v1's own rule** (`calculatePanelLayout`:
 *   landscape modules, 300 mm margin, 20 mm gaps) using the installer's base
 *   panel, over each plane's measured width and slope length, scaled by how much
 *   of that rectangle the plane really fills -- and summed only over the faces v1
 *   calls usable (south, east and west: MCS orientation <= 112.5 degrees). That
 *   keeps the capacity consistent with the panel being priced. The assessment's
 *   own estimate (a 1.722 x 1.134 m module with a 0.4 m setback) is kept beside
 *   it for the installer.
 * - **Confidence follows the assessment honestly.** An unreliable fit, or a
 *   low-confidence status, is `low`, which makes the journey *ask* the roof
 *   questions instead of confirming numbers it does not trust.
 *
 * `RoofAssessmentSummary` below is the subset of the adapter's type this module
 * reads, with the same field names, so the adapter's object passes straight in.
 */

import { azimuthToMcsOrientation, type CataloguePanel } from '@sunny/quote-engine';

export type RoofFacing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'flat';

export interface RoofPlaneInput {
  id: number;
  pitchDeg: number;
  azimuthDeg: number | null;
  facing: RoofFacing;
  areaM2: number;
  widthM: number;
  slopeLengthM: number;
  fillRatio: number;
  usableAreaM2: number;
  maxPanels: number;
  suitable: boolean;
}

/** The fields of `@sunny/sunscan-adapter`'s `RoofAssessmentSummary` the journey reads. */
export interface RoofAssessmentSummary {
  assessmentId: string;
  status: string;
  address: string;
  postcode: string | null;
  builtForm: string;
  storeys: number;
  roofType: string;
  eaveHeightM: number;
  roofPlanes: RoofPlaneInput[];
  usableRoofAreaM2: number;
  estimatedMaxPanels: number;
  mainPlaneId: number | null;
  bestFacing: RoofFacing | null;
  shadingFlags: string[];
  confidence: { roof: string };
  reliable: boolean;
  label: string;
}

/** v1 `panelLayout.ts` constants. */
const MARGIN_M = 0.3;
const GAP_M = 0.02;
/** v1 `roofCapacity.ts`: S/E/W faces count, NE/NW/N do not. */
const USABLE_MAX_MCS_ORIENTATION_DEG = 112.5;
/** v1 `siteContext.ts`: below this pitch a roof is treated as flat. */
const FLAT_ROOF_PITCH_THRESHOLD_DEG = 10;

const FACING_WORDS: Record<RoofFacing, string> = {
  N: 'north',
  NE: 'north-east',
  E: 'east',
  SE: 'south-east',
  S: 'south',
  SW: 'south-west',
  W: 'west',
  NW: 'north-west',
  flat: 'flat',
};

/** The visitor's own direction answer that matches a mapped facing (for a correction). */
export const FACING_TO_DIRECTION: Record<RoofFacing, string> = {
  N: 'north',
  NE: 'east',
  E: 'east',
  SE: 'south_east',
  S: 'south',
  SW: 'south_west',
  W: 'west',
  NW: 'west',
  flat: 'south',
};

/** Panels that fit one plane by v1's packing rule. */
export function panelsForPlane(
  plane: Pick<RoofPlaneInput, 'widthM' | 'slopeLengthM' | 'fillRatio'>,
  panel: Pick<CataloguePanel, 'widthMm' | 'heightMm'>,
): number {
  const usableRidge = Math.max(0, plane.widthM - 2 * MARGIN_M);
  const usableDepth = Math.max(0, plane.slopeLengthM - 2 * MARGIN_M);
  const across = panel.heightMm / 1000;
  const down = panel.widthMm / 1000;
  const cols = Math.max(0, Math.floor((usableRidge + GAP_M) / (across + GAP_M)));
  const rows = Math.max(0, Math.floor((usableDepth + GAP_M) / (down + GAP_M)));
  const fill = Math.min(1, Math.max(0, plane.fillRatio));
  return Math.floor(cols * rows * fill);
}

export type RoofConfidence = 'high' | 'medium' | 'low';

export interface MappedRoof {
  assessmentId: string;
  pitchDeg: number;
  mcsOrientationDeg: number;
  roofType: 'pitched' | 'flat';
  /**
   * v1-rule capacity over the usable faces for the installer's base panel,
   * capped at the assessment's own estimate (the smaller, survey-safe figure).
   */
  maxPanelCount: number;
  /** The assessment's own estimate, for the installer to compare. */
  assessmentMaxPanels: number;
  confidence: RoofConfidence;
  postcode: string | null;
  facing: RoofFacing | null;
  storeys: number;
  eaveHeightM: number;
  /** Extra scaffold storeys v1 would suggest from the eave height (siteContext). */
  extraScaffoldStoreys: number;
  label: string;
}

function mainPlane(summary: RoofAssessmentSummary): RoofPlaneInput | null {
  const byId = summary.roofPlanes.find((p) => p.id === summary.mainPlaneId);
  if (byId) return byId;
  const suitable = summary.roofPlanes.filter((p) => p.suitable);
  return (
    suitable.sort((a, b) => b.usableAreaM2 - a.usableAreaM2)[0] ??
    summary.roofPlanes.sort((a, b) => b.areaM2 - a.areaM2)[0] ??
    null
  );
}

function confidenceOf(summary: RoofAssessmentSummary): RoofConfidence {
  if (!summary.reliable || summary.status === 'low-confidence') return 'low';
  const roof = summary.confidence.roof;
  if (roof === 'measured' || roof === 'high') return 'high';
  if (roof === 'medium') return 'medium';
  return 'low';
}

export function mapRoof(
  summary: RoofAssessmentSummary,
  basePanel: Pick<CataloguePanel, 'widthMm' | 'heightMm'>,
): MappedRoof {
  const main = mainPlane(summary);
  const pitchDeg = Math.round(main?.pitchDeg ?? 35);
  const mcsOrientationDeg =
    main && main.azimuthDeg !== null ? Math.round(azimuthToMcsOrientation(main.azimuthDeg)) : 0;
  const roofType = pitchDeg < FLAT_ROOF_PITCH_THRESHOLD_DEG ? 'flat' : 'pitched';

  const usable = summary.roofPlanes.filter(
    (p) =>
      p.suitable &&
      (p.azimuthDeg === null ||
        azimuthToMcsOrientation(p.azimuthDeg) <= USABLE_MAX_MCS_ORIENTATION_DEG),
  );
  const v1Count = usable.reduce((sum, p) => sum + panelsForPlane(p, basePanel), 0);
  // Never more than the assessment's own estimate: the roof card shows that
  // number, so the conversation and the quote must not promise more than it.
  const maxPanelCount =
    summary.estimatedMaxPanels > 0 ? Math.min(v1Count, summary.estimatedMaxPanels) : v1Count;

  const eave = summary.eaveHeightM || 5;
  return {
    assessmentId: summary.assessmentId,
    pitchDeg,
    mcsOrientationDeg,
    roofType,
    maxPanelCount,
    assessmentMaxPanels: summary.estimatedMaxPanels,
    confidence: confidenceOf(summary),
    postcode: summary.postcode,
    facing: main?.facing ?? summary.bestFacing,
    storeys: summary.storeys,
    eaveHeightM: eave,
    extraScaffoldStoreys: eave >= 9 ? 2 : eave >= 6 ? 1 : 0,
    label: summary.label,
  };
}

/** The question the visitor confirms instead of describing their roof from scratch. */
export function confirmationPrompt(roof: MappedRoof): string {
  const pitch = Math.round(roof.pitchDeg / 5) * 5;
  const facing = roof.facing ? FACING_WORDS[roof.facing] : null;
  const where =
    roof.roofType === 'flat' || roof.facing === 'flat'
      ? 'Your roof looks flat'
      : `Your main roof faces ${facing ?? 'roughly south'} at about ${pitch}°`;
  const room =
    roof.maxPanelCount > 0
      ? `, with room for roughly ${roof.maxPanelCount} panels on the sunnier sides`
      : ', though I could not find a good spot for panels';
  return `${where}${room}. Does that look right?`;
}
