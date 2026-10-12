'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  PRICE_CATEGORY_LABEL,
  ProductsNav,
  type PriceItemView,
  type PriceListPage,
  type PriceListView,
} from '../../../../components/dashboard/catalogue.js';
import { SkeletonRows } from '../../../../components/dashboard/kit.js';
import { SentinelCard } from '../../../../components/dashboard/sentinel.js';
import { PortalShell, usePortal } from '../../../../components/dashboard/portal.js';
import {
  Card,
  Chip,
  ErrorNote,
  errorText,
  formatDate,
  PageHeader,
} from '../../../../components/dashboard/ui.js';
import { api, download, tenantPath } from '../../../../lib/portal-api.js';

const ORDER = [
  'pv',
  'panel_uplift',
  'mounting',
  'inverter',
  'battery',
  'scaffold',
  'electrical',
  'admin',
  'optional',
  'trenching',
  'other',
];

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    // Guidelines H3: pence only below £100.
    minimumFractionDigits: minor < 10000 && minor % 100 !== 0 ? 2 : 0,
    maximumFractionDigits: minor < 10000 && minor % 100 !== 0 ? 2 : 0,
  }).format(minor / 100);
}

function vatText(list: PriceListView): string {
  if (list.vatRatePercent === null) return 'VAT rate not set — quotes say VAT is to be confirmed';
  const inc =
    list.pricesIncludeVat === null
      ? ''
      : list.pricesIncludeVat
        ? ', prices include VAT'
        : ', prices exclude VAT';
  return `VAT ${list.vatRatePercent}%${inc}`;
}

function ItemRow({ item, currency }: { item: PriceItemView; currency: string }) {
  const extras: string[] = [];
  if (item.expansion) {
    extras.push(
      `Expansion${item.expansion.sku ? ` ${item.expansion.sku}` : ''}: ${money(item.expansion.perUnitMinor, currency)} per unit` +
        `${item.expansion.capacityWh ? ` (+${item.expansion.capacityWh / 1000} kWh)` : ''}` +
        `${item.expansion.maxUnits ? `, max ${item.expansion.maxUnits}` : ''}`,
    );
  }
  if (item.additionalUnitDiscountMinor) {
    extras.push(`−${money(item.additionalUnitDiscountMinor, currency)} per additional unit`);
  }
  return (
    <tr>
      <td>
        <span className="product-name">{item.name}</span>
        <div className="muted small">
          <code>{item.key}</code>
          {item.notes ? ` · ${item.notes}` : ''}
        </div>
      </td>
      <td>
        {item.description}
        {extras.length > 0 ? <div className="muted small">{extras.join(' · ')}</div> : null}
      </td>
      <td>
        <span className="chip-row">
          {item.mandatory ? <Chip tone="orange">Always added</Chip> : null}
          {item.exclusiveGroup ? <Chip>Pick one: {item.exclusiveGroup}</Chip> : null}
          {item.priceStatus === 'indicative' ? (
            <Chip tone="orange">Indicative</Chip>
          ) : (
            <Chip tone="ok">From your sheet</Chip>
          )}
        </span>
      </td>
    </tr>
  );
}

