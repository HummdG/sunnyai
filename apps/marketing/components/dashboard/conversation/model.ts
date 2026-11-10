/**
 * The conversation editor's pure helpers: reading and changing a draft flow.
 *
 * The draft is the stored shape (`FlowStep[]`, the middle of the conversation)
 * plus the wording of preset group members, which a stored flow lists right
 * after their head. Every panel (list, diagram, preview) reads the same draft
 * through these helpers, so they cannot disagree about what Sunny asks.
 */

import type {
  ConversationFlow,
  FlowEffect,
  FlowFollowUp,
  FlowIssue,
  FlowStep,
  PresetView,
  PriceItemView,
  WorkflowIssue,
} from '../../../lib/portal-api.js';
import { possessive } from '../../../lib/assistant-name.js';

export type PresetStep = Extract<FlowStep, { kind: 'preset' }>;
export type CustomStep = Extract<FlowStep, { kind: 'custom' }>;

export interface Draft {
  steps: FlowStep[];
  /** Rewording of preset group members, by member id. */
  members: Record<string, PresetStep>;
}

/** What every panel needs to draw a step. */
export interface Context {
  presets: Map<string, PresetView>;
  items: PriceItemView[];
  /** What the installer calls the assistant ("Sunny" until renamed). */
  assistant: string;
}

/** How deep follow-ups may nest (FLOW_LIMITS.followUpDepth). */
export const MAX_DEPTH = 2;
export const MAX_CHOICES = 12;

