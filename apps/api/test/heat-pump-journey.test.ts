import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { QuoteCard, Workflow, WorkflowSet } from '@sunny/contracts';
import { EMPTY_KNOWLEDGE } from '@sunny/knowledge';
import type { AssessmentRecord, SunScanService } from '@sunny/sunscan-adapter';

import { runTurn, type TurnEvent } from '../src/agent/agent.js';
import { executeTool, type ToolContext, type ToolEvent } from '../src/agent/tools.js';
import { importPriceList } from '../src/catalogue/price-list.js';
import { emptyCatalogueState } from '../src/catalogue/types.js';
import { bankFor, HEAT_PUMP } from '../src/flow/banks.js';
import type { HeatPumpQuoteRecord } from '../src/journey/heat-pump/record.js';
import { extractAnswers } from '../src/journey/extract.js';
import { heatPumpInputFrom, radiatorCountFor } from '../src/journey/heat-pump/service.js';
import { demoPricing } from '../src/journey/pricing.js';
import { journeyView, sunscanRoofLookup } from '../src/journey/service.js';
import { HEAT_PUMP_QUESTIONS, OPTION_LABELS } from '../src/questionnaire.js';
import { registerQuoteRoutes } from '../src/routes/quote.js';
import { issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, TenantRegistry, type Tenant } from '../src/tenants.js';
import { EMPTY_SESSION, cloneSession } from '../src/workflows/session.js';
import { defaultWorkflowSet, heatPumpTemplate, templateFor } from '../src/workflows/templates.js';
import { resolvedFlowFor, workflowsForTenant } from '../src/workflows/tenant.js';

import { ScriptedProvider } from './scripted-provider.js';

const NOW = '2026-11-10T10:00:00.000Z';
const SESSION = 'sess_hp_journey';

const ENGLAND = '10 Downing Street, London SW1A 2AA';
const SCOTLAND = '1 Princes Street, Edinburgh EH2 2EQ';

/** Every answer the heat pump workflow asks for, floor area given. */
const HP_ANSWERS: Record<string, string> = {
  motivation: 'reduce_bills',
  property_type: 'semi',
  ownership: 'own',
  address: ENGLAND,
  hp_age: '1945_1964',
  hp_floor_area: '95',
  hp_walls: 'cavity_filled',
  hp_loft: 'some',
  hp_glazing: 'double',
  hp_current_heating: 'gas',
  hp_emitters: 'radiators_standard',
  hp_hot_water: 'combi',
  hp_occupants: '3',
  hp_annual_spend: 'skipped',
  hp_epc: 'no',
  hp_outdoor_space: 'yes',
};

function heatPumpOn(): Workflow {
  return { ...heatPumpTemplate(NOW), enabled: true };
}

function setWithHeatPump(): WorkflowSet {
  const set = defaultWorkflowSet(NOW);
  set.workflows.push(heatPumpOn());
  return set;
}

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempStore(): Promise<FileStore> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-hp-journey-'));
  dirs.push(dir);
  return new FileStore(dir);
}

function context(
  store: FileStore,
  workflows: WorkflowSet = setWithHeatPump(),
): ToolContext & { events: ToolEvent[] } {
  return {
    tenant: DEMO_TENANT,
    sessionId: SESSION,
    conversationId: null,
    store,
    answers: {},
    events: [],
    sunscanConnected: false,
    knowledge: EMPTY_KNOWLEDGE,
    flow: resolvedFlowFor(workflows.workflows[0]!),
    quote: { pricing: { forTenant: () => Promise.resolve(demoPricing()) } },
    workflows,
    session: cloneSession(EMPTY_SESSION),
    pagePath: '/',
  };
}

async function tool(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const result = await executeTool({ name, args }, ctx);
  return { ok: result.ok, summary: result.summary, data: result.data as Record<string, unknown> };
}

const HEADER = 'Category,Key,Name,Pricing,Amount,Unit,Power (kW),Role,Currency';

