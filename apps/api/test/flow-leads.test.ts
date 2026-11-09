import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONSENT_VERSION, type ConversationFlow, type FlowStep } from '@sunny/contracts';
import { EMPTY_KNOWLEDGE } from '@sunny/knowledge';
import { afterEach, describe, expect, it } from 'vitest';

import { executeTool, type ToolContext, type ToolEvent } from '../src/agent/tools.js';
import { LeadFollowUp, MemoryEmailState } from '../src/channels/email/index.js';
import type { MailboxClient } from '../src/channels/email/index.js';
import { flowForTenant } from '../src/flow/tenant.js';
import { demoPricing } from '../src/journey/pricing.js';
import { FileStore } from '../src/store.js';
import { DEMO_TENANT, type Tenant } from '../src/tenants.js';

import { ScriptedProvider } from './scripted-provider.js';

/** A lead carries the installer's questions and answers (Task 7). */

const evQuestion: FlowStep = {
  kind: 'custom',
  id: 'c_evcharger1',
  prompt: 'Would you like an EV charger fitted at the same time?',
  mode: 'quote',
  answer: 'choice',
  choices: [
    { value: 'yes', label: 'Yes please', effects: [] },
    { value: 'no', label: 'Not for now', effects: [] },
  ],
  followUps: [
    {
      when: ['yes'],
      step: {
        kind: 'custom',
        id: 'c_evmodel',
        prompt: 'Which car is it?',
        mode: 'lead',
        answer: 'text',
        choices: [],
      },
    },
  ],
};

const FLOW: ConversationFlow = {
  version: 5,
  updatedAt: '2026-11-09T10:00:00Z',
  steps: [
    {
      kind: 'preset',
      id: 'ownership',
      prompt: 'Is the home yours?',
      labels: { own: 'Yes, it is mine', rent: 'I rent it' },
    },
    evQuestion,
    { kind: 'preset', id: 'property_type' },
  ],
};

function tenantWith(flow: ConversationFlow | null): Tenant {
  return {
    ...DEMO_TENANT,
    config: {
      ...DEMO_TENANT.config,
      companyName: 'Northwind Solar',
      addons: { web_chat: true, email_assistant: true },
      email: { provider: 'gmail', autoSend: false },
      ...(flow ? { conversation: flow } : {}),
    },
  };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempStore(): Promise<FileStore> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-flow-leads-'));
  dirs.push(dir);
  return new FileStore(dir);
}

function context(
  store: FileStore,
  tenant: Tenant,
  answers: Record<string, string>,
): ToolContext & { events: ToolEvent[] } {
  return {
    tenant,
    sessionId: 'sess_leads',
    conversationId: null,
    store,
    answers: { ...answers },
    events: [],
    sunscanConnected: false,
    knowledge: EMPTY_KNOWLEDGE,
    flow: flowForTenant(tenant),
    quote: { pricing: { forTenant: () => Promise.resolve(demoPricing()) } },
  };
}

const ANSWERS = {
  property_type: 'semi',
  c_evmodel: 'A blue Polestar 2',
  ownership: 'own',
  c_evcharger1: 'yes',
};

