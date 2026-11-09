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
import { possessive } from '../../../lib/assistant-name.js';
import { SunnyLoading } from '../kit.js';
import { ErrorNote, errorText } from '../ui.js';
import { ChatPreview } from './chat-preview.js';
import { FlowCanvas } from './flow-canvas.js';
import {
  deleteStep,
  draftFrom,
  draftPath,
  editStep,
  flowFrom,
  localIssues,
  rootsOf,
  subtreeIds,
  type Context,
  type Draft,
  type EditorIssue,
} from './model.js';
import { QuestionList } from './question-list.js';
import { SelectedQuestion } from './selected-question.js';
import { useFlowView, type FlowView } from './view-switch.js';

/**
 * Studio's "Your conversation": the questions the assistant asks before a quote, in the
 * installer's order and words, with what each answer does to the price. The
 * flow (or the compact list) and the side column share one draft and one
 * selection. Admins and owners edit and save; viewers see it all read-only.
 */
export function ConversationEditor({
  tenantId,
  canEdit,
  assistant,
}: {
  tenantId: string;
  canEdit: boolean;
  /** What the installer calls the assistant: a rename on another tab shows here at once. */
  assistant: string;
}) {
  const [view, setView] = useState<ConversationView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<EditorIssue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [mode, setMode] = useFlowView();
  // A question to scroll into view once it has opened (a new object each time, so it repeats).
  const [reveal, setReveal] = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (!reveal) return;
    const card = document.querySelector(`[data-step-editor="${CSS.escape(reveal.id)}"]`);
    const message = card?.querySelector('.issue-list, [role="alert"]') ?? card;
    message?.scrollIntoView({ block: 'center' });
  }, [reveal]);

  // Narrow screens put the side column under the flow: a picked question is
  // scrolled to, so clicking a box or row visibly opens it.
  useEffect(() => {
    if (!selectedId || !window.matchMedia('(max-width: 1099px)').matches) return;
    document
      .querySelector(`[data-step-editor="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'start' });
  }, [selectedId]);

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
        ? {
            presets: new Map(view.presets.map((p) => [p.id, p])),
            items: view.priceItems,
            assistant,
          }
        : null,
    [view, assistant],
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

  function select(id: string | null): void {
    setSelectedId(id);
    if (id !== removing) setRemoving(null);
  }

  function removeNow(id: string): void {
    const path = draftPath(draft!, ctx!, id);
    const step = path?.[path.length - 1]?.step;
    if (step && selectedId && subtreeIds(step, draft!, ctx!).has(selectedId)) setSelectedId(null);
    setRemoving(null);
    edit((d) => deleteStep(d, id));
  }

  /** Remove at once, or first ask when Sunny warns about it or follow-ups go with it. */
  function askRemove(id: string): void {
    const path = draftPath(draft!, ctx!, id);
    const step = path?.[path.length - 1]?.step;
    if (!step) return;
    const preset = step.kind === 'preset' ? ctx!.presets.get(step.id) : undefined;
    const risky = (preset?.warning ?? null) !== null || (step.followUps?.length ?? 0) > 0;
    if (!risky) return removeNow(id);
    setSelectedId(id);
    setRemoving(id);
  }

  /** Show what to fix: open the first flagged question and bring its message on screen. */
  function showIssues(found: EditorIssue[]): void {
    setError('Some questions need fixing first. Each one says what to change.');
    const first = found[0];
    if (!first) return;
    select(first.stepId);
    setReveal({ id: first.stepId });
  }

  async function save(): Promise<void> {
    setError(null);
    setSaved(null);
    const local = localIssues(rootsOf(draft!, ctx!), assistant);
    if (local.length > 0) {
      // Kept beside the server's own flags (a stale price link, say), not instead of them.
      setIssues((current) => [...current.filter((i) => !i.local), ...local]);
      showIssues(local);
      return;
    }
    setBusy(true);
    try {
      adopt(await saveConversation(tenantId, flow));
      setSaved(`Saved. ${assistant} asks these questions from the next conversation.`);
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
      select(null);
      setSaved(`Back to ${possessive(assistant)} questions.`);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const shared = {
    draft,
    ctx,
    readOnly,
    selectedId,
    issues,
    onSelect: select,
    onDraft: edit,
  };

  return (
    <div className="flow-editor">
      <div className="flow-bar">
        <ViewSwitch mode={mode} onChange={setMode} />
        <p className="muted small flow-bar-lead">
          {readOnly
            ? 'You can look through the conversation. Ask an admin to change it.'
            : `The questions ${assistant} asks before a quote, in your order and your words.`}
        </p>
        {readOnly ? null : (
          <div className="flow-bar-actions">
            {dirty ? <span className="muted small">Unsaved changes</span> : null}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirmReset(true)}
            >
              Reset to {possessive(assistant)} questions
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save conversation'}
            </button>
          </div>
        )}
      </div>
      {confirmReset ? (
        <div
          className="flow-confirm"
          role="alertdialog"
          aria-label={`Reset to ${possessive(assistant)} questions?`}
        >
          <p>
            This replaces your questions with {possessive(assistant)} own, in{' '}
            {possessive(assistant)} order and wording. Your added questions and price links are
            removed.
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
      {saved ? (
        <p className="ok-note" role="status">
          {saved}
        </p>
      ) : null}
      <ErrorNote error={error} />
      <div className="flow-main">
        <div className="flow-stage-col" id="flow-view-panel">
          {mode === 'flow' ? (
            <FlowCanvas {...shared} />
          ) : (
            <QuestionList {...shared} onRemove={askRemove} />
          )}
        </div>
        <aside className="flow-side" aria-label="The selected question">
          <SelectedQuestion
            {...shared}
            onEdit={onEdit}
            removing={removing}
            onRemove={askRemove}
            onConfirmRemove={removeNow}
            onCancelRemove={() => setRemoving(null)}
          />
          <section className="flow-card" aria-label={`How ${assistant} asks it`}>
            <h3>How {assistant} asks it</h3>
            <ChatPreview tenantId={tenantId} flow={flow} ctx={ctx} selectedId={selectedId} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function ViewSwitch({ mode, onChange }: { mode: FlowView; onChange: (mode: FlowView) => void }) {
  const options: Array<{ key: FlowView; title: string }> = [
    { key: 'flow', title: 'Flow' },
    { key: 'list', title: 'Questions' },
  ];
  return (
    <div className="flow-seg" role="group" aria-label="Show the conversation as">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={mode === o.key}
          aria-controls="flow-view-panel"
          onClick={() => onChange(o.key)}
        >
          {o.title}
        </button>
      ))}
    </div>
  );
}
