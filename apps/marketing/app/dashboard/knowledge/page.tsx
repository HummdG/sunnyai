'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { SkeletonRows, SunProgress } from '../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../components/dashboard/portal.js';
import {
  Card,
  Chip,
  ErrorNote,
  errorText,
  formatDate,
  PageHeader,
  StatusChip,
} from '../../../components/dashboard/ui.js';
import { api, tenantPath, type KnowledgeView, type SyncProgress } from '../../../lib/portal-api.js';

function kindLabel(kind: string): string {
  if (kind === 'placeholder') return 'Placeholder';
  if (kind === 'todo') return 'To do';
  return kind.charAt(0).toUpperCase() + kind.slice(1).replace(/[_-]/g, ' ');
}

/** A running sync as the sun rising along a bar (guidelines D3, Part G "Syncing"). */
function SyncBar({
  what,
  unit,
  progress,
}: {
  what: 'website' | 'folder';
  unit: 'page' | 'file';
  progress: SyncProgress | null;
}) {
  if (!progress || progress.phase === 'reading' || progress.total === null) {
    return (
      <SunProgress
        value={0}
        max={0}
        label={what === 'website' ? 'Reading your website…' : 'Reading your Drive folder…'}
      />
    );
  }
  const plural = (n: number) => `${n.toLocaleString('en-GB')} ${unit}${n === 1 ? '' : 's'}`;
  return (
    <SunProgress
      value={progress.done}
      max={progress.total}
      label={`${what === 'website' ? 'Reading your website' : 'Reading your folder'}: ${progress.done.toLocaleString('en-GB')} of ${plural(progress.total)}.`}
    />
  );
}

function Knowledge() {
  const { tenant } = usePortal();
  const [view, setView] = useState<KnowledgeView | null>(null);
  const [website, setWebsite] = useState(tenant.websiteUrl ?? '');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';

  const load = useCallback(() => {
    api<KnowledgeView>(tenantPath(tenant.id, '/knowledge'))
      .then(setView)
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id]);

  useEffect(load, [load]);

  // While a sync runs, check on it every two seconds so the sun keeps rising.
  const syncing = view?.website.status === 'syncing' || view?.drive.status === 'syncing';
  useEffect(() => {
    if (!syncing) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [syncing, load]);

  async function run(work: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const warnings =
    view?.sources.flatMap((source) =>
      source.warnings.map((warning) => ({ ...warning, source: source.title })),
    ) ?? [];

  return (
    <>
      <PageHeader
        title="Knowledge"
        lead="Sunny answers only from what is here: your website and your Google Drive folder. Update them and Sunny updates too."
        actions={
          canEdit ? (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() => api(tenantPath(tenant.id, '/knowledge/sync'), { body: {} }))
              }
            >
              Sync now
            </button>
          ) : null
        }
      />
      <ErrorNote error={error} />
      {view ? (
        <>
          <div className="grid two">
            <Card
              title={
                <>Website {view.website ? <StatusChip status={view.website.status} /> : null}</>
              }
            >
              {view.website.target ? (
                <p style={{ marginBottom: 12 }}>
                  <a href={view.website.target}>{view.website.target}</a>
                  {view.website.at ? (
                    <span className="muted small"> · last sync {formatDate(view.website.at)}</span>
                  ) : null}
                </p>
              ) : null}
              {view.website.status === 'syncing' ? (
                <SyncBar what="website" progress={view.website.progress ?? null} unit="page" />
              ) : null}
              {view.website.error ? <p className="error-note">{view.website.error}</p> : null}
              {!view.syncAvailable.website && view.website.target ? (
                <p className="muted small" style={{ marginBottom: 12 }}>
                  Website crawling is not running on this deployment yet; your site is recorded and
                  will be read once it is.
                </p>
              ) : null}
              {canEdit ? (
                <form
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void run(() =>
                      api(tenantPath(tenant.id, '/knowledge/website'), { body: { url: website } }),
                    );
                  }}
                >
                  <label className="field">
                    <span>Website address</span>
                    <input
                      type="url"
                      required
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </label>
                  <button className="button" type="submit" disabled={busy}>
                    {view.website.target ? 'Update and sync' : 'Connect website'}
                  </button>
                </form>
              ) : null}
            </Card>
            <Card
              title={
                <>
                  Google Drive <StatusChip status={view.drive.status} />
                </>
              }
            >
              <ol className="muted" style={{ paddingLeft: 18, margin: '0 0 12px' }}>
                <li>Make one folder for Sunny: spec sheets, prices, warranties, FAQs.</li>
                <li>
                  Share it as <strong>Viewer</strong> with{' '}
                  {view.drive.serviceAccountEmail ? (
                    <code>{view.drive.serviceAccountEmail}</code>
                  ) : (
                    <em>the Sunny service account (not configured on this deployment yet)</em>
                  )}
                  .
                </li>
                <li>Paste the folder link below.</li>
              </ol>
              {view.drive.status === 'syncing' ? (
                <SyncBar what="folder" progress={view.drive.progress ?? null} unit="file" />
              ) : null}
              {view.drive.error ? <p className="error-note">{view.drive.error}</p> : null}
              {canEdit ? (
                <form
                  onSubmit={(event: FormEvent) => {
                    event.preventDefault();
                    void run(() =>
                      api(tenantPath(tenant.id, '/knowledge/drive'), { body: { folder } }),
                    );
                  }}
                >
                  <label className="field">
                    <span>Folder link</span>
                    <input
                      required
                      placeholder="https://drive.google.com/drive/folders/…"
                      value={folder}
                      onChange={(e) => setFolder(e.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button className="button" type="submit" disabled={busy}>
                      {view.drive.target ? 'Change folder' : 'Connect folder'}
                    </button>
                    <button className="button secondary" type="button" disabled title="Coming soon">
                      Connect with Google (OAuth)
                    </button>
                  </div>
                </form>
              ) : null}
            </Card>
          </div>
          <Card title="Knowledge base completeness" id="completeness">
            {warnings.length === 0 ? (
              <p className="ok-note">No unfinished items found in your documents.</p>
            ) : (
              <>
                <p className="muted" style={{ marginBottom: 12 }}>
                  Fix these before going live. Sunny will not quote a placeholder, so a missing
                  number means customers cannot be told it.
                </p>
                <ul className="warning-list">
                  {warnings.map((warning, index) => (
                    <li key={index}>
                      <span>
                        <Chip tone="orange">{kindLabel(warning.kind)}</Chip> {warning.text}
                        <span className="muted small">
                          {' '}
                          ({warning.source}
                          {warning.section ? `, ${warning.section}` : ''})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          <Card title={`Documents (${view.sources.length})`}>
            {view.sources.length === 0 ? (
              <p className="muted">Nothing indexed yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Document</th>
                      <th scope="col">Updated</th>
                      <th scope="col">Size</th>
                      <th scope="col">Checks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.sources.map((source) => (
                      <tr key={source.id}>
                        <td>
                          {source.url ? <a href={source.url}>{source.title}</a> : source.title}
                        </td>
                        <td>{formatDate(source.updatedAt)}</td>
                        <td>{Math.max(1, Math.round(source.characters / 1000))}k chars</td>
                        <td>
                          {source.warnings.length > 0 ? (
                            <Chip tone="orange">{source.warnings.length} to fix</Chip>
                          ) : (
                            <Chip tone="ok">OK</Chip>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : !error ? (
        <SkeletonRows rows={4} />
      ) : null}
    </>
  );
}

export default function KnowledgePage() {
  return (
    <PortalShell>
      <Knowledge />
    </PortalShell>
  );
}
