import { OLD_AGE_BANDS, SCOP_BY_EMITTER, SCOP_OLD_HOME_PENALTY } from './data/scop';
import type { AgeBand, Emitters } from './types';

export const STANDARD_SIZES_KW: readonly number[] = [5, 6, 7, 8.5, 10, 12, 14, 16];
export const SIZE_CAP_WARNING =
  'This home may need a larger or second heat pump. Your installer will advise.';

export function pickSize(peakKw: number): { kw: number; capped: boolean } {
  const fit = STANDARD_SIZES_KW.find((s) => s >= peakKw);
  if (fit !== undefined) return { kw: fit, capped: false };
  return { kw: STANDARD_SIZES_KW[STANDARD_SIZES_KW.length - 1]!, capped: true };
}

export function scopOf(emitters: Emitters, ageBand: AgeBand): number {
  const base = SCOP_BY_EMITTER[emitters];
  const adj = OLD_AGE_BANDS.includes(ageBand) ? SCOP_OLD_HOME_PENALTY : 0;
  return Math.round((base - adj) * 10) / 10;
}
