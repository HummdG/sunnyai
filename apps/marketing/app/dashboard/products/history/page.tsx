'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  ProductsNav,
  type CatalogueView,
  type Version,
} from '../../../../components/dashboard/catalogue.js';
import { EmptyState, SkeletonRows } from '../../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../../components/dashboard/portal.js';
import {
  Card,
  Chip,
  ErrorNote,
  errorText,
  formatDate,
  PageHeader,
} from '../../../../components/dashboard/ui.js';
import { api, tenantPath } from '../../../../lib/portal-api.js';

const REASON: Record<Version['reason'], string> = {
  upload: 'CSV upload',
  sheet: 'Google Sheet',
  drafts: 'Approved drafts',
  edit: 'Edit',
  delete: 'Removal',
  rollback: 'Restore',
};

function History() {
  const { tenant } = usePortal();
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';
  const [view, setView] = useState<CatalogueView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<CatalogueView>(tenantPath(tenant.id, '/catalogue'))
      .then(setView)
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id]);
  useEffect(load, [load]);

  async function restore(version: number) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(tenantPath(tenant.id, `/catalogue/versions/${version}/rollback`), {
        method: 'POST',
      });
      setNotice(`Version ${version} restored as a new version.`);
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="History"
        lead="Every change to your published products is a version. Restoring one publishes it again as a new version, so nothing is lost."
      />
      <ProductsNav drafts={view?.counts.drafts ?? null} />
      <ErrorNote error={error} />
      {notice ? (
        <p className="ok-note" role="status">
          {notice}
        </p>
      ) : null}
      <Card>
        {!view ? (
          <SkeletonRows rows={4} />
        ) : view.versions.length === 0 ? (
          <EmptyState
            pose="shrug"
            title="No versions yet"
            say="Nothing to rewind yet. Publish a list and I’ll keep every version."
          >
            Your first published product list will appear here.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Change</th>
                  <th scope="col">Products</th>
                  <th scope="col" className="hide-sm">
                    When
                  </th>
                  <th scope="col" className="hide-sm">
                    By
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.versions.map((v) => (
                  <tr key={v.version}>
                    <td>
                      <strong>v{v.version}</strong>{' '}
                      {v.version === view.version ? <Chip tone="ok">Live</Chip> : null}
                    </td>
                    <td>
                      {REASON[v.reason]}
                      {v.note ? <span className="muted small"> — {v.note}</span> : null}
                    </td>
                    <td>{v.productCount}</td>
                    <td className="hide-sm">{formatDate(v.publishedAt)}</td>
                    <td className="small hide-sm">
                      {v.publishedBy === 'system' ? 'Automatic' : v.publishedBy}
                    </td>
                    <td>
                      {canEdit && v.restorable ? (
                        <button
                          type="button"
                          className="link-button"
                          disabled={busy}
                          onClick={() => void restore(v.version)}
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
        )}
      </Card>
    </>
  );
}

export default function HistoryPage() {
  return (
    <PortalShell>
      <History />
    </PortalShell>
  );
}
