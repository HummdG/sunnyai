'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiFailure,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  getWorkflows,
  previewWorkflow,
  resetWorkflow,
  saveWorkflow,
  saveWorkflowSettings,
  suggestWorkflowPriceChanges,
  workflowIssuesOf,
  type PageRule,
  type PresetView,
  type PriceItemView,
  type Workflow,
  type WorkflowIssue,
  type WorkflowSetView,
  type WorkflowView,
} from '../../../lib/portal-api.js';
import {
  ConversationEditor,
  type EditorSource,
  type EditorView,
  type EditorWords,
} from '../conversation/editor.js';
import { workflowEnd } from '../conversation/flow-layout.js';
import { stepIssues } from '../conversation/model.js';
import { SunnyLoading } from '../kit.js';
import { Chip, ErrorNote, errorText } from '../ui.js';
import { kindBadge, withFlow, workflowFlow } from './model.js';
import type { NewFrom } from './new-workflow.js';
import { PagePreview, PageRules } from './page-rules.js';
import { WorkflowList } from './workflow-list.js';
import {
  settingsOf,
  WorkflowSettings,
  type PartState,
  type SettingsDraft,
} from './workflow-settings.js';

const STALE = 'Someone else changed this workflow. Reload to see their changes.';

const isConflict = (failure: unknown) => failure instanceof ApiFailure && failure.status === 409;

/** What a refused save said: its flags (warnings never stop a save), else the error. */
function refusalText(failure: unknown): string {
  const found = workflowIssuesOf(failure).filter((i) => !i.warning);
  return found.length > 0 ? found.map((i) => i.message).join(' ') : errorText(failure);
}

