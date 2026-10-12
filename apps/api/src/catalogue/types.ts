import type { CatalogueIssue, Product } from '@sunny/contracts';

import type { PriceList, PriceListIssue } from './price-list.js';

/**
 * The installer's product catalogue as the portal manages it.
 *
 * Two stores, deliberately. The **published** catalogue is the one the chat
 * reads (`Store.listProducts`); nothing in this module's state is visible to a
 * visitor. Everything that is not yet the installer's decision -- an uploaded
 * file waiting for "Publish", products found on their website, a Google Sheet
 * that changed -- lives here, in `CatalogueState`, until someone approves it.
 * That separation is what makes "drafts never go live without approval" a
 * property of where data is kept rather than a flag every reader must check.
 */

/** Where a published product came from, for the Products table's source column. */
export const CATALOGUE_SOURCES = ['csv', 'sheet', 'website', 'manual'] as const;
export type CatalogueSource = (typeof CATALOGUE_SOURCES)[number];

/** One published version: what changed, when, by whom. Snapshots are stored separately. */
export interface CatalogueVersionMeta {
  version: number;
  publishedAt: string;
  /** The signed-in installer's email, or `system` for an opted-in auto-publish. */
  publishedBy: string;
  /** What produced it. */
  reason: 'upload' | 'sheet' | 'drafts' | 'edit' | 'delete' | 'rollback';
  productCount: number;
  note: string | null;
}

/** An uploaded file, read and validated, waiting for the installer to publish it. */
export interface PendingUpload {
  id: string;
  createdAt: string;
  createdBy: string;
  mode: 'replace' | 'append';
  fileName: string | null;
  products: Product[];
  issues: CatalogueIssue[];
  accepted: number;
  rejected: number;
  /** True when this is the HSEnergy example list, offered as a starting point to edit. */
  example?: boolean;
}

/**
 * A product found somewhere other than an upload, waiting for approval.
 *
 * Every field the extractor filled in records where it read it
 * (`fieldSources`), so the reviewer can check a figure against its page before
 * approving it. Extracted prices are `indicative` until the installer says
 * otherwise.
 */
export interface CatalogueDraftItem {
  id: string;
  origin: 'sheet' | 'website';
  /** The page or sheet the product was read from. */
  sourceUrl: string | null;
  /** Field name → the URL (or sheet cell range) it was read from. */
  fieldSources: Record<string, string>;
  /** `deterministic` (tables) or `gemini` (structured extraction). */
  extractor: 'deterministic' | 'gemini' | 'sheet';
  product: Product;
  /** A published product this would update (same manufacturer and model), or null for a new one. */
  updatesProductId: string | null;
  issues: CatalogueIssue[];
  status: 'pending' | 'rejected';
  createdAt: string;
}

/** A Google Sheet the installer designated as their product list. */
export interface SheetSource {
  fileId: string;
  url: string;
  /** Publish straight away when a sync has zero errors. Off by default. */
  autoPublish: boolean;
  lastSyncAt: string | null;
  lastStatus: 'never' | 'published' | 'drafted' | 'unchanged' | 'failed';
  lastError: string | null;
  /** Hash of the last CSV read, so an unchanged sheet does nothing. */
  lastHash: string | null;
}

export interface CatalogueState {
  tenantId: string;
  /** The version the published catalogue currently is; 0 before the first publish. */
  currentVersion: number;
  versions: CatalogueVersionMeta[];
  pendingUpload: PendingUpload | null;
  drafts: CatalogueDraftItem[];
  /** Normalised `manufacturer|model` keys the installer rejected, so they are not re-suggested. */
  rejectedKeys: string[];
  sheet: SheetSource | null;
  /** Published product id → where it came from. */
  productSources: Record<string, CatalogueSource>;
  /** The price list a quote is priced from (price-list.ts). Absent before the first upload. */
  priceList?: PriceListState;
  updatedAt: string;
}

export interface PendingPriceList {
  id: string;
  createdAt: string;
  createdBy: string;
  fileName: string | null;
  /** Null when the file had errors that stop it being published. */
  list: PriceList | null;
  issues: PriceListIssue[];
  itemCount: number;
  example: boolean;
}

export interface PriceListVersion {
  version: number;
  publishedAt: string;
  publishedBy: string;
  itemCount: number;
  note: string | null;
  list: PriceList;
}

export interface PriceListState {
  /** What quotes are priced from. Only `publishPriceList` changes it. */
  published: PriceList | null;
  version: number;
  pending: PendingPriceList | null;
  /** The last few published versions, newest first, for rollback. */
  history: PriceListVersion[];
}

export function emptyCatalogueState(tenantId: string, now: string): CatalogueState {
  return {
    tenantId,
    currentVersion: 0,
    versions: [],
    pendingUpload: null,
    drafts: [],
    rejectedKeys: [],
    sheet: null,
    productSources: {},
    updatedAt: now,
  };
}
