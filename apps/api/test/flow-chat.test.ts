import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConversationFlow, FlowStep } from '@sunny/contracts';
import { EMPTY_KNOWLEDGE } from '@sunny/knowledge';
import type { PricingSource } from '@sunny/quote-engine';

import { runTurn, type TurnEvent } from '../src/agent/agent.js';
import { executeTool, type ToolContext, type ToolEvent } from '../src/agent/tools.js';
import { publishExample } from '../src/catalogue/price-list-service.js';
import { resolveFlow } from '../src/flow/resolve.js';
import { flowForTenant } from '../src/flow/tenant.js';
import { catalogueBackedPricing } from '../src/journey/catalogue-pricing.js';
import { extractAnswers } from '../src/journey/extract.js';
import { demoPricing } from '../src/journey/pricing.js';
import type { QuoteRecord } from '../src/journey/quote.js';
import { optionLabel } from '../src/questionnaire.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, TenantRegistry, type Tenant } from '../src/tenants.js';
import type { ServerConfig } from '../src/config.js';

import { TEST_ADMIN_TOKEN } from './catalogue-fixture.js';
import { ScriptedProvider } from './scripted-provider.js';
import { workflowContext } from './workflow-fixture.js';

/**
 * Sunny's chat follows the installer's own conversation (Task 5): the tools,
 * the answer reading and the quote all run on the tenant's stored flow, read
 * afresh every turn. The host-page route follows the same workflow.
 */

const EV = 'EV-PROJECTEV-7KW-UNTETHERED';
const ADDRESS = '164 Norwich Drive, Norwich NR4 7TJ';

const evQuestion: FlowStep = {
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

/** Shading, then a reworded ownership, the EV question, property and usage. */
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

/** The same flow, saved again with the EV question and the tariff removed. */
const FLOW_V2: ConversationFlow = {
  version: 4,
  updatedAt: '2026-11-09T11:00:00Z',
  steps: FLOW.steps.filter((s) => s.id !== 'c_evcharger1' && s.id !== 'tariff_type'),
};

function tenantWith(flow: unknown): Tenant {
  return {
    ...DEMO_TENANT,
    config: { ...DEMO_TENANT.config, conversation: flow as ConversationFlow },
  };
}

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempStore(): Promise<FileStore> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-flow-chat-'));
  dirs.push(dir);
  return new FileStore(dir);
}

const SESSION = 'sess_flow';

/** One turn's tool context, built from the tenant as the chat route builds it. */
function context(
  store: FileStore,
  tenant: Tenant,
  answers: Record<string, string> = {},
  pricing: PricingSource = { forTenant: () => Promise.resolve(demoPricing()) },
): ToolContext & { events: ToolEvent[] } {
  return {
    tenant,
    sessionId: SESSION,
    conversationId: null,
    store,
    answers: { ...answers },
    events: [],
    sunscanConnected: false,
    knowledge: EMPTY_KNOWLEDGE,
    flow: flowForTenant(tenant),
    ...workflowContext(),
    quote: { pricing },
  };
}

interface Questionnaire {
  questions: Array<{
    id: string;
    prompt: string;
    options: string[];
    labels?: Record<string, string>;
  }>;
}

async function tool(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const result = await executeTool({ name, args }, ctx);
  return { ok: result.ok, summary: result.summary, data: result.data as Record<string, unknown> };
}

function lastReplies(events: ToolEvent[]) {
  const replies = events.filter((e) => e.kind === 'quick_replies');
  return replies[replies.length - 1]?.detail as
    { questionId: string | null; replies: Array<{ value: string; label: string }> } | undefined;
}

