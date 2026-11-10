import { busVerdict } from './bus';
import { annualHotWaterKwh, annualSpaceHeatKwh } from './demand';
import { peakHeatLossKw, resolveFloorArea } from './heat-loss';
import { nationOf } from './nation';
import { runningCost } from './running-cost';
import { SIZE_CAP_WARNING, pickSize, scopOf } from './sizing';
import type { HeatPumpEstimate, HeatPumpInput } from './types';

export function estimate(input: HeatPumpInput): HeatPumpEstimate {
  const warnings: string[] = [];
  const assumptions: string[] = [];

  const area = resolveFloorArea(input);
  if (area.assumed) {
    assumptions.push(`Floor area assumed at ${area.m2} square metres from the number of bedrooms.`);
  }
  const peak = peakHeatLossKw(input, area.m2);
  const space = Math.round(annualSpaceHeatKwh(peak, input.postcode));
  const hotWater = annualHotWaterKwh(input);
  const size = pickSize(peak);
  if (size.capped) warnings.push(SIZE_CAP_WARNING);
  const scop = scopOf(input.emitters, input.ageBand);
  const cost = runningCost(input.currentFuel, space, hotWater, scop);

  if (
    input.annualSpendGbp !== null &&
    input.currentFuel !== 'electric_direct' &&
    input.currentFuel !== 'electric_storage'
  ) {
    assumptions.push(
      `Current spend of about £${Math.round(input.annualSpendGbp)} a year was noted. The figures here are modelled from the home itself.`,
    );
  }

  return {
    floorAreaM2: area.m2,
    floorAreaAssumed: area.assumed,
    peakHeatLossKw: peak,
    annualSpaceHeatKwh: space,
    annualHotWaterKwh: hotWater,
    recommendedKw: size.kw,
    scop,
    runningCost: cost,
    bus: busVerdict(input),
    nation: nationOf(input.postcode),
    warnings,
    assumptions,
  };
}
