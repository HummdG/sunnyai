'use client';

import { useState, type DragEvent } from 'react';

import type { FlowEffect, FlowStep } from '../../../lib/portal-api.js';
import { Chip } from '../ui.js';
import { Effects } from './effect-picker.js';
import {
  MAX_CHOICES,
  MAX_DEPTH,
  addFollowUp,
  changesQuote,
  choicesOf,
  deleteStep,
  membersOf,
  moveStep,
  nameOf,
  newChoiceValue,
  newQuestion,
  placeBefore,
  promptOf,
  subtreeIds,
  tagOf,
  type Context,
  type Draft,
  type EditorIssue,
} from './model.js';

export interface ListProps {
  draft: Draft;
  ctx: Context;
  readOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  issues: EditorIssue[];
  /** A change to the shape of the conversation: add, remove, reorder. */
  onDraft: (change: (draft: Draft) => Draft) => void;
  /** A change to one question, wherever it sits (its issues clear: it was edited). */
  onEdit: (id: string, change: (step: FlowStep) => FlowStep) => void;
}

/** The drag data a question row carries, so other drags (text, files) are ignored. */
const DRAG_TYPE = 'application/x-sunny-step';

/** What a row needs from the list it sits in. */
export interface RowEnv extends ListProps {
  open: Set<string>;
  dragging: string | null;
  setDragging: (id: string | null) => void;
}

/**
 * One question in the list, opening in place. A listed question can be dragged,
 * moved and removed; a follow-up only removed; a group member (asked with its
 * head) neither, though its wording, answers, effects and follow-ups are its own.
 */
