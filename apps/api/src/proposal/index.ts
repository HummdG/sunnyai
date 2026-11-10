import { toRoofAssessmentSummary, type SunScanService } from '@sunny/sunscan-adapter';

import type { StoredBranding } from '../branding/meta.js';
import type { BrandAssetStore } from '../branding/store.js';
import {
  isSolarRecord,
  type HeatPumpQuoteRecord,
  type StoredQuote,
} from '../journey/heat-pump/record.js';
import type { QuoteOptionView, QuoteRecord } from '../journey/quote.js';
import type { RoofAssessmentSummary } from '../journey/roof.js';
import type { LeadRecord, Store } from '../store.js';
import type { Tenant } from '../tenants.js';

import { referenceFor } from './copy.js';
import type { ProposalDoc } from './doc.js';
import { fuelOf, type AnyProposalDoc, type HeatPumpProposalDoc } from './heat-pump/doc.js';
import { DEFAULT_BRAND } from './layout.js';
import { renderProposal, type ProposalRoof } from './pdf.js';
import { roofPlanFor, type RoofPlan } from './roof-plan.js';
import { snapshotFor, type QuotationSnapshot } from './snapshot.js';

export { renderProposal, type ProposalRoof } from './pdf.js';
export type { ProposalDoc } from './doc.js';
export type { AnyProposalDoc, HeatPumpProposalDoc } from './heat-pump/doc.js';
export { mailerFromEnv, type ProposalMailer } from './mailer.js';

/** Where a proposal's parts come from besides the quote: the store, logos, the 3D roof. */
export interface ProposalSources {
  store: Store;
  /** The installer's uploaded logos. Absent: the company name is set instead. */
  brandAssets?: BrandAssetStore | null;
  /** For the roof assessment's `spec.json`. Absent: no roof plan. */
  sunscan?: Pick<SunScanService, 'getArtefact'> | null;
}

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** The visitor's chosen package when they picked one, otherwise the recommended option. */
function optionOf<O extends { id: string; isRecommended: boolean }>(quote: {
  options: O[];
  chosenOptionId?: string | null;
  recommendedId: string | null;
}): { option: O; chosen: boolean } {
  const picked = quote.chosenOptionId
    ? quote.options.find((o) => o.id === quote.chosenOptionId)
    : undefined;
  const option =
    picked ??
    quote.options.find((o) => o.id === quote.recommendedId) ??
    quote.options.find((o) => o.isRecommended) ??
    quote.options[quote.options.length - 1]!;
  return { option, chosen: !!picked };
}

/**
 * The quote's snapshot, or the defaults for a quote made before snapshots. A
 * snapshot saved before PDF colours existed takes its own brand colour.
 */
function snapshotOf(tenant: Tenant, quote: Pick<StoredQuote, 'quotation'>): QuotationSnapshot {
  const snap = quote.quotation;
  if (!snap) return snapshotFor(tenant, undefined);
  if (snap.colours?.rail && snap.colours.accent) return snap;
  const brand = /^#[0-9a-f]{6}$/i.test(snap.colour) ? snap.colour.toLowerCase() : DEFAULT_BRAND;
  return {
    ...snap,
    colours: { rail: snap.colours?.rail ?? brand, accent: snap.colours?.accent ?? brand },
  };
}

