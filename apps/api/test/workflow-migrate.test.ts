import { describe, expect, it, vi } from 'vitest';

import type { ConversationFlow, FlowStep, Workflow } from '@sunny/contracts';

import { resolveFlow } from '../src/flow/resolve.js';
import { flowForTenant } from '../src/flow/tenant.js';
import { DEMO_TENANT, TenantRegistry, type Tenant } from '../src/tenants.js';
import {
  V1_STEPS,
  defaultWorkflowSet,
  heatPumpTemplate,
  solarTemplate,
} from '../src/workflows/templates.js';
import { checkWorkflow } from '../src/flow/check.js';
import { resolvedFlowFor, workflowsForTenant } from '../src/workflows/tenant.js';
import { workflowStatus } from '../src/workflows/status.js';

const NOW = '2026-11-10T09:00:00Z';

const evQuestion: FlowStep = {
  kind: 'custom',
  id: 'c_evcharger1',
  prompt: 'Would you like an EV charger fitted at the same time?',
  mode: 'quote',
  answer: 'choice',
  choices: [
    {
      value: 'yes',
      label: 'Yes please',
      effects: [{ kind: 'add', itemKey: 'EV-PROJECTEV-7KW-UNTETHERED' }],
    },
    { value: 'no', label: 'Not for now', effects: [] },
  ],
};

const FLOW: ConversationFlow = {
  version: 3,
  updatedAt: '2026-11-09T10:00:00Z',
  steps: [
    { kind: 'preset', id: 'roof_shading' },
    {
      kind: 'preset',
      id: 'ownership',
      prompt: 'Is the home yours?',
      labels: { own: 'Yes, it is mine', rent: 'I rent it' },
    },
    evQuestion,
    { kind: 'preset', id: 'property_type' },
    { kind: 'preset', id: 'usage_source' },
    { kind: 'preset', id: 'tariff_type' },
  ],
};

function tenantWith(config: Record<string, unknown>): Tenant {
  return { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, ...config } };
}

const leadWorkflow: Workflow = {
  id: 'wf_callback',
  kind: 'custom',
  name: 'Call me back',
  enabled: true,
  description: 'Takes a callback request.',
  triggers: [],
  interests: [],
  pages: { include: [], exclude: [] },
  steps: [
    {
      kind: 'custom',
      id: 'c_besttime',
      prompt: 'When is a good time to call?',
      mode: 'lead',
      answer: 'text',
      choices: [],
    },
  ],
  outcome: { kind: 'lead' },
  template: null,
  version: 1,
  updatedAt: NOW,
};

describe('workflowsForTenant', () => {
  it('gives a tenant with no config the default set, marked migrated', () => {
    const out = workflowsForTenant(null);
    expect(out.migrated).toBe(true);
    expect(out.set.discovery.enabled).toBe(true);
    expect(out.set.workflows.map((w) => w.id)).toEqual(['wf_solar', 'wf_heat_pump', 'wf_battery']);
    expect(out.set.workflows[1]!.enabled).toBe(false);
    expect(out.set.workflows[2]!.enabled).toBe(false);
    const bare = workflowsForTenant(tenantWith({}));
    expect(bare.migrated).toBe(true);
    expect(bare.set.workflows[0]!.steps.map((s) => s.id)).toEqual(
      solarTemplate(NOW).steps.map((s) => s.id),
    );
  });

  it('warns and falls back to the default set when the stored workflows are broken', () => {
    const warn = vi.fn();
    const out = workflowsForTenant(tenantWith({ workflows: { nonsense: true } }), warn);
    expect(warn).toHaveBeenCalledOnce();
    // Not a migration: the set is unreadable, and Studio says so.
    expect(out.migrated).toBe(false);
    expect(out.unreadable).toBe(true);
    expect(out.set.workflows[0]!.id).toBe('wf_solar');
  });

  it('returns a valid stored set as it is, with the missing built-in workflows appended', () => {
    const stored = { ...defaultWorkflowSet(NOW), workflows: [leadWorkflow] };
    const out = workflowsForTenant(tenantWith({ workflows: stored }));
    expect(out.migrated).toBe(false);
    expect(out.set.version).toBe(stored.version);
    expect(out.set.workflows.map((w) => w.id)).toEqual([
      'wf_callback',
      'wf_heat_pump',
      'wf_battery',
    ]);
    expect(out.set.workflows[0]).toEqual(leadWorkflow);
    expect(out.set.workflows[1]!.enabled).toBe(false);
    expect(out.set.workflows[2]!.enabled).toBe(false);
  });

  it('migrates the stored conversation into the solar workflow', () => {
    const out = workflowsForTenant(tenantWith({ conversation: FLOW }));
    const solar = out.set.workflows[0]!;
    expect(out.migrated).toBe(true);
    expect(solar.template).toBeNull();
    expect(solar.version).toBe(3);
    expect(solar.steps[0]).toEqual({ kind: 'preset', id: 'address' });
    expect(solar.steps.slice(1)).toEqual(FLOW.steps);
  });

  it('gives a migrated legacy flow no unknown preset', () => {
    for (const config of [{ conversation: FLOW }, {}]) {
      const { set } = workflowsForTenant(tenantWith(config));
      for (const w of set.workflows) {
        expect(checkWorkflow(w, null).map((i) => i.code)).not.toContain('unknown_preset');
      }
    }
  });

  it('asks the same next question as the old flow, for every answer map', () => {
    const tenant = tenantWith({ conversation: FLOW });
    const solar = workflowsForTenant(tenant).set.workflows[0]!;
    const migrated = resolvedFlowFor(solar);
    const old = flowForTenant(tenant);

    const qs = resolveFlow(FLOW).questions;
    const pick = (q: (typeof qs)[number], alt: number): string => {
      if (q.options) return q.options[alt % q.options.length]!;
      if (q.freeText) return 'some words';
      if (q.numeric) return String(Math.ceil((q.numeric.min + q.numeric.max) / 2));
      return 'x';
    };
    const maps: Record<string, string>[] = [];
    for (let alt = 0; alt < 3; alt++) {
      let a: Record<string, string> = {};
      maps.push({});
      for (const q of qs) {
        a = { ...a, [q.id]: pick(q, alt) };
        maps.push(a);
      }
    }
    expect(maps.length).toBeGreaterThanOrEqual(30);
    for (const a of maps) {
      expect(migrated.next(a)).toBe(old.next(a));
    }
  });
});

