'use client';

import { useEffect, useState } from 'react';

import {
  getQuotation,
  sampleQuotation,
  saveQuotation,
  type QuotationView,
  type TenantView,
} from '../../../lib/portal-api.js';
import { SunnyLoading } from '../kit.js';
import { ErrorNote, errorText } from '../ui.js';
import { draftFrom, draftKey, inputFrom, type QuotationDraft } from './model.js';
import { PdfPreview } from './pdf-preview.js';
import { SettingsForm } from './settings-form.js';

/** Hand a PDF to the browser as a download. */
function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Studio's "Your quotation": the PDF customers receive with their quote. The
 * settings on the left, the real PDF (drawn from a sample quote) on the right.
 * Admins and owners edit and save; viewers see it all read-only, preview
 * included.
 */
export function QuotationTab({
  tenant,
  canEdit,
  assistant,
}: {
  tenant: TenantView;
  canEdit: boolean;
  /** What the installer calls the assistant: a rename on another tab shows here at once. */
  assistant: string;
}) {
  const [draft, setDraft] = useState<QuotationDraft | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function adopt(view: QuotationView): void {
    const next = draftFrom(view);
    setDraft(next);
    setBaseline(draftKey(next));
  }

  useEffect(() => {
    getQuotation(tenant.id)
      .then(adopt)
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenant.id]);

  if (!draft) {
    return error ? <ErrorNote error={error} /> : <SunnyLoading text="Loading your quotation…" />;
  }

  const readOnly = !canEdit;
  const input = inputFrom(draft);
  const dirty = draftKey(draft) !== baseline;

  function edit(change: (current: QuotationDraft) => QuotationDraft): void {
    if (readOnly) return;
    setDraft((current) => (current ? change(current) : current));
    setSaved(null);
  }

  async function save(): Promise<void> {
    setError(null);
    setSaved(null);
    if (!input) {
      setError('Some fields need fixing first. Each one says what to change.');
      return;
    }
    setBusy(true);
    try {
      adopt(await saveQuotation(tenant.id, input));
      setSaved('Saved. New quotes use these settings. Quotes already sent keep their own.');
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function downloadSample(): Promise<void> {
    setDownloading(true);
    setError(null);
    try {
      const result = await sampleQuotation(tenant.id);
      if (!result.ok) {
        setError(
          result.retryAfterSec !== null
            ? `Lots of PDFs at once. Try again in ${result.retryAfterSec} seconds.`
            : result.message,
        );
        return;
      }
      const slug = tenant.companyName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
      saveFile(result.blob, result.fileName ?? `${slug || 'Sunny'}-sample-quotation.pdf`);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="quote-tab">
      <div className="flow-bar">
        <p className="muted small flow-bar-lead">
          {readOnly
            ? 'You can look through the quotation settings. Ask an admin to change them.'
            : `The PDF your customers receive with the quote ${assistant} gives them.`}
        </p>
        <div className="flow-bar-actions">
          {dirty ? <span className="muted small">Unsaved changes</span> : null}
          <button
            type="button"
            className="button secondary"
            disabled={downloading}
            title={dirty ? 'The sample uses your saved settings.' : undefined}
            onClick={() => void downloadSample()}
          >
            {downloading ? 'Preparing…' : 'Download a sample PDF'}
          </button>
          {readOnly ? null : (
            <button type="button" className="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save quotation'}
            </button>
          )}
        </div>
      </div>
      {saved ? (
        <p className="ok-note" role="status">
          {saved}
        </p>
      ) : null}
      <ErrorNote error={error} />
      <div className="quote-main">
        {/* Disabled as a whole for viewers: every input, switch and button in it. */}
        <fieldset className="quote-form" disabled={readOnly || busy}>
          <legend className="sr-only">Quotation settings</legend>
          <SettingsForm tenant={tenant} assistant={assistant} draft={draft} onEdit={edit} />
        </fieldset>
        <PdfPreview tenantId={tenant.id} input={input} />
      </div>
    </div>
  );
}
