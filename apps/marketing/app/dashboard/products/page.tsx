'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  CATEGORIES,
  CATEGORY_LABEL,
  PriceStatusChip,
  priceListLabel,
  ProductEditor,
  ProductsNav,
  SourceChip,
  price,
  rating,
  type CatalogueView,
  type Category,
  type PriceListPage,
  type PriceListView,
  type PriceStatus,
  type Product,
  type ProductPatch,
} from '../../../components/dashboard/catalogue.js';
import { EmptyState, SkeletonRows } from '../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import {
  Card,
  Chip,
  ErrorNote,
  errorText,
  formatDate,
  PageHeader,
  Stat,
} from '../../../components/dashboard/ui.js';
import { api, download, tenantPath } from '../../../lib/portal-api.js';

const SHEET_STATUS: Record<string, string> = {
  never: 'Not synced yet',
  published: 'Published',
  drafted: 'Changes waiting for approval',
  unchanged: 'Up to date',
  failed: 'Could not be read',
};

function Products() {
  const { tenant } = usePortal();
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';
  const [view, setView] = useState<CatalogueView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [status, setStatus] = useState<PriceStatus | 'all'>('all');
  const [editing, setEditing] = useState<Product | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [autoPublish, setAutoPublish] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [priceList, setPriceList] = useState<PriceListView | null>(null);

  useEffect(() => {
    api<PriceListPage>(tenantPath(tenant.id, '/catalogue/price-list'))
      .then((page) => setPriceList(page.published))
      .catch(() => setPriceList(null));
  }, [tenant.id]);

  const load = useCallback(() => {
    api<CatalogueView>(tenantPath(tenant.id, '/catalogue'))
      .then((next) => {
        setView(next);
        if (next.sheet) {
          setSheetUrl(next.sheet.url);
          setAutoPublish(next.sheet.autoPublish);
        }
      })
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id]);
  useEffect(load, [load]);

  // Products with no price of their own that the price list prices anyway
  // (panels by panel count, inverters included in the system price).
  const pricedByList = useMemo(
    () =>
      view?.products.filter(
        (p) => p.priceStatus === 'unknown' && priceListLabel(p, priceList) !== null,
      ).length ?? 0,
    [view, priceList],
  );

  const shown = useMemo(() => {
    if (!view) return [];
    const q = query.trim().toLowerCase();
    return view.products
      .filter((p) => category === 'all' || p.category === category)
      .filter((p) => status === 'all' || p.priceStatus === status)
      .filter((p) => !q || `${p.manufacturer} ${p.model}`.toLowerCase().includes(q))
      .sort((a, b) =>
        a.category === b.category
          ? `${a.manufacturer} ${a.model}`.localeCompare(`${b.manufacturer} ${b.model}`)
          : CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category),
      );
  }, [view, query, category, status]);

  async function run(work: () => Promise<unknown>, done?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
      load();
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(patch: ProductPatch) {
    if (!editing) return;
    setBusy(true);
    setEditError(null);
    try {
      await api(tenantPath(tenant.id, `/catalogue/products/${editing.id}`), {
        method: 'PATCH',
        body: patch,
      });
      setEditing(null);
      setNotice('Saved. Sunny is using the new details.');
      load();
    } catch (failure) {
      setEditError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    setEditError(null);
    try {
      await api(tenantPath(tenant.id, `/catalogue/products/${editing.id}`), { method: 'DELETE' });
      setEditing(null);
      setNotice('Removed. You can restore it from History.');
      load();
    } catch (failure) {
      setEditError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Products"
        lead="The panels, inverters, batteries and chargers you sell. Sunny recommends and prices only what is published here."
        actions={
          <>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                void download(tenantPath(tenant.id, '/catalogue/export.csv'), 'products.csv').catch(
                  (failure: unknown) => setError(errorText(failure)),
                )
              }
            >
              Export CSV
            </button>
            {canEdit ? (
              <Link className="button" href="/dashboard/products/upload">
                Upload products
              </Link>
            ) : null}
          </>
        }
      />
      <ProductsNav drafts={view?.counts.drafts ?? null} />
      <ErrorNote error={error} />
      {notice ? (
        <p className="ok-note" role="status">
          {notice}
        </p>
      ) : null}

      {view ? (
        <>
          {view.counts.drafts > 0 ? (
            <div className="banner">
              <span>
                <strong>
                  {view.counts.drafts} product{view.counts.drafts === 1 ? '' : 's'} waiting for
                  approval
                </strong>
                , found on your website or in your Sheet. Nothing goes live until you approve it.
              </span>
              <Link className="button secondary" href="/dashboard/products/drafts">
                Review drafts
              </Link>
            </div>
          ) : null}

          <div className="grid stats">
            <Stat
              label="Published products"
              value={view.counts.products}
              hint={`Version ${view.version}`}
            />
            <Stat label="Verified prices" value={view.counts.byPriceStatus.verified} />
            <Stat label="Indicative prices" value={view.counts.byPriceStatus.indicative} />
            <Stat
              label="No price"
              value={view.counts.byPriceStatus.unknown - pricedByList}
              {...(pricedByList > 0
                ? { hint: `${pricedByList} more priced by your price list` }
                : {})}
            />
          </div>

          <Card>
            {view.products.length === 0 ? (
              <div className="empty">
                <EmptyState
                  pose="shrug"
                  title="No products yet"
                  say="I can’t recommend what I can’t see. Show me your kit!"
                >
                  Upload a price list or start from the example. Recommendations need a product
                  list, so until then Sunny can’t suggest or price a system.
                </EmptyState>
                {canEdit ? (
                  <div className="actions">
                    <Link className="button" href="/dashboard/products/upload">
                      Upload a CSV
                    </Link>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(tenantPath(tenant.id, '/catalogue/example'), {
                            method: 'POST',
                          });
                          window.location.assign('/dashboard/products/upload');
                        })
                      }
                    >
                      Start from the HSEnergy example list
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        void download(
                          tenantPath(tenant.id, '/catalogue/template.csv'),
                          'sunny-product-template.csv',
                        ).catch((failure: unknown) => setError(errorText(failure)))
                      }
                    >
                      Download the template
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="filters">
                  <label className="field compact search">
                    <span className="sr-only">Search products</span>
                    <input
                      type="search"
                      placeholder="Search by brand or model"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div className="pills" role="group" aria-label="Category">
                    {(['all', ...CATEGORIES] as const)
                      .filter((c) => c === 'all' || view.counts.byCategory[c] > 0)
                      .map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="pill"
                          aria-pressed={category === c}
                          onClick={() => setCategory(c)}
                        >
                          {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
                          {c === 'all' ? null : (
                            <span className="pill-count">{view.counts.byCategory[c]}</span>
                          )}
                        </button>
                      ))}
                  </div>
                  <label className="field compact">
                    <span className="sr-only">Price status</span>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as PriceStatus | 'all')}
                    >
                      <option value="all">All prices</option>
                      <option value="verified">Verified</option>
                      <option value="indicative">Indicative</option>
                      <option value="unknown">No price</option>
                    </select>
                  </label>
                </div>
                <div className="table-wrap">
                  <table className="products-table">
                    <thead>
                      <tr>
                        <th scope="col">Product</th>
                        <th scope="col" className="hide-sm">
                          Category
                        </th>
                        <th scope="col">Rating</th>
                        <th scope="col">Price</th>
                        <th scope="col" className="hide-sm">
                          Warranty
                        </th>
                        <th scope="col" className="hide-sm">
                          Source
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {canEdit ? (
                              <button
                                type="button"
                                className="link-button product-name"
                                onClick={() => {
                                  setEditError(null);
                                  setEditing(p);
                                }}
                              >
                                <span className="muted">{p.manufacturer}</span> {p.model}
                              </button>
                            ) : (
                              <span className="product-name">
                                <span className="muted">{p.manufacturer}</span> {p.model}
                              </span>
                            )}
                          </td>
                          <td className="hide-sm">{CATEGORY_LABEL[p.category]}</td>
                          <td>{rating(p)}</td>
                          <td>
                            {p.priceStatus === 'unknown' && priceListLabel(p, priceList) ? (
                              <Link
                                className="price-via-list"
                                href="/dashboard/products/price-list"
                                title="Priced through your published price list"
                              >
                                {priceListLabel(p, priceList)}
                              </Link>
                            ) : (
                              <>
                                <span className="price">{price(p)}</span>{' '}
                                <PriceStatusChip status={p.priceStatus} />
                              </>
                            )}
                          </td>
                          <td className="hide-sm">
                            {p.warrantyYears === null ? '–' : `${p.warrantyYears} yrs`}
                          </td>
                          <td className="hide-sm">
                            <SourceChip source={p.source} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {shown.length === 0 ? <p className="muted pad">No products match.</p> : null}
                </div>
              </>
            )}
          </Card>

          <div className="grid two">
            <Card
              title={
                <>
                  Google Sheet{' '}
                  {view.sheet ? (
                    <Chip tone={view.sheet.lastStatus === 'failed' ? 'danger' : 'ok'}>
                      {SHEET_STATUS[view.sheet.lastStatus]}
                    </Chip>
                  ) : (
                    <Chip>Not connected</Chip>
                  )}
                </>
              }
            >
              <p className="muted" style={{ marginBottom: 12 }}>
                Keep your price list in a Google Sheet and Sunny checks it every 15 minutes. Use the
                same columns as the template. Changes wait for your approval unless you choose to
                publish clean updates automatically.
              </p>
              {view.capabilities && !view.capabilities.sheet ? (
                <p className="muted small" style={{ marginBottom: 12 }}>
                  Google Drive is not connected on this deployment yet, so the Sheet will be read
                  once it is.
                </p>
              ) : null}
              {view.sheet?.lastError ? <p className="error-note">{view.sheet.lastError}</p> : null}
              {view.sheet?.lastSyncAt ? (
                <p className="muted small" style={{ marginBottom: 12 }}>
                  Last checked {formatDate(view.sheet.lastSyncAt)}
                </p>
              ) : null}
              {canEdit ? (
                <form
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void run(
                      () =>
                        api(tenantPath(tenant.id, '/catalogue/sheet'), {
                          method: 'PUT',
                          body: { url: sheetUrl, autoPublish },
                        }),
                      'Sheet saved.',
                    );
                  }}
                >
                  <label className="field">
                    <span>Sheet link</span>
                    <input
                      required
                      placeholder="https://docs.google.com/spreadsheets/d/…"
                      value={sheetUrl}
                      onChange={(e) => setSheetUrl(e.target.value)}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={autoPublish}
                      onChange={(e) => setAutoPublish(e.target.checked)}
                    />
                    <span>Publish updates automatically when every row reads cleanly</span>
                  </label>
                  <div className="actions">
                    <button className="button" type="submit" disabled={busy}>
                      {view.sheet ? 'Save' : 'Connect Sheet'}
                    </button>
                    {view.sheet ? (
                      <>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                api(tenantPath(tenant.id, '/catalogue/sheet/sync'), {
                                  method: 'POST',
                                }),
                              'Sheet checked.',
                            )
                          }
                        >
                          Check now
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                api(tenantPath(tenant.id, '/catalogue/sheet'), {
                                  method: 'DELETE',
                                }),
                              'Sheet disconnected.',
                            )
                          }
                        >
                          Disconnect
                        </button>
                      </>
                    ) : null}
                  </div>
                </form>
              ) : null}
            </Card>

            <Card title="Your website">
              <p className="muted" style={{ marginBottom: 12 }}>
                Sunny reads the product tables on the pages it has crawled from your website and
                suggests them as drafts, with a link to where each figure came from. Prices found on
                your site stay marked as indicative until you confirm them.
              </p>
              {canEdit ? (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const { scan } = await api<{
                        scan: { pagesScanned: number; drafts: number };
                      }>(tenantPath(tenant.id, '/catalogue/website/scan'), { method: 'POST' });
                      setNotice(
                        scan.pagesScanned === 0
                          ? 'No website pages have been crawled yet. Connect your website on the Knowledge page.'
                          : `Looked at ${scan.pagesScanned} page${scan.pagesScanned === 1 ? '' : 's'}: ${scan.drafts} new product${scan.drafts === 1 ? '' : 's'} to review.`,
                      );
                    })
                  }
                >
                  Find products on my website
                </button>
              ) : null}
            </Card>
          </div>
        </>
      ) : (
        <SkeletonRows rows={6} />
      )}

      {editing ? (
        <ProductEditor
          key={editing.id}
          product={editing}
          title={`${editing.manufacturer} ${editing.model}`}
          onSave={(patch) => void save(patch)}
          onDelete={() => void remove()}
          onClose={() => setEditing(null)}
          busy={busy}
          error={editError}
        />
      ) : null}
    </>
  );
}

export default function ProductsPage() {
  return (
    <PortalShell>
      <Products />
    </PortalShell>
  );
}
