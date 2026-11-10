/**
 * The sample quotation Studio previews: a synthetic quote for the bundled
 * sample house (assets/sample), priced from the installer's published list when
 * there is one and the demo list otherwise. Built in memory only. It is never
 * saved, never pins a brand asset, and never reads a real customer or lead.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { QuotationSettings } from '@sunny/contracts';
import type { QuoteAnswers, TenantPricing } from '@sunny/quote-engine';

import type { PriceList } from '../catalogue/price-list.js';
import type { Product } from '@sunny/contracts';
import { resolveFlow } from '../flow/resolve.js';
import { demoPricing } from '../journey/pricing.js';
import { buildQuote, type QuoteRecord } from '../journey/quote.js';
import type { Tenant } from '../tenants.js';

import { proposalDocFor, renderProposal, type ProposalSources } from './index.js';
import { reasonsFor } from './reasons.js';
import { roofPlanFor } from './roof-plan.js';
import { snapshotFor } from './snapshot.js';
import { warrantiesFor } from './warranties.js';

interface SampleFile {
  id: string;
  sessionId: string;
  createdAt: string;
  customer: { name: string; address: string };
  roof: { azimuthDeg: number; pitchDeg: number; maxPanels: number };
  answers: QuoteAnswers;
}

const dir = new URL('../../assets/sample/', import.meta.url);
const read = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(name, dir)), 'utf8'));

// Parsed once: every preview reuses them (the house is large to parse).
let cached: { file: SampleFile; spec: unknown } | undefined;
function sample() {
  cached ??= { file: read('quote.json') as SampleFile, spec: read('house.spec.json') };
  return cached;
}

const FACING = 'South';

export interface SampleInputs {
  sources: ProposalSources;
  tenant: Tenant;
  /** The settings to show: saved ones, or an unsaved draft. Undefined means the defaults. */
  settings: QuotationSettings | undefined;
  /** The installer's published list and the pricing built from it; null means the demo prices. */
  pricing: TenantPricing | null;
  priceList: PriceList | null;
  products: readonly Product[];
}

/** The sample quote and its PDF. The same inputs always give the same bytes. */
export async function samplePdf(inputs: SampleInputs): Promise<Buffer> {
  const { file, spec } = sample();
  const { sources, tenant, settings, priceList, products } = inputs;
  const quote: QuoteRecord = buildQuote({
    id: file.id,
    tenantId: tenant.id,
    sessionId: file.sessionId,
    createdAt: file.createdAt,
    answers: file.answers,
    roof: null,
    pricing: inputs.pricing ?? demoPricing(),
  });
  quote.quotation = snapshotFor(tenant, settings);
  quote.warranties = warrantiesFor(
    quote.options.flatMap((o) => o.lineItems),
    priceList,
    products,
  );
  // Why a couple of items are here, as the sample visitor's answers would give it.
  const flow = resolveFlow(null);
  const reasons: Record<string, string> = {};
  for (const option of quote.options) {
    Object.assign(reasons, reasonsFor([], flow, { lifestyle: 'evening_use' }, option));
  }
  quote.reasons = reasons;
  const doc = await proposalDocFor(sources, tenant, quote, null, new Date(file.createdAt));
  const panels = Math.min(doc.option.panelCount, file.roof.maxPanels);
  const roofPlan = roofPlanFor(spec, { panelCount: panels, reliable: true, sample: true });
  const face = roofPlan?.faces.find((f) => f.id === roofPlan.mainFace.id) ?? null;
  return renderProposal({
    ...doc,
    customer: { name: file.customer.name, address: file.customer.address },
    roofPlan,
    roofFacts: {
      bestFacing: roofPlan ? roofPlan.mainFacing : FACING,
      pitchDeg: face ? face.pitchDeg : file.roof.pitchDeg,
      usableRoofAreaM2: null,
      estimatedMaxPanels: file.roof.maxPanels,
      reliable: true,
      label: 'Sample roof',
    },
  });
}
