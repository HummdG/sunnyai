'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { previewWorkflow, type PageRule, type Workflow } from '../../../lib/portal-api.js';
import { errorText } from '../ui.js';
import { Chips } from './chips.js';
import { addPattern, MAX_PATTERNS, pagesSummary, pathOf, removePattern, testUrl } from './model.js';
import { SaveRow, type PartState } from './workflow-settings.js';

type Mode = 'all' | 'only';

/** "Shows here" and its kin, from a test that could not read the address as null. */
function verdict(result: boolean | null, here: string): string {
  if (result === null) return 'Not a page address';
  return result ? `Shows ${here}` : `Does not show ${here}`;
}

/**
 * The pages a workflow is offered on: every page, or only some, and never the
 * ones listed under "But not these pages". A typed address is checked at once.
 */
export function PageRules({
  rule,
  readOnly,
  state,
  onChange,
  onSave,
}: {
  rule: PageRule;
  readOnly: boolean;
  state: PartState;
  onChange: (rule: PageRule) => void;
  onSave: () => void;
}) {
  const id = useId();
  // "Only these pages" with nothing listed yet is still a choice the installer made.
  const [mode, setMode] = useState<Mode>(rule.include.length > 0 ? 'only' : 'all');
  const [test, setTest] = useState('');
  const shownMode: Mode = rule.include.length > 0 ? 'only' : mode;

  function add(list: 'include' | 'exclude', raw: string): string | null {
    const result = addPattern(rule, list, raw);
    if (result.error === null) onChange(result.rule);
    return result.error;
  }

  if (readOnly) {
    return (
      <section className="quote-card" aria-labelledby={id}>
        <h3 id={id}>Pages</h3>
        <p className="hint">Where on your website this workflow is offered.</p>
        <p>{pagesSummary(rule)}</p>
      </section>
    );
  }

  const placeholder = '/offers/battery*';
  return (
    <section className="quote-card" aria-labelledby={id}>
      <h3 id={id}>Pages</h3>
      <p className="hint">
        Where on your website this workflow is offered. Use * for any part of one path segment and
        ** for anything after it.
      </p>
      <fieldset className="field wf-modes">
        <legend className="sr-only">Show this workflow on</legend>
        {(
          [
            ['all', 'All pages'],
            ['only', 'Only these pages'],
          ] as const
        ).map(([key, title]) => (
          <label key={key} className="check wf-check">
            <input
              type="radio"
              name={`${id}-mode`}
              checked={shownMode === key}
              onChange={() => {
                setMode(key);
                // All pages: the "only" list no longer applies.
                if (key === 'all' && rule.include.length > 0) onChange({ ...rule, include: [] });
              }}
            />{' '}
            {title}
          </label>
        ))}
      </fieldset>
      {shownMode === 'only' ? (
        <Chips
          label="Only these pages"
          items={rule.include}
          readOnly={false}
          empty="No pages yet: until you add one, it shows on every page."
          placeholder={placeholder}
          maxLength={512}
          onAdd={(raw) => add('include', raw)}
          onRemove={(item) => onChange(removePattern(rule, 'include', item))}
        />
      ) : null}
      <Chips
        label="But not these pages"
        hint={`Up to ${MAX_PATTERNS} in each list.`}
        items={rule.exclude}
        readOnly={false}
        empty="None."
        placeholder="/careers*"
        maxLength={512}
        onAdd={(raw) => add('exclude', raw)}
        onRemove={(item) => onChange(removePattern(rule, 'exclude', item))}
      />
      <label className="field">
        <span>Test a page</span>
        <input
          value={test}
          placeholder="https://yoursite.co.uk/offers/battery"
          aria-describedby={`${id}-test`}
          onChange={(event) => setTest(event.target.value)}
        />
        <span className="hint" id={`${id}-test`} aria-live="polite">
          {test.trim() === '' ? 'Type an address or a path.' : verdict(testUrl(rule, test), 'here')}
        </span>
      </label>
      <SaveRow label="Save pages" state={state} onSave={onSave} />
    </section>
  );
}

/**
 * The preview's "Preview on page": whether the workflow, as it stands now
 * (unsaved pages included), is offered on a page, asked of the workflow's
 * own preview route.
 */
export function PagePreview({ tenantId, workflow }: { tenantId: string; workflow: Workflow }) {
  const id = useId();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ asked: string; shows: boolean | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);
  const path = pathOf(text);
  const json = JSON.stringify(workflow);
  // What was asked: the page and the workflow, so an answer about either before an edit is not shown.
  const asked = `${path ?? ''}\n${json}`;

  useEffect(() => {
    const mine = ++counter.current;
    if (path === null) return;
    // Asked once the typing pauses.
    const timer = setTimeout(() => {
      previewWorkflow(tenantId, JSON.parse(json) as Workflow, {}, path)
        .then((preview) => {
          if (mine !== counter.current) return;
          setResult({ asked: `${path}\n${json}`, shows: preview.appearsOnPage });
          setError(null);
        })
        .catch((failure: unknown) => {
          if (mine === counter.current) setError(errorText(failure));
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [tenantId, json, path]);

  let note: string;
  if (text.trim() === '') note = 'Type a page address to check this workflow shows there.';
  else if (path === null) note = 'Not a page address';
  else if (error) note = error;
  else if (result && result.asked === asked && result.shows !== null) {
    note = result.shows ? 'Shows on this page' : 'Does not show on this page';
  } else note = 'Checking…';

  return (
    <label className="field compact wf-page-preview">
      <span>Preview on page</span>
      <input
        value={text}
        placeholder="/offers/battery"
        aria-describedby={`${id}-note`}
        onChange={(event) => setText(event.target.value)}
      />
      <span className="hint" id={`${id}-note`} aria-live="polite">
        {note}
      </span>
    </label>
  );
}
