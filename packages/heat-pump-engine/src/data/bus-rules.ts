// Values to verify against current Ofgem and price-cap figures before launch.

export const BUS_EFFECTIVE_FROM = '2026-10-01';
export const BUS_SOURCE = 'Boiler Upgrade Scheme, Ofgem (to verify)';
export const BUS_AMOUNT_GBP = 7500;
export const BUS_OWNERSHIP = ['own', 'mortgage', 'landlord'] as const;
export const BUS_ELIGIBLE_FUELS = [
  'gas',
  'oil',
  'lpg',
  'electric_storage',
  'electric_direct',
  'other',
] as const;
