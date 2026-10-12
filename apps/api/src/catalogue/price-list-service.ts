import { ApiError } from '@sunny/contracts';

import { newId, type Store } from '../store.js';
import {
  HSENERGY_PRICE_LIST_CSV,
  HSENERGY_PRODUCTS_CSV,
  HSENERGY_SOURCE,
  HSENERGY_VERSION,
} from './examples/hsenergy.js';
import type { PRICE_LIST_COLUMNS } from './price-list.js';
import {
  importPriceList,
  priceListCsv,
  sentinelRows,
  type PriceItem,
  type PriceList,
  type SentinelSettings,
} from './price-list.js';
import { loadState, previewUpload, publishUpload, type Actor } from './service.js';
import type { CatalogueState, PendingPriceList, PriceListState } from './types.js';

/**
 * The price list's lifecycle: upload → preview → publish, versioned, with
 * rollback -- the same shape as the product catalogue, kept in the same
 * workspace document. Quotes read only `published`.
 */

export const PRICE_LIST_VERSIONS_KEPT = 10;

function emptyPriceListState(): PriceListState {
  return { published: null, version: 0, pending: null, history: [] };
}

async function savePriceList(
  store: Store,
  state: CatalogueState,
  priceList: PriceListState,
  now: string,
): Promise<CatalogueState> {
  const next = { ...state, priceList, updatedAt: now };
  await store.putCatalogueState(next);
  return next;
}

/** The published price list a quote is priced from, or null. Tenant-scoped by the store. */
export async function getPublishedPriceList(
  store: Store,
  tenantId: string,
): Promise<PriceList | null> {
  return (await store.getCatalogueState(tenantId))?.priceList?.published ?? null;
}

export async function previewPriceList(
  store: Store,
  tenantId: string,
  input: {
    csv: string;
    fileName?: string | null;
    example?: boolean;
    sourceRef?: string | null;
    sourceVersion?: string | null;
  },
  actor: Actor,
  now: string,
): Promise<PendingPriceList> {
  const state = await loadState(store, tenantId, now);
  const imported = importPriceList(input.csv, {
    sourceRef: input.sourceRef ?? input.fileName ?? null,
    sourceVersion: input.sourceVersion ?? null,
  });
  const pending: PendingPriceList = {
    id: newId('ppl'),
    createdAt: now,
    createdBy: actor.email,
    fileName: input.fileName ?? null,
    list: imported.list,
    issues: imported.issues,
    itemCount: imported.itemCount,
    example: input.example ?? false,
  };
  await savePriceList(
    store,
    state,
    { ...(state.priceList ?? emptyPriceListState()), pending },
    now,
  );
  return pending;
}

export async function publishPriceList(
  store: Store,
  tenantId: string,
  pendingId: string,
  actor: Actor,
  now: string,
): Promise<PriceListState> {
  const state = await loadState(store, tenantId, now);
  const current = state.priceList ?? emptyPriceListState();
  const pending = current.pending;
  if (!pending || pending.id !== pendingId) {
    throw new ApiError('not_found', 'That price list is no longer waiting to be published.');
  }
  if (!pending.list) {
    throw new ApiError(
      'bad_request',
      'That file has errors that stop it being used for quotes; fix them first.',
    );
  }
  return publishList(
    store,
    state,
    pending.list,
    actor,
    now,
    pending.example ? 'HSEnergy example list' : pending.fileName,
  );
}

async function publishList(
  store: Store,
  state: CatalogueState,
  list: PriceList,
  actor: Actor,
  now: string,
  note: string | null,
): Promise<PriceListState> {
  const current = state.priceList ?? emptyPriceListState();
  const version = current.version + 1;
  const next: PriceListState = {
    published: list,
    version,
    pending: null,
    history: [
      {
        version,
        publishedAt: now,
        publishedBy: actor.email,
        itemCount: list.items.length,
        note,
        list,
      },
      ...current.history,
    ].slice(0, PRICE_LIST_VERSIONS_KEPT),
  };
  await savePriceList(store, state, next, now);
  return next;
}

export async function discardPriceList(
  store: Store,
  tenantId: string,
  pendingId: string,
  now: string,
): Promise<PriceListState> {
  const state = await loadState(store, tenantId, now);
  const current = state.priceList ?? emptyPriceListState();
  if (!current.pending || current.pending.id !== pendingId) {
    throw new ApiError('not_found', 'That price list is no longer waiting to be published.');
  }
  const next = { ...current, pending: null };
  await savePriceList(store, state, next, now);
  return next;
}

export async function rollbackPriceList(
  store: Store,
  tenantId: string,
  version: number,
  actor: Actor,
  now: string,
): Promise<PriceListState> {
  const state = await loadState(store, tenantId, now);
  const entry = state.priceList?.history.find((h) => h.version === version);
  if (!entry) throw new ApiError('not_found', 'That price list version is not kept any more.');
  return publishList(store, state, entry.list, actor, now, `Restored version ${version}`);
}

/**
 * Offer the HSEnergy example as a starting point: both the products and the
 * price list land as *pending previews*, labelled as an example, for the
 * installer to edit and publish. Nothing goes live from this call.
 */
export async function loadExample(store: Store, tenantId: string, actor: Actor, now: string) {
  const { upload } = await previewUpload(
    store,
    tenantId,
    {
      csv: HSENERGY_PRODUCTS_CSV,
      mode: 'replace',
      fileName: 'HSEnergy example products (edit before publishing)',
    },
    actor,
    now,
  );
  const state = await loadState(store, tenantId, now);
  if (state.pendingUpload) {
    await store.putCatalogueState({
      ...state,
      pendingUpload: { ...state.pendingUpload, example: true },
    });
  }
  const priceList = await previewPriceList(
    store,
    tenantId,
    {
      csv: HSENERGY_PRICE_LIST_CSV,
      fileName: 'HSEnergy example price list (edit before publishing)',
      example: true,
      sourceRef: HSENERGY_SOURCE,
      sourceVersion: HSENERGY_VERSION,
    },
    actor,
    now,
  );
  return { upload: { ...upload, example: true }, priceList };
}

