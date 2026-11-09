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
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createAuthenticator, requireMembership } from '../auth/index.js';
import { loadBrandAsset } from '../branding/meta.js';
import type { BrandAssetStore } from '../branding/store.js';
import type { MemberRole, Store } from '../store.js';
import type { TenantRegistry } from '../tenants.js';
import { brandAssetView, type BrandAssetView } from './branding.js';
import type { PortalConfig } from './portal-config.js';

export interface QuotationRouteDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
  brandAssets: BrandAssetStore;
}

export interface QuotationView {
  settings: QuotationSettings;
  saved: boolean;
  assets: { logo: BrandAssetView | null; accreditations: BrandAssetView[] };
}

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
    return { settings: current, saved: settings !== null, assets: { logo, accreditations } };
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
    const candidate =
      raw && typeof raw === 'object' ? { ...(raw as object), version: 0, updatedAt: '' } : raw;
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
}