function PriceListTable({ list }: { list: PriceListView }) {
  const groups = ORDER.map((category) => ({
    category,
    items: list.items.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0);
  return (
    <>
      {groups.map((group) => (
        <div key={group.category} className="price-group">
          <h3>{PRICE_CATEGORY_LABEL[group.category] ?? group.category}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Price</th>
                  <th scope="col">
                    <span className="sr-only">Notes</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <ItemRow key={item.key} item={item} currency={list.currency} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {list.budgetBands.length > 0 ? (
        <div className="price-group">
          <h3>Budget bands visitors choose from</h3>
          <p className="chip-row">
            {list.budgetBands.map((b) => (
              <Chip key={b.id}>{b.label}</Chip>
            ))}
          </p>
        </div>
      ) : null}
    </>
  );
}

function PriceList() {
  const { tenant } = usePortal();
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';
  const input = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<PriceListPage | null>(null);
  const [drafts, setDrafts] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<PriceListPage>(tenantPath(tenant.id, '/catalogue/price-list'))
      .then(setPage)
      .catch((failure: unknown) => setError(errorText(failure)));
    api<{ counts: { drafts: number } }>(tenantPath(tenant.id, '/catalogue'))
      .then((v) => setDrafts(v.counts.drafts))
      .catch(() => setDrafts(null));
  }, [tenant.id]);
  useEffect(load, [load]);

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('That is not a CSV file. In Excel or Google Sheets, use File › Download › CSV.');
      return;
    }
    await run(async () =>
      api(tenantPath(tenant.id, '/catalogue/price-list/upload'), {
        body: { csv: await file.text(), fileName: file.name },
      }),
    );
  }

  const pending = page?.pending ?? null;
  const errors = pending?.issues.filter((i) => i.severity === 'error') ?? [];

  return (
    <>
      <PageHeader
        title="Price list"
        lead="How Sunny prices a quote: your system prices by panel count, upgrades, mounting, scaffolding, extras, fees and VAT. Quotes use only the published list."
        actions={
          <>
            {page?.published ? (
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  void download(
                    tenantPath(tenant.id, '/catalogue/price-list/export.csv'),
                    'price-list.csv',
                  ).catch((failure: unknown) => setError(errorText(failure)))
                }
              >
                Export CSV
              </button>
            ) : null}
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                void download(
                  tenantPath(tenant.id, '/catalogue/price-list/template.csv'),
                  'sunny-price-list-template.csv',
                ).catch((failure: unknown) => setError(errorText(failure)))
              }
            >
              Template
            </button>
            {canEdit ? (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  Upload price list
                </button>
                <input
                  ref={input}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  aria-label="Price list CSV"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = '';
                  }}
                />
              </>
            ) : null}
          </>
        }
      />
      <ProductsNav drafts={drafts} />
      <ErrorNote error={error} />
      {notice ? (
        <p className="ok-note" role="status">
          {notice}
        </p>
      ) : null}

      {!page ? (
        <SkeletonRows rows={4} />
      ) : (
        <>
          {pending ? (
            <Card
              title={
                <>
                  {pending.example
                    ? 'Example price list (HSEnergy 2026)'
                    : `Preview: ${pending.fileName ?? 'price list'}`}{' '}
                  {pending.example ? (
                    <Chip tone="orange">Example — edit before going live</Chip>
                  ) : null}
                </>
              }
            >
              <div className="preview-summary">
                <p>
                  <strong>{pending.itemCount}</strong> price{pending.itemCount === 1 ? '' : 's'}{' '}
                  read
                  {errors.length > 0 ? (
                    <>
                      , <strong className="danger-text">{errors.length}</strong> problem
                      {errors.length === 1 ? '' : 's'} to fix before this can be used for quotes
                    </>
                  ) : null}
                  .
                </p>
                {canEdit ? (
                  <div className="actions">
                    <button
                      type="button"
                      className="button"
                      disabled={busy || !pending.list}
                      onClick={() =>
                        void run(
                          () =>
                            api(
                              tenantPath(
                                tenant.id,
                                `/catalogue/price-list/upload/${pending.id}/publish`,
                              ),
                              {
                                method: 'POST',
                              },
                            ),
                          'Price list published. New quotes use it now.',
                        )
                      }
                    >
                      Publish price list
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api(tenantPath(tenant.id, `/catalogue/price-list/upload/${pending.id}`), {
                            method: 'DELETE',
                          }),
                        )
                      }
                    >
                      Discard
                    </button>
                  </div>
                ) : null}
              </div>
              {pending.example ? (
                <p className="muted small" style={{ margin: '12px 0' }}>
                  These are HSEnergy&apos;s real 2026 prices, included to show how a price list
                  works. Export it, change it to your own prices in a spreadsheet, and upload it
                  again — or publish it as it is to try Sunny out.
                </p>
              ) : null}
              {pending.issues.length > 0 ? (
                <ul className="issue-list" style={{ margin: '12px 0' }}>
                  {pending.issues.map((issue, index) => (
                    <li key={index} className={issue.severity}>
                      <Chip tone={issue.severity === 'error' ? 'danger' : 'orange'}>
                        {issue.severity === 'error' ? 'Problem' : 'Note'}
                      </Chip>
                      <span>
                        {issue.rowNumber ? <strong>Row {issue.rowNumber}: </strong> : null}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {pending.list ? <PriceListTable list={pending.list} /> : null}
            </Card>
          ) : null}

          {page.published ? (
            <Card
              title={
                <>
                  Live price list <Chip tone="ok">Version {page.version}</Chip>
                </>
              }
            >
              <p className="muted" style={{ marginBottom: 14 }}>
                {vatText(page.published)} · {page.published.currency}
                {page.published.sourceRef ? ` · ${page.published.sourceRef}` : ''}
                {page.published.sourceVersion ? ` (${page.published.sourceVersion})` : ''}
              </p>
              <PriceListTable list={page.published} />
            </Card>
          ) : !pending ? (
            <Card>
              <div className="empty">
                <h2>No price list yet</h2>
                <p className="muted">
                  Without a price list Sunny can describe your products but cannot give a full
                  quote. Download the template, or start from a real installer&apos;s example and
                  edit it.
                </p>
                {canEdit ? (
                  <div className="actions">
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            api(tenantPath(tenant.id, '/catalogue/example'), { method: 'POST' }),
                          'The HSEnergy example is ready to review below and on the Upload tab. Nothing is live until you publish.',
                        )
                      }
                    >
                      Start from the HSEnergy example list
                    </button>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {page.published ? (
            <SentinelCard
              sentinel={page.published.sentinel ?? null}
              canEdit={canEdit}
              busy={busy}
              onSave={(next) =>
                void run(
                  () =>
                    api(tenantPath(tenant.id, '/catalogue/price-list/sentinel'), {
                      method: 'PUT',
                      body: { sentinel: next },
                    }),
                  next?.enabled
                    ? 'Sentinel is on: new quotes show its indicative extra savings.'
                    : 'Sentinel is off: quotes show no optimisation uplift.',
                )
              }
            />
          ) : null}

          {page.history.length > 1 ? (
            <Card title="Earlier versions">
              <div className="table-wrap">
                <table>
                  <tbody>
                    {page.history.map((h) => (
                      <tr key={h.version}>
                        <td>
                          <strong>v{h.version}</strong>{' '}
                          {h.version === page.version ? <Chip tone="ok">Live</Chip> : null}
                        </td>
                        <td>{h.note ?? '—'}</td>
                        <td>{h.itemCount} prices</td>
                        <td>{formatDate(h.publishedAt)}</td>
                        <td>
                          {canEdit && h.version !== page.version ? (
                            <button
                              type="button"
                              className="link-button"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    api(
                                      tenantPath(
                                        tenant.id,
                                        `/catalogue/price-list/versions/${h.version}/rollback`,
                                      ),
                                      {
                                        method: 'POST',
                                      },
                                    ),
                                  `Version ${h.version} restored.`,
                                )
                              }
                            >
                              Restore
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}

export default function PriceListPageRoute() {
  return (
    <PortalShell>
      <PriceList />
    </PortalShell>
  );
}
