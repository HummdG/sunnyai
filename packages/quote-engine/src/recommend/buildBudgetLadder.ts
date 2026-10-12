// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\buildBudgetLadder.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

import { buildTierPresets } from '../pricing/tiers.js';
import type { PricingContext, SystemConfig } from '../pricing/types.js';
import { evaluateConfig, net25YearValue, type CandidateEval } from './evaluateConfig.js';
import type { OptionSetInput, PresetTier } from './optionTypes.js';
import type { BudgetLadder, BudgetStep, TierStop } from './ladderTypes.js';

// ─── Tuning constants ────────────────────────────────────────────────────────
const PV_MAX_PANELS = 50; // computeQuote requires a pvBasePrice row in [1, 50]
/** Steps closer than this in price collapse — the slider can't resolve them. */
const MIN_PRICE_GAP = 400;
/** Keep the ladder readable: a handful of meaningful breakpoints. */
const MAX_STEPS = 12;
/**
 * Scales the context-aware battery bonus. Applied as a fraction of a battery
 * system's lifetime value, so it stays proportional across system sizes /
 * locations. Tuned so a high-affinity homeowner sees storage become the
 * recommended morph noticeably sooner than a pure-ROI one, without overriding
 * genuine ROI for someone with zero affinity (affinity 0 ⇒ no bonus at all).
 */
const BATTERY_AFFINITY_FACTOR = 0.18;
const EPS = 1e-6;

// ─── Context-aware battery affinity ──────────────────────────────────────────
// Returns a non-negative multiplier raising the desirability of storage based
// on the homeowner's journey answers. 0 ⇒ no battery preference (pure ROI).
// Enum values mirror src/lib/journey/types.ts exactly.
const TARIFF_AFFINITY: Record<string, number> = {
  smart_tou: 0.5,
  economy7: 0.3,
  import_export: 0.2,
  already_exports: 0,
  standard: 0,
  unknown: 0,
};
const LIFESTYLE_AFFINITY: Record<string, number> = {
  evening_use: 0.35,
  ev_now: 0.4,
  ev_planned: 0.2,
  heatpump_now: 0.3,
  heatpump_planned: 0.15,
  home_daytime: 0.1,
  high_daytime: 0.1,
};
const MOTIVATION_AFFINITY: Record<string, number> = {
  independence: 0.4,
  cheap_tariffs: 0.3,
  price_protection: 0.25,
  carbon: 0.15,
  reduce_bills: 0.1,
  home_value: 0,
  exploring: 0,
  earn_export: -0.2, // wants to export → storage works against the goal
};
const EXISTING_AFFINITY: Record<string, number> = {
  solar: 0.2, // already has panels → a battery is the natural next add
  none: 0,
  unsure: 0,
  battery: -0.5, // already has storage
  solar_battery: -0.5,
};

export function batteryAffinity(input: OptionSetInput): number {
  let a = TARIFF_AFFINITY[input.tariffType] ?? 0;
  for (const tag of input.lifestyle) a += LIFESTYLE_AFFINITY[tag] ?? 0;
  if (input.motivation) a += MOTIVATION_AFFINITY[input.motivation] ?? 0;
  if (input.existing) a += EXISTING_AFFINITY[input.existing] ?? 0;
  return Math.max(0, a);
}

/** The context-aware objective: base score + a battery bonus scaled by affinity. */
function ladderObjective(ev: CandidateEval, affinity: number): number {
  const bonus = ev.hasBattery
    ? affinity * Math.max(0, net25YearValue(ev.results)) * BATTERY_AFFINITY_FACTOR
    : 0;
  return ev.score + bonus;
}

// ─── Candidate enumeration ───────────────────────────────────────────────────
/**
 * Battery "lanes": the three tier-preset configurations (which already encode
 * realistic hardware bundles — essential = no battery, standard/premium = a
 * battery + optimisers + bird-mesh from the installer's own catalogue), plus a
 * premium-with-expansion lane where the catalogue supports it. Each lane is
 * swept across panel counts; the frontier then picks the best per price.
 */
function buildLanes(input: OptionSetInput, ctx: PricingContext): SystemConfig[] {
  const presets = buildTierPresets(ctx);
  const lanes: SystemConfig[] = [presets.essential, presets.standard, presets.premium];
  const premBat = presets.premium.battery;
  if (premBat) {
    const bat = input.catalogue.batteries.find((b) => b.sku === premBat.sku);
    if (bat?.expansionSku && (bat.expansionMaxUnits ?? 0) >= 1) {
      lanes.push({ ...presets.premium, battery: { ...premBat, expansionUnits: 1 } });
    }
  }
  return lanes;
}

interface ScoredCandidate {
  ev: CandidateEval;
  obj: number;
}

// ─── Step shaping ────────────────────────────────────────────────────────────
function toStep(c: ScoredCandidate): BudgetStep {
  const ev = c.ev;
  return {
    id: `step-${ev.priceGbp}`,
    thresholdGbp: ev.priceGbp,
    priceGbp: ev.priceGbp,
    config: ev.config,
    panelCount: ev.panelCount,
    hasBattery: ev.hasBattery,
    batteryKwh: ev.batteryKwh,
    systemKwp: ev.systemKwp,
    results: ev.results,
    label: null,
  };
}

/**
 * Thin the raw frontier into a slider-friendly set of steps. Anchors on the
 * cheapest system (so a low budget still sees a small entry system) and samples
 * upward keeping a ≥ MIN_PRICE_GAP spacing — crucially comparing against the
 * last *kept* step, not chaining, so a long ramp of small (£~280/panel) steps
 * is sampled rather than collapsed to its top. The cheapest, the most capable,
 * and the first battery-bearing step (the morph's key moment) are always kept.
 */
