import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Workflow, WorkflowSet } from '@sunny/contracts';
import { EMPTY_KNOWLEDGE } from '@sunny/knowledge';
import type { AssessmentRecord, SunScanService } from '@sunny/sunscan-adapter';

import { CHANNEL_POLICIES } from '../src/agent/channels.js';
import { executeTool, type ToolContext, type ToolEvent } from '../src/agent/tools.js';
import { demoPricing } from '../src/journey/pricing.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, type Tenant } from '../src/tenants.js';
import { EMPTY_SESSION, cloneSession } from '../src/workflows/session.js';
import { resolvedFlowFor } from '../src/workflows/tenant.js';
import { defaultWorkflowSet } from '../src/workflows/templates.js';
import { WORKFLOW_TOOLS } from '../src/workflows/agent-tools.js';
import { runTurn } from '../src/agent/agent.js';
import { flowAnswersFor } from '../src/flow/answers.js';

import { ScriptedProvider } from './scripted-provider.js';

/**
 * The workflow tools, driven through `executeTool` with a context built as the
 * chat route builds it. The server decides what is asked; these check that the
 * tools say so, keep the session, and stamp what they file.
 */

const NOW = '2026-11-10T10:00:00.000Z';
const SESSION = 'sess_wf_tools';

const PROMO: Workflow = {
  id: 'wf_battery_deal',
  kind: 'custom',
  name: 'Battery deal',
  enabled: true,
  description: 'Registers interest in this month’s battery offer.',
  triggers: ['battery deal'],
  interests: ['battery'],
  pages: { include: ['/battery-deal'], exclude: [] },
  steps: [
    {
      kind: 'custom',
      id: 'c_whenbest1',
      prompt: 'When would suit you for a call?',
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

function setWith(...extra: Workflow[]): WorkflowSet {
  const set = defaultWorkflowSet(NOW);
  set.workflows.push(...extra);
  return set;
}

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempStore(): Promise<FileStore> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-wf-tools-'));
  dirs.push(dir);
  return new FileStore(dir);
}

function context(
  store: FileStore,
  workflows: WorkflowSet = setWith(),
  pagePath: string | null = '/',
  tenant: Tenant = DEMO_TENANT,
): ToolContext & { events: ToolEvent[] } {
  return {
    tenant,
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
    pagePath,
  };
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

/** A SunScan stand-in that starts one assessment and keeps it running. */
function stubSunScan(): { service: SunScanService; started: ReturnType<typeof vi.fn> } {
  const record = {
    id: 'as_stub1',
    tenantId: DEMO_TENANT.id,
    sessionId: SESSION,
    status: 'running',
    target: { address: '164 Norwich Drive, Norwich NR4 7TJ' },
    summary: null,
    error: null,
  } as unknown as AssessmentRecord;
  const started = vi.fn(() => Promise.resolve(record));
  const service = {
    engineVersion: 'stub',
    startAssessment: started,
    getAssessment: vi.fn(() => Promise.resolve(record)),
    waitFor: vi.fn(() => Promise.resolve(record)),
  } as unknown as SunScanService;
  return { service, started };
}

describe('start_workflow', () => {
  it('refuses a workflow restricted to another page', async () => {
    const ctx = context(await tempStore(), setWith(PROMO), '/');
    const result = await tool('start_workflow', { workflowId: 'wf_battery_deal' }, ctx);
    expect(result.ok).toBe(false);
    const ids = (result.data['available'] as Array<{ id: string }>).map((w) => w.id);
    expect(ids).toContain('wf_solar');
    expect(ids).not.toContain('wf_battery_deal');
    expect(ctx.session.active).toBeNull();
  });

  it('starts the solar workflow on its first question, with buttons', async () => {
    const store = await tempStore();
    const ctx = context(store);
    const result = await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.data['nextQuestionId']).toBe('motivation');
    expect(result.data['workflow']).toEqual({ id: 'wf_solar', name: 'Solar quote' });
    expect(result.data['pausedOther']).toBeNull();
    expect(result.data['resumed']).toBe(false);
    expect(lastReplies(ctx.events)?.questionId).toBe('motivation');
    expect(lastReplies(ctx.events)!.replies.length).toBeGreaterThan(1);
    const stored = await store.getWorkflowState(DEMO_TENANT.id, SESSION);
    expect(stored.active?.workflowId).toBe('wf_solar');
  });

  it('starts discovery once, and only when it is enabled', async () => {
    const ctx = context(await tempStore());
    const first = await tool('start_workflow', { workflowId: 'discovery' }, ctx);
    expect(first.ok).toBe(true);
    expect(first.data['nextQuestionId']).toBe('disc_interest');
    expect(ctx.session.discovery.status).toBe('asking');
    expect(lastReplies(ctx.events)?.questionId).toBe('disc_interest');

    const off = setWith();
    off.discovery.enabled = false;
    const refused = await tool(
      'start_workflow',
      { workflowId: 'discovery' },
      context(await tempStore(), off),
    );
    expect(refused.ok).toBe(false);
  });
});

describe('get_workflow_step', () => {
  it('lists what can be started when nothing is running', async () => {
    const ctx = context(await tempStore(), setWith(PROMO), '/battery-deal');
    const result = await tool('get_workflow_step', {}, ctx);
    expect(result.ok).toBe(true);
    expect(result.data['active']).toBeNull();
    const ids = (result.data['available'] as Array<{ id: string }>).map((w) => w.id);
    expect(ids.slice(0, 2)).toEqual(['wf_battery_deal', 'wf_solar']);
  });

  it('offers Skip on an optional question', async () => {
    const callback: Workflow = {
      ...PROMO,
      id: 'wf_callback',
      name: 'Call back',
      pages: { include: [], exclude: [] },
      steps: [
        {
          kind: 'custom',
          id: 'c_calltime1',
          prompt: 'Is there a best time to call?',
          mode: 'lead',
          answer: 'choice',
          choices: [
            { value: 'morning', label: 'Mornings', effects: [] },
            { value: 'evening', label: 'Evenings', effects: [] },
          ],
          optional: true,
        },
      ],
    };
    const ctx = context(await tempStore(), setWith(callback));
    await tool('start_workflow', { workflowId: 'wf_callback' }, ctx);
    const result = await tool('get_workflow_step', {}, ctx);
    expect(result.data['nextQuestionId']).toBe('c_calltime1');
    expect(result.data['optional']).toBe(true);
    expect(lastReplies(ctx.events)!.replies).toEqual([
      { value: 'morning', label: 'Mornings' },
      { value: 'evening', label: 'Evenings' },
      { value: 'skipped', label: 'Skip' },
    ]);
  });
});

describe('save_workflow_answers', () => {
  it('stores an address from the visitor’s message and measures the roof', async () => {
    const store = await tempStore();
    const ctx = context(store);
    const sunscan = stubSunScan();
    ctx.sunscan = sunscan.service;
    ctx.sunscanConnected = true;
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    const result = await tool(
      'save_workflow_answers',
      { visitorMessage: 'quote for 164 Norwich Drive, Norwich NR4 7TJ' },
      ctx,
    );
    const conversation = await store.getConversation(DEMO_TENANT.id, SESSION);
    expect(conversation?.answers?.['address']).toContain('164 Norwich Drive');
    expect(sunscan.started).toHaveBeenCalledTimes(1);
    expect(result.data['workflow']).toEqual({ id: 'wf_solar', name: 'Solar quote' });
  });

  it('goes from discovery to a suggestion, and the suggestion skips what was answered', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'discovery' }, ctx);
    await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'disc_interest', value: 'solar' }] },
      ctx,
    );
    const done = await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'motivation', value: 'reduce_bills' }] },
      ctx,
    );
    expect(done.data['suggest']).toEqual({ workflowId: 'wf_solar', name: 'Solar quote' });
    expect(ctx.session.discovery).toEqual({ status: 'done', suggestedWorkflowId: 'wf_solar' });
    expect(ctx.session.active).toBeNull();

    const started = await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    expect(started.data['nextQuestionId']).toBe('property_type');
  });

  it('closes discovery rather than parking it when a workflow starts part way', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'discovery' }, ctx);
    const started = await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    expect(started.data['pausedOther']).toBeNull();
    expect(ctx.session.paused).toEqual([]);
    expect(ctx.session.discovery.status).toBe('skipped');
    const stored = await store.getWorkflowState(DEMO_TENANT.id, SESSION);
    expect(stored.active?.workflowId).toBe('wf_solar');
    expect(stored.discovery.status).toBe('skipped');
  });

  it('says a lead workflow is ready once its question is answered', async () => {
    const ctx = context(await tempStore(), setWith(PROMO), '/battery-deal');
    await tool('start_workflow', { workflowId: 'wf_battery_deal' }, ctx);
    const result = await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'c_whenbest1', value: 'Weekday mornings' }] },
      ctx,
    );
    expect(result.data['readyForLead']).toBe(true);
  });
});

