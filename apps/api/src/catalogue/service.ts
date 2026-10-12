import {
  ApiError,
  PRICE_STATUSES,
  PRODUCT_CATEGORIES,
  productSchema,
  type CatalogueIssue,
  type Product,
} from '@sunny/contracts';
import { importProducts, parseCsv } from '@sunny/solar-rules';
import { z } from 'zod';

import { newId, type Store } from '../store.js';
import {
  emptyCatalogueState,
  type CatalogueDraftItem,
  type CatalogueSource,
  type CatalogueState,
  type CatalogueVersionMeta,
  type PendingUpload,
} from './types.js';

/**
 * The catalogue workspace's operations, independent of HTTP.
 *
 * The one invariant everything here keeps: the published catalogue
 * (`store.saveProducts` / `listProducts`, which the chat reads) changes only in
 * `publish`, and only on an installer's explicit action -- or, for a Google
 * Sheet whose owner opted in, on a clean sync. Every publish is a numbered
 * version with a stored snapshot, so it can be rolled back.
 */

/** How many versions keep their full snapshot for rollback. Older ones keep only the metadata. */
export const VERSIONS_KEPT = 20;

export interface Actor {
  /** The signed-in installer's email, or `system`. */
  email: string;
}

export function productKey(p: Pick<Product, 'manufacturer' | 'model'>): string {
  const n = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${n(p.manufacturer)}|${n(p.model)}`;
}

export async function loadState(
  store: Store,
  tenantId: string,
  now: string,
): Promise<CatalogueState> {
  return (await store.getCatalogueState(tenantId)) ?? emptyCatalogueState(tenantId, now);
}

async function save(store: Store, state: CatalogueState, now: string): Promise<CatalogueState> {
  const next = { ...state, updatedAt: now };
  await store.putCatalogueState(next);
  return next;
}

/**
 * Make `products` the published catalogue, as a new version.
 *
 * `sources` records where each product came from; a product already published
 * keeps its recorded source unless a new one is given.
 */
export async function publish(
  store: Store,
  state: CatalogueState,
  products: readonly Product[],
  meta: { reason: CatalogueVersionMeta['reason']; actor: Actor; note?: string | null; now: string },
  sources: Record<string, CatalogueSource> = {},
): Promise<CatalogueState> {
  const tenantId = state.tenantId;
  // Never publish a row that names another tenant, whatever produced it.
  const rows = products.map((p) => productSchema.parse({ ...p, tenantId }));
  const saved = await store.saveProducts(tenantId, rows, 'replace');
  const version = state.currentVersion + 1;
  await store.putCatalogueSnapshot(tenantId, version, saved);

  const productSources: Record<string, CatalogueSource> = {};
  for (const p of saved) {
    productSources[p.id] = sources[p.id] ?? state.productSources[p.id] ?? 'manual';
  }
  const versions = [
    {
      version,
      publishedAt: meta.now,
      publishedBy: meta.actor.email,
      reason: meta.reason,
      productCount: saved.length,
      note: meta.note ?? null,
    },
    ...state.versions,
  ].slice(0, 200);
  return save(store, { ...state, currentVersion: version, versions, productSources }, meta.now);
}

// ─── uploads ─────────────────────────────────────────────────────────────────

/**
 * Read and validate an uploaded CSV, keep it as a pending upload, publish
 * nothing. The installer sees exactly what would go live, row issues included,
 * before choosing to publish.
 */
export async function previewUpload(
  store: Store,
  tenantId: string,
  input: { csv: string; mode: 'replace' | 'append'; fileName?: string | null },
  actor: Actor,
  now: string,
): Promise<{ state: CatalogueState; upload: PendingUpload }> {
  const state = await loadState(store, tenantId, now);
  const existing = input.mode === 'append' ? await store.listProducts(tenantId) : [];
  const parsed = parseCsv(input.csv);
  const imported = importProducts(parsed.rows, {
    tenantId,
    now,
    nextId: () => newId('prd'),
    existing,
  });
  const issues: CatalogueIssue[] = [...parsed.issues, ...imported.issues];
  // A structural failure (an unterminated quote) means the rest of the file is
  // untrustworthy: nothing from it can be published.
  const broken = parsed.issues.some((i) => i.severity === 'error');
  const products = broken ? [] : imported.products;
  const upload: PendingUpload = {
    id: newId('upl'),
    createdAt: now,
    createdBy: actor.email,
    mode: input.mode,
    fileName: input.fileName ?? null,
    products,
    issues,
    accepted: products.length,
    rejected: Math.max(0, parsed.rows.length - products.length),
  };
  const next = await save(store, { ...state, pendingUpload: upload }, now);
  return { state: next, upload };
}

export async function publishUpload(
  store: Store,
  tenantId: string,
  uploadId: string,
  actor: Actor,
  now: string,
): Promise<CatalogueState> {
  const state = await loadState(store, tenantId, now);
  const upload = state.pendingUpload;
  if (!upload || upload.id !== uploadId) {
    throw new ApiError('not_found', 'That upload is no longer waiting to be published.');
  }
  if (upload.products.length === 0) {
    throw new ApiError('bad_request', 'Nothing in that file can be published; fix the rows first.');
  }
  const existing = upload.mode === 'append' ? await store.listProducts(tenantId) : [];
  const sources: Record<string, CatalogueSource> = {};
  for (const p of upload.products) sources[p.id] = 'csv';
  const published = await publish(
    store,
    { ...state, pendingUpload: null },
    [...existing, ...upload.products],
    {
      reason: 'upload',
      actor,
      now,
      note: upload.example
        ? 'HSEnergy example list'
        : upload.fileName
          ? `${upload.mode === 'append' ? 'Added' : 'Replaced with'} ${upload.fileName}`
          : null,
    },
    sources,
  );
  return published;
}

export async function discardUpload(
  store: Store,
  tenantId: string,
  uploadId: string,
  now: string,
): Promise<CatalogueState> {
  const state = await loadState(store, tenantId, now);
  if (!state.pendingUpload || state.pendingUpload.id !== uploadId) {
    throw new ApiError('not_found', 'That upload is no longer waiting to be published.');
  }
  return save(store, { ...state, pendingUpload: null }, now);
}

// ─── single-product edits ────────────────────────────────────────────────────

/** The fields an installer may edit on one product. Everything else is provenance. */
export const productPatchSchema = z
  .object({
    category: z.enum(PRODUCT_CATEGORIES),
    manufacturer: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    powerW: z.number().int().positive().nullable(),
    capacityWh: z.number().int().positive().nullable(),
    priceMinor: z.number().int().nonnegative().nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    priceStatus: z.enum(PRICE_STATUSES),
    warrantyYears: z.number().int().nonnegative().nullable(),
    sourceRef: z.string().trim().min(1).max(500).nullable(),
    sourceVersion: z.string().trim().min(1).max(120).nullable(),
    imageUrl: z.string().trim().min(1).max(500).nullable(),
    notes: z.string().max(1000).nullable(),
  })
  .partial();

export type ProductPatch = z.infer<typeof productPatchSchema>;

/**
 * Apply a patch to a product, holding the catalogue's provenance rules:
 * a price is `verified` only with a source to point at, a priced row has a
 * currency, and an unpriced row's status is `unknown`.
 */
export function applyPatch(product: Product, patch: ProductPatch): Product {
  const next = { ...product, ...patch };
  if (next.priceMinor !== null && next.currency === null) {
    throw new ApiError('bad_request', 'A price needs a currency (e.g. GBP).');
  }
  if (next.priceMinor === null) {
    next.priceStatus = 'unknown';
  } else if (next.priceStatus === 'unknown') {
    next.priceStatus = 'indicative';
  }
  if (next.priceStatus === 'verified' && !next.sourceRef && !next.sourceVersion) {
    throw new ApiError(
      'bad_request',
      'A price can only be marked verified with a source to point at (a price list, a datasheet). Add the source first.',
    );
  }
  return productSchema.parse(next);
}

export async function editProduct(
  store: Store,
  tenantId: string,
  productId: string,
  patch: ProductPatch,
  actor: Actor,
  now: string,
): Promise<{ state: CatalogueState; product: Product }> {
  const state = await loadState(store, tenantId, now);
  const products = await store.listProducts(tenantId);
  const index = products.findIndex((p) => p.id === productId);
  if (index === -1) throw new ApiError('not_found', 'No such product in this catalogue.');
  const updated = applyPatch(products[index]!, patch);
  const clash = products.find(
    (p, i) =>
      i !== index && p.category === updated.category && productKey(p) === productKey(updated),
  );
  if (clash) {
    throw new ApiError(
      'bad_request',
      `${updated.manufacturer} ${updated.model} is already listed.`,
    );
  }
  const next = products.slice();
  next[index] = updated;
  const published = await publish(store, state, next, {
    reason: 'edit',
    actor,
    now,
    note: `Edited ${updated.manufacturer} ${updated.model}`,
  });
  return { state: published, product: updated };
}

export async function deleteProduct(
  store: Store,
  tenantId: string,
  productId: string,
  actor: Actor,
  now: string,
): Promise<CatalogueState> {
  const state = await loadState(store, tenantId, now);
  const products = await store.listProducts(tenantId);
  const target = products.find((p) => p.id === productId);
  if (!target) throw new ApiError('not_found', 'No such product in this catalogue.');
  return publish(
    store,
    state,
    products.filter((p) => p.id !== productId),
    { reason: 'delete', actor, now, note: `Removed ${target.manufacturer} ${target.model}` },
  );
}

export async function rollback(
  store: Store,
  tenantId: string,
  version: number,
  actor: Actor,
  now: string,
): Promise<CatalogueState> {
  const state = await loadState(store, tenantId, now);
  if (!state.versions.some((v) => v.version === version)) {
    throw new ApiError('not_found', 'No such catalogue version.');
  }
  if (version < state.currentVersion - VERSIONS_KEPT + 1) {
    throw new ApiError('bad_request', 'That version is too old to restore.');
  }
  const snapshot = await store.getCatalogueSnapshot(tenantId, version);
  if (!snapshot) throw new ApiError('not_found', 'That version has no stored snapshot.');
  return publish(store, state, snapshot, {
    reason: 'rollback',
    actor,
    now,
    note: `Restored version ${version}`,
  });
}

// ─── drafts (Sheet and website) ──────────────────────────────────────────────

/**
 * Replace the pending drafts of one origin with a new set.
 *
 * A candidate is dropped when the installer already rejected the same product,
 * or when the published catalogue already lists it with the same figures --
 * there is nothing to approve. One that differs becomes an update draft.
 */
export async function setDrafts(
  store: Store,
  tenantId: string,
  origin: CatalogueDraftItem['origin'],
  candidates: readonly Omit<
    CatalogueDraftItem,
    'id' | 'status' | 'createdAt' | 'updatesProductId'
  >[],
  now: string,
): Promise<{ state: CatalogueState; added: number }> {
  const state = await loadState(store, tenantId, now);
  const published = await store.listProducts(tenantId);
  const rejected = new Set(state.rejectedKeys);
  const kept = state.drafts.filter((d) => d.origin !== origin);
  const fresh: CatalogueDraftItem[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = productKey(candidate.product);
    if (rejected.has(key) || seen.has(key)) continue;
    seen.add(key);
    const match = published.find((p) => productKey(p) === key);
    if (match && sameFigures(match, candidate.product)) continue;
    fresh.push({
      ...candidate,
      id: newId('drf'),
      updatesProductId: match?.id ?? null,
      status: 'pending',
      createdAt: now,
    });
  }
  const next = await save(store, { ...state, drafts: [...kept, ...fresh] }, now);
  return { state: next, added: fresh.length };
}

function sameFigures(a: Product, b: Product): boolean {
  return (
    a.category === b.category &&
    a.powerW === b.powerW &&
    a.capacityWh === b.capacityWh &&
    a.priceMinor === b.priceMinor &&
    a.currency === b.currency &&
    a.warrantyYears === b.warrantyYears
  );
}

export async function editDraft(
  store: Store,
  tenantId: string,
  draftId: string,
  patch: ProductPatch,
  now: string,
): Promise<CatalogueDraftItem> {
  const state = await loadState(store, tenantId, now);
  const draft = state.drafts.find((d) => d.id === draftId && d.status === 'pending');
  if (!draft) throw new ApiError('not_found', 'No such draft.');
  const product = applyPatch(draft.product, patch);
  const updated: CatalogueDraftItem = {
    ...draft,
    product,
    // A field the installer typed is theirs now, not the page's.
    fieldSources: Object.fromEntries(
      Object.entries(draft.fieldSources).filter(([field]) => !(field in patch)),
    ),
  };
  await save(
    store,
    { ...state, drafts: state.drafts.map((d) => (d.id === draftId ? updated : d)) },
    now,
  );
  return updated;
}

/**
 * Approve drafts: each becomes a published product, updating the matching
 * product in place when there is one. One new version for the whole batch.
 */
export async function approveDrafts(
  store: Store,
  tenantId: string,
  draftIds: readonly string[],
  actor: Actor,
  now: string,
): Promise<{ state: CatalogueState; approved: number }> {
  const state = await loadState(store, tenantId, now);
  const wanted = new Set(draftIds);
  const chosen = state.drafts.filter((d) => wanted.has(d.id) && d.status === 'pending');
  if (chosen.length === 0) throw new ApiError('not_found', 'None of those drafts are pending.');
  const products = (await store.listProducts(tenantId)).slice();
  const sources: Record<string, CatalogueSource> = {};
  for (const draft of chosen) {
    const index = products.findIndex((p) => productKey(p) === productKey(draft.product));
    if (index >= 0) {
      const id = products[index]!.id;
      products[index] = { ...draft.product, id, tenantId, rowNumber: null };
      sources[id] = draft.origin;
    } else {
      const id = newId('prd');
      products.push({ ...draft.product, id, tenantId, rowNumber: null, createdAt: now });
      sources[id] = draft.origin;
    }
  }
  const remaining = state.drafts.filter((d) => !chosen.includes(d));
  const published = await publish(
    store,
    { ...state, drafts: remaining },
    products,
    {
      reason: 'drafts',
      actor,
      now,
      note: `Approved ${chosen.length} draft${chosen.length === 1 ? '' : 's'}`,
    },
    sources,
  );
  return { state: published, approved: chosen.length };
}

export async function rejectDrafts(
  store: Store,
  tenantId: string,
  draftIds: readonly string[],
  now: string,
): Promise<{ state: CatalogueState; rejected: number }> {
  const state = await loadState(store, tenantId, now);
  const wanted = new Set(draftIds);
  const chosen = state.drafts.filter((d) => wanted.has(d.id) && d.status === 'pending');
  if (chosen.length === 0) throw new ApiError('not_found', 'None of those drafts are pending.');
  const keys = new Set([...state.rejectedKeys, ...chosen.map((d) => productKey(d.product))]);
  const next = await save(
    store,
    {
      ...state,
      drafts: state.drafts.filter((d) => !chosen.includes(d)),
      rejectedKeys: [...keys].slice(-2000),
    },
    now,
  );
  return { state: next, rejected: chosen.length };
}

// ─── CSV export ──────────────────────────────────────────────────────────────

/** The template's columns: every one is a header the importer reads, so an export re-imports. */
export const CSV_COLUMNS = [
  'Category',
  'Manufacturer',
  'Model',
  'Power (W)',
  'Capacity (kWh)',
  'Price',
  'Currency',
  'Warranty (years)',
  'Source URL',
  'Source version',
  'Voc (V)',
  'Isc (A)',
  'Max DC power (W)',
  'Max string voltage (V)',
  'MPPT count',
  'Phase',
  'Hybrid',
  'Battery family',
  'Supported batteries',
  'Compatible inverters',
  'Documents',
  'Image URL',
  'Notes',
] as const;

/** Defuse spreadsheet formulas and quote a CSV field. */
function csvField(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function money(minor: number | null): string {
  return minor === null ? '' : (minor / 100).toFixed(2);
}

/**
 * Category as the importer reads it back. Its word list has "EV charger" but
 * not the enum spelling `ev_charger`, so the export writes the words.
 */
const CATEGORY_LABEL: Record<Product['category'], string> = {
  panel: 'panel',
  inverter: 'inverter',
  battery: 'battery',
  ev_charger: 'EV charger',
  mounting: 'mounting',
  other: 'other',
};

export function exportCsv(products: readonly Product[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const p of products) {
    const c = p.compatibility;
    const row = [
      CATEGORY_LABEL[p.category],
      p.manufacturer,
      p.model,
      p.powerW,
      p.capacityWh === null ? null : String(p.capacityWh / 1000),
      money(p.priceMinor),
      p.currency,
      p.warrantyYears,
      p.sourceRef,
      p.sourceVersion,
      c.vocV,
      c.iscA,
      c.maxDcPowerW,
      c.maxStringVoltageV,
      c.mpptCount,
      c.phase,
      c.hybrid === null ? null : c.hybrid ? 'yes' : 'no',
      c.batteryFamily,
      c.batteryFamilies?.join('; ') ?? null,
      c.inverterModels?.join('; ') ?? null,
      p.documentRefs.join('; ') || null,
      p.imageUrl,
      p.notes,
    ];
    lines.push(row.map(csvField).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Downloadable template: the columns and clearly-marked example rows. Kept identical to docs/templates. */
export const CSV_TEMPLATE = `${CSV_COLUMNS.join(',')}
panel,Aiko,AIKO-A450-MAH54Mw,450,,165.00,GBP,25,https://example.com/your-price-list,2026-10,37.6,14.6,,,,,,,,,,,EXAMPLE ROW - replace with your own products
inverter,GivEnergy,GIV-HY5.0,5000,,1150.00,GBP,12,https://example.com/your-price-list,2026-10,,,7500,550,2,1,yes,,GivEnergy,,,,EXAMPLE ROW - replace with your own products
battery,GivEnergy,GIV-BAT-9.5,,9.5,3400.00,GBP,12,https://example.com/your-price-list,2026-10,,,,,,,,GivEnergy,,GIV-HY5.0,,,EXAMPLE ROW - replace with your own products
EV charger,myenergi,ZAPPI-2H07UW,7000,,875.00,GBP,3,https://example.com/your-price-list,2026-10,,,,,,1,,,,,,,EXAMPLE ROW - replace with your own products
`;

/** Products with their source, for the Products table. */
export function withSources(
  products: readonly Product[],
  state: CatalogueState,
): Array<Product & { source: CatalogueSource }> {
  return products.map((p) => ({ ...p, source: state.productSources[p.id] ?? 'manual' }));
}
