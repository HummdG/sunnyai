// Storey levels and UK era constants (research 05 §5.2, §7.3).
//   FFL_k = base + plinth + k * ff,  ceiling_k = FFL_k + ff - slab,  eave ≈ plinth + N * ff - 0.1
// ff (floor-to-floor) is fitted to the part's eave height within an era-dependent band, so the top storey's
// ceiling sits just under the wall plate; storeys that cannot fit under the eave become rooms in the roof.
import type { BuildingPartSpec, Era } from '../types.js';

/** External wall thickness used to inset slabs / rooms from the footprint (m). */
export const WALL_THICKNESS = 0.3;
/** Structural floor slab thickness (m); the ceiling of a storey is the underside of the next slab. */
export const SLAB_THICKNESS = 0.2;

/** Ground-floor finished level above external ground (suspended floors + steps in older stock). */
export const ERA_PLINTH: Record<Era, number> = {
  'pre-1919': 0.45, '1919-1944': 0.3, '1945-1964': 0.2, '1965-1980': 0.15, '1981-2000': 0.15, 'post-2000': 0.15, unknown: 0.2,
};

/** Typical floor-to-floor height by era (table 5.2). */
export const ERA_FLOOR_TO_FLOOR: Record<Era, number> = {
  'pre-1919': 3.0, '1919-1944': 2.8, '1945-1964': 2.7, '1965-1980': 2.65, '1981-2000': 2.65, 'post-2000': 2.65, unknown: 2.7,
};

/** One storey: finished floor level and ceiling (underside of the next slab), metres above the ground datum. */
export interface StoreyLevel {
  storey: number;
  floorZ: number;
  ceilingZ: number;
  /** True when the storey's ceiling is above the eave (room in the roof / attic storey). */
  inRoof: boolean;
}

/** Overrides for storeyLevels (used to align attached parts with the main block). */
export interface StoreyLevelOptions {
  /** Force the plinth (m above the part base), e.g. to align an outrigger with the main house. */
  plinth?: number;
  /** Force the floor-to-floor height (m) instead of fitting it to the eave. */
  floorToFloor?: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const safeEra = (era: Era): Era => (era in ERA_PLINTH ? era : 'unknown');

/** Storey count that best explains a wall height for an era (research 05 §7.3 argmin rule). */
export function inferStoreys(wallHeight: number, era: Era): number {
  const e = safeEra(era);
  let best = 1, bestErr = Infinity;
  for (let n = 1; n <= 6; n++) {
    const err = Math.abs(wallHeight - (ERA_PLINTH[e] + n * ERA_FLOOR_TO_FLOOR[e] - 0.1));
    if (err < bestErr) { bestErr = err; best = n; }
  }
  return best;
}

/** Plinth and floor-to-floor height used for a part (see storeyLevels). */
export function levelParams(part: Pick<BuildingPartSpec, 'baseHeight' | 'eaveHeight' | 'storeys'>, era: Era, opts: StoreyLevelOptions = {}) {
  const e = safeEra(era);
  const base = Number.isFinite(part.baseHeight) ? part.baseHeight : 0;
  const wall = Math.max(0.5, (Number.isFinite(part.eaveHeight) ? part.eaveHeight : base + 2.6) - base);
  const n = Number.isFinite(part.storeys) && part.storeys >= 1 ? Math.round(part.storeys) : inferStoreys(wall, e);
  const plinth = opts.plinth ?? Math.min(ERA_PLINTH[e], wall * 0.1);
  const ffEra = ERA_FLOOR_TO_FLOOR[e];
  let ff = opts.floorToFloor ?? (wall + 0.1 - plinth) / n;
  if (opts.floorToFloor === undefined) ff = clamp(ff, Math.max(2.4, ffEra - 0.4), Math.min(4.0, ffEra + 0.9));
  return { base, wall, storeys: n, plinth, floorToFloor: ff };
}

/**
 * Storey levels of a part above the ground datum: storey k has floor = base + plinth + k * ff and
 * ceiling = floor + ff - SLAB_THICKNESS. ff is fitted to the eave within the era band (or forced via opts).
 */
export function storeyLevels(part: Pick<BuildingPartSpec, 'baseHeight' | 'eaveHeight' | 'storeys'>, era: Era, opts: StoreyLevelOptions = {}): StoreyLevel[] {
  const p = levelParams(part, era, opts);
  const eave = p.base + p.wall;
  const out: StoreyLevel[] = [];
  for (let k = 0; k < p.storeys; k++) {
    const floorZ = p.base + p.plinth + k * p.floorToFloor;
    const ceilingZ = floorZ + p.floorToFloor - SLAB_THICKNESS;
    out.push({ storey: k, floorZ, ceilingZ, inRoof: ceilingZ > eave + 0.05 });
  }
  return out;
}