async function publish(store: FileStore, rows: string[]): Promise<void> {
  const { list, issues } = importPriceList([HEADER, ...rows].join('\n'), { sourceVersion: 'v1' });
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  await store.putCatalogueState({
    ...emptyCatalogueState(DEMO_TENANT.id, NOW),
    priceList: { published: list!, version: 1, pending: null, history: [] },
  });
}

const HP_LIST = [
  'heat_pump,HP-5,Acme 5 kW,flat,"£5,000",,5,,GBP',
  'heat_pump,HP-7,Acme 7 kW,flat,"£6,000",,7,,GBP',
  'heat_pump,HP-10,Acme 10 kW,flat,"£7,000",,10,,GBP',
  'heat_pump,HP-12,Acme 12 kW,flat,"£8,000",,12,,GBP',
  'heat_pump,HP-16,Acme 16 kW,flat,"£9,500",,16,,GBP',
  'heat_pump_install,INS-BASE,Base install,flat,"£2,000",,,base_install,GBP',
  'heat_pump_install,INS-CYL,Cylinder,flat,"£1,000",,,cylinder,GBP',
  'heat_pump_install,INS-RAD,Radiator,per_unit,£300,unit,,radiator,GBP',
  'heat_pump_install,INS-FLUSH,Powerflush,flat,£400,,,powerflush,GBP',
];

/** Start the heat pump workflow with every answer stored, and ask for the quote. */
async function quoteWith(store: FileStore, answers: Record<string, string>) {
  const ctx = context(store);
  await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
  await store.mergeAnswers(DEMO_TENANT.id, SESSION, answers);
  const result = await tool('get_quote_options', {}, ctx);
  const event = ctx.events.find((e) => e.kind === 'quote');
  const card = event?.detail['quote'] as QuoteCard | undefined;
  const quotes = await store.listQuotes(DEMO_TENANT.id, SESSION);
  return { ctx, result, card, quote: quotes[0] as HeatPumpQuoteRecord | undefined };
}

describe('the heat pump template', () => {
  it('is the built-in heat pump workflow, switched off', () => {
    const t = heatPumpTemplate(NOW);
    expect(t.id).toBe('wf_heat_pump');
    expect(t.name).toBe('Heat pump quote');
    expect(t.enabled).toBe(false);
    expect(t.outcome).toEqual({ kind: 'quote', engine: 'heat_pump' });
    expect(t.template).toEqual({ id: 'heat_pump_quote', version: 1 });
    expect(t.interests).toEqual(['heating']);
    expect(t.pages).toEqual({ include: [], exclude: [] });
    expect(templateFor('heat_pump_quote', NOW)?.id).toBe('wf_heat_pump');
  });

  it('is in a fresh tenant’s set, disabled', () => {
    const { set } = workflowsForTenant(null);
    const hp = set.workflows.find((w) => w.id === 'wf_heat_pump');
    expect(hp?.enabled).toBe(false);
    expect(set.workflows[0]!.id).toBe('wf_solar');
  });

  it('is appended to a stored set that lacked it, leaving the rest untouched', () => {
    const stored = defaultWorkflowSet(NOW);
    stored.version = 7;
    const tenant: Tenant = { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, workflows: stored } };
    const { set, migrated } = workflowsForTenant(tenant);
    expect(migrated).toBe(false);
    expect(set.version).toBe(7);
    expect(set.workflows.map((w) => w.id)).toEqual(['wf_solar', 'wf_heat_pump']);
    expect(set.workflows[0]).toEqual(stored.workflows[0]);
    expect(set.workflows[1]!.enabled).toBe(false);
    expect(set.workflows[1]!.template).toEqual({ id: 'heat_pump_quote', version: 1 });
  });

  it('keeps a stored heat pump workflow as the installer left it', () => {
    const stored = setWithHeatPump();
    stored.workflows[1]!.name = 'Heat pumps';
    const tenant: Tenant = { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, workflows: stored } };
    const { set } = workflowsForTenant(tenant);
    expect(set.workflows.filter((w) => w.kind === 'heat_pump_quote')).toHaveLength(1);
    expect(set.workflows[1]!.name).toBe('Heat pumps');
    expect(set.workflows[1]!.enabled).toBe(true);
  });

  it('has its own question bank', () => {
    expect(bankFor('heat_pump')).toBe(HEAT_PUMP);
    const flow = resolvedFlowFor(heatPumpOn());
    expect(flow.bank).toBe(HEAT_PUMP);
    expect(flow.question('motivation')!.prompt).toBe(
      'First, what would you most like from a new heating system?',
    );
  });
});

