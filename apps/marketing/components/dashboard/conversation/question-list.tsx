'use client';

import { useState, type DragEvent, type ReactNode } from 'react';

import type { FlowStep } from '../../../lib/portal-api.js';
import { Chip } from '../ui.js';
import { FIXED_END, FIXED_START, toneOf } from './flow-layout.js';
import { Lock } from './flow-canvas.js';
import {
  choicesOf,
  effectsShort,
  groupMembers,
  moveStep,
  nameOf,
  newQuestion,
  placeBefore,
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
  /** Remove a question (asking first when it carries a warning or follow-ups). */
  onRemove: (id: string) => void;
}

/** The drag data a question row carries, so other drags (text, files) are ignored. */
const DRAG_TYPE = 'application/x-sunny-step';

/** "Yes: +£899 7kW EV charger", for each answer that changes the price. */
function summaryOf(step: FlowStep, ctx: Context): string {
  return choicesOf(step, ctx)
    .filter((c) => c.effects.length > 0)
    .map((c) => `${c.label}: ${effectsShort(c.effects, ctx)}`)
    .join('; ');
}

/**
 * The conversation as one compact list: a line per question with its tag and
 * what its answers do, follow-ups indented under the answer that opens them.
 * Rows select; editing happens in the side column.
 */
export function QuestionList(props: ListProps) {
  const { draft, readOnly, onSelect, onDraft } = props;
  const [dragging, setDragging] = useState<string | null>(null);

  function add(): void {
    const step = newQuestion();
    onDraft((d) => ({ ...d, steps: [...d.steps, step] }));
    onSelect(step.id);
  }

  return (
    <section className="flow-list" aria-label="Questions">
      <ol>
        <FixedRow name={FIXED_START} note="always first" />
        {draft.steps.map((step, index) => (
          <TopRow
            key={step.id}
            {...props}
            step={step}
            index={index}
            dragging={dragging}
            setDragging={setDragging}
          />
        ))}
        <FixedRow name={FIXED_END} note="always last" />
      </ol>
      {readOnly ? null : (
        <button type="button" className="link-button flow-list-add" onClick={add}>
          + Add a question
        </button>
      )}
    </section>
  );
}

function FixedRow({ name, note }: { name: string; note: string }) {
  return (
    <li className="flow-li" data-fixed="true" aria-label={name}>
      <Lock />
      <span className="flow-li-q">{name}</span>
      <span className="flow-li-note">{note}</span>
    </li>
  );
}

function TopRow(
  props: ListProps & {
    step: FlowStep;
    index: number;
    dragging: string | null;
    setDragging: (id: string | null) => void;
  },
) {
  const { step, index, ctx, draft, readOnly, onDraft, dragging, setDragging } = props;
  const linked = ctx.presets.get(step.id)?.group.length ?? 0;

  const dropHandlers = readOnly
    ? {}
    : {
        onDragOver: (event: DragEvent) => {
          // Only a question being dragged by its grip drops here (not text, say).
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        },
        onDrop: (event: DragEvent) => {
          const id = event.dataTransfer.getData(DRAG_TYPE);
          if (!id) return;
          event.preventDefault();
          onDraft((d) => ({ ...d, steps: placeBefore(d.steps, id, step.id) }));
          setDragging(null);
        },
      };

  return (
    <>
      <Row
        {...props}
        step={step}
        depth={0}
        when={null}
        note={
          linked > 0 ? (linked === 1 ? '1 linked question' : `${linked} linked questions`) : null
        }
        dragData={dragging === step.id ? 'true' : undefined}
        handlers={dropHandlers}
        grip={
          readOnly ? null : (
            <span
              className="flow-drag"
              draggable
              aria-hidden="true"
              title="Drag to reorder"
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, step.id);
                event.dataTransfer.effectAllowed = 'move';
                // After the drag has started: changing the page during dragstart cancels it.
                window.setTimeout(() => setDragging(step.id), 0);
              }}
              onDragEnd={() => setDragging(null)}
            >
              ⠿
            </span>
          )
        }
        moves={
          readOnly
            ? null
            : {
                up:
                  index === 0
                    ? null
                    : () => onDraft((d) => ({ ...d, steps: moveStep(d.steps, step.id, -1) })),
                down:
                  index === draft.steps.length - 1
                    ? null
                    : () => onDraft((d) => ({ ...d, steps: moveStep(d.steps, step.id, 1) })),
              }
        }
      />
      <FollowUpRows {...props} step={step} depth={1} />
    </>
  );
}

