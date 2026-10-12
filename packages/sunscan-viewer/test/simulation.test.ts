import { describe, expect, it } from 'vitest';

import { buildSavingsTimeline } from '../../quote-engine/src/savings-timeline';
import {
  aboutGbp,
  assumptionsLine,
  coinScale,
  formatGbp,
  INDICATIVE_NOTE,
  monthLine,
  netLine,
  simulationScript,
  stepTimes,
  summaryRows,
} from '../src/simulation';

const timeline = buildSavingsTimeline({
  annualGenerationKwh: 3659,
  annualDemandKwh: 3500,
  hasBattery: true,
  batteryKwh: 10.24,
  tariffPencePerKwh: 27,
  exportTariffPencePerKwh: 15,
  systemCostPounds: 13810,
});

describe('the savings simulation script', () => {
  it('pops one coin per month, then the year total, then the 25-year total', () => {
    const steps = simulationScript(timeline);
    expect(steps).toHaveLength(14);
    expect(steps.slice(0, 12).every((s) => s.kind === 'month')).toBe(true);
    expect(steps[12]!.kind).toBe('year');
    expect(steps[13]!.kind).toBe('lifetime');
    const months = steps.filter((s) => s.kind === 'month');
    expect(months.at(-1)!.kind === 'month' && months.at(-1)!.cumulativeGbp).toBe(timeline.year1TotalGbp);
  });

  it('says what each month saved, in plain words and whole pounds', () => {
    const march = timeline.months[2]!;
    expect(monthLine(march)).toBe(`March — your panels saved you about ${formatGbp(march.savingsGbp)}`);
    expect(formatGbp(1234.4)).toBe('£1,234');
    expect(formatGbp(-50)).toBe('−£50');
    expect(aboutGbp(24_337)).toBe('£24,300');
    expect(aboutGbp(1_234)).toBe('£1,230');
    expect(aboutGbp(64)).toBe('£64');
  });

  it('closes with the year, the 25 years, the assumptions it used and the survey caveat', () => {
    const life = simulationScript(timeline).at(-1)!;
    expect(life.kind).toBe('lifetime');
    if (life.kind !== 'lifetime') return;
    expect(life.line).toBe(`Over 25 years: about ${aboutGbp(timeline.twentyFiveYearTotalGbp)}`);
    expect(life.assumptions).toBe(assumptionsLine(timeline));
    expect(life.assumptions).toContain('3%');
    expect(life.assumptions).toContain('0.5%');
    expect(life.note).toBe(INDICATIVE_NOTE);
    expect(life.net).toBe(netLine(timeline));
    expect(netLine({ ...timeline, twentyFiveYearNetGbp: null })).toBeNull();
  });

  it('makes summer coins bigger than winter ones', () => {
    expect(coinScale(timeline, 5)).toBeGreaterThan(coinScale(timeline, 11));
    for (let i = 0; i < 12; i++) {
      expect(coinScale(timeline, i)).toBeGreaterThanOrEqual(0.8);
      expect(coinScale(timeline, i)).toBeLessThanOrEqual(1.3);
    }
  });

  it('gives the reduced-motion table every month and its running total', () => {
    const rows = summaryRows(timeline);
    expect(rows).toHaveLength(12);
    expect(rows[0]!.month).toBe('January');
    expect(rows[11]!.total).toBe(formatGbp(timeline.year1TotalGbp));
  });

  it('times a month at a time, then holds the year card before the 25-year card', () => {
    const times = stepTimes(timeline, 1200);
    expect(times[0]).toEqual({ start: 0, end: 1200 });
    expect(times[11]).toEqual({ start: 13200, end: 14400 });
    expect(times[12]!.start).toBe(14400);
    expect(times[13]!.start).toBe(times[12]!.end);
    expect(times[13]!.end).toBe(Infinity);
  });
});
