/**
 * The workflow builder's pure helpers: page rules, labels and the bridge to
 * the question editor's flow model.
 */

import type {
  ConversationFlow,
  PageRule,
  Workflow,
  WorkflowOutcome,
} from '../../../lib/portal-api.js';
import { pathMatches } from '../../../lib/portal-api.js';

/** WORKFLOW_LIMITS.patterns in @sunny/contracts. */
export const MAX_PATTERNS = 20;
const BUILTIN_IDS = ['wf_solar', 'wf_heat_pump', 'wf_battery'];
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function pagesSummary(rule: PageRule): string {
  const only = rule.include.length > 0;
  const except = rule.exclude.length > 0;
  if (only && except) return `Only ${rule.include.join(', ')} (not ${rule.exclude.join(', ')})`;
  if (only) return `Only ${rule.include.join(', ')}`;
  if (except) return `All pages except ${rule.exclude.join(', ')}`;
  return 'All pages';
}

export function outcomeLabel(o: WorkflowOutcome): string {
  if (o.kind === 'lead') return 'Passes details to you';
  return o.engine === 'solar'
    ? 'Solar quote'
    : o.engine === 'heat_pump'
      ? 'Heat pump quote'
      : 'Battery quote';
}

export function kindBadge(w: Workflow): string {
  return w.template !== null || BUILTIN_IDS.includes(w.id) ? 'Built in' : 'Your own';
}

export function addPattern(
  rule: PageRule,
  list: 'include' | 'exclude',
  raw: string,
): { rule: PageRule; error: string | null } {
  const fail = (error: string) => ({ rule, error });
  let p = raw.trim();
  if (p === '') return fail('Type a page path, like /offers/battery*.');
  if (/\s/.test(p)) return fail('A page path cannot contain spaces.');
  if (/[?#]/.test(p)) return fail('Leave out the ? and # parts: match the path only.');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 512) return fail('That path is too long.');
  if (rule[list].includes(p)) return { rule, error: null };
  if (rule[list].length >= MAX_PATTERNS) {
    return fail(`You can list up to ${MAX_PATTERNS} paths.`);
  }
  return { rule: { ...rule, [list]: [...rule[list], p] }, error: null };
}

/**
 * The rule with whatever is still typed in each list's field added, as the
 * Add button would add it: blank fields are left alone, and the first list
 * whose text is refused says why (nothing is added then).
 */
export function pendingPages(
  rule: PageRule,
  typed: { include: string; exclude: string },
): { rule: PageRule; error: { list: 'include' | 'exclude'; message: string } | null } {
  let next = rule;
  for (const list of ['include', 'exclude'] as const) {
    if (typed[list].trim() === '') continue;
    const result = addPattern(next, list, typed[list]);
    if (result.error !== null) return { rule, error: { list, message: result.error } };
    next = result.rule;
  }
  return { rule: next, error: null };
}

/** WORKFLOW_LIMITS in @sunny/contracts: how many triggers, and how long each. */
export const TRIGGER_LIMITS = { count: 8, chars: 80 } as const;

/** The triggers with one more, tidied: a repeat (any case) is already there. */
export function addTrigger(
  triggers: string[],
  raw: string,
): { triggers: string[]; error: string | null } {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text === '') return { triggers, error: 'Type something a visitor might say.' };
  if (triggers.some((t) => t.toLowerCase() === text.toLowerCase())) {
    return { triggers, error: null };
  }
  if (triggers.length >= TRIGGER_LIMITS.count) {
    return { triggers, error: `You can list up to ${TRIGGER_LIMITS.count}.` };
  }
  return { triggers: [...triggers, text], error: null };
}

export function removePattern(
  rule: PageRule,
  list: 'include' | 'exclude',
  pattern: string,
): PageRule {
  return { ...rule, [list]: rule[list].filter((p) => p !== pattern) };
}

/** The path of a typed page address (a path or a full URL); null when it cannot be read. */
export function pathOf(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  if (text.startsWith('/')) return text.split(/[?#]/)[0]!;
  if (!SCHEME.test(text) && !text.includes('.')) return null;
  try {
    return new URL(SCHEME.test(text) ? text : `https://${text}`).pathname;
  } catch {
    return null;
  }
}

/** Whether the rule offers the workflow on a URL or path; null when it cannot be read. */
export function testUrl(rule: PageRule, input: string): boolean | null {
  const path = pathOf(input);
  return path === null ? null : pathMatches(rule, path);
}

export function workflowFlow(w: Workflow): ConversationFlow {
  return { version: w.version, updatedAt: w.updatedAt, steps: w.steps };
}

export function withFlow(w: Workflow, flow: ConversationFlow): Workflow {
  return { ...w, steps: flow.steps };
}
