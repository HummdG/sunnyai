// Values to verify against current Ofgem and price-cap figures before launch.

export const FUEL_PRICES_EFFECTIVE_FROM = '2026-10-01';
export const CAP_SOURCE = 'Ofgem price cap, Great Britain average (to verify)';

export interface PriceEntry {
  pencePerKwh: number;
  source: string;
  effectiveFrom: string;
}

const entry = (pencePerKwh: number, source = CAP_SOURCE): PriceEntry => ({
  pencePerKwh,
  source,
  effectiveFrom: FUEL_PRICES_EFFECTIVE_FROM,
});

export const ELECTRICITY_PRICE = entry(26.0);

/** Price per kWh of delivered fuel, by what the home burns or uses today. */
export const FUEL_PRICES = {
  gas: entry(6.3),
  oil: entry(6.5, 'heating oil market average (to verify)'),
  lpg: entry(9.5, 'LPG market average (to verify)'),
  electric_storage: entry(15.0, 'Off-peak electricity rate (to verify)'),
  electric_direct: entry(26.0),
  other: entry(7.0, 'Assumed average for other fuels (to verify)'),
};
