'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  flowIssuesOf,
  getConversation,
  resetConversation,
  saveConversation,
  type ConversationView,
  type FlowStep,
} from '../../../lib/portal-api.js';
import { SunnyLoading } from '../kit.js';
import { ErrorNote, errorText } from '../ui.js';
import { ChatPreview } from './chat-preview.js';
import { FlowDiagram } from './flow-diagram.js';
import {
  draftFrom,
  editStep,
  flowFrom,
  localIssues,
  rootsOf,
  type Context,
  type Draft,
  type EditorIssue,
} from './model.js';
import { PANELS, Panel, usePanelState, type PanelId } from './panel.js';
import { QuestionList } from './question-list.js';

/**
 * Studio's "Your conversation": the questions Sunny asks before a quote, in the
 * installer's order and words, with what each answer does to the price. Three
 * panels (list, diagram, preview) share one draft and one selection. Admins
 * and owners edit and save; viewers see the same panels read-only.
 */
export function ConversationEditor({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const [view, setView] = useState<ConversationView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<EditorIssue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [tab, setTab] = useState<PanelId>('list');
  const [collapsed, toggle] = usePanelState();
  // A question to scroll into view once it has opened (a new object each time, so it repeats).
  const [reveal, setReveal] = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (!reveal) return;
    const row = document.querySelector(`[data-step-row="${CSS.escape(reveal.id)}"]`);
    const message = row?.querySelector('.issue-list, [role="alert"]') ?? row;
    message?.scrollIntoView({ block: 'center' });
  }, [reveal]);

  function adopt(next: ConversationView): void {
    setView(next);
    setDraft(draftFrom(next.flow, next.presets));
    setIssues(next.issues);
    setDirty(false);
  }

  useEffect(() => {
    getConversation(tenantId)
      .then(adopt)
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenantId]);

  const ctx: Context | null = useMemo(
    () =>
      view
        ? { presets: new Map(view.presets.map((p) => [p.id, p])), items: view.priceItems }
        : null,
    [view],
  );

  if (!view || !draft || !ctx) {
    return error ? <ErrorNote error={error} /> : <SunnyLoading text="Loading your conversation…" />;
  }

  const flow = flowFrom(draft, ctx, view.flow);
  const readOnly = !canEdit;

  function edit(fn: (current: Draft) => Draft): void {
    setDraft((current) => (current ? fn(current) : current));
    setDirty(true);
    setSaved(null);
  }

  function onEdit(id: string, change: (step: FlowStep) => FlowStep): void {
    edit((d) => editStep(d, ctx!, id, change));
    // Edited, so its flags no longer stand; Save checks it again.
    setIssues((current) => current.filter((i) => i.stepId !== id));
  }

  /** Show what to fix: open the first flagged question and bring its message on screen. */
  function showIssues(found: EditorIssue[]): void {
    setError('Some questions need fixing first. Each one says what to change.');
    const first = found[0];
    if (!first) return;
    setSelectedId(first.stepId);
    setReveal({ id: first.stepId });
  }

  async function save(): Promise<void> {
    setError(null);
    setSaved(null);
    const local = localIssues(rootsOf(draft!, ctx!));
    if (local.length > 0) {
      // Kept beside the server's own flags (a stale price link, say), not instead of them.
      setIssues((current) => [...current.filter((i) => !i.local), ...local]);
      showIssues(local);
      return;
    }
    setBusy(true);
    try {
      adopt(await saveConversation(tenantId, flow));
      setSaved('Saved. Sunny asks these questions from the next conversation.');
    } catch (failure) {
      const found = flowIssuesOf(failure);
      setIssues(found);
      if (found.length > 0) showIssues(found);
      else setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function reset(): Promise<void> {
    setConfirmReset(false);
    setBusy(true);
    setError(null);
    try {
      adopt(await resetConversation(tenantId));
      setSelectedId(null);
      setSaved("Back to Sunny's questions.");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const columns = PANELS.map((p) =>
    collapsed[p.id] ? 'max-content' : p.id === 'list' ? 'minmax(0, 1.5fr)' : 'minmax(0, 1fr)',
  ).join(' ');

  return (
    <div className="flow-editor">
      <p className="muted">
        The questions Sunny asks before it shows a quote, in your order and your words. Link an
        answer to your price list and it changes every quote option.
      </p>
      {readOnly ? (
        <p className="muted small">
          You can look through the conversation. Ask an admin to change it.
        </p>
      ) : null}
      <div className="flow-tabs" role="tablist" aria-label="Conversation panels">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={tab === p.id}
            aria-controls={`flow-panel-${p.id}-panel`}
            onClick={() => setTab(p.id)}
          >
            {p.title}
          </button>
        ))}
      </div>
      <div className="flow-panels" data-tab={tab} style={{ ['--flow-cols' as string]: columns }}>
        <Panel
          id="list"
          title="Questions"
          collapsed={collapsed.list}
          onToggle={() => toggle('list')}
        >
          <QuestionList
            draft={draft}
            ctx={ctx}
            readOnly={readOnly}
            selectedId={selectedId}
            onSelect={setSelectedId}
            issues={issues}
            onDraft={edit}
            onEdit={onEdit}
          />
        </Panel>
        <Panel
          id="diagram"
          title="Flow diagram"
          collapsed={collapsed.diagram}
          onToggle={() => toggle('diagram')}
        >
          <FlowDiagram draft={draft} ctx={ctx} selectedId={selectedId} onSelect={setSelectedId} />
        </Panel>
        <Panel
          id="preview"
          title="Chat preview"
          collapsed={collapsed.preview}
          onToggle={() => toggle('preview')}
        >
          <ChatPreview tenantId={tenantId} flow={flow} ctx={ctx} selectedId={selectedId} />
        </Panel>
      </div>
      {readOnly ? null : (
        <div className="flow-save">
          <div className="actions">
            <button type="button" className="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save conversation'}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirmReset(true)}
            >
              Reset to Sunny&apos;s questions
            </button>
            {dirty ? <span className="muted small">Unsaved changes</span> : null}
          </div>
          {confirmReset ? (
            <div
              className="flow-confirm"
              role="alertdialog"
              aria-label="Reset to Sunny's questions?"
            >
              <p>
                This replaces your questions with Sunny&apos;s own, in Sunny&apos;s order and
                wording. Your added questions and price links are removed.
              </p>
              <div className="actions">
                <button type="button" className="button danger" onClick={() => void reset()}>
                  Reset
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setConfirmReset(false)}
                >
                  Keep my questions
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      {saved ? (
        <p className="ok-note" role="status">
          {saved}
        </p>
      ) : null}
      <ErrorNote error={error} />
    </div>
  );
}