describe("Sunny's chat on the installer's flow", () => {
  it("get_questionnaire lists the installer's questions in their order, with their wording", async () => {
    const store = await tempStore();
    const ctx = context(store, tenantWith(FLOW));
    const result = await tool('get_questionnaire', {}, ctx);
    expect(result.ok).toBe(true);
    const { questions } = result.data as unknown as Questionnaire;
    expect(questions.map((q) => q.id)).toEqual([
      'address',
      'roof_confidence',
      'roof_shading',
      'ownership',
      'c_evcharger1',
      'property_type',
      'usage_source',
      'tariff_type',
    ]);
    const ownership = questions.find((q) => q.id === 'ownership')!;
    expect(ownership.prompt).toBe('Is the home yours?');
    expect(ownership.labels?.['own']).toBe('Yes, it is mine');
    const ev = questions.find((q) => q.id === 'c_evcharger1')!;
    expect(ev.prompt).toBe('Would you like an EV charger fitted at the same time?');
    expect(ev.options).toEqual(['yes', 'no']);
    expect(ev.labels).toEqual({ yes: 'Yes please', no: 'Not for now' });
  });

  it('a removed preset is never offered and save_answer refuses it', async () => {
    const store = await tempStore();
    const ctx = context(store, tenantWith(FLOW));
    const listed = await tool('get_questionnaire', { includeAnswered: true }, ctx);
    const ids = (listed.data as unknown as Questionnaire).questions.map((q) => q.id);
    for (const removed of ['budget_band', 'motivation', 'lifestyle', 'finance_interest']) {
      expect(ids).not.toContain(removed);
    }

    const saved = await tool('save_answer', { questionId: 'budget_band', value: '10k_15k' }, ctx);
    expect(saved.ok).toBe(false);
    expect(ctx.answers['budget_band']).toBeUndefined();

    // The installer's own question is a real question here.
    const custom = await tool('save_answer', { questionId: 'c_evcharger1', value: 'yes' }, ctx);
    expect(custom.ok).toBe(true);
    expect(ctx.answers['c_evcharger1']).toBe('yes');
    // And a value that is not one of its choices is refused.
    const wrong = await tool('save_answer', { questionId: 'c_evcharger1', value: 'maybe' }, ctx);
    expect(wrong.ok).toBe(false);
    expect(ctx.answers['c_evcharger1']).toBe('yes');

    // The journey tool refuses it too, and nothing is stored.
    const journeyCtx = context(store, tenantWith(FLOW));
    const batch = await tool(
      'save_answers',
      { answers: [{ questionId: 'budget_band', value: '10k_15k' }] },
      journeyCtx,
    );
    expect(batch.ok).toBe(false);
    const stored = (await store.getConversation(DEMO_TENANT.id, SESSION))?.answers ?? {};
    expect(stored['budget_band']).toBeUndefined();
  });

  it("quick replies carry the installer's labels", async () => {
    const store = await tempStore();
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, {
      address: ADDRESS,
      roof_shading: 'none',
    });
    const ctx = context(store, tenantWith(FLOW));
    const view = await tool('get_quote_journey', {}, ctx);
    expect(view.data['nextQuestionId']).toBe('ownership');
    expect(view.data['ask']).toBe('Is the home yours?');
    expect((view.data['optionLabels'] as Record<string, string>)['own']).toBe('Yes, it is mine');
    const replies = lastReplies(ctx.events)!;
    expect(replies.questionId).toBe('ownership');
    expect(replies.replies).toContainEqual({ value: 'own', label: 'Yes, it is mine' });
    expect(replies.replies).toContainEqual({ value: 'rent', label: 'I rent it' });
    // A label the installer left alone reads as Sunny's.
    expect(replies.replies.find((r) => r.value === 'mortgage')?.label).toBe(
      optionLabel('mortgage'),
    );

    // Answering moves on to the installer's own question, with its labels.
    const saved = await tool(
      'save_answers',
      { answers: [{ questionId: 'ownership', value: 'own' }] },
      ctx,
    );
    expect(saved.data['nextQuestionId']).toBe('c_evcharger1');
    expect(saved.data['optionLabels']).toEqual({ yes: 'Yes please', no: 'Not for now' });
    expect(lastReplies(ctx.events)!.replies).toEqual([
      { value: 'yes', label: 'Yes please' },
      { value: 'no', label: 'Not for now' },
    ]);
  });

  it('a typed reply matching no choice of a custom question stores nothing', async () => {
    const store = await tempStore();
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, {
      address: ADDRESS,
      roof_shading: 'none',
      ownership: 'own',
    });
    const ask = await tool('get_quote_journey', {}, context(store, tenantWith(FLOW)));
    expect(ask.data['nextQuestionId']).toBe('c_evcharger1');

    const vague = await tool(
      'save_answers',
      { visitorMessage: 'hmm, what does a hot tub cost?' },
      context(store, tenantWith(FLOW)),
    );
    expect(vague.data['saved']).toEqual([]);
    expect(vague.data['nextQuestionId']).toBe('c_evcharger1');
    let stored = (await store.getConversation(DEMO_TENANT.id, SESSION))?.answers ?? {};
    expect(stored['c_evcharger1']).toBeUndefined();

    // The installer's label, typed, is understood.
    const typed = await tool(
      'save_answers',
      { visitorMessage: 'not for now thanks' },
      context(store, tenantWith(FLOW)),
    );
    expect(typed.data['saved']).toEqual([{ questionId: 'c_evcharger1', value: 'no' }]);
    stored = (await store.getConversation(DEMO_TENANT.id, SESSION))?.answers ?? {};
    expect(stored['c_evcharger1']).toBe('no');

    // On another visit, a plain "yes" maps onto the one choice that says yes.
    await store.mergeAnswers(DEMO_TENANT.id, 's_yes', {
      address: ADDRESS,
      roof_shading: 'none',
      ownership: 'own',
    });
    const yes = await tool(
      'save_answers',
      { visitorMessage: "yes, we've got a Tesla coming" },
      { ...context(store, tenantWith(FLOW)), sessionId: 's_yes' },
    );
    expect(yes.data['saved']).toEqual([{ questionId: 'c_evcharger1', value: 'yes' }]);
  });

  it('a flow saved mid-conversation: earlier answers stay, removed questions are not asked', async () => {
    const store = await tempStore();
    await publishExample(store, DEMO_TENANT.id, '2026-11-09T09:00:00Z');
    const pricing = catalogueBackedPricing(store);

    // Under the first flow the visitor answers up to the installer's EV question.
    await tool(
      'save_answers',
      {
        answers: [
          { questionId: 'address', value: ADDRESS },
          { questionId: 'roof_shading', value: 'none' },
          { questionId: 'ownership', value: 'own' },
        ],
      },
      context(store, tenantWith(FLOW), {}, pricing),
    );
    const before = await tool(
      'get_quote_journey',
      {},
      context(store, tenantWith(FLOW), {}, pricing),
    );
    expect(before.data['nextQuestionId']).toBe('c_evcharger1');

    // The installer saves a flow without it. The next turn reads the new one.
    const next = context(store, tenantWith(FLOW_V2), {}, pricing);
    const after = await tool('get_quote_journey', {}, next);
    expect(after.data['nextQuestionId']).toBe('property_type');
    const stored = (await store.getConversation(DEMO_TENANT.id, SESSION))?.answers ?? {};
    expect(stored).toMatchObject({ address: ADDRESS, roof_shading: 'none', ownership: 'own' });

    await tool(
      'save_answers',
      {
        answers: [
          { questionId: 'property_type', value: 'semi' },
          { questionId: 'usage_source', value: 'monthly_cost' },
          { questionId: 'monthly_cost', value: '120' },
        ],
      },
      next,
    );
    const ready = await tool('get_quote_journey', {}, next);
    expect(ready.data['readyForQuote']).toBe(true);
    expect(JSON.stringify(next.events)).not.toContain('c_evcharger1');
    expect(JSON.stringify(next.events)).not.toContain('tariff_type');

    // The quote uses the flow in force when it is built: the tariff is now an estimate.
    const quoted = await tool('get_quote_options', {}, next);
    expect(quoted.ok).toBe(true);
    const quotes = (await store.listQuotes(DEMO_TENANT.id, SESSION)) as QuoteRecord[];
    expect(quotes[0]!.estimatedFrom).toContain('tariff_type');
    expect(quotes[0]!.estimatedFrom).not.toContain('roof_shading');
  });

  it("an answer to the installer's quote question changes the quote Sunny builds", async () => {
    const store = await tempStore();
    await publishExample(store, DEMO_TENANT.id, '2026-11-09T09:00:00Z');
    const pricing = catalogueBackedPricing(store);
    const quoteWith = async (session: string, ev: 'yes' | 'no') => {
      const ctx = { ...context(store, tenantWith(FLOW), {}, pricing), sessionId: session };
      await tool(
        'save_answers',
        {
          answers: [
            { questionId: 'address', value: ADDRESS },
            { questionId: 'roof_shading', value: 'none' },
            { questionId: 'ownership', value: 'own' },
            { questionId: 'c_evcharger1', value: ev },
            { questionId: 'property_type', value: 'semi' },
            { questionId: 'usage_source', value: 'monthly_cost' },
            { questionId: 'monthly_cost', value: '120' },
            { questionId: 'tariff_type', value: 'standard' },
          ],
        },
        ctx,
      );
      const quoted = await tool('get_quote_options', {}, ctx);
      expect(quoted.ok).toBe(true);
      return (await store.listQuotes(DEMO_TENANT.id, session))[0]!;
    };
    const yes = await quoteWith('s_yes', 'yes');
    const no = await quoteWith('s_no', 'no');
    for (const option of yes.options) {
      expect(option.lineItems.filter((l) => l.sku === EV)).toHaveLength(1);
    }
    for (const option of no.options) {
      expect(option.lineItems.filter((l) => l.sku === EV)).toHaveLength(0);
    }
    expect(yes.warnings.join(' ')).not.toMatch(/priced separately|could not/i);
  });

  it('a chat turn reads the flow from the tenant it is given', async () => {
    const store = await tempStore();
    const provider = new ScriptedProvider(() => [
      { type: 'tool_started', call: { name: 'start_workflow', args: { workflowId: 'wf_solar' } } },
      { type: 'text', text: 'Lovely.' },
    ]);
    const events: TurnEvent[] = [];
    for await (const event of runTurn({
      tenant: tenantWith(FLOW),
      provider,
      store,
      sessionId: SESSION,
      conversationId: null,
      history: [],
      message: 'can I get a quote?',
      clientMessageId: 'c_1',
      sunscanConnected: false,
    })) {
      events.push(event);
    }
    const finished = events.find((e) => e.type === 'tool_finished');
    expect(finished).toBeDefined();
    const request = provider.lastRequest!;
    // The installer's own question is one this turn's workflow accepts.
    const result = (await request.execute({
      name: 'save_workflow_answers',
      args: { answers: [{ questionId: 'c_evcharger1', value: 'yes' }] },
    })) as { saved?: Array<{ questionId: string }> };
    expect(result.saved?.map((a) => a.questionId)).toContain('c_evcharger1');
  });

  it('a stored flow that fails to parse falls back to Sunny’s own questions, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flow = flowForTenant(tenantWith({ version: 'x', steps: 'nope' }));
    expect(flow.custom).toBe(false);
    expect(flow.question('budget_band')).toBeDefined();
    expect(warn).toHaveBeenCalled();
  });
});

