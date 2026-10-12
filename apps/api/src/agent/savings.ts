/**
 * `estimate_savings` (Blueprint §5 matrix, base package): a deterministic,
 * non-binding savings estimate.
 *
 * Built only from the installer's own tariff assumptions and what the visitor
 * says about their bill. No tariff is ever invented: an installer that has not
 * configured a model gets a refusal and a survey offer, never a "typical UK"
 * figure that nobody stands behind.
 */

/** The §4.4 disclaimer, hardcoded so no prompt or model can drop it. */
export const ESTIMATE_DISCLAIMER =
  'This is a non-binding estimate. Actual savings and system size are subject to an on-site structural and shading survey.';

export interface SavingsModel {
  /** ISO currency the prices below are in. */
  currency: string;
  /** What the visitor pays for imported electricity, per kWh, in major units. */
  importPricePerKwh: number;
  /** What exported electricity earns, per kWh (e.g. an SEG rate). 0 if none. */
  exportPricePerKwh: number;
  /** Yearly generation per kWp installed, in the installer's region. */
  kwhPerKwpYear: number;
  /** Share of generation used on site, 0..1. */
  selfConsumptionShare: number;
  /** The largest system the installer would size for a home, kWp. */
  maxSystemKwp: number;
}

export interface SavingsInput {
  monthlyBill: number;
  currency?: string | null;
}

export type SavingsResult =
  | {
      ok: true;
      currency: string;
      annualBill: number;
      estimatedAnnualUseKwh: number;
      systemKwp: number;
      annualGenerationKwh: number;
      annualSavingsLow: number;
      annualSavingsHigh: number;
      assumptions: string[];
      disclaimer: string;
    }
  | { ok: false; reason: string; disclaimer: string };

const round = (value: number, step: number): number => Math.round(value / step) * step;

export function estimateSavings(
  model: SavingsModel | undefined,
  input: SavingsInput,
): SavingsResult {
  if (!model) {
    return {
      ok: false,
      reason:
        'This installer has not supplied tariff assumptions, so no savings figure can be given. Offer a free survey instead.',
      disclaimer: ESTIMATE_DISCLAIMER,
    };
  }
  if (!Number.isFinite(input.monthlyBill) || input.monthlyBill <= 0 || input.monthlyBill > 5000) {
    return {
      ok: false,
      reason: 'A monthly electricity bill between 1 and 5000 is needed for an estimate.',
      disclaimer: ESTIMATE_DISCLAIMER,
    };
  }
  if (input.currency && input.currency.toUpperCase() !== model.currency.toUpperCase()) {
    return {
      ok: false,
      reason: `Estimates are only available in ${model.currency}.`,
      disclaimer: ESTIMATE_DISCLAIMER,
    };
  }

  const annualBill = input.monthlyBill * 12;
  const annualUse = annualBill / model.importPricePerKwh;
  // Sized to cover the home's use, never past the installer's own ceiling.
  const systemKwp = Math.min(
    model.maxSystemKwp,
    Math.max(1, round(annualUse / model.kwhPerKwpYear, 0.1)),
  );
  const generation = systemKwp * model.kwhPerKwpYear;
  const usedOnSite = Math.min(generation * model.selfConsumptionShare, annualUse);
  const exported = generation - usedOnSite;
  const central = usedOnSite * model.importPricePerKwh + exported * model.exportPricePerKwh;

  return {
    ok: true,
    currency: model.currency,
    annualBill: round(annualBill, 1),
    estimatedAnnualUseKwh: round(annualUse, 10),
    systemKwp: round(systemKwp, 0.1),
    annualGenerationKwh: round(generation, 10),
    // A range rather than a point: the inputs are a bill and a set of averages.
    annualSavingsLow: round(central * 0.85, 10),
    annualSavingsHigh: round(central * 1.15, 10),
    assumptions: [
      `Electricity bought at ${model.currency} ${model.importPricePerKwh}/kWh, as supplied by the installer.`,
      `Export earns ${model.currency} ${model.exportPricePerKwh}/kWh.`,
      `${model.kwhPerKwpYear} kWh generated per kWp per year in this region.`,
      `${Math.round(model.selfConsumptionShare * 100)}% of generation used in the home.`,
      'Your usage is inferred from your bill alone; standing charges are ignored.',
    ],
    disclaimer: ESTIMATE_DISCLAIMER,
  };
}
