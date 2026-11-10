'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  suggestPriceChanges,
  type FlowEffect,
  type FlowStep,
  type PriceSuggestion,
} from '../../../lib/portal-api.js';
import {
  MAX_CHOICES,
  choicesOf,
  draftPath,
  editStep,
  promptOf,
  rootsOf,
  walkSteps,
  type Context,
  type Draft,
} from './model.js';

/**
 * Sunny works out each answer's price changes.
 *
 * An added question asks once it has stopped changing (its wording, its
 * answers or what it does to the quote): the result fills in every answer the
 * installer has not touched, and refreshes answers Sunny filled earlier. An
 * answer whose price changes the installer added, changed or removed is
 * theirs, and is never overwritten; so is every answer of a question saved
 * before Studio opened, price change or none. Sunny's own questions are offered a
 * suggestion instead ("Use this?"), since applying one would quietly change
 * quotes for installers already live. None of this is saved: the stored flow
 * is the same whoever chose the price changes.
 */

/** How long a question must stop changing before Sunny is asked. */
export const SUGGEST_DEBOUNCE_MS = 800;

/** Who chose an answer's price changes this session: Sunny, or the installer. */
export type AnswerOrigin = 'suggested' | 'edited';

export interface Suggestions {
  /** Whether Sunny is working out this question's price changes now. */
  checking: (stepId: string) => boolean;
  origin: (stepId: string, value: string) => AnswerOrigin | undefined;
  /** The installer changed this answer's price changes: Sunny leaves them alone from now on. */
  markEdited: (stepId: string, value: string) => void;
  /** Sunny's suggestion for an answer to one of its own questions, unless dismissed. */
  offer: (stepId: string, value: string) => FlowEffect[] | null;
  dismiss: (stepId: string, value: string) => void;
}

export type Question = { prompt: string; choices: Array<{ value: string; label: string }> };

const answerKey = (stepId: string, value: string) => `${stepId}\n${value}`;

/** An answer's suggested effects, own keys only: an answer may be called "constructor". */
function ownEffects(effects: Record<string, FlowEffect[]>, value: string): FlowEffect[] | null {
  if (!Object.hasOwn(effects, value)) return null;
  const list = effects[value];
  return Array.isArray(list) ? list : null;
}

/** The question as Sunny is asked it, or null when there is nothing to ask yet. */
function questionOf(step: FlowStep, ctx: Context): Question | null {
  if (step.kind === 'custom' && (step.mode !== 'quote' || step.answer !== 'choice')) return null;
  const prompt = promptOf(step, ctx).trim();
  const choices = choicesOf(step, ctx)
    .map((c) => ({ value: c.value, label: c.label.trim() }))
    .filter((c) => c.label !== '')
    .slice(0, MAX_CHOICES);
  return prompt !== '' && choices.length > 0 ? { prompt, choices } : null;
}

/**
 * What must change on an added question for Sunny to be asked again: its
 * wording, its labelled answers or what it does to the quote.
 */
function signatureOf(step: FlowStep): string {
  if (step.kind !== 'custom') return '';
  return JSON.stringify([
    step.mode,
    step.answer,
    step.prompt.trim(),
    // An answer still without its label is not asked about yet.
    step.choices.filter((c) => c.label.trim() !== '').map((c) => [c.value, c.label.trim()]),
  ]);
}

function customSteps(draft: Draft, ctx: Context): FlowStep[] {
  const found: FlowStep[] = [];
  walkSteps(rootsOf(draft, ctx), (step) => {
    if (step.kind === 'custom') found.push(step);
  });
  return found;
}

function findStep(draft: Draft, ctx: Context, id: string): FlowStep | undefined {
  const path = draftPath(draft, ctx, id);
  return path?.[path.length - 1]?.step;
}

