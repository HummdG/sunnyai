'use client';

import { useEffect, useRef } from 'react';

import type { Workflow } from '../../../lib/portal-api.js';

/** The built-in solar workflow, which "Copy of Solar quote" copies when it is there. */
const SOLAR_ID = 'wf_solar';

/** Where a new workflow starts: the solar template, nothing, or a copy of one already here. */
export type NewFrom = 'solar_quote' | 'blank' | { copy: string };

/** The choices for a new workflow, with the first focused as it opens. */
export function NewWorkflow({
  workflows,
  busy,
  onPick,
  onCancel,
}: {
  workflows: Workflow[];
  busy: boolean;
  onPick: (from: NewFrom) => void;
  onCancel: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);

  const options: Array<{ key: string; title: string; from: NewFrom }> = [
    { key: 'solar_quote', title: 'Copy of Solar quote', from: 'solar_quote' },
    { key: 'blank', title: 'Start from blank', from: 'blank' },
    // The solar workflow's copy is the first choice already.
    ...workflows
      .filter((w) => w.id !== SOLAR_ID)
      .map((w) => ({
        key: `copy-${w.id}`,
        title: `Copy of ${w.name}`,
        from: { copy: w.id },
      })),
  ];

  return (
    <div
      className="flow-confirm wf-new"
      role="group"
      aria-label="Start a new workflow"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <p>Start a new workflow from:</p>
      <div className="actions">
        {options.map((o, index) => (
          <button
            key={o.key}
            ref={index === 0 ? first : undefined}
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => onPick(o.from)}
          >
            {o.title}
          </button>
        ))}
        <button type="button" className="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
