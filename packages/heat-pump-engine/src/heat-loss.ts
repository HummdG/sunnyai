import { DEFAULT_DESIGN_TEMP_C, DESIGN_TEMP_BY_AREA } from './data/design-temps';
import {
  BASE_W_PER_M2,
  DEFAULT_FLOOR_AREA_M2,
  FLOOR_AREA_BY_BEDROOMS,
  GLAZING_FACTOR,
  INDOOR_TEMP_C,
  LOFT_FACTOR,
  REFERENCE_DESIGN_TEMP_C,
  WALL_FACTOR,
} from './data/fabric';
import { postcodeArea } from './nation';
import type { HeatPumpInput } from './types';

export function designTempC(postcode: string): number {
  const area = postcodeArea(postcode);
  return (area ? DESIGN_TEMP_BY_AREA[area] : undefined) ?? DEFAULT_DESIGN_TEMP_C;
}

export function resolveFloorArea(input: HeatPumpInput): { m2: number; assumed: boolean } {
  const a = input.floorAreaM2;
  if (a !== null && Number.isFinite(a) && a >= 20 && a <= 1000) return { m2: a, assumed: false };
  const b = input.bedrooms;
  if (b === null || !Number.isFinite(b) || b < 1) {
    return { m2: DEFAULT_FLOOR_AREA_M2, assumed: true };
  }
  const key = Math.min(5, Math.round(b));
  return { m2: FLOOR_AREA_BY_BEDROOMS[key] ?? DEFAULT_FLOOR_AREA_M2, assumed: true };
}

/** Peak heat loss in kW, rounded to 0.1. */
export function peakHeatLossKw(input: HeatPumpInput, floorAreaM2: number): number {
  const dt = designTempC(input.postcode);
  const watts =
    floorAreaM2 *
    BASE_W_PER_M2[input.ageBand] *
    WALL_FACTOR[input.walls] *
    LOFT_FACTOR[input.loft] *
    GLAZING_FACTOR[input.glazing] *
    ((INDOOR_TEMP_C - dt) / (INDOOR_TEMP_C - REFERENCE_DESIGN_TEMP_C));
  return Math.round(watts / 100) / 10;
}
