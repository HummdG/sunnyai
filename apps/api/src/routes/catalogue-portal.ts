import { timingSafeEqual } from 'node:crypto';

import { ApiError, PRODUCT_CATEGORIES, PRICE_STATUSES } from '@sunny/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createAuthenticator, requireMembership } from '../auth/index.js';
import { createAuditor } from '../audit.js';
import { geminiExtractor, type GeminiExtractor } from '../catalogue/extract.js';
import {
  CSV_TEMPLATE,
  VERSIONS_KEPT,
  approveDrafts,
  deleteProduct,
  discardUpload,
  editDraft,
  editProduct,
  exportCsv,
  loadState,
  previewUpload,
  productPatchSchema,
  publishUpload,
  rejectDrafts,
  rollback,
  withSources,
} from '../catalogue/service.js';
import {
  driveSheetReader,
  removeSheetSource,
  scanWebsite,
  setSheetSource,
  syncSheet,
  type SheetReader,
} from '../catalogue/sources.js';
import {
  discardPriceList,
  loadExample,
  publishExample,
  previewPriceList,
  priceListToCsv,
  publishPriceList,
  rollbackPriceList,
  updateSentinel,
} from '../catalogue/price-list-service.js';
import {
  PRICE_LIST_TEMPLATE,
  describePricing,
  sentinelSettingsSchema,
  type PriceList,
} from '../catalogue/price-list.js';
import type { CatalogueState } from '../catalogue/types.js';
import { serviceAccountTokens } from '../ingest/drive.js';
import type { MemberRole, Store } from '../store.js';
import type { Tenant, TenantRegistry } from '../tenants.js';
import type { PortalConfig } from './portal-config.js';

/**
 * The installer's product catalogue in the portal.
 *
 * Everything is under `/v1/portal/tenants/:tenantId/catalogue`, behind the same
 * sign-in and membership check as the rest of the portal (WS3's `auth/`):
 * viewers and sales can read, admins and owners can change. The chat reads
 * only what these routes *publish*; uploads, Sheet rows and website finds wait
 * here until someone approves them.
 */

export interface CataloguePortalDeps {
  store: Store;
  tenants: TenantRegistry;
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
  /** For the scheduler's `sync-due`; null disables it. */
  adminToken: string | null;
  env?: Record<string, string | undefined>;
  /** Test seams. Default to the real Drive export and Gemini when configured. */
  sheetReader?: SheetReader | null;
  gemini?: GeminiExtractor | null;
  fetch?: typeof fetch;
}

const uploadSchema = z.object({
  csv: z.string().min(1).max(4_000_000),
  mode: z.enum(['replace', 'append']).default('replace'),
  fileName: z.string().trim().max(200).nullable().optional(),
});
const idsSchema = z.object({ ids: z.array(z.string().min(1).max(80)).min(1).max(1000) });
const sheetSchema = z.object({
  url: z.string().trim().min(1).max(500),
  autoPublish: z.boolean().default(false),
});

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiError(
      'bad_request',
      `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`,
    );
  }
  return result.data as z.infer<S>;
}