describe('pause_workflow', () => {
  it('sets the workflow aside and keeps its answers', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'motivation', value: 'reduce_bills' }] },
      ctx,
    );
    const result = await tool('pause_workflow', { reason: 'not now' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.data['paused']).toBe('wf_solar');
    expect(result.data['answersKept']).toBe(true);
    expect(result.summary).toBe('Paused. Answers kept.');
    const stored = await store.getWorkflowState(DEMO_TENANT.id, SESSION);
    expect(stored.active).toBeNull();
    expect(stored.paused[0]?.workflowId).toBe('wf_solar');
    const conversation = await store.getConversation(DEMO_TENANT.id, SESSION);
    expect(conversation?.answers?.['motivation']).toBe('reduce_bills');
  });
});

describe('leads and quotes under a workflow', () => {
  it('stamps a lead with the workflow it came from', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    const result = await tool('create_lead', { consent: true, email: 'a@example.com' }, ctx);
    expect(result.ok).toBe(true);
    const [lead] = await store.listLeads(DEMO_TENANT.id);
    expect(lead?.workflowId).toBe('wf_solar');
  });

  it('files a lead without a workflow when none is running', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('create_lead', { consent: true, email: 'a@example.com' }, ctx);
    const [lead] = await store.listLeads(DEMO_TENANT.id);
    expect(lead).toBeDefined();
    expect('workflowId' in lead!).toBe(false);
  });

  it('refuses a quote while a lead workflow is running', async () => {
    const ctx = context(await tempStore(), setWith(PROMO), '/battery-deal');
    await tool('start_workflow', { workflowId: 'wf_battery_deal' }, ctx);
    const result = await tool('get_quote_options', {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.data['outcome']).toBe('lead');
  });
});

