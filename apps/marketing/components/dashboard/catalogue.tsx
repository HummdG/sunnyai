'use client';

import type { SentinelView } from './sentinel.js';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { Chip } from './ui.js';

/** The catalogue as the portal API returns it (routes/catalogue-portal.ts). */

export const CATEGORIES = [
  'panel',
  'inverter',
  'battery',
  'ev_charger',
  'mounting',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];
export type PriceStatus = 'verified' | 'indicative' | 'unknown';
export type Source = 'csv' | 'sheet' | 'website' | 'manual';

export interface Product {
  id: string;
  category: Category;
  manufacturer: string;
  model: string;
  powerW: number | null;
  capacityWh: number | null;
  priceMinor: number | null;
  currency: string | null;
  priceStatus: PriceStatus;
  warrantyYears: number | null;
  sourceRef: string | null;
  sourceVersion: string | null;
  notes: string | null;
  rowNumber?: number | null;
  source?: Source;
}

export interface Issue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  rowNumber: number | null;
  column: string | null;
}

export interface PendingUpload {
  id: string;
  createdAt: string;
  mode: 'replace' | 'append';
  fileName: string | null;
  example?: boolean;
  products: Product[];
  issues: Issue[];
  accepted: number;
  rejected: number;
}

export interface SheetSource {
  fileId: string;
  url: string;
  autoPublish: boolean;
  lastSyncAt: string | null;
  lastStatus: 'never' | 'published' | 'drafted' | 'unchanged' | 'failed';
  lastError: string | null;
}

export interface Version {
  version: number;
  publishedAt: string;
  publishedBy: string;
  reason: 'upload' | 'sheet' | 'drafts' | 'edit' | 'delete' | 'rollback';
  productCount: number;
  note: string | null;
  restorable: boolean;
}

export interface CatalogueView {
  version: number;
  products: Product[];
  counts: {
    products: number;
    byCategory: Record<Category, number>;
    byPriceStatus: Record<PriceStatus, number>;
    drafts: number;
    draftsBySource: { sheet: number; website: number };
  };
  pendingUpload: PendingUpload | null;
  sheet: SheetSource | null;
  versions: Version[];
  capabilities?: { sheet: boolean; sheetReason: string | null; gemini: boolean };
}

export interface Draft {
  id: string;
  origin: 'sheet' | 'website';
  sourceUrl: string | null;
  fieldSources: Record<string, string>;
  extractor: 'deterministic' | 'gemini' | 'sheet';
  product: Product;
  updatesProductId: string | null;
  issues: Issue[];
  current: Product | null;
}

// ── formatting ─────────────────────────────────────────────────────────────

export const CATEGORY_LABEL: Record<Category, string> = {
  panel: 'Panel',
  inverter: 'Inverter',
  battery: 'Battery',
  ev_charger: 'EV charger',
  mounting: 'Mounting',
  other: 'Other',
};

export const SOURCE_LABEL: Record<Source, string> = {
  csv: 'CSV',
  sheet: 'Sheet',
  website: 'Website',
  manual: 'Manual',
};

