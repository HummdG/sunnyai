'use client';

import { useState } from 'react';

import { Chip } from '../ui.js';
import { draftPath, groupMembers, newQuestion } from './model.js';
import { StepRow, type ListProps, type RowEnv } from './step-row.js';

export type { ListProps };

/**
 * The question list: the conversation top to bottom, fixed start and end
 * locked, each question opening in place with its answers and what each
 * answer does to the quote.
 */
export function QuestionList(props: ListProps) {
  const { draft, ctx, readOnly, selectedId, onSelect, onDraft } = props;
  const [dragging, setDragging] = useState<string | null>(null);
  // The selected question is open, and so is everything it sits under.
  const open = new Set(
    (selectedId ? draftPath(draft, ctx, selectedId) : null)?.map((p) => p.step.id),
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
    onDraft((d) => ({ ...d, steps: [...d.steps, step] }));
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
                  onDraft((d) => ({ ...d, steps: [...d.steps, { kind: 'preset', id }] }));
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