describe('the chat surface', () => {
  it('offers the workflow tools in chat, not the old answer tools', () => {
    const chat = CHANNEL_POLICIES.chat.tools as readonly string[];
    for (const name of [
      'start_workflow',
      'get_workflow_step',
      'save_workflow_answers',
      'pause_workflow',
    ])
      expect(chat).toContain(name);
    for (const name of ['get_quote_journey', 'save_answers', 'get_questionnaire', 'save_answer'])
      expect(chat).not.toContain(name);
    expect(CHANNEL_POLICIES.email.tools).toEqual([
      'retrieve_knowledge',
      'create_lead',
      'create_gmail_draft',
    ]);
  });

  it('writes no em or en dash in what the tools say', () => {
    for (const t of WORKFLOW_TOOLS) expect(t.description).not.toMatch(/[–—]/);
  });
});

/** Every answer the solar quote requires, given through the store. */
const SOLAR_REQUIRED = {
  motivation: 'reduce_bills',
  property_type: 'detached',
  ownership: 'own',
  address: '164 Norwich Drive, Norwich NR4 7TJ',
  roof_size: 'medium',
  roof_direction: 'south',
  roof_shading: 'none',
  usage_source: 'household',
  household_size: '3',
  lifestyle: 'evening_use',
  tariff_type: 'standard',
  existing_system: 'none',
};

const CALLBACK: Workflow = {
  ...PROMO,
  id: 'wf_callback',
  name: 'Call back',
  pages: { include: [], exclude: [] },
  steps: [
    {
      kind: 'custom',
      id: 'c_calltime1',
      prompt: 'Is there a best time to call?',
      mode: 'lead',
      answer: 'choice',
      choices: [
        { value: 'morning', label: 'Mornings', effects: [] },
        { value: 'evening', label: 'Evenings', effects: [] },
      ],
      optional: true,
    },
  ],
};

