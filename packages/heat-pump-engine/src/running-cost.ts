import { ELECTRICITY_PRICE, FUEL_PRICES } from './data/fuel-prices';
import { BOILER_EFFICIENCY } from './data/scop';
import type { Fuel, HeatPumpEstimate } from './types';

export function boilerEfficiency(fuel: Fuel, scop: number): number {
  switch (fuel) {
    case 'gas':
      return BOILER_EFFICIENCY.gas;
    case 'oil':
      return BOILER_EFFICIENCY.oil;
    case 'lpg':
      return BOILER_EFFICIENCY.lpg;
    case 'heat_pump':
      return scop;
    case 'electric_storage':
    case 'electric_direct':
      return BOILER_EFFICIENCY.electric;
    default:
      // 'other' fuels are burned, so a boiler efficiency applies.
      return BOILER_EFFICIENCY.gas;
  }
}

export function fuelPence(fuel: Fuel): number {
  if (fuel === 'heat_pump') return ELECTRICITY_PRICE.pencePerKwh;
  return FUEL_PRICES[fuel].pencePerKwh;
}

export function runningCost(
  fuel: Fuel,
  spaceKwh: number,
  hotWaterKwh: number,
  scop: number,
): HeatPumpEstimate['runningCost'] {
  const demand = spaceKwh + hotWaterKwh;
  const eff = boilerEfficiency(fuel, scop);
  const fuelP = fuelPence(fuel);
  const elecP = ELECTRICITY_PRICE.pencePerKwh;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    currentGbp: round(((demand / eff) * fuelP) / 100),
    heatPumpGbp: round(((demand / scop) * elecP) / 100),
    fuelPencePerKwh: fuelP,
    elecPencePerKwh: elecP,
    boilerEfficiency: eff,
  };
}