function tokensMatch(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The summary the dashboard's Products page renders. */
async function view(store: Store, tenant: Tenant, state: CatalogueState) {
  const products = await store.listProducts(tenant.id);
  const pending = state.drafts.filter((d) => d.status === 'pending');
  return {
    version: state.currentVersion,
    products: withSources(products, state),
    counts: {
      products: products.length,
      byCategory: Object.fromEntries(
        PRODUCT_CATEGORIES.map((c) => [c, products.filter((p) => p.category === c).length]),
      ),
      byPriceStatus: Object.fromEntries(
        PRICE_STATUSES.map((s) => [s, products.filter((p) => p.priceStatus === s).length]),
      ),
      drafts: pending.length,
      draftsBySource: {
        sheet: pending.filter((d) => d.origin === 'sheet').length,
        website: pending.filter((d) => d.origin === 'website').length,
      },
    },
    pendingUpload: state.pendingUpload,
    sheet: state.sheet,
    versions: state.versions.slice(0, 50).map((v) => ({
      ...v,
      restorable:
        v.version >= state.currentVersion - VERSIONS_KEPT + 1 && v.version !== state.currentVersion,
    })),
  };
}

export function registerCataloguePortalRoutes(
  app: FastifyInstance,
  deps: CataloguePortalDeps,
): void {
  const { store, tenants, portal, now } = deps;
  const env = deps.env ?? process.env;
  const auth = createAuthenticator({
    portal,
    sessionSecret: deps.sessionSecret,
    now,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    store,
  });
  const auditor = createAuditor({ store, now });
  const iso = () => new Date(now()).toISOString();

  const serviceAccount = env['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'];
  const sheetReader: SheetReader | null =
    deps.sheetReader !== undefined
      ? deps.sheetReader
      : serviceAccount
        ? (() => {
            try {
              return driveSheetReader(serviceAccountTokens(serviceAccount), deps.fetch ?? fetch);
            } catch {
              return null;
            }
          })()
        : null;
  const gemini: GeminiExtractor | null =
    deps.gemini !== undefined
      ? deps.gemini
      : env['GEMINI_API_KEY']
        ? geminiExtractor({
            apiKey: env['GEMINI_API_KEY'],
            ...(env['GEMINI_MODEL'] ? { model: env['GEMINI_MODEL'] } : {}),
            ...(deps.fetch ? { fetch: deps.fetch } : {}),
          })
        : null;

  async function member(request: FastifyRequest, minimum: MemberRole) {
    const identity = await auth.identify(request.headers.authorization);
    const { tenantId } = request.params as { tenantId: string };
    await requireMembership(store, identity, tenantId, minimum);
    const tenant = tenants.byId(tenantId);
    if (!tenant) throw new ApiError('not_found', 'No such installer.');
    return { tenant, actor: { email: identity.email ?? identity.uid } };
  }

  /** Counts only, never content: what changed in the price list. */
  async function audit(
    tenant: Tenant,
    state: CatalogueState,
    detail: Record<string, number | boolean> = {},
  ) {
    await auditor.record({
      tenantId: tenant.id,
      actor: 'admin',
      action: 'catalogue.upload',
      target: { kind: 'catalogue', id: null },
      outcome: 'permitted',
      detail: { version: state.currentVersion, ...detail },
    });
  }

  const base = '/v1/portal/tenants/:tenantId/catalogue';

  app.get(base, async (request) => {
    const { tenant } = await member(request, 'viewer');
    const state = await loadState(store, tenant.id, iso());
    return {
      ...(await view(store, tenant, state)),
      capabilities: {
        sheet: sheetReader !== null,
        sheetReason:
          sheetReader === null
            ? 'Google Drive is not configured on this deployment (GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is unset).'
            : null,
        gemini: gemini !== null,
      },
    };
  });

  app.get(`${base}/template.csv`, async (request, reply) => {
    await member(request, 'viewer');
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="sunny-product-template.csv"');
    return CSV_TEMPLATE;
  });

  app.get(`${base}/export.csv`, async (request, reply) => {
    const { tenant } = await member(request, 'viewer');
    const products = await store.listProducts(tenant.id);
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="products.csv"');
    return exportCsv(products);
  });

  // ── upload → preview → publish ─────────────────────────────────────────

  app.post(`${base}/upload`, { bodyLimit: 5 * 1024 * 1024 }, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const body = parse(uploadSchema, request.body);
    const { upload } = await previewUpload(
      store,
      tenant.id,
      { csv: body.csv, mode: body.mode, fileName: body.fileName ?? null },
      actor,
      iso(),
    );
    return { upload };
  });

  app.post(`${base}/upload/:uploadId/publish`, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const { uploadId } = request.params as { uploadId: string };
    const state = await publishUpload(store, tenant.id, uploadId, actor, iso());
    await audit(tenant, state, { products: (await store.listProducts(tenant.id)).length });
    return view(store, tenant, state);
  });

  app.delete(`${base}/upload/:uploadId`, async (request) => {
    const { tenant } = await member(request, 'admin');
    const { uploadId } = request.params as { uploadId: string };
    const state = await discardUpload(store, tenant.id, uploadId, iso());
    return view(store, tenant, state);
  });

  // ── single products ────────────────────────────────────────────────────

  app.patch(`${base}/products/:productId`, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const { productId } = request.params as { productId: string };
    const patch = parse(productPatchSchema, request.body);
    const { state, product } = await editProduct(store, tenant.id, productId, patch, actor, iso());
    await audit(tenant, state, { edited: true });
    return { product, version: state.currentVersion };
  });

  app.delete(`${base}/products/:productId`, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const { productId } = request.params as { productId: string };
    const state = await deleteProduct(store, tenant.id, productId, actor, iso());
    await audit(tenant, state, { deleted: true });
    return view(store, tenant, state);
  });

  // ── versions ───────────────────────────────────────────────────────────

  app.post(`${base}/versions/:version/rollback`, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const version = Number((request.params as { version: string }).version);
    if (!Number.isInteger(version) || version < 1)
      throw new ApiError('bad_request', 'Bad version.');
    const state = await rollback(store, tenant.id, version, actor, iso());
    await audit(tenant, state, { rolledBackTo: version });
    return view(store, tenant, state);
  });

  // ── drafts from the Sheet and the website ──────────────────────────────

  app.get(`${base}/drafts`, async (request) => {
    const { tenant } = await member(request, 'viewer');
    const state = await loadState(store, tenant.id, iso());
    const products = await store.listProducts(tenant.id);
    return {
      drafts: state.drafts
        .filter((d) => d.status === 'pending')
        .map((d) => ({
          ...d,
          current: d.updatesProductId
            ? (products.find((p) => p.id === d.updatesProductId) ?? null)
            : null,
        })),
    };
  });

  app.patch(`${base}/drafts/:draftId`, async (request) => {
    const { tenant } = await member(request, 'admin');
    const { draftId } = request.params as { draftId: string };
    const draft = await editDraft(
      store,
      tenant.id,
      draftId,
      parse(productPatchSchema, request.body),
      iso(),
    );
    return { draft };
  });

  app.post(`${base}/drafts/approve`, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const { ids } = parse(idsSchema, request.body);
    const { state, approved } = await approveDrafts(store, tenant.id, ids, actor, iso());
    await audit(tenant, state, { approvedDrafts: approved });
    return { approved, ...(await view(store, tenant, state)) };
  });

  app.post(`${base}/drafts/reject`, async (request) => {
    const { tenant } = await member(request, 'admin');
    const { ids } = parse(idsSchema, request.body);
    const { rejected } = await rejectDrafts(store, tenant.id, ids, iso());
    return { rejected };
  });

  // ── Google Sheet source ────────────────────────────────────────────────

  app.put(`${base}/sheet`, async (request) => {
    const { tenant } = await member(request, 'admin');
    const body = parse(sheetSchema, request.body);
    const state = await setSheetSource(store, tenant.id, body, iso());
    const sync = await syncSheet(store, tenant.id, sheetReader, iso(), { force: true });
    return { sheet: (await loadState(store, tenant.id, iso())).sheet ?? state.sheet, sync };
  });

  app.delete(`${base}/sheet`, async (request) => {
    const { tenant } = await member(request, 'admin');
    await removeSheetSource(store, tenant.id, iso());
    return { removed: true };
  });

  app.post(`${base}/sheet/sync`, async (request) => {
    const { tenant } = await member(request, 'admin');
    const sync = await syncSheet(store, tenant.id, sheetReader, iso(), { force: true });
    if (sync.published)
      await audit(tenant, await loadState(store, tenant.id, iso()), { fromSheet: true });
    return { sync, sheet: (await loadState(store, tenant.id, iso())).sheet };
  });

  // ── website ────────────────────────────────────────────────────────────

  app.post(`${base}/website/scan`, async (request) => {
    const { tenant } = await member(request, 'admin');
    const scan = await scanWebsite(store, tenant.id, gemini, iso());
    return { scan };
  });

  // ── price list (quotes) ────────────────────────────────────────────────

  /** A list as the dashboard shows it: each item with a plain-English price. */
  const describe = (list: PriceList | null) =>
    list
      ? {
          ...list,
          items: list.items.map((item) => ({
            ...item,
            description: describePricing(item, list.currency),
          })),
        }
      : null;

  app.get(`${base}/price-list`, async (request) => {
    const { tenant } = await member(request, 'viewer');
    const state = await loadState(store, tenant.id, iso());
    const priceList = state.priceList;
    return {
      version: priceList?.version ?? 0,
      published: describe(priceList?.published ?? null),
      pending: priceList?.pending
        ? { ...priceList.pending, list: describe(priceList.pending.list) }
        : null,
      history: (priceList?.history ?? []).map(({ list: _list, ...meta }) => meta),
    };
  });

  app.get(`${base}/price-list/template.csv`, async (request, reply) => {
    await member(request, 'viewer');
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="sunny-price-list-template.csv"');
    return PRICE_LIST_TEMPLATE;
  });

  app.get(`${base}/price-list/export.csv`, async (request, reply) => {
    const { tenant } = await member(request, 'viewer');
    const published = (await loadState(store, tenant.id, iso())).priceList?.published ?? null;
    if (!published) throw new ApiError('not_found', 'No price list has been published yet.');
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="price-list.csv"');
    return priceListToCsv(published);
  });

  app.post(`${base}/price-list/upload`, { bodyLimit: 5 * 1024 * 1024 }, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const body = parse(uploadSchema.pick({ csv: true, fileName: true }), request.body);
    const pending = await previewPriceList(
      store,
      tenant.id,
      { csv: body.csv, fileName: body.fileName ?? null },
      actor,
      iso(),
    );
    return { pending: { ...pending, list: describe(pending.list) } };
  });

  app.post(`${base}/price-list/upload/:pendingId/publish`, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const { pendingId } = request.params as { pendingId: string };
    const next = await publishPriceList(store, tenant.id, pendingId, actor, iso());
    await audit(tenant, await loadState(store, tenant.id, iso()), {
      priceListVersion: next.version,
      priceItems: next.published?.items.length ?? 0,
    });
    return { version: next.version, published: describe(next.published) };
  });

  app.delete(`${base}/price-list/upload/:pendingId`, async (request) => {
    const { tenant } = await member(request, 'admin');
    const { pendingId } = request.params as { pendingId: string };
    await discardPriceList(store, tenant.id, pendingId, iso());
    return { discarded: true };
  });

  app.post(`${base}/price-list/versions/:version/rollback`, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const version = Number((request.params as { version: string }).version);
    if (!Number.isInteger(version) || version < 1)
      throw new ApiError('bad_request', 'Bad version.');
    const next = await rollbackPriceList(store, tenant.id, version, actor, iso());
    await audit(tenant, await loadState(store, tenant.id, iso()), {
      priceListRolledBackTo: version,
    });
    return { version: next.version, published: describe(next.published) };
  });

  /**
   * The Sentinel optimisation uplift: set it up, change it, or switch it off
   * (null). Publishes a new price-list version, so it shows in the history and
   * rolls back like any other change.
   */
  app.put(`${base}/price-list/sentinel`, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const body = parse(z.object({ sentinel: sentinelSettingsSchema.nullable() }), request.body);
    const next = await updateSentinel(store, tenant.id, body.sentinel, actor, iso());
    await audit(tenant, await loadState(store, tenant.id, iso()), {
      priceListVersion: next.version,
      sentinelEnabled: body.sentinel?.enabled === true,
    });
    return { version: next.version, published: describe(next.published) };
  });

  /** Start from the HSEnergy example list: products and prices as previews to edit. */
  app.post(`${base}/example`, async (request) => {
    const { tenant, actor } = await member(request, 'admin');
    const { upload, priceList } = await loadExample(store, tenant.id, actor, iso());
    return {
      upload,
      priceList: { ...priceList, list: describe(priceList.list) },
    };
  });

  /**
   * Publish the HSEnergy example for one tenant (the demo seed). Admin token
   * only: an installer previews the example and publishes it themselves.
   */
  app.post('/v1/catalogue/example/publish', async (request) => {
    if (deps.adminToken === null) {
      throw new ApiError('not_enabled', 'Seeding is disabled (SUNNY_ADMIN_TOKEN is unset).');
    }
    const presented = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1] ?? null;
    if (!tokensMatch(presented, deps.adminToken)) {
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }
    const { tenantId } = parse(z.object({ tenantId: z.string().min(1).max(80) }), request.body);
    const tenant = tenants.byId(tenantId);
    if (!tenant) throw new ApiError('not_found', 'Unknown tenant.');
    const result = await publishExample(store, tenant.id, iso());
    await audit(tenant, await loadState(store, tenant.id, iso()), { seededExample: true });
    return result;
  });

  // ── scheduler ──────────────────────────────────────────────────────────

  /**
   * Re-read every Sheet and re-scan every website that is due. Cloud Scheduler
   * calls this beside `/v1/knowledge/sync-due` (website pages are refreshed by
   * the knowledge pipeline weekly; this reads what it stored).
   */
  app.post('/v1/catalogue/sync-due', async (request) => {
    if (deps.adminToken === null) {
      throw new ApiError('not_enabled', 'Scheduled sync is disabled (SUNNY_ADMIN_TOKEN is unset).');
    }
    const presented = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1] ?? null;
    if (!tokensMatch(presented, deps.adminToken)) {
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    }
    const results: Array<{ tenantId: string; sheet?: string; websiteDrafts?: number }> = [];
    for (const tenant of tenants.all) {
      const state = await store.getCatalogueState(tenant.id);
      const entry: { tenantId: string; sheet?: string; websiteDrafts?: number } = {
        tenantId: tenant.id,
      };
      if (state?.sheet) {
        const due =
          !state.sheet.lastSyncAt || now() - Date.parse(state.sheet.lastSyncAt) >= 15 * 60_000;
        if (due) entry.sheet = (await syncSheet(store, tenant.id, sheetReader, iso())).status;
      }
      const lastScan = state?.updatedAt ? Date.parse(state.updatedAt) : 0;
      if (!state || now() - lastScan >= 24 * 3_600_000) {
        entry.websiteDrafts = (await scanWebsite(store, tenant.id, gemini, iso())).drafts;
      }
      results.push(entry);
    }
    return { results };
  });
}
