// Values to verify against current tariffs and HMRC guidance before launch.
// Every figure carries its source and the date it was last set.

export interface DatedValue<T> {
  value: T;
  source: string;
  effectiveFrom: string;
}

/** Annual solar yield per installed kWp. */
export const ANNUAL_YIELD_KWH_PER_KWP: DatedValue<number> = {
  value: 950,
  source: 'UK average solar yield, simplified (to verify)',
  effectiveFrom: '2026-10-01',
};

/** VAT on a battery retrofitted to an existing solar system. */
export const RETROFIT_VAT: DatedValue<number> = {
  value: 0,
  source:
    'UK zero rate for energy-saving materials including retrofitted batteries, to 31 March 2027 (to verify)',
  effectiveFrom: '2026-10-01',
};

export interface TimeOfUseRates {
  offPeakPence: number;
  peakPence: number;
}

/** Representative time-of-use pairs, pence per kWh. */
export const TIME_OF_USE_RATES: Record<'economy7' | 'smart_tou', DatedValue<TimeOfUseRates>> = {
  economy7: {
    value: { offPeakPence: 15, peakPence: 30 },
    source: 'Typical Economy 7 night and day unit rates (to verify)',
    effectiveFrom: '2026-10-01',
  },
  smart_tou: {
    value: { offPeakPence: 8, peakPence: 28 },
    source: 'Typical smart time-of-use overnight and peak unit rates (to verify)',
    effectiveFrom: '2026-10-01',
  },
};