// ─── the host page's own form ────────────────────────────────────────────────

const ORIGIN = 'http://localhost:4173';

function config(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-flow-chat',
    allowedOrigins: [ORIGIN],
    sessionSecret: 'test-secret-not-used-in-production',
    adminToken: TEST_ADMIN_TOKEN,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: true,
      trustProxyHops: 0,
      rules: {
        session: { limit: 100_000, windowMs: 60_000 },
        chat: { limit: 100_000, windowMs: 60_000 },
        leads: { limit: 100_000, windowMs: 60_000 },
        qualification: { limit: 100_000, windowMs: 60_000 },
        catalogue: { limit: 100_000, windowMs: 60_000 },
        knowledge: { limit: 100_000, windowMs: 60_000 },
      },
      maxKeys: 10_000,
    },
  };
}

describe('the host-page route', () => {
  it('the host-page route follows the tenant workflow, custom questions included', async () => {
    const store = await tempStore();
    const app = buildServer({
      config: config(),
      store,
      tenants: new TenantRegistry([tenantWith(FLOW)]),
      now: () => 1_700_000_000_000,
    });
    await app.ready();
    try {
      const session = await app.inject({
        method: 'POST',
        url: '/v1/widget/session',
        payload: { publicId: DEMO_TENANT.publicId, origin: ORIGIN },
      });
      expect(session.statusCode).toBe(200);
      const { sessionId, sessionToken } = session.json<{
        sessionId: string;
        sessionToken: string;
      }>();
      const REMOVED = new Set([
        'lifestyle',
        'existing_system',
        'motivation',
        'budget_band',
        'finance_interest',
      ]);
      const answers: Array<[string, string]> = [
        ['address', ADDRESS],
        ['roof_confidence', 'high'],
        ['roof_confirmed', 'yes'],
        ['roof_shading', 'none'],
        ['property_type', 'semi'],
        ['ownership', 'own'],
        ['usage_source', 'monthly_cost'],
        ['monthly_cost', '120'],
        ['lifestyle', 'ev_now'],
        ['tariff_type', 'standard'],
        ['existing_system', 'none'],
        ['motivation', 'reduce_bills'],
        ['budget_band', '10k_15k'],
        ['finance_interest', 'maybe'],
      ];
      for (const [questionId, value] of answers) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/qualification/answer',
          headers: { authorization: `Bearer ${sessionToken}` },
          payload: { sessionId, questionId, value },
        });
        // Questions the installer removed from their conversation are no longer
        // part of it; the rest are accepted.
        const inFlow = !REMOVED.has(questionId);
        expect(response.statusCode, `${questionId}: ${response.body}`).toBe(inFlow ? 200 : 400);
      }
      // The installer's own question belongs to their workflow, so it is accepted.
      const custom = await app.inject({
        method: 'POST',
        url: '/v1/qualification/answer',
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { sessionId, questionId: 'c_evcharger1', value: 'yes' },
      });
      expect(custom.statusCode, custom.body).toBe(200);
      expect(custom.json<{ answers: Record<string, string> }>().answers.c_evcharger1).toBe('yes');
    } finally {
      await app.close();
    }
  });
});

