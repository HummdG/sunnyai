import { DEGREE_HOURS, HOT_WATER_KWH_PER_PERSON, INDOOR_TEMP_C } from './data/fabric';
import { designTempC } from './heat-loss';
import type { HeatPumpInput } from './types';

export function annualSpaceHeatKwh(peakKw: number, postcode: string): number {
  return (peakKw * DEGREE_HOURS) / (INDOOR_TEMP_C - designTempC(postcode));
}

export function occupantsOf(input: HeatPumpInput): number {
  if (input.occupants !== null && Number.isFinite(input.occupants) && input.occupants > 0) {
    return Math.min(6, Math.round(input.occupants));
  }
  const beds = input.bedrooms !== null && input.bedrooms > 0 ? input.bedrooms : 3;
  return Math.min(6, beds + 1);
}

export function annualHotWaterKwh(input: HeatPumpInput): number {
  return occupantsOf(input) * HOT_WATER_KWH_PER_PERSON;
}
