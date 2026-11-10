/**
 * The quotes the store keeps, by kind. A row with no kind is a solar quote
 * (every quote before quotes came in kinds), so `isSolarRecord` and
 * `quoteKind` read a missing kind as solar.
 */

import type { BatteryQuoteRecord } from './battery/record.js';
import type { HeatPumpQuoteRecord } from './heat-pump/record.js';
import type { QuoteRecord } from './quote.js';

/** Any quote the store keeps: solar (no kind, or `'solar'`), heat pump or battery. */
export type StoredQuote = QuoteRecord | HeatPumpQuoteRecord | BatteryQuoteRecord;

export type QuoteKind = 'solar' | 'heat_pump' | 'battery';

/** A solar quote: rows from before quotes came in kinds have no `kind`. */
export function isSolarRecord(q: StoredQuote): q is QuoteRecord {
  return q.kind === undefined || q.kind === 'solar';
}

/** The quote's kind, with a row from before kinds read as solar. */
export function quoteKind(q: StoredQuote): QuoteKind {
  return q.kind ?? 'solar';
}

/** The kinds that render as a PDF (routes/proposal.ts). */
export type ProposalQuote = QuoteRecord | HeatPumpQuoteRecord;

const PROPOSAL_KINDS: ReadonlySet<QuoteKind> = new Set(['solar', 'heat_pump']);

/** Whether this quote has a PDF; a kind without one is a 404 on the proposal routes. */
export function hasProposal(q: StoredQuote): q is ProposalQuote {
  return PROPOSAL_KINDS.has(quoteKind(q));
}
