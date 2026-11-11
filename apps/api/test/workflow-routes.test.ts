import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { FlowStep, Workflow, WorkflowSet } from '@sunny/contracts';

import { issueDevToken } from '../src/auth/dev.js';
import { publishExample } from '../src/catalogue/price-list-service.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { SOLAR } from '../src/flow/banks.js';
import { buildServer } from '../src/server.js';
import { issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';
import { workflowsForTenant } from '../src/workflows/tenant.js';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';
const OWNER = 'owner@brightside.test';
const VIEWER = 'viewer@brightside.test';

function makeConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-workflows',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: false,
      trustProxyHops: 0,
      rules: {
        session: { limit: 1000, windowMs: 60_000 },
        chat: { limit: 1000, windowMs: 60_000 },
        leads: { limit: 1000, windowMs: 60_000 },
        qualification: { limit: 1000, windowMs: 60_000 },
        catalogue: { limit: 1000, windowMs: 60_000 },
        knowledge: { limit: 1000, windowMs: 60_000 },
      },
      maxKeys: 1000,
    },
  } as unknown as ServerConfig;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const as = (email: string) => ({ authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}` });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-workflows-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: makeConfig(),
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
  });
  await app.ready();
  const signUp = await app.inject({
    method: 'POST',
    url: '/v1/portal/tenants',
    headers: as(OWNER),
    payload: { companyName: 'Brightside Solar' },
  });
  expect(signUp.statusCode).toBe(201);
  const tenantId = signUp.json<{ tenant: { id: string } }>().tenant.id;
  const invite = await app.inject({
    method: 'POST',
    url: `/v1/portal/tenants/${tenantId}/members`,
    headers: as(OWNER),
    payload: { email: VIEWER, role: 'viewer' },
  });
  expect(invite.statusCode).toBeLessThan(300);
  await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
  return { app, store, tenants, tenantId };
}

interface SetView {
  set: WorkflowSet;
  migrated: boolean;
  unreadable?: boolean;
  presets: Array<{ id: string }>;
  presetsByWorkflow: Record<string, Array<{ id: string }>>;
  priceItems: Array<{ key: string }>;
  issues: Array<{ workflowId: string; code: string; message: string; warning?: boolean }>;
}

const url = (tenantId: string, suffix = '') => `/v1/portal/tenants/${tenantId}/workflows${suffix}`;

async function getSet(app: FastifyInstance, tenantId: string): Promise<SetView> {
  const response = await app.inject({ method: 'GET', url: url(tenantId), headers: as(VIEWER) });
  expect(response.statusCode).toBe(200);
  return response.json<SetView>();
}

const solarOf = (view: SetView) => view.set.workflows.find((w) => w.id === 'wf_solar')!;

const putWorkflow = (app: FastifyInstance, tenantId: string, workflow: Workflow, email = OWNER) =>
  app.inject({
    method: 'PUT',
    url: url(tenantId, `/${workflow.id}`),
    headers: as(email),
    payload: { workflow },
  });

const create = (app: FastifyInstance, tenantId: string, payload: object, email = OWNER) =>
  app.inject({ method: 'POST', url: url(tenantId), headers: as(email), payload });

/** Every custom step id under these steps, follow-ups included. */
function customIds(steps: FlowStep[]): string[] {
  return steps.flatMap((s) => [
    ...(s.kind === 'custom' ? [s.id] : []),
    ...customIds((s.followUps ?? []).map((f) => f.step)),
  ]);
}

const askStep: FlowStep = {
  kind: 'custom',
  id: 'c_askcar1',
  prompt: 'Do you have an electric car?',
  mode: 'lead',
  answer: 'choice',
  choices: [
    { value: 'yes', label: 'Yes', effects: [] },
    { value: 'no', label: 'No', effects: [] },
  ],
  followUps: [
    {
      when: ['yes'],
      step: {
        kind: 'custom',
        id: 'c_askcar2',
        prompt: 'Which car is it?',
        mode: 'lead',
        answer: 'text',
        choices: [],
      },
    },
  ],
};

describe('GET /workflows', () => {
  it('gives a fresh installer the default set, migrated', async () => {
    const { app, tenantId } = await setup();
    const view = await getSet(app, tenantId);
    expect(view.migrated).toBe(true);
    // The heat pump and battery quotes ship switched off, beside the solar one.
    expect(view.set.workflows.map((w) => w.id)).toEqual(['wf_solar', 'wf_heat_pump', 'wf_battery']);
    expect(view.set.workflows[1]!.enabled).toBe(false);
    expect(view.set.workflows[2]!.enabled).toBe(false);
    expect(view.set.discovery.enabled).toBe(true);
    expect(view.presets.length).toBeGreaterThan(0);
    expect(view.priceItems.length).toBeGreaterThan(0);
    expect(view.issues.filter((i) => !i.warning)).toEqual([]);
  });

  it('reads one workflow, and 404s a missing one', async () => {
    const { app, tenantId } = await setup();
    const one = await app.inject({
      method: 'GET',
      url: url(tenantId, '/wf_solar'),
      headers: as(VIEWER),
    });
    expect(one.statusCode).toBe(200);
    const body = one.json<{ workflow: Workflow; presets: unknown[]; issues: unknown[] }>();
    expect(body.workflow.id).toBe('wf_solar');
    expect(body.presets.length).toBeGreaterThan(0);
    const missing = await app.inject({
      method: 'GET',
      url: url(tenantId, '/wf_nothing_here'),
      headers: as(VIEWER),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('gives each workflow the presets of its own bank', async () => {
    const { app, tenantId } = await setup();
    const one = await app.inject({
      method: 'GET',
      url: url(tenantId, '/wf_heat_pump'),
      headers: as(VIEWER),
    });
    expect(one.statusCode).toBe(200);
    const ids = one.json<{ presets: Array<{ id: string }> }>().presets.map((p) => p.id);
    expect(ids).toContain('hp_age');
    expect(ids).not.toContain('roof_direction');

    const solar = await app.inject({
      method: 'GET',
      url: url(tenantId, '/wf_solar'),
      headers: as(VIEWER),
    });
    expect(solar.json<{ presets: Array<{ id: string }> }>().presets.map((p) => p.id)).not.toContain(
      'hp_age',
    );

    const view = await getSet(app, tenantId);
    expect(view.presetsByWorkflow['wf_heat_pump']!.map((p) => p.id)).toContain('hp_age');
    expect(view.presetsByWorkflow['wf_solar']!.map((p) => p.id)).not.toContain('hp_age');
    // `presets` stays the solar bank's, for older Studio builds.
    expect(view.presets.map((p) => p.id)).not.toContain('hp_age');
  });

  it('gives the battery workflow the battery bank', async () => {
    const { app, tenantId } = await setup();
    const one = await app.inject({
      method: 'GET',
      url: url(tenantId, '/wf_battery'),
      headers: as(VIEWER),
    });
    expect(one.statusCode).toBe(200);
    const ids = one.json<{ presets: Array<{ id: string }> }>().presets.map((p) => p.id);
    expect(ids).toContain('bat_inverter');
    expect(ids).not.toContain('hp_age');
    expect(ids).not.toContain('roof_direction');

    const view = await getSet(app, tenantId);
    expect(view.presetsByWorkflow['wf_battery']!.map((p) => p.id)).toContain('bat_inverter');
    expect(view.presetsByWorkflow['wf_heat_pump']!.map((p) => p.id)).not.toContain('bat_inverter');
    expect(view.presets.map((p) => p.id)).not.toContain('bat_inverter');
  });

  it('gives a custom workflow ending in a battery quote the battery bank', async () => {
    const { app, tenantId } = await setup();
    const made = await create(app, tenantId, { from: 'blank', name: 'Battery offers' });
    const custom = made.json<{ workflow: Workflow }>().workflow;
    const saved = await putWorkflow(app, tenantId, {
      ...custom,
      outcome: { kind: 'quote', engine: 'battery' },
      steps: [{ kind: 'preset', id: 'address' }],
    });
    expect(saved.statusCode).toBe(200);
    const view = await getSet(app, tenantId);
    expect(view.presetsByWorkflow[custom.id]!.map((p) => p.id)).toContain('bat_inverter');
  });
});

describe('PUT /workflows/:id', () => {
  it('saves with the version read, bumps it, and refuses a stale version with 409', async () => {
    const { app, tenantId, tenants } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const first = await putWorkflow(app, tenantId, { ...solar, name: 'Solar for Norwich' });
    expect(first.statusCode).toBe(200);
    const saved = solarOf(first.json<SetView>());
    expect(saved.version).toBe(solar.version + 1);
    expect(saved.name).toBe('Solar for Norwich');
    expect(saved.updatedAt).toBe(new Date(NOW).toISOString());
    expect(first.json<SetView>().migrated).toBe(false);

    const stale = await putWorkflow(app, tenantId, { ...solar, name: 'Again' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { message: string } }>().error.message).toBe(
      'Someone else changed this workflow. Reload to see their changes.',
    );

    // Chat reads the saved set.
    const tenant = (await tenants.fresh(tenantId))!;
    const loaded = workflowsForTenant(tenant);
    expect(loaded.migrated).toBe(false);
    expect(loaded.set.workflows[0]!.name).toBe('Solar for Norwich');
  });

  it('keeps the stored kind and template whatever the client sends', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const response = await putWorkflow(app, tenantId, { ...solar, template: null });
    expect(response.statusCode).toBe(200);
    expect(solarOf(response.json<SetView>()).template).toEqual(solar.template);
  });

  it('refuses a body whose id is not the one in the path', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const response = await app.inject({
      method: 'PUT',
      url: url(tenantId, '/wf_other_one'),
      headers: as(OWNER),
      payload: { workflow: solar },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a page pattern that is not a path', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const response = await putWorkflow(app, tenantId, {
      ...solar,
      pages: { include: ['offers'], exclude: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ issues: Array<{ code: string }> }>().issues[0]!.code).toBe(
      'bad_page_pattern',
    );
  });

  it('refuses a solar quote without the address question', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const response = await putWorkflow(app, tenantId, {
      ...solar,
      steps: solar.steps.filter((s) => s.id !== 'address'),
    });
    expect(response.statusCode).toBe(400);
    const issues = response.json<{ issues: Array<{ code: string }> }>().issues;
    expect(issues.map((i) => i.code)).toContain('needs_address');
  });

  it('refuses a heat pump quote with a solar question in it', async () => {
    const { app, tenantId } = await setup();
    const view = await getSet(app, tenantId);
    const hp = view.set.workflows.find((w) => w.id === 'wf_heat_pump')!;
    const response = await putWorkflow(app, tenantId, {
      ...hp,
      steps: [...hp.steps, { kind: 'preset', id: 'roof_direction' }],
    });
    expect(response.statusCode).toBe(400);
    const issues = response.json<{ issues: Array<{ code: string }> }>().issues;
    expect(issues.map((i) => i.code)).toContain('unknown_preset');
  });

  it('refuses a heat pump quote without the address question', async () => {
    const { app, tenantId } = await setup();
    const view = await getSet(app, tenantId);
    const hp = view.set.workflows.find((w) => w.id === 'wf_heat_pump')!;
    expect(hp.steps.some((s) => s.id === 'address')).toBe(true);
    const response = await putWorkflow(app, tenantId, {
      ...hp,
      steps: hp.steps.filter((s) => s.id !== 'address'),
    });
    expect(response.statusCode).toBe(400);
    const issues = response.json<{ issues: Array<{ code: string }> }>().issues;
    expect(issues.map((i) => i.code)).toContain('needs_address');
  });
});

describe('a custom step id shared by two workflows', () => {
  /** A custom workflow holding `askStep` (c_askcar1, c_askcar2), and the solar one. */
  async function withCustom() {
    const ctx = await setup();
    const made = await create(ctx.app, ctx.tenantId, { from: 'blank', name: 'EV chargers' });
    const custom = made.json<{ workflow: Workflow }>().workflow;
    const saved = await putWorkflow(ctx.app, ctx.tenantId, { ...custom, steps: [askStep] });
    expect(saved.statusCode).toBe(200);
    return { ...ctx, customId: custom.id };
  }

  it('refuses a solar save that reuses an id the custom workflow has', async () => {
    const { app, tenantId } = await withCustom();
    const solar = solarOf(await getSet(app, tenantId));
    const response = await putWorkflow(app, tenantId, {
      ...solar,
      steps: [...solar.steps, askStep],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ issues: Array<{ code: string }> }>().issues[0]!.code).toBe(
      'duplicate_step_id',
    );
  });

  it('refuses a custom save that reuses an id the solar workflow has', async () => {
    const { app, tenantId, customId } = await setup().then(async (ctx) => {
      const solar = solarOf(await getSet(ctx.app, ctx.tenantId));
      const saved = await putWorkflow(ctx.app, ctx.tenantId, {
        ...solar,
        steps: [...solar.steps, askStep],
      });
      expect(saved.statusCode).toBe(200);
      const made = await create(ctx.app, ctx.tenantId, { from: 'blank', name: 'EV chargers' });
      return { ...ctx, customId: made.json<{ workflow: Workflow }>().workflow.id };
    });
    const custom = (await getSet(app, tenantId)).set.workflows.find((w) => w.id === customId)!;
    const response = await putWorkflow(app, tenantId, { ...custom, steps: [askStep] });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ issues: Array<{ code: string }> }>().issues[0]!.code).toBe(
      'duplicate_step_id',
    );
  });

  it('refuses a /conversation save that reuses an id the custom workflow has', async () => {
    const { app, store, tenantId } = await withCustom();
    const before = solarOf(await getSet(app, tenantId));
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/portal/tenants/${tenantId}/conversation`,
      headers: as(OWNER),
      payload: { flow: { version: 0, updatedAt: '2026-01-01T00:00:00Z', steps: [askStep] } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ issues: Array<{ code: string }> }>().issues[0]!.code).toBe(
      'duplicate_step_id',
    );
    // Nothing was written.
    expect(solarOf(await getSet(app, tenantId))).toEqual(before);
    expect((await store.getTenant(tenantId))?.config.conversation).toBeUndefined();
  });
});

