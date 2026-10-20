'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

import {
  CATEGORY_LABEL,
  IssueList,
  PriceStatusChip,
  ProductsNav,
  price,
  rating,
  type CatalogueView,
  type PendingUpload,
} from '../../../../components/dashboard/catalogue.js';
import { PortalShell, usePortal } from '../../../../components/dashboard/portal.js';
import {
  Card,
  Chip,
  ErrorNote,
  errorText,
  PageHeader,
} from '../../../../components/dashboard/ui.js';
import { api, download, tenantPath } from '../../../../lib/portal-api.js';

const MAX_BYTES = 4_000_000;

function Upload() {
  const { tenant } = usePortal();
  const router = useRouter();
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';
  const input = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<PendingUpload | null>(null);
  const [drafts, setDrafts] = useState<number | null>(null);
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(0);

  const load = useCallback(() => {
    api<CatalogueView>(tenantPath(tenant.id, '/catalogue'))
      .then((view) => {
        setUpload(view.pendingUpload);
        setDrafts(view.counts.drafts);
        setPublished(view.counts.products);
      })
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id]);
  useEffect(load, [load]);

  async function read(file: File) {
    setError(null);
    if (!/\.(csv|txt)$/i.test(file.name) && file.type !== 'text/csv') {
      setError('That is not a CSV file. In Excel or Google Sheets, use File › Download › CSV.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That file is over 4 MB. Split it, or remove the columns Sunny does not read.');
      return;
    }
    setBusy(true);
    try {
      const csv = await file.text();
      const result = await api<{ upload: PendingUpload }>(
        tenantPath(tenant.id, '/catalogue/upload'),
        {
          body: { csv, mode, fileName: file.name },
        },
      );
      setUpload(result.upload);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void read(file);
  }

  async function act(path: string, method: 'POST' | 'DELETE', next?: string) {
    if (!upload) return;
    setBusy(true);
    setError(null);
    try {
      await api(tenantPath(tenant.id, path), { method });
      if (next) router.push(next);
      else {
        setUpload(null);
        load();
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const errors = upload?.issues.filter((i) => i.severity === 'error').length ?? 0;

  return (
    <>
      <PageHeader
        title="Upload products"
        lead="Upload your price list as a CSV. You will see exactly what Sunny read before anything goes live."
      />
      <ProductsNav drafts={drafts} />
      <ErrorNote error={error} />

      {!canEdit ? (
        <Card>
          <p className="muted">Only admins and owners can change the product list.</p>
        </Card>
      ) : upload ? (
        <Card
          title={
            upload.example ? (
              <>
                Example products (HSEnergy 2026){' '}
                <Chip tone="orange">Example: edit before going live</Chip>
              </>
            ) : upload.fileName ? (
              `Preview: ${upload.fileName}`
            ) : (
              'Preview'
            )
          }
        >
          {upload.example ? (
            <p className="muted small" style={{ marginBottom: 12 }}>
              A real installer&apos;s 2026 range, to show how a product list works. Publish it to
              try Sunny out, then edit or replace it with your own; the matching price list is
              waiting on the Price list tab.
            </p>
          ) : null}
          <div className="preview-summary">
            <p>
              <strong>{upload.accepted}</strong> product{upload.accepted === 1 ? '' : 's'} ready
              {upload.rejected > 0 ? (
                <>
                  , <strong className="danger-text">{upload.rejected}</strong> row
                  {upload.rejected === 1 ? '' : 's'} could not be read
                </>
              ) : null}
              .{' '}
              {upload.mode === 'replace'
                ? published > 0
                  ? `Publishing replaces your current ${published} product${published === 1 ? '' : 's'}.`
                  : 'This will be your first product list.'
                : `Publishing adds these to your current ${published} product${published === 1 ? '' : 's'}.`}
            </p>
            <div className="actions">
              <button
                type="button"
                className="button"
                disabled={busy || upload.accepted === 0}
                onClick={() =>
                  void act(`/catalogue/upload/${upload.id}/publish`, 'POST', '/dashboard/products')
                }
              >
                Publish {upload.accepted} product{upload.accepted === 1 ? '' : 's'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void act(`/catalogue/upload/${upload.id}`, 'DELETE')}
              >
                Discard
              </button>
            </div>
          </div>
          {errors > 0 ? (
            <p className="muted small" style={{ margin: '12px 0' }}>
              Rows marked “Not imported” are left out. Fix them in your file and upload it again, or
              publish what is ready now.
            </p>
          ) : null}
          <IssueList issues={upload.issues} />
          {upload.products.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Product</th>
                    <th scope="col">Category</th>
                    <th scope="col">Rating</th>
                    <th scope="col">Price</th>
                    <th scope="col">Warranty</th>
                  </tr>
                </thead>
                <tbody>
                  {upload.products.map((p) => (
                    <tr key={p.id}>
                      <td className="muted">{p.rowNumber ?? ''}</td>
                      <td>
                        <span className="muted">{p.manufacturer}</span> {p.model}
                      </td>
                      <td>{CATEGORY_LABEL[p.category]}</td>
                      <td>{rating(p)}</td>
                      <td>
                        <span className="price">{price(p)}</span>{' '}
                        <PriceStatusChip status={p.priceStatus} />
                      </td>
                      <td>{p.warrantyYears === null ? '–' : `${p.warrantyYears} yrs`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : (
        <div className="grid two">
          <Card title="1. Start from the template">
            <p className="muted" style={{ marginBottom: 12 }}>
              One row per product. The columns Sunny reads are in the template, with example rows to
              replace. Prices are per unit; a price with a source (your price list) is shown as
              verified.
            </p>
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
              Download the CSV template
            </button>
            <p className="muted small" style={{ marginTop: 12 }}>
              Already keep your prices in a Google Sheet?{' '}
              <Link href="/dashboard/products">Connect it instead</Link>.
            </p>
            <p className="muted small" style={{ marginTop: 8 }}>
              Just exploring?{' '}
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  api(tenantPath(tenant.id, '/catalogue/example'), { method: 'POST' })
                    .then(load)
                    .catch((failure: unknown) => setError(errorText(failure)))
                    .finally(() => setBusy(false));
                }}
              >
                Start from the HSEnergy example list
              </button>
              , a real installer&apos;s 2026 range and prices to edit.
            </p>
          </Card>
          <Card title="2. Upload your file">
            <fieldset className="field">
              <legend>When you publish</legend>
              <div className="pills" role="radiogroup">
                <button
                  type="button"
                  role="radio"
                  className="pill"
                  aria-checked={mode === 'replace'}
                  onClick={() => setMode('replace')}
                >
                  Replace my list
                </button>
                <button
                  type="button"
                  role="radio"
                  className="pill"
                  aria-checked={mode === 'append'}
                  onClick={() => setMode('append')}
                >
                  Add to my list
                </button>
              </div>
            </fieldset>
            <div
              className={`dropzone${dragging ? ' dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <p>
                <strong>Drop your CSV here</strong>
              </p>
              <p className="muted small">or</p>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {busy ? 'Reading…' : 'Choose a file'}
              </button>
              <input
                ref={input}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label="CSV file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void read(file);
                  e.target.value = '';
                }}
              />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

export default function UploadPage() {
  return (
    <PortalShell>
      <Upload />
    </PortalShell>
  );
}
