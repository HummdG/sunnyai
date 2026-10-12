// UK typology priors (research 05 sections 5-6): floor-to-floor heights, plinths and roof pitches by era, roof
// family by built form, the no-LiDAR fallback and storey counts from eave heights. Values marked [ASSUMPTION] in
// the research are priors to be calibrated; every output of `priorsFallback` is labelled as an estimate.
import { buildRoof, type EdgeKind } from '../geometry/roof.js';
import type { PolygonM } from '../geometry/geom.js';
import type { BuiltForm, Era, PriorContext, ReconstructedPart, RoofSpec } from '../types.js';
import { type ModelDef, makePartGeom, partLibrary } from './models.js';
import { bboxOfPoly, normalizeFootprint } from './poly.js';
import { simplifyUntil } from './outline.js';

/** Floor-to-floor height, plinth (m) and roof pitch (deg) priors of one era. */
export interface EraPrior { floorToFloor: number; plinth: number; pitchDeg: number }

/** Table 5.2 (floor-to-floor), section 5.3/7.3 (plinth) and table 5.4 (pitch) per era [ASSUMPTION]. */
export const ERA_PRIORS: Record<Era, EraPrior> = {
  'pre-1919': { floorToFloor: 3.0, plinth: 0.45, pitchDeg: 35 },
  '1919-1944': { floorToFloor: 2.8, plinth: 0.3, pitchDeg: 42 },
  '1945-1964': { floorToFloor: 2.7, plinth: 0.2, pitchDeg: 35 },
  '1965-1980': { floorToFloor: 2.65, plinth: 0.15, pitchDeg: 28 },
  '1981-2000': { floorToFloor: 2.65, plinth: 0.15, pitchDeg: 35 },
  'post-2000': { floorToFloor: 2.65, plinth: 0.15, pitchDeg: 35 },
  unknown: { floorToFloor: 2.7, plinth: 0.2, pitchDeg: 35 },
};

/** Modal era by built form when nothing is tagged (section 5.1) [ASSUMPTION]. */
export function modalEra(form: BuiltForm, bungalow = false): Era {
  if (bungalow) return '1965-1980';
  switch (form) {
    case 'mid-terrace': case 'end-terrace': return 'pre-1919';
    case 'semi-detached': return '1919-1944';
    case 'detached': return 'post-2000';
    default: return '1945-1964';
  }
}

/** Eave above ground of an N-storey house: plinth + N * floor-to-floor - 0.1 m (section 5.3). */
export function eaveForStoreys(storeys: number, era: Era): number {
  const p = ERA_PRIORS[era] ?? ERA_PRIORS.unknown;
  return p.plinth + storeys * p.floorToFloor - 0.1;
}

