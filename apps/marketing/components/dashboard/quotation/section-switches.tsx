'use client';

import { useId } from 'react';

import type { SectionKey } from './model.js';

const ROWS: Array<{ key: SectionKey | 'cover' | 'quotation'; name: string; sub: string }> = [
  { key: 'cover', name: 'Cover page', sub: "Your logo, the customer's address and the system" },
  { key: 'system', name: 'Your system', sub: 'Each part with its warranty, and the roof plan' },
  {
    key: 'performance',
    name: 'System performance',
    sub: 'Monthly generation and the MCS calculation',
  },
  { key: 'savings', name: 'Savings and payback', sub: 'Savings over 25 years and the payback' },
  {
    key: 'quotation',
    name: 'Estimated quotation',
    sub: 'The price, the deposit and how to go ahead',
  },
  {
    key: 'terms',
    name: 'Your terms and conditions',
    sub: 'The text below, on its own pages at the end',
  },
];

function Row({
  name,
  sub,
  checked,
  locked,
  onChange,
}: {
  name: string;
  sub: string;
  checked: boolean;
  locked: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="quote-sec toggle" data-locked={locked || undefined}>
      <span className="quote-sec-name">
        <span id={`${id}-name`}>{name}</span>
        <span className="quote-sec-sub" id={`${id}-sub`}>
          {sub}
        </span>
      </span>
      {locked ? <span className="quote-lock">Always shown</span> : null}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={locked}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-sub`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
    </label>
  );
}

/**
 * What the PDF includes: a switch per optional page. Cover and Quotation are
 * locked on, and say so, since the estimate wording lives on them.
 */
export function SectionSwitches({
  sections,
  termsBlank,
  onChange,
}: {
  sections: Record<SectionKey, boolean>;
  /** No T&Cs pasted yet: the Terms page has nothing to print. */
  termsBlank: boolean;
  onChange: (key: SectionKey, on: boolean) => void;
}) {
  return (
    <div className="quote-secs">
      {ROWS.map((row) =>
        row.key === 'cover' || row.key === 'quotation' ? (
          <Row key={row.key} name={row.name} sub={row.sub} checked locked onChange={() => {}} />
        ) : (
          <Row
            key={row.key}
            name={row.name}
            sub={
              row.key === 'terms' && termsBlank
                ? 'Paste them below first: until then there is nothing to print'
                : row.sub
            }
            checked={sections[row.key]}
            locked={false}
            onChange={(on) => onChange(row.key as SectionKey, on)}
          />
        ),
      )}
    </div>
  );
}
