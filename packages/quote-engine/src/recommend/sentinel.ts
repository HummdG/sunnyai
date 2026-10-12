// Ported from SunScan v1 (C:\Work\Arkalith\SunScan\sunscan\src\lib\recommend\sentinel.ts)
// on 2026-10-12 — see packages/quote-engine/PROVENANCE.md. Behaviour is kept
// faithful to the original; changes are limited to imports, strictness fixes
// and removing framework / database / file-system access.

// Sentinel optimisation layer — a separate, indicative uplift shown before/after
// for each system option. Pure + configurable per installer
// (InstallerConfig.sentinelConfigJson).

export interface SentinelConfig {
  enabled: boolean;
  /** Base optimisation uplift on annual savings, e.g. 0.12 = +12%. */
  baseUpliftPercent: number;
  /** Extra uplift by tariff type — smart/ToU tariffs benefit most. */
  tariffModifiers: Record<string, number>;
  /** Sentinel mostly shifts self-consumption; muted without storage. */
  batteryRequiredForFullUplift: boolean;
  noBatteryUpliftFactor: number;
  /** Extra uplift per lifestyle tag (EV, heat pump, high daytime use…). */
  lifestyleBonus: Record<string, number>;
  /** Hard ceiling on the combined uplift. */
  capUpliftPercent: number;
  /** One-off cost of adding the Sentinel layer. */
  addedCostGbp: number;
}

export interface SentinelBeforeAfter {
  annualSavingGbp: number;
  annualExportGbp: number;
  paybackYears: number;
}

export interface SentinelResult {
  enabled: boolean;
  withoutSentinel: SentinelBeforeAfter;
  withSentinel: SentinelBeforeAfter;
  upliftPercent: number;
  addedCostGbp: number;
  /** Always true — these are modelled, not measured, figures. */
  indicative: true;
}

/**
 * The combined Sentinel uplift fraction for a system. Pure.
 * uplift = base + tariffModifier + Σ lifestyleBonus, ×noBatteryFactor when the
 * system has no battery and the config requires one, clamped to the cap.
 */
export function computeSentinelUplift(
  hasBattery: boolean,
  tariffType: string,
  lifestyle: string[],
  config: SentinelConfig | null | undefined,
): number {
  if (!config || !config.enabled) return 0;
  let uplift = config.baseUpliftPercent + (config.tariffModifiers[tariffType] ?? 0);
  for (const tag of lifestyle) uplift += config.lifestyleBonus[tag] ?? 0;
  if (!hasBattery && config.batteryRequiredForFullUplift) {
    uplift *= config.noBatteryUpliftFactor;
  }
  return Math.max(0, Math.min(uplift, config.capUpliftPercent));
}

export interface SentinelInput {
  annualSavingGbp: number;
  annualExportGbp: number;
  paybackYearsBase: number;
  priceGbp: number;
  hasBattery: boolean;
  tariffType: string;
  lifestyle: string[];
  config: SentinelConfig | null | undefined;
}

/**
 * Compute the before/after Sentinel figures for one option. Indicative.
 * Sentinel raises annual savings by the uplift (smarter charge/use/export
 * decisions) and shifts surplus into self-consumption, so modelled export falls
 * proportionally. Payback re-derived from the uplifted saving + any added cost.
 */
export function computeSentinel(input: SentinelInput): SentinelResult {
  const without: SentinelBeforeAfter = {
    annualSavingGbp: input.annualSavingGbp,
    annualExportGbp: input.annualExportGbp,
    paybackYears: input.paybackYearsBase,
  };

  if (!input.config || !input.config.enabled) {
    return {
      enabled: false,
      withoutSentinel: without,
      withSentinel: without,
      upliftPercent: 0,
      addedCostGbp: 0,
      indicative: true,
    };
  }

  const uplift = computeSentinelUplift(
    input.hasBattery,
    input.tariffType,
    input.lifestyle,
    input.config,
  );
  const addedCostGbp = input.config.addedCostGbp ?? 0;
  const newSaving = without.annualSavingGbp * (1 + uplift);
  const newExport = Math.max(0, without.annualExportGbp * (1 - uplift));
  const paybackYears =
    newSaving > 0 ? (input.priceGbp + addedCostGbp) / newSaving : without.paybackYears;

  return {
    enabled: true,
    withoutSentinel: without,
    withSentinel: {
      annualSavingGbp: newSaving,
      annualExportGbp: newExport,
      paybackYears,
    },
    upliftPercent: uplift,
    addedCostGbp,
    indicative: true,
  };
}