describe('the heat pump questions', () => {
  it('are asked in order, motivation first', async () => {
    const store = await tempStore();
    const ctx = context(store);
    const first = await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
    expect(first.ok).toBe(true);
    expect(first.data['nextQuestionId']).toBe('motivation');

    const order = [
      'motivation',
      'property_type',
      'ownership',
      'address',
      'hp_age',
      'hp_floor_area',
      'hp_walls',
      'hp_loft',
      'hp_glazing',
      'hp_current_heating',
      'hp_emitters',
      'hp_hot_water',
      'hp_occupants',
      'hp_annual_spend',
      'hp_epc',
      'hp_outdoor_space',
    ];
    let next = first.data['nextQuestionId'];
    for (const id of order) {
      expect(next).toBe(id);
      const saved = await tool(
        'save_workflow_answers',
        { answers: [{ questionId: id, value: HP_ANSWERS[id] }] },
        ctx,
      );
      expect(saved.ok).toBe(true);
      next = saved.data['nextQuestionId'];
    }
    expect(next).toBeNull();
    const done = await tool('get_workflow_step', {}, ctx);
    expect(done.data['readyForQuote']).toBe(true);
    expect(done.data['readyForLead']).toBe(false);
    expect(done.data['stage']).toBe('quote_ready');
  });

  it('asks for bedrooms only when the floor area is skipped', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
    const before = ['motivation', 'property_type', 'ownership', 'address', 'hp_age'];
    await store.mergeAnswers(
      DEMO_TENANT.id,
      SESSION,
      Object.fromEntries(before.map((id) => [id, HP_ANSWERS[id]!])),
    );
    const asked = await tool('get_workflow_step', {}, ctx);
    expect(asked.data['nextQuestionId']).toBe('hp_floor_area');
    expect(asked.data['optional']).toBe(true);

    const skipped = await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'hp_floor_area', value: 'skipped' }] },
      ctx,
    );
    expect(skipped.data['nextQuestionId']).toBe('hp_bedrooms');
    const bedrooms = await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'hp_bedrooms', value: '3' }] },
      ctx,
    );
    expect(bedrooms.ok).toBe(true);
    expect(bedrooms.data['nextQuestionId']).toBe('hp_walls');
  });

  it('does not start a roof assessment for a heat pump address', async () => {
    const store = await tempStore();
    const ctx = context(store);
    const record = {
      id: 'as_stub1',
      tenantId: DEMO_TENANT.id,
      sessionId: SESSION,
      status: 'running',
      target: { address: ENGLAND },
      summary: null,
      error: null,
    } as unknown as AssessmentRecord;
    const started = vi.fn(() => Promise.resolve(record));
    ctx.sunscan = {
      engineVersion: 'stub',
      startAssessment: started,
      getAssessment: vi.fn(() => Promise.resolve(record)),
      waitFor: vi.fn(() => Promise.resolve(record)),
    } as unknown as SunScanService;
    ctx.sunscanConnected = true;
    ctx.visitorMessage = `a heat pump quote for ${ENGLAND}`;
    await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
    let conversation = await store.getConversation(DEMO_TENANT.id, SESSION);
    expect(conversation?.answers?.['address']).toContain('Downing Street');
    // A corrected address is not measured either.
    await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'address', value: SCOTLAND }] },
      ctx,
    );
    conversation = await store.getConversation(DEMO_TENANT.id, SESSION);
    expect(conversation?.answers?.['address']).toContain('Princes Street');
    expect(started).not.toHaveBeenCalled();
  });

  it('read an unsure build date as 1965 to 1982, with an assumption', async () => {
    const input = heatPumpInputFrom({ ...HP_ANSWERS, hp_age: 'unsure' });
    expect(input?.ageBand).toBe('1965_1982');
    const { quote } = await quoteWith(await tempStore(), { ...HP_ANSWERS, hp_age: 'unsure' });
    expect(quote!.estimate.assumptions.join(' ')).toMatch(/1965 and 1982/);
  });

  it('gives no input without a postcode', () => {
    expect(heatPumpInputFrom({ ...HP_ANSWERS, address: 'The Old Barn, Somewhere' })).toBeNull();
    expect(heatPumpInputFrom({ ...HP_ANSWERS, hp_floor_area: 'skipped' })?.floorAreaM2).toBeNull();
  });
});

