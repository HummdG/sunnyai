/**
 * The quote: SunScan v1's engine run over the visitor's answers, the 3D roof
 * and the installer's price list, presented with every figure labelled for
 * what it is -- indicative, non-binding, subject to a survey (Blueprint §4.4).
 *
 * Prices come only from the tenant's pricing on the server, never from the
 * request. An installer with no price list still gets a useful answer: three
 * system sizes with generation and savings, and no price, with the visitor told
 * that a specialist will price it.
 */

import {
  buildOptionSet,
  buildQuoteInput,
  computeQuote,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PANEL,
  getIrradianceKwhPerM2,
  getTariffForPostcode,
  getZoneForPostcode,
  KWH_PER_KWP_UK,
  resolveAnnualKwh,
  runSolarCalculations,
  SHADING_LOSS,
  TIER_DEMAND_FACTOR,
  type OptionResult,
  type QuoteAnswers,
  type TenantPricing,
} from '@sunny/quote-engine';

import type { MappedRoof } from './roof.js';

export const QUOTE_DISCLAIMER =
  'Indicative and non-binding. Prices, system size, generation and savings are estimates ' +
  'from the details you gave and a 3D model of your roof, and are subject to an on-site ' +
  'structural and shading survey. Savings depend on your usage, tariff and the weather.';

export interface QuoteLineItem {
  sku: string;
  label: string;
  quantity: number;
  totalGbp: number;
}

export interface QuoteOptionView {
  id: string;
  label: string;
  isRecommended: boolean;
  headline: string;
  bestSuitedTo: string;
  tier: string;
  panelCount: number;
  panelType: string | null;
  inverterType: string | null;
  batteryType: string | null;
  batteryCapacityKwh: number;
  systemKwp: number;
  /** Null when the installer has no price list. */
  priceGbp: number | null;
  /** The price with the installer's VAT applied, when it has one. */
  priceIncVatGbp: number | null;
  priceLabel: string;
  lineItems: QuoteLineItem[];
  annualGenerationKwh: number;
  selfConsumptionRate: number;
  annualSavingsGbp: number;
  paybackYears: number | null;
  co2TonnesPerYear: number;
  inclusions: string[];
  warnings: string[];
  aboveBudget: boolean;
  roofLimited: boolean;
  /** Items in this option the installer prices themselves; never given a figure. */
  installerPriced: string[];
  /**
   * The installer's Sentinel optimisation uplift for this option, when it
   * offers one: modelled, never measured -- always labelled indicative.
   */
  sentinel: {
    upliftPercent: number;
    annualSavingsGbp: number;
    paybackYears: number | null;
    addedCostGbp: number;
  } | null;
}

export interface QuoteRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  createdAt: string;
  assessmentId: string | null;
  priced: boolean;
  pricing: {
    label: string;
    version: string;
    priceStatus: 'verified' | 'indicative';
    vatRatePercent: number | null;
    currency: 'GBP';
  } | null;
  basis: {
    postcode: string;
    regionName: string;
    mcsZone: string;
    annualKwh: number;
    importPence: number;
    exportPence: number;
    irradianceKwhPerM2: number;
    roofMaxPanels: number;
    pitchDeg: number;
    mcsOrientationDeg: number;
    shadingLoss: number;
    budgetMaxGbp: number | null;
    roofConfidence: string;
  };
  options: QuoteOptionView[];
  recommendedId: string | null;
  warnings: string[];
  disclaimer: string;
  /** Set once the visitor consents and their lead carries this quote. */
  leadId: string | null;
  /** The option the visitor chose ("Choose this package"); absent until they do. */
  chosenOptionId?: string | null;
  chosenAt?: string | null;
}

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function priceLabel(pricing: TenantPricing): string {
  const status =
    pricing.priceStatus === 'verified' ? "From the installer's price list" : 'Indicative price';
  const vat = pricing.vatRatePercent;
  // VAT is what the installer's list says, never assumed.
  if (vat === null) return `${status}; VAT as quoted by your installer`;
  if (pricing.pricesIncludeVat === true) return `${status}, including ${vat}% VAT`;
  return vat > 0 ? `${status}, before ${vat}% VAT` : `${status}, ${vat}% VAT`;
}

/**
 * The shading the visitor described applies to a mapped roof too: the 3D
 * assessment does not simulate shading, so the answer is the only evidence.
 * (v1 used it only in its low-confidence branch, where it asked the question.)
 */
