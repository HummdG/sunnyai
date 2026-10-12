import type { HouseMesh, HouseModelSpec } from '@sunny/sunscan-core/types';

import {
  INDICATIVE_LABEL,
  ROOF_LAYOUT,
  type AssessmentSummary,
  type Facing,
  type RoofPlaneSummary,
} from './types.js';

/**
 * Turning the engine's model into what a visitor and the assistant are told.
 *
 * Two rules. First, nothing here is a yield, a panel count or a price: the
 * summary describes roof geometry the engine measured, and `recommend_packages`
 * and the installer's survey own everything after that. Second, the engine's own
 * doubts travel with the numbers -- its quality grades, flags and notes are
 * passed through untouched, and `reliable` is false whenever the fit was
 * flagged or there was no LiDAR, so a client cannot show an estimated roof as a
 * measured one.
 */

/** Pitches panels are normally fitted at; steeper or shallower planes are not counted as suitable. */
const SUITABLE_PITCH = { min: 10, max: 60 } as const;
/** Planes smaller than this hold no useful array. */
const MIN_PLANE_M2 = 4;
/** East (67.5°) through south to west (292.5°): the facings a pitched array is normally fitted on. */
const SUITABLE_AZIMUTH = { from: 67.5, to: 292.5 } as const;

const POINTS: Facing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function facingOf(azimuthDeg: number | null): Facing {
  if (azimuthDeg === null || !Number.isFinite(azimuthDeg)) return 'flat';
  const a = ((azimuthDeg % 360) + 360) % 360;
  return POINTS[Math.round(a / 45) % 8] ?? 'N';
}

const round = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Whether a roof plane faces and slopes the way panels are normally fitted. */
export function isSuitable(plane: {
  pitchDeg: number;
  azimuthDeg: number | null;
  areaM2: number;
}): boolean {
  if (plane.areaM2 < MIN_PLANE_M2) return false;
  if (plane.azimuthDeg === null) return true; // flat roofs take framed arrays
  const a = ((plane.azimuthDeg % 360) + 360) % 360;
  return (
    plane.pitchDeg >= SUITABLE_PITCH.min &&
    plane.pitchDeg <= SUITABLE_PITCH.max &&
    a >= SUITABLE_AZIMUTH.from &&
    a <= SUITABLE_AZIMUTH.to
  );
}

const UNRELIABLE_FLAGS = ['fit-unreliable', 'lidar-unavailable', 'fit-failed'];
/** Engine flags that bear on shading; passed through to `shadingFlags`. */
const SHADING_FLAGS = ['vegetation-masked', 'tall-neighbour', 'neighbour-taller', 'tree-cover'];

interface PlaneExtent {
  widthM: number;
  slopeLengthM: number;
  fillRatio: number;
}

/**
 * Width along the eave and length up the slope of one roof face, from the
 * wall-line roof layer's triangles tagged with the face id (local ENU metres).
 * Flat faces use their plan extents along x and y.
 */
function extentOf(
  mesh: HouseMesh,
  faceId: number,
  azimuthDeg: number,
  pitchDeg: number,
  area: number,
): PlaneExtent {
  const az = (azimuthDeg * Math.PI) / 180;
  const flat = !Number.isFinite(azimuthDeg);
  // Downslope (d) and along-eave (e) unit vectors in the horizontal (E, N) plane.
  const d = flat ? [0, 1] : [Math.sin(az), Math.cos(az)];
  const e = flat ? [1, 0] : [Math.cos(az), -Math.sin(az)];
  let uMin = Infinity,
    uMax = -Infinity,
    vMin = Infinity,
    vMax = -Infinity;
  for (const layer of mesh.layers) {
    if (layer.kind !== 'roof' || !layer.triangleTags) continue;
    for (let t = 0; t < layer.triangleTags.length; t++) {
      if (layer.triangleTags[t] !== faceId) continue;
      for (let k = 0; k < 3; k++) {
        const i = layer.indices[3 * t + k];
        const x = layer.positions[3 * i],
          y = layer.positions[3 * i + 1];
        const u = x * e[0] + y * e[1],
          v = x * d[0] + y * d[1];
        uMin = Math.min(uMin, u);
        uMax = Math.max(uMax, u);
        vMin = Math.min(vMin, v);
        vMax = Math.max(vMax, v);
      }
    }
  }
  if (!Number.isFinite(uMin)) return { widthM: 0, slopeLengthM: 0, fillRatio: 0 };
  const widthM = uMax - uMin;
  const cos = Math.cos(((flat ? 0 : pitchDeg) * Math.PI) / 180);
  const slopeLengthM = cos > 1e-6 ? (vMax - vMin) / cos : 0;
  const rect = widthM * slopeLengthM;
  return { widthM, slopeLengthM, fillRatio: rect > 0 ? Math.min(1, area / rect) : 0 };
}