describe('leads carry the installer questions and answers', () => {
  it("lists every answered question in the flow's order, in the installer's wording", async () => {
    const store = await tempStore();
    const ctx = context(store, tenantWith(FLOW), ANSWERS);
    const saved = await executeTool(
      { name: 'create_lead', args: { consent: true, email: 'a@b.example' } },
      ctx,
    );
    expect(saved.ok).toBe(true);
    const [lead] = await store.listAllLeads(DEMO_TENANT.id);
    expect(lead?.flowVersion).toBe(5);
    expect(lead?.flowAnswers).toEqual([
      {
        id: 'ownership',
        question: 'Is the home yours?',
        value: 'own',
        answer: 'Yes, it is mine',
        mode: 'preset',
      },
      {
        id: 'c_evcharger1',
        question: 'Would you like an EV charger fitted at the same time?',
        value: 'yes',
        answer: 'Yes please',
        mode: 'quote',
      },
      // The lead-only free-text answer is kept as typed.
      {
        id: 'c_evmodel',
        question: 'Which car is it?',
        value: 'A blue Polestar 2',
        answer: 'A blue Polestar 2',
        mode: 'lead',
      },
      expect.objectContaining({ id: 'property_type', value: 'semi', mode: 'preset' }),
    ]);
  });

  it('a callback request carries them too, and unanswered questions are left out', async () => {
    const store = await tempStore();
    const ctx = context(store, tenantWith(FLOW), { ownership: 'rent' });
    await executeTool({ name: 'request_callback', args: { consent: true, phone: '0700' } }, ctx);
    const [lead] = await store.listAllLeads(DEMO_TENANT.id);
    expect(lead?.flowAnswers?.map((a) => [a.id, a.answer])).toEqual([['ownership', 'I rent it']]);
  });

  it("the default flow records Sunny's own wording and no flow version", async () => {
    const store = await tempStore();
    const ctx = context(store, tenantWith(null), { ownership: 'own' });
    await executeTool({ name: 'create_lead', args: { consent: true, email: 'a@b.example' } }, ctx);
    const [lead] = await store.listAllLeads(DEMO_TENANT.id);
    expect(lead?.flowVersion).toBeUndefined();
    expect(lead?.flowAnswers?.[0]).toMatchObject({ id: 'ownership', value: 'own' });
  });

  it('a multi-select answer reads as the labels joined with a comma', async () => {
    const store = await tempStore();
    const ctx = context(store, tenantWith(null), { lifestyle: 'ev_now,heatpump_now' });
    await executeTool({ name: 'create_lead', args: { consent: true, email: 'a@b.example' } }, ctx);
    const [lead] = await store.listAllLeads(DEMO_TENANT.id);
    const entry = lead?.flowAnswers?.find((a) => a.id === 'lifestyle');
    expect(entry?.value).toBe('ev_now,heatpump_now');
    expect(entry?.answer.split(', ')).toHaveLength(2);
  });

  it('keeps answers to questions the saved flow no longer lists', async () => {
    const store = await tempStore();
    // The flow lists ownership only; the visitor also answered a preset the
    // installer has since removed and a question that is gone altogether.
    const only: ConversationFlow = {
      version: 6,
      updatedAt: '2026-11-09T10:00:00Z',
      steps: [{ kind: 'preset', id: 'ownership' }],
    };
    const ctx = context(store, tenantWith(only), {
      ownership: 'own',
      tariff_type: 'economy7',
      c_gone: 'blue',
      journey_postcode: 'LS6 2AB',
    });
    await executeTool({ name: 'create_lead', args: { consent: true, email: 'a@b.example' } }, ctx);
    const [lead] = await store.listAllLeads(DEMO_TENANT.id);
    const byId = Object.fromEntries((lead?.flowAnswers ?? []).map((a) => [a.id, a]));
    expect(lead?.flowAnswers?.[0]?.id).toBe('ownership');
    expect(byId['tariff_type']).toMatchObject({ value: 'economy7', mode: 'preset' });
    expect(byId['tariff_type']?.question).toMatch(/tariff/i);
    expect(byId['c_gone']).toEqual({
      id: 'c_gone',
      question: 'c_gone',
      value: 'blue',
      answer: 'blue',
      mode: 'lead',
    });
    expect(byId['journey_postcode']).toBeUndefined();
  });

  it('the lead email puts the custom question and answer in front of the writer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-flow-leads-mail-'));
    dirs.push(dir);
    const store = new FileStore(dir);
    const drafts: Array<{ text: string }> = [];
    const mailbox: MailboxClient = {
      provider: 'gmail',
      createDraft: (input: { raw: string; to: string; subject: string; text: string }) => {
        drafts.push(input);
        return Promise.resolve({
          draftId: 'd1',
          messageId: 'm1',
          threadId: null,
          webLink: 'https://x.example',
        });
      },
      send: () => Promise.reject(new Error('never sent')),
    };
    const provider = new ScriptedProvider(() => [{ type: 'text', text: 'Thank you.' }]);
    const followUp = new LeadFollowUp({
      store,
      state: new MemoryEmailState(),
      mailbox: () => Promise.resolve(mailbox),
      provider: () => Promise.resolve(provider),
      now: () => Date.parse('2026-11-09T12:00:00Z'),
    });
    const tenant = tenantWith(FLOW);
    const lead = {
      id: 'lead_1',
      tenantId: DEMO_TENANT.id,
      sessionId: 'sess_leads',
      conversationId: null,
      name: 'Sarah Jones',
      email: 'sarah@customer.example',
      phone: null,
      postcode: null,
      summary: 'Quote',
      score: null,
      consent: { version: CONSENT_VERSION, surface: 'widget' as const, origin: null },
      createdAt: '2026-11-09T12:00:00Z',
      flowVersion: 5,
      flowAnswers: [
        {
          id: 'c_evcharger1',
          question: 'Would you like an EV charger fitted at the same time?',
          value: 'yes',
          answer: 'Yes please',
          mode: 'quote' as const,
        },
      ],
    };
    await followUp.draft({ tenant, lead });
    const sent = provider.lastRequest?.message ?? '';
    expect(sent).toContain('Would you like an EV charger fitted at the same time?');
    expect(sent).toContain('Yes please');

    // And the template used when the model is unavailable recaps them too.
    const down = new ScriptedProvider(() => {
      throw new Error('down');
    });
    const second = new LeadFollowUp({
      store,
      state: new MemoryEmailState(),
      mailbox: () => Promise.resolve(mailbox),
      provider: () => Promise.resolve(down),
      now: () => Date.parse('2026-11-09T12:00:00Z'),
    });
    await second.draft({ tenant, lead: { ...lead, sessionId: 'sess_leads2' } });
    expect(drafts.at(-1)?.text).toContain('Would you like an EV charger fitted at the same time?');
    expect(drafts.at(-1)?.text).toContain('Yes please');
    expect(drafts.at(-1)?.text).not.toContain('—');
  });
});