describe('viewers', () => {
  it('are refused PUT, POST and DELETE', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    expect((await putWorkflow(app, tenantId, solar, VIEWER)).statusCode).toBe(403);
    expect((await create(app, tenantId, { from: 'blank' }, VIEWER)).statusCode).toBe(403);
    const del = await app.inject({
      method: 'DELETE',
      url: url(tenantId, '/wf_solar'),
      headers: as(VIEWER),
    });
    expect(del.statusCode).toBe(403);
    const settings = await app.inject({
      method: 'PUT',
      url: url(tenantId, '/settings'),
      headers: as(VIEWER),
      payload: { discoveryEnabled: false },
    });
    expect(settings.statusCode).toBe(403);
  });
});

describe('POST /workflows', () => {
  it('creates a blank, switched-off lead workflow', async () => {
    const { app, tenantId } = await setup();
    const response = await create(app, tenantId, { from: 'blank' });
    expect(response.statusCode).toBe(200);
    const { workflow, view } = response.json<{ workflow: Workflow; view: SetView }>();
    expect(workflow.id).toMatch(/^wf_/);
    expect(workflow).toMatchObject({
      kind: 'custom',
      name: 'New workflow',
      enabled: false,
      outcome: { kind: 'lead' },
      triggers: [],
      interests: [],
      pages: { include: [], exclude: [] },
      template: null,
    });
    expect(workflow.steps).toHaveLength(1);
    expect(workflow.steps[0]).toMatchObject({
      kind: 'custom',
      prompt: 'What would you like help with?',
      mode: 'lead',
      answer: 'text',
    });
    expect(workflow.steps[0]!.id).toMatch(/^c_[a-z0-9]{10}$/);
    expect(view.set.workflows.map((w) => w.id)).toContain(workflow.id);

    // A second one gets its own id.
    const again = await create(app, tenantId, { from: 'blank' });
    expect(again.json<{ workflow: Workflow }>().workflow.id).toBe(`${workflow.id}_2`);
  });

  it('names a workflow from the name given', async () => {
    const { app, tenantId } = await setup();
    const response = await create(app, tenantId, { from: 'blank', name: 'EV Chargers!' });
    const { workflow } = response.json<{ workflow: Workflow }>();
    expect(workflow.name).toBe('EV Chargers!');
    expect(workflow.id).toBe('wf_ev_chargers');
  });

  it('copies a workflow with fresh custom ids and no template', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const saved = await putWorkflow(app, tenantId, { ...solar, steps: [...solar.steps, askStep] });
    expect(saved.statusCode).toBe(200);

    const response = await create(app, tenantId, { from: { copy: 'wf_solar' } });
    expect(response.statusCode).toBe(200);
    const { workflow, view } = response.json<{ workflow: Workflow; view: SetView }>();
    expect(workflow.template).toBeNull();
    expect(workflow.kind).toBe('custom');
    expect(workflow.enabled).toBe(false);
    expect(workflow.name).toBe('Solar quote copy');
    expect(workflow.outcome).toEqual({ kind: 'quote', engine: 'solar' });
    const ids = customIds(workflow.steps);
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(id).toMatch(/^c_[a-z0-9]{10}$/);
      expect(['c_askcar1', 'c_askcar2']).not.toContain(id);
    }
    expect(view.issues.filter((i) => !i.warning)).toEqual([]);
  });

  it('copies the solar workflow when one exists and solar_quote is asked for', async () => {
    const { app, tenantId } = await setup();
    const response = await create(app, tenantId, { from: 'solar_quote' });
    expect(response.statusCode).toBe(200);
    const { workflow } = response.json<{ workflow: Workflow }>();
    expect(workflow.id).not.toBe('wf_solar');
    expect(workflow.template).toBeNull();
    expect(workflow.name).toBe('Solar quote copy');
  });

  it('refuses a 13th workflow', async () => {
    const { app, tenantId } = await setup();
    // Solar, heat pump and battery are built in, so nine more make twelve.
    for (let i = 0; i < 9; i++) {
      expect((await create(app, tenantId, { from: 'blank' })).statusCode).toBe(200);
    }
    const thirteenth = await create(app, tenantId, { from: 'blank' });
    expect(thirteenth.statusCode).toBe(400);
    expect(thirteenth.json<{ error: { message: string } }>().error.message).toBe(
      'You can have up to 12 workflows.',
    );
  });

  it('404s a copy of a workflow that is not there', async () => {
    const { app, tenantId } = await setup();
    const response = await create(app, tenantId, { from: { copy: 'wf_nothing_here' } });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /workflows/:id', () => {
  it('will not delete a built-in, but deletes a custom one', async () => {
    const { app, tenantId } = await setup();
    const builtin = await app.inject({
      method: 'DELETE',
      url: url(tenantId, '/wf_solar'),
      headers: as(OWNER),
    });
    expect(builtin.statusCode).toBe(400);
    expect(builtin.json<{ error: { message: string } }>().error.message).toBe(
      'Built-in workflows can be switched off but not deleted.',
    );
    const heatPump = await app.inject({
      method: 'DELETE',
      url: url(tenantId, '/wf_heat_pump'),
      headers: as(OWNER),
    });
    expect(heatPump.statusCode).toBe(400);
    const battery = await app.inject({
      method: 'DELETE',
      url: url(tenantId, '/wf_battery'),
      headers: as(OWNER),
    });
    expect(battery.statusCode).toBe(400);
    expect((await getSet(app, tenantId)).set.workflows.map((w) => w.id)).toContain('wf_battery');

    const made = await create(app, tenantId, { from: 'blank' });
    const id = made.json<{ workflow: Workflow }>().workflow.id;
    const gone = await app.inject({
      method: 'DELETE',
      url: url(tenantId, `/${id}`),
      headers: as(OWNER),
    });
    expect(gone.statusCode).toBe(200);
    expect(gone.json<SetView>().set.workflows.map((w) => w.id)).not.toContain(id);
    expect((await getSet(app, tenantId)).set.workflows.map((w) => w.id)).not.toContain(id);
  });
});

