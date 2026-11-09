'use client';

import { useEffect, useRef } from 'react';

import type { FlowEffect, FlowStep } from '../../../lib/portal-api.js';
import { Chip } from '../ui.js';
import { Effects } from './effect-picker.js';
import { NothingSelected } from './nothing-selected.js';
import type { Suggestions } from './suggestions.js';
import { toneOf } from './flow-layout.js';
import {
  MAX_CHOICES,
  MAX_DEPTH,
  addFollowUp,
  changesQuote,
  choicesOf,
  depthOf,
  draftPath,
  isMember,
  membersOf,
  moveStep,
  nameOf,
  newChoiceValue,
  newQuestion,
  promptOf,
  subtreeIds,
  tagOf,
  type Context,
  type Draft,
  type EditorIssue,
} from './model.js';

export interface SelectedProps {
  draft: Draft;
  ctx: Context;
  readOnly: boolean;
  selectedId: string | null;
  issues: EditorIssue[];
  onSelect: (id: string | null) => void;
  /** A change to the shape of the conversation: add, remove, reorder. */
  onDraft: (change: (draft: Draft) => Draft) => void;
  /** A change to one question, wherever it sits (its issues clear: it was edited). */
  onEdit: (id: string, change: (step: FlowStep) => FlowStep) => void;
  /** What Sunny worked out or suggests for each answer's price changes. */
  suggestions: Suggestions;
  /** The question waiting for "Remove" to be confirmed, if any. */
  removing: string | null;
  onRemove: (id: string) => void;
  onConfirmRemove: (id: string) => void;
  onCancelRemove: () => void;
}

/**
 * The side column's "Selected question": its wording, its answers and what
 * each does to the quote, its follow-ups, and moving or removing it. A listed
 * question moves and is removed; a follow-up is only removed; a group member
 * (asked with its head) neither, though its wording, answers, effects and
 * follow-ups are its own. With nothing selected: a prompt and "+ Add a question".
 */
export function SelectedQuestion(props: SelectedProps) {
  const { draft, ctx, selectedId } = props;
  const path = selectedId ? draftPath(draft, ctx, selectedId) : null;
  const step = path?.[path.length - 1]?.step;
  if (!path || !step) return <NothingSelected {...props} />;
  return <StepEditor key={step.id} {...props} step={step} path={path} />;
}

