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
import { buildServer } from '../src/server.js';
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
  presets: Array<{ id: string }>;
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
    expect(view.set.workflows.map((w) => w.id)).toEqual(['wf_solar']);
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
    for (let i = 0; i < 11; i++) {
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
    expect(body.next?.id).toBe('motivation');
    expect((await preview('/about')).json<{ appearsOnPage: boolean }>().appearsOnPage).toBe(false);
    expect((await preview()).json<{ appearsOnPage: null }>().appearsOnPage).toBeNull();
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
