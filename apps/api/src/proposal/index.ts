import { toRoofAssessmentSummary } from '@sunny/sunscan-adapter';

import type { QuoteRecord } from '../journey/quote.js';
import type { LeadRecord, Store } from '../store.js';
import type { Tenant } from '../tenants.js';
import { renderProposal, type ProposalInput, type ProposalRoof } from './pdf.js';

export { renderProposal, type ProposalInput } from './pdf.js';
export { mailerFromEnv, type ProposalMailer } from './mailer.js';

const FACING: Record<string, string> = {
  N: 'North',
  NE: 'North-east',
  E: 'East',
  SE: 'South-east',
  S: 'South',
  SW: 'South-west',
  W: 'West',
  NW: 'North-west',
  flat: 'Flat roof',
};

/** The roof facts the proposal shows, from the quote's assessment, when there is one. */
async function roofFor(store: Store, quote: QuoteRecord): Promise<ProposalRoof | null> {
  if (!quote.assessmentId) return null;
  const record = await store.getSunScanAssessment(quote.tenantId, quote.assessmentId);
  const summary = record ? toRoofAssessmentSummary(record) : null;
  if (!summary) return null;
  const main = summary.roofPlanes.find((p) => p.id === summary.mainPlaneId) ?? null;
  return {
    bestFacing: summary.bestFacing ? (FACING[summary.bestFacing] ?? summary.bestFacing) : null,
    pitchDeg: main?.pitchDeg ?? quote.basis.pitchDeg,
    usableRoofAreaM2: summary.usableRoofAreaM2,
    estimatedMaxPanels: summary.estimatedMaxPanels,
    reliable: summary.reliable,
    label: summary.reliable ? 'Good fit to the 3D data' : 'Low',
  };
}

/** Everything the PDF needs for a stored quote: installer branding, customer, roof. */
export async function proposalInputFor(
  store: Store,
  tenant: Tenant,
  quote: QuoteRecord,
  lead: LeadRecord | null,
  now: Date,
): Promise<ProposalInput> {
  const conversation = await store.getConversation(tenant.id, quote.sessionId);
  const address = conversation?.answers?.['address'];
  const contact = tenant.config.supportContact;
  return {
    quote,
    installer: {
      companyName: tenant.config.companyName,
      colour: tenant.config.primaryColor,
      phone: contact?.phone ?? null,
      email: contact?.email ?? null,
      website: tenant.websiteUrl ?? null,
    },
    customer: {
      name: lead?.name ?? null,
      address: typeof address === 'string' && address.trim() !== '' ? address.trim() : null,
    },
    roof: await roofFor(store, quote),
    generatedAt: now,
  };
}

/** Render a stored quote's proposal. */
export async function proposalPdf(
  store: Store,
  tenant: Tenant,
  quote: QuoteRecord,
  lead: LeadRecord | null,
  now: Date,
): Promise<Buffer> {
  return renderProposal(await proposalInputFor(store, tenant, quote, lead, now));
}

/** A filename for the download, from the installer and the quote. */
export function proposalFilename(tenant: Tenant, quote: QuoteRecord): string {
  const company = tenant.config.companyName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${company || 'solar'}-proposal-${quote.id.slice(-8)}.pdf`;
}
