// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\panelLayout.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import type { PanelPosition, PanelSpec, RoofPlane } from './types.js';
import { polygonPrincipalAxisLength } from './geometry.js';

const MARGIN_M = 0.3; // 300mm setback from all four edges
const GAP_M = 0.02; // 20mm between panels

/**
 * Calculate how many panels fit on a roof plane and their 3D positions.
 *
 * Dimensions are derived from the actual slope area and ridge length rather than
 * a square-root approximation. Panels are placed in landscape orientation only
 * (longer dimension along the ridge, shorter dimension down the slope), with a
 * 300mm setback from every edge.
 */
export function calculatePanelLayout(
  roofPlane: RoofPlane,
  panelSpec: PanelSpec,
  wallHeightM: number = 5.5,
): { positions: PanelPosition[]; count: number } {
  // Ridge length from the longest edge of the footprint corners
  const ridgeLength = polygonPrincipalAxisLength(roofPlane.cornersLocal);
  // Slope depth from area ÷ ridge length (areaM2 is already pitch-adjusted)
  const slopeDepthM = roofPlane.areaM2 / Math.max(ridgeLength, 1);

  // Apply 300mm setback on all four edges
  const usableRidge = Math.max(0, ridgeLength - 2 * MARGIN_M);
  const usableDepth = Math.max(0, slopeDepthM - 2 * MARGIN_M);

  // Landscape orientation: longer dimension (heightMm) along ridge, shorter (widthMm) down slope
  const panelAcross = panelSpec.heightMm / 1000; // e.g. 1.722m
  const panelDown = panelSpec.widthMm / 1000; // e.g. 1.134m

  const cols = Math.max(0, Math.floor((usableRidge + GAP_M) / (panelAcross + GAP_M)));
  const rows = Math.max(0, Math.floor((usableDepth + GAP_M) / (panelDown + GAP_M)));

  // 3D positions in local slope space
  const pitchRad = (roofPlane.tiltDeg * Math.PI) / 180;
  const startX = -(cols * (panelAcross + GAP_M) - GAP_M) / 2 + panelAcross / 2;
  const eaveY = wallHeightM;
  const panelDepth = panelSpec.depthMm / 1000;
  const ABOVE_ROOF = 0.05; // 50mm standoff above roof surface

  const positions: PanelPosition[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const localX = startX + col * (panelAcross + GAP_M);
      const slopeD = MARGIN_M + row * (panelDown + GAP_M) + panelDown / 2;
      const y = eaveY + slopeD * Math.sin(pitchRad) + ABOVE_ROOF + panelDepth / 2;
      const z = -slopeD * Math.cos(pitchRad);
      positions.push({ col, row, x: localX, y, z, rotationY: 0 });
    }
  }

  return { positions, count: positions.length };
}