function withShading(pricing: TenantPricing, answers: QuoteAnswers): TenantPricing {
  const shading = answers.roofFallback?.shading;
  if (answers.roof.confidence === 'low' || !shading || !(shading in SHADING_LOSS)) return pricing;
  return {
    ...pricing,
    assumptions: { ...pricing.assumptions, shadingLoss: SHADING_LOSS[shading]! },
  };
}

function viewOf(
  option: OptionResult,
  pricing: TenantPricing,
  ctx: { roofMaxPanels: number; annualKwh: number; roofType: QuoteAnswers['roof']['roofType'] },
): QuoteOptionView {
  const breakdown = computeQuote(option.config, {
    catalogue: pricing.catalogue,
    roofMaxPanels: ctx.roofMaxPanels,
    annualKwh: ctx.annualKwh,
    roofType: ctx.roofType,
  });
  const vat = pricing.vatRatePercent;
  return {
    id: option.id,
    label: option.label,
    isRecommended: option.isRecommended,
    headline: option.headline,
    bestSuitedTo: option.bestSuitedTo,
    tier: option.tier,
    panelCount: option.panelCount,
    panelType: option.panelType,
    inverterType: option.inverterType,
    batteryType: option.batteryType,
    batteryCapacityKwh: option.batteryCapacityKwh,
    systemKwp: round(option.systemKwp, 2),
    priceGbp: option.priceGbp,
    priceIncVatGbp:
      vat !== null && vat > 0 && pricing.pricesIncludeVat !== true
        ? round(option.priceGbp * (1 + vat / 100))
        : null,
    priceLabel: priceLabel(pricing),
    lineItems: breakdown.lineItems.map((item) => ({
      sku: item.sku,
      label: item.label,
      quantity: item.quantity,
      totalGbp: round(item.totalGbp),
    })),
    annualGenerationKwh: option.results.annualGenerationKwh,
    selfConsumptionRate: round(option.results.selfConsumptionRate, 2),
    annualSavingsGbp: option.results.annualSavingsPounds,
    paybackYears: option.results.paybackYears >= 99 ? null : option.results.paybackYears,
    co2TonnesPerYear: option.results.co2SavedTonnesPerYear,
    inclusions: option.inclusions,
    warnings: option.warnings,
    aboveBudget: option.aboveBudget,
    roofLimited: option.roofLimited,
    installerPriced: pricing.installerPriced ?? [],
    sentinel: option.sentinel.enabled
      ? {
          upliftPercent: round(option.sentinel.upliftPercent * 100, 1),
          annualSavingsGbp: round(option.sentinel.withSentinel.annualSavingGbp),
          paybackYears:
            option.sentinel.withSentinel.paybackYears >= 99
              ? null
              : round(option.sentinel.withSentinel.paybackYears, 1),
          addedCostGbp: round(option.sentinel.addedCostGbp),
        }
      : null,
  };
}