/** Storey count whose prior eave height is closest to `eaveAboveGround` (section 7.3), at least 1. */
export function storeysFromEave(eaveAboveGround: number, era: Era = 'unknown'): number {
  if (!Number.isFinite(eaveAboveGround)) return 1;
  let best = 1, bd = Infinity;
  for (let n = 1; n <= 12; n++) {
    const d = Math.abs(eaveAboveGround - eaveForStoreys(n, era));
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** Roof families used by the priors. */
export type PriorFamily = 'gable' | 'hip' | 'flat' | 'skillion' | 'half-hip' | 'pyramid' | 'mansard' | 'gambrel';

/** P(family | built form) (table 5.5) with the inter-war / post-1980 semi adjustment [ASSUMPTION]. */
export function familyPrior(form: BuiltForm, era: Era = 'unknown', bungalow = false): Record<PriorFamily, number> {
  let gable: number, hip: number, flat: number, other: number;
  if (bungalow) [gable, hip, flat, other] = [0.48, 0.42, 0.03, 0.07];
  else if (form === 'mid-terrace') [gable, hip, flat, other] = [0.88, 0.02, 0.04, 0.06];
  else if (form === 'end-terrace') [gable, hip, flat, other] = [0.75, 0.18, 0.03, 0.04];
  else if (form === 'semi-detached') {
    const h = era === '1919-1944' ? 0.75 : era === '1981-2000' || era === 'post-2000' ? 0.2 : 0.4;
    [gable, hip, flat, other] = [0.95 - h, h, 0.02, 0.03];
  } else [gable, hip, flat, other] = [0.58, 0.32, 0.03, 0.07];
  return {
    gable, hip: hip * 0.9, pyramid: hip * 0.1, flat,
    skillion: other * 0.4, 'half-hip': other * 0.3, mansard: other * 0.15, gambrel: other * 0.15,
  };
}

/** OSM roof:shape -> family (null when outside the library). */
export function familyFromRoofShape(tag: string | undefined): PriorFamily | null {
  switch ((tag ?? '').trim().toLowerCase().replace(/-/g, '_')) {
    case 'gabled': case 'gabled_row': case 'pitched': case 'saltbox': return 'gable';
    case 'hipped': case 'side_hipped': return 'hip';
    case 'half_hipped': return 'half-hip';
    case 'flat': return 'flat';
    case 'skillion': case 'lean_to': return 'skillion';
    case 'pyramidal': return 'pyramid';
    case 'mansard': return 'mansard';
    case 'gambrel': return 'gambrel';
    default: return null;
  }
}

/** Built form from party edges (section 6.2 rule 1). */
export function builtFormFromKinds(poly: PolygonM, kinds: EdgeKind[]): BuiltForm {
  const geom = makePartGeom(poly, kinds.map((k) => ({ kind: k, cut: false })));
  const sides = new Set(geom.edges.filter((e) => e.attr.kind === 'party').map((e) => e.side));
  if (!sides.size) return 'detached';
  const opposite = (sides.has('W') && sides.has('E')) || (sides.has('S') && sides.has('N'));
  return opposite ? 'mid-terrace' : 'semi-detached';
}

/** Inputs of the no-LiDAR fallback: the contract's PriorContext fields + footprint (any planar metric frame). */
export interface PriorsInput extends PriorContext {
  footprint: PolygonM;
  edgeKinds: EdgeKind[];
}

/** Prior-based parts with the resolved storeys / era / built form, labelled as an estimate. */
export interface PriorsResult {
  source: 'prior';
  /** Human-readable label for the UI. */
  label: string;
  parts: ReconstructedPart[];
  storeys: number;
  era: Era;
  eraAssumed: boolean;
  builtForm: BuiltForm;
  family: PriorFamily;
  /** One-sigma uncertainty of the estimate (section 6.2 item 6). */
  uncertainty: { eave: number; ridge: number; pitchDeg: number };
  notes: string[];
}

/** Footprints larger than this (m2) default to a flat roof (blocks, halls). */
export const PRIOR_FLAT_AREA = 1000;

/** Roof of one family on one outline, verified by building it with the geometry engine (null when impossible). */
function roofFor(poly: PolygonM, kinds: EdgeKind[], family: PriorFamily, pitch: number): { model: ModelDef; roof: RoofSpec } | null {
  const geom = makePartGeom(poly, kinds.map((k) => ({ kind: k, cut: false })));
  const lib = partLibrary(geom, { erode: 0.5, butterfly: false, closedForms: false, twoPitch: false, minSkillionEdge: 0, nearRect: 1.1 });
  const pick = (pred: (m: ModelDef) => boolean) => lib.find(pred);
  const partyAxis = geom.edges.find((e) => e.attr.kind === 'party')?.dir;
  const gable = () => pick((m) => m.label === `gable-${partyAxis === 'u' ? 'v' : 'u'}`) ?? pick((m) => m.family === 'gable');
  // hip identical to a dual-pitch gable between party walls (deduplicated by the library): no 'gable' edge kinds
  const hipLike = () => pick((m) => m.family === 'hip') ?? pick((m) => m.family === 'gable' && !m.kinds.includes('gable'));
  let model: ModelDef | undefined, roof: RoofSpec;
  switch (family) {
    case 'flat': model = pick((m) => m.family === 'flat'); roof = { type: 'flat' }; break;
    case 'skillion': model = pick((m) => m.family === 'skillion'); roof = { type: 'skillion', pitchDeg: pitch }; break;
    // on a mid-terrace the hipped roof between party walls is the dual-pitch gable
    case 'hip': model = hipLike(); roof = { type: 'hipped', pitchDeg: pitch }; break;
    case 'pyramid':
      model = hipLike();
      roof = geom.rectangularity >= 0.9 ? { type: 'pyramidal', pitchDeg: pitch } : { type: 'hipped', pitchDeg: pitch };
      break;
    case 'mansard': model = hipLike(); roof = { type: 'mansard', pitchDeg: 70, lowerPitchDeg: 70, upperPitchDeg: 25, breakHeight: 2.4 }; break;
    case 'gambrel': model = gable(); roof = { type: 'gambrel', pitchDeg: 60, lowerPitchDeg: 60, upperPitchDeg: 25, breakHeight: 1.8 }; break;
    case 'half-hip': model = gable(); roof = { type: 'half-hipped', pitchDeg: pitch, hipPitchDeg: pitch, halfHipFraction: 0.6 }; break;
    default: model = gable(); roof = { type: 'gabled', pitchDeg: pitch };
  }
  if (!model) return null;
  if (roof.type === 'flat') return { model, roof };
  try {
    const rm = buildRoof(poly, model.kinds, { ...roof, eaveHeight: 10 });
    const [x0, y0, x1, y1] = bboxOfPoly(poly), m = 1e-3 * Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    const ok = !rm.skeleton.stats.warnings.length && rm.vertices.every(([x, y, z]) => x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m && z >= 10 - m && z <= 10 + Math.hypot(x1 - x0, y1 - y0));
    return ok ? { model, roof } : null;
  } catch {
    return null;
  }
}

/**
 * No-LiDAR fallback (research 05 section 6.2): built form from party walls, storeys from tags / form, era if
 * tagged else modal, family = MAP of P(family | form, era) with OSM roof:shape winning; complex outlines (> 6
 * vertices or rectangularity < 0.85) are hipped (party walls stay vertical), flat only for roof:shape=flat or
 * footprints > PRIOR_FLAT_AREA; eave = plinth + N ff(era) - 0.1 (or heightHint - roof rise), pitch by era, ridge from
 * the skeleton. Every roof is verified with the geometry engine; when the engine cannot build it on the raw outline
 * the outline is simplified (reported in the notes) before falling back to hip / flat. The returned footprint is
 * oriented (outer CCW) with matching kinds.
 */
export function priorsFallback(input: PriorsInput): PriorsResult {
  let { poly, kinds } = normalizeFootprint(input.footprint, input.edgeKinds);
  const notes: string[] = ['estimated - no elevation data'];
  const bungalow = (input.buildingTag ?? '').toLowerCase() === 'bungalow' || input.storeysHint === 1;
  const form: BuiltForm = input.builtForm && input.builtForm !== 'unknown' ? input.builtForm : builtFormFromKinds(poly, kinds);
  const eraAssumed = !input.era || input.era === 'unknown';
  const era: Era = eraAssumed ? modalEra(form, bungalow) : input.era!;
  const ep = ERA_PRIORS[era];
  const geom = makePartGeom(poly, kinds.map((k) => ({ kind: k, cut: false })));
  const aspect = (geom.u1 - geom.u0) / Math.max(geom.v1 - geom.v0, 1e-9);
  const hasParty = kinds.includes('party');
  // family
  let family: PriorFamily | null = familyFromRoofShape(input.roofShapeHint);
  if (family) notes.push(`roof shape from OSM roof:shape=${input.roofShapeHint}`);
  else if (geom.area > PRIOR_FLAT_AREA) {
    family = 'flat';
    notes.push(`flat roof assumed for a very large footprint (${Math.round(geom.area)} m2)`);
  } else {
    const fp = familyPrior(form, era, bungalow);
    family = (Object.keys(fp) as PriorFamily[]).reduce((a, b) => (fp[b] > fp[a] ? b : a));
    const complex = poly.outer.length > 6 || geom.rectangularity < 0.85 || (poly.holes ?? []).length > 0;
    if (complex) { family = 'hip'; notes.push('hipped roof assumed for a complex outline'); }
    else if (!hasParty && aspect < 1.25 && (family === 'gable' || family === 'hip')) family = 'hip';
  }
  // storeys
  let storeys = input.storeysHint && input.storeysHint > 0 ? Math.round(input.storeysHint) : bungalow ? 1 : 2;
  if (!input.storeysHint && era === 'pre-1919' && (form === 'mid-terrace' || form === 'end-terrace')) {
    const depth = Math.max(0, ...geom.edges.filter((e) => e.attr.kind === 'party').map((e) => e.len));
    if (depth >= 11) { storeys = 3; notes.push('3 storeys assumed (deep pre-1919 terrace)'); }
  }
  // roof geometry, verified with the engine (raw outline, then simplified; chosen family, then hip, then flat)
  const pitch = family === 'skillion' ? 15 : ep.pitchDeg;
  let built: { model: ModelDef; roof: RoofSpec } | null = null;
  for (const fam of family === 'hip' || family === 'flat' ? [family] : [family, 'hip' as const]) {
    built = roofFor(poly, kinds, fam, pitch);
    if (!built && fam !== 'flat') {
      const sim = simplifyUntil(poly, kinds, (p, k) => roofFor(p, k, fam, pitch) !== null);
      if (sim) {
        ({ poly, kinds } = sim);
        built = roofFor(poly, kinds, fam, pitch);
        notes.push(`outline simplified (${sim.removed} vertices removed) so the roof skeleton can be built`);
      }
    }
    if (built) {
      if (fam !== family) notes.push(`family ${family} not representable on this footprint; using ${fam}`);
      break;
    }
  }
  if (!built) {
    built = roofFor(poly, kinds, 'flat', 0)!;
    notes.push('roof skeleton degenerate on this outline; flat roof');
  }
  const { model, roof } = built;
  const edgeKinds = model.kinds;
  const ridgeAbove = (eave: number) => {
    if (roof.type === 'flat') return eave;
    try {
      const rm = buildRoof(poly, edgeKinds, { ...roof, eaveHeight: eave });
      return rm.vertices.reduce((m, v) => Math.max(m, v[2]), eave);
    } catch { return eave; }
  };
  let eave = eaveForStoreys(storeys, era);
  if (input.heightHint && input.heightHint > 2) {
    const rise = ridgeAbove(10) - 10;
    eave = Math.max(2.2, input.heightHint - rise);
    if (!input.storeysHint) storeys = storeysFromEave(eave, era);
    notes.push(input.heightHintSource === 'lidar'
      ? `heights from the LiDAR top height ${input.heightHint.toFixed(1)} m (roof shape estimated)`
      : `heights from OSM height=${input.heightHint}`);
  }
  const ridge = ridgeAbove(eave);
  const fam = roof.type === 'flat' ? 'flat' : model.family === 'gable' ? model.label : roof.type === 'hipped' ? 'hip' : family;
  const part: ReconstructedPart = {
    id: 'main', role: 'main', footprint: poly, edgeKinds, roof, eaveHeight: eave, ridgeHeight: ridge,
    family: fam, eaveSE: 0.6, ...(roof.type !== 'flat' ? { pitchSE: 8 } : {}),
  };
  if (eraAssumed) notes.push(`era assumed ${era} (modal for ${form})`);
  return {
    source: 'prior', label: 'estimated - no elevation data', parts: [part], storeys, era, eraAssumed, builtForm: form,
    family: roof.type === 'flat' ? 'flat' : roof.type === 'hipped' && family !== 'pyramid' ? 'hip' : family,
    uncertainty: { eave: 0.6, ridge: 1.2, pitchDeg: 8 }, notes,
  };
}
