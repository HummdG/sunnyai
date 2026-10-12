// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\buildOptionSet.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { buildInclusions, buildTierPresets } from '../pricing/tiers.js';
import type { PricingContext, SystemConfig } from '../pricing/types.js';
import { computeSentinel } from './sentinel.js';
import { buildBudgetLadder } from './buildBudgetLadder.js';
import { evaluateConfig, type CandidateEval } from './evaluateConfig.js';
import type {
  OptionKind,
  OptionResult,
  OptionSet,
  OptionSetInput,
  PresetTier,
} from './optionTypes.js';

const PV_MAX_PANELS = 50; // computeQuote requires a pvBasePrice row in [1, 50]
// Tiers in ascending size/capability order — also the order options are shown.
const TIER_ORDER: PresetTier[] = ['essential', 'standard', 'premium'];
// Each shown option must differ from its neighbour by at least this many panels
// (where the roof allows) so the three never collapse into near-identical sizes.
const MIN_PANEL_GAP = 2;
// How far around a tier's demand anchor the scorer may search for a count.
const COUNT_BAND = 0.25;

interface Candidate extends CandidateEval {
  tier: PresetTier;
}

function makeCandidate(
  base: SystemConfig,
  tier: PresetTier,
  count: number,
  input: OptionSetInput,
  ctx: PricingContext,
): Candidate {
  const config: SystemConfig = { ...base, panelCount: count };
  return { tier, ...evaluateConfig(config, input, ctx) };
}

const LABELS: Record<OptionKind, string> = {
  budget_fit: 'Budget-fit',
  better_value: 'Better value',
  recommended: 'Recommended',
};
// Each option maps 1:1 to a tier, so the benefit framing is keyed by tier (the
// actual hardware), not by price position — genuinely differentiated pitches.
const HEADLINE: Record<PresetTier, string> = {
  essential: 'Lowest upfront cost',
  standard: 'Best all-round value',
  premium: 'Maximum self-sufficiency',
};
const BEST_SUITED: Record<PresetTier, string> = {
  essential: 'A practical entry system focused on the lowest upfront cost and a quick payback.',
  standard: 'The best all-round balance of generation, storage and long-term return.',
  premium: 'Maximum generation, storage and self-sufficiency for the strongest lifetime savings.',
};
const NEXT_STEP: Record<OptionKind, string> = {
  budget_fit: 'Book a free survey to confirm this is right for your home.',
  better_value: 'Book a free survey to lock in the detail.',
  recommended: 'Book a free survey — recommended for the strongest return.',
};
const KINDS_BY_PRICE: OptionKind[] = ['budget_fit', 'better_value', 'recommended'];

function toOption(
  c: Candidate,
  kind: OptionKind,
  isRecommended: boolean,
  input: OptionSetInput,
): OptionResult {
  const panel = input.catalogue.panels.find((p) => p.sku === c.config.panelSku);
  const inv =
    (c.config.inverterSku
      ? input.catalogue.inverters.find((i) => i.sku === c.config.inverterSku)
      : undefined) ??
    input.catalogue.inverters.find((i) => i.isDefault) ??
    input.catalogue.inverters[0];
  const battery = c.config.battery
    ? input.catalogue.batteries.find((b) => b.sku === c.config.battery!.sku)
    : null;
  const sentinel = computeSentinel({
    annualSavingGbp: c.results.annualSavingsPounds,
    annualExportGbp: (c.results.exportKwh * input.exportTariffPence) / 100,
    paybackYearsBase: c.results.paybackYears,
    priceGbp: c.priceGbp,
    hasBattery: c.hasBattery,
    tariffType: input.tariffType,
    lifestyle: input.lifestyle,
    config: input.sentinelConfig,
  });
  return {
    id: kind,
    kind,
    label: LABELS[kind],
    isRecommended,
    tier: c.tier,
    config: c.config,
    panelCount: c.panelCount,
    panelType: panel?.modelName ?? c.config.panelSku,
    inverterType: inv?.modelName ?? 'Standard hybrid inverter',
    batteryType: battery?.modelName ?? null,
    batteryCapacityKwh: c.batteryKwh,
    systemKwp: c.systemKwp,
    priceGbp: c.priceGbp,
    results: c.results,
    sentinel,
    inclusions: buildInclusions(c.config, input.catalogue),
    headline: HEADLINE[c.tier],
    bestSuitedTo: BEST_SUITED[c.tier],
    nextStep: NEXT_STEP[kind],
    score: c.score,
    warnings: c.warnings,
    aboveBudget: kind === 'budget_fit' && c.priceGbp > input.budgetMaxGbp,
    roofLimited: c.panelCount >= input.roofMaxPanels,
  };
}