describe('PUT /workflows/settings', () => {
  it('switches discovery off and keeps it off', async () => {
    const { app, tenantId } = await setup();
    const response = await app.inject({
      method: 'PUT',
      url: url(tenantId, '/settings'),
      headers: as(OWNER),
      payload: { discoveryEnabled: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<SetView>().set.discovery.enabled).toBe(false);
    expect((await getSet(app, tenantId)).set.discovery.enabled).toBe(false);
  });
});

describe('POST /workflows/:id/preview', () => {
  it('says whether the workflow appears on a page', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const workflow = { ...solar, pages: { include: ['/battery-deal*'], exclude: [] } };
    const preview = (path?: string) =>
      app.inject({
        method: 'POST',
        url: url(tenantId, '/wf_solar/preview'),
        headers: as(VIEWER),
        payload: { workflow, answers: {}, ...(path ? { path } : {}) },
      });
    const on = await preview('/battery-deal');
    expect(on.statusCode).toBe(200);
    const body = on.json<{ next: { id: string } | null; appearsOnPage: boolean | null }>();
    expect(body.appearsOnPage).toBe(true);
    expect(body.next?.id).toBe('ownership');
    expect((await preview('/about')).json<{ appearsOnPage: boolean }>().appearsOnPage).toBe(false);
    expect((await preview()).json<{ appearsOnPage: null }>().appearsOnPage).toBeNull();
  });

  it('never asks a question Sunny sets itself, and confirms the roof after the address', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const answers: Record<string, string> = {};
    const asked: string[] = [];
    for (let i = 0; i < 40; i++) {
      const response = await app.inject({
        method: 'POST',
        url: url(tenantId, '/wf_solar/preview'),
        headers: as(VIEWER),
        payload: { workflow: solar, answers },
      });
      expect(response.statusCode).toBe(200);
      const next = response.json<{
        next: { id: string; options: Array<{ value: string }> } | null;
      }>().next;
      if (!next) break;
      expect(asked).not.toContain(next.id);
      asked.push(next.id);
      answers[next.id] =
        next.id === 'address'
          ? '164 Norwich Drive, Norwich NR4 7TJ'
          : (next.options[0]?.value ?? '120');
    }
    for (const id of SOLAR.systemSet) expect(asked).not.toContain(id);
    expect(asked[asked.indexOf('address') + 1]).toBe('roof_confirmed');
    expect(asked.length).toBeGreaterThan(3);
  });
});