describe('solarTemplate', () => {
  it('has the agreed shape', () => {
    const w = solarTemplate(NOW);
    expect(w.id).toBe('wf_solar');
    expect(w.enabled).toBe(true);
    expect(w.updatedAt).toBe(NOW);
    expect(w.outcome).toEqual({ kind: 'quote', engine: 'solar' });
    expect(w.steps.map((s) => s.id)).toEqual([
      'ownership',
      'address',
      'roof_size',
      'roof_shading',
      'usage_source',
      'lifestyle',
      'existing_system',
    ]);
    expect(w.template).toEqual({ id: 'solar_quote', version: 2 });
    expect(defaultWorkflowSet(NOW).discovery.enabled).toBe(true);
  });

  it('does not open with the address, so it runs on the solar bank', () => {
    expect(resolvedFlowFor(solarTemplate(NOW)).bank.id).toBe('solar');
  });
});

describe('an untouched version 1 built-in', () => {
  function storedWith(steps: FlowStep[], kind: 'solar' | 'heat_pump'): Tenant {
    const set = defaultWorkflowSet(NOW);
    const hp = heatPumpTemplate(NOW);
    const solar = set.workflows[0]!;
    if (kind === 'solar') {
      solar.steps = steps;
      solar.template = { id: 'solar_quote', version: 1 };
      solar.version = 4;
    } else {
      hp.steps = steps;
      hp.template = { id: 'heat_pump_quote', version: 1 };
      hp.enabled = true;
    }
    set.workflows.push(hp);
    return { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, workflows: set } };
  }

  it('moves to the shorter solar questions, keeping the version counting on', () => {
    const tenant = storedWith(structuredClone([...V1_STEPS.solar_quote!]), 'solar');
    const solar = workflowsForTenant(tenant).set.workflows[0]!;
    expect(solar.steps).toEqual(solarTemplate(NOW).steps);
    expect(solar.template).toEqual({ id: 'solar_quote', version: 2 });
    expect(solar.version).toBe(5);
  });

  it('moves to the shorter heat pump questions and stays switched on', () => {
    const tenant = storedWith(structuredClone([...V1_STEPS.heat_pump_quote!]), 'heat_pump');
    const hp = workflowsForTenant(tenant).set.workflows.find((w) => w.id === 'wf_heat_pump')!;
    expect(hp.steps).toEqual(heatPumpTemplate(NOW).steps);
    expect(hp.enabled).toBe(true);
    expect(hp.template?.version).toBe(2);
  });

  it('is left alone once the installer has edited a question', () => {
    const steps = structuredClone([...V1_STEPS.solar_quote!]);
    steps[1] = { kind: 'preset', id: 'property_type', prompt: 'What sort of home is it?' };
    const tenant = storedWith(steps, 'solar');
    const solar = workflowsForTenant(tenant).set.workflows[0]!;
    expect(solar.steps).toEqual(steps);
    expect(solar.template).toEqual({ id: 'solar_quote', version: 1 });
  });

  it('moves whatever order the stored keys come back in', () => {
    const reordered = V1_STEPS.solar_quote!.map((step) =>
      Object.fromEntries(Object.entries(step).reverse()),
    ) as FlowStep[];
    const solar = workflowsForTenant(storedWith(reordered, 'solar')).set.workflows[0]!;
    expect(solar.template).toEqual({ id: 'solar_quote', version: 2 });
  });

  it('reads the same twice', () => {
    const tenant = storedWith(structuredClone([...V1_STEPS.solar_quote!]), 'solar');
    expect(workflowsForTenant(tenant).set).toEqual(workflowsForTenant(tenant).set);
  });
});

describe('solarTemplate wording', () => {
  it('contains no em or en dashes', () => {
    expect(JSON.stringify(solarTemplate(NOW))).not.toMatch(/[—–]/);
  });
});

describe('workflowStatus', () => {
  it('is ready_for_lead once a lead workflow is answered', () => {
    const before = workflowStatus(leadWorkflow, {}, null);
    expect(before.stage).toBe('questions');
    expect(before.nextQuestionId).toBe('c_besttime');
    expect(before.ready).toBe(false);
    const after = workflowStatus(leadWorkflow, { c_besttime: 'mornings' }, null);
    expect(after.stage).toBe('ready_for_lead');
    expect(after.ready).toBe(true);
    expect(after.journey).toBeNull();
  });

  it('wraps the journey for a solar quote', () => {
    const view = workflowStatus(solarTemplate(NOW), {}, null);
    expect(view.journey).not.toBeNull();
    expect(view.ready).toBe(false);
    expect(view.stage).toBe(view.journey!.stage);
  });
});

describe('configFor', () => {
  it('never sends the workflows to the browser', () => {
    const tenant = tenantWith({ workflows: defaultWorkflowSet(NOW) });
    const registry = new TenantRegistry([tenant]);
    const config = registry.configFor(tenant.publicId);
    expect(config).not.toBeNull();
    expect(config as object).not.toHaveProperty('workflows');
  });
});
