import { z } from 'zod';

import { FLOW_LIMITS, type FlowStep, checkFlowDepth, flowStepSchema } from './conversation-flow.js';

/**
 * Installer-configured guided tasks. A workflow is a named, optional set of
 * steps with one outcome: a priced quote from one engine, or a captured lead.
 */

export type WorkflowKind = 'solar_quote' | 'heat_pump_quote' | 'battery_quote' | 'custom';
export type QuoteEngine = 'solar' | 'heat_pump' | 'battery';
export type WorkflowOutcome = { kind: 'quote'; engine: QuoteEngine } | { kind: 'lead' };

export const DISCOVERY_INTERESTS = [
  'solar',
  'battery',
  'heating',
  'ev_charger',
  'not_sure',
] as const;
export type DiscoveryInterest = (typeof DISCOVERY_INTERESTS)[number];

export interface PageRule {
  include: string[];
  exclude: string[];
}

export interface Workflow {
  id: string;
  kind: WorkflowKind;
  name: string;
  enabled: boolean;
  description: string;
  triggers: string[];
  interests: DiscoveryInterest[];
  pages: PageRule;
  steps: FlowStep[];
  outcome: WorkflowOutcome;
  template: { id: 'solar_quote' | 'heat_pump_quote' | 'battery_quote'; version: number } | null;
  version: number;
  updatedAt: string;
}

export interface WorkflowSet {
  version: number;
  updatedAt: string;
  discovery: { enabled: boolean };
  workflows: Workflow[];
}

export const WORKFLOW_LIMITS = {
  workflows: 12,
  triggers: 8,
  patterns: 20,
  descriptionChars: 300,
  nameChars: 60,
} as const;

export const BUILTIN_WORKFLOW_IDS = {
  solar_quote: 'wf_solar',
  heat_pump_quote: 'wf_heat_pump',
  battery_quote: 'wf_battery',
} as const;

const WORKFLOW_ID = /^wf_[a-z0-9_]{3,30}$/;
const PATH_MAX = 512;

const pattern = z.string().trim().min(1).max(PATH_MAX);

const pageRuleSchema: z.ZodType<PageRule> = z.object({
  include: z.array(pattern).max(WORKFLOW_LIMITS.patterns),
  exclude: z.array(pattern).max(WORKFLOW_LIMITS.patterns),
});

const outcomeSchema: z.ZodType<WorkflowOutcome> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('quote'), engine: z.enum(['solar', 'heat_pump', 'battery']) }),
  z.object({ kind: z.literal('lead') }),
]);

export const workflowSchema: z.ZodType<Workflow> = z.object({
  id: z.string().regex(WORKFLOW_ID),
  kind: z.enum(['solar_quote', 'heat_pump_quote', 'battery_quote', 'custom']),
  name: z.string().trim().min(1).max(WORKFLOW_LIMITS.nameChars),
  enabled: z.boolean(),
  description: z.string().trim().max(WORKFLOW_LIMITS.descriptionChars),
  triggers: z.array(z.string().trim().min(1).max(80)).max(WORKFLOW_LIMITS.triggers),
  interests: z.array(z.enum(DISCOVERY_INTERESTS)).max(DISCOVERY_INTERESTS.length),
  pages: pageRuleSchema,
  steps: z.array(flowStepSchema).max(FLOW_LIMITS.steps),
  outcome: outcomeSchema,
  template: z
    .object({
      id: z.enum(['solar_quote', 'heat_pump_quote', 'battery_quote']),
      version: z.number().int().nonnegative(),
    })
    .nullable(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
});

const ENGINE_FOR_KIND = {
  solar_quote: 'solar',
  heat_pump_quote: 'heat_pump',
  battery_quote: 'battery',
} as const;

/** Every custom step id under a step, follow-ups included. */
function customIds(step: FlowStep, out: string[]): void {
  if (step.kind === 'custom') out.push(step.id);
  for (const f of step.followUps ?? []) customIds(f.step, out);
}

export const workflowSetSchema: z.ZodType<WorkflowSet> = z
  .object({
    version: z.number().int().nonnegative(),
    updatedAt: z.string().min(1),
    discovery: z.object({ enabled: z.boolean() }),
    workflows: z.array(workflowSchema).max(WORKFLOW_LIMITS.workflows),
  })
  .superRefine((set, ctx) => {
    const ids = new Set<string>();
    const kinds = new Set<string>();
    const stepOwner = new Map<string, number>();
    set.workflows.forEach((w, i) => {
      if (ids.has(w.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Workflow ids must be unique',
          path: ['workflows', i, 'id'],
        });
      }
      ids.add(w.id);

      if (w.kind !== 'custom') {
        if (kinds.has(w.kind)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Only one workflow of each built-in kind is allowed',
            path: ['workflows', i, 'kind'],
          });
        }
        kinds.add(w.kind);
        const ok = w.outcome.kind === 'quote' && w.outcome.engine === ENGINE_FOR_KIND[w.kind];
        if (!ok) {
          ctx.addIssue({
            code: 'custom',
            message: 'A quote workflow must end in a quote from its own engine',
            path: ['workflows', i, 'outcome'],
          });
        }
      }

      checkFlowDepth(w.steps, ctx, ['workflows', i, 'steps']);

      const found: string[] = [];
      w.steps.forEach((s) => customIds(s, found));
      for (const id of found) {
        const owner = stepOwner.get(id);
        if (owner !== undefined) {
          ctx.addIssue({
            code: 'custom',
            message: 'A custom step id can belong to only one workflow',
            path: ['workflows', i, 'steps'],
          });
        }
        stepOwner.set(id, i);
      }
    });
  });

function trimSlash(s: string): string {
  return s.length > 1 ? s.replace(/\/+$/, '') || '/' : s;
}

function compile(glob: string): RegExp {
  const g = trimSlash(glob);
  let src = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        src += '.*';
        i++;
      } else src += '[^/]*';
    } else src += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${src}$`);
}

/**
 * Whether a workflow may be offered on a page. An empty `include` means every
 * page; a restricted rule never matches an unknown (null) path. `exclude` wins.
 */
export function pathMatches(rule: PageRule, path: string | null): boolean {
  // An unknown page is matched by an open include list; an exclude cannot match it.
  if (path === null) return rule.include.length === 0;
  const p = trimSlash(path);
  if (rule.exclude.some((g) => compile(g).test(p))) return false;
  return rule.include.length === 0 || rule.include.some((g) => compile(g).test(p));
}
