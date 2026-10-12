// Fitted model -> ReconstructedPart: RoofSpec type + per-edge kinds consistent with geometry/roof.ts, eave /
// ridge heights above the ground estimate, pitch and standard errors (sigma*^2 (X^T W X)^-1).
import type { EdgeKind } from '../geometry/roof.js';
import type { PolygonM, Vec2 } from '../geometry/geom.js';
import type { ReconstructedPart, RoofSpec } from '../types.js';
import type { ModelDef, PartGeom } from './models.js';
import { translatePoly } from './poly.js';

const deg = (r: number) => (r * 180) / Math.PI;

/** A fitted part mapped to the output contract plus absolute heights and notes. */
export interface PartSummary {
  part: ReconstructedPart;
  /** Fitted absolute eave (raster units) and slope(s) for diagnostics. */
  eaveAbs: number;
  ridgeAbs: number;
  pitchDeg: number;
  upperPitchDeg?: number;
  /** Notes such as 'low-pitch-as-flat' or 'butterfly-as-flat'. */
  notes: string[];
}

/**
 * Map one fitted part to the output contract.
 * @param cov  sigma*^2 (X^T W X)^-1 over the part's columns [e, s(, s2)] (null when unavailable)
 * @param meanT  mean unit time over the part's pixels (used when a near-flat pitched fit is reported as flat)
 */
export function summarisePart(
  geom: PartGeom, m: ModelDef, g: number, beta: number[], cov: number[][] | null, ground: number, origin: Vec2,
  id: string, role: ReconstructedPart['role'], meanT: number, flatPitchDeg = 5,
): PartSummary {
  const notes: string[] = [];
  const footprint: PolygonM = translatePoly(geom.poly, origin[0], origin[1]);
  const flatKinds: EdgeKind[] = m.kinds.length ? m.kinds.map((k) => (k === 'party' ? 'party' : 'eave'))
    : geom.attrs.map((a) => (a.kind === 'party' ? 'party' : 'eave'));
  const se = (i: number) => (cov && cov[i] && cov[i][i] >= 0 ? Math.sqrt(cov[i][i]) : undefined);
  const e = beta[0];
  const mk = (roof: RoofSpec, kinds: EdgeKind[], eaveAbs: number, ridgeAbs: number, family: string, pitch: number, pitchSE?: number, upper?: number): PartSummary => ({
    part: {
      id, role, footprint, edgeKinds: kinds, roof, eaveHeight: eaveAbs - ground, ridgeHeight: ridgeAbs - ground, family,
      ...(pitchSE !== undefined && Number.isFinite(pitchSE) ? { pitchSE } : {}),
      ...(se(0) !== undefined ? { eaveSE: se(0) } : {}),
    },
    eaveAbs, ridgeAbs, pitchDeg: pitch, ...(upper !== undefined ? { upperPitchDeg: upper } : {}), notes,
  });
  if (m.family === 'flat') return mk({ type: 'flat' }, flatKinds, e, e, 'flat', 0);
  const tmax = m.tmax(g);
  if (m.twoPitch) {
    const s1 = beta[1], s2 = beta[2];
    const lower = deg(Math.atan(s1)), upper = deg(Math.atan(s2));
    const ridge = e + s1 * Math.min(tmax, g) + s2 * Math.max(tmax - g, 0);
    if (lower < 1) {
      notes.push('degenerate-two-pitch-as-flat');
      const h = e + s2 * Math.max(meanT - g, 0);
      return mk({ type: 'flat' }, flatKinds, h, h, 'flat', 0);
    }
    const flatTop = upper < 1;
    const roof: RoofSpec = flatTop
      ? { type: 'mansard', pitchDeg: lower, lowerPitchDeg: lower, upperPitchDeg: 25, breakHeight: s1 * g, flatTop: true }
      : { type: m.roofType, pitchDeg: lower, lowerPitchDeg: lower, upperPitchDeg: upper, breakHeight: s1 * g };
    const pse = se(1) !== undefined ? deg(se(1)! / (1 + s1 * s1)) : undefined;
    return mk(roof, m.kinds, e, flatTop ? e + s1 * Math.min(tmax, g) : ridge, m.label, lower, pse, flatTop ? 0 : upper);
  }
  const s = beta[1];
  let pitch = deg(Math.atan(s));
  let pse = se(1) !== undefined ? deg(se(1)! / (1 + s * s)) : undefined;
  if (Math.abs(pitch) < flatPitchDeg) {
    notes.push('low-pitch-as-flat');
    const h = e + s * meanT;
    return mk({ type: 'flat' }, flatKinds, h, h, 'flat', 0);
  }
  if (pitch <= -flatPitchDeg) {
    notes.push('butterfly-as-flat');
    return mk({ type: 'flat' }, flatKinds, e, e, 'butterfly', pitch, pse);
  }
  const ridge = e + s * tmax;
  let roof: RoofSpec;
  if (m.family === 'compound' && m.components) {
    const k = m.components(g), f = geom.frame;
    // (u, v) rectangle -> CCW ring in the output frame; eaves on the two sides parallel to the ridge
    const comp = (role: 'main' | 'cross', [u0, u1, v0, v1]: [number, number, number, number], ridgeDir: 'u' | 'v', p: number) => ({
      role,
      footprint: { outer: ([[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as Vec2[]).map(([u, v]) => [u * f.cos - v * f.sin + origin[0], u * f.sin + v * f.cos + origin[1]] as Vec2) },
      edgeKinds: (ridgeDir === 'u' ? ['eave', 'gable', 'eave', 'gable'] : ['gable', 'eave', 'gable', 'eave']) as EdgeKind[],
      pitchDeg: p,
    });
    roof = { type: 'gabled', pitchDeg: pitch, components: [comp('main', k.main, k.mainRidge, pitch), comp('cross', k.cross, k.crossRidge, deg(Math.atan(s * k.rho)))] };
    return mk(roof, m.kinds, e, ridge, m.label, pitch, pse);
  }
  switch (m.family) {
    case 'hip': roof = { type: 'hipped', pitchDeg: pitch }; break;
    case 'skillion': roof = { type: 'skillion', pitchDeg: pitch }; break;
    case 'halfhip': {
      const f = Math.min(0.95, Math.max(0.05, g / (m.halfWidth ?? tmax)));
      roof = { type: 'half-hipped', pitchDeg: pitch, hipPitchDeg: pitch, halfHipFraction: f };
      break;
    }
    case 'pyramid': {
      const hu = m.hu ?? tmax, hv = m.hv ?? tmax;
      const apex = s * hu;
      const k = hu / Math.min(hu, hv);
      pitch = deg(Math.atan(s * k));
      if (pse !== undefined) pse = deg((se(1)! * k) / (1 + (s * k) ** 2));
      roof = { type: 'pyramidal', pitchDeg: pitch, apexHeight: apex };
      break;
    }
    default: {
      roof = { type: 'gabled', pitchDeg: pitch };
      if (m.steepEdges?.length) {
        const steep = deg(Math.atan(s * 2 ** g));
        roof.edgePitchDeg = m.kinds.map((_, i) => (m.steepEdges!.includes(i) ? steep : undefined));
      }
    }
  }
  return mk(roof, m.kinds, e, ridge, m.label, pitch, pse);
}