describe('a stored set that no longer parses', () => {
  async function corrupt() {
    const ctx = await setup();
    const broken = { version: 3, workflows: 'not a list' } as unknown as WorkflowSet;
    await ctx.tenants.update(ctx.tenantId, (t) => ({
      ...t,
      config: { ...t.config, workflows: broken },
    }));
    return { ...ctx, broken };
  }

  it('reads as unreadable, not migrated', async () => {
    const { app, tenantId } = await corrupt();
    const view = await getSet(app, tenantId);
    expect(view.unreadable).toBe(true);
    expect(view.migrated).toBe(false);
  });

  it('refuses every write and leaves what is stored alone', async () => {
    const { app, store, tenantId, broken } = await corrupt();
    const solar = solarOf(await getSet(app, tenantId));
    const put = await putWorkflow(app, tenantId, { ...solar, name: 'Overwrite' });
    expect(put.statusCode).toBe(500);
    expect(put.json<{ error: { message: string } }>().error.message).toBe(
      'Your saved workflows could not be read. Nothing was changed.',
    );
    const settings = await app.inject({
      method: 'PUT',
      url: url(tenantId, '/settings'),
      headers: as(OWNER),
      payload: { discoveryEnabled: false },
    });
    expect(settings.statusCode).toBe(500);
    const shim = await app.inject({
      method: 'PUT',
      url: `/v1/portal/tenants/${tenantId}/conversation`,
      headers: as(OWNER),
      payload: { flow: { version: 0, updatedAt: '2026-01-01T00:00:00Z', steps: [askStep] } },
    });
    expect(shim.statusCode).toBe(500);
    expect((await store.getTenant(tenantId))?.config.workflows).toEqual(broken);
  });
});