// ─── export ──────────────────────────────────────────────────────────────────

type Row = Partial<Record<(typeof PRICE_LIST_COLUMNS)[number], string | number | null>>;

function money(minor: number | null | undefined): string | null {
  return minor === null || minor === undefined ? null : (minor / 100).toFixed(2);
}

function itemRows(item: PriceItem, currency: string): Row[] {
  const base: Row = {
    Category: item.category,
    Key: item.key,
    Name: item.name,
    Manufacturer: item.manufacturer,
    Model: item.model,
    Mandatory: item.mandatory ? 'yes' : null,
    'Price status': item.priceStatus === 'indicative' ? 'indicative' : null,
    'Exclusive group': item.exclusiveGroup,
    'Expansion SKU': item.expansion?.sku ?? null,
    'Expansion price': money(item.expansion?.perUnitMinor),
    'Expansion capacity (kWh)': item.expansion?.capacityWh
      ? item.expansion.capacityWh / 1000
      : null,
    'Max units': item.expansion?.maxUnits ?? null,
    'Additional unit discount': money(item.additionalUnitDiscountMinor),
    'Capacity (kWh)': item.capacityWh === null ? null : item.capacityWh / 1000,
    'Power (kW)': item.powerW === null ? null : item.powerW / 1000,
    Currency: currency,
    Notes: item.notes,
  };
  const p = item.pricing;
  switch (p.kind) {
    case 'flat':
      return [{ ...base, Pricing: 'flat', Amount: money(p.amountMinor) }];
    case 'per_unit':
      return [
        {
          ...base,
          Pricing: 'per_unit',
          Amount: money(p.amountMinor),
          Unit: p.unit,
          'Flat fee': p.flatMinor ? money(p.flatMinor) : null,
        },
      ];
    case 'percent_uplift':
      return [{ ...base, Pricing: 'percent', Percent: p.percent }];
    case 'table':
      return p.rows.map((r) => ({
        ...base,
        Pricing: 'table',
        From: r.quantity,
        Amount: money(r.amountMinor),
        Notes: r.label ?? base.Notes,
      }));
    case 'tiered':
      return p.tiers.map((t) => ({
        ...base,
        Pricing: 'tier',
        Unit: p.unit,
        From: t.from,
        To: t.to,
        Amount: t.bespoke ? 'bespoke' : money(t.flatMinor),
        'Per unit': t.perUnitMinor ? money(t.perUnitMinor) : null,
        Counts: t.counts === 'above' ? 'above' : null,
        'Band SKU': t.sku,
      }));
    case 'install_context':
      return [
        {
          ...base,
          Pricing: 'with_solar',
          'Price with solar': money(p.withSolarMinor),
          'Price retrofit': money(p.retrofitMinor),
        },
      ];
    case 'quote_only':
      return [{ ...base, Pricing: 'quote_only' }];
  }
}

/** The published list as a CSV that re-imports to the same list. */
export function priceListToCsv(list: PriceList): string {
  const rows: Row[] = [];
  if (list.vatRatePercent !== null) {
    rows.push({
      Category: 'vat',
      Key: 'VAT',
      Name: 'VAT rate',
      Pricing: 'vat',
      Percent: list.vatRatePercent,
      'Prices include VAT':
        list.pricesIncludeVat === null ? null : list.pricesIncludeVat ? 'yes' : 'no',
    });
  }
  for (const item of list.items) rows.push(...itemRows(item, list.currency));
  for (const band of list.budgetBands) {
    rows.push({
      Category: 'budget_band',
      Key: band.id,
      Name: band.label,
      From: money(band.minMinor),
      To: money(band.maxMinor),
      Currency: list.currency,
    });
  }
  if (list.sentinel) rows.push(...sentinelRows(list.sentinel, list.currency));
  return priceListCsv(rows);
}

/**
 * Change only the Sentinel optimisation settings of the published list (or
 * switch it off with null). Publishes a new version so the change is in the
 * history and can be rolled back like any other.
 */
export async function updateSentinel(
  store: Store,
  tenantId: string,
  sentinel: SentinelSettings | null,
  actor: Actor,
  now: string,
): Promise<PriceListState> {
  const state = await loadState(store, tenantId, now);
  const published = state.priceList?.published;
  if (!published) {
    throw new ApiError('not_found', 'Publish a price list before setting up Sentinel.');
  }
  return publishList(
    store,
    state,
    { ...published, sentinel },
    actor,
    now,
    sentinel ? 'Sentinel settings updated' : 'Sentinel switched off',
  );
}

/**
 * Publish the HSEnergy example straight away, for the demo tenant (seed
 * script). An installer gets `loadExample` instead, which only previews.
 */
export async function publishExample(store: Store, tenantId: string, now: string) {
  const actor = { email: 'system' };
  const { upload, priceList } = await loadExample(store, tenantId, actor, now);
  const catalogue = await publishUpload(store, tenantId, upload.id, actor, now);
  const prices = await publishPriceList(store, tenantId, priceList.id, actor, now);
  return {
    productVersion: catalogue.currentVersion,
    priceListVersion: prices.version,
    products: upload.accepted,
    priceItems: priceList.itemCount,
  };
}
