/**
 * The battery quote as stored: the same tenant-scoped quote row the solar and
 * heat pump journeys write, marked `kind: 'battery'`. It is a retrofit quote
 * for a home that already has solar.
 */

import type { BatteryEstimate, BatteryTariff } from '@sunny/quote-engine';

import type { QuotationSnapshot } from '../../proposal/snapshot.js';
import type { QuoteLineItem, QuoteRecord } from '../quote.js';

export interface BatteryOptionView {
  id: string;
  label: string;
  isRecommended: boolean;
  headline: string;
  capacityKwh: number;
  batteryName: string;
  /** Null when the installer prices this option themselves. */
  priceGbp: number | null;
  priceLabel: string;
  lineItems: QuoteLineItem[];
  annualSavingsGbp: number;
  /** Saved by storing the home's own solar rather than exporting it. */
  selfUseSavingGbp: number;
  /** Saved by charging at the cheap rate (time-of-use tariffs only, else 0). */
  shiftSavingGbp: number;
  /** Null when the option is unpriced or saves nothing (`batteryPaybackYears`). */
  paybackYears: number | null;
  warnings: string[];
  installerPriced: boolean;
}

export interface BatteryQuoteRecord {
  kind: 'battery';
  id: string;
  tenantId: string;
  sessionId: string;
  createdAt: string;
  priced: boolean;
  pricing: QuoteRecord['pricing'];
  /** The engine's estimate as plain data: its `sizing` function is not stored. */
  estimate: Omit<BatteryEstimate, 'sizing'>;
  postcode: string;
  /** The tariff the visitor said they are on when the quote was made. */
  tariff: BatteryTariff;
  options: BatteryOptionView[];
  recommendedId: string;
  warnings: string[];
  disclaimer: string;
  /** Set once the visitor consents and their lead carries this quote. */
  leadId: string | null;
  /** The option the visitor chose; absent until they do. */
  chosenOptionId?: string | null;
  chosenAt?: string | null;
  /** The installer's quotation settings when this quote was made. */
  quotation?: QuotationSnapshot;
  /** Warranty years by line-item sku, from the catalogue when the quote was made. */
  warranties?: Record<string, number>;
  /** The workflow this quote was made in, when it was. */
  workflowId?: string;
}

/**
 * Years to pay back: price over the annual saving, rounded to the half year.
 * Null when the option is unpriced or saves nothing.
 */
export function batteryPaybackYears(
  priceGbp: number | null,
  annualSavingsGbp: number,
): number | null {
  if (priceGbp === null || !(annualSavingsGbp > 0)) return null;
  return Math.round((priceGbp / annualSavingsGbp) * 2) / 2;
}