describe('a tenant with a stored conversation', () => {
  it('keeps its steps, after the address, and its version through the first save', async () => {
    const { app, store, tenants, tenantId } = await setup();
    const conversation = {
      version: 7,
      updatedAt: '2026-10-01T00:00:00.000Z',
      steps: [{ kind: 'preset', id: 'roof_size' }, askStep] as FlowStep[],
    };
    await tenants.update(tenantId, (t) => ({ ...t, config: { ...t.config, conversation } }));

    const read = await getSet(app, tenantId);
    expect(read.migrated).toBe(true);
    const solar = solarOf(read);
    expect(solar.steps.map((s) => s.id)).toEqual(['address', 'roof_size', 'c_askcar1']);
    expect(solar.version).toBe(7);

    const put = await putWorkflow(app, tenantId, solar);
    expect(put.statusCode).toBe(200);
    const saved = solarOf(put.json<SetView>());
    expect(saved.steps).toEqual(solar.steps);
    expect(saved.version).toBe(8);
    expect((await store.getTenant(tenantId))?.config.conversation).toEqual(conversation);
  });
});

describe('the quote journey once workflows are saved', () => {
  it('asks the questions Studio added to the solar workflow', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const quoteStep: FlowStep = {
      kind: 'custom',
      id: 'c_scaffold',
      prompt: 'Is there room for scaffolding?',
      mode: 'quote',
      answer: 'choice',
      choices: [
        { value: 'yes', label: 'Yes', effects: [] },
        { value: 'no', label: 'No', effects: [] },
      ],
    };
    const put = await putWorkflow(app, tenantId, { ...solar, steps: [...solar.steps, quoteStep] });
    expect(put.statusCode).toBe(200);

    const session = issueSessionToken(
      { tenantId, sessionId: 's_journey', expiresAt: NOW + 3_600_000 },
      SECRET,
    );
    const journey = await app.inject({
      method: 'GET',
      url: '/v1/quote/journey',
      headers: { authorization: `Bearer ${session}` },
    });
    expect(journey.statusCode).toBe(200);
    expect(journey.json<{ missing: string[] }>().missing).toContain('c_scaffold');
  });
});

