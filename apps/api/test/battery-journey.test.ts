import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { QuoteCard, Workflow, WorkflowSet } from '@sunny/contracts';
import { EMPTY_KNOWLEDGE } from '@sunny/knowledge';
import type { AssessmentRecord, SunScanService } from '@sunny/sunscan-adapter';

import { executeTool, type ToolContext, type ToolEvent } from '../src/agent/tools.js';
import { importPriceList } from '../src/catalogue/price-list.js';
import { emptyCatalogueState } from '../src/catalogue/types.js';
import { BATTERY, bankFor } from '../src/flow/banks.js';
import { checkWorkflow } from '../src/flow/check.js';
import type { BatteryQuoteRecord } from '../src/journey/battery/record.js';
import { batteryInputFrom } from '../src/journey/battery/service.js';
import { extractAnswers } from '../src/journey/extract.js';
import { demoPricing } from '../src/journey/pricing.js';
import { BATTERY_QUESTIONS, OPTION_LABELS } from '../src/questionnaire.js';
import { registerQuoteRoutes } from '../src/routes/quote.js';
import { issueSessionToken } from '../src/sessions.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, TenantRegistry, type Tenant } from '../src/tenants.js';
import { EMPTY_SESSION, cloneSession } from '../src/workflows/session.js';
import {
  batteryTemplate,
  blankWorkflow,
  defaultWorkflowSet,
  heatPumpTemplate,
  templateFor,
} from '../src/workflows/templates.js';
import { resolvedFlowFor, workflowsForTenant } from '../src/workflows/tenant.js';

const NOW = '2026-11-10T10:00:00.000Z';
const SESSION = 'sess_battery_journey';
const ENGLAND = '10 Downing Street, London SW1A 2AA';

const NOT_SUITABLE =
  'A battery quote is for homes that already have solar panels. I can work out a solar and battery quote instead.';

/** Every answer the battery workflow asks for, the system size given. */
const BAT_ANSWERS: Record<string, string> = {
  motivation: 'reduce_bills',
  existing_system: 'solar',
  address: ENGLAND,
  bat_pv_kwp: '4',
  usage_source: 'manual_kwh',
  annual_kwh: '3500',
  tariff_type: 'smart_tou',
  lifestyle: 'evening_use',
  bat_inverter: 'hybrid',
  bat_goal: 'savings',
};

function batteryOn(): Workflow {
  return { ...batteryTemplate(NOW), enabled: true };
}

function setWithBattery(): WorkflowSet {
  const set = defaultWorkflowSet(NOW);
  set.workflows.push(heatPumpTemplate(NOW), batteryOn());
  return set;
}

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempStore(): Promise<FileStore> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-battery-journey-'));
  dirs.push(dir);
  return new FileStore(dir);
}