describe('optional questions are asked, with Skip', () => {
  it('solar asks budget_band, then finance_interest, before the quote is ready', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    await store.mergeAnswers(DEMO_TENANT.id, SESSION, SOLAR_REQUIRED);

    const budget = await tool('get_workflow_step', {}, ctx);
    expect(budget.data['nextQuestionId']).toBe('budget_band');
    expect(budget.data['optional']).toBe(true);
    expect(budget.data['readyForQuote']).toBe(false);
    expect(lastReplies(ctx.events)!.replies.at(-1)).toEqual({ value: 'skipped', label: 'Skip' });

    const finance = await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'budget_band', value: 'skipped' }] },
      ctx,
    );
    expect(finance.data['nextQuestionId']).toBe('finance_interest');
    expect(finance.data['readyForQuote']).toBe(false);
    expect(lastReplies(ctx.events)!.replies.at(-1)).toEqual({ value: 'skipped', label: 'Skip' });

    const done = await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'finance_interest', value: 'no' }] },
      ctx,
    );
    expect(done.data['nextQuestionId']).toBeNull();
    expect(done.data['readyForQuote']).toBe(true);
  });

  it('a lead workflow is not ready until its optional question is answered or skipped', async () => {
    const ctx = context(await tempStore(), setWith(CALLBACK));
    const started = await tool('start_workflow', { workflowId: 'wf_callback' }, ctx);
    expect(started.data['readyForLead']).toBe(false);
    const skipped = await tool(
      'save_workflow_answers',
      { answers: [{ questionId: 'c_calltime1', value: 'skipped' }] },
      ctx,
    );
    expect(skipped.data['readyForLead']).toBe(true);
  });

  it('a skipped question is left out of the lead', () => {
    const flow = resolvedFlowFor(setWith().workflows[0]!);
    const listed = flowAnswersFor(flow, {
      motivation: 'reduce_bills',
      budget_band: 'skipped',
      c_unknown1: 'skipped',
    });
    expect(listed.map((a) => a.id)).toEqual(['motivation']);
  });
});

describe('a bare postcode', () => {
  it('is not stored as an address, and no roof is measured', async () => {
    const store = await tempStore();
    const ctx = context(store);
    const sunscan = stubSunScan();
    ctx.sunscan = sunscan.service;
    ctx.sunscanConnected = true;
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    await tool('save_workflow_answers', { visitorMessage: 'My postcode is NR4 7TJ' }, ctx);
    const conversation = await store.getConversation(DEMO_TENANT.id, SESSION);
    expect(conversation?.answers?.['address']).toBeUndefined();
    expect(sunscan.started).not.toHaveBeenCalled();
  });
});

describe('a lead finishes a lead workflow', () => {
  it('completes the running lead workflow with the lead it filed', async () => {
    const store = await tempStore();
    const ctx = context(store, setWith(PROMO), '/battery-deal');
    await tool('start_workflow', { workflowId: 'wf_battery_deal' }, ctx);
    await tool('create_lead', { consent: true, email: 'a@example.com' }, ctx);
    const [lead] = await store.listLeads(DEMO_TENANT.id);
    const stored = await store.getWorkflowState(DEMO_TENANT.id, SESSION);
    expect(stored.active).toBeNull();
    expect(stored.completed).toEqual([
      { workflowId: 'wf_battery_deal', at: expect.any(String) as string, leadId: lead!.id },
    ]);
    expect(lead?.workflowId).toBe('wf_battery_deal');
  });

  it('leaves a quote workflow running when a lead is filed', async () => {
    const store = await tempStore();
    const ctx = context(store);
    await tool('start_workflow', { workflowId: 'wf_solar' }, ctx);
    await tool('request_callback', { consent: true, phone: '01234 567890' }, ctx);
    const stored = await store.getWorkflowState(DEMO_TENANT.id, SESSION);
    expect(stored.active?.workflowId).toBe('wf_solar');
    expect(stored.completed).toEqual([]);
  });
});

describe('the session across turns', () => {
  it('a later turn finds the workflow an earlier turn started', async () => {
    const store = await tempStore();
    let turn = 0;
    const results: Array<Record<string, unknown>> = [];
    const provider = new ScriptedProvider((request) => {
      turn += 1;
      const original = request.execute;
      request.execute = async (call) => {
        const result = (await original(call)) as Record<string, unknown>;
        results.push(result);
        return result;
      };
      return turn === 1
        ? [
            {
              type: 'tool_started',
              call: { name: 'start_workflow', args: { workflowId: 'wf_solar' } },
            },
            { type: 'text', text: 'Let us start.' },
          ]
        : [
            { type: 'tool_started', call: { name: 'get_workflow_step', args: {} } },
            { type: 'text', text: 'Carrying on.' },
          ];
    });
    for (const [n, message] of ['I want a solar quote', 'go on'].entries()) {
      const turnEvents = runTurn({
        tenant: DEMO_TENANT,
        provider,
        store,
        sessionId: SESSION,
        conversationId: null,
        history: [],
        message,
        clientMessageId: `c_${n}`,
        sunscanConnected: false,
      });
      for await (const event of turnEvents) void event;
    }
    expect(results).toHaveLength(2);
    expect(results[1]?.['active']).toBe('wf_solar');
    expect(results[1]?.['nextQuestionId']).toBe('motivation');
  });
});
