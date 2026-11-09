'use client';

import { useEffect, useRef, useState } from 'react';

import {
  previewConversation,
  type ConversationFlow,
  type ConversationPreview,
} from '../../../lib/portal-api.js';
import { ErrorNote, errorText } from '../ui.js';
import { choicesOf, nameOf, pathTo, type Context } from './model.js';

/**
 * What a visitor sees: the selected question in the installer's own words, a
 * sample answer tapped from its choices, and exactly what that answer does to
 * the quote, priced by the API from the published list. Or the whole
 * conversation played through, question by question. No chat runs: no model,
 * no quota, no lead.
 */

/** The fixed start, answered: the roof is found and confirmed. */
const START: Record<string, string> = {
  address: 'Preview address',
  roof_confidence: 'high',
  roof_confirmed: 'yes',
};

type Effects = ConversationPreview['effects'];

/** Ask the API, dropping any answer that a newer request has overtaken. */
function useLatest() {
  const counter = useRef(0);
  return async <T,>(
    run: () => Promise<T>,
    done: (value: T) => void,
    fail: (e: unknown) => void,
  ) => {
    const mine = ++counter.current;
    try {
      const value = await run();
      if (mine === counter.current) done(value);
    } catch (error) {
      if (mine === counter.current) fail(error);
    }
  };
}

function EffectList({ effects }: { effects: Effects }) {
  if (effects.length === 0) return <p className="muted small">No change to the quote.</p>;
  return (
    <ul className="preview-effects">
      {effects.map((effect, i) => (
        <li key={i}>
          <span>{effect.label}</span>
          <strong>{effect.priceText}</strong>
        </li>
      ))}
    </ul>
  );
}

export function ChatPreview({
  tenantId,
  flow,
  ctx,
  selectedId,
}: {
  tenantId: string;
  flow: ConversationFlow;
  ctx: Context;
  selectedId: string | null;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="chat-preview">
      <p className="preview-note small">Sunny may phrase this more naturally in the chat.</p>
      {playing ? (
        <PlayThrough tenantId={tenantId} flow={flow} onStop={() => setPlaying(false)} />
      ) : (
        <Selected
          key={selectedId ?? ''}
          tenantId={tenantId}
          flow={flow}
          ctx={ctx}
          selectedId={selectedId}
        />
      )}
      {playing ? null : (
        <button type="button" className="button secondary" onClick={() => setPlaying(true)}>
          Play the whole conversation
        </button>
      )}
    </div>
  );
}

