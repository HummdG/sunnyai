/**
 * Where one visitor is among the workflows: which is running, which are set
 * aside with their answers kept, and what has been finished.
 *
 * Pure. Nothing here reads a clock or touches storage; `now` is passed in and
 * the caller persists the result.
 */

import { type Workflow, type WorkflowSet, pathMatches } from '@sunny/contracts';

export const DISCOVERY_ID = 'discovery';

export interface WorkflowSession {
  active: { workflowId: string; startedAt: string } | null;
  paused: { workflowId: string; pausedAt: string; resumeOfferedAt: string | null }[];
  completed: { workflowId: string; at: string; quoteId?: string; leadId?: string }[];
  discovery: {
    status: 'none' | 'asking' | 'done' | 'skipped';
    suggestedWorkflowId: string | null;
  };
  lastPath: string | null;
}

export const EMPTY_SESSION: WorkflowSession = Object.freeze({
  active: null,
  paused: [],
  completed: [],
  discovery: { status: 'none', suggestedWorkflowId: null },
  lastPath: null,
}) as WorkflowSession;

/** A fresh, unshared copy, so a caller can never mutate the shared empty value. */
export function cloneSession(s: WorkflowSession): WorkflowSession {
  return {
    active: s.active ? { ...s.active } : null,
    paused: s.paused.map((p) => ({ ...p })),
    // Optional refs are dropped when undefined: Firestore rejects undefined values.
    completed: s.completed.map(
      (c) => JSON.parse(JSON.stringify(c)) as WorkflowSession['completed'][number],
    ),
    discovery: { ...s.discovery },
    lastPath: s.lastPath,
  };
}

/** Enabled workflows that apply on this page, specific-page ones first. */
export function available(set: WorkflowSet, path: string | null): Workflow[] {
  const matching = set.workflows.filter((w) => w.enabled && pathMatches(w.pages, path));
  return [
    ...matching.filter((w) => w.pages.include.length > 0),
    ...matching.filter((w) => w.pages.include.length === 0),
  ];
}

export function start(
  s: WorkflowSession,
  id: string,
  now: string,
): { session: WorkflowSession; pausedOther: string | null; resumed: boolean } {
  if (s.active?.workflowId === id) {
    return { session: s, pausedOther: null, resumed: false };
  }
  const resumed = s.paused.some((p) => p.workflowId === id);
  const paused = s.paused.filter((p) => p.workflowId !== id).map((p) => ({ ...p }));
  const pausedOther = s.active ? s.active.workflowId : null;
  if (pausedOther) paused.push({ workflowId: pausedOther, pausedAt: now, resumeOfferedAt: null });
  const session: WorkflowSession = {
    ...cloneSession(s),
    active: { workflowId: id, startedAt: now },
    paused,
  };
  return { session, pausedOther, resumed };
}

export function pause(s: WorkflowSession, now: string): WorkflowSession {
  if (!s.active) return s;
  const copy = cloneSession(s);
  return {
    ...copy,
    active: null,
    paused: [
      ...copy.paused,
      { workflowId: s.active.workflowId, pausedAt: now, resumeOfferedAt: null },
    ],
  };
}

export function complete(
  s: WorkflowSession,
  now: string,
  refs: { quoteId?: string; leadId?: string } = {},
): WorkflowSession {
  if (!s.active) return s;
  const copy = cloneSession(s);
  return {
    ...copy,
    active: null,
    completed: [...copy.completed, { workflowId: s.active.workflowId, at: now, ...refs }],
  };
}

export function markResumeOffered(s: WorkflowSession, id: string, now: string): WorkflowSession {
  const copy = cloneSession(s);
  return {
    ...copy,
    paused: copy.paused.map((p) => (p.workflowId === id ? { ...p, resumeOfferedAt: now } : p)),
  };
}

/** An active workflow the installer has since disabled or removed is set aside. */
export function settle(s: WorkflowSession, set: WorkflowSet): WorkflowSession {
  if (!s.active || s.active.workflowId === DISCOVERY_ID) return s;
  const id = s.active.workflowId;
  if (set.workflows.some((w) => w.id === id && w.enabled)) return s;
  return pause(s, s.active.startedAt);
}

export function suggest(
  set: WorkflowSet,
  answers: Record<string, string>,
  path: string | null,
): Workflow | null {
  const interest = answers['disc_interest'];
  if (!interest || interest === 'not_sure') return null;
  return available(set, path).find((w) => (w.interests as string[]).includes(interest)) ?? null;
}
