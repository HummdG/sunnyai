/**
 * The heat pump quote as stored: the same tenant-scoped quote row the solar
 * journey writes, marked `kind: 'heat_pump'`. `StoredQuote` and the kind
 * helpers live in `../quote-kinds.ts`.
 */

import type { Fuel, HeatPumpEstimate } from '@sunny/heat-pump-engine';

import type { QuotationSnapshot } from '../../proposal/snapshot.js';
import type { QuoteLineItem, QuoteRecord } from '../quote.js';

export interface HeatPumpOptionView {
  id: string;
  label: string;
  isRecommended: boolean;
  headline: string;
  outputKw: number;
  unitName: string;
  /** Null when the installer has no price for this unit. */
  priceGbp: number | null;
  /**
   * The Boiler Upgrade Scheme grant applied to this option: the scheme amount,
   * capped at the price when there is one, so price less grant is never below
   * zero (0 when not eligible).
   */
  grantGbp: number;
  priceAfterGrantGbp: number | null;
  priceLabel: string;
  lineItems: QuoteLineItem[];
  runningCostGbp: number;
  currentCostGbp: number;
  annualSavingsGbp: number;
  inclusions: string[];
  warnings: string[];
  installerPriced: boolean;
}

export interface HeatPumpQuoteRecord {
  kind: 'heat_pump';
  id: string;
  tenantId: string;
  sessionId: string;
  createdAt: string;
  priced: boolean;
  pricing: QuoteRecord['pricing'];
  estimate: HeatPumpEstimate;
  /**
   * How the home was heated when the quote was made (gas when the visitor did
   * not say, as the estimate assumed). Fixed here so the PDF never follows a
   * later answer. Absent on rows made before it was stored.
   */
  currentFuel?: Fuel;
  postcode: string;
  options: HeatPumpOptionView[];
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

export type GrantStatus = 'eligible' | 'unsure' | 'none';

/** The grant as the card shows it: `unsure` when the postcode cannot tell. */
export function grantStatusOf(eligible: boolean | 'unsure'): GrantStatus {
  return eligible === true ? 'eligible' : eligible === 'unsure' ? 'unsure' : 'none';
}
