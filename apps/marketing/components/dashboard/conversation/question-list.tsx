'use client';

import { useState, type DragEvent } from 'react';

import type { FlowEffect, FlowStep, PriceItemView } from '../../../lib/portal-api.js';
import { Chip } from '../ui.js';
import {
  MAX_CHOICES,
  MAX_DEPTH,
  addFollowUp,
  changesQuote,
  choicesOf,
  effectText,
  groupMembers,
  mapStep,
  moveStep,
  nameOf,
  needsQuantity,
  newChoiceValue,
  newQuestion,
  pathTo,
  placeBefore,
  promptOf,
  removeStep,
  tagOf,
  unitsWord,
  type Context,
  type Draft,
  type EditorIssue,
  type PresetStep,
} from './model.js';

interface ListProps {
  draft: Draft;
  ctx: Context;
  readOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  issues: EditorIssue[];
  onSteps: (change: (steps: FlowStep[]) => FlowStep[]) => void;
  onMembers: (change: (members: Draft['members']) => Draft['members']) => void;
}

/** The drag data a question row carries, so other drags (text, files) are ignored. */
const DRAG_TYPE = 'application/x-sunny-step';

/** What a row needs from the list it sits in. */
interface RowEnv extends ListProps {
  open: Set<string>;
  dragging: string | null;
  setDragging: (id: string | null) => void;
}

/**
 * The question list: the conversation top to bottom, fixed start and end
 * locked, each question opening in place with its answers and what each
 * answer does to the quote.
 */
