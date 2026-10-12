import { buildSavingsTimeline, type SavingsTimeline } from '@sunny/quote-engine';

import type { QuoteOptionView, QuoteRecord } from './quote.js';

/**
 * "Choose this package": the visitor's pick among a quote's options, and the
 * month-by-month savings timeline the 3D simulation plays for it.
 *
 * The timeline is computed here, on the server, from the same basis the quote
 * was priced on (the household's annual use and the tariffs the quote used), so
 * the widget never supplies a figure. Its year-1 total matches the option's
 * card to within £1; Sentinel's modelled uplift is reported separately and never
 * folded into the headline.
 */

export interface ChosenPackage {
  quoteId: string;
  chosenOptionId: string;
  option: Pick<
    QuoteOptionView,
    'id' | 'label' | 'panelCount' | 'systemKwp' | 'batteryType' | 'priceGbp' | 'annualSavingsGbp'
  >;
  /** Null when the quote has no 3D roof to play the simulation on. */
  assessmentId: string | null;
  timeline: SavingsTimeline;
  /** Sentinel's modelled extra, as an optional note (never the headline). */
  sentinelNote: string | null;
}

export function optionTimeline(quote: QuoteRecord, option: QuoteOptionView): SavingsTimeline {
  const hasBattery = option.batteryType !== null && option.batteryCapacityKwh > 0;
  return buildSavingsTimeline({
    annualGenerationKwh: option.annualGenerationKwh,
    annualDemandKwh: quote.basis.annualKwh,
    hasBattery,
    batteryKwh: hasBattery ? option.batteryCapacityKwh : 0,
    tariffPencePerKwh: quote.basis.importPence,
    exportTariffPencePerKwh: quote.basis.exportPence,
    ...(option.priceGbp !== null && option.priceGbp > 0
      ? { systemCostPounds: option.priceGbp }
      : {}),
  });
}

export function chosenPackage(quote: QuoteRecord, option: QuoteOptionView): ChosenPackage {
  const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
  return {
    quoteId: quote.id,
    chosenOptionId: option.id,
    option: {
      id: option.id,
      label: option.label,
      panelCount: option.panelCount,
      systemKwp: option.systemKwp,
      batteryType: option.batteryType,
      priceGbp: option.priceGbp,
      annualSavingsGbp: option.annualSavingsGbp,
    },
    assessmentId: quote.assessmentId,
    timeline: optionTimeline(quote, option),
    sentinelNote: option.sentinel
      ? `With Sentinel optimisation this could rise to about ${gbp(option.sentinel.annualSavingsGbp)} a year (modelled, indicative).`
      : null,
  };
}