describe('POST /workflows/:id/reset', () => {
  it('restores the template but keeps pages and enabled', async () => {
    const { app, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    const pages = { include: ['/solar*'], exclude: [] };
    const saved = await putWorkflow(app, tenantId, {
      ...solar,
      name: 'Changed',
      enabled: false,
      pages,
      steps: [...solar.steps, askStep],
    });
    expect(saved.statusCode).toBe(200);
    const response = await app.inject({
      method: 'POST',
      url: url(tenantId, '/wf_solar/reset'),
      headers: as(OWNER),
    });
    expect(response.statusCode).toBe(200);
    const reset = solarOf(response.json<SetView>());
    expect(reset.name).toBe('Solar quote');
    expect(reset.enabled).toBe(false);
    expect(reset.pages).toEqual(pages);
    expect(reset.steps).toEqual(solar.steps);
    expect(reset.version).toBe(solar.version + 2);
  });

  it('resets the heat pump workflow to its template', async () => {
    const { app, tenantId } = await setup();
    const hpOf = (view: SetView) => view.set.workflows.find((w) => w.id === 'wf_heat_pump')!;
    const hp = hpOf(await getSet(app, tenantId));
    const saved = await putWorkflow(app, tenantId, { ...hp, name: 'Heat pumps', enabled: true });
    expect(saved.statusCode).toBe(200);
    const response = await app.inject({
      method: 'POST',
      url: url(tenantId, '/wf_heat_pump/reset'),
      headers: as(OWNER),
    });
    expect(response.statusCode).toBe(200);
    const reset = hpOf(response.json<SetView>());
    expect(reset.name).toBe('Heat pump quote');
    expect(reset.enabled).toBe(true);
    expect(reset.steps).toEqual(hp.steps);
    expect(reset.template).toEqual({ id: 'heat_pump_quote', version: 2 });
  });

  it('resets the battery workflow to its template', async () => {
    const { app, tenantId } = await setup();
    const batOf = (view: SetView) => view.set.workflows.find((w) => w.id === 'wf_battery')!;
    const bat = batOf(await getSet(app, tenantId));
    const saved = await putWorkflow(app, tenantId, { ...bat, name: 'Batteries', enabled: true });
    expect(saved.statusCode).toBe(200);
    const response = await app.inject({
      method: 'POST',
      url: url(tenantId, '/wf_battery/reset'),
      headers: as(OWNER),
    });
    expect(response.statusCode).toBe(200);
    const reset = batOf(response.json<SetView>());
    expect(reset.name).toBe('Battery quote');
    expect(reset.enabled).toBe(true);
    expect(reset.steps).toEqual(bat.steps);
    expect(reset.template).toEqual({ id: 'battery_quote', version: 1 });
  });

  it('refuses a custom workflow', async () => {
    const { app, tenantId } = await setup();
    const made = await create(app, tenantId, { from: 'blank' });
    const id = made.json<{ workflow: Workflow }>().workflow.id;
    const response = await app.inject({
      method: 'POST',
      url: url(tenantId, `/${id}/reset`),
      headers: as(OWNER),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('the /conversation shim', () => {
  it('writes into wf_solar once workflows are saved, leaving config.conversation alone', async () => {
    const { app, store, tenantId } = await setup();
    const solar = solarOf(await getSet(app, tenantId));
    expect((await putWorkflow(app, tenantId, solar)).statusCode).toBe(200);

    const conv = `/v1/portal/tenants/${tenantId}/conversation`;
    const before = await app.inject({ method: 'GET', url: conv, headers: as(VIEWER) });
    expect(before.statusCode).toBe(200);
    expect(before.json<{ flow: { steps: FlowStep[] } }>().flow?.steps.map((s) => s.id)).toEqual(
      solar.steps.map((s) => s.id),
    );

    const put = await app.inject({
      method: 'PUT',
      url: conv,
      headers: as(OWNER),
      payload: {
        flow: {
          version: 0,
          updatedAt: '2026-01-01T00:00:00Z',
          steps: [{ kind: 'preset', id: 'roof_size' }, askStep],
        },
      },
    });
    expect(put.statusCode).toBe(200);
    const flow = put.json<{ flow: { version: number; steps: FlowStep[] } }>().flow;
    expect(flow.steps.map((s) => s.id)).toEqual(['roof_size', 'c_askcar1']);

    const after = solarOf(await getSet(app, tenantId));
    expect(after.steps.map((s) => s.id)).toEqual(['address', 'roof_size', 'c_askcar1']);
    expect(after.version).toBe(solar.version + 2);
    expect(flow.version).toBe(after.version);
    const stored = await store.getTenant(tenantId);
    expect(stored?.config.conversation).toBeUndefined();

    // A reset puts the template back in wf_solar.
    const reset = await app.inject({ method: 'DELETE', url: conv, headers: as(OWNER) });
    expect(reset.statusCode).toBe(200);
    expect(solarOf(await getSet(app, tenantId)).steps).toEqual(solar.steps);
  });
});