export function price(p: Pick<Product, 'priceMinor' | 'currency'>): string {
  if (p.priceMinor === null) return '—';
  const value = p.priceMinor / 100;
  if (!p.currency) return value.toFixed(2);
  try {
    // Guidelines H3: £6,500 -- pence only below £100.
    const pence = value < 100 && p.priceMinor % 100 !== 0;
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: p.currency,
      minimumFractionDigits: pence ? 2 : 0,
      maximumFractionDigits: pence ? 2 : 0,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${p.currency}`;
  }
}

export function rating(p: Pick<Product, 'powerW' | 'capacityWh'>): string {
  const parts: string[] = [];
  if (p.powerW !== null) {
    parts.push(
      p.powerW >= 1000 ? `${(p.powerW / 1000).toLocaleString('en-GB')} kW` : `${p.powerW} W`,
    );
  }
  if (p.capacityWh !== null) parts.push(`${(p.capacityWh / 1000).toLocaleString('en-GB')} kWh`);
  return parts.join(' · ') || '—';
}

export function PriceStatusChip({ status }: { status: PriceStatus }) {
  if (status === 'verified') return <Chip tone="ok">Verified price</Chip>;
  if (status === 'indicative') return <Chip tone="orange">Indicative</Chip>;
  return <Chip>No price</Chip>;
}

/**
 * How the published price list prices a product that has no price of its own:
 * panels are priced through the PV table by panel count (with an uplift for
 * premium panels) and the standard inverters are included in that system
 * price. Null when the price list does not cover the product.
 */
export function priceListLabel(
  product: Pick<Product, 'model' | 'manufacturer'>,
  list: PriceListView | null,
): string | null {
  if (!list) return null;
  const model = product.model.trim().toLowerCase();
  const item = list.items.find(
    (i) => (i.model ?? '').trim().toLowerCase() === model || i.key.toLowerCase() === model,
  );
  if (!item) return null;
  const text = item.description.trim();
  if (text === 'Base price') return 'Included in the PV price (by panel count)';
  if (/^£?0(\.00)?$/.test(text.replace(/[^£0-9.]/g, ''))) return 'Included in the system price';
  if (text.startsWith('+')) return text;
  if (/ per panel$/.test(text)) return `${text} on top of the PV price`;
  return text;
}

export function SourceChip({ source }: { source: Source | undefined }) {
  return <Chip>{SOURCE_LABEL[source ?? 'manual']}</Chip>;
}

// ── sub-navigation ─────────────────────────────────────────────────────────

export function ProductsNav({ drafts }: { drafts: number | null }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement | null>(null);
  const [underline, setUnderline] = useState<React.CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const active = nav.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!active) return;
    setUnderline({ left: active.offsetLeft, width: active.offsetWidth, opacity: 1 });
  }, [pathname, drafts]);
  const tabs = [
    { href: '/dashboard/products', label: 'Products' },
    { href: '/dashboard/products/upload', label: 'Upload' },
    { href: '/dashboard/products/drafts', label: drafts ? `Drafts (${drafts})` : 'Drafts' },
    { href: '/dashboard/products/price-list', label: 'Price list' },
    { href: '/dashboard/products/history', label: 'History' },
  ];
  return (
    <nav className="tabs" aria-label="Products" ref={nav}>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
      {/* The underline slides between tabs with the brand's bounce (D3). */}
      <span className="tab-underline" aria-hidden="true" style={underline} />
    </nav>
  );
}

// ── editing one product ────────────────────────────────────────────────────

export interface ProductPatch {
  category?: Category;
  manufacturer?: string;
  model?: string;
  powerW?: number | null;
  capacityWh?: number | null;
  priceMinor?: number | null;
  currency?: string | null;
  priceStatus?: PriceStatus;
  warrantyYears?: number | null;
  sourceRef?: string | null;
  notes?: string | null;
}

function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * The product drawer: a modal dialog with the editable fields. Units are typed
 * the way installers read them (kW, kWh, pounds) and sent the way the API
 * stores them (W, Wh, pence).
 */
export function ProductEditor({
  product,
  title,
  fieldSources,
  onSave,
  onDelete,
  onClose,
  busy,
  error,
}: {
  product: Product;
  title: string;
  fieldSources?: Record<string, string>;
  onSave: (patch: ProductPatch) => void;
  onDelete?: () => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState<Category>(product.category);
  const [manufacturer, setManufacturer] = useState(product.manufacturer);
  const [model, setModel] = useState(product.model);
  const [powerKw, setPowerKw] = useState(
    product.powerW === null ? '' : String(product.powerW / 1000),
  );
  const [capacityKwh, setCapacityKwh] = useState(
    product.capacityWh === null ? '' : String(product.capacityWh / 1000),
  );
  const [amount, setAmount] = useState(
    product.priceMinor === null ? '' : (product.priceMinor / 100).toFixed(2),
  );
  const [currency, setCurrency] = useState(product.currency ?? 'GBP');
  const [status, setStatus] = useState<PriceStatus>(product.priceStatus);
  const [warranty, setWarranty] = useState(
    product.warrantyYears === null ? '' : String(product.warrantyYears),
  );
  const [sourceRef, setSourceRef] = useState(product.sourceRef ?? '');
  const [notes, setNotes] = useState(product.notes ?? '');

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const kw = numberOrNull(powerKw);
    const kwh = numberOrNull(capacityKwh);
    const pounds = numberOrNull(amount);
    const years = numberOrNull(warranty);
    onSave({
      category,
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      powerW: kw === null ? null : Math.round(kw * 1000),
      capacityWh: kwh === null ? null : Math.round(kwh * 1000),
      priceMinor: pounds === null ? null : Math.round(pounds * 100),
      currency: pounds === null ? null : currency.trim().toUpperCase() || null,
      priceStatus: pounds === null ? 'unknown' : status === 'unknown' ? 'indicative' : status,
      warrantyYears: years === null ? null : Math.round(years),
      sourceRef: sourceRef.trim() || null,
      notes: notes.trim() || null,
    });
  }

  const from = (field: string): ReactNode =>
    fieldSources?.[field] ? (
      <span className="hint">
        Read from{' '}
        <a href={fieldSources[field].split(' ')[0]} target="_blank" rel="noreferrer">
          {shortSource(fieldSources[field])}
        </a>
      </span>
    ) : null;

  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-labelledby="product-editor-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <form onSubmit={submit}>
        <header className="drawer-head">
          <h2 id="product-editor-title">{title}</h2>
          <button type="button" className="link-button" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <div className="drawer-body">
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              <span>Manufacturer</span>
              <input
                required
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              />
              {from('manufacturer')}
            </label>
            <label className="field">
              <span>Model</span>
              <input required value={model} onChange={(e) => setModel(e.target.value)} />
              {from('model')}
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Power (kW)</span>
              <input
                inputMode="decimal"
                value={powerKw}
                onChange={(e) => setPowerKw(e.target.value)}
              />
              {from('powerW')}
            </label>
            <label className="field">
              <span>Capacity (kWh)</span>
              <input
                inputMode="decimal"
                value={capacityKwh}
                onChange={(e) => setCapacityKwh(e.target.value)}
              />
              {from('capacityWh')}
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Price</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {from('priceMinor')}
            </label>
            <label className="field">
              <span>Currency</span>
              <input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </label>
          </div>
          <fieldset className="field">
            <legend>Price status</legend>
            <div className="pills" role="radiogroup">
              {(['verified', 'indicative'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="pill"
                  role="radio"
                  aria-checked={status === s}
                  aria-pressed={status === s}
                  onClick={() => setStatus(s)}
                >
                  {s === 'verified' ? 'Verified' : 'Indicative'}
                </button>
              ))}
            </div>
            <span className="hint">
              Verified means the price comes from your price list. It needs a source below.
            </span>
          </fieldset>
          <label className="field">
            <span>Source (price list, datasheet link)</span>
            <input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} />
          </label>
          <label className="field">
            <span>Warranty (years)</span>
            <input
              inputMode="numeric"
              value={warranty}
              onChange={(e) => setWarranty(e.target.value)}
            />
            {from('warrantyYears')}
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error ? (
            <p className="error-note" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <footer className="drawer-foot">
          {onDelete ? (
            <button type="button" className="button danger" disabled={busy} onClick={onDelete}>
              Remove product
            </button>
          ) : (
            <span />
          )}
          <div className="actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button" disabled={busy}>
              Save
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

export function shortSource(source: string): string {
  try {
    const url = new URL(source.split(' ')[0]!);
    const tail = url.hash ? ` (${url.hash.slice(1)})` : '';
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}${tail}`;
  } catch {
    return source;
  }
}