function FollowUpRows(props: ListProps & { step: FlowStep; depth: number }) {
  const { step, ctx, depth } = props;
  const choices = choicesOf(step, ctx);
  return (
    <>
      {(step.followUps ?? []).map((f) => {
        const labels = f.when.map((w) => choices.find((c) => c.value === w)?.label ?? w);
        return (
          <FollowUp
            key={f.step.id}
            {...props}
            step={f.step}
            depth={depth}
            when={labels.join(' or ')}
          />
        );
      })}
    </>
  );
}

function FollowUp(props: ListProps & { step: FlowStep; depth: number; when: string }) {
  return (
    <>
      <Row {...props} note={null} grip={null} moves={null} />
      <FollowUpRows {...props} depth={props.depth + 1} />
    </>
  );
}

/** One line: grip, the full question, what its answers do, its tag, and its buttons. */
function Row({
  step,
  depth,
  when,
  note,
  grip,
  moves,
  dragData,
  handlers = {},
  ctx,
  draft,
  readOnly,
  selectedId,
  issues,
  onSelect,
  onRemove,
}: ListProps & {
  step: FlowStep;
  depth: number;
  when: string | null;
  note: string | null;
  grip: ReactNode;
  moves: { up: (() => void) | null; down: (() => void) | null } | null;
  dragData?: string;
  handlers?: Record<string, unknown>;
}) {
  const name = nameOf(step, ctx);
  const summary = summaryOf(step, ctx);
  const below = subtreeIds(step, draft, ctx);
  const attention = issues.some((i) => below.has(i.stepId));
  const member = groupMembers(ctx.presets.values()).has(step.id);
  return (
    <li
      className="flow-li"
      aria-label={name}
      aria-current={selectedId === step.id ? 'true' : undefined}
      data-step-row={step.id}
      data-depth={depth}
      data-dragging={dragData}
      style={depth > 0 ? { marginLeft: depth * 30 } : undefined}
      {...handlers}
    >
      {grip}
      {when !== null ? <span className="flow-li-when">↳ if {when}:</span> : null}
      <button
        type="button"
        className="flow-li-q"
        data-depth={depth}
        onClick={() => onSelect(step.id)}
      >
        {name}
      </button>
      {summary ? <span className="flow-li-eff">{summary}</span> : null}
      {note ? <span className="flow-li-note">{note}</span> : null}
      <span className="flow-tag" data-tone={toneOf(step)}>
        {tagOf(step, ctx)}
      </span>
      {attention ? <Chip tone="danger">Needs attention</Chip> : null}
      {readOnly || member ? null : (
        <span className="flow-li-actions">
          {moves ? (
            <>
              <button
                type="button"
                className="flow-icon-button"
                aria-label={`Move up: ${name}`}
                disabled={!moves.up}
                onClick={moves.up ?? undefined}
              >
                ↑
              </button>
              <button
                type="button"
                className="flow-icon-button"
                aria-label={`Move down: ${name}`}
                disabled={!moves.down}
                onClick={moves.down ?? undefined}
              >
                ↓
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="flow-icon-button"
            aria-label={`Remove: ${name}`}
            onClick={() => onRemove(step.id)}
          >
            ✕
          </button>
        </span>
      )}
    </li>
  );
}
