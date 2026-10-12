// Physical plausibility gate for reconstructed parts. A fit can be statistically fine (sigma* < 0.5) yet describe
// a roof that cannot exist or that the data do not support (e.g. a ridge extrapolated far above every DSM return
// of an odd-shaped partition part). Any failed rule makes reconstruct() return ok = false with the reason flags.
import type { HeightGrid, ReconstructedPart } from '../types.js';
import { pixelCentre, pixelWindow } from './raster.js';
import { bboxOfPoly, pointInPoly, polyArea } from './poly.js';

/** Limits of the physical plausibility gate. */
export interface PlausibilityOptions {
  minEave: number; // m above ground
  minArea: number; // m2
  maxPitch: number; // deg, single-pitch roofs and the upper slope of two-pitch roofs
  maxLowerPitch: number; // deg, steep lower slope of mansards / gambrels
  ridgeMargin: number; // the ridge may exceed the highest DSM return inside the part by at most this (m)
  maxEave: number; // m above ground
}
/** Eave 2-40 m above ground, parts >= 4 m2, pitch <= 70 deg (two-pitch lower slope <= 85 deg). */
export const DEFAULT_PLAUSIBILITY: PlausibilityOptions = { minEave: 2.0, minArea: 4, maxPitch: 70, maxLowerPitch: 85, ridgeMargin: 1.0, maxEave: 40 };

/** Highest finite DSM value with its pixel centre inside the polygon (planar), or null. */
export function maxInside(dsm: HeightGrid, part: ReconstructedPart): number | null {
  const [x0, y0, x1, y1] = bboxOfPoly(part.footprint);
  const win = pixelWindow(dsm, x0, y0, x1, y1);
  if (!win) return null;
  let m = -Infinity;
  for (let r = win.r0; r <= win.r1; r++) for (let c = win.c0; c <= win.c1; c++) {
    const v = dsm.data[r * dsm.width + c];
    if (!(v > m)) continue;
    const [x, y] = pixelCentre(dsm, c, r);
    if (pointInPoly(x, y, part.footprint)) m = v;
  }
  return Number.isFinite(m) ? m : null;
}

/**
 * Reasons why a part is implausible (empty when plausible): 'implausible-eave' (eave < 2 m or > 40 m above
 * ground), 'implausible-ridge' (ridge below eave), 'implausible-area' (< 4 m2), 'implausible-pitch' (> 70 deg;
 * two-pitch lower slope > 85 deg), 'ridge-above-data' (ridge > highest DSM return inside + margin).
 * @param dsmMaxAboveGround highest DSM value inside the part minus the ground (null when unknown)
 */
export function partIssues(part: ReconstructedPart, dsmMaxAboveGround: number | null, o: PlausibilityOptions = DEFAULT_PLAUSIBILITY): string[] {
  const out: string[] = [];
  if (!(part.eaveHeight >= o.minEave && part.eaveHeight <= o.maxEave)) out.push('implausible-eave');
  if (!(part.ridgeHeight >= part.eaveHeight - 1e-6)) out.push('implausible-ridge');
  if (!(polyArea(part.footprint) >= o.minArea)) out.push('implausible-area');
  const r = part.roof;
  const twoPitch = r.type === 'mansard' || r.type === 'gambrel';
  const steep = twoPitch ? (r.lowerPitchDeg ?? 0) > o.maxLowerPitch || (!r.flatTop && (r.upperPitchDeg ?? 0) > o.maxPitch) : (r.pitchDeg ?? 0) > o.maxPitch;
  if (steep) out.push('implausible-pitch');
  if (dsmMaxAboveGround !== null && part.ridgeHeight > dsmMaxAboveGround + o.ridgeMargin) out.push('ridge-above-data');
  return out;
}
