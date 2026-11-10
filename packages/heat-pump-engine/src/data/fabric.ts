// Values to verify against current Ofgem and price-cap figures before launch.
import type { AgeBand, Glazing, Loft, Walls } from '../types';

export const FABRIC_EFFECTIVE_FROM = '2026-10-01';
export const FABRIC_SOURCE = 'Simplified UK dwelling heat loss rules of thumb (to verify)';

/** Heat loss in W per m2 of floor at the reference design temperature. */
export const BASE_W_PER_M2: Record<AgeBand, number> = {
  pre_1919: 110,
  '1919_1944': 100,
  '1945_1964': 90,
  '1965_1982': 80,
  '1983_1995': 65,
  '1996_2006': 55,
  '2007_on': 45,
};

/** The design temperature the table above is quoted at. */
export const REFERENCE_DESIGN_TEMP_C = -2;
export const INDOOR_TEMP_C = 21;

export const WALL_FACTOR: Record<Walls, number> = {
  solid_uninsulated: 1.15,
  solid_insulated: 0.9,
  cavity_unfilled: 1.1,
  cavity_filled: 0.9,
  timber_or_modern: 0.85,
  unsure: 1.0,
};

export const LOFT_FACTOR: Record<Loft, number> = { none: 1.1, some: 1.0, good: 0.92, unsure: 1.0 };

export const GLAZING_FACTOR: Record<Glazing, number> = {
  single: 1.1,
  double: 1.0,
  triple: 0.95,
  unsure: 1.0,
};

/** Degree hours of heating per year used to turn peak load into annual demand. */
export const DEGREE_HOURS = 55000;
export const HOT_WATER_KWH_PER_PERSON = 800;

export const FLOOR_AREA_BY_BEDROOMS: Record<number, number> = {
  1: 50,
  2: 70,
  3: 90,
  4: 120,
  5: 150,
};
export const DEFAULT_FLOOR_AREA_M2 = 90;
