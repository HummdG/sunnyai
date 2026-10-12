import { createHash } from 'node:crypto';

import { ApiError } from '@sunny/contracts';
import { importProducts, parseCsv } from '@sunny/solar-rules';

import type { TokenProvider } from '../ingest/drive.js';
import { newId, type Store } from '../store.js';
import {
  extractFromPage,
  extractWithGemini,
  looksLikeProductPage,
  type DraftCandidate,
  type GeminiExtractor,
} from './extract.js';
import { loadState, publish, setDrafts, type Actor } from './service.js';
import type { CatalogueSource, CatalogueState, SheetSource } from './types.js';

/**
 * The two non-upload ways products reach the catalogue: a Google Sheet the
 * installer keeps as their price list, and their own website.
 */

// ─── Google Sheet ────────────────────────────────────────────────────────────

/** Reads a Google Sheet as CSV. The real one uses the Drive export API. */
export interface SheetReader {
  exportCsv(fileId: string): Promise<string>;
}

/**
 * The Drive v3 export of a Sheet's first tab as CSV, with the same
 * service-account credentials the knowledge pipeline's Drive client uses
 * (`ingest/drive.ts`). The Sheet must be shared with that account, or sit in
 * the Drive folder already shared for knowledge.
 */
export function driveSheetReader(
  tokens: TokenProvider,
  doFetch: typeof fetch = fetch,
): SheetReader {
  return {
    async exportCsv(fileId) {
      const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fcsv`;
      const response = await doFetch(url, {
        headers: { authorization: `Bearer ${await tokens()}` },
      });
      if (response.status === 404) {
        throw new Error(
          'The Sheet was not found. Share it with Sunny (Viewer) or put it in your connected Drive folder.',
        );
      }
      if (!response.ok)
        throw new Error(`Google Drive returned HTTP ${response.status} for the Sheet.`);
      return await response.text();
    },
  };
}

/** A Sheet id from a link or a bare id. */
export function sheetFileId(input: string): string | null {
  const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/.exec(input);
  if (fromUrl) return fromUrl[1]!;
  return /^[A-Za-z0-9_-]{20,}$/.test(input.trim()) ? input.trim() : null;
}

export async function setSheetSource(
  store: Store,
  tenantId: string,
  input: { url: string; autoPublish: boolean },
  now: string,
): Promise<CatalogueState> {
  const fileId = sheetFileId(input.url);
  if (!fileId) throw new ApiError('bad_request', 'That is not a Google Sheets link.');
  const state = await loadState(store, tenantId, now);
  const sheet: SheetSource = {
    fileId,
    url: input.url,
    autoPublish: input.autoPublish,
    lastSyncAt: state.sheet?.fileId === fileId ? state.sheet.lastSyncAt : null,
    lastStatus: state.sheet?.fileId === fileId ? state.sheet.lastStatus : 'never',
    lastError: null,
    lastHash: state.sheet?.fileId === fileId ? state.sheet.lastHash : null,
  };
  const next = { ...state, sheet, updatedAt: now };
  await store.putCatalogueState(next);
  return next;
}

export async function removeSheetSource(
  store: Store,
  tenantId: string,
  now: string,
): Promise<CatalogueState> {
  const state = await loadState(store, tenantId, now);
  const next = {
    ...state,
    sheet: null,
    drafts: state.drafts.filter((d) => d.origin !== 'sheet'),
    updatedAt: now,
  };
  await store.putCatalogueState(next);
  return next;
}

export interface SheetSyncOutcome {
  status: SheetSource['lastStatus'];
  published: boolean;
  drafts: number;
  errors: number;
  message: string;
}

/**
 * Read the Sheet, validate it with the CSV importer, then either publish it
 * (opted in, zero errors) or offer its rows as drafts for approval. An
 * unchanged Sheet does nothing.
 */
export async function syncSheet(
  store: Store,
  tenantId: string,
  reader: SheetReader | null,
  now: string,
  options: { force?: boolean } = {},
): Promise<SheetSyncOutcome> {
  const state = await loadState(store, tenantId, now);
  const sheet = state.sheet;
  if (!sheet) throw new ApiError('not_found', 'No Google Sheet is set as your product list.');

  /** Record the sync's outcome on the Sheet source, leaving everything else as it stands. */
  const record = async (patch: Partial<SheetSource>) => {
    const latest = await loadState(store, tenantId, now);
    await store.putCatalogueState({
      ...latest,
      sheet: { ...(latest.sheet ?? sheet), lastSyncAt: now, ...patch },
      updatedAt: now,
    });
  };

  if (!reader) {
    const message =
      'Google Drive is not configured on this deployment (GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is unset), so the Sheet cannot be read.';
    await record({ lastStatus: 'failed', lastError: message });
    return { status: 'failed', published: false, drafts: 0, errors: 0, message };
  }

  let csv: string;
  try {
    csv = await reader.exportCsv(sheet.fileId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Sheet could not be read.';
    await record({ lastStatus: 'failed', lastError: message });
    return { status: 'failed', published: false, drafts: 0, errors: 0, message };
  }

  const hash = createHash('sha256').update(csv).digest('hex');
  if (!options.force && hash === sheet.lastHash) {
    await record({ lastStatus: 'unchanged', lastError: null });
    return {
      status: 'unchanged',
      published: false,
      drafts: 0,
      errors: 0,
      message: 'No changes since the last sync.',
    };
  }

  const parsed = parseCsv(csv);
  const imported = importProducts(parsed.rows, { tenantId, now, nextId: () => newId('prd') });
  const issues = [...parsed.issues, ...imported.issues];
  const errors = issues.filter((i) => i.severity === 'error').length;
  const sheetLink = `https://docs.google.com/spreadsheets/d/${sheet.fileId}`;

  if (sheet.autoPublish && errors === 0 && imported.products.length > 0) {
    const sources: Record<string, CatalogueSource> = {};
    for (const p of imported.products) sources[p.id] = 'sheet';
    const published = await publish(
      store,
      { ...state, drafts: state.drafts.filter((d) => d.origin !== 'sheet') },
      imported.products,
      {
        reason: 'sheet',
        actor: { email: 'system' },
        now,
        note: 'Published from your Google Sheet',
      },
      sources,
    );
    await store.putCatalogueState({
      ...published,
      sheet: {
        ...sheet,
        lastSyncAt: now,
        lastStatus: 'published',
        lastError: null,
        lastHash: hash,
      },
    });
    return {
      status: 'published',
      published: true,
      drafts: 0,
      errors: 0,
      message: `Published ${imported.products.length} products from your Sheet.`,
    };
  }

  const candidates: DraftCandidate[] = imported.products.map((product) => ({
    origin: 'sheet',
    sourceUrl: sheetLink,
    fieldSources: Object.fromEntries(
      ['category', 'manufacturer', 'model', 'powerW', 'capacityWh', 'priceMinor', 'warrantyYears']
        .filter((f) => product[f as keyof typeof product] !== null)
        .map((f) => [f, `${sheetLink} (row ${product.rowNumber ?? '?'})`]),
    ),
    extractor: 'sheet',
    product: { ...product, sourceRef: product.sourceRef ?? sheetLink, rowNumber: null },
    issues: issues.filter((i) => i.rowNumber === product.rowNumber),
  }));
  const { state: drafted, added } = await setDrafts(store, tenantId, 'sheet', candidates, now);
  await store.putCatalogueState({
    ...drafted,
    sheet: {
      ...sheet,
      lastSyncAt: now,
      lastStatus: 'drafted',
      lastError: errors > 0 ? `${errors} row${errors === 1 ? '' : 's'} could not be read.` : null,
      lastHash: hash,
    },
  });
  return {
    status: 'drafted',
    published: false,
    drafts: added,
    errors,
    message:
      added === 0
        ? 'The Sheet matches your published catalogue.'
        : `${added} product${added === 1 ? '' : 's'} from your Sheet are waiting for approval.`,
  };
}

// ─── website ─────────────────────────────────────────────────────────────────

export interface WebsiteScanOutcome {
  pagesScanned: number;
  productPages: number;
  drafts: number;
  skipped: number;
  usedGemini: boolean;
}

/**
 * Look through the tenant's crawled website pages for products and offer them
 * as drafts. Reads only the knowledge pipeline's stored pages; never fetches.
 */
export async function scanWebsite(
  store: Store,
  tenantId: string,
  gemini: GeminiExtractor | null,
  now: string,
): Promise<WebsiteScanOutcome> {
  const pages = (await store.listKnowledgeSources(tenantId)).filter(
    (s) => s.kind === 'website' && s.tenantId === tenantId,
  );
  const candidates: DraftCandidate[] = [];
  let skipped = 0;
  let productPages = 0;
  let usedGemini = false;
  for (const page of pages) {
    const input = { url: page.url ?? page.title, markdown: page.text, version: page.version };
    // Tables are read on every page: it is cheap and it is exact.
    const found = extractFromPage(input, tenantId, now, page.title);
    skipped += found.skipped;
    if (found.candidates.length > 0) {
      productPages += 1;
      candidates.push(...found.candidates);
      continue;
    }
    // The model is asked only about pages that read like product pages.
    if (!gemini || !looksLikeProductPage(page.text)) continue;
    productPages += 1;
    try {
      const viaModel = await extractWithGemini(input, gemini, tenantId, now);
      usedGemini = true;
      candidates.push(...viaModel.candidates);
      skipped += viaModel.skipped;
    } catch {
      // A model outage costs this page's suggestions, never the scan.
    }
  }
  const { added } = await setDrafts(store, tenantId, 'website', candidates, now);
  return { pagesScanned: pages.length, productPages, drafts: added, skipped, usedGemini };
}

export type { Actor };