export function QuestionList(props: ListProps) {
  const { draft, ctx, readOnly, selectedId, onSelect, onSteps } = props;
  const [dragging, setDragging] = useState<string | null>(null);
  const open = new Set(
    (selectedId ? pathTo(draft.steps, selectedId) : null)?.map((p) => p.step.id),
  );
  const env: RowEnv = { ...props, open, dragging, setDragging };

  const listed = new Set<string>();
  for (const s of draft.steps) listed.add(s.id);
  const members = groupMembers(ctx.presets.values());
  const removed = [...ctx.presets.values()].filter(
    (p) => !p.fixed && !members.has(p.id) && !listed.has(p.id),
  );
  const fixedStart = [...ctx.presets.values()].filter((p) => p.fixed);

  function add(): void {
    const step = newQuestion();
    onSteps((steps) => [...steps, step]);
    onSelect(step.id);
  }

  return (
    <div className="flow-list-wrap">
      <ol className="flow-list">
        <FixedRow
          name="Address and roof check"
          note="Always asked first"
          detail={fixedStart
            // The roof confidence is set by the roof check, not asked.
            .filter((p) => p.id !== 'roof_confidence')
            .map((p) => p.prompt)
            .join(' Then Sunny maps the roof: ')}
        />
        {draft.steps.map((step, index) => (
          <StepRow key={step.id} env={env} step={step} depth={0} index={index} />
        ))}
        <FixedRow
          name="Quote, consent and contact details"
          note="Always asked last"
          detail="Sunny shows the quote, then asks for consent and contact details."
        />
      </ol>
      {readOnly ? null : (
        <div className="flow-add">
          <button type="button" className="button secondary" onClick={add}>
            + Add a question
          </button>
          {removed.length > 0 ? (
            <label className="field compact">
              <span>Bring back one of Sunny&apos;s questions</span>
              <select
                value=""
                onChange={(event) => {
                  const id = event.target.value;
                  if (!id) return;
                  onSteps((steps) => [...steps, { kind: 'preset', id }]);
                  onSelect(id);
                }}
              >
                <option value="">Choose a question</option>
                {removed.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.prompt}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      )}
    </div>
  );
}

function FixedRow({ name, note, detail }: { name: string; note: string; detail: string }) {
  return (
    <li className="flow-row flow-row-fixed" aria-label={name}>
      <div className="flow-row-head">
        <span className="flow-lock" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </span>
        <strong className="flow-row-name">{name}</strong>
        <Chip>{note}</Chip>
      </div>
      <p className="muted small">{detail}</p>
    </li>
  );
}

function StepRow({
  env,
  step,
  depth,
  index,
}: {
  env: RowEnv;
  step: FlowStep;
  depth: number;
  index?: number;
}) {
  const { ctx, readOnly, selectedId, onSelect, onSteps, issues, draft } = env;
  const [confirming, setConfirming] = useState(false);
  const name = nameOf(step, ctx);
  const open = env.open.has(step.id);
  const preset = step.kind === 'preset' ? ctx.presets.get(step.id) : undefined;
  const top = depth === 0 && index !== undefined;
  const linked = preset?.group.length ?? 0;
  const ownIssues = issues.filter((i) => i.stepId === step.id && !i.choice);
  const effectsAny = choicesOf(step, ctx).some((c) => c.effects.length > 0);

  function remove(): void {
    if (selectedId && pathTo([step], selectedId)) onSelect(null);
    onSteps((steps) => removeStep(steps, step.id));
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
            onSteps((steps) => placeBefore(steps, id, step.id));
            env.setDragging(null);
          },
        }
      : {};

  return (
    <li
      className="flow-row"
      aria-label={name}
      aria-current={selectedId === step.id ? 'true' : undefined}
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
          {issues.some((i) => i.stepId === step.id) ? (
            <Chip tone="danger">Needs attention</Chip>
          ) : null}
        </span>
        {readOnly ? null : (
          <span className="flow-row-actions">
            {top ? (
              <>
                <button
                  type="button"
                  className="flow-icon-button"
                  aria-label={`Move up: ${name}`}
                  disabled={index === 0}
                  onClick={() => onSteps((steps) => moveStep(steps, step.id, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="flow-icon-button"
                  aria-label={`Move down: ${name}`}
                  disabled={index === draft.steps.length - 1}
                  onClick={() => onSteps((steps) => moveStep(steps, step.id, 1))}
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
  const { ctx, readOnly, onSteps, onSelect, issues } = env;
  const update = (change: (s: FlowStep) => FlowStep) =>
    onSteps((steps) => mapStep(steps, step.id, change));
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
      {preset && preset.group.length > 0 ? <Members env={env} group={preset.group} /> : null}
    </div>
  );
}

/** A preset's linked questions: asked right after it when they apply, reworded here. */
function Members({ env, group }: { env: RowEnv; group: string[] }) {
  const { ctx, readOnly, draft, onMembers } = env;
  return (
    <div className="flow-members">
      <p className="small">
        <strong>Asked next, when they apply.</strong>{' '}
        <span className="muted">They move and are removed with this question.</span>
      </p>
      {group.map((id) => {
        const base = ctx.presets.get(id);
        const own: PresetStep = draft.members[id] ?? { kind: 'preset', id };
        return (
          <label key={id} className="field compact">
            <span>Linked question</span>
            <input
              value={own.prompt ?? base?.prompt ?? ''}
              maxLength={300}
              disabled={readOnly}
              onChange={(event) => {
                const prompt = event.target.value;
                onMembers((members) => ({ ...members, [id]: { ...own, prompt } }));
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

/** An answer's price changes, in plain English, and the picker that adds one. */
function Effects({
  ctx,
  readOnly,
  effects,
  onChange,
}: {
  ctx: Context;
  readOnly: boolean;
  effects: FlowEffect[];
  onChange: (effects: FlowEffect[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="flow-effects">
      {effects.length === 0 ? (
        <p className="muted small">No change to the quote.</p>
      ) : (
        <ul>
          {effects.map((effect, i) => {
            const text = effectText(effect, ctx);
            return (
              <li key={i}>
                {text}
                {readOnly ? null : (
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`Remove price change: ${text}`}
                    onClick={() => onChange(effects.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {readOnly ? null : picking ? (
        <EffectPicker
          items={ctx.items}
          onAdd={(effect) => {
            onChange([...effects, effect]);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button type="button" className="link-button" onClick={() => setPicking(true)}>
          + Add a price change
        </button>
      )}
    </div>
  );
}

function ItemOptions({ items }: { items: PriceItemView[] }) {
  return (
    <>
      <option value="">Choose an item</option>
      {items.map((item) => (
        <option key={item.key} value={item.key} disabled={item.mandatory}>
          {item.name}, {item.priceText}
          {item.mandatory ? ' (on every quote, so it cannot change)' : ''}
        </option>
      ))}
    </>
  );
}

/** Pick an add, remove or swap from the published price list. */
function EffectPicker({
  items,
  onAdd,
  onCancel,
}: {
  items: PriceItemView[];
  onAdd: (effect: FlowEffect) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<FlowEffect['kind']>('add');
  const [itemKey, setItemKey] = useState('');
  const [fromKey, setFromKey] = useState('');
  const [quantity, setQuantity] = useState('');
  // Mandatory items are listed (disabled) so the installer sees why they are missing.
  const pickable = items.filter((i) => i.targetable || i.mandatory);

  if (items.length === 0) {
    return (
      <p className="muted small">
        Publish a price list first, on <a href="/dashboard/products/price-list">Price list</a>, to
        link answers to your prices.
      </p>
    );
  }

  const target = items.find((i) => i.key === itemKey);
  const askQuantity = kind !== 'remove' && target !== undefined && needsQuantity(target);
  const amount = Number(quantity);
  const quantityOk = !askQuantity || (Number.isInteger(amount) && amount > 0);
  const ready = itemKey !== '' && (kind !== 'swap' || fromKey !== '') && quantityOk;

  function add(): void {
    const q = askQuantity ? { quantity: amount } : {};
    if (kind === 'add') onAdd({ kind, itemKey, ...q });
    else if (kind === 'remove') onAdd({ kind, itemKey });
    else onAdd({ kind, fromKey, toKey: itemKey, ...q });
  }

  return (
    <div className="flow-picker">
      <label className="field compact">
        <span>What happens</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as FlowEffect['kind'])}>
          <option value="add">Adds an item</option>
          <option value="remove">Removes an item</option>
          <option value="swap">Swaps one item for another</option>
        </select>
      </label>
      {kind === 'swap' ? (
        <label className="field compact">
          <span>Swap out</span>
          <select value={fromKey} onChange={(e) => setFromKey(e.target.value)}>
            <ItemOptions items={pickable} />
          </select>
        </label>
      ) : null}
      <label className="field compact">
        <span>Item from your price list</span>
        <select value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
          <ItemOptions items={pickable} />
        </select>
      </label>
      {askQuantity ? (
        <label className="field compact">
          <span>How many {unitsWord(target.unitLabel)}</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
      ) : null}
      <div className="actions">
        <button type="button" className="button" disabled={!ready} onClick={add}>
          Add
        </button>
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
