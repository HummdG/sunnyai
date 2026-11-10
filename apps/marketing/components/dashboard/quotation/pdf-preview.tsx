'use client';

import { useEffect, useRef, useState } from 'react';

import { previewQuotation, type QuotationInput } from '../../../lib/portal-api.js';
import { countPdfPages, pagesOf, type PageName } from './model.js';

/** How long after the last change the preview is drawn again. */
const SETTLE_MS = 800;

interface Shown {
  url: string;
  input: QuotationInput;
  pageCount: number;
}

/**
 * The real PDF, drawn by the API from a sample quote with the draft settings,
 * 800 ms after the last change. Only one render is ever in flight: changes made
 * meanwhile are drawn once it answers, as one render of the latest draft. At
 * the API's limit the last preview stays and the next is drawn when allowed.
 */
export function PdfPreview({
  tenantId,
  input,
}: {
  tenantId: string;
  /** Null while a field is out of range: the last preview stays. */
  input: QuotationInput | null;
}) {
  const key = input ? JSON.stringify(input) : null;
  const [shown, setShown] = useState<Shown | null>(null);
  const [at, setAt] = useState<PageName>('Cover');
  const [note, setNote] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);

  const latest = useRef<{ key: string; input: QuotationInput } | null>(null);
  const tried = useRef<string | null>(null);
  const inFlight = useRef(false);
  const pausedUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const url = useRef<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (retry.current) clearTimeout(retry.current);
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  async function draw(): Promise<void> {
    const want = latest.current;
    if (!want || want.key === tried.current) return;
    if (inFlight.current || Date.now() < pausedUntil.current) return;
    inFlight.current = true;
    tried.current = want.key;
    setDrawing(true);
    try {
      const result = await previewQuotation(tenantId, want.input);
      if (!alive.current) return;
      if (result.ok) {
        const bytes = new Uint8Array(await result.blob.arrayBuffer());
        if (!alive.current) return;
        const next = URL.createObjectURL(result.blob);
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = next;
        setShown({ url: next, input: want.input, pageCount: countPdfPages(bytes) });
        setNote(null);
      } else if (result.retryAfterSec !== null) {
        // Keep the last preview; try this draft again once the limit allows.
        tried.current = null;
        pausedUntil.current = Date.now() + result.retryAfterSec * 1000;
        setNote('Lots of changes at once. The preview catches up in a few seconds.');
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(() => void draw(), result.retryAfterSec * 1000 + 50);
      } else {
        setNote(result.message);
      }
    } catch {
      if (alive.current) {
        setNote(
          'The preview could not be drawn. Check your connection. It tries again on your next change.',
        );
      }
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setDrawing(false);
        // Changed while this one was drawing: draw the latest, once.
        if (latest.current && latest.current.key !== tried.current) void draw();
      }
    }
  }

  useEffect(() => {
    if (!key || !input) return;
    latest.current = { key, input };
    if (timer.current) clearTimeout(timer.current);
    // The first preview at once; later ones once the changes settle.
    timer.current = setTimeout(() => void draw(), url.current ? SETTLE_MS : 0);
    // `input` is the same draft as `key`; the key is what changes.
  }, [key]);

  const pages = shown ? pagesOf(shown.input, shown.pageCount) : [];
  const current = pages.find((p) => p.name === at) ?? pages[0];
  const src = shown && current ? `${shown.url}#page=${current.page}` : null;

  return (
    <section className="quote-preview" aria-label="Preview">
      <div className="quote-preview-bar">
        <span className="muted small">
          Preview (sample customer){drawing && shown ? ', updating…' : ''}
        </span>
        {pages.length > 0 ? (
          <div className="quote-chips" role="group" aria-label="Pages">
            {pages.map((p) => (
              <button
                key={p.name}
                type="button"
                aria-pressed={current?.name === p.name}
                onClick={() => setAt(p.name)}
              >
                {p.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {input === null ? (
        <p className="muted small quote-preview-note">
          The preview updates once every field is valid.
        </p>
      ) : note ? (
        <p className="muted small quote-preview-note" aria-live="polite">
          {note}
        </p>
      ) : null}
      <div className="quote-sheet">
        {src ? (
          // Remounted on each jump: a blob PDF does not follow a changed #page by itself.
          <iframe key={src} src={src} title="Quotation preview" />
        ) : (
          <p className="muted small quote-sheet-wait">Drawing the preview…</p>
        )}
      </div>
    </section>
  );
}