function StepEditor({
  draft,
  ctx,
  readOnly,
  issues,
  onSelect,
  onDraft,
  onEdit,
  suggestions,
  removing,
  onRemove,
  onConfirmRemove,
  onCancelRemove,
  step,
  path,
}: SelectedProps & { step: FlowStep; path: Array<{ step: FlowStep; when: string | null }> }) {
  const update = (change: (s: FlowStep) => FlowStep) => onEdit(step.id, change);
  const name = nameOf(step, ctx);
  const preset = step.kind === 'preset' ? ctx.presets.get(step.id) : undefined;
  const choices = choicesOf(step, ctx);
  const quote = changesQuote(step);
  const members = membersOf(step, draft, ctx);
  const member = isMember(ctx, step.id);
  const index = draft.steps.findIndex((s) => s.id === step.id);
  const depth = depthOf(draft, ctx, step.id);
  const parent = path.length > 1 ? path[path.length - 2]! : null;
  const ownIssues = issues.filter((i) => i.stepId === step.id && !i.choice);
  const below = subtreeIds(step, draft, ctx);
  const attention = issues.some((i) => below.has(i.stepId));
  const confirmRef = useRef<HTMLDivElement>(null);
  const confirming = removing === step.id;

  // "Remove" asked from the list or the card: the question is on screen, and so is the choice.
  useEffect(() => {
    if (!confirming) return;
    const el = confirmRef.current;
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  }, [confirming]);

  function setLabel(value: string, label: string): void {
    update((s) =>
      s.kind === 'preset'
        ? { ...s, labels: { ...s.labels, [value]: label } }
        : { ...s, choices: s.choices.map((c) => (c.value === value ? { ...c, label } : c)) },
    );
  }

  /** The installer's own change: Sunny never overwrites this answer again. */
  function setEffects(value: string, effects: FlowEffect[]): void {
    suggestions.markEdited(step.id, value);
    update((s) =>
      s.kind === 'preset'
        ? { ...s, effects: { ...s.effects, [value]: effects } }
        : { ...s, choices: s.choices.map((c) => (c.value === value ? { ...c, effects } : c)) },
    );
  }

  function removeChoice(value: string): void {
    update((s) =>
      s.kind === 'custom'
        ? {
            ...s,
            choices: s.choices.filter((c) => c.value !== value),
            // A follow-up only opens on an answer that still exists.
            followUps: (s.followUps ?? [])
              .map((f) => ({ ...f, when: f.when.filter((w) => w !== value) }))
              .filter((f) => f.when.length > 0),
          }
        : s,
    );
  }

  function followUp(value: string): void {
    const child = newQuestion();
    update((s) => addFollowUp(s, value, child));
    onSelect(child.id);
  }

  const parentChoice = parent
    ? choicesOf(parent.step, ctx).find((c) => c.value === parent.when)
    : undefined;

  return (
    <section className="flow-card" aria-label="Selected question" data-step-editor={step.id}>
      <div className="flow-card-head">
        <h3>Selected question</h3>
        <button
          type="button"
          className="flow-icon-button"
          aria-label="Close the selected question"
          onClick={() => onSelect(null)}
        >
          ✕
        </button>
      </div>
      <div className="chip-row">
        <span className="flow-tag" data-tone={toneOf(step)}>
          {tagOf(step, ctx)}
        </span>
        {attention ? <Chip tone="danger">Needs attention</Chip> : null}
      </div>
      {parent ? (
        <p className="muted small">
          {member ? 'Asked with ' : 'Asked after '}
          <button type="button" className="link-button" onClick={() => onSelect(parent.step.id)}>
            {nameOf(parent.step, ctx)}
          </button>
          {member
            ? ', when it applies. It moves and is removed with that question.'
            : ` when the answer is ${parentChoice?.label ?? parent.when ?? 'given'}.`}
        </p>
      ) : null}
      {ownIssues.length > 0 ? (
        <ul className="issue-list">
          {ownIssues.map((issue, i) => (
            <li key={i} className="error">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <label className="field compact">
        <span>Question text</span>
        <textarea
          className="flow-question-text"
          rows={2}
          value={promptOf(step, ctx)}
          maxLength={300}
          disabled={readOnly}
          placeholder={preset?.prompt}
          onChange={(event) => {
            const prompt = event.target.value.replace(/\n/g, ' ');
            update((s) => ({ ...s, prompt }));
          }}
        />
      </label>
      {step.kind === 'custom' ? (
        <>
          <label className="field compact">
            <span>What the answer does</span>
            <select
              value={step.mode}
              disabled={readOnly}
              onChange={(event) => {
                const mode = event.target.value as 'quote' | 'lead';
                update((s) =>
                  s.kind === 'custom'
                    ? { ...s, mode, answer: mode === 'quote' ? 'choice' : s.answer }
                    : s,
                );
              }}
            >
              <option value="quote">Changes the quote</option>
              <option value="lead">Lead only (passed on with the lead)</option>
            </select>
          </label>
          {step.mode === 'lead' ? (
            <label className="field compact">
              <span>How the visitor answers</span>
              <select
                value={step.answer}
                disabled={readOnly}
                onChange={(event) => {
                  const answer = event.target.value as 'choice' | 'text';
                  update((s) =>
                    s.kind === 'custom'
                      ? {
                          ...s,
                          answer,
                          choices: s.choices.length > 0 ? s.choices : newQuestion().choices,
                        }
                      : s,
                  );
                }}
              >
                <option value="choice">Picks an answer</option>
                <option value="text">Types a short answer</option>
              </select>
            </label>
          ) : null}
        </>
      ) : null}
      {choices.length > 0 ? (
        <p className="flow-card-label">
          Answers
          {step.kind === 'preset' ? (
            <span className="muted"> (reword them; each still means the same to the quote)</span>
          ) : null}
        </p>
      ) : null}
      {quote && suggestions.checking(step.id) ? (
        <p className="muted small flow-checking">{ctx.assistant} is checking your price list…</p>
      ) : null}
      {choices.map((choice) => (
        <fieldset key={choice.value} className="flow-answer" aria-label={`Answer ${choice.label}`}>
          <div className="flow-answer-head">
            <input
              aria-label="Answer"
              value={choice.label}
              maxLength={80}
              disabled={readOnly}
              onChange={(event) => setLabel(choice.value, event.target.value)}
            />
            {!readOnly && step.kind === 'custom' && choices.length > 1 ? (
              <button
                type="button"
                className="flow-icon-button"
                aria-label={`Remove answer ${choice.label}`}
                onClick={() => removeChoice(choice.value)}
              >
                ✕
              </button>
            ) : null}
          </div>
          {quote ? (
            <Effects
              ctx={ctx}
              readOnly={readOnly}
              effects={choice.effects}
              onChange={(effects) => setEffects(choice.value, effects)}
              workedOut={suggestions.origin(step.id, choice.value) === 'suggested'}
              offer={choice.effects.length === 0 ? suggestions.offer(step.id, choice.value) : null}
              onUse={(effects) => {
                setEffects(choice.value, effects);
                suggestions.dismiss(step.id, choice.value);
              }}
              onDismiss={() => suggestions.dismiss(step.id, choice.value)}
            />
          ) : null}
          {issues
            .filter((i) => i.stepId === step.id && i.choice === choice.value)
            .map((issue, i) => (
              <p key={i} className="error-note small" role="alert">
                {issue.message}
              </p>
            ))}
          {(step.followUps ?? [])
            .filter((f) => f.when[0] === choice.value)
            .map((f) => (
              <button
                key={f.step.id}
                type="button"
                className="flow-card-link"
                aria-label={`Follow-up: ${nameOf(f.step, ctx)}`}
                onClick={() => onSelect(f.step.id)}
              >
                ↳ {nameOf(f.step, ctx)}
              </button>
            ))}
          {!readOnly && depth < MAX_DEPTH ? (
            <button type="button" className="link-button" onClick={() => followUp(choice.value)}>
              + Add a follow-up
            </button>
          ) : null}
        </fieldset>
      ))}
      {!readOnly &&
      step.kind === 'custom' &&
      step.answer === 'choice' &&
      step.choices.length < MAX_CHOICES ? (
        <button
          type="button"
          className="link-button"
          onClick={() =>
            update((s) =>
              s.kind === 'custom'
                ? {
                    ...s,
                    choices: [...s.choices, { value: newChoiceValue(), label: '', effects: [] }],
                  }
                : s,
            )
          }
        >
          + Add an answer
        </button>
      ) : null}
      {members.length > 0 ? (
        <div className="flow-members" role="group" aria-label="Linked questions">
          <p className="small">
            <strong>Asked next, when they apply.</strong>{' '}
            <span className="muted">They move and are removed with this question.</span>
          </p>
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              className="flow-card-link"
              onClick={() => onSelect(m.id)}
            >
              ↳ {nameOf(m, ctx)}
            </button>
          ))}
        </div>
      ) : null}
      {readOnly || member ? null : (
        <div className="flow-card-actions">
          {index >= 0 ? (
            <>
              <button
                type="button"
                className="button secondary"
                aria-label={`Move up: ${name}`}
                disabled={index === 0}
                onClick={() => onDraft((d) => ({ ...d, steps: moveStep(d.steps, step.id, -1) }))}
              >
                ↑ Up
              </button>
              <button
                type="button"
                className="button secondary"
                aria-label={`Move down: ${name}`}
                disabled={index === draft.steps.length - 1}
                onClick={() => onDraft((d) => ({ ...d, steps: moveStep(d.steps, step.id, 1) }))}
              >
                ↓ Down
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="button secondary danger-text"
            aria-label={`Remove: ${name}`}
            onClick={() => onRemove(step.id)}
          >
            Remove
          </button>
        </div>
      )}
      {confirming ? (
        <div
          ref={confirmRef}
          className="flow-confirm"
          role="alertdialog"
          aria-label={`Remove ${name}?`}
          tabIndex={-1}
        >
          <p>
            {/* The server words each warning as "Sunny uses this...": the installer's name for it. */}
            {preset?.warning?.replace(/^Sunny\b/, ctx.assistant) ??
              'This also removes the follow-ups under it.'}
          </p>
          <div className="actions">
            <button
              type="button"
              className="button danger"
              onClick={() => onConfirmRemove(step.id)}
            >
              Remove question
            </button>
            <button type="button" className="button secondary" onClick={onCancelRemove}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
