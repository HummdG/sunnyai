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

export const SOLAR_TEMPLATE_VERSION = 2;
export const HEAT_PUMP_TEMPLATE_VERSION = 2;
export const BATTERY_TEMPLATE_VERSION = 1;

function preset(id: string, extra: { prompt?: string; optional?: boolean } = {}): FlowStep {
  return { kind: 'preset', id, ...extra };
}

/**
 * The default solar questions. Version 1 also asked motivation, property type,
 * tariff, budget and finance: none of them moves the quote enough to be worth
 * a visitor's time, and the installer can add any of them back.
 */
const SOLAR_STEPS: readonly FlowStep[] = [
  preset('ownership'),
  preset('address'),
  preset('roof_size'),
  preset('roof_shading'),
  preset('usage_source'),
  preset('lifestyle'),
  preset('existing_system'),
];

/**
 * The default heat pump questions. Version 1 also asked motivation, floor area
 * (the bedrooms stand in), glazing, occupants, yearly spend, EPC and outdoor
 * space: each is either defaulted well by the estimate or only a note the
 * installer checks at the survey anyway.
 */
const HEAT_PUMP_STEPS: readonly FlowStep[] = [
  preset('property_type'),
  preset('ownership'),
  preset('address'),
  preset('hp_age'),
  preset('hp_bedrooms'),
  preset('hp_walls'),
  preset('hp_loft'),
  preset('hp_current_heating'),
  preset('hp_emitters'),
  preset('hp_hot_water'),
];

/**
 * The steps each built-in shipped with at version 1, exactly as stored. A
 * workflow still holding these was never edited, so it moves to the current
 * template when read (workflows/tenant.ts); an edited one is left alone.
 */
export const V1_STEPS: Readonly<Partial<Record<Workflow['kind'], readonly FlowStep[]>>> = {
  solar_quote: [
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
  heat_pump_quote: [
    preset('motivation', { prompt: 'First, what would you most like from a new heating system?' }),
    preset('property_type'),
    preset('ownership'),
    preset('address'),
    preset('hp_age'),
    preset('hp_floor_area', { optional: true }),
    preset('hp_bedrooms'),
    preset('hp_walls'),
    preset('hp_loft'),
    preset('hp_glazing'),
    preset('hp_current_heating'),
    preset('hp_emitters'),
    preset('hp_hot_water'),
    preset('hp_occupants', { optional: true }),
    preset('hp_annual_spend', { optional: true }),
    preset('hp_epc', { optional: true }),
    preset('hp_outdoor_space'),
  ],
};

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
    // Only what changes the quote or qualifies the lead. Not address first: an
    // address-first solar workflow runs SunScan's fixed legacy order.
    steps: SOLAR_STEPS.map((s) => ({ ...s })),
    outcome: { kind: 'quote', engine: 'solar' },
    template: { id: 'solar_quote', version: SOLAR_TEMPLATE_VERSION },
    version: 1,
    updatedAt: now,
  };
}

/** Ships switched off: the installer turns it on once they price heat pumps. */
export function heatPumpTemplate(now: string): Workflow {
  return {
    id: BUILTIN_WORKFLOW_IDS.heat_pump_quote,
    kind: 'heat_pump_quote',
    name: 'Heat pump quote',
    enabled: false,
    description:
      "Works out an indicative heat pump estimate for the visitor's home, with the Boiler Upgrade Scheme grant.",
    triggers: [
      'heat pump quote',
      'air source heat pump',
      'how much is a heat pump',
      'boiler replacement',
    ],
    interests: ['heating'],
    pages: { include: [], exclude: [] },
    steps: HEAT_PUMP_STEPS.map((s) => ({ ...s })),
    outcome: { kind: 'quote', engine: 'heat_pump' },
    template: { id: 'heat_pump_quote', version: HEAT_PUMP_TEMPLATE_VERSION },
    version: 1,
    updatedAt: now,
  };
}

/** Ships switched off: the installer turns it on once they price battery retrofits. */
export function batteryTemplate(now: string): Workflow {
  return {
    id: BUILTIN_WORKFLOW_IDS.battery_quote,
    kind: 'battery_quote',
    name: 'Battery quote',
    enabled: false,
    description: 'Works out battery options for a home that already has solar panels.',
    triggers: ['battery quote', 'add a battery', 'home battery', 'battery for my solar'],
    interests: ['battery'],
    pages: { include: [], exclude: [] },
    steps: [
      preset('motivation', { prompt: 'First, what would you most like from a home battery?' }),
      preset('existing_system'),
      preset('address'),
      preset('bat_pv_kwp', { optional: true }),
      preset('bat_panels'),
      preset('usage_source'),
      preset('tariff_type'),
      preset('lifestyle'),
      preset('bat_inverter'),
      preset('bat_goal'),
    ],
    outcome: { kind: 'quote', engine: 'battery' },
    template: { id: 'battery_quote', version: BATTERY_TEMPLATE_VERSION },
    version: 1,
    updatedAt: now,
  };
}

/**
 * The built-in workflows Sunny added after sets were first made, in the order
 * they are appended to a set that lacks them (workflows/tenant.ts).
 */
export const APPENDED_BUILT_INS: ReadonlyArray<{
  kind: Workflow['kind'];
  id: string;
  template: (now: string) => Workflow;
}> = [
  {
    kind: 'heat_pump_quote',
    id: BUILTIN_WORKFLOW_IDS.heat_pump_quote,
    template: heatPumpTemplate,
  },
  { kind: 'battery_quote', id: BUILTIN_WORKFLOW_IDS.battery_quote, template: batteryTemplate },
];

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
  if (kind === 'solar_quote') return solarTemplate(now);
  if (kind === 'heat_pump_quote') return heatPumpTemplate(now);
  if (kind === 'battery_quote') return batteryTemplate(now);
  return null;
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