export function StepRow({
  env,
  step,
  depth,
  index,
  member = false,
}: {
  env: RowEnv;
  step: FlowStep;
  depth: number;
  index?: number;
  member?: boolean;
}) {
  const { ctx, readOnly, selectedId, onSelect, onDraft, issues, draft } = env;
  const [confirming, setConfirming] = useState(false);
  const name = nameOf(step, ctx);
  const open = env.open.has(step.id);
  const preset = step.kind === 'preset' ? ctx.presets.get(step.id) : undefined;
  const top = depth === 0 && index !== undefined && !member;
  const linked = preset?.group.length ?? 0;
  const ownIssues = issues.filter((i) => i.stepId === step.id && !i.choice);
  // Anything wrong at or below this question shows here, even while it is closed.
  const below = subtreeIds(step, draft, ctx);
  const attention = issues.some((i) => below.has(i.stepId));
  const effectsAny = choicesOf(step, ctx).some((c) => c.effects.length > 0);

  function remove(): void {
    if (selectedId && below.has(selectedId)) onSelect(null);
    onDraft((d) => deleteStep(d, step.id));
  }

  function askRemove(): void {
    const risky = (preset?.warning ?? null) !== null || (step.followUps?.length ?? 0) > 0;
    if (risky) setConfirming(true);
    else remove();
  }

  const dropHandlers =
    top && !readOnly
      ? {
          onDragOver: (event: DragEvent) => {
            // Only a question being dragged by its handle drops here (not text, say).
            if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          },
          onDrop: (event: DragEvent) => {
            const id = event.dataTransfer.getData(DRAG_TYPE);
            if (!id) return;
            event.preventDefault();
            onDraft((d) => ({ ...d, steps: placeBefore(d.steps, id, step.id) }));
            env.setDragging(null);
          },
        }
      : {};

  return (
    <li
      className="flow-row"
      aria-label={name}
      aria-current={selectedId === step.id ? 'true' : undefined}
      data-step-row={step.id}
      data-dragging={env.dragging === step.id ? 'true' : undefined}
      {...dropHandlers}
    >
      <div className="flow-row-head">
        {top && !readOnly ? (
          <span
            className="flow-drag"
            draggable
            aria-hidden="true"
            title="Drag to reorder"
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, step.id);
              event.dataTransfer.effectAllowed = 'move';
              // After the drag has started: changing the page during dragstart cancels it.
              window.setTimeout(() => env.setDragging(step.id), 0);
            }}
            onDragEnd={() => env.setDragging(null)}
          >
            ⋮⋮
          </span>
        ) : null}
        <button
          type="button"
          className="flow-row-title"
          aria-expanded={open}
          onClick={() => onSelect(selectedId === step.id ? null : step.id)}
        >
          {name}
        </button>
        <span className="chip-row">
          <Chip tone={step.kind === 'preset' ? 'neutral' : 'orange'}>{tagOf(step)}</Chip>
          {step.kind === 'preset' && effectsAny ? (
            <Chip tone="orange">Changes the quote</Chip>
          ) : null}
          {attention ? <Chip tone="danger">Needs attention</Chip> : null}
        </span>
        {readOnly || member ? null : (
          <span className="flow-row-actions">
            {top ? (
              <>
                <button
                  type="button"
                  className="flow-icon-button"
                  aria-label={`Move up: ${name}`}
                  disabled={index === 0}
                  onClick={() => onDraft((d) => ({ ...d, steps: moveStep(d.steps, step.id, -1) }))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="flow-icon-button"
                  aria-label={`Move down: ${name}`}
                  disabled={index === draft.steps.length - 1}
                  onClick={() => onDraft((d) => ({ ...d, steps: moveStep(d.steps, step.id, 1) }))}
                >
                  ↓
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="link-button"
              aria-label={`Remove: ${name}`}
              onClick={askRemove}
            >
              Remove
            </button>
          </span>
        )}
      </div>
      {member ? (
        <p className="muted small">Asked with the question above, when it applies.</p>
      ) : null}
      {linked > 0 && !open ? (
        <p className="muted small">
          Asks {linked === 1 ? 'a linked question' : `${linked} linked questions`} when they apply.
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
      {confirming ? (
        <div className="flow-confirm" role="alertdialog" aria-label={`Remove ${name}?`}>
          <p>{preset?.warning ?? 'This also removes the follow-ups under it.'}</p>
          <div className="actions">
            <button type="button" className="button danger" onClick={remove}>
              Remove question
            </button>
            <button type="button" className="button secondary" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
      {open ? <StepBody env={env} step={step} depth={depth} /> : null}
    </li>
  );
}

function StepBody({ env, step, depth }: { env: RowEnv; step: FlowStep; depth: number }) {
  const { ctx, readOnly, onEdit, onSelect, issues, draft } = env;
  const update = (change: (s: FlowStep) => FlowStep) => onEdit(step.id, change);
  const members = membersOf(step, draft, ctx);
  const preset = step.kind === 'preset' ? ctx.presets.get(step.id) : undefined;
  const choices = choicesOf(step, ctx);
  const quote = changesQuote(step);

  function setLabel(value: string, label: string): void {
    update((s) =>
      s.kind === 'preset'
        ? { ...s, labels: { ...s.labels, [value]: label } }
        : { ...s, choices: s.choices.map((c) => (c.value === value ? { ...c, label } : c)) },
    );
  }

  function setEffects(value: string, effects: FlowEffect[]): void {
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

  return (
    <div className="flow-row-body">
      <label className="field">
        <span>Question text</span>
        <input
          value={promptOf(step, ctx)}
          maxLength={300}
          disabled={readOnly}
          placeholder={preset?.prompt}
          onChange={(event) => {
            const prompt = event.target.value;
            update((s) => ({ ...s, prompt }));
          }}
        />
      </label>
      {step.kind === 'custom' ? (
        <div className="field-row">
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
        </div>
      ) : null}
      {step.kind === 'preset' && choices.length > 0 ? (
        <p className="muted small">
          You can reword Sunny&apos;s answers. Each still means the same to the quote.
        </p>
      ) : null}
      {choices.map((choice) => (
        <fieldset key={choice.value} className="flow-answer" aria-label={`Answer ${choice.label}`}>
          <div className="flow-answer-head">
            <label className="field compact">
              <span>Answer</span>
              <input
                value={choice.label}
                maxLength={80}
                disabled={readOnly}
                onChange={(event) => setLabel(choice.value, event.target.value)}
              />
            </label>
            {!readOnly && step.kind === 'custom' && choices.length > 1 ? (
              <button
                type="button"
                className="link-button"
                aria-label={`Remove answer ${choice.label}`}
                onClick={() => removeChoice(choice.value)}
              >
                Remove answer
              </button>
            ) : null}
          </div>
          {quote ? (
            <Effects
              ctx={ctx}
              readOnly={readOnly}
              effects={choice.effects}
              onChange={(effects) => setEffects(choice.value, effects)}
            />
          ) : null}
          {issues
            .filter((i) => i.stepId === step.id && i.choice === choice.value)
            .map((issue, i) => (
              <p key={i} className="error-note small" role="alert">
                {issue.message}
              </p>
            ))}
          <ol className="flow-follow-ups">
            {(step.followUps ?? [])
              .filter((f) => f.when[0] === choice.value)
              .map((f) => (
                <StepRow key={f.step.id} env={env} step={f.step} depth={depth + 1} />
              ))}
          </ol>
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
        <div className="flow-members">
          <p className="small">
            <strong>Asked next, when they apply.</strong>{' '}
            <span className="muted">They move and are removed with this question.</span>
          </p>
          <ol className="flow-follow-ups" aria-label="Linked questions">
            {members.map((m) => (
              // Stored as its own step, so its follow-ups nest from zero.
              <StepRow key={m.id} env={env} step={m} depth={0} member />
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
