/**
 * Everything a page of the quotation PDF needs, assembled once by the
 * orchestrator (`proposalDocFor` in index.ts) from the stored quote, its snapshot of the
 * installer's settings, the roof assessment and the brand store.
 *
 * Page convention: each `draw*` function draws onto the current page, which
 * the orchestrator has just added (the cover uses the document's first page),
 * and may add continuation pages of its own. Pages never draw the running
 * header or footer: the orchestrator renders with `bufferPages` and stamps
 * them on every page afterwards. Page content stays inside `CONTENT` (see
 * layout.ts), clear of the header band at the top and the footer band at the
 * bottom.
 */

import type { QuoteOptionView, QuoteRecord } from '../journey/quote.js';

import type { ProposalRoof } from './pdf.js';
import type { RoofPlan } from './roof-plan.js';
import type { QuotationSnapshot } from './snapshot.js';

/**
 * What every quotation PDF carries, whatever the quote's kind: the installer's
 * snapshot, the customer, the logos, the reference and the dates. The pages
 * every kind shares (the rail's brand mark, Terms) need only this.
 */
export interface ProposalBase {
  /** True when the document's option is the one the visitor chose. */
  chosen: boolean;
  /** The installer's settings when the quote was made (or the defaults). */
  snapshot: QuotationSnapshot;
  customer: { name: string | null; address: string | null };
  /** The logo PNG for the PDF, or null to set the company name instead. */
  logo: Buffer | null;
  accreditationLogos: Buffer[];
  /**
   * Warranty years by line-item sku, from the installer's catalogue where it
   * carries one. Absent or missing a sku: no warranty is printed for it.
   */
  warranties?: Record<string, number>;
  generatedAt: Date;
  /** `referenceFor(quote)`. */
  reference: string;
  /** The quote's `createdAt` plus the snapshot's validity days. */
  validUntil: Date;
}

export interface ProposalDoc extends ProposalBase {
  quote: QuoteRecord;
  /** The option the document is about: the visitor's choice, else the recommended one. */
  option: QuoteOptionView;
  /** The quote's other options, for "Other options we looked at". */
  others: QuoteOptionView[];
  /** The real roof with the quoted panels, or null when it cannot be drawn honestly. */
  roofPlan: RoofPlan | null;
  roofFacts: ProposalRoof | null;
}
