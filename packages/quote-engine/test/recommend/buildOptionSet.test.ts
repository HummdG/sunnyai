// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\__tests__\buildOptionSet.test.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { describe, it, expect } from 'vitest';
import { buildOptionSet } from '../../src/recommend/buildOptionSet.js';
import { makeInput } from './catalogueFixture.js';

const sig = (o: { tier: string; panelCount: number }) => `${o.tier}:${o.panelCount}`;

describe('buildOptionSet', () => {
  it('always returns exactly 3 distinct options ordered by price ascending', () => {
    const set = buildOptionSet(makeInput());
    expect(set.options).toHaveLength(3);
    expect(new Set(set.options.map(sig)).size).toBe(3);
    const prices = set.options.map((o) => o.priceGbp);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(set.options.map((o) => o.kind)).toEqual(['budget_fit', 'better_value', 'recommended']);
  });

  it('exactly one option is recommended, and it is the highest-scoring of the three', () => {
    const set = buildOptionSet(makeInput());
    const flagged = set.options.filter((o) => o.isRecommended);
    expect(flagged).toHaveLength(1);
    const best = set.options.reduce((b, o) => (o.score > b.score ? o : b));
    expect(flagged[0]!.kind).toBe(best.kind);
    expect(set.recommendedId).toBe(flagged[0]!.kind);
  });

  it('budget-fit respects the stated budget when something fits', () => {
    const set = buildOptionSet(makeInput({ budgetMaxGbp: 9000 }));
    const bf = set.options.find((o) => o.kind === 'budget_fit')!;
    expect(bf.priceGbp).toBeLessThanOrEqual(9000);
    expect(bf.aboveBudget).toBe(false);
  });

  it('flags aboveBudget when even the cheapest system exceeds the budget', () => {
    const set = buildOptionSet(makeInput({ budgetMaxGbp: 1000 }));
    expect(set.options).toHaveLength(3);
    const bf = set.options.find((o) => o.kind === 'budget_fit')!;
    expect(bf.aboveBudget).toBe(true);
    // still the cheapest of the three
    expect(bf.priceGbp).toBe(Math.min(...set.options.map((o) => o.priceGbp)));
  });

  it('still produces 3 distinct options on a tiny roof (tiers differentiate)', () => {
    const set = buildOptionSet(makeInput({ roofMaxPanels: 6, maxPanels: 6 }));
    expect(set.options).toHaveLength(3);
    expect(new Set(set.options.map(sig)).size).toBe(3);
    // all capped at the roof
    expect(set.options.every((o) => o.panelCount <= 6)).toBe(true);
  });

  it('carries modelled results and pricing through to every option', () => {
    const set = buildOptionSet(makeInput());
    for (const o of set.options) {
      expect(o.priceGbp).toBeGreaterThan(0);
      expect(o.systemKwp).toBeGreaterThan(0);
      expect(o.results.twentyFiveYearSavings.length).toBeGreaterThan(0);
      expect(Number.isFinite(o.results.paybackYears)).toBe(true);
    }
  });

  it('differentiates hardware across tiers when the catalogue supports it', () => {
    const set = buildOptionSet(makeInput());
    // Distinct panel, inverter and a distinct battery story per option.
    expect(new Set(set.options.map((o) => o.config.panelSku)).size).toBe(3);
    expect(new Set(set.options.map((o) => o.inverterType)).size).toBe(3);
    // Exactly one option (essential) has no battery; the others differ in capacity.
    const batteries = set.options.map((o) => o.batteryType);
    expect(batteries.filter((b) => b === null)).toHaveLength(1);
    // Each option has a distinct headline benefit framing.
    expect(new Set(set.options.map((o) => o.headline)).size).toBe(3);
  });

  it('spreads the three options apart on a normal roof (minimum size gap)', () => {
    const set = buildOptionSet(makeInput({ roofMaxPanels: 20, maxPanels: 20 }));
    const counts = set.options.map((o) => o.panelCount).sort((a, b) => a - b);
    expect(new Set(counts).size).toBe(3);
    expect(counts[1]! - counts[0]!).toBeGreaterThanOrEqual(2);
    expect(counts[2]! - counts[1]!).toBeGreaterThanOrEqual(2);
  });

  it('attaches a budget ladder with tier stops for the slider', () => {
    const set = buildOptionSet(makeInput());
    expect(set.ladder).toBeDefined();
    expect(set.ladder!.steps.length).toBeGreaterThanOrEqual(1);
    expect(set.ladder!.tierStops).toHaveLength(3);
    expect(set.ladder!.minGbp).toBeLessThanOrEqual(set.ladder!.maxGbp);
  });
});
