// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\__tests__\buildBudgetLadder.test.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { describe, it, expect } from 'vitest';
import {
  buildBudgetLadder,
  activeStep,
  batteryAffinity,
} from '../../src/recommend/buildBudgetLadder.js';
import type { BudgetStep } from '../../src/recommend/ladderTypes.js';
import { makeInput } from './catalogueFixture.js';
import type { GoogleSolarBuildingInsights } from '../../src/types.js';

const firstBatteryGbp = (steps: BudgetStep[]): number =>
  steps.find((s) => s.hasBattery)?.thresholdGbp ?? Infinity;

// A pure-ROI / wants-to-export homeowner — zero battery affinity.
const LOW = { tariffType: 'standard', lifestyle: [], motivation: 'earn_export', existing: 'none' };
// Smart-tariff EV owner who wants energy independence — high battery affinity.
const HIGH = {
  tariffType: 'smart_tou',
  lifestyle: ['ev_now', 'evening_use'],
  motivation: 'independence',
  existing: 'solar',
};

describe('buildBudgetLadder', () => {
  it('returns a price-ascending frontier with unique steps and consistent bounds', () => {
    const l = buildBudgetLadder(makeInput());
    expect(l.steps.length).toBeGreaterThanOrEqual(1);
    const prices = l.steps.map((s) => s.priceGbp);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(new Set(prices).size).toBe(prices.length); // strictly ascending ⇒ unique
    expect(new Set(l.steps.map((s) => s.id)).size).toBe(l.steps.length);
    for (const s of l.steps) expect(s.thresholdGbp).toBe(s.priceGbp);
    expect(l.minGbp).toBe(l.steps[0]!.priceGbp);
    expect(l.maxGbp).toBe(l.steps[l.steps.length - 1]!.priceGbp);
    expect(l.initialGbp).toBeGreaterThanOrEqual(l.minGbp);
    expect(l.initialGbp).toBeLessThanOrEqual(l.maxGbp);
  });

  it('produces a handful of meaningful steps on a normal roof', () => {
    const l = buildBudgetLadder(makeInput({ roofMaxPanels: 20, maxPanels: 20 }));
    expect(l.steps.length).toBeGreaterThanOrEqual(5);
    expect(l.steps.length).toBeLessThanOrEqual(12);
  });

  it('carries full modelled results so the client never recomputes', () => {
    const l = buildBudgetLadder(makeInput());
    for (const s of l.steps) {
      expect(s.priceGbp).toBeGreaterThan(0);
      expect(s.systemKwp).toBeGreaterThan(0);
      expect(s.results.twentyFiveYearSavings.length).toBeGreaterThan(0);
      // Hero metric = lifetime cumulative savings — must be a finite number.
      const hero = s.results.twentyFiveYearSavings.at(-1)!.cumulative;
      expect(Number.isFinite(hero)).toBe(true);
    }
    // The most capable step is the most valuable over 25 years.
    const top = l.steps[l.steps.length - 1]!;
    expect(top.results.twentyFiveYearSavings.at(-1)!.cumulative).toBeGreaterThan(0);
  });

  it('introduces a battery EARLIER for a high-affinity homeowner (context-aware)', () => {
    const low = buildBudgetLadder(makeInput(LOW));
    const high = buildBudgetLadder(makeInput(HIGH));
    // The high-affinity persona reaches a battery at a lower budget than the
    // pure-ROI one — the core "suggest a battery next" requirement.
    expect(firstBatteryGbp(high.steps)).toBeLessThan(firstBatteryGbp(low.steps));
    expect(high.steps.some((s) => s.hasBattery)).toBe(true);
  });

  it('scores battery affinity from the journey answers', () => {
    expect(batteryAffinity(makeInput(LOW))).toBe(0);
    expect(batteryAffinity(makeInput(HIGH))).toBeGreaterThan(batteryAffinity(makeInput(LOW)));
    // Already owning storage suppresses the affinity.
    const owns = makeInput({ ...HIGH, existing: 'solar_battery' });
    expect(batteryAffinity(owns)).toBeLessThan(batteryAffinity(makeInput(HIGH)));
  });

  it('degrades to a pure panel progression when the catalogue has no batteries', () => {
    const input = makeInput(HIGH);
    input.catalogue.batteries = [];
    const l = buildBudgetLadder(input);
    expect(l.steps.length).toBeGreaterThanOrEqual(1);
    expect(l.steps.every((s) => !s.hasBattery)).toBe(true);
  });

  it('clamps the initial position to the cheapest step when the budget is below it', () => {
    const l = buildBudgetLadder(makeInput({ budgetMaxGbp: 1000 }));
    expect(l.initialGbp).toBe(l.minGbp);
    expect(activeStep(l.steps, 1000)?.id).toBe(l.steps[0]!.id);
  });

  it('respects a roof-limited maximum (battery becomes the only upgrade)', () => {
    const l = buildBudgetLadder(makeInput({ roofMaxPanels: 6, maxPanels: 6, ...HIGH }));
    expect(l.steps.length).toBeGreaterThanOrEqual(1);
    expect(l.steps.every((s) => s.panelCount <= 6)).toBe(true);
    // With panels maxed, the morph can still add storage.
    expect(l.steps.some((s) => s.hasBattery)).toBe(true);
  });

  it('builds from Google Solar modelled generation when present', () => {
    const insights = {
      solarPotential: {
        panelCapacityWatts: 430,
        solarPanelConfigs: Array.from({ length: 25 }, (_, i) => ({
          panelsCount: i + 1,
          yearlyEnergyDcKwh: (i + 1) * 420,
        })),
      },
    } as unknown as GoogleSolarBuildingInsights;
    const l = buildBudgetLadder(makeInput({ solarInsights: insights }));
    expect(l.steps.length).toBeGreaterThanOrEqual(1);
    expect(l.steps.every((s) => s.results.annualGenerationKwh > 0)).toBe(true);
  });

  it('maps all three tiers to real frontier steps (essential is battery-free)', () => {
    const l = buildBudgetLadder(makeInput());
    expect(l.tierStops).toHaveLength(3);
    const byId = new Map(l.steps.map((s) => [s.id, s]));
    for (const stop of l.tierStops) expect(byId.has(stop.stepId)).toBe(true);
    const essential = l.tierStops.find((t) => t.tier === 'essential')!;
    expect(byId.get(essential.stepId)!.hasBattery).toBe(false);
  });
});

describe('activeStep', () => {
  const steps = buildBudgetLadder(makeInput()).steps;

  it('returns the cheapest step below the entry budget', () => {
    expect(activeStep(steps, 0)?.id).toBe(steps[0]!.id);
    expect(activeStep(steps, steps[0]!.priceGbp - 1)?.id).toBe(steps[0]!.id);
  });

  it('returns the exact step at a threshold boundary', () => {
    const mid = steps[Math.floor(steps.length / 2)]!;
    expect(activeStep(steps, mid.thresholdGbp)?.id).toBe(mid.id);
  });

  it('returns the most capable step above the maximum', () => {
    const last = steps[steps.length - 1]!;
    expect(activeStep(steps, last.priceGbp + 100_000)?.id).toBe(last.id);
  });

  it('returns undefined for an empty ladder', () => {
    expect(activeStep([], 5000)).toBeUndefined();
  });
});