function randomTail(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** A new added question's stable id (CUSTOM_ID). */
export const newCustomId = (): string => `c_${randomTail(10)}`;
/** A new answer's stable value. */
export const newChoiceValue = (): string => `a_${randomTail(8)}`;

export function newQuestion(): CustomStep {
  return {
    kind: 'custom',
    id: newCustomId(),
    prompt: '',
    mode: 'quote',
    answer: 'choice',
    choices: [
      { value: 'yes', label: 'Yes', effects: [] },
      { value: 'no', label: 'No', effects: [] },
    ],
  };
}

export function groupMembers(presets: Iterable<PresetView>): Set<string> {
  const members = new Set<string>();
  for (const p of presets) for (const m of p.group) members.add(m);
  return members;
}

/** Sunny's own middle section, as the stored flow would list it. */
export function defaultSteps(presets: PresetView[]): FlowStep[] {
  const members = groupMembers(presets);
  return presets
    .filter((p) => !p.fixed && !members.has(p.id))
    .map((p) => ({ kind: 'preset', id: p.id }));
}

/** Split a stored flow into the draft the editor holds. */
export function draftFrom(flow: ConversationFlow | null, presets: PresetView[]): Draft {
  if (!flow) return { steps: defaultSteps(presets), members: {} };
  const memberIds = groupMembers(presets);
  const members: Record<string, PresetStep> = {};
  const steps: FlowStep[] = [];
  for (const step of flow.steps) {
    if (step.kind === 'preset' && memberIds.has(step.id)) members[step.id] ??= step;
    else steps.push(step);
  }
  return { steps, members };
}

/**
 * A step as it is saved: text trimmed, a preset keeps only what the installer
 * changed, and a lead-only question carries no effects.
 */
export function cleanStep(step: FlowStep, ctx: Context): FlowStep {
  const followUps = step.followUps?.map((f) => ({ ...f, step: cleanStep(f.step, ctx) }));
  const withFollowUps = followUps && followUps.length > 0 ? { followUps } : {};
  if (step.kind === 'preset') {
    const preset = ctx.presets.get(step.id);
    const prompt = step.prompt?.trim();
    const labels = Object.fromEntries(
      Object.entries(step.labels ?? {})
        .map(([value, label]) => [value, label.trim()] as const)
        .filter(
          ([value, label]) =>
            label !== '' && label !== preset?.options.find((o) => o.value === value)?.label,
        ),
    );
    const effects = Object.fromEntries(
      Object.entries(step.effects ?? {}).filter(([, list]) => list.length > 0),
    );
    return {
      kind: 'preset',
      id: step.id,
      ...(prompt && prompt !== preset?.prompt ? { prompt } : {}),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
      ...(Object.keys(effects).length > 0 ? { effects } : {}),
      ...withFollowUps,
    };
  }
  const { followUps: _f, ...rest } = step;
  return {
    ...rest,
    prompt: step.prompt.trim(),
    choices:
      step.answer === 'text'
        ? []
        : step.choices.map((c) => ({
            ...c,
            label: c.label.trim(),
            effects: step.mode === 'quote' ? c.effects : [],
          })),
    ...withFollowUps,
  };
}

/** The draft as the API stores it: members placed right after their head. */
export function flowFrom(
  draft: Draft,
  ctx: Context,
  base: ConversationFlow | null,
): ConversationFlow {
  const steps: FlowStep[] = [];
  for (const step of draft.steps) {
    steps.push(cleanStep(step, ctx));
    for (const member of ctx.presets.get(step.id)?.group ?? []) {
      const own = draft.members[member] ? cleanStep(draft.members[member], ctx) : null;
      // Listed only when the installer changed something on it (wording, labels,
      // effects or follow-ups); otherwise it is asked as Sunny words it.
      if (own?.kind === 'preset' && (own.prompt || own.labels || own.effects || own.followUps)) {
        steps.push(own);
      }
    }
  }
  return {
    version: base?.version ?? 0,
    updatedAt: base?.updatedAt ?? new Date(0).toISOString(),
    steps,
  };
}

export function promptOf(step: FlowStep, ctx: Context): string {
  if (step.kind === 'custom') return step.prompt;
  return step.prompt ?? ctx.presets.get(step.id)?.prompt ?? step.id;
}

/** The name a step row and diagram box go by: its wording, or "New question". */
export function nameOf(step: FlowStep, ctx: Context): string {
  return promptOf(step, ctx).trim() || 'New question';
}

export interface ChoiceView {
  value: string;
  label: string;
  effects: FlowEffect[];
}

/** A step's answers with their current labels and effects (none for free text). */
export function choicesOf(step: FlowStep, ctx: Context): ChoiceView[] {
  if (step.kind === 'custom') {
    return step.answer === 'text'
      ? []
      : step.choices.map((c) => ({ ...c, effects: step.mode === 'quote' ? c.effects : [] }));
  }
  return (ctx.presets.get(step.id)?.options ?? []).map((o) => ({
    value: o.value,
    label: step.labels?.[o.value] ?? o.label,
    effects: step.effects?.[o.value] ?? [],
  }));
}

/** Whether a step's answers can change the quote. */
export function changesQuote(step: FlowStep): boolean {
  return step.kind === 'preset' || step.mode === 'quote';
}

export function tagOf(step: FlowStep, ctx: Context): string {
  if (step.kind === 'preset') return `${possessive(ctx.assistant)} question`;
  return step.mode === 'quote' ? 'Changes the quote' : 'Lead only';
}

/** Whether adding this item needs a quantity: the server decides, as the quote does. */
export function needsQuantity(item: PriceItemView): boolean {
  return item.needsQuantity;
}

export function unitsWord(unit: string, quantity = 2): string {
  const word = unit === 'kwh' ? 'kWh' : unit;
  return quantity === 1 || word === 'kWh' ? word : `${word}s`;
}

function itemName(key: string, ctx: Context): string {
  return ctx.items.find((i) => i.key === key)?.name ?? key;
}

/** "Adds 7kW EV charger, £899", from the published list's own price text. */
export function effectText(effect: FlowEffect, ctx: Context): string {
  const find = (key: string) => ctx.items.find((i) => i.key === key);
  const amount = (key: string, quantity?: number) => {
    const item = find(key);
    if (!item) return `${key}, no longer on your price list`;
    const what = quantity
      ? `${quantity} ${unitsWord(item.unitLabel, quantity)} of ${item.name}`
      : item.name;
    return `${what}, ${item.priceText}`;
  };
  switch (effect.kind) {
    case 'add':
      return `Adds ${amount(effect.itemKey, effect.quantity)}`;
    case 'remove':
      return `Removes ${itemName(effect.itemKey, ctx)}`;
    case 'swap':
      return `Replaces ${itemName(effect.fromKey, ctx)}: ${amount(effect.toKey, effect.quantity)}`;
  }
}

/** The flow's short form, on a branch pill: "+£899 7kW EV charger", "removes Bird mesh". */
export function effectShort(effect: FlowEffect, ctx: Context): string {
  const find = (key: string) => ctx.items.find((i) => i.key === key);
  switch (effect.kind) {
    case 'add': {
      const item = find(effect.itemKey);
      if (!item) return `+${effect.itemKey}`;
      return effect.quantity
        ? `+${effect.quantity} ${unitsWord(item.unitLabel, effect.quantity)} ${item.name}`
        : `+${item.priceText} ${item.name}`;
    }
    case 'remove':
      return `removes ${itemName(effect.itemKey, ctx)}`;
    case 'swap':
      return `swaps to ${itemName(effect.toKey, ctx)}`;
  }
}

/** An answer's effects in short: "+£899 7kW EV charger, removes Bird mesh". */
export function effectsShort(effects: FlowEffect[], ctx: Context): string {
  return effects.map((e) => effectShort(e, ctx)).join(', ');
}

// ── tree edits (every step id is unique in a flow) ─────────────────────────

export function mapStep(
  steps: FlowStep[],
  id: string,
  change: (s: FlowStep) => FlowStep,
): FlowStep[] {
  return steps.map((step) => {
    if (step.id === id) return change(step);
    if (!step.followUps) return step;
    return {
      ...step,
      followUps: step.followUps.map((f) => ({ ...f, step: mapStep([f.step], id, change)[0]! })),
    };
  });
}

export function removeStep(steps: FlowStep[], id: string): FlowStep[] {
  return steps
    .filter((step) => step.id !== id)
    .map((step) =>
      step.followUps
        ? {
            ...step,
            followUps: step.followUps
              .filter((f) => f.step.id !== id)
              .map((f) => ({ ...f, step: removeStep([f.step], id)[0]! })),
          }
        : step,
    );
}

/** Move a top-level step `by` places (follow-ups never leave their parent). */
export function moveStep(steps: FlowStep[], id: string, by: number): FlowStep[] {
  const from = steps.findIndex((s) => s.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Put a top-level step just before another (drag and drop). */
export function placeBefore(steps: FlowStep[], id: string, beforeId: string): FlowStep[] {
  if (id === beforeId) return steps;
  const moved = steps.find((s) => s.id === id);
  if (!moved) return steps;
  const rest = steps.filter((s) => s.id !== id);
  const at = rest.findIndex((s) => s.id === beforeId);
  if (at < 0) return steps;
  rest.splice(at, 0, moved);
  return rest;
}

/** Put a top-level step at `index` in the list as it is without it (drag on the flow). */
export function placeAt(steps: FlowStep[], id: string, index: number): FlowStep[] {
  const moved = steps.find((s) => s.id === id);
  if (!moved) return steps;
  const rest = steps.filter((s) => s.id !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, moved);
  return rest;
}

export function addFollowUp(step: FlowStep, value: string, child: FlowStep): FlowStep {
  const followUp: FlowFollowUp = { when: [value], step: child };
  return { ...step, followUps: [...(step.followUps ?? []), followUp] };
}

/** Every step id in the draft, follow-ups included, with how deep it sits. */
export function walkSteps(
  steps: FlowStep[],
  visit: (step: FlowStep, depth: number, parent: FlowStep | null, when: string[]) => void,
  depth = 0,
  parent: FlowStep | null = null,
): void {
  const inner = (step: FlowStep, at: number) => {
    for (const f of step.followUps ?? []) {
      visit(f.step, at + 1, step, f.when);
      inner(f.step, at + 1);
    }
  };
  for (const step of steps) {
    visit(step, depth, parent, []);
    inner(step, depth);
  }
}

/** The chain of (step, answer that opens the next one) from the top down to `id`. */
export function pathTo(
  steps: FlowStep[],
  id: string,
): Array<{ step: FlowStep; when: string | null }> | null {
  for (const step of steps) {
    if (step.id === id) return [{ step, when: null }];
    for (const f of step.followUps ?? []) {
      const below = pathTo([f.step], id);
      if (below) return [{ step, when: f.when[0] ?? null }, ...below];
    }
  }
  return null;
}

/** A problem shown beside its question (and answer): the server's or the editor's own. */
export type EditorIssue = Pick<FlowIssue, 'stepId' | 'choice' | 'message'> & {
  /** Found by the editor before saving, not by the server. */
  local?: true;
};

/**
 * A workflow's issues that belong beside a question, in the editor's shape.
 * The rest (pages, interests, a missing address) are the workflow's, not a
 * question's: see `wholeIssues`.
 */
export function stepIssues(issues: WorkflowIssue[]): EditorIssue[] {
  return issues.flatMap((i) =>
    typeof i.stepId === 'string'
      ? [
          {
            stepId: i.stepId,
            message: i.message,
            ...(i.choice === undefined ? {} : { choice: i.choice }),
          },
        ]
      : [],
  );
}

/** The messages of a workflow's issues that belong to no one question. */
export function wholeIssues(issues: WorkflowIssue[]): string[] {
  return issues.filter((i) => typeof i.stepId !== 'string').map((i) => i.message);
}

/**
 * Problems the editor can see before asking the server, beside their question.
 * Pass every root (`rootsOf`), so follow-ups under group members are checked too.
 */
export function localIssues(steps: FlowStep[], assistant: string): EditorIssue[] {
  const issues: EditorIssue[] = [];
  walkSteps(steps, (step) => {
    if (step.kind !== 'custom') return;
    if (step.prompt.trim() === '') {
      issues.push({
        stepId: step.id,
        message: `Write the question ${assistant} should ask.`,
        local: true,
      });
    }
    if (step.answer === 'choice') {
      if (step.choices.length === 0) {
        issues.push({ stepId: step.id, message: 'Add at least one answer.', local: true });
      }
      for (const c of step.choices) {
        if (c.label.trim() === '') {
          issues.push({
            stepId: step.id,
            choice: c.value,
            message: 'Give this answer a label.',
            local: true,
          });
        }
      }
    }
  });
  return issues;
}

// ── the whole draft: listed steps and the group members under their heads ──

/** A group member as the draft holds it (untouched members are implied). */
export function memberStep(draft: Draft, id: string): PresetStep {
  return draft.members[id] ?? { kind: 'preset', id };
}

/** The members asked with a listed step, in order. */
export function membersOf(step: FlowStep, draft: Draft, ctx: Context): PresetStep[] {
  if (step.kind !== 'preset') return [];
  return (ctx.presets.get(step.id)?.group ?? []).map((id) => memberStep(draft, id));
}

/** Every top-level step and every member of a listed head: the roots the editor shows. */
export function rootsOf(draft: Draft, ctx: Context): FlowStep[] {
  return draft.steps.flatMap((step) => [step, ...membersOf(step, draft, ctx)]);
}

/**
 * The open chain from a listed step down to `id`: a member sits under its
 * head, a follow-up under its parent (`when` is the answer that opens the next link).
 */
export function draftPath(
  draft: Draft,
  ctx: Context,
  id: string,
): Array<{ step: FlowStep; when: string | null }> | null {
  const direct = pathTo(draft.steps, id);
  if (direct) return direct;
  for (const head of draft.steps) {
    for (const member of membersOf(head, draft, ctx)) {
      const below = pathTo([member], id);
      if (below) return [{ step: head, when: null }, ...below];
    }
  }
  return null;
}

/** Change one step wherever it sits, a group member or its follow-ups included. */
export function editStep(
  draft: Draft,
  ctx: Context,
  id: string,
  change: (s: FlowStep) => FlowStep,
): Draft {
  if (pathTo(draft.steps, id)) return { ...draft, steps: mapStep(draft.steps, id, change) };
  for (const member of groupMembers(ctx.presets.values())) {
    const root = memberStep(draft, member);
    if (pathTo([root], id)) {
      const next = mapStep([root], id, change)[0] as PresetStep;
      return { ...draft, members: { ...draft.members, [member]: next } };
    }
  }
  return draft;
}

/** Remove a step wherever it sits (a member itself only goes with its head). */
export function deleteStep(draft: Draft, id: string): Draft {
  return {
    steps: removeStep(draft.steps, id),
    members: Object.fromEntries(
      Object.entries(draft.members).map(([m, step]) => [
        m,
        removeStep([step], id)[0] as PresetStep,
      ]),
    ),
  };
}

/** Every step id at or below `step`, its group members' included. */
export function subtreeIds(step: FlowStep, draft: Draft, ctx: Context): Set<string> {
  const ids = new Set<string>();
  walkSteps([step, ...membersOf(step, draft, ctx)], (s) => ids.add(s.id));
  return ids;
}

/**
 * How deep a step sits for follow-ups: a listed step and a group member are 0
 * (a member is stored as its own step), a follow-up one more than its parent.
 */
export function depthOf(draft: Draft, ctx: Context, id: string): number {
  const direct = pathTo(draft.steps, id);
  if (direct) return direct.length - 1;
  for (const head of draft.steps) {
    for (const member of membersOf(head, draft, ctx)) {
      const below = pathTo([member], id);
      if (below) return below.length - 1;
    }
  }
  return 0;
}

/** Whether `id` is a preset asked with another (it moves and is removed with its head). */
export function isMember(ctx: Context, id: string): boolean {
  return groupMembers(ctx.presets.values()).has(id);
}
