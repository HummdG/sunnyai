'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  flowIssuesOf,
  getConversation,
  resetConversation,
  saveConversation,
  workflowIssuesOf,
  type ConversationFlow,
  type ConversationPreview,
  type FlowStep,
  type PresetView,
  type PriceItemView,
  type PriceSuggestion,
} from '../../../lib/portal-api.js';
import { possessive } from '../../../lib/assistant-name.js';
import { SunnyLoading } from '../kit.js';
import { ErrorNote, errorText } from '../ui.js';
import { ChatPreview } from './chat-preview.js';
import { FlowCanvas } from './flow-canvas.js';
import { CONVERSATION_ENDS, type FixedEnds } from './flow-layout.js';
import {
  deleteStep,
  draftFrom,
  draftPath,
  editStep,
  flowFrom,
  localIssues,
  rootsOf,
  stepIssues,
  subtreeIds,
  wholeIssues,
  type Context,
  type Draft,
  type EditorIssue,
} from './model.js';
import { QuestionList } from './question-list.js';
import { SelectedQuestion } from './selected-question.js';
import { useSuggestions, type Question } from './suggestions.js';
import { useFlowView, type FlowView } from './view-switch.js';

/** What the editor loads and saves: a flow, the questions and prices it draws on, and its flags. */
export interface EditorView {
  flow: ConversationFlow | null;
  presets: PresetView[];
  priceItems: PriceItemView[];
  /** Flags beside their questions (a workflow's step-level issues, see `stepIssues`). */
  issues: EditorIssue[];
}

/**
 * Where the editor's questions come from and go: a workflow's routes, say.
 * Without one, the editor runs on the installer's conversation.
 */
export interface EditorSource {
  load(): Promise<EditorView>;
  /** A rejected save throws; its body's `issues` are shown beside their questions. */
  save(flow: ConversationFlow): Promise<EditorView>;
  /** Back to the template. Absent: no reset button. */
  reset?(): Promise<EditorView>;
  preview(flow: ConversationFlow, answers: Record<string, string>): Promise<ConversationPreview>;
  suggest(question: Question): Promise<PriceSuggestion>;
  /**
   * The questions to offer, when they change after loading (a workflow whose
   * outcome was changed and saved); the loaded view's when absent. The draft is
   * kept as it is.
   */
  presets?: PresetView[];
  /** The locked start box's label, or null for none (a workflow asks the address itself). */
  start: string | null;
  /** The locked end box's label (`workflowEnd` in flow-layout). */
  end: string;
  /** The editor's own words for what it edits; the conversation's when absent. */
  words?: EditorWords;
  /** Shown under the chat preview (a workflow's page check, say). */
  previewExtra?: ReactNode;
  /** Told whenever the questions gain or lose unsaved changes. */
  onDirtyChange?(dirty: boolean): void;
}

/** What the editor calls the thing it edits, in its bar, its notes and its reset. */
export interface EditorWords {
  loading: string;
  lead: string;
  readOnlyLead: string;
  save: string;
  /** After a save. */
  saved: string;
  /** The reset button, and the name of its confirmation. */
  reset: string;
  /** What the reset confirmation says is replaced. */
  resetWarning: string;
  /** After a reset. */
  resetDone: string;
}

