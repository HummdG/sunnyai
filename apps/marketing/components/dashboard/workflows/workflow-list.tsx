'use client';

import { useState } from 'react';

import type { Workflow, WorkflowSetView } from '../../../lib/portal-api.js';
import { Toggle } from '../kit.js';
import { Chip } from '../ui.js';
import { kindBadge, outcomeLabel, pagesSummary } from './model.js';
import { NewWorkflow, type NewFrom } from './new-workflow.js';

/** WORKFLOW_LIMITS.workflows in @sunny/contracts. */
const MAX_WORKFLOWS = 12;

/** A workflow's on switch, named after it so each card's switch says whose it is. */
function EnabledSwitch({
  workflow,
  disabled,
  onChange,
}: {
  workflow: Workflow;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="toggle wf-switch">
      <input
        type="checkbox"
        role="switch"
        checked={workflow.enabled}
        disabled={disabled}
        aria-label={`Offer ${workflow.name}`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
      <span className="small" aria-hidden="true">
        {workflow.enabled ? 'On' : 'Off'}
      </span>
    </label>
  );
}

function WorkflowCard({
  workflow,
  issues,
  canEdit,
  busy,
  onToggle,
  onOpen,
  onDelete,
}: {
  workflow: Workflow;
  issues: string[];
  canEdit: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const badge = kindBadge(workflow);
  const builtIn = badge === 'Built in';
  return (
    <li className="quote-card wf-card">
      <div className="wf-card-head">
        <h3>{workflow.name}</h3>
        <Chip tone={builtIn ? 'orange' : 'neutral'}>{badge}</Chip>
        <span className="wf-card-switch">
          {canEdit ? (
            <EnabledSwitch workflow={workflow} disabled={busy} onChange={onToggle} />
          ) : (
            <span className="muted small">{workflow.enabled ? 'On' : 'Off'}</span>
          )}
        </span>
      </div>
      <dl className="wf-shown-list">
        <div className="wf-shown">
          <dt>Ends with</dt>
          <dd>{outcomeLabel(workflow.outcome)}</dd>
        </div>
        <div className="wf-shown">
          <dt>Pages</dt>
          <dd>{pagesSummary(workflow.pages)}</dd>
        </div>
      </dl>
      {issues.length > 0 ? (
        <ul className="issue-list">
          {issues.map((message, i) => (
            <li key={i} className="small">
              {message}
            </li>
          ))}
        </ul>
      ) : null}
      {confirming ? (
        <div className="flow-confirm" role="alertdialog" aria-label={`Delete ${workflow.name}?`}>
          <p>
            This deletes {workflow.name} and its questions. Visitors are no longer offered it. You
            cannot undo this.
          </p>
          <div className="actions">
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              Delete
            </button>
            <button type="button" className="button secondary" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
      <div className="actions">
        <button type="button" className="button secondary" onClick={onOpen}>
          {canEdit ? 'Edit' : 'View'}
          <span className="sr-only"> {workflow.name}</span>
        </button>
        {canEdit && !builtIn && !confirming ? (
          <button
            type="button"
            className="button secondary danger-text"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Delete<span className="sr-only"> {workflow.name}</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Every workflow as a card, the gentle questions' switch above them and the
 * button for a new one. Viewers see the same, as text.
 */
export function WorkflowList({
  view,
  canEdit,
  assistant,
  busy,
  onToggle,
  onDiscovery,
  onOpen,
  onDelete,
  onCreate,
}: {
  view: WorkflowSetView;
  canEdit: boolean;
  assistant: string;
  busy: boolean;
  onToggle: (workflow: Workflow, enabled: boolean) => void;
  onDiscovery: (enabled: boolean) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: (from: NewFrom) => void;
}) {
  const [adding, setAdding] = useState(false);
  const { set } = view;
  const full = set.workflows.length >= MAX_WORKFLOWS;
  const help = `${assistant} asks what the visitor is looking for before suggesting a workflow.`;

  return (
    <div className="wf-list-page">
      <div className="flow-bar">
        <div className="flow-bar-lead">
          {canEdit ? (
            <Toggle
              checked={set.discovery.enabled}
              disabled={busy}
              label="Start with a few gentle questions"
              onChange={onDiscovery}
            />
          ) : (
            <p>
              <strong>Start with a few gentle questions:</strong>{' '}
              {set.discovery.enabled ? 'on' : 'off'}
            </p>
          )}
          <p className="muted small">{help}</p>
        </div>
        {canEdit ? (
          <div className="flow-bar-actions">
            {full ? (
              <span className="muted small">You can have up to {MAX_WORKFLOWS} workflows.</span>
            ) : null}
            <button
              type="button"
              className="button"
              disabled={busy || full}
              aria-expanded={adding}
              onClick={() => setAdding(true)}
            >
              New workflow
            </button>
          </div>
        ) : null}
      </div>
      {canEdit ? null : (
        <p className="muted small">
          You can look through the workflows. Ask an admin to change them.
        </p>
      )}
      {adding && canEdit ? (
        <NewWorkflow
          workflows={set.workflows}
          busy={busy}
          onPick={(from) => {
            setAdding(false);
            onCreate(from);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      {view.migrated ? (
        <p className="muted small">
          These workflows come from your earlier settings. They are kept once you save a change.
        </p>
      ) : null}
      {set.workflows.length === 0 ? (
        <p className="muted">No workflows yet.</p>
      ) : (
        <ul className="wf-list">
          {set.workflows.map((w) => (
            <WorkflowCard
              key={w.id}
              workflow={w}
              issues={view.issues.filter((i) => i.workflowId === w.id).map((i) => i.message)}
              canEdit={canEdit}
              busy={busy}
              onToggle={(enabled) => onToggle(w, enabled)}
              onOpen={() => onOpen(w.id)}
              onDelete={() => onDelete(w.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