describe('a tenant with an empty workflow set', () => {
  it('answers a host-page question with a bad_request, not a 500', async () => {
    const store = await tempStore();
    const tenant: Tenant = {
      ...DEMO_TENANT,
      config: {
        ...DEMO_TENANT.config,
        workflows: {
          version: 1,
          updatedAt: '2026-11-09T10:00:00Z',
          discovery: { enabled: false },
          workflows: [],
        },
      },
    };
    const app = buildServer({
      config: config(),
      store,
      tenants: new TenantRegistry([tenant]),
      now: () => 1_700_000_000_000,
    });
    await app.ready();
    try {
      const session = await app.inject({
        method: 'POST',
        url: '/v1/widget/session',
        payload: { publicId: DEMO_TENANT.publicId, origin: ORIGIN },
      });
      const { sessionId, sessionToken } = session.json<{
        sessionId: string;
        sessionToken: string;
      }>();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/qualification/answer',
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { sessionId, questionId: 'roof_shading', value: 'none' },
      });
      expect(response.statusCode, response.body).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('reading a reply to a question that changes the quote', () => {
  const carQuestion: FlowStep = {
    kind: 'custom',
    id: 'c_car1',
    prompt: 'Which car do you drive?',
    mode: 'quote',
    answer: 'choice',
    choices: [
      { value: 'ev', label: 'Electric car', effects: [{ kind: 'add', itemKey: EV }] },
      { value: 'petrol', label: 'Petrol car', effects: [] },
    ],
  };
  const flow = resolveFlow({
    version: 1,
    updatedAt: '2026-11-09T10:00:00Z',
    steps: [
      evQuestion,
      carQuestion,
      // A preset the installer linked to an item: read as carefully as their own.
      {
        kind: 'preset',
        id: 'finance_interest',
        effects: { yes: [{ kind: 'add', itemKey: EV }] },
      },
    ],
  });

  it('a leading "ok" that starts a question of their own stores nothing', () => {
    expect(extractAnswers('ok, so what does a charger cost?', 'c_evcharger1', flow)).toEqual([]);
    expect(extractAnswers('ok, what does it cost?', 'c_evcharger1', flow)).toEqual([]);
    expect(extractAnswers('right, and how long does fitting take?', 'c_evcharger1', flow)).toEqual(
      [],
    );
    expect(extractAnswers('ok, what does it cost?', 'finance_interest', flow)).toEqual([]);
  });

  it('"ok" alone, "sure thanks" and "yes please" still mean yes', () => {
    for (const reply of ['ok', 'OK.', 'okay please', 'sure, thanks!', 'yes please']) {
      expect(extractAnswers(reply, 'c_evcharger1', flow), reply).toEqual([
        { questionId: 'c_evcharger1', value: 'yes' },
      ]);
    }
    expect(extractAnswers('ok', 'finance_interest', flow)).toEqual([
      { questionId: 'finance_interest', value: 'yes' },
    ]);
  });

  it('a negated label is not picked', () => {
    for (const reply of [
      'no electric car',
      'not an electric car',
      "I don't have an electric car",
      'we drive without an electric car',
    ]) {
      expect(extractAnswers(reply, 'c_car1', flow), reply).toEqual([]);
    }
    expect(extractAnswers('we have an electric car', 'c_car1', flow)).toEqual([
      { questionId: 'c_car1', value: 'ev' },
    ]);
  });

  it("Sunny's own questions, with no items linked, read a reply as before", () => {
    expect(extractAnswers('ok, what does it cost?', 'finance_interest')).toEqual([
      { questionId: 'finance_interest', value: 'yes' },
    ]);
    expect(extractAnswers('sure, why not', 'ownership')).toEqual([
      { questionId: 'ownership', value: 'own' },
    ]);
  });
});