describe('the heat pump quote', () => {
  it('is built when ready, shown as a heat pump card, and completes the workflow', async () => {
    const store = await tempStore();
    await publish(store, HP_LIST);
    const { ctx, result, card, quote } = await quoteWith(store, HP_ANSWERS);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/indicative/);
    expect(result.summary).toMatch(/survey/);
    expect(result.summary).toMatch(/grant/);
    expect(card?.kind).toBe('heat_pump');
    expect(quote?.kind).toBe('heat_pump');
    expect(quote?.workflowId).toBe('wf_heat_pump');
    expect(quote?.postcode).toBe('SW1A 2AA');
    expect(ctx.session.active).toBeNull();
    expect(ctx.session.completed).toEqual([
      expect.objectContaining({ workflowId: 'wf_heat_pump', quoteId: quote!.id }),
    ]);
    const stored = await store.getWorkflowState(DEMO_TENANT.id, SESSION);
    expect(stored.completed[0]?.quoteId).toBe(quote!.id);

    // A combi in a 1950s home with standard radiators: all three options, the
    // radiator upgrade recommended.
    const labels = quote!.options.map((o) => o.label);
    expect(labels).toEqual([
      'Heat pump only',
      'With a new hot water cylinder',
      'With radiator upgrades',
    ]);
    expect(quote!.recommendedId).toBe(quote!.options[2]!.id);
    expect(quote!.options.filter((o) => o.isRecommended)).toHaveLength(1);
    const [only, cylinder, radiators] = quote!.options;
    expect(only!.outputKw).toBeGreaterThanOrEqual(quote!.estimate.recommendedKw);
    expect(only!.grantGbp).toBe(7500);
    expect(only!.priceGbp).toBe(only!.lineItems.reduce((sum, l) => sum + l.totalGbp, 0));
    expect(only!.priceAfterGrantGbp).toBe(Math.max(0, only!.priceGbp! - 7500));
    expect(cylinder!.priceGbp).toBe(only!.priceGbp! + 1000);
    // 95 square metres and no bedrooms: about one radiator per 12 square metres.
    expect(radiators!.lineItems.find((l) => l.sku === 'INS-RAD')?.quantity).toBe(8);
    // Heat pump VAT is the engine's zero rate: the label names no VAT at all.
    for (const o of quote!.options) expect(o.priceLabel).toBe('Indicative price');
    expect(card!.kind === 'heat_pump' && card!.options[0]!.grantStatus).toBe('eligible');
    expect(radiators!.priceGbp).toBeGreaterThan(cylinder!.priceGbp!);
    expect(quote!.disclaimer).toMatch(/indicative estimate/);
  });

  it('offers only the unit for a modern home with a cylinder and no cylinder price', async () => {
    const store = await tempStore();
    await publish(
      store,
      HP_LIST.filter((r) => !r.includes('INS-CYL')),
    );
    const { quote } = await quoteWith(store, {
      ...HP_ANSWERS,
      hp_age: '2007_on',
      hp_hot_water: 'cylinder',
      hp_emitters: 'underfloor',
    });
    expect(quote!.options.map((o) => o.label)).toEqual(['Heat pump only']);
    expect(quote!.options[0]!.isRecommended).toBe(true);
  });

  it('gives no grant in Scotland', async () => {
    const store = await tempStore();
    await publish(store, HP_LIST);
    const { quote, card } = await quoteWith(store, { ...HP_ANSWERS, address: SCOTLAND });
    expect(quote!.options.every((o) => o.grantGbp === 0)).toBe(true);
    expect(quote!.options[0]!.priceAfterGrantGbp).toBe(quote!.options[0]!.priceGbp);
    expect(card!.kind === 'heat_pump' && card!.options[0]!.grantGbp).toBe(0);
  });

  it('is unpriced, without throwing, when the list has no heat pump items', async () => {
    const store = await tempStore();
    await publish(store, ['pv,PV,PV,flat,£100,,,,GBP']);
    const { result, quote } = await quoteWith(store, HP_ANSWERS);
    expect(result.ok).toBe(true);
    expect(quote!.priced).toBe(false);
    for (const option of quote!.options) {
      expect(option.installerPriced).toBe(true);
      expect(option.priceGbp).toBeNull();
      expect(option.priceAfterGrantGbp).toBeNull();
      expect(option.priceLabel).toBe('Priced by your installer');
    }
  });

  it('warns when there may be no room for the outdoor unit', async () => {
    const { quote } = await quoteWith(await tempStore(), {
      ...HP_ANSWERS,
      hp_outdoor_space: 'no',
    });
    expect(quote!.warnings).toContain(
      'The installer will need to check where the outdoor unit can go.',
    );
  });

  it('is refused until every answer is in', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
    const result = await tool('get_quote_options', {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.data['readyForQuote']).toBe(false);
    expect(await store.listQuotes(DEMO_TENANT.id, SESSION)).toEqual([]);
  });

  it('is emitted in a chat turn', async () => {
    const store = await tempStore();
    await store.saveWorkflowState(DEMO_TENANT.id, SESSION, {
      ...cloneSession(EMPTY_SESSION),
      active: { workflowId: 'wf_heat_pump', startedAt: NOW },
    });
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, HP_ANSWERS);
    const tenant: Tenant = {
      ...DEMO_TENANT,
      config: { ...DEMO_TENANT.config, workflows: setWithHeatPump() },
    };
    const events: TurnEvent[] = [];
    for await (const event of runTurn({
      tenant,
      provider: new ScriptedProvider(() => [
        { type: 'tool_started', call: { name: 'get_quote_options', args: {} } },
      ]),
      store,
      sessionId: SESSION,
      conversationId: null,
      history: [],
      message: 'show me the heat pump options',
      clientMessageId: 'c_1',
      sunscanConnected: false,
      quote: { pricing: { forTenant: () => Promise.resolve(demoPricing()) } },
    })) {
      events.push(event);
    }
    const quote = events.find(
      (e): e is Extract<TurnEvent, { type: 'quote' }> => e.type === 'quote',
    );
    expect(quote?.quote.kind).toBe('heat_pump');
  });
});