function context(
  store: FileStore,
  workflows: WorkflowSet = setWithBattery(),
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

const HEADER =
  'Category,Key,Name,Pricing,Amount,Price with solar,Price retrofit,Capacity (kWh),Role,' +
  'Expansion SKU,Expansion price,Expansion capacity (kWh),Max units,Currency';

async function publish(store: FileStore, rows: string[]): Promise<void> {
  const { list, issues } = importPriceList([HEADER, ...rows].join('\n'), { sourceVersion: 'v1' });
  expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  await store.putCatalogueState({
    ...emptyCatalogueState(DEMO_TENANT.id, NOW),
    priceList: { published: list!, version: 1, pending: null, history: [] },
  });
}

const BATTERY_ROWS = [
  'battery,B-5,Acme 5 kWh,with_solar,,"£2,500","£3,000",5,,,,,,GBP',
  'battery,B-9,Acme 9.5 kWh,with_solar,,"£4,000","£4,500",9.5,,,,,,GBP',
  'battery,B-13,Acme 13.5 kWh,with_solar,,"£6,000","£6,500",13.5,,,,,,GBP',
  'battery,B-18,Acme 18 kWh,with_solar,,"£8,000","£8,500",18,,,,,,GBP',
];
const AC_ROW = 'inverter,AC-1,AC coupled inverter,flat,£700,,,,ac_coupling,,,,,GBP';

/** Start the battery workflow with every answer stored, and ask for the quote. */
async function quoteWith(store: FileStore, answers: Record<string, string>) {
  const ctx = context(store);
  await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
  await store.mergeAnswers(DEMO_TENANT.id, SESSION, answers);
  const result = await tool('get_quote_options', {}, ctx);
  const event = ctx.events.find((e) => e.kind === 'quote');
  const card = event?.detail['quote'] as QuoteCard | undefined;
  const quotes = await store.listQuotes(DEMO_TENANT.id, SESSION);
  return { ctx, result, card, quote: quotes[0] as BatteryQuoteRecord | undefined };
}

describe('the battery template', () => {
  it('is the built-in battery workflow, switched off', () => {
    const t = batteryTemplate(NOW);
    expect(t.id).toBe('wf_battery');
    expect(t.name).toBe('Battery quote');
    expect(t.enabled).toBe(false);
    expect(t.description).toBe(
      'Works out battery options for a home that already has solar panels.',
    );
    expect(t.triggers).toEqual([
      'battery quote',
      'add a battery',
      'home battery',
      'battery for my solar',
    ]);
    expect(t.interests).toEqual(['battery']);
    expect(t.pages).toEqual({ include: [], exclude: [] });
    expect(t.outcome).toEqual({ kind: 'quote', engine: 'battery' });
    expect(t.template).toEqual({ id: 'battery_quote', version: 1 });
    expect(templateFor('battery_quote', NOW)?.id).toBe('wf_battery');
  });

  it('is in a fresh tenant’s set, disabled, after the heat pump', () => {
    const { set } = workflowsForTenant(null);
    expect(set.workflows.map((w) => w.id)).toEqual(['wf_solar', 'wf_heat_pump', 'wf_battery']);
    expect(set.workflows.find((w) => w.id === 'wf_battery')?.enabled).toBe(false);
  });

  it('is appended to a stored set that lacked it, leaving the rest untouched', () => {
    const stored = defaultWorkflowSet(NOW);
    stored.workflows.push({ ...heatPumpTemplate(NOW), name: 'Heat pumps' });
    stored.version = 4;
    const tenant: Tenant = { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, workflows: stored } };
    const { set } = workflowsForTenant(tenant);
    expect(set.version).toBe(4);
    expect(set.workflows.map((w) => w.id)).toEqual(['wf_solar', 'wf_heat_pump', 'wf_battery']);
    expect(set.workflows[1]!.name).toBe('Heat pumps');
    expect(set.workflows[2]!.enabled).toBe(false);
  });

  it('appends nothing beyond the 12 workflow limit', () => {
    const eleven = defaultWorkflowSet(NOW);
    for (let i = 0; eleven.workflows.length < 11; i++) {
      eleven.workflows.push(blankWorkflow(`wf_custom_${i}`, NOW));
    }
    const at11: Tenant = { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, workflows: eleven } };
    const ids = workflowsForTenant(at11).set.workflows.map((w) => w.id);
    expect(ids).toHaveLength(12);
    expect(ids).toContain('wf_heat_pump');
    expect(ids).not.toContain('wf_battery');

    const twelve = structuredClone(eleven);
    twelve.workflows.push(blankWorkflow('wf_custom_last', NOW));
    const at12: Tenant = { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, workflows: twelve } };
    expect(workflowsForTenant(at12).set.workflows).toHaveLength(12);
  });

  it('has its own question bank, with the battery motivation prompt', () => {
    expect(bankFor('battery')).toBe(BATTERY);
    const flow = resolvedFlowFor(batteryOn());
    expect(flow.bank).toBe(BATTERY);
    expect(flow.question('motivation')!.prompt).toBe(
      'First, what would you most like from a home battery?',
    );
    expect(BATTERY.defaultSteps().map((s) => s.id)).toEqual([
      'motivation',
      'existing_system',
      'address',
      'bat_pv_kwp',
      'bat_panels',
      'usage_source',
      'tariff_type',
      'lifestyle',
      'bat_inverter',
      'bat_goal',
    ]);
    expect(BATTERY.defaultSteps().find((s) => s.id === 'bat_pv_kwp')?.optional).toBe(true);
  });

  it('passes Studio checks as shipped, and needs the address question', () => {
    expect(checkWorkflow(batteryOn(), null).filter((i) => !i.warning)).toEqual([]);
    const noAddress = {
      ...batteryOn(),
      steps: batteryOn().steps.filter((s) => s.id !== 'address'),
    };
    expect(checkWorkflow(noAddress, null)).toContainEqual(
      expect.objectContaining({
        code: 'needs_address',
        message: 'A battery quote needs the address question.',
      }),
    );
  });

  it('words the battery questions as the brief has them', () => {
    expect(BATTERY_QUESTIONS['bat_pv_kwp']!.prompt).toBe(
      'Do you know the size of your solar system in kWp? It is on your installation paperwork. You can skip this.',
    );
    expect(BATTERY_QUESTIONS['bat_pv_kwp']!.numeric).toMatchObject({ min: 0.5, max: 25 });
    expect(BATTERY_QUESTIONS['bat_panels']!.prompt).toBe(
      'Roughly how many solar panels do you have?',
    );
    expect(BATTERY_QUESTIONS['bat_panels']!.numeric).toMatchObject({ min: 2, max: 60 });
    expect(BATTERY_QUESTIONS['bat_inverter']!.options).toEqual(['hybrid', 'standard', 'unsure']);
    expect(BATTERY_QUESTIONS['bat_goal']!.options).toEqual([
      'savings',
      'backup',
      'cheap_rate',
      'unsure',
    ]);
    expect(BATTERY_QUESTIONS['bat_goal']!.options!.map((o) => OPTION_LABELS[o])).toEqual([
      'Store my solar to use later',
      'Keep the lights on in a power cut',
      'Charge on a cheap overnight rate',
      'Not sure',
    ]);
  });
});

