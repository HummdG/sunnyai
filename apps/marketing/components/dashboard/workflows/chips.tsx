'use client';

import { useId, useState } from 'react';

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
  /** Add what was typed: the problem to show, or null once it is in. */
  onAdd: (raw: string) => string | null;
  onRemove: (item: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

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
                  onClick={() => onRemove(item)}
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
            Add
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
