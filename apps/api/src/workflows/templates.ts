/**
 * The workflows Sunny ships with. A template is plain data: the installer's copy
 * of it is theirs to edit, and `template.version` records which one it began as.
 */

import { randomInt } from 'node:crypto';

import {
  BUILTIN_WORKFLOW_IDS,
  type FlowStep,
  type Workflow,
  type WorkflowSet,
} from '@sunny/contracts';

export const SOLAR_TEMPLATE_VERSION = 1;

function preset(id: string, extra: { prompt?: string; optional?: boolean } = {}): FlowStep {
  return { kind: 'preset', id, ...extra };
}

export function solarTemplate(now: string): Workflow {
  return {
    id: BUILTIN_WORKFLOW_IDS.solar_quote,
    kind: 'solar_quote',
    name: 'Solar quote',
    enabled: true,
    description: "Works out a solar panel quote for the visitor's home, with an optional battery.",
    triggers: ['solar quote', 'how much would solar cost', 'solar panels price', 'get a quote'],
    interests: ['solar'],
    pages: { include: [], exclude: [] },
    steps: [
      preset('motivation', { prompt: 'First, what would you most like solar to do for you?' }),
      preset('property_type'),
      preset('ownership'),
      preset('address'),
      preset('roof_size'),
      preset('roof_shading'),
      preset('usage_source'),
      preset('lifestyle'),
      preset('tariff_type'),
      preset('existing_system'),
      preset('budget_band', { optional: true }),
      preset('finance_interest', { optional: true }),
    ],
    outcome: { kind: 'quote', engine: 'solar' },
    template: { id: 'solar_quote', version: SOLAR_TEMPLATE_VERSION },
    version: 1,
    updatedAt: now,
  };
}

export function defaultWorkflowSet(now: string): WorkflowSet {
  return {
    version: 1,
    updatedAt: now,
    discovery: { enabled: true },
    workflows: [solarTemplate(now)],
  };
}

/** The template a built-in kind starts from, or null when Sunny has none yet. */
export function templateFor(kind: Workflow['kind'], now: string): Workflow | null {
  return kind === 'solar_quote' ? solarTemplate(now) : null;
}

/** A random custom step id, matching the contract's `c_` pattern. */
export function customStepId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'c_';
  for (let i = 0; i < 10; i++) id += chars[randomInt(chars.length)];
  return id;
}

/** A new, switched-off lead workflow with one open question, on every page. */
export function blankWorkflow(id: string, now: string): Workflow {
  return {
    id,
    kind: 'custom',
    name: 'New workflow',
    enabled: false,
    description: '',
    triggers: [],
    interests: [],
    pages: { include: [], exclude: [] },
    steps: [
      {
        kind: 'custom',
        id: customStepId(),
        prompt: 'What would you like help with?',
        mode: 'lead',
        answer: 'text',
        choices: [],
      },
    ],
    outcome: { kind: 'lead' },
    template: null,
    version: 1,
    updatedAt: now,
  };
}

/**
 * A built-in workflow put back to its template: the steps, wording, triggers,
 * interests and outcome return, while whether it is on and where it shows stay
 * the installer's. The version counts on. Null when Sunny has no template.
 */
export function resetToTemplate(workflow: Workflow, now: string): Workflow | null {
  const kind = workflow.kind !== 'custom' ? workflow.kind : workflow.template?.id;
  const template = kind ? templateFor(kind, now) : null;
  if (!template) return null;
  return {
    ...template,
    id: workflow.id,
    enabled: workflow.enabled,
    pages: workflow.pages,
    version: workflow.version + 1,
    updatedAt: now,
  };
}