/** Someone saved first: say so, with the way to see their version. */
function Conflict({ onReload }: { onReload: () => void }) {
  return (
    <div className="error-note wf-conflict" role="alert">
      <span>{STALE}</span>
      <button type="button" className="button secondary" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}

/**
 * Studio's "Your workflows": every guided task the assistant can offer, as a
 * list, and one workflow at a time in detail (its settings, its pages and its
 * questions). Admins and owners edit; viewers see it all read-only.
 */
export function WorkflowsTab({
  tenantId,
  canEdit,
  assistant,
}: {
  tenantId: string;
  canEdit: boolean;
  /** What the installer calls the assistant: a rename on another tab shows here at once. */
  assistant: string;
}) {
  const [view, setView] = useState<WorkflowSetView | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped by Reload: the detail mounts afresh, unsaved edits and all.
  const [reloads, setReloads] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const loadList = useCallback(() => {
    setConflict(false);
    getWorkflows(tenantId)
      .then((next) => {
        setView(next);
        setError(null);
      })
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenantId]);

  useEffect(loadList, [loadList]);

  async function run(call: () => Promise<WorkflowSetView>): Promise<WorkflowSetView | null> {
    setBusy(true);
    setError(null);
    try {
      const next = await call();
      setView(next);
      return next;
    } catch (failure) {
      if (isConflict(failure)) setConflict(true);
      else setError(refusalText(failure));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function create(from: NewFrom): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const made = await createWorkflow(tenantId, from);
      setView(made.view);
      setOpenId(made.workflow.id);
    } catch (failure) {
      setError(refusalText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (openId !== null) {
    return (
      <WorkflowDetail
        key={`${openId}:${reloads}`}
        tenantId={tenantId}
        workflowId={openId}
        canEdit={canEdit}
        assistant={assistant}
        onBack={() => {
          setOpenId(null);
          loadList();
        }}
        onReload={() => setReloads((n) => n + 1)}
      />
    );
  }

  if (!view) {
    return error ? <ErrorNote error={error} /> : <SunnyLoading text="Loading your workflows…" />;
  }

  return (
    <div className="wf-tab">
      {conflict ? <Conflict onReload={loadList} /> : null}
      <ErrorNote error={error} />
      <WorkflowList
        view={view}
        canEdit={canEdit}
        assistant={assistant}
        busy={busy}
        onToggle={(w, enabled) => void run(() => saveWorkflow(tenantId, { ...w, enabled }))}
        onDiscovery={(enabled) =>
          void run(() => saveWorkflowSettings(tenantId, { discoveryEnabled: enabled }))
        }
        onOpen={setOpenId}
        onDelete={(id) => void run(() => deleteWorkflow(tenantId, id))}
        onCreate={(from) => void create(from)}
      />
    </div>
  );
}

/** The editor's view of a workflow: its steps as a flow, and the flags beside its questions. */
function editorViewOf(
  w: Workflow,
  presets: PresetView[],
  priceItems: PriceItemView[],
  issues: WorkflowIssue[],
): EditorView {
  return {
    flow: workflowFlow(w),
    presets,
    priceItems,
    issues: stepIssues(issues.filter((i) => i.workflowId === w.id)),
  };
}

const IDLE: PartState = { dirty: false, busy: false, error: null, saved: null };
type Part = Omit<PartState, 'dirty'>;

/**
 * One workflow: a way back, its settings and pages (each saved by its own
 * button), then its questions in the question editor. Every save sends the
 * whole workflow at the version last loaded, so a save made elsewhere in
 * between is refused rather than overwritten.
 */
function WorkflowDetail({
  tenantId,
  workflowId,
  canEdit,
  assistant,
  onBack,
  onReload,
}: {
  tenantId: string;
  workflowId: string;
  canEdit: boolean;
  assistant: string;
  onBack: () => void;
  onReload: () => void;
}) {
  const [loaded, setLoaded] = useState<WorkflowView | null>(null);
  const [current, setCurrent] = useState<Workflow | null>(null);
  // The last saved workflow, read when a save is sent (after another part's save, say).
  const currentRef = useRef<Workflow | null>(null);
  const [settings, setSettings] = useState<SettingsDraft | null>(null);
  const [pages, setPages] = useState<PageRule | null>(null);
  const [settingsPart, setSettingsPart] = useState<Part>(IDLE);
  const [pagesPart, setPagesPart] = useState<Part>(IDLE);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  function adopt(w: Workflow): void {
    currentRef.current = w;
    setCurrent(w);
  }

  useEffect(() => {
    getWorkflow(tenantId, workflowId)
      .then((next) => {
        adopt(next.workflow);
        setSettings(settingsOf(next.workflow));
        setPages(next.workflow.pages);
        setLoaded(next);
      })
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [tenantId, workflowId]);

  // Opened from the list: the workflow's name is where reading starts.
  useEffect(() => {
    if (loaded) heading.current?.focus();
  }, [loaded]);

  const back = (
    <button type="button" className="link-button wf-back" onClick={onBack}>
      <span aria-hidden="true">← </span>All workflows
    </button>
  );

  if (!loaded || !current || !settings || !pages) {
    return (
      <div className="wf-detail">
        {back}
        {error ? <ErrorNote error={error} /> : <SunnyLoading text="Loading the workflow…" />}
      </div>
    );
  }

  /** The saved workflow in a set the API sent back. */
  function pick(set: WorkflowSetView): Workflow {
    const found = set.set.workflows.find((w) => w.id === workflowId);
    if (!found) throw new Error('This workflow is no longer here. Go back to all workflows.');
    adopt(found);
    return found;
  }

  async function savePart(
    setPart: (part: Part) => void,
    patch: Partial<Workflow>,
    after: (saved: Workflow) => void,
  ): Promise<void> {
    setPart({ busy: true, error: null, saved: null });
    try {
      const saved = pick(await saveWorkflow(tenantId, { ...currentRef.current!, ...patch }));
      after(saved);
      setPart({ busy: false, error: null, saved: 'Saved.' });
    } catch (failure) {
      if (isConflict(failure)) setConflict(true);
      setPart({
        busy: false,
        error: isConflict(failure) ? 'Not saved.' : refusalText(failure),
        saved: null,
      });
    }
  }

  const builtIn = kindBadge(current) === 'Built in';
  const readOnly = !canEdit;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  const words: EditorWords = {
    loading: 'Loading the workflow…',
    lead: `The questions ${assistant} asks in this workflow, in your order and your words.`,
    readOnlyLead: 'You can look through this workflow. Ask an admin to change it.',
    save: 'Save questions',
    saved: `Saved. ${assistant} asks these questions from the next conversation.`,
    reset: 'Reset to the template',
    resetWarning:
      "This puts back the template's questions, name, description, triggers, interests and outcome. Your added questions and price links are removed. Its pages, and whether it is on, stay as they are.",
    resetDone: 'Back to the template.',
  };

  const source: EditorSource = {
    load: () =>
      Promise.resolve(
        editorViewOf(loaded.workflow, loaded.presets, loaded.priceItems, loaded.issues),
      ),
    async save(flow) {
      try {
        const set = await saveWorkflow(tenantId, withFlow(currentRef.current!, flow));
        return editorViewOf(pick(set), set.presets, set.priceItems, set.issues);
      } catch (failure) {
        if (!isConflict(failure)) throw failure;
        setConflict(true);
        throw new Error('Your questions are not saved.');
      }
    },
    ...(builtIn
      ? {
          async reset() {
            const set = await resetWorkflow(tenantId, workflowId);
            const w = pick(set);
            // The template's name, description and the rest come back too.
            setSettings(settingsOf(w));
            setSettingsPart(IDLE);
            return editorViewOf(w, set.presets, set.priceItems, set.issues);
          },
        }
      : {}),
    async preview(flow, answers) {
      const result = await previewWorkflow(tenantId, withFlow(currentRef.current!, flow), answers);
      // The editor shows its own flags; the preview's are about the workflow as a whole.
      return { next: result.next, effects: result.effects, issues: [] };
    },
    suggest: (question) => suggestWorkflowPriceChanges(tenantId, workflowId, question),
    start: null,
    end: workflowEnd(settings.outcome.kind, assistant),
    words,
    previewExtra: <PagePreview tenantId={tenantId} workflow={{ ...current, pages }} />,
  };

  return (
    <div className="wf-detail">
      {back}
      <div className="wf-detail-head">
        <h2 ref={heading} tabIndex={-1}>
          {current.name}
        </h2>
        <Chip tone={builtIn ? 'orange' : 'neutral'}>{kindBadge(current)}</Chip>
        <span className="muted small">{current.enabled ? 'On' : 'Off'}</span>
      </div>
      {conflict ? <Conflict onReload={onReload} /> : null}
      <div className="wf-meta">
        <WorkflowSettings
          draft={settings}
          builtIn={builtIn}
          readOnly={readOnly}
          assistant={assistant}
          state={{ ...settingsPart, dirty: !same(settings, settingsOf(current)) }}
          onChange={(change) => {
            setSettings((d) => (d ? change(d) : d));
            setSettingsPart((p) => ({ ...p, saved: null }));
          }}
          onSave={() =>
            void savePart(
              setSettingsPart,
              { ...settings, name: settings.name.trim(), description: settings.description.trim() },
              (w) => setSettings(settingsOf(w)),
            )
          }
        />
        <PageRules
          rule={pages}
          readOnly={readOnly}
          state={{ ...pagesPart, dirty: !same(pages, current.pages) }}
          onChange={(rule) => {
            setPages(rule);
            setPagesPart((p) => ({ ...p, saved: null }));
          }}
          onSave={() => void savePart(setPagesPart, { pages }, (w) => setPages(w.pages))}
        />
      </div>
      <ConversationEditor
        key={workflowId}
        tenantId={tenantId}
        canEdit={canEdit}
        assistant={assistant}
        source={source}
      />
    </div>
  );
}
