import { describe, expect, it, vi } from 'vitest';

import type { ConversationFlow, FlowStep, Workflow } from '@sunny/contracts';

import { resolveFlow } from '../src/flow/resolve.js';
import { flowForTenant } from '../src/flow/tenant.js';
import { DEMO_TENANT, TenantRegistry, type Tenant } from '../src/tenants.js';
import { defaultWorkflowSet, solarTemplate } from '../src/workflows/templates.js';
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
    expect(out.set.workflows).toHaveLength(1);
    expect(out.set.workflows[0]!.id).toBe('wf_solar');
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
    expect(out.migrated).toBe(true);
    expect(out.set.workflows[0]!.id).toBe('wf_solar');
  });

  it('returns a valid stored set as it is', () => {
    const stored = { ...defaultWorkflowSet(NOW), workflows: [leadWorkflow] };
    const out = workflowsForTenant(tenantWith({ workflows: stored }));
    expect(out.migrated).toBe(false);
    expect(out.set.workflows.map((w) => w.id)).toEqual(['wf_callback']);
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
      'motivation',
      'property_type',
      'ownership',
      'address',
      'roof_size',
      'roof_shading',
      'usage_source',
      'lifestyle',
      'tariff_type',
      'existing_system',
      'budget_band',
      'finance_interest',
    ]);
    expect(w.steps.filter((s) => s.optional).map((s) => s.id)).toEqual([
      'budget_band',
      'finance_interest',
    ]);
    expect(defaultWorkflowSet(NOW).discovery.enabled).toBe(true);
  });

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
