import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConversationFlow, FlowStep } from '@sunny/contracts';

import type { ChatChunk, ChatProvider } from '../src/agent/provider.js';
import { issueDevToken } from '../src/auth/dev.js';
import { priceFor } from '../src/catalogue/price-list.js';
import { getPublishedPriceList, publishExample } from '../src/catalogue/price-list-service.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';
const OWNER = 'owner@brightside.test';
const VIEWER = 'viewer@brightside.test';
const EV = 'EV-PROJECTEV-7KW-UNTETHERED';
const FEE = 'ELEC-ADMIN-FEE';

function makeConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-conversation',
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

async function setup(provider?: ChatProvider) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-conversation-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: makeConfig(),
    store,
    tenants,
    ...(provider ? { provider } : {}),
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
  return { app, store, tenants, tenantId };
}

const as = (email: string) => ({ authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}` });

const evStep: FlowStep = {
  kind: 'custom',
  id: 'c_evcharger1',
  prompt: 'Would you like an EV charger fitted at the same time?',
  mode: 'quote',
  answer: 'choice',
  choices: [
    { value: 'yes', label: 'Yes please', effects: [{ kind: 'add', itemKey: EV }] },
    { value: 'no', label: 'Not for now', effects: [] },
  ],
};

function flowOf(steps: FlowStep[]): ConversationFlow {
  return { version: 0, updatedAt: '2026-01-01T00:00:00Z', steps };
}

interface View {
  flow: ConversationFlow | null;
  presets: Array<{
    id: string;
    prompt: string;
    options: Array<{ value: string; label: string }>;
    fixed: boolean;
    warning: string | null;
    group: string[];
    appearsWhen: { questionId: string; anyOf: string[] } | null;
  }>;
  priceItems: Array<{
    key: string;
    name: string;
    category: string;
    unitLabel: string;
    packageUnit: boolean;
    needsQuantity: boolean;
    mandatory: boolean;
    targetable: boolean;
    priceText: string;
  }>;
  issues: Array<{ stepId: string; code: string; message: string }>;
}

const url = (tenantId: string, suffix = '') =>
  `/v1/portal/tenants/${tenantId}/conversation${suffix}`;

const put = (app: FastifyInstance, tenantId: string, email: string, flow: unknown) =>
  app.inject({
    method: 'PUT',
    url: url(tenantId),
    headers: as(email),
    payload: { flow },
  });

describe('GET /conversation', () => {
  it('describes a tenant with no flow: presets, the published price list and no issues', async () => {
    const { app, store, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const response = await app.inject({ method: 'GET', url: url(tenantId), headers: as(VIEWER) });
    expect(response.statusCode).toBe(200);
    const view = response.json<View>();
    expect(view.flow).toBeNull();
    expect(view.issues).toEqual([]);

    const address = view.presets.find((p) => p.id === 'address')!;
    expect(address.fixed).toBe(true);
    const shading = view.presets.find((p) => p.id === 'roof_shading')!;
    expect(shading.fixed).toBe(false);
    expect(shading.warning).toMatch(/shade/);
    expect(shading.options.length).toBeGreaterThan(0);
    expect(shading.options[0]).toEqual({ value: expect.any(String), label: expect.any(String) });
    expect(view.presets.find((p) => p.id === 'usage_source')!.group).toEqual([
      'annual_kwh',
      'monthly_cost',
      'household_size',
    ]);
    // Studio's preview answers the question a group member waits on.
    expect(view.presets.find((p) => p.id === 'household_size')!.appearsWhen).toEqual({
      questionId: 'usage_source',
      anyOf: ['household'],
    });
    expect(view.presets.find((p) => p.id === 'roof_shading')!.appearsWhen).toBeNull();

    const ev = view.priceItems.find((i) => i.key === EV)!;
    expect(ev).toMatchObject({ mandatory: false, targetable: true, packageUnit: false });
    expect(ev.priceText).toContain('995');
    const fee = view.priceItems.find((i) => i.key === FEE)!;
    expect(fee).toMatchObject({ mandatory: true, targetable: false });
    const base = view.priceItems.find((i) => i.category === 'pv')!;
    expect(base.targetable).toBe(false);
    expect(view.priceItems.some((i) => i.packageUnit)).toBe(true);
  });

  it('says which items need a quantity, by the rule the quote applies', async () => {
    const { app, store, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const response = await app.inject({ method: 'GET', url: url(tenantId), headers: as(VIEWER) });
    const items = response.json<View>().priceItems;
    const byKey = (key: string) => items.find((i) => i.key === key)!;
    // An extra priced per roof: the installer sets how many.
    expect(byKey('STRUCT-FLATROOF-SURVEY')).toMatchObject({
      unitLabel: 'roof',
      needsQuantity: true,
    });
    // Per panel (the package counts) and flat items never ask.
    expect(byKey('OPT-TIGO-PART')).toMatchObject({ packageUnit: true, needsQuantity: false });
    expect(byKey(EV).needsQuantity).toBe(false);
    for (const item of items.filter((i) => i.needsQuantity)) {
      expect(['scaffold', 'electrical', 'optional', 'admin', 'other']).toContain(item.category);
    }
  });

  it('has no price items before a list is published', async () => {
    const { app, tenantId } = await setup();
    const response = await app.inject({ method: 'GET', url: url(tenantId), headers: as(VIEWER) });
    expect(response.statusCode).toBe(200);
    expect(response.json<View>().priceItems).toEqual([]);
  });
});

describe('PUT /conversation', () => {
  it('saves a flow, bumps the version and returns the same shape as GET', async () => {
    const { app, store, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const first = await put(app, tenantId, OWNER, flowOf([evStep]));
    expect(first.statusCode).toBe(200);
    const saved = first.json<View>();
    expect(saved.flow?.version).toBe(1);
    expect(saved.flow?.updatedAt).toBe(new Date(NOW).toISOString());
    expect(saved.issues).toEqual([]);
    expect(saved.presets.length).toBeGreaterThan(0);

    const read = await app.inject({ method: 'GET', url: url(tenantId), headers: as(VIEWER) });
    expect(read.json<View>().flow).toEqual(saved.flow);

    // The client's own version and time are never trusted.
    const second = await put(app, tenantId, OWNER, { ...flowOf([evStep]), version: 99 });
    expect(second.json<View>().flow?.version).toBe(2);
  });

  it('refuses a flow that targets a mandatory item, with the price list message', async () => {
    const { app, store, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const bad: FlowStep = {
      ...evStep,
      choices: [{ value: 'yes', label: 'Yes', effects: [{ kind: 'remove', itemKey: FEE }] }],
    };
    const response = await put(app, tenantId, OWNER, flowOf([bad]));
    expect(response.statusCode).toBe(400);
    const body = response.json<{
      error: { message: string };
      issues: Array<{ code: string; stepId: string; message: string }>;
    }>();
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0]).toMatchObject({ code: 'mandatory_item', stepId: 'c_evcharger1' });
    expect(body.issues[0]!.message).toBe(
      'Administration fee (mandatory) is on every quote, so an answer cannot remove or swap it.',
    );
    expect(body.error.message).toBe(body.issues[0]!.message);

    const read = await app.inject({ method: 'GET', url: url(tenantId), headers: as(OWNER) });
    expect(read.json<View>().flow).toBeNull();
  });

  it('refuses a choice question with no answers', async () => {
    const { app, store, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const response = await put(app, tenantId, OWNER, flowOf([{ ...evStep, choices: [] }]));
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { message: string }; issues: Array<{ code: string }> }>();
    expect(body.issues.map((i) => i.code)).toEqual(['no_choices']);
    expect(body.error.message).toBe('Add at least one answer to this question.');
  });

  it('refuses a body that is not a conversation flow', async () => {
    const { app, tenantId } = await setup();
    const response = await put(app, tenantId, OWNER, { steps: 'nope' });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a viewer', async () => {
    const { app, tenantId } = await setup();
    const response = await put(app, tenantId, VIEWER, flowOf([]));
    expect(response.statusCode).toBe(403);
  });
});

describe('DELETE /conversation', () => {
  it('resets to Sunny’s own questions', async () => {
    const { app, store, tenants, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    await put(app, tenantId, OWNER, flowOf([evStep]));
    expect(tenants.byId(tenantId)?.config.conversation).toBeDefined();

    const response = await app.inject({
      method: 'DELETE',
      url: url(tenantId),
      headers: as(OWNER),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<View>().flow).toBeNull();
    expect(tenants.byId(tenantId)?.config.conversation).toBeUndefined();
  });

  it('refuses a viewer', async () => {
    const { app, tenantId } = await setup();
    const response = await app.inject({
      method: 'DELETE',
      url: url(tenantId),
      headers: as(VIEWER),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /conversation/preview', () => {
  interface Preview {
    next: { id: string; prompt: string; options: Array<{ value: string; label: string }> } | null;
    effects: Array<{ label: string; priceText: string; questionId: string; value: string }>;
    issues: unknown[];
  }
  const preview = (app: FastifyInstance, tenantId: string, email: string, body: object) =>
    app.inject({
      method: 'POST',
      url: url(tenantId, '/preview'),
      headers: as(email),
      payload: body,
    });

  it('prices the EV charger from the published list when the answer is yes', async () => {
    const { app, store, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const answers = { address: '1 High St', roof_confidence: 'high', roof_confirmed: 'yes' };
    const yes = await preview(app, tenantId, VIEWER, {
      flow: flowOf([evStep]),
      answers: { ...answers, c_evcharger1: 'yes' },
    });
    expect(yes.statusCode).toBe(200);
    const body = yes.json<Preview>();
    expect(body.effects).toHaveLength(1);
    expect(body.effects[0]!.label).toMatch(/^Adds .*7kW/);
    expect(body.effects[0]!.priceText).toBe('£995');
    expect(body.next).toBeNull();

    const no = await preview(app, tenantId, VIEWER, {
      flow: flowOf([evStep]),
      answers: { ...answers, c_evcharger1: 'no' },
    });
    expect(no.json<Preview>().effects).toEqual([]);
  });

  it('names the answer behind each effect, and labels a swap as replacing the old item', async () => {
    const { app, store, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const TETHERED = 'EV-PROJECTEV-7KW-TETHERED';
    const withFollowUp: FlowStep = {
      ...evStep,
      followUps: [
        {
          when: ['yes'],
          step: {
            kind: 'custom',
            id: 'c_tethered1',
            prompt: 'Would you like the cable fixed to the charger?',
            mode: 'quote',
            answer: 'choice',
            choices: [
              {
                value: 'yes',
                label: 'Yes',
                effects: [{ kind: 'swap', fromKey: EV, toKey: TETHERED }],
              },
              { value: 'no', label: 'No', effects: [] },
            ],
          },
        },
      ],
    };
    const response = await preview(app, tenantId, VIEWER, {
      flow: flowOf([withFollowUp]),
      answers: {
        address: '1 High St',
        roof_confidence: 'high',
        roof_confirmed: 'yes',
        c_evcharger1: 'yes',
        c_tethered1: 'yes',
      },
    });
    expect(response.statusCode).toBe(200);
    const effects = response.json<Preview>().effects;
    expect(effects.map((e) => [e.questionId, e.value])).toEqual([
      ['c_evcharger1', 'yes'],
      ['c_tethered1', 'yes'],
    ]);

    const list = (await getPublishedPriceList(store, tenantId))!;
    const from = list.items.find((i) => i.key === EV)!;
    const to = list.items.find((i) => i.key === TETHERED)!;
    const price = priceFor(to, {});
    expect(price.status).toBe('priced');
    const swap = effects[1]!;
    expect(swap.label).toBe(`Replaces ${from.name}: ${to.name}`);
    // The new item's own price from the published list, never a difference.
    expect(swap.priceText).toBe(
      `£${((price as { amountMinor: number }).amountMinor / 100).toLocaleString('en-GB')}`,
    );
  });

  it('asks the next question in the installer’s wording', async () => {
    const { app, tenantId } = await setup();
    const response = await preview(app, tenantId, VIEWER, {
      flow: flowOf([evStep]),
      answers: { address: '1 High St', roof_confidence: 'high', roof_confirmed: 'yes' },
    });
    const body = response.json<Preview>();
    expect(body.next).toEqual({
      id: 'c_evcharger1',
      prompt: evStep.kind === 'custom' ? evStep.prompt : '',
      options: [
        { value: 'yes', label: 'Yes please' },
        { value: 'no', label: 'Not for now' },
      ],
    });
  });

  it('says the item is priced by the installer when no list is published', async () => {
    const { app, tenantId } = await setup();
    const response = await preview(app, tenantId, VIEWER, {
      flow: flowOf([evStep]),
      answers: {
        address: '1 High St',
        roof_confidence: 'high',
        roof_confirmed: 'yes',
        c_evcharger1: 'yes',
      },
    });
    const body = response.json<Preview>();
    expect(body.effects).toHaveLength(1);
    expect(body.effects[0]!.priceText).toBe('Priced by your installer');
    expect(body.effects[0]!.priceText).not.toMatch(/\d/);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('refuses a body that is not a flow', async () => {
    const { app, tenantId } = await setup();
    const response = await preview(app, tenantId, VIEWER, { flow: { steps: 1 }, answers: {} });
    expect(response.statusCode).toBe(400);
  });
});

describe('two instances saving the same installer', () => {
  /** A second API instance on the same store, its tenant cache loaded now. */
  async function secondInstance(store: FileStore) {
    const tenants = await TenantRegistry.load(store, defaultTenants(false));
    const app = buildServer({
      config: makeConfig(),
      store,
      tenants,
      now: () => NOW,
      portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
    });
    await app.ready();
    return app;
  }

  const settings = (app: FastifyInstance, tenantId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/settings`,
      headers: as(OWNER),
      payload,
    });

  it('a settings save on an instance with a stale cache keeps the flow saved on another', async () => {
    const { app, store, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const other = await secondInstance(store);
    // The other instance cached the tenant before the flow was saved here.
    expect((await put(app, tenantId, OWNER, flowOf([evStep]))).statusCode).toBe(200);

    const saved = await settings(other, tenantId, { tagline: 'Solar for Norwich' });
    expect(saved.statusCode).toBe(200);

    const stored = await store.getTenant(tenantId);
    expect(stored?.config.tagline).toBe('Solar for Norwich');
    expect(stored?.config.conversation?.steps.map((s) => s.id)).toEqual(['c_evcharger1']);
    await other.close();
  });

  it('a flow save on an instance with a stale cache keeps settings saved on another', async () => {
    const { app, store, tenantId } = await setup();
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const other = await secondInstance(store);
    expect((await settings(app, tenantId, { tagline: 'Solar for Norwich' })).statusCode).toBe(200);
    expect((await put(app, tenantId, OWNER, flowOf([evStep]))).statusCode).toBe(200);

    // The other instance last saw version 0 and the old tagline.
    const again = await put(other, tenantId, OWNER, flowOf([evStep]));
    expect(again.statusCode).toBe(200);
    expect(again.json<View>().flow?.version).toBe(2);
    const stored = await store.getTenant(tenantId);
    expect(stored?.config.tagline).toBe('Solar for Norwich');

    // A reset on the stale instance keeps the tagline too.
    await settings(app, tenantId, { tagline: 'Solar for Norfolk' });
    const reset = await other.inject({ method: 'DELETE', url: url(tenantId), headers: as(OWNER) });
    expect(reset.statusCode).toBe(200);
    const after = await store.getTenant(tenantId);
    expect(after?.config.tagline).toBe('Solar for Norfolk');
    expect(after?.config.conversation).toBeUndefined();
    await other.close();
  });
});