/**
 * Build the three presented options from a fully-resolved input.
 *
 * Each option maps 1:1 to a tier (essential / standard / premium) so its
 * hardware — panel, inverter, battery, backup — is genuinely distinct. Within
 * each tier the scorer picks the best panel count in a band around the tier's
 * demand anchor, then a minimum-gap pass spreads the three apart (where the roof
 * allows) so they never bunch into near-identical sizes. Options are returned
 * price-ascending; `isRecommended` marks the highest-scoring of the three.
 */
export function buildOptionSet(input: OptionSetInput): OptionSet {
  const ctx: PricingContext = {
    catalogue: input.catalogue,
    roofMaxPanels: input.roofMaxPanels,
    annualKwh: input.annualKwh,
    roofType: input.roofType,
  };
  const presets = buildTierPresets(ctx);

  const roofCap = Math.max(1, Math.min(input.roofMaxPanels, input.maxPanels, PV_MAX_PANELS));
  const floor = Math.max(1, Math.min(input.minPanels, roofCap));
  const clamp = (n: number) => Math.min(roofCap, Math.max(floor, n));

  // Best-scoring panel count within a band around the tier's demand anchor.
  const bestForTier = (tier: PresetTier): Candidate => {
    const base = presets[tier];
    const anchor = clamp(base.panelCount);
    const lo = clamp(Math.floor(anchor * (1 - COUNT_BAND)));
    const hi = clamp(Math.ceil(anchor * (1 + COUNT_BAND)));
    let best: Candidate | undefined;
    for (let count = lo; count <= hi; count++) {
      const c = makeCandidate(base, tier, count, input, ctx);
      if (!best || c.score > best.score) best = c;
    }
    return best ?? makeCandidate(base, tier, anchor, input, ctx);
  };

  const picks: Record<PresetTier, Candidate> = {
    essential: bestForTier('essential'),
    standard: bestForTier('standard'),
    premium: bestForTier('premium'),
  };

  // ── Enforce a minimum size gap so the three never bunch together ──
  // Push each tier above the previous by MIN_PANEL_GAP, then clamp back down to
  // the roof (preserving the gap where there's room). On a roof too small to
  // separate all three, counts converge but the tiers still differ by hardware.
  let eCount = picks.essential.panelCount;
  let sCount = Math.max(picks.standard.panelCount, eCount + MIN_PANEL_GAP);
  let pCount = Math.max(picks.premium.panelCount, sCount + MIN_PANEL_GAP);
  pCount = clamp(pCount);
  sCount = clamp(Math.min(sCount, pCount - MIN_PANEL_GAP));
  eCount = clamp(Math.min(eCount, sCount - MIN_PANEL_GAP));

  const finalCounts: Record<PresetTier, number> = {
    essential: eCount,
    standard: sCount,
    premium: pCount,
  };

  // Re-evaluate at the gap-adjusted counts, then order by price for labelling.
  const ordered = TIER_ORDER.map((tier) =>
    finalCounts[tier] === picks[tier].panelCount
      ? picks[tier]
      : makeCandidate(presets[tier], tier, finalCounts[tier], input, ctx),
  ).sort((a, b) => a.priceGbp - b.priceGbp);

  // Highlight the best-scoring of the three.
  let recIdx = 0;
  ordered.forEach((c, i) => {
    if (c.score > ordered[recIdx]!.score) recIdx = i;
  });

  const options = ordered.map((c, i) => toOption(c, KINDS_BY_PRICE[i]!, i === recIdx, input));
  const warnings = Array.from(new Set(options.flatMap((o) => o.warnings)));

  return {
    options,
    recommendedId: KINDS_BY_PRICE[recIdx]!,
    context: {
      mcsZone: input.mcsZone,
      irradianceKwhPerM2: input.irradianceKwhPerM2,
      annualKwh: input.annualKwh,
      roofMaxPanels: input.roofMaxPanels,
      budgetMaxGbp: input.budgetMaxGbp,
    },
    warnings,
    ladder: buildBudgetLadder(input),
  };
}
