'use client';

import { groupMembers, newQuestion } from './model.js';
import type { SelectedProps } from './selected-question.js';

/** The side column with nothing picked: a prompt, "+ Add a question", and Sunny's removed ones. */
export function NothingSelected({ draft, ctx, readOnly, onDraft, onSelect }: SelectedProps) {
  const listed = new Set(draft.steps.map((s) => s.id));
  const members = groupMembers(ctx.presets.values());
  const removed = [...ctx.presets.values()].filter(
    (p) => !p.fixed && !members.has(p.id) && !listed.has(p.id),
  );

  function add(): void {
    const step = newQuestion();
    onDraft((d) => ({ ...d, steps: [...d.steps, step] }));
    onSelect(step.id);
  }

  return (
    <section className="flow-card" aria-label="Selected question">
      <h3>Selected question</h3>
      <p className="muted small">
        {readOnly
          ? 'Pick a question in the flow or the list to see its answers.'
          : 'Pick a question in the flow or the list to change its wording, its answers and what they do to the quote.'}
      </p>
      {readOnly ? null : (
        <div className="flow-card-add">
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
    </section>
  );
}
