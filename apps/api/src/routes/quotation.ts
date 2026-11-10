/**
 * The portal routes behind Studio's "Your quotation" tab: read the installer's
 * quotation PDF settings (or the defaults) and save them. Every plan; admin and
 * owner edit, viewer reads. The version and time are the server's.
 */

import {
  ApiError,
  BRAND_ASSET_ID,
  defaultQuotationSettings,
  quotationSettingsSchema,
  type QuotationSettings,
} from '@sunny/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPublishedPriceList } from '../catalogue/price-list-service.js';
import { pricingFromPriceList } from '../journey/catalogue-pricing.js';
import { samplePdf } from '../proposal/sample.js';
import type { RateLimitRule } from '../ratelimit.js';

import { createAuthenticator, requireMembership } from '../auth/index.js';
import { loadBrandAsset } from '../branding/meta.js';
import type { BrandAssetStore } from '../branding/store.js';
import type { MemberRole, Store } from '../store.js';
import type { Tenant, TenantRegistry } from '../tenants.js';
import { DEFAULT_BRAND, readableAccent, readableRail } from '../proposal/layout.js';
import { brandAssetView, type BrandAssetView } from './branding.js';
import type { PortalConfig } from './portal-config.js';

export interface QuotationRouteDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
  brandAssets: BrandAssetStore;
  enforceRateLimit: (
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    subject: string,
    rule: RateLimitRule,
  ) => void;
}

/** Rendering a PDF is real work: 30 previews a minute per installer. */
const PREVIEW_RULE: RateLimitRule = { limit: 30, windowMs: 60_000 };

export interface QuotationView {
  settings: QuotationSettings;
  saved: boolean;
  assets: { logo: BrandAssetView | null; accreditations: BrandAssetView[] };
  /** The colours as the PDF will use them, and whether they were adjusted for legibility. */
  colourNotes: {
    rail: { hex: string; adjusted: boolean };
    accent: { hex: string; adjusted: boolean };
  };
}

/** Only a colour the installer chose can be "adjusted"; the brand colour is not theirs to fix. */
const noted = (r: { hex: string; adjusted: boolean }, chosen: string | null) => ({
  hex: r.hex,
  adjusted: chosen !== null && r.adjusted,
});

const MISSING_IMAGE = 'That image is no longer available. Upload it again.';

