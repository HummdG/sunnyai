/**
 * The workflows Sunny ships with. A template is plain data: the installer's copy
 * of it is theirs to edit, and `template.version` records which one it began as.
 */

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