/** Usable area and an upper panel estimate for one plane, under ROOF_LAYOUT's assumptions. */
function capacityOf(ext: PlaneExtent): { usableAreaM2: number; maxPanels: number } {
  const s = ROOF_LAYOUT.edgeSetbackM;
  const w = Math.max(0, ext.widthM - 2 * s);
  const l = Math.max(0, ext.slopeLengthM - 2 * s);
  const fit = (a: number, b: number) => Math.floor(w / a) * Math.floor(l / b);
  const grid = Math.max(
    fit(ROOF_LAYOUT.panelShortM, ROOF_LAYOUT.panelLongM),
    fit(ROOF_LAYOUT.panelLongM, ROOF_LAYOUT.panelShortM),
  );
  return { usableAreaM2: w * l * ext.fillRatio, maxPanels: Math.floor(grid * ext.fillRatio) };
}

export function summarise(spec: HouseModelSpec, mesh: HouseMesh): AssessmentSummary {
  const planes: RoofPlaneSummary[] = mesh.roofFaces
    .filter((f) => f.kind === 'roof' || f.kind === 'flat')
    .map((f) => {
      const flat = f.kind === 'flat' || !Number.isFinite(f.azimuthDeg);
      const plane = {
        id: f.id,
        partId: f.partId,
        pitchDeg: round(f.pitchDeg),
        azimuthDeg: flat ? null : round(f.azimuthDeg, 0),
        facing: flat ? ('flat' as const) : facingOf(f.azimuthDeg),
        areaM2: round(f.area),
        planAreaM2: round(f.planArea),
      };
      const suitable = isSuitable(plane);
      const ext = extentOf(mesh, f.id, flat ? NaN : f.azimuthDeg, f.pitchDeg, f.area);
      const cap = suitable ? capacityOf(ext) : { usableAreaM2: 0, maxPanels: 0 };
      return {
        ...plane,
        widthM: round(ext.widthM, 2),
        slopeLengthM: round(ext.slopeLengthM, 2),
        fillRatio: round(ext.fillRatio, 2),
        usableAreaM2: round(cap.usableAreaM2),
        maxPanels: cap.maxPanels,
        suitable,
      };
    })
    .sort((a, b) => b.areaM2 - a.areaM2);

  const suitable = planes.filter((p) => p.suitable);
  const main = spec.parts.find((p) => p.role === 'main') ?? spec.parts[0];
  const q = spec.quality;
  const reliable =
    !spec.fit?.unreliable &&
    !q.flags.some((f) => UNRELIABLE_FLAGS.includes(f)) &&
    (q.roof === 'measured' || q.roof === 'high' || q.roof === 'medium');

  return {
    address: spec.address.display,
    postcode: spec.address.postcode ?? null,
    builtForm: spec.builtForm,
    era: spec.era,
    storeys: main?.storeys ?? 0,
    roofType: main?.roof.type ?? 'unknown',
    eaveHeightM: round(main?.eaveHeight ?? 0),
    roofPlanes: planes,
    suitableRoofAreaM2: round(suitable.reduce((sum, p) => sum + p.areaM2, 0)),
    usableRoofAreaM2: round(suitable.reduce((sum, p) => sum + p.usableAreaM2, 0)),
    estimatedMaxPanels: suitable.reduce((sum, p) => sum + p.maxPanels, 0),
    mainPlaneId: [...suitable].sort((a, b) => b.usableAreaM2 - a.usableAreaM2)[0]?.id ?? null,
    bestFacing: suitable[0]?.facing ?? null,
    obstructions: { chimneys: spec.parts.reduce((n, p) => n + p.chimneys.length, 0) },
    shadingFlags: [...q.flags.filter((f) => SHADING_FLAGS.includes(f)), 'shading-not-assessed'],
    confidence: {
      geocode: q.geocode,
      footprint: q.footprint,
      heights: q.heights,
      roof: q.roof,
    },
    reliable,
    flags: [...q.flags],
    notes: [...q.notes],
    sources: spec.provenance.map((s) => ({
      id: s.id,
      title: s.title,
      licence: s.licence,
      attribution: s.attribution,
    })),
    label: INDICATIVE_LABEL,
  };
}