describe('the battery questions', () => {
  it('are asked in order once enabled, motivation first', async () => {
    const store = await tempStore();
    const ctx = context(store);
    const first = await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
    expect(first.ok).toBe(true);
    expect(first.data['nextQuestionId']).toBe('motivation');

    const order = [
      'motivation',
      'existing_system',
      'address',
      'bat_pv_kwp',
      'usage_source',
      'annual_kwh',
      'tariff_type',
      'lifestyle',
      'bat_inverter',
      'bat_goal',
    ];
    let next = first.data['nextQuestionId'];
    for (const id of order) {
      expect(next).toBe(id);
      const saved = await tool(
        'save_workflow_answers',
        { answers: [{ questionId: id, value: BAT_ANSWERS[id] }] },
        ctx,
      );
      expect(saved.ok).toBe(true);
      next = saved.data['nextQuestionId'];
    }
    expect(next).toBeNull();
    const done = await tool('get_workflow_step', {}, ctx);
    expect(done.data['readyForQuote']).toBe(true);
    expect(done.data['stage']).toBe('quote_ready');
  });

  it('cannot be started while switched off', async () => {
    const store = await tempStore();
    const ctx = context(store, workflowsForTenant(null).set);
    const started = await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
    expect(started.ok).toBe(false);
  });

  it('asks for the panels only when the system size is skipped', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, {
      motivation: 'reduce_bills',
      existing_system: 'solar',
      address: ENGLAND,
    });
    const asked = await tool('get_workflow_step', {}, ctx);
    expect(asked.data['nextQuestionId']).toBe('bat_pv_kwp');
    expect(asked.data['optional']).toBe(true);
    const skipped = await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'bat_pv_kwp', value: 'skipped' }] },
      ctx,
    );
    expect(skipped.data['nextQuestionId']).toBe('bat_panels');
    const panels = await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'bat_panels', value: '10' }] },
      ctx,
    );
    expect(panels.ok).toBe(true);
    expect(panels.data['nextQuestionId']).toBe('usage_source');
    expect(
      batteryInputFrom({ ...BAT_ANSWERS, bat_pv_kwp: 'skipped', bat_panels: '10' }),
    ).toMatchObject({ pvKwp: null, panelCount: 10 });
  });

  it('reads "about 4 kWp" as 4', async () => {
    const flow = resolvedFlowFor(batteryOn());
    expect(extractAnswers('about 4 kWp', 'bat_pv_kwp', flow)).toContainEqual({
      questionId: 'bat_pv_kwp',
      value: '4',
    });

    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, {
      motivation: 'reduce_bills',
      existing_system: 'solar',
      address: ENGLAND,
    });
    const saved = await tool('save_workflow_answers', { visitorMessage: 'about 4 kWp' }, ctx);
    expect(saved.data['saved']).toEqual([{ questionId: 'bat_pv_kwp', value: '4' }]);
    expect(saved.data['nextQuestionId']).toBe('usage_source');
  });

  it('does not start a roof assessment for a battery address', async () => {
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
    ctx.visitorMessage = `a battery quote for ${ENGLAND}`;
    await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
    const conversation = await store.getConversation(DEMO_TENANT.id, SESSION);
    expect(conversation?.answers?.['address']).toContain('Downing Street');
    expect(started).not.toHaveBeenCalled();
  });
});

