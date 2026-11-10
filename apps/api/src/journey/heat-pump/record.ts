/**
 * The heat pump quote as stored: the same tenant-scoped quote row the solar
 * journey writes, marked `kind: 'heat_pump'`. A row with no kind is a solar
 * quote (every quote before quotes came in kinds), so `isSolarRecord` treats a
 * missing kind as solar.
 */

import type { HeatPumpEstimate } from '@sunny/heat-pump-engine';

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
  /** The Boiler Upgrade Scheme grant this option can claim (0 when not eligible). */
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

/** Any quote the store keeps: solar (no kind, or `'solar'`) or heat pump. */
export type StoredQuote = QuoteRecord | HeatPumpQuoteRecord;

/** A solar quote: rows from before quotes came in kinds have no `kind`. */
export function isSolarRecord(q: StoredQuote): q is QuoteRecord {
  return q.kind === undefined || q.kind === 'solar';
}

/** The quote's kind, with a row from before kinds read as solar. */
export function quoteKind(q: StoredQuote): 'solar' | 'heat_pump' {
  return q.kind ?? 'solar';
}