/** Three sizes without prices, for an installer that has not uploaded a price list. */
function unpricedOptions(answers: QuoteAnswers): {
  basis: QuoteRecord['basis'];
  options: QuoteOptionView[];
} {
  const regional = getTariffForPostcode(answers.postcode);
  const importPence = answers.usage.unitRatePence ?? regional.importPencePerKwh;
  const exportPence = answers.usage.exportTariffPence ?? regional.segExportPencePerKwh;
  const annualKwh = resolveAnnualKwh(answers.usage, importPence);
  const zone = getZoneForPostcode(answers.postcode);
  const irradiance = getIrradianceKwhPerM2(
    zone,
    answers.roof.pitchDeg,
    answers.roof.mcsOrientationDeg,
  );
  const shading =
    (answers.roofFallback?.shading && SHADING_LOSS[answers.roofFallback.shading]) ||
    DEFAULT_ASSUMPTIONS.shadingLoss;
  const roofMax = Math.max(1, answers.roof.maxPanelCount);
  const panelKw = DEFAULT_PANEL.wattPeak / 1000;

  const labels = {
    essential: 'Smaller system',
    standard: 'Mid-sized system',
    premium: 'Larger system',
  } as const;
  const options = (['essential', 'standard', 'premium'] as const).map((tier) => {
    const target = (annualKwh * TIER_DEMAND_FACTOR[tier]) / KWH_PER_KWP_UK;
    const count = Math.max(4, Math.min(roofMax, Math.round(target / panelKw)));
    const r = runSolarCalculations(count, DEFAULT_PANEL, irradiance, annualKwh, importPence, {
      ...DEFAULT_ASSUMPTIONS,
      roofPitchDeg: answers.roof.pitchDeg,
      roofOrientationDeg: answers.roof.mcsOrientationDeg,
      shadingLoss: shading,
      exportTariffPencePerKwh: exportPence,
      hasBattery: tier === 'premium',
    });
    const view: QuoteOptionView = {
      id: tier,
      label: labels[tier],
      isRecommended: tier === 'standard',
      headline: 'Sized to your electricity use',
      bestSuitedTo: 'A specialist will confirm the size and price after a survey.',
      tier,
      panelCount: count,
      panelType: null,
      inverterType: null,
      batteryType: tier === 'premium' ? 'Battery (to be specified)' : null,
      batteryCapacityKwh: tier === 'premium' ? DEFAULT_ASSUMPTIONS.batteryKwh : 0,
      systemKwp: round(count * panelKw, 2),
      priceGbp: null,
      priceIncVatGbp: null,
      priceLabel: 'Price to be confirmed by a specialist',
      lineItems: [],
      annualGenerationKwh: r.annualGenerationKwh,
      selfConsumptionRate: round(r.selfConsumptionRate, 2),
      annualSavingsGbp: r.annualSavingsPounds,
      paybackYears: null,
      co2TonnesPerYear: r.co2SavedTonnesPerYear,
      inclusions: [],
      warnings: count >= roofMax ? ['Limited by the space on your roof.'] : [],
      aboveBudget: false,
      roofLimited: count >= roofMax,
      installerPriced: [],
      sentinel: null,
    };
    return view;
  });
  return {
    basis: {
      postcode: answers.postcode,
      regionName: regional.regionName,
      mcsZone: zone,
      annualKwh,
      importPence,
      exportPence,
      irradianceKwhPerM2: irradiance,
      roofMaxPanels: roofMax,
      pitchDeg: answers.roof.pitchDeg,
      mcsOrientationDeg: answers.roof.mcsOrientationDeg,
      shadingLoss: shading,
      budgetMaxGbp: null,
      roofConfidence: answers.roof.confidence,
    },
    options,
  };
}

export function buildQuote(input: {
  id: string;
  tenantId: string;
  sessionId: string;
  createdAt: string;
  answers: QuoteAnswers;
  roof: MappedRoof | null;
  pricing: TenantPricing | null;
}): QuoteRecord {
  const { answers, roof } = input;
  const base = {
    id: input.id,
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    assessmentId: roof?.assessmentId ?? null,
    disclaimer: QUOTE_DISCLAIMER,
    leadId: null,
  };

  if (!input.pricing) {
    const { basis, options } = unpricedOptions(answers);
    return {
      ...base,
      priced: false,
      pricing: null,
      basis,
      options,
      recommendedId: 'standard',
      warnings: [
        'This installer has not published prices yet, so a specialist will price your system.',
      ],
    };
  }

  const pricing = withShading(input.pricing, answers);
  const { input: engineInput, derived } = buildQuoteInput(answers, pricing);
  const set = buildOptionSet(engineInput);
  const ctx = {
    roofMaxPanels: engineInput.roofMaxPanels,
    annualKwh: engineInput.annualKwh,
    roofType: engineInput.roofType,
  };
  return {
    ...base,
    priced: true,
    pricing: {
      label: pricing.source.label,
      version: pricing.source.version,
      priceStatus: pricing.priceStatus,
      vatRatePercent: pricing.vatRatePercent,
      currency: pricing.currency,
    },
    basis: {
      postcode: answers.postcode,
      regionName: derived.regionName,
      mcsZone: derived.mcsZone,
      annualKwh: derived.annualKwh,
      importPence: derived.importPence,
      exportPence: derived.exportPence,
      irradianceKwhPerM2: derived.irradianceKwhPerM2,
      roofMaxPanels: derived.roofMaxPanels,
      pitchDeg: engineInput.pitchDeg,
      mcsOrientationDeg: derived.mcsOrientationDeg,
      shadingLoss: derived.shadingLoss,
      budgetMaxGbp: answers.budgetBandId ? derived.budgetMaxGbp : null,
      roofConfidence: answers.roof.confidence,
    },
    // Each option is flagged when it costs more than the visitor said they
    // would spend (v1's own flag only marks a set whose cheapest is over).
    options: set.options.map((o) => {
      const view = viewOf(o, pricing, ctx);
      const budget = answers.budgetBandId ? derived.budgetMaxGbp : null;
      return budget !== null && view.priceGbp !== null && view.priceGbp > budget
        ? { ...view, aboveBudget: true }
        : view;
    }),
    recommendedId: set.recommendedId,
    warnings: set.warnings,
  };
}
