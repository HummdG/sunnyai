'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CATEGORY_LABEL,
  PriceStatusChip,
  ProductEditor,
  ProductsNav,
  price,
  rating,
  shortSource,
  type Draft,
  type ProductPatch,
} from '../../../../components/dashboard/catalogue.js';
import { SkeletonRows } from '../../../../components/dashboard/kit.js';
import { PortalShell, usePortal } from '../../../../components/dashboard/portal.js';
import {
  Card,
  Chip,
  ErrorNote,
  errorText,
  PageHeader,
} from '../../../../components/dashboard/ui.js';
import { api, tenantPath } from '../../../../lib/portal-api.js';

const ORIGIN_LABEL = { website: 'From your website', sheet: 'From your Google Sheet' } as const;

/** What an update draft would change, field by field. */
function changes(draft: Draft): string[] {
  const current = draft.current;
  if (!current) return [];
  const out: string[] = [];
  if (price(current) !== price(draft.product))
    out.push(`Price ${price(current)} → ${price(draft.product)}`);
  if (rating(current) !== rating(draft.product))
    out.push(`Rating ${rating(current)} → ${rating(draft.product)}`);
  if (current.warrantyYears !== draft.product.warrantyYears) {
    out.push(
      `Warranty ${current.warrantyYears ?? '—'} → ${draft.product.warrantyYears ?? '—'} yrs`,
    );
  }
  return out;
}

function Drafts() {
  const { tenant } = usePortal();
  const canEdit = tenant.role === 'admin' || tenant.role === 'owner';
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ drafts: Draft[] }>(tenantPath(tenant.id, '/catalogue/drafts'))
      .then((result) => {
        setDrafts(result.drafts);
        setSelected(
          (prev) => new Set([...prev].filter((id) => result.drafts.some((d) => d.id === id))),
        );
      })
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id]);
  useEffect(load, [load]);

  const groups = useMemo(() => {
    const list = drafts ?? [];
    return (['website', 'sheet'] as const)
      .map((origin) => ({ origin, items: list.filter((d) => d.origin === origin) }))
      .filter((g) => g.items.length > 0);
  }, [drafts]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function decide(kind: 'approve' | 'reject', ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(tenantPath(tenant.id, `/catalogue/drafts/${kind}`), { body: { ids } });
      setNotice(
        kind === 'approve'
          ? `${ids.length} product${ids.length === 1 ? '' : 's'} published. Sunny is using ${ids.length === 1 ? 'it' : 'them'} now.`
          : `${ids.length} draft${ids.length === 1 ? '' : 's'} dismissed. Sunny will not suggest ${ids.length === 1 ? 'it' : 'them'} again.`,
      );
      setSelected(new Set());
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(patch: ProductPatch) {
    if (!editing) return;
    setBusy(true);
    setEditError(null);
    try {
      await api(tenantPath(tenant.id, `/catalogue/drafts/${editing.id}`), {
        method: 'PATCH',
        body: patch,
      });
      setEditing(null);
      load();
    } catch (failure) {
      setEditError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const chosen = [...selected];

  return (
    <>
      <PageHeader
        title="Drafts"
        lead="Products Sunny found on your website or in your Google Sheet. Check each against its source; nothing goes live until you approve it."
      />
      <ProductsNav drafts={drafts?.length ?? null} />
      <ErrorNote error={error} />
      {notice ? (
        <p className="ok-note" role="status">
          {notice}
        </p>
      ) : null}

      {drafts === null ? (
        <SkeletonRows rows={4} />
      ) : drafts.length === 0 ? (
        <Card>
          <div className="empty">
            <h2>Nothing to review</h2>
            <p className="muted">
              When Sunny finds products on your website, or your Google Sheet changes, they appear
              here for approval.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {canEdit ? (
            <div className="bulk-bar" role="toolbar" aria-label="Selected drafts">
              <label className="check">
                <input
                  type="checkbox"
                  checked={chosen.length === drafts.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(drafts.map((d) => d.id)) : new Set())
                  }
                />
                <span>{chosen.length > 0 ? `${chosen.length} selected` : 'Select all'}</span>
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy || chosen.length === 0}
                  onClick={() => void decide('approve', chosen)}
                >
                  Approve selected
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || chosen.length === 0}
                  onClick={() => void decide('reject', chosen)}
                >
                  Dismiss selected
                </button>
              </div>
            </div>
          ) : null}

          {groups.map((group) => (
            <Card
              key={group.origin}
              title={`${ORIGIN_LABEL[group.origin]} (${group.items.length})`}
            >
              <ul className="draft-list">
                {group.items.map((draft) => {
                  const diff = changes(draft);
                  return (
                    <li key={draft.id} className="draft">
                      {canEdit ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${draft.product.manufacturer} ${draft.product.model}`}
                          checked={selected.has(draft.id)}
                          onChange={() => toggle(draft.id)}
                        />
                      ) : null}
                      <div className="draft-main">
                        <div className="draft-title">
                          <strong>
                            <span className="muted">{draft.product.manufacturer}</span>{' '}
                            {draft.product.model}
                          </strong>
                          {draft.updatesProductId ? (
                            <Chip tone="orange">Update</Chip>
                          ) : (
                            <Chip tone="ok">New</Chip>
                          )}
                          {draft.extractor === 'gemini' ? (
                            <Chip>Read by AI — check carefully</Chip>
                          ) : null}
                        </div>
                        <p className="draft-facts">
                          {CATEGORY_LABEL[draft.product.category]} · {rating(draft.product)} ·{' '}
                          <span className="price">{price(draft.product)}</span>{' '}
                          <PriceStatusChip status={draft.product.priceStatus} />
                          {draft.product.warrantyYears !== null
                            ? ` · ${draft.product.warrantyYears} yr warranty`
                            : ''}
                        </p>
                        {diff.length > 0 ? <p className="small">{diff.join(' · ')}</p> : null}
                        {draft.sourceUrl ? (
                          <p className="small muted">
                            Source:{' '}
                            <a href={draft.sourceUrl} target="_blank" rel="noreferrer">
                              {shortSource(draft.sourceUrl)}
                            </a>
                          </p>
                        ) : null}
                        {draft.issues.length > 0 ? (
                          <p className="small muted">
                            {draft.issues.map((i) => i.message).join(' ')}
                          </p>
                        ) : null}
                      </div>
                      {canEdit ? (
                        <div className="draft-actions">
                          <button
                            type="button"
                            className="button"
                            disabled={busy}
                            onClick={() => void decide('approve', [draft.id])}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="link-button"
                            disabled={busy}
                            onClick={() => {
                              setEditError(null);
                              setEditing(draft);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="link-button muted-link"
                            disabled={busy}
                            onClick={() => void decide('reject', [draft.id])}
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </>
      )}

      {editing ? (
        <ProductEditor
          key={editing.id}
          product={editing.product}
          title={`Draft: ${editing.product.manufacturer} ${editing.product.model}`}
          fieldSources={editing.fieldSources}
          onSave={(patch) => void saveDraft(patch)}
          onClose={() => setEditing(null)}
          busy={busy}
          error={editError}
        />
      ) : null}
    </>
  );
}

export default function DraftsPage() {
  return (
    <PortalShell>
      <Drafts />
    </PortalShell>
  );
}