describe('a home without solar', () => {
  it('is not suitable: the step says so and suggests the solar workflow', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
    const saved = await tool(
      'save_workflow_answers',
      {
        answers: [
          { questionId: 'motivation', value: 'reduce_bills' },
          { questionId: 'existing_system', value: 'none' },
        ],
      },
      ctx,
    );
    expect(saved.data['stage']).toBe('not_suitable');
    expect(saved.data['ask']).toBe(NOT_SUITABLE);
    expect(saved.data['nextQuestionId']).toBeNull();
    expect(saved.data['readyForQuote']).toBe(false);
    expect(saved.data['suggestWorkflowId']).toBe('wf_solar');
    expect(saved.summary).toContain(NOT_SUITABLE);
  });

  it('suggests no solar workflow that is not available on the page', async () => {
    const store = await tempStore();
    const set = setWithBattery();
    set.workflows[0]!.enabled = false;
    const ctx = context(store, set);
    await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, { existing_system: 'none' });
    const step = await tool('get_workflow_step', {}, ctx);
    expect(step.data['stage']).toBe('not_suitable');
    expect(step.data['suggestWorkflowId']).toBeUndefined();
  });

  it('is refused a quote with the same sentence', async () => {
    const store = await tempStore();
    await publish(store, BATTERY_ROWS);
    const { result, quote } = await quoteWith(store, { ...BAT_ANSWERS, existing_system: 'none' });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe(NOT_SUITABLE);
    expect(result.data['suggestWorkflowId']).toBe('wf_solar');
    expect(quote).toBeUndefined();
    expect(batteryInputFrom({ ...BAT_ANSWERS, existing_system: 'none' })).toBeNull();
  });
});

