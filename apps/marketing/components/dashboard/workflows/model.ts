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

export function removePattern(
  rule: PageRule,
  list: 'include' | 'exclude',
  pattern: string,
): PageRule {
  return { ...rule, [list]: rule[list].filter((p) => p !== pattern) };
}

/** Whether the rule offers the workflow on a URL or path; null when it cannot be read. */
export function testUrl(rule: PageRule, input: string): boolean | null {
  const text = input.trim();
  if (text === '') return null;
  if (text.startsWith('/')) return pathMatches(rule, text.split(/[?#]/)[0]!);
  if (!SCHEME.test(text) && !text.includes('.')) return null;
  try {
    return pathMatches(rule, new URL(SCHEME.test(text) ? text : `https://${text}`).pathname);
  } catch {
    return null;
  }
}

export function workflowFlow(w: Workflow): ConversationFlow {
  return { version: w.version, updatedAt: w.updatedAt, steps: w.steps };
}

export function withFlow(w: Workflow, flow: ConversationFlow): Workflow {
  return { ...w, steps: flow.steps };
}