/** A model that only suggests price changes, from a fixed answer, counting its calls. */
class Suggesting implements ChatProvider {
  readonly kind = 'scripted';
  readonly model = 'scripted-1';
  calls = 0;
  constructor(private readonly answer: () => Promise<unknown>) {}
  priceSuggestions(): Promise<unknown> {
    this.calls += 1;
    return this.answer();
  }
  // eslint-disable-next-line require-yield, @typescript-eslint/require-await
  async *stream(): AsyncIterable<ChatChunk> {
    throw new Error('not a chat');
  }
}

describe('POST /conversation/suggest', () => {
  const question = {
    prompt: 'Do you have an electric car?',
    choices: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
  };
  const suggest = (app: FastifyInstance, tenantId: string, email: string, payload: object) =>
    app.inject({ method: 'POST', url: url(tenantId, '/suggest'), headers: as(email), payload });

  it('returns the checked suggestion: off-list, mandatory and system items dropped', async () => {
    const model = new Suggesting(() =>
      Promise.resolve({
        choices: [
          {
            value: 'yes',
            effects: [
              { kind: 'add', itemKey: EV },
              { kind: 'add', itemKey: 'NOT-ON-THE-LIST' },
              { kind: 'remove', itemKey: FEE },
            ],
          },
          { value: 'no', effects: [] },
        ],
        explanation: 'An electric car needs a charger.',
      }),
    );
    const { app, store, tenantId } = await setup(model);
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const response = await suggest(app, tenantId, OWNER, question);
    expect(response.statusCode).toBe(200);
    // Only the checked effects: anything else the model says is not passed on.
    expect(response.json()).toEqual({ effects: { yes: [{ kind: 'add', itemKey: EV }], no: [] } });
    expect(model.calls).toBe(1);
  });

  it('is for admins: a viewer is refused', async () => {
    const model = new Suggesting(() => Promise.resolve({ choices: [] }));
    const { app, store, tenantId } = await setup(model);
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    expect((await suggest(app, tenantId, VIEWER, question)).statusCode).toBe(403);
    expect(model.calls).toBe(0);
  });

  it('suggests nothing, without asking the model, when no list is published', async () => {
    const model = new Suggesting(() => Promise.resolve({ choices: [] }));
    const { app, tenantId } = await setup(model);
    const response = await suggest(app, tenantId, OWNER, question);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ effects: {} });
    expect(model.calls).toBe(0);
  });

  it('suggests nothing when the model fails, or when none is configured', async () => {
    const failing = new Suggesting(() => Promise.reject(new Error('quota')));
    const { app, store, tenantId } = await setup(failing);
    await publishExample(store, tenantId, '2026-11-09T09:00:00Z');
    const response = await suggest(app, tenantId, OWNER, question);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ effects: {} });
    expect(failing.calls).toBe(1);

    const unconfigured = await setup();
    await publishExample(unconfigured.store, unconfigured.tenantId, '2026-11-09T09:00:00Z');
    const none = await suggest(unconfigured.app, unconfigured.tenantId, OWNER, question);
    expect(none.json()).toEqual({ effects: {} });
  });

  it('refuses a question without answers', async () => {
    const { app, tenantId } = await setup();
    const response = await suggest(app, tenantId, OWNER, { prompt: 'Hello?', choices: [] });
    expect(response.statusCode).toBe(400);
  });
});