export function registerQuotationRoutes(app: FastifyInstance, deps: QuotationRouteDeps): void {
  const { store, tenants, brandAssets } = deps;
  const auth = createAuthenticator({
    portal: deps.portal,
    sessionSecret: deps.sessionSecret,
    now: deps.now,
    store,
  });

  async function member(request: FastifyRequest, minimum: MemberRole) {
    const identity = await auth.identify(request.headers.authorization);
    const { tenantId } = request.params as { tenantId: string };
    await requireMembership(store, identity, tenantId, minimum);
    const tenant = tenants.byId(tenantId);
    if (!tenant) throw new ApiError('not_found', 'No such installer.');
    return tenant;
  }

  /** The stored settings, or null when none are saved or they no longer parse. */
  function stored(config: { quotation?: unknown }): QuotationSettings | null {
    if (config.quotation == null) return null;
    const parsed = quotationSettingsSchema.safeParse(config.quotation);
    return parsed.success ? parsed.data : null;
  }

  async function assetView(tenantId: string, id: string): Promise<BrandAssetView | null> {
    if (!BRAND_ASSET_ID.test(id)) return null;
    const meta = await loadBrandAsset(brandAssets, tenantId, id);
    return meta ? brandAssetView(tenantId, meta) : null;
  }

  async function view(
    tenantId: string,
    settings: QuotationSettings | null,
  ): Promise<QuotationView> {
    const current = settings ?? defaultQuotationSettings();
    const logo = current.logoAssetId ? await assetView(tenantId, current.logoAssetId) : null;
    const accreditations: BrandAssetView[] = [];
    for (const id of current.accreditations.logoAssetIds) {
      const asset = await assetView(tenantId, id);
      if (asset) accreditations.push(asset);
    }
    const brand = tenants.byId(tenantId)?.config.primaryColor ?? DEFAULT_BRAND;
    return {
      settings: current,
      saved: settings !== null,
      assets: { logo, accreditations },
      colourNotes: {
        rail: noted(readableRail(current.colours.rail ?? brand), current.colours.rail),
        accent: noted(readableAccent(current.colours.accent ?? brand), current.colours.accent),
      },
    };
  }

  app.get('/v1/portal/tenants/:tenantId/quotation', async (request) => {
    const tenant = await member(request, 'viewer');
    return view(tenant.id, stored(tenant.config));
  });

  app.put('/v1/portal/tenants/:tenantId/quotation', async (request) => {
    const tenant = await member(request, 'admin');
    const raw = (request.body as { settings?: unknown } | null)?.settings;
    // The version and time are the server's: whatever the client sent is
    // replaced with placeholders so the one shared schema validates the rest.
    const candidate = raw && typeof raw === 'object' ? { ...raw, version: 0, updatedAt: '' } : raw;
    const body = quotationSettingsSchema.safeParse(candidate);
    if (!body.success) {
      throw new ApiError(
        'bad_request',
        'Those quotation settings are not valid. Check each field.',
      );
    }
    const input = body.data;
    const ids = [
      ...(input.logoAssetId ? [input.logoAssetId] : []),
      ...input.accreditations.logoAssetIds,
    ];
    for (const id of ids) {
      if (!(await assetView(tenant.id, id))) throw new ApiError('bad_request', MISSING_IMAGE);
    }
    // Applied to the tenant as the store holds it now, so a save made elsewhere
    // is not undone and the version counts on from what is actually stored.
    const written: { settings: QuotationSettings | null } = { settings: null };
    const saved = await tenants.update(tenant.id, (current) => {
      const settings: QuotationSettings = {
        ...input,
        version: (stored(current.config)?.version ?? 0) + 1,
        updatedAt: new Date(deps.now()).toISOString(),
      };
      written.settings = settings;
      return { ...current, config: { ...current.config, quotation: settings } };
    });
    if (!saved) throw new ApiError('not_found', 'No such installer.');
    return view(tenant.id, written.settings);
  });

  /**
   * The sample quotation as a PDF: the sample house priced from the installer's
   * published list (demo prices when there is none). An image the installer
   * does not hold (an unsaved draft naming a deleted upload) is left out
   * rather than refused.
   */
  async function sample(
    tenant: Tenant,
    settings: QuotationSettings | null,
    reply: FastifyReply,
  ): Promise<Buffer> {
    let shown = settings ?? undefined;
    if (shown) {
      const held = async (id: string) => (await assetView(tenant.id, id)) !== null;
      const accreditations = [];
      for (const id of shown.accreditations.logoAssetIds) {
        if (await held(id)) accreditations.push(id);
      }
      shown = {
        ...shown,
        logoAssetId:
          shown.logoAssetId && (await held(shown.logoAssetId)) ? shown.logoAssetId : null,
        accreditations: { ...shown.accreditations, logoAssetIds: accreditations },
      };
    }
    const [priceList, products] = await Promise.all([
      getPublishedPriceList(store, tenant.id),
      store.listProducts(tenant.id).catch(() => []),
    ]);
    const pricing = priceList ? (pricingFromPriceList(priceList)?.pricing ?? null) : null;
    const pdf = await samplePdf({
      sources: { store, brandAssets, sunscan: null },
      tenant,
      settings: shown,
      pricing,
      priceList,
      products,
    });
    reply.header('cache-control', 'no-store');
    return pdf;
  }

  app.post('/v1/portal/tenants/:tenantId/quotation/preview', async (request, reply) => {
    const tenant = await member(request, 'viewer');
    deps.enforceRateLimit(request, reply, 'quotation-preview', tenant.id, PREVIEW_RULE);
    const raw = (request.body as { settings?: unknown } | null)?.settings;
    const candidate = raw && typeof raw === 'object' ? { ...raw, version: 0, updatedAt: '' } : raw;
    const parsed = quotationSettingsSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ApiError(
        'bad_request',
        'Those quotation settings are not valid. Check each field.',
      );
    }
    const pdf = await sample(tenant, parsed.data, reply);
    return reply.type('application/pdf').send(pdf);
  });

  app.get('/v1/portal/tenants/:tenantId/quotation/sample.pdf', async (request, reply) => {
    const tenant = await member(request, 'viewer');
    deps.enforceRateLimit(request, reply, 'quotation-preview', tenant.id, PREVIEW_RULE);
    const pdf = await sample(tenant, stored(tenant.config), reply);
    const company = tenant.config.companyName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return reply
      .type('application/pdf')
      .header(
        'content-disposition',
        `attachment; filename="${company || 'solar'}-sample-quotation.pdf"`,
      )
      .send(pdf);
  });
}
