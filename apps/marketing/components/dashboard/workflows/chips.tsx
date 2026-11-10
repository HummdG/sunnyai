'use client';

import { useId, useRef, useState } from 'react';

/**
 * What is typed in a chip field and why it was refused, held by the card, so
 * its Save can add text still in the field (or say why it cannot).
 */
export interface ChipDraft {
  text: string;
  problem: string | null;
  setText: (text: string) => void;
  setProblem: (problem: string | null) => void;
}

export function useChipDraft(): ChipDraft {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return { text, problem, setText, setProblem };
}

/**
 * A short list of words or page paths, each a chip with its own remove
 * button, and a field to add one more. Read-only, the chips alone.
 */
export function Chips({
  label,
  hint,
  items,
  readOnly,
  empty,
  placeholder,
  maxLength,
  draft,
  onAdd,
  onRemove,
}: {
  label: string;
  hint?: string;
  items: string[];
  readOnly: boolean;
  /** Shown when there are none. */
  empty: string;
  placeholder?: string;
  maxLength?: number;
  /** The field's text and problem, from `useChipDraft` in the card that saves it. */
  draft: ChipDraft;
  /** Add what was typed: the problem to show, or null once it is in. */
  onAdd: (raw: string) => string | null;
  onRemove: (item: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const { text, problem, setText, setProblem } = draft;

  function add(): void {
    const found = onAdd(text);
    setProblem(found);
    if (found === null) setText('');
  }

  return (
    <div className="field wf-chips-field">
      <span id={`${id}-label`}>{label}</span>
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {items.length === 0 ? (
        <span className="muted small">{empty}</span>
      ) : (
        <ul className="wf-chips" aria-labelledby={`${id}-label`}>
          {items.map((item) => (
            <li key={item} className="chip">
              <span>{item}</span>
              {readOnly ? null : (
                <button
                  type="button"
                  className="wf-chip-remove"
                  aria-label={`Remove ${item}`}
                  onClick={() => {
                    onRemove(item);
                    // The chip and its button are gone: carry on from the field.
                    input.current?.focus();
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <div className="wf-chip-add">
          <input
            ref={input}
            value={text}
            placeholder={placeholder}
            maxLength={maxLength}
            aria-labelledby={`${id}-label`}
            aria-describedby={hint ? `${id}-hint` : undefined}
            aria-invalid={problem ? true : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              add();
            }}
          />
          <button type="button" className="button secondary" onClick={add}>
            Add<span className="sr-only"> to {label}</span>
          </button>
        </div>
      )}
      {problem ? (
        <span className="quote-problem" role="alert">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
