// Values to verify against current Ofgem and price-cap figures before launch.
import type { AgeBand, Emitters } from '../types.js';

export const SCOP_EFFECTIVE_FROM = '2026-10-01';
export const SCOP_SOURCE = 'Typical seasonal performance by emitter type, simplified (to verify)';

export const SCOP_BY_EMITTER: Record<Emitters, number> = {
  underfloor: 3.6,
  radiators_large: 3.3,
  radiators_standard: 3.0,
  unsure: 3.0,
};

/** Older homes need hotter flow temperatures, so performance drops. */
export const SCOP_OLD_HOME_PENALTY = 0.2;
export const OLD_AGE_BANDS: readonly AgeBand[] = ['pre_1919', '1919_1944'];

export const BOILER_EFFICIENCY = { gas: 0.85, oil: 0.85, lpg: 0.85, electric: 1.0 };