describe('the battery quote', () => {
  it('is built when ready, shown as a battery card, and completes the workflow', async () => {
    const store = await tempStore();
    await publish(store, BATTERY_ROWS);
    const { ctx, result, card, quote } = await quoteWith(store, BAT_ANSWERS);
    expect(result.ok).toBe(true);
    expect(result.data['kind']).toBe('battery');
    expect(result.summary).toMatch(/indicative/);
    expect(result.summary).toMatch(/survey/);
    expect(card?.kind).toBe('battery');
    expect(quote?.kind).toBe('battery');
    expect(quote?.workflowId).toBe('wf_battery');
    expect(quote?.postcode).toBe('SW1A 2AA');
    expect(quote?.tariff).toBe('smart_tou');
    expect(quote!.estimate.pvKwp).toBe(4);
    expect('sizing' in quote!.estimate).toBe(false);
    expect(ctx.session.active).toBeNull();
    expect(ctx.session.completed).toEqual([
      expect.objectContaining({ workflowId: 'wf_battery', quoteId: quote!.id }),
    ]);

    // About 3,500 kWh a year on a time-of-use tariff: about 6 kWh recommended.
    expect(quote!.estimate.recommendedKwh).toBe(6);
    expect(quote!.options).toHaveLength(3);
    expect(card!.options).toHaveLength(3);
    expect(quote!.options.map((o) => [o.label, o.capacityKwh])).toEqual([
      ['Recommended', 9.5],
      ['More storage', 13.5],
      ['Smaller', 5],
    ]);
    expect(quote!.recommendedId).toBe('recommended');
    expect(quote!.options.filter((o) => o.isRecommended)).toHaveLength(1);
    for (const o of quote!.options) {
      expect(o.installerPriced).toBe(false);
      expect(o.priceGbp).toBe(o.lineItems.reduce((sum, l) => sum + l.totalGbp, 0));
      expect(o.priceLabel).toBe('Indicative price, 0% VAT');
      expect(o.annualSavingsGbp).toBe(o.selfUseSavingGbp + o.shiftSavingGbp);
    }
    // The retrofit price, never the with-solar one; no AC coupling for a hybrid.
    expect(quote!.options[0]!.priceGbp).toBe(4500);
    expect(quote!.options[0]!.lineItems.map((l) => l.sku)).toEqual(['B-9']);
    expect(quote!.options[0]!.shiftSavingGbp).toBeGreaterThan(0);
    expect(result.data['vatRatePercent']).toBe(0);
    expect(quote!.disclaimer).toBe(
      'This is an indicative estimate. Your installer will check your existing solar system, inverter and consumer unit at a survey before a final price.',
    );
    expect(quote!.priced).toBe(true);
  });

  it('saves nothing by shifting on a standard tariff', async () => {
    const store = await tempStore();
    await publish(store, BATTERY_ROWS);
    const { quote } = await quoteWith(store, { ...BAT_ANSWERS, tariff_type: 'standard' });
    expect(quote!.options.length).toBeGreaterThan(0);
    for (const o of quote!.options) expect(o.shiftSavingGbp).toBe(0);
  });

  it('leaves a non-hybrid inverter to the installer without an AC coupling price', async () => {
    const store = await tempStore();
    await publish(store, BATTERY_ROWS);
    const { quote, card } = await quoteWith(store, { ...BAT_ANSWERS, bat_inverter: 'standard' });
    for (const o of quote!.options) {
      expect(o.installerPriced).toBe(true);
      expect(o.priceGbp).toBeNull();
      expect(o.paybackYears).toBeNull();
      expect(o.priceLabel).toBe('Priced by your installer');
      expect(o.warnings).toContain(
        'Your inverter may need an extra unit to charge a battery. Your installer will check.',
      );
      // The priced battery stays, for the installer to see.
      expect(o.lineItems.length).toBe(1);
    }
    expect(quote!.priced).toBe(false);
    expect(card!.kind === 'battery' && card!.options[0]!.installerPriced).toBe(true);
  });

  it('adds the AC coupling line for an unsure inverter when the list prices it', async () => {
    const store = await tempStore();
    await publish(store, [...BATTERY_ROWS, AC_ROW]);
    const { quote } = await quoteWith(store, { ...BAT_ANSWERS, bat_inverter: 'unsure' });
    const rec = quote!.options[0]!;
    expect(rec.installerPriced).toBe(false);
    expect(rec.lineItems.map((l) => l.sku)).toEqual(['B-9', 'AC-1']);
    expect(rec.priceGbp).toBe(5200);
  });

  it('offers unpriced fallback sizes without a price list', async () => {
    const store = await tempStore();
    const { result, quote } = await quoteWith(store, BAT_ANSWERS);
    expect(result.ok).toBe(true);
    expect(quote!.pricing).toBeNull();
    expect(quote!.options.map((o) => o.capacityKwh)).toEqual([10, 13.5, 5]);
    for (const o of quote!.options) {
      expect(o.installerPriced).toBe(true);
      expect(o.priceGbp).toBeNull();
      expect(o.priceLabel).toBe('Priced by your installer');
    }
  });

  it('reaches more storage with expansion units when no larger battery is listed', async () => {
    const store = await tempStore();
    await publish(store, [
      'battery,B-4,Acme 4 kWh,with_solar,,"£2,500","£3,000",4,,EXP-2,£800,2,3,GBP',
    ]);
    const { quote } = await quoteWith(store, BAT_ANSWERS);
    expect(quote!.options.map((o) => [o.label, o.capacityKwh])).toEqual([
      ['Recommended', 4],
      ['More storage', 6],
    ]);
    const more = quote!.options[1]!;
    expect(more.lineItems).toEqual([
      { sku: 'B-4', label: 'Acme 4 kWh', quantity: 1, totalGbp: 3000 },
      { sku: 'EXP-2', label: 'Acme 4 kWh expansion unit', quantity: 1, totalGbp: 800 },
    ]);
    expect(more.priceGbp).toBe(3800);
  });

  it('warns when the home already has a battery, and assumes solar when unsure', async () => {
    const store = await tempStore();
    const { quote } = await quoteWith(store, { ...BAT_ANSWERS, existing_system: 'solar_battery' });
    expect(quote!.warnings).toContain(
      'You already have a battery. Your installer can advise on adding more storage.',
    );
    const other = await tempStore();
    const unsure = await quoteWith(other, { ...BAT_ANSWERS, existing_system: 'unsure' });
    expect(unsure.quote!.estimate.assumptions).toContain(
      'Assumed the home already has solar panels.',
    );
  });

  it('is refused until every answer is in', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
    const result = await tool('get_quote_options', {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.data['readyForQuote']).toBe(false);
    expect(await store.listQuotes(DEMO_TENANT.id, SESSION)).toEqual([]);
  });

  it('marks the battery workflow quoted after its quote, and the solar one not', async () => {
    const store = await tempStore();
    const { ctx } = await quoteWith(store, BAT_ANSWERS);
    await tool('start_workflow', { workflowId: 'wf_battery' }, ctx);
    const bat = await tool('get_workflow_step', {}, ctx);
    expect(bat.data['stage']).toBe('quoted');
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    const solar = await tool('get_workflow_step', {}, ctx);
    expect(solar.data['stage']).not.toBe('quoted');
  });
});