/** The issues from a file, one line each, errors first. */
export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  const sorted = [...issues].sort((a, b) =>
    a.severity === b.severity
      ? (a.rowNumber ?? 0) - (b.rowNumber ?? 0)
      : a.severity === 'error'
        ? -1
        : 1,
  );
  return (
    <ul className="issue-list">
      {sorted.map((issue, index) => (
        <li key={index} className={issue.severity}>
          <Chip tone={issue.severity === 'error' ? 'danger' : 'orange'}>
            {issue.severity === 'error' ? 'Not imported' : 'Warning'}
          </Chip>
          <span>
            {issue.rowNumber ? <strong>Row {issue.rowNumber}: </strong> : null}
            {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── price list ─────────────────────────────────────────────────────────────

export interface PriceItemView {
  key: string;
  category: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  mandatory: boolean;
  priceStatus: 'verified' | 'indicative';
  exclusiveGroup: string | null;
  notes: string | null;
  description: string;
  expansion: {
    sku: string | null;
    perUnitMinor: number;
    capacityWh: number | null;
    maxUnits: number | null;
  } | null;
  additionalUnitDiscountMinor: number | null;
}

export interface PriceListView {
  currency: string;
  vatRatePercent: number | null;
  pricesIncludeVat: boolean | null;
  sourceRef: string | null;
  sourceVersion: string | null;
  items: PriceItemView[];
  budgetBands: Array<{ id: string; label: string; minMinor: number; maxMinor: number | null }>;
  /** The optional Sentinel optimisation uplift (components/dashboard/sentinel.tsx). */
  sentinel?: SentinelView | null;
}

export interface PriceListIssue {
  severity: 'error' | 'warning';
  message: string;
  rowNumber: number | null;
  key: string | null;
}

export interface PendingPriceList {
  id: string;
  createdAt: string;
  fileName: string | null;
  list: PriceListView | null;
  issues: PriceListIssue[];
  itemCount: number;
  example: boolean;
}

export interface PriceListPage {
  version: number;
  published: PriceListView | null;
  pending: PendingPriceList | null;
  history: Array<{
    version: number;
    publishedAt: string;
    publishedBy: string;
    itemCount: number;
    note: string | null;
  }>;
}

export const PRICE_CATEGORY_LABEL: Record<string, string> = {
  pv: 'Solar PV system',
  panel_uplift: 'Panel options',
  mounting: 'Mounting',
  inverter: 'Inverters',
  battery: 'Batteries',
  scaffold: 'Scaffolding',
  electrical: 'General & electrical',
  admin: 'Fees',
  optional: 'Optional extras',
  trenching: 'Cable trenching',
  other: 'Other',
};
