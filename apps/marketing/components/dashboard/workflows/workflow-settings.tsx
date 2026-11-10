'use client';

import { useId, type ReactNode } from 'react';

import type { Workflow, WorkflowOutcome } from '../../../lib/portal-api.js';
import { Chips, useChipDraft } from './chips.js';
import { addTrigger, outcomeLabel, TRIGGER_LIMITS } from './model.js';

/** WORKFLOW_LIMITS in @sunny/contracts, kept here so zod stays out of the page. */
const LIMITS = { name: 60, description: 300 } as const;

type Interest = Workflow['interests'][number];

/** The discovery question's own labels (`disc_interest` in the API's questionnaire). */
const INTERESTS: Array<{ key: Interest; label: string }> = [
  { key: 'solar', label: 'Solar panels' },
  { key: 'battery', label: 'A battery' },
  { key: 'heating', label: 'Heating (heat pumps)' },
  { key: 'ev_charger', label: 'An EV charger' },
  { key: 'not_sure', label: 'Not sure yet' },
];

const LEAD: WorkflowOutcome = { kind: 'lead' };
const SOLAR: WorkflowOutcome = { kind: 'quote', engine: 'solar' };
const HEAT_PUMP: WorkflowOutcome = { kind: 'quote', engine: 'heat_pump' };

/** What the settings card edits: everything but the pages, the questions and the switch. */
export type SettingsDraft = Pick<
  Workflow,
  'name' | 'description' | 'triggers' | 'interests' | 'outcome'
>;

export function settingsOf(w: Workflow): SettingsDraft {
  return {
    name: w.name,
    description: w.description,
    triggers: w.triggers,
    interests: w.interests,
    outcome: w.outcome,
  };
}

/** What stops the settings saving, or null. */
export function settingsProblem(draft: SettingsDraft): string | null {
  return draft.name.trim() === '' ? 'Give the workflow a name.' : null;
}

const outcomeKey = (o: WorkflowOutcome) => (o.kind === 'lead' ? 'lead' : o.engine);

/** One part of a workflow saved on its own: its Save button, and how the last save went. */
export interface PartState {
  dirty: boolean;
  busy: boolean;
  error: string | null;
  saved: string | null;
}

/** A card's Save button and its notes. Viewers see none of it. */
export function SaveRow({
  label,
  state,
  blocked,
  onSave,
}: {
  label: string;
  state: PartState;
  /** Why it cannot save yet, shown in place of the error. */
  blocked?: string | null;
  onSave: () => void;
}) {
  return (
    <div className="wf-save">
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={state.busy || !state.dirty || Boolean(blocked)}
          onClick={onSave}
        >
          {state.busy ? 'Saving…' : label}
        </button>
        {state.dirty ? <span className="muted small">Unsaved changes</span> : null}
      </div>
      {blocked ? (
        <span className="quote-problem" role="alert">
          {blocked}
        </span>
      ) : state.error ? (
        <span className="quote-problem" role="alert">
          {state.error}
        </span>
      ) : null}
      {state.saved ? (
        <span className="wf-saved small" role="status">
          {state.saved}
        </span>
      ) : null}
    </div>
  );
}