/** POST /v1/quote/options for a session running the battery workflow, on or off. */
async function postOptions(enabled: boolean) {
  const store = await tempStore();
  const set = setWithBattery();
  set.workflows[2]!.enabled = enabled;
  const tenant: Tenant = { ...DEMO_TENANT, config: { ...DEMO_TENANT.config, workflows: set } };
  const app = Fastify();
  const secret = 'test-secret-battery-route';
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
      active: { workflowId: 'wf_battery', startedAt: NOW },
    });
    await store.mergeAnswers(tenant.id, SESSION, BAT_ANSWERS);
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
  it('builds a battery quote for a session running the battery workflow', async () => {
    const res = await postOptions(true);
    expect(res.statusCode).toBe(201);
    const body = res.json<{ kind?: string; tenantId?: string }>();
    expect(body.kind).toBe('battery');
    expect(body.tenantId).toBeUndefined();
  });

  it('does not build one for a battery workflow that is switched off', async () => {
    const res = await postOptions(false);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ kind?: string }>().kind).toBeUndefined();
  });
});

describe('no dashes', () => {
  it('in the template or the battery questions and labels', () => {
    const dash = /[\u2013\u2014]/;
    expect(JSON.stringify(batteryTemplate(NOW))).not.toMatch(dash);
    expect(JSON.stringify(BATTERY_QUESTIONS)).not.toMatch(dash);
    expect(NOT_SUITABLE).not.toMatch(dash);
    const values = Object.values(BATTERY_QUESTIONS).flatMap((q) => q.options ?? []);
    for (const v of values) {
      expect(OPTION_LABELS[v], v).toBeDefined();
      expect(OPTION_LABELS[v]).not.toMatch(dash);
    }
  });
});