describe('quoted, by kind', () => {
  it('a heat pump quote does not mark the solar journey quoted', async () => {
    const store = await tempStore();
    await quoteWith(store, HP_ANSWERS);
    const deps = {
      store,
      pricing: { forTenant: () => Promise.resolve(demoPricing()) },
      roof: sunscanRoofLookup(null),
      now: () => Date.now(),
    };
    const view = await journeyView(deps, DEMO_TENANT.id, SESSION);
    expect(view.stage).not.toBe('quoted');
  });

  it('a heat pump workflow is quoted after its quote, a solar workflow is not', async () => {
    const store = await tempStore();
    const { ctx } = await quoteWith(store, HP_ANSWERS);
    await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
    const hp = await tool('get_workflow_step', {}, ctx);
    expect(hp.data['stage']).toBe('quoted');
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    const solar = await tool('get_workflow_step', {}, ctx);
    expect(solar.data['stage']).not.toBe('quoted');
  });
});

/** POST /v1/quote/options for a session running the heat pump workflow, on or off. */
async function postOptions(enabled: boolean) {
  const store = await tempStore();
  const set = setWithHeatPump();
  set.workflows[1]!.enabled = enabled;
  const tenant: Tenant = { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, workflows: set } };
  const app = Fastify();
  const secret = 'test-secret-heat-pump-route';
  registerQuoteRoutes(app, {
    store,
    tenants: new TenantRegistry([tenant]),
    sessionSecret: secret,
    now: () => Date.parse(NOW),
    pricing: { forTenant: () => Promise.resolve(demoPricing()) },
    roof: () => Promise.resolve({ state: 'none' }),
  });
  await app.ready();
  try {
    await store.saveWorkflowState(tenant.id, SESSION, {
      ...cloneSession(EMPTY_SESSION),
      active: { workflowId: 'wf_heat_pump', startedAt: NOW },
    });
    await store.mergeAnswers(tenant.id, SESSION, HP_ANSWERS);
    const token = issueSessionToken(
      { tenantId: tenant.id, sessionId: SESSION, expiresAt: Date.parse(NOW) + 3_600_000 },
      secret,
    );
    return await app.inject({
      method: 'POST',
      url: '/v1/quote/options',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: SESSION },
    });
  } finally {
    await app.close();
  }
}