export function useSuggestions({
  tenantId,
  draft,
  ctx,
  enabled,
  selectedId,
  onDraft,
  suggest,
}: {
  tenantId: string;
  draft: Draft | null;
  ctx: Context | null;
  /** Admins and owners; a viewer is never offered anything. */
  enabled: boolean;
  selectedId: string | null;
  onDraft: (change: (draft: Draft) => Draft) => void;
  /** Where Sunny is asked (a workflow's own route); the conversation's when absent. */
  suggest?: (question: Question) => Promise<PriceSuggestion>;
}): Suggestions {
  const [checking, setChecking] = useState<Map<string, string>>(new Map());
  const [origins, setOrigins] = useState<Map<string, AnswerOrigin>>(new Map());
  const [offers, setOffers] = useState<Map<string, Record<string, FlowEffect[]>>>(new Map());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Read by answers that arrive later, so they see the draft as it is then.
  const latest = useRef({ draft, ctx, origins, onDraft });
  latest.current = { draft, ctx, origins, onDraft };
  // The newest asker, read when a timer fires, so a new function each render asks nothing again.
  const asker = useRef(suggest);
  asker.current = suggest;
  const ask = useCallback(
    (question: Question) =>
      asker.current ? asker.current(question) : suggestPriceChanges(tenantId, question),
    [tenantId],
  );
  /** Each added question's signature when last seen: a change from it asks again. */
  const seen = useRef<Map<string, string> | null>(null);
  /**
   * Every answer of a question saved before Studio opened: as the installer
   * left it, price change or none, so Sunny never fills one. Only answers
   * added since (new answers, new questions) are Sunny's to fill.
   */
  const saved = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const asked = useRef(new Set<string>());
  /** Sunny's own questions whose ask failed: asked again when next selected. */
  const failed = useRef(new Set<string>());
  const lastSelected = useRef<string | null>(null);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const startChecking = (id: string, token: string) =>
    setChecking((current) => new Map(current).set(id, token));
  const stopChecking = (id: string, token: string) =>
    setChecking((current) => {
      if (current.get(id) !== token) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });

  /** Fill the answers Sunny may fill: untouched and empty, or filled by Sunny before. */
  const apply = useCallback((id: string, effects: Record<string, FlowEffect[]>) => {
    const { draft: now, ctx: c, origins: who, onDraft: change } = latest.current;
    const step = now && c ? findStep(now, c, id) : undefined;
    if (!c || step?.kind !== 'custom') return;
    const fill = new Map<string, FlowEffect[]>();
    for (const choice of step.choices) {
      const suggested = ownEffects(effects, choice.value);
      if (!suggested) continue;
      const key = answerKey(id, choice.value);
      const origin = who.get(key);
      if (saved.current.has(key) || origin === 'edited') continue;
      if (origin === undefined && choice.effects.length > 0) continue;
      fill.set(choice.value, suggested);
    }
    const values = [...fill.keys()];
    if (values.length === 0) return;
    setOrigins((current) => {
      const next = new Map(current);
      for (const value of values) next.set(answerKey(id, value), 'suggested');
      return next;
    });
    const same = step.choices.every(
      (ch) =>
        !fill.has(ch.value) || JSON.stringify(fill.get(ch.value)) === JSON.stringify(ch.effects),
    );
    if (same) return;
    change((d) =>
      editStep(d, c, id, (s) =>
        s.kind === 'custom'
          ? {
              ...s,
              choices: s.choices.map((ch) => {
                const effects = fill.get(ch.value);
                return effects ? { ...ch, effects } : ch;
              }),
            }
          : s,
      ),
    );
  }, []);

  // Added questions: ask once one has stopped changing.
  useEffect(() => {
    if (!enabled || !draft || !ctx) return;
    const steps = customSteps(draft, ctx);
    if (seen.current === null) {
      // A saved flow's questions are not asked about on opening: their answers
      // are already as the installer left them.
      seen.current = new Map(steps.map((s) => [s.id, signatureOf(s)]));
      for (const step of steps) {
        if (step.kind !== 'custom') continue;
        for (const c of step.choices) saved.current.add(answerKey(step.id, c.value));
      }
      return;
    }
    // A question removed while waiting is not asked about.
    const present = new Set(steps.map((s) => s.id));
    for (const [id, timer] of timers.current) {
      if (present.has(id)) continue;
      clearTimeout(timer);
      timers.current.delete(id);
      seen.current.delete(id);
    }
    for (const step of steps) {
      const signature = signatureOf(step);
      if (seen.current.get(step.id) === signature) continue;
      seen.current.set(step.id, signature);
      clearTimeout(timers.current.get(step.id));
      timers.current.delete(step.id);
      const question = questionOf(step, ctx);
      if (!question) continue;
      const id = step.id;
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          startChecking(id, signature);
          ask(question)
            .then((result) => {
              const { draft: now, ctx: c } = latest.current;
              const current = now && c ? findStep(now, c, id) : undefined;
              // Changed again while Sunny was working: the newer ask answers.
              if (current && signatureOf(current) === signature) apply(id, result.effects);
            })
            .catch(() => undefined)
            .finally(() => stopChecking(id, signature));
        }, SUGGEST_DEBOUNCE_MS),
      );
    }
  }, [draft, ctx, enabled, ask, apply]);

  // Sunny's own questions: asked once a session, when first opened.
  useEffect(() => {
    if (selectedId !== lastSelected.current) {
      lastSelected.current = selectedId;
      // A failed ask is tried again only when the question is selected again.
      if (selectedId && failed.current.delete(selectedId)) asked.current.delete(selectedId);
    }
    if (!enabled || !draft || !ctx || !selectedId || asked.current.has(selectedId)) return;
    const step = findStep(draft, ctx, selectedId);
    if (step?.kind !== 'preset') return;
    const question = questionOf(step, ctx);
    if (!question) return;
    const id = step.id;
    asked.current.add(id);
    startChecking(id, 'preset');
    ask(question)
      .then((result) => setOffers((current) => new Map(current).set(id, result.effects)))
      .catch(() => failed.current.add(id))
      .finally(() => stopChecking(id, 'preset'));
  }, [selectedId, draft, ctx, enabled, ask]);

  return {
    checking: (stepId) => checking.has(stepId),
    origin: (stepId, value) => origins.get(answerKey(stepId, value)),
    markEdited: (stepId, value) =>
      setOrigins((current) =>
        current.get(answerKey(stepId, value)) === 'edited'
          ? current
          : new Map(current).set(answerKey(stepId, value), 'edited'),
      ),
    offer: (stepId, value) => {
      if (dismissed.has(answerKey(stepId, value))) return null;
      const all = offers.get(stepId);
      const effects = all ? ownEffects(all, value) : null;
      return effects && effects.length > 0 ? effects : null;
    },
    dismiss: (stepId, value) =>
      setDismissed((current) => new Set(current).add(answerKey(stepId, value))),
  };
}