function shapeFrontier(frontier: ScoredCandidate[]): ScoredCandidate[] {
  if (frontier.length <= 2) return frontier;

  const protectedSet = new Set<ScoredCandidate>([frontier[0]!, frontier[frontier.length - 1]!]);
  const firstBattery = frontier.find((c) => c.ev.hasBattery);
  if (firstBattery) protectedSet.add(firstBattery);

  const sampled: ScoredCandidate[] = [];
  let lastKeptPrice = -Infinity;
  for (const c of frontier) {
    if (protectedSet.has(c) || c.ev.priceGbp - lastKeptPrice >= MIN_PRICE_GAP) {
      sampled.push(c);
      lastKeptPrice = c.ev.priceGbp;
    }
  }

  return capSteps(sampled, protectedSet);
}

/**
 * Cap to MAX_STEPS by repeatedly dropping the unprotected interior step with the
 * smallest objective gain over its predecessor.
 */
function capSteps(steps: ScoredCandidate[], protectedSet: Set<ScoredCandidate>): ScoredCandidate[] {
  const arr = [...steps];
  while (arr.length > MAX_STEPS) {
    let dropIdx = -1;
    let smallestGain = Infinity;
    for (let i = 1; i < arr.length - 1; i++) {
      if (protectedSet.has(arr[i]!)) continue;
      const gain = arr[i]!.obj - arr[i - 1]!.obj;
      if (gain < smallestGain) {
        smallestGain = gain;
        dropIdx = i;
      }
    }
    if (dropIdx === -1) break; // every interior step is protected
    arr.splice(dropIdx, 1);
  }
  return arr;
}

const TIER_LABEL: Record<PresetTier, string> = {
  essential: 'Essential',
  standard: 'Standard',
  premium: 'Premium',
};

/**
 * Build the budget ladder: a Pareto frontier over (price, context-aware objective)
 * that the slider sweeps. "More budget ⇒ at least as good" by construction. Pure.
 */
export function buildBudgetLadder(input: OptionSetInput): BudgetLadder {
  const ctx: PricingContext = {
    catalogue: input.catalogue,
    roofMaxPanels: input.roofMaxPanels,
    annualKwh: input.annualKwh,
    roofType: input.roofType,
  };

  // Mirror buildOptionSet's clamps exactly so the ladder never produces a step
  // the engine couldn't (and pvBasePrice rows always exist).
  const roofCap = Math.max(1, Math.min(input.roofMaxPanels, input.maxPanels, PV_MAX_PANELS));
  const floor = Math.max(1, Math.min(input.minPanels, roofCap));

  const affinity = batteryAffinity(input);
  const lanes = buildLanes(input, ctx);

  // Enumerate panel counts × battery lanes, scored with the context-aware objective.
  const candidates: ScoredCandidate[] = [];
  for (const lane of lanes) {
    for (let count = floor; count <= roofCap; count++) {
      const ev = evaluateConfig({ ...lane, panelCount: count }, input, ctx);
      candidates.push({ ev, obj: ladderObjective(ev, affinity) });
    }
  }

  // Pareto frontier: ascending price; keep a candidate only if it strictly beats
  // everything cheaper. Deterministic tiebreak for reproducible output.
  candidates.sort(
    (a, b) => a.ev.priceGbp - b.ev.priceGbp || b.obj - a.obj || a.ev.panelCount - b.ev.panelCount,
  );
  const frontier: ScoredCandidate[] = [];
  let bestObj = -Infinity;
  for (const c of candidates) {
    if (c.obj > bestObj + EPS) {
      frontier.push(c);
      bestObj = c.obj;
    }
  }

  const steps = shapeFrontier(frontier).map(toStep);

  // Tier stops: price each preset at its natural size, map to the nearest step.
  const presets = buildTierPresets(ctx);
  const tierStops: TierStop[] = (['essential', 'standard', 'premium'] as PresetTier[]).map(
    (tier) => {
      const ev = evaluateConfig(presets[tier], input, ctx);
      const nearest = steps.reduce(
        (best, s) =>
          Math.abs(s.priceGbp - ev.priceGbp) < Math.abs(best.priceGbp - ev.priceGbp) ? s : best,
        steps[0]!,
      );
      // Tag the matched step with the (highest) tier label for "you're near the X package" copy.
      nearest.label = TIER_LABEL[tier];
      return { tier, stepId: nearest.id, priceGbp: ev.priceGbp };
    },
  );

  const minGbp = steps[0]?.priceGbp ?? 0;
  const maxGbp = steps[steps.length - 1]?.priceGbp ?? minGbp;
  const initialGbp = Math.min(maxGbp, Math.max(minGbp, input.budgetMaxGbp));

  return { steps, tierStops, minGbp, maxGbp, initialGbp };
}

/**
 * The step active at a given budget: the most capable step the budget affords,
 * or the cheapest when the budget is below the entry system. Pure; the slider
 * and tests share this. Exported for unit testing the boundary behaviour.
 */
export function activeStep(steps: BudgetStep[], budgetGbp: number): BudgetStep | undefined {
  if (steps.length === 0) return undefined;
  let chosen = steps[0];
  for (const s of steps) {
    if (s.thresholdGbp <= budgetGbp) chosen = s;
    else break;
  }
  return chosen;
}
