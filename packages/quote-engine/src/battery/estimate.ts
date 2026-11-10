import { resolveAnnualKwh, type QuoteUsage } from '../input.js';
import { calcSelfConsumption } from '../solarCalculations.js';
import { getTariffForPostcode } from '../tariff.js';
import { ANNUAL_YIELD_KWH_PER_KWP, RETROFIT_VAT, TIME_OF_USE_RATES } from './data.js';

export type BatteryTariff =
  'standard' | 'economy7' | 'smart_tou' | 'import_export' | 'already_exports' | 'unknown';
export type BatteryGoal = 'savings' | 'backup' | 'cheap_rate' | 'unsure';

export interface BatteryInput {
  postcode: string;
  pvKwp: number | null;
  panelCount: number | null;
  usage: QuoteUsage;
  tariff: BatteryTariff;
  lifestyle: string[];
  goal: BatteryGoal;
}

export interface BatterySizing {
  capacityKwh: number;
  extraSelfUseKwh: number;
  shiftKwh: number;
  selfUseSavingGbp: number;
  shiftSavingGbp: number;
  annualSavingGbp: number;
}

export interface BatteryEstimate {
  pvKwp: number;
  pvKwpAssumed: boolean;
  annualGenerationKwh: number;
  annualUseKwh: number;
  importPence: number;
  exportPence: number;
  offPeakPence: number | null;
  peakPence: number | null;
  recommendedKwh: number;
  sizing(capacityKwh: number): BatterySizing;
  warnings: string[];
  assumptions: string[];
}

export const BATTERY_DISCLAIMER =
  'This is an estimate from typical figures, not a quote. Your installer will confirm sizing and savings after a survey.';
export const BATTERY_RETROFIT_VAT_PERCENT: number = RETROFIT_VAT.value;

const PANEL_KWP = 0.43;
const EVENING_SHARE = 0.6;
const ASSUMED_KWP = 4.0;
const LOAD_GROWTH_TAGS = ['ev_now', 'ev_planned', 'heatpump_now', 'heatpump_planned'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function batteryEstimate(input: BatteryInput): BatteryEstimate {
  const assumptions: string[] = [];
  const warnings: string[] = [];

  let pvKwp: number;
  let pvKwpAssumed = false;
  if (input.pvKwp !== null && input.pvKwp >= 0.5 && input.pvKwp <= 25) {
    pvKwp = input.pvKwp;
  } else if (input.panelCount !== null && input.panelCount >= 2 && input.panelCount <= 60) {
    pvKwp = input.panelCount * PANEL_KWP;
  } else {
    pvKwp = ASSUMED_KWP;
    pvKwpAssumed = true;
    assumptions.push('Assumed a typical 4 kWp solar system.');
  }

  const gen = Math.round(pvKwp * ANNUAL_YIELD_KWH_PER_KWP.value);
  const tariff = getTariffForPostcode(input.postcode);
  const importPence = tariff.importPencePerKwh;
  const exportPence = tariff.segExportPencePerKwh;
  const use = Math.round(clamp(resolveAnnualKwh(input.usage, importPence), 500, 30000));

  const tou =
    input.tariff === 'economy7' || input.tariff === 'smart_tou'
      ? TIME_OF_USE_RATES[input.tariff].value
      : null;
  const offPeakPence = tou ? tou.offPeakPence : null;
  const peakPence = tou ? tou.peakPence : null;

  if (input.goal === 'backup') {
    warnings.push(
      'Backup power needs a compatible inverter and a changeover switch. Your installer will confirm.',
    );
  }
  if (input.tariff === 'standard' || input.tariff === 'unknown') {
    assumptions.push('On a single-rate tariff the battery saves by storing your own solar.');
  }

  const direct = calcSelfConsumption(gen, use, false).selfConsumptionKwh;

  const surplusPerDay = Math.max(0, (gen - direct) / 365);
  const eveningPerDay = (use * EVENING_SHARE) / 365;
  const base =
    tou || input.goal === 'cheap_rate' ? eveningPerDay : Math.min(surplusPerDay, eveningPerDay);
  const bump = input.lifestyle.some((l) => LOAD_GROWTH_TAGS.includes(l)) ? 1.2 : 1;
  const recommendedKwh = clamp(Math.round(safe(base * bump) * 2) / 2, 2.5, 20);

  function sizing(capacityKwh: number): BatterySizing {
    const cap = safe(capacityKwh);
    const extra = Math.max(0, calcSelfConsumption(gen, use, true, cap).selfConsumptionKwh - direct);
    const selfUseGbp = (extra * (importPence - exportPence)) / 100;
    let shiftKwh = 0;
    let shiftGbp = 0;
    if (tou) {
      const spare = Math.max(0, cap * 365 * 0.9 - extra);
      shiftKwh = Math.min(spare, use * EVENING_SHARE);
      shiftGbp = (shiftKwh * (tou.peakPence - tou.offPeakPence)) / 100;
    }
    const selfUseSavingGbp = Math.round(safe(selfUseGbp));
    const shiftSavingGbp = Math.round(safe(shiftGbp));
    return {
      capacityKwh: cap,
      extraSelfUseKwh: Math.round(safe(extra)),
      shiftKwh: Math.round(safe(shiftKwh)),
      selfUseSavingGbp,
      shiftSavingGbp,
      annualSavingGbp: selfUseSavingGbp + shiftSavingGbp,
    };
  }

  return {
    pvKwp,
    pvKwpAssumed,
    annualGenerationKwh: gen,
    annualUseKwh: use,
    importPence,
    exportPence,
    offPeakPence,
    peakPence,
    recommendedKwh,
    sizing,
    warnings,
    assumptions,
  };
}