/** One stored PNG, or null when it is missing, unreadable or not a valid id. */
async function asset(
  brandAssets: BrandAssetStore | null | undefined,
  tenantId: string,
  id: string | null | undefined,
): Promise<Buffer | null> {
  if (!brandAssets || !id) return null;
  try {
    const bytes = await brandAssets.get(tenantId, `${id}.png`);
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * The PDF logo: the one the snapshot fixed when the quote was made (null sets
 * the company name). A snapshot made before that was fixed: its own PDF logo,
 * else Your brand's wordmark or icon as they are now.
 */
async function logoFor(
  brandAssets: BrandAssetStore | null | undefined,
  tenant: Tenant,
  snap: QuotationSnapshot,
): Promise<Buffer | null> {
  if (snap.pdfLogoAssetId !== undefined) {
    return asset(brandAssets, tenant.id, snap.pdfLogoAssetId);
  }
  if (snap.logoAssetId) return asset(brandAssets, tenant.id, snap.logoAssetId);
  const branding: StoredBranding | undefined = tenant.config.branding;
  if (!branding || branding.mode !== 'logo' || !branding.icon) return null;
  return (
    (await asset(brandAssets, tenant.id, branding.wordmark?.id)) ??
    (await asset(brandAssets, tenant.id, branding.icon.id))
  );
}

async function summaryFor(
  store: Store,
  tenant: Tenant,
  quote: QuoteRecord,
): Promise<RoofAssessmentSummary | null> {
  if (!quote.assessmentId) return null;
  try {
    const record = await store.getSunScanAssessment(tenant.id, quote.assessmentId);
    return record ? toRoofAssessmentSummary(record) : null;
  } catch {
    return null;
  }
}

/**
 * The real roof with the quoted panels, laid out as the widget lays them (on
 * the planes the summary calls suitable). Any failure means no plan.
 */
async function planFor(
  sunscan: ProposalSources['sunscan'],
  tenant: Tenant,
  quote: QuoteRecord,
  summary: RoofAssessmentSummary,
  option: QuoteOptionView,
): Promise<RoofPlan | null> {
  if (!sunscan || !quote.assessmentId) return null;
  try {
    const bytes = await sunscan.getArtefact(tenant.id, quote.assessmentId, 'spec.json');
    if (!bytes) return null;
    const spec: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return roofPlanFor(spec, {
      panelCount: option.panelCount,
      planeIds: summary.roofPlanes.filter((p) => p.suitable).map((p) => p.id),
      reliable: summary.reliable,
    });
  } catch {
    return null;
  }
}

/**
 * The roof facts. With a plan, its main face (the one holding most panels)
 * gives the facing and pitch, so the facts and the drawing agree.
 */
function factsFor(
  quote: QuoteRecord,
  summary: RoofAssessmentSummary,
  plan: RoofPlan | null,
): ProposalRoof {
  const main = summary.roofPlanes.find((p) => p.id === summary.mainPlaneId) ?? null;
  const face = plan?.faces.find((f) => f.id === plan.mainFace.id) ?? null;
  const summaryFacing = summary.bestFacing
    ? (FACING[summary.bestFacing] ?? summary.bestFacing)
    : null;
  return {
    bestFacing: plan ? plan.mainFacing : summaryFacing,
    pitchDeg: face ? face.pitchDeg : (main?.pitchDeg ?? quote.basis.pitchDeg),
    usableRoofAreaM2: summary.usableRoofAreaM2,
    estimatedMaxPanels: summary.estimatedMaxPanels,
    reliable: summary.reliable,
    label: summary.reliable ? 'Good fit to the 3D data' : 'Low',
  };
}

/**
 * Everything the PDF needs for a stored quote: the option it is about, the
 * snapshot of the installer's settings, the customer, the roof, the logos and
 * the warranties fixed on the quote. Never fails for a missing logo or roof.
 */
export async function proposalDocFor(
  sources: ProposalSources,
  tenant: Tenant,
  quote: QuoteRecord,
  lead: LeadRecord | null,
  now: Date,
): Promise<ProposalDoc>;
export async function proposalDocFor(
  sources: ProposalSources,
  tenant: Tenant,
  quote: HeatPumpQuoteRecord,
  lead: LeadRecord | null,
  now: Date,
): Promise<HeatPumpProposalDoc>;
export async function proposalDocFor(
  sources: ProposalSources,
  tenant: Tenant,
  quote: StoredQuote,
  lead: LeadRecord | null,
  now: Date,
): Promise<AnyProposalDoc>;
export async function proposalDocFor(
  sources: ProposalSources,
  tenant: Tenant,
  quote: StoredQuote,
  lead: LeadRecord | null,
  now: Date,
): Promise<AnyProposalDoc> {
  if (!isSolarRecord(quote)) return heatPumpDocFor(sources, tenant, quote, lead, now);
  const { store, brandAssets, sunscan } = sources;
  const snapshot = snapshotOf(tenant, quote);
  const { option, chosen } = optionOf(quote);
  const conversation = await store.getConversation(tenant.id, quote.sessionId);
  const address = conversation?.answers?.['address'];
  const summary = await summaryFor(store, tenant, quote);
  const roofPlan = summary ? await planFor(sunscan, tenant, quote, summary, option) : null;
  const accreditationLogos = (
    await Promise.all(
      snapshot.accreditations.logoAssetIds.map((id) => asset(brandAssets, tenant.id, id)),
    )
  ).filter((b): b is Buffer => b !== null);
  const created = Date.parse(quote.createdAt);
  return {
    quote,
    option,
    chosen,
    others: quote.options.filter((o) => o.id !== option.id),
    snapshot,
    customer: {
      name: lead?.name ?? null,
      address: typeof address === 'string' && address.trim() !== '' ? address.trim() : null,
    },
    roofPlan,
    roofFacts: summary ? factsFor(quote, summary, roofPlan) : null,
    logo: await logoFor(brandAssets, tenant, snapshot),
    accreditationLogos,
    ...(quote.warranties ? { warranties: quote.warranties } : {}),
    generatedAt: now,
    reference: referenceFor(quote),
    validUntil: new Date((Number.isNaN(created) ? 0 : created) + snapshot.validityDays * DAY_MS),
  };
}

/**
 * The heat pump document: the same shared parts (snapshot, customer, logos,
 * dates) as a solar one, the option, and the visitor's current heating.
 */
async function heatPumpDocFor(
  sources: ProposalSources,
  tenant: Tenant,
  quote: HeatPumpQuoteRecord,
  lead: LeadRecord | null,
  now: Date,
): Promise<HeatPumpProposalDoc> {
  const { store, brandAssets } = sources;
  const snapshot = snapshotOf(tenant, quote);
  const { option, chosen } = optionOf(quote);
  const answers = (await store.getConversation(tenant.id, quote.sessionId))?.answers ?? {};
  const address = answers['address'];
  const accreditationLogos = (
    await Promise.all(
      snapshot.accreditations.logoAssetIds.map((id) => asset(brandAssets, tenant.id, id)),
    )
  ).filter((b): b is Buffer => b !== null);
  const created = Date.parse(quote.createdAt);
  return {
    kind: 'heat_pump',
    quote,
    option,
    chosen,
    currentFuel: fuelOf(answers['hp_current_heating']),
    snapshot,
    customer: {
      name: lead?.name ?? null,
      address: typeof address === 'string' && address.trim() !== '' ? address.trim() : null,
    },
    logo: await logoFor(brandAssets, tenant, snapshot),
    accreditationLogos,
    ...(quote.warranties ? { warranties: quote.warranties } : {}),
    generatedAt: now,
    reference: referenceFor(quote),
    validUntil: new Date((Number.isNaN(created) ? 0 : created) + snapshot.validityDays * DAY_MS),
  };
}

/** Render a stored quote's PDF: a solar proposal or a heat pump estimate. */
export async function proposalPdf(
  sources: ProposalSources,
  tenant: Tenant,
  quote: StoredQuote,
  lead: LeadRecord | null,
  now: Date,
): Promise<Buffer> {
  return renderProposal(await proposalDocFor(sources, tenant, quote, lead, now));
}

/**
 * A filename for the download: a solar proposal is named for the installer
 * and the quote; a heat pump estimate for the postcode.
 */
export function proposalFilename(tenant: Tenant, quote: StoredQuote): string {
  if (!isSolarRecord(quote)) {
    const postcode = quote.postcode
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return postcode ? `heat-pump-estimate-${postcode}.pdf` : 'heat-pump-estimate.pdf';
  }
  const company = tenant.config.companyName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${company || 'solar'}-proposal-${quote.id.slice(-8)}.pdf`;
}
