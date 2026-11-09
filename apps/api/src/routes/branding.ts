import {
  ApiError,
  BRAND_ASSET_ID,
  brandSchema,
  type Brand,
  type LogoEffect,
} from '@sunny/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { createAuthenticator, requireMembership } from '../auth/index.js';
import { brandingIds, pruneQuietly, type BrandAssetMeta } from '../branding/meta.js';
import { LogoImageError } from '../branding/image.js';
import { processLogo, type LogoKind } from '../branding/process.js';
import type { BrandAssetStore } from '../branding/store.js';
import type { RateLimitRule } from '../ratelimit.js';
import type { MemberRole, Store } from '../store.js';
import type { Tenant, TenantRegistry } from '../tenants.js';
import type { PortalConfig } from './portal-config.js';

export { loadBrandAsset, type BrandAssetMeta } from '../branding/meta.js';

/** The upload body may carry 3 MB of PNG as base64 (4 MB) plus the JSON around it. */
export const UPLOAD_BODY_LIMIT = 4.5 * 1024 * 1024;
const MAX_PNG_BYTES = 3 * 1024 * 1024;
/** Per installer. Processing is synchronous CPU work on a shared instance. */
const UPLOAD_RULE: RateLimitRule = { limit: 20, windowMs: 10 * 60_000 };

const COPY = {
  not_png: "That file isn't a PNG. Upload a PNG or SVG.",
  too_large: 'That image is too big. Use one under 2048 pixels on each side and 3 MB.',
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
  plate: 'light' | 'dark';
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
  enforceRateLimit: (
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    subject: string,
    rule: RateLimitRule,
  ) => void;
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
    // Uploads from before the chip existed have none recorded.
    plate: meta.plate ?? 'light',
    url: `${base}/${meta.id}.png`,
    maskUrl: meta.hasMask ? `${base}/${meta.id}-mask.png` : null,
  };
}

/**
 * The logo the widget draws, or undefined while the installer keeps the Sunny
 * character. A brand the widget's own schema would reject is left out, so the
 * visitor sees Sunny on purpose rather than the widget refusing a broken one.
 */
export function publicBrand(
  tenant: Tenant,
  log?: { warn: (obj: object, msg: string) => void },
): Brand | undefined {
  const branding = tenant.config.branding;
  if (!branding || branding.mode !== 'logo' || !branding.icon) return undefined;
  const { icon, wordmark } = branding;
  const base = `/v1/widget/brand/${tenant.publicId}`;
  const brand: Brand = {
    icon: {
      path: `${base}/${icon.id}.png`,
      maskPath: icon.hasMask ? `${base}/${icon.id}-mask.png` : null,
      width: icon.width,
      height: icon.height,
      outline: icon.outline,
    },
    wordmark: wordmark
      ? { path: `${base}/${wordmark.id}.png`, width: wordmark.width, height: wordmark.height }
      : null,
    effects: branding.effects,
    colors: branding.colors ??
      icon.suggestedColors ?? { primary: tenant.config.primaryColor, glow: '#FFFFFF' },
    plate: icon.plate ?? 'light',
  };
  const checked = brandSchema.safeParse(brand);
  if (checked.success) return checked.data;
  log?.warn(
    { tenantId: tenant.id, issues: checked.error.issues.map((i) => i.path.join('.')) },
    'stored brand fails brandSchema; serving Sunny',
  );
  return undefined;
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
    async (request, reply) => {
      const tenant = await member(request, 'admin');
      deps.enforceRateLimit(request, reply, 'brand-upload', tenant.id, UPLOAD_RULE);
      const { kind } = request.params as { kind: string };
      if (
        kind !== 'icon' &&
        kind !== 'wordmark' &&
        kind !== 'pdf-logo' &&
        kind !== 'accreditation'
      ) {
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
      // Uploads tried and never saved are cleared once they are a day old.
      const keep = brandingIds(tenant.config.branding, tenant.config.quotation).add(meta.id);
      await pruneQuietly(brandAssets, tenant.id, keep, deps.now(), request.log);
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