/** The installer's conversation, in the words the editor has always used. */
function conversationWords(assistant: string): EditorWords {
  return {
    loading: 'Loading your conversation…',
    lead: `The questions ${assistant} asks before a quote, in your order and your words.`,
    readOnlyLead: 'You can look through the conversation. Ask an admin to change it.',
    save: 'Save conversation',
    saved: `Saved. ${assistant} asks these questions from the next conversation.`,
    reset: `Reset to ${possessive(assistant)} questions`,
    resetWarning: `This replaces your questions with ${possessive(assistant)} own, in ${possessive(assistant)} order and wording. Your added questions and price links are removed.`,
    resetDone: `Back to ${possessive(assistant)} questions.`,
  };
}

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
  source,
}: {
  tenantId: string;
  canEdit: boolean;
  /** What the installer calls the assistant: a rename on another tab shows here at once. */
  assistant: string;
  /**
   * A workflow (or other source) to edit instead of the conversation. Loaded
   * once: give the editor a `key` to switch to another.
   */
  source?: EditorSource;
}) {
  const [view, setView] = useState<EditorView | null>(null);
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
  // The newest source, read when called, so a new object each render loads nothing again.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const start = source ? source.start : CONVERSATION_ENDS.start;
  const end = source ? source.end : CONVERSATION_ENDS.end;
  const ends: FixedEnds = useMemo(() => ({ start, end }), [start, end]);
  const words = source?.words ?? conversationWords(assistant);

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

  function adopt(next: EditorView): void {
    setView(next);
    setDraft(draftFrom(next.flow, next.presets));
    setIssues(next.issues);
    setDirty(false);
  }

  useEffect(() => {
    sourceRef.current?.onDirtyChange?.(dirty);
  }, [dirty]);

  useEffect(() => {
    const from = sourceRef.current;
    (from ? from.load() : getConversation(tenantId))
      .then(adopt)
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenantId]);

  const presetsOverride = source?.presets;
  const ctx: Context | null = useMemo(
    () =>
      view
        ? {
            presets: new Map((presetsOverride ?? view.presets).map((p) => [p.id, p])),
            items: view.priceItems,
            assistant,
          }
        : null,
    [view, presetsOverride, assistant],
  );

  function edit(fn: (current: Draft) => Draft): void {
    setDraft((current) => (current ? fn(current) : current));
    setDirty(true);
    setSaved(null);
  }

  const suggestions = useSuggestions({
    tenantId,
    draft,
    ctx,
    enabled: canEdit,
    selectedId,
    onDraft: edit,
    ...(source ? { suggest: (q: Question) => source.suggest(q) } : {}),
  });

  if (!view || !draft || !ctx) {
    return error ? <ErrorNote error={error} /> : <SunnyLoading text={words.loading} />;
  }

  const flow = flowFrom(draft, ctx, view.flow);
  const readOnly = !canEdit;

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

  /**
   * Show what to fix: open the first flagged question and bring its message on
   * screen. `more` (flags about the whole workflow) follows the message, which
   * replaces any earlier one rather than adding to it.
   */
  function showIssues(found: EditorIssue[], more = ''): void {
    setError(`Some questions need fixing first. Each one says what to change. ${more}`.trim());
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
      adopt(await (source ? source.save(flow) : saveConversation(tenantId, flow)));
      setSaved(words.saved);
    } catch (failure) {
      // A workflow's flags may also be about the whole workflow (its pages, a
      // missing address): those show as the error, not beside a question.
      // Warnings never stop a save, so they are not what to fix.
      const all = source ? workflowIssuesOf(failure).filter((i) => !i.warning) : [];
      const found: EditorIssue[] = source ? stepIssues(all) : flowIssuesOf(failure);
      const whole = wholeIssues(all).join(' ');
      setIssues(found);
      if (found.length > 0) showIssues(found, whole);
      else setError(whole || errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function reset(): Promise<void> {
    setConfirmReset(false);
    setBusy(true);
    setError(null);
    try {
      adopt(await (source?.reset ? source.reset() : resetConversation(tenantId)));
      select(null);
      setSaved(words.resetDone);
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
    ends,
    onSelect: select,
    onDraft: edit,
  };
  const canReset = !source || source.reset !== undefined;

  return (
    <div className="flow-editor">
      <div className="flow-bar">
        <ViewSwitch mode={mode} onChange={setMode} />
        <p className="muted small flow-bar-lead">{readOnly ? words.readOnlyLead : words.lead}</p>
        {readOnly ? null : (
          <div className="flow-bar-actions">
            {dirty ? <span className="muted small">Unsaved changes</span> : null}
            {canReset ? (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setConfirmReset(true)}
              >
                {words.reset}
              </button>
            ) : null}
            <button type="button" className="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : words.save}
            </button>
          </div>
        )}
      </div>
      {confirmReset && canReset ? (
        <div className="flow-confirm" role="alertdialog" aria-label={`${words.reset}?`}>
          <p>{words.resetWarning}</p>
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
            suggestions={suggestions}
            removing={removing}
            onRemove={askRemove}
            onConfirmRemove={removeNow}
            onCancelRemove={() => setRemoving(null)}
          />
          <section className="flow-card" aria-label={`How ${assistant} asks it`}>
            <h3>How {assistant} asks it</h3>
            <ChatPreview
              tenantId={tenantId}
              flow={flow}
              ctx={ctx}
              selectedId={selectedId}
              ends={ends}
              {...(source ? { preview: source.preview.bind(source) } : {})}
            />
            {source?.previewExtra}
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