/** The selected question, with the answers that lead to it already given. */
function Selected({
  tenantId,
  flow,
  ctx,
  selectedId,
}: {
  tenantId: string;
  flow: ConversationFlow;
  ctx: Context;
  selectedId: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [effects, setEffects] = useState<Effects | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useLatest();
  // A group member Sunny words as standard is not listed in the flow: preview it alone.
  const chain = selectedId
    ? (pathTo(flow.steps, selectedId) ??
      (ctx.presets.has(selectedId)
        ? [{ step: { kind: 'preset' as const, id: selectedId }, when: null }]
        : null))
    : null;
  const flowJson = JSON.stringify(flow);

  useEffect(() => {
    if (!chain || picked === null) return;
    const answers: Record<string, string> = { ...START };
    // A question that waits on an earlier answer (a group member) gets that answer.
    for (const link of chain) {
      const gate = ctx.presets.get(link.step.id)?.appearsWhen;
      if (gate) answers[gate.questionId] = gate.anyOf[0]!;
    }
    for (const link of chain.slice(0, -1)) if (link.when) answers[link.step.id] = link.when;
    const chosenId = chain[chain.length - 1]!.step.id;
    answers[chosenId] = picked;
    void latest(
      () => previewConversation(tenantId, JSON.parse(flowJson) as ConversationFlow, answers),
      (result) => {
        // Only what this answer does: the answers that lead to the question
        // are given too, and their own effects are not this answer's.
        setEffects(result.effects.filter((e) => e.questionId === chosenId && e.value === picked));
        setError(null);
      },
      (failure) => setError(errorText(failure)),
    );
  }, [tenantId, flowJson, selectedId, picked]);

  if (!chain) {
    return (
      <p className="muted">Pick a question in the list or the diagram to see how Sunny asks it.</p>
    );
  }
  const step = chain[chain.length - 1]!.step;
  const choices = choicesOf(step, ctx);
  const chosen = choices.find((c) => c.value === picked);

  return (
    <div className="transcript">
      {chain.slice(0, -1).map((link) => (
        <div key={link.step.id} className="transcript">
          <p className="bubble">{nameOf(link.step, ctx)}</p>
          <p className="bubble user">
            {choicesOf(link.step, ctx).find((c) => c.value === link.when)?.label ?? link.when}
          </p>
        </div>
      ))}
      <p className="bubble">{nameOf(step, ctx)}</p>
      {choices.length > 0 ? (
        <div className="preview-chips" role="group" aria-label="Sample answers">
          {choices.map((c) => (
            <button
              key={c.value}
              type="button"
              className="pill"
              aria-pressed={picked === c.value}
              onClick={() => setPicked(c.value)}
            >
              {c.label || 'Answer'}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small">The visitor types their answer.</p>
      )}
      {chosen ? <p className="bubble user">{chosen.label}</p> : null}
      {chosen && effects ? (
        <div className="preview-result">
          <p className="small">
            <strong>What this does to the quote</strong>
          </p>
          <EffectList effects={effects} />
        </div>
      ) : null}
      <ErrorNote error={error} />
    </div>
  );
}

/** The conversation from the top, as the flow asks it, one tapped answer at a time. */
function PlayThrough({
  tenantId,
  flow,
  onStop,
}: {
  tenantId: string;
  flow: ConversationFlow;
  onStop: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(START);
  const [said, setSaid] = useState<Array<{ id: string; prompt: string; answer: string }>>([]);
  const [result, setResult] = useState<ConversationPreview | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Start again", which may leave the answers exactly as they were.
  const [round, setRound] = useState(0);
  const latest = useLatest();
  const flowJson = JSON.stringify(flow);
  const answersJson = JSON.stringify(answers);

  useEffect(() => {
    void latest(
      () =>
        previewConversation(
          tenantId,
          JSON.parse(flowJson) as ConversationFlow,
          JSON.parse(answersJson) as Record<string, string>,
        ),
      (next) => {
        setResult(next);
        setError(null);
      },
      (failure) => setError(errorText(failure)),
    );
  }, [tenantId, flowJson, answersJson, round]);

  const next = result?.next ?? null;

  function answer(value: string, label: string): void {
    if (!next) return;
    setSaid((list) => [...list, { id: next.id, prompt: next.prompt, answer: label }]);
    setAnswers((current) => ({ ...current, [next.id]: value }));
    // Nothing to tap until the next question arrives, so one answer is never given twice.
    setResult(null);
    setTyped('');
  }

  function restart(): void {
    setResult(null);
    setSaid([]);
    setAnswers(START);
    setRound((n) => n + 1);
  }

  return (
    <div className="transcript">
      <p className="muted small">The address and roof check are done.</p>
      {said.map((line) => (
        <div key={line.id} className="transcript">
          <p className="bubble">{line.prompt}</p>
          <p className="bubble user">{line.answer}</p>
        </div>
      ))}
      {result === null ? null : next ? (
        <>
          <p className="bubble" data-asking={next.prompt}>
            {next.prompt}
          </p>
          {next.options.length > 0 ? (
            <div className="preview-chips" role="group" aria-label="Sample answers">
              {next.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="pill"
                  onClick={() => answer(o.value, o.label)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="preview-type"
              onSubmit={(event) => {
                event.preventDefault();
                if (typed.trim()) answer(typed.trim(), typed.trim());
              }}
            >
              <label className="field compact">
                <span>Sample answer</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} />
              </label>
              <button type="submit" className="button secondary">
                Send
              </button>
            </form>
          )}
        </>
      ) : (
        <p className="ok-note">
          Then Sunny shows the quote, and asks for consent and contact details.
        </p>
      )}
      {result ? (
        <div className="preview-result">
          <p className="small">
            <strong>The quote so far</strong>
          </p>
          <EffectList effects={result.effects} />
        </div>
      ) : null}
      <ErrorNote error={error} />
      <div className="actions">
        <button type="button" className="button secondary" onClick={restart}>
          Start again
        </button>
        <button type="button" className="link-button" onClick={onStop}>
          Back to the selected question
        </button>
      </div>
    </div>
  );
}