describe('POST /v1/quote/options', () => {
  it('builds a heat pump quote for a session running the heat pump workflow', async () => {
    const res = await postOptions(true);
    expect(res.statusCode).toBe(201);
    const body = res.json<{ kind?: string; tenantId?: string; proposalAvailable: boolean }>();
    expect(body.kind).toBe('heat_pump');
    expect(body.tenantId).toBeUndefined();
    expect(body.proposalAvailable).toBe(false);
  });

  it('does not build one for a heat pump workflow that is switched off', async () => {
    // The solar quote runs instead, and the solar answers are not there.
    const res = await postOptions(false);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ kind?: string }>().kind).toBeUndefined();
  });
});

describe('installer pricing, warnings and the grant', () => {
  it('prices nothing that needs a cylinder, for a combi home whose cylinder has no price', async () => {
    const store = await tempStore();
    await publish(
      store,
      HP_LIST.filter((r) => !r.includes('INS-CYL')),
    );
    const { quote } = await quoteWith(store, HP_ANSWERS);
    const [only, cylinder, radiators] = quote!.options;
    expect(only!.installerPriced).toBe(false);
    expect(only!.priceGbp).not.toBeNull();
    for (const o of [cylinder!, radiators!]) {
      expect(o.installerPriced).toBe(true);
      expect(o.priceGbp).toBeNull();
      expect(o.priceAfterGrantGbp).toBeNull();
      expect(o.priceLabel).toBe('Priced by your installer');
      // The priced lines stay, for the installer to see.
      expect(o.lineItems.length).toBeGreaterThan(0);
    }
    expect(cylinder!.warnings).toContain('Your installer will price the new cylinder.');
  });

  it('prices no option without a priced base install', async () => {
    const store = await tempStore();
    await publish(
      store,
      HP_LIST.filter((r) => !r.includes('INS-BASE')),
    );
    const { quote } = await quoteWith(store, HP_ANSWERS);
    expect(quote!.options).toHaveLength(3);
    for (const o of quote!.options) {
      expect(o.installerPriced).toBe(true);
      expect(o.priceGbp).toBeNull();
      expect(o.priceLabel).toBe('Priced by your installer');
    }
    expect(quote!.priced).toBe(false);
  });

  it('passes each option warnings to the tool and the card', async () => {
    const store = await tempStore();
    await publish(
      store,
      HP_LIST.filter((r) => !r.includes('INS-CYL')),
    );
    const { result, card } = await quoteWith(store, { ...HP_ANSWERS, hp_outdoor_space: 'no' });
    const options = result.data['options'] as Array<{ warnings: string[] }>;
    expect(options[1]!.warnings).toContain('Your installer will price the new cylinder.');
    expect(options[0]!.warnings).toContain(
      'The installer will need to check where the outdoor unit can go.',
    );
    expect(card!.kind).toBe('heat_pump');
    if (card!.kind !== 'heat_pump') return;
    expect(card!.options[1]!.warnings).toContain('Your installer will price the new cylinder.');
    for (const o of card!.options) expect((o.warnings ?? []).length).toBeLessThanOrEqual(5);
  });

  it('marks the grant unsure on a border postcode, with no deduction', async () => {
    const store = await tempStore();
    await publish(store, HP_LIST);
    const { quote, card } = await quoteWith(store, {
      ...HP_ANSWERS,
      address: '5 Roxburgh Street, Kelso TD5 7DU',
    });
    expect(quote!.estimate.bus.eligible).toBe('unsure');
    for (const o of quote!.options) {
      expect(o.grantGbp).toBe(0);
      expect(o.priceAfterGrantGbp).toBe(o.priceGbp);
    }
    expect(card!.kind === 'heat_pump' && card!.options.map((o) => o.grantStatus)).toEqual([
      'unsure',
      'unsure',
      'unsure',
    ]);
  });

  it('reads a number from the visitor words for a numeric question', async () => {
    const flow = resolvedFlowFor(heatPumpOn());
    expect(extractAnswers('about 90 square metres', 'hp_floor_area', flow)).toContainEqual({
      questionId: 'hp_floor_area',
      value: '90',
    });
    expect(extractAnswers('£1,200 a year', 'hp_annual_spend', flow)).toContainEqual({
      questionId: 'hp_annual_spend',
      value: '1200',
    });
    expect(extractAnswers('3', 'hp_occupants', flow)).toContainEqual({
      questionId: 'hp_occupants',
      value: '3',
    });

    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_heat_pump' }, ctx);
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, {
      motivation: 'reduce_bills',
      property_type: 'semi',
      ownership: 'own',
      address: ENGLAND,
      hp_age: '1945_1964',
    });
    const saved = await tool(
      'save_workflow_answers',
      { visitorMessage: 'about 90 square metres' },
      ctx,
    );
    expect(saved.data['saved']).toEqual([{ questionId: 'hp_floor_area', value: '90' }]);
    expect(saved.data['nextQuestionId']).toBe('hp_walls');
  });

  it('counts radiators from the bedrooms, else the floor area', () => {
    expect(radiatorCountFor(2, 200)).toBe(3);
    expect(radiatorCountFor(5, 40)).toBe(6);
    expect(radiatorCountFor(null, 95)).toBe(8);
    expect(radiatorCountFor(null, 30)).toBe(3);
    expect(radiatorCountFor(null, 400)).toBe(15);
  });
});

describe('no dashes', () => {
  it('in the template or the heat pump questions and labels', () => {
    const dash = /[\u2013\u2014]/;
    expect(JSON.stringify(heatPumpTemplate(NOW))).not.toMatch(dash);
    expect(JSON.stringify(HEAT_PUMP_QUESTIONS)).not.toMatch(dash);
    const values = Object.values(HEAT_PUMP_QUESTIONS).flatMap((q) => q.options ?? []);
    for (const v of values) {
      expect(OPTION_LABELS[v], v).toBeDefined();
      expect(OPTION_LABELS[v]).not.toMatch(dash);
    }
  });
});