/** A labelled value, for viewers. */
function Shown({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wf-shown">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A workflow's name, what it is for, the words that bring it up, the
 * interests that lead to it and how it ends. Built-ins keep their outcome.
 */
export function WorkflowSettings({
  draft,
  builtIn,
  readOnly,
  assistant,
  state,
  onChange,
  onSave,
}: {
  draft: SettingsDraft;
  builtIn: boolean;
  readOnly: boolean;
  assistant: string;
  state: PartState;
  onChange: (change: (current: SettingsDraft) => SettingsDraft) => void;
  /** Save these settings: the draft, with any trigger still typed added. */
  onSave: (draft: SettingsDraft) => void;
}) {
  const id = useId();
  const triggerDraft = useChipDraft();
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) =>
    onChange((d) => ({ ...d, [key]: value }));
  const outcomes = [LEAD, SOLAR, HEAT_PUMP];
  // A custom workflow made elsewhere may end in another quote: keep it on the list.
  if (!outcomes.some((o) => outcomeKey(o) === outcomeKey(draft.outcome))) {
    outcomes.push(draft.outcome);
  }

  if (readOnly) {
    const interests = INTERESTS.filter((i) => draft.interests.includes(i.key));
    return (
      <section className="quote-card" aria-labelledby={id}>
        <h3 id={id}>Settings</h3>
        <dl className="wf-shown-list">
          <Shown label="Name">{draft.name}</Shown>
          <Shown label="What it is for">{draft.description || 'Not described yet.'}</Shown>
          <Shown label="Brought up by">
            {draft.triggers.length > 0 ? draft.triggers.join(', ') : 'No phrases yet.'}
          </Shown>
          <Shown label="Offered for">
            {interests.length > 0 ? interests.map((i) => i.label).join(', ') : 'No interests.'}
          </Shown>
          <Shown label="Ends with">{outcomeLabel(draft.outcome)}</Shown>
        </dl>
      </section>
    );
  }

  const problem = settingsProblem(draft);
  const typed = triggerDraft.text.trim() !== '';

  // A trigger left in its field is added as Add would, or stops the save with its reason.
  function save(): void {
    if (!typed) return onSave(draft);
    const added = addTrigger(draft.triggers, triggerDraft.text);
    triggerDraft.setProblem(added.error);
    if (added.error !== null) return;
    triggerDraft.setText('');
    const next = { ...draft, triggers: added.triggers };
    onChange(() => next);
    onSave(next);
  }

  return (
    <section className="quote-card" aria-labelledby={id}>
      <h3 id={id}>Settings</h3>
      <label className="field">
        <span>Name</span>
        <input
          value={draft.name}
          maxLength={LIMITS.name}
          required
          aria-invalid={problem ? true : undefined}
          onChange={(event) => set('name', event.target.value)}
        />
      </label>
      <label className="field">
        <span>Description</span>
        <span className="hint" id={`${id}-description`}>
          {assistant} reads this to decide when to offer it.
        </span>
        <textarea
          value={draft.description}
          maxLength={LIMITS.description}
          aria-describedby={`${id}-description`}
          onChange={(event) => set('description', event.target.value)}
        />
      </label>
      <Chips
        label="Triggers"
        hint='Things a visitor might say, like "battery quote".'
        items={draft.triggers}
        readOnly={false}
        empty="None yet."
        maxLength={TRIGGER_LIMITS.chars}
        draft={triggerDraft}
        onAdd={(raw) => {
          const added = addTrigger(draft.triggers, raw);
          if (added.error === null) set('triggers', added.triggers);
          return added.error;
        }}
        onRemove={(item) =>
          set(
            'triggers',
            draft.triggers.filter((t) => t !== item),
          )
        }
      />
      <fieldset className="field wf-interests">
        <legend>Interests</legend>
        <span className="hint">
          Offered when a visitor picks one of these in the gentle questions.
        </span>
        {INTERESTS.map((i) => (
          <label key={i.key} className="check wf-check">
            <input
              type="checkbox"
              checked={draft.interests.includes(i.key)}
              onChange={(event) =>
                set(
                  'interests',
                  event.target.checked
                    ? INTERESTS.map((x) => x.key).filter(
                        (k) => k === i.key || draft.interests.includes(k),
                      )
                    : draft.interests.filter((k) => k !== i.key),
                )
              }
            />{' '}
            {i.label}
          </label>
        ))}
      </fieldset>
      {builtIn ? (
        <div className="field">
          <span>Outcome</span>
          <span>{outcomeLabel(draft.outcome)}</span>
          <span className="hint">A built-in workflow always ends this way.</span>
        </div>
      ) : (
        <label className="field">
          <span>Outcome</span>
          <select
            value={outcomeKey(draft.outcome)}
            onChange={(event) =>
              set(
                'outcome',
                outcomes.find((o) => outcomeKey(o) === event.target.value) ?? draft.outcome,
              )
            }
          >
            {outcomes.map((o) => (
              <option key={outcomeKey(o)} value={outcomeKey(o)}>
                {outcomeLabel(o)}
              </option>
            ))}
          </select>
        </label>
      )}
      <SaveRow
        label="Save settings"
        state={{ ...state, dirty: state.dirty || typed }}
        blocked={problem}
        onSave={save}
      />
    </section>
  );
}
