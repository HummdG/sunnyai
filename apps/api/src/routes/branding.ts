import { ApiError, BRAND_ASSET_ID, type LogoEffect } from '@sunny/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createAuthenticator, requireMembership } from '../auth/index.js';
import type { BrandAssetMeta } from '../branding/meta.js';
import { LogoImageError } from '../branding/image.js';
import { processLogo, type LogoKind } from '../branding/process.js';
import type { BrandAssetStore } from '../branding/store.js';
import type { MemberRole, Store } from '../store.js';
import type { TenantRegistry } from '../tenants.js';
import type { PortalConfig } from './portal-config.js';

export { loadBrandAsset, type BrandAssetMeta } from '../branding/meta.js';

/** The upload body may carry 3 MB of PNG as base64 (4 MB) plus the JSON around it. */
export const UPLOAD_BODY_LIMIT = 4.5 * 1024 * 1024;
const MAX_PNG_BYTES = 3 * 1024 * 1024;

const COPY = {
  not_png: "That file isn't a PNG. Upload a PNG or SVG.",
  too_large: 'That image is too big. Use one under 4096 pixels on each side and 3 MB.',
  empty: 'That image looks empty.',
} as const;

export interface BrandAssetView {
  id: string;
  kind: LogoKind;
  width: number;
  height: number;
  outline: string | null;
  availableEffects: LogoEffect[];
  suggestedColors: { primary: string; glow: string } | null;
  url: string;
  maskUrl: string | null;
}

export interface BrandingRouteDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
  brandAssets: BrandAssetStore;
}

const FILE = /^([a-f0-9]{16})(-mask)?\.png$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function brandAssetView(tenantId: string, meta: BrandAssetMeta): BrandAssetView {
  const base = `/v1/portal/tenants/${encodeURIComponent(tenantId)}/brand/assets`;
  return {
    id: meta.id,
    kind: meta.kind,
    width: meta.width,
    height: meta.height,
    outline: meta.outline,
    availableEffects: meta.availableEffects,
    suggestedColors: meta.suggestedColors,
    url: `${base}/${meta.id}.png`,
    maskUrl: meta.hasMask ? `${base}/${meta.id}-mask.png` : null,
  };
}

function decodeUpload(body: unknown): Uint8Array {
  const png = (body as { png?: unknown } | null)?.png;
  if (typeof png !== 'string' || png.length === 0 || !BASE64.test(png)) {
    throw new ApiError('bad_request', COPY.not_png);
  }
  const bytes = Buffer.from(png, 'base64');
  if (bytes.length === 0) throw new ApiError('bad_request', COPY.not_png);
  if (bytes.length > MAX_PNG_BYTES) throw new ApiError('bad_request', COPY.too_large);
  return new Uint8Array(bytes);
}

export function registerBrandingRoutes(app: FastifyInstance, deps: BrandingRouteDeps): void {
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

  app.post(
    '/v1/portal/tenants/:tenantId/brand/:kind',
    { bodyLimit: UPLOAD_BODY_LIMIT },
    async (request) => {
      const tenant = await member(request, 'admin');
      const { kind } = request.params as { kind: string };
      if (kind !== 'icon' && kind !== 'wordmark') {
        throw new ApiError('not_found', 'No such logo slot.');
      }
      const bytes = decodeUpload(request.body);
      let processed;
      try {
        processed = processLogo(bytes, kind);
      } catch (error) {
        if (error instanceof LogoImageError) throw new ApiError('bad_request', COPY[error.code]);
        throw error;
      }
      const { png, maskPng, ...rest } = processed;
      const meta: BrandAssetMeta = { ...rest, hasMask: maskPng !== null };
      await brandAssets.put(tenant.id, `${meta.id}.png`, png);
      if (maskPng) await brandAssets.put(tenant.id, `${meta.id}-mask.png`, maskPng);
      await brandAssets.put(
        tenant.id,
        `${meta.id}.json`,
        new TextEncoder().encode(JSON.stringify(meta)),
      );
      return { asset: brandAssetView(tenant.id, meta) };
    },
  );

  // Studio previews an upload before it is saved, so any stored asset of the tenant is readable.
  app.get('/v1/portal/tenants/:tenantId/brand/assets/:file', async (request, reply) => {
    const tenant = await member(request, 'viewer');
    const { file } = request.params as { file: string };
    if (!FILE.test(file)) throw new ApiError('not_found', 'No such image.');
    const bytes = await brandAssets.get(tenant.id, file);
    if (!bytes) throw new ApiError('not_found', 'No such image.');
    reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=300');
    return Buffer.from(bytes);
  });

  // The widget loads the saved logo cross-origin, so only the tenant's live ids are served.
  app.get('/v1/widget/brand/:publicId/:file', async (request, reply) => {
    const { publicId, file } = request.params as { publicId: string; file: string };
    const match = FILE.exec(file);
    const tenant = tenants.byPublicId(publicId);
    const branding = tenant?.config.branding;
    if (!match || !tenant || !branding || branding.mode !== 'logo') {
      throw new ApiError('not_found', 'No such image.');
    }
    const id = match[1] as string;
    if (!BRAND_ASSET_ID.test(id) || (branding.icon?.id !== id && branding.wordmark?.id !== id)) {
      throw new ApiError('not_found', 'No such image.');
    }
    const bytes = await brandAssets.get(tenant.id, file);
    if (!bytes) throw new ApiError('not_found', 'No such image.');
    reply
      .header('content-type', 'image/png')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('access-control-allow-origin', '*')
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('x-content-type-options', 'nosniff');
    return Buffer.from(bytes);
  });
}
