export type AgeBand =
  'pre_1919' | '1919_1944' | '1945_1964' | '1965_1982' | '1983_1995' | '1996_2006' | '2007_on';
export type Walls =
  | 'solid_uninsulated'
  | 'solid_insulated'
  | 'cavity_unfilled'
  | 'cavity_filled'
  | 'timber_or_modern'
  | 'unsure';
/** some is about under 200mm, good is about 270mm and over. */
export type Loft = 'none' | 'some' | 'good' | 'unsure';
export type Glazing = 'single' | 'double' | 'triple' | 'unsure';
export type Fuel =
  'gas' | 'oil' | 'lpg' | 'electric_storage' | 'electric_direct' | 'heat_pump' | 'other';
export type Emitters = 'radiators_standard' | 'radiators_large' | 'underfloor' | 'unsure';

export interface HeatPumpInput {
  postcode: string;
  propertyType: string;
  ageBand: AgeBand;
  floorAreaM2: number | null;
  bedrooms: number | null;
  walls: Walls;
  loft: Loft;
  glazing: Glazing;
  currentFuel: Fuel;
  emitters: Emitters;
  hotWater: 'cylinder' | 'combi';
  occupants: number | null;
  ownership: string;
  annualSpendGbp: number | null;
  epcRecommendsInsulation: 'yes' | 'no' | 'unsure' | null;
}

export type Nation = 'england' | 'wales' | 'scotland' | 'northern_ireland' | 'border' | 'unknown';

export interface BusVerdict {
  eligible: boolean | 'unsure';
  amountGbp: number;
  reasons: string[];
}

export interface HeatPumpEstimate {
  floorAreaM2: number;
  floorAreaAssumed: boolean;
  peakHeatLossKw: number;
  annualSpaceHeatKwh: number;
  annualHotWaterKwh: number;
  recommendedKw: number;
  scop: number;
  runningCost: {
    currentGbp: number;
    heatPumpGbp: number;
    fuelPencePerKwh: number;
    elecPencePerKwh: number;
    boilerEfficiency: number;
  };
  bus: BusVerdict;
  nation: Nation;
  warnings: string[];
  assumptions: string[];
}
