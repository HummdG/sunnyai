/* eslint-disable @typescript-eslint/require-await -- the fakes implement async interfaces and have nothing to await */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONSENT_VERSION } from '@sunny/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { EMAIL_DISCLAIMER_FOOTER } from '../src/agent/channels.js';
import type { ChatProvider, ChatTurnRequest } from '../src/agent/provider.js';
import { enquiryTopic, followUpSubject } from '../src/channels/email/followup.js';
import type { StoredQuote } from '../src/journey/quote-kinds.js';
import {
  composeReply,
  LeadFollowUp,
  MemoryEmailState,
  transcriptFor,
  type MailboxClient,
} from '../src/channels/email/index.js';
import { FileStore, type LeadRecord } from '../src/store.js';
import { DEMO_TENANT, type Tenant } from '../src/tenants.js';
import { ScriptedProvider } from './scripted-provider.js';

const NOW = Date.parse('2026-10-27T12:00:00.000Z');

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function tenant(
  addons: Record<string, boolean> = { web_chat: true, email_assistant: true },
): Tenant {
  return {
    ...DEMO_TENANT,
    config: {
      ...DEMO_TENANT.config,
      companyName: 'Northwind Solar',
      addons,
      email: { provider: 'gmail', autoSend: false, signatureName: 'Priya at Northwind Solar' },
    },
  };
}

class FakeMailbox implements MailboxClient {
  readonly provider = 'gmail' as const;
  drafts: Array<{ raw: string; to: string; subject: string; text: string }> = [];
  async createDraft(input: { raw: string; to: string; subject: string; text: string }) {
    this.drafts.push(input);
    return {
      draftId: `d${this.drafts.length}`,
      messageId: 'm1',
      threadId: null,
      webLink: 'https://mail.google.com/mail/u/0/#drafts',
    };
  }
  async send(): Promise<{ messageId: string }> {
    throw new Error('A follow-up is never sent.');
  }
}

function lead(over: Partial<LeadRecord> = {}): LeadRecord {
  return {
    id: 'lead_1',
    tenantId: DEMO_TENANT.id,
    sessionId: 'sess_web1',
    conversationId: null,
    name: 'Sarah Jones',
    email: 'sarah@customer.example',
    phone: '07700 900123',
    postcode: 'LS6 2AB',
    summary: 'Quote for a 3-bed semi, about £150 a month on electricity',
    score: null,
    consent: { version: CONSENT_VERSION, surface: 'widget', origin: null },
    createdAt: new Date(NOW).toISOString(),
    ...over,
  };
}

async function setup(provider: ChatProvider) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-followup-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const state = new MemoryEmailState();
  const mailbox = new FakeMailbox();
  await store.appendTurn(DEMO_TENANT.id, 'sess_web1', {
    role: 'user',
    text: 'We have a 3-bed semi in Leeds and spend about £150 a month. Is solar worth it?',
    at: new Date(NOW).toISOString(),
    channel: 'chat',
  });
  await store.appendTurn(DEMO_TENANT.id, 'sess_web1', {
    role: 'assistant',
    text: 'A south-facing roof in Leeds suits solar well. Shall I have the team get in touch?',
    at: new Date(NOW).toISOString(),
    channel: 'chat',
  });
  const followUp = new LeadFollowUp({
    store,
    state,
    mailbox: async () => mailbox,
    provider: async () => provider,
    now: () => NOW,
  });
  return { store, state, mailbox, followUp };
}

const writer = () =>
  new ScriptedProvider((request: ChatTurnRequest) => [
    {
      type: 'text',
      text: request.message.includes('3-bed semi')
        ? 'Thank you for chatting with us about your 3-bed semi in Leeds — it sounds a great fit. We would love to book a free survey.'
        : 'Thank you.',
    },
  ]);

describe('lead follow-up email', () => {
  it('drafts an email to the visitor in the connected mailbox, from the conversation', async () => {
    const provider = writer();
    const { followUp, mailbox, state } = await setup(provider);

    const link = await followUp.draft({ tenant: tenant(), lead: lead() });

    expect(link?.outcome).toBe('drafted');
    expect(link?.provider).toBe('gmail');
    expect(link?.webLink).toContain('mail.google.com');
    expect(mailbox.drafts).toHaveLength(1);
    const draft = mailbox.drafts[0]!;
    expect(draft.to).toBe('sarah@customer.example');
    expect(draft.subject).toBe('Your solar enquiry with Northwind Solar');
    expect(draft.raw).toContain('To: sarah@customer.example');
    // Greeted by first name, signed as the installer set, and no em dashes.
    expect(draft.text).toMatch(/^Hello Sarah,/);
    expect(draft.text).toContain('Priya at Northwind Solar');
    expect(draft.text).not.toContain('—');
    // The model saw the conversation and the lead, and was given no tools.
    expect(provider.lastRequest?.message).toContain('Visitor: We have a 3-bed semi');
    expect(provider.lastRequest?.tools).toEqual([]);
    // The prompt suits any kind of quote, solar or heat pump.
    expect(provider.lastRequest?.systemInstruction).toContain('a UK home energy installer');
    expect(provider.lastRequest?.systemInstruction).not.toContain('solar installer');
    // The inbox can show it beside the web conversation.
    expect((await state.getThread(DEMO_TENANT.id, 'sess_web1'))?.draftText).toBe(draft.text);
  });

  it('writes one email per conversation, however many leads it files', async () => {
    const { followUp, mailbox } = await setup(writer());
    await followUp.draft({ tenant: tenant(), lead: lead() });
    const second = await followUp.draft({ tenant: tenant(), lead: lead({ id: 'lead_2' }) });
    expect(second).toBeNull();
    expect(mailbox.drafts).toHaveLength(1);
  });

  it('writes nothing without the add-on, an email address or consent', async () => {
    const { followUp, mailbox } = await setup(writer());
    expect(await followUp.draft({ tenant: tenant({ web_chat: true }), lead: lead() })).toBeNull();
    expect(await followUp.draft({ tenant: tenant(), lead: lead({ email: null }) })).toBeNull();
    expect(
      await followUp.draft({ tenant: tenant(), lead: lead({ email: 'not an address' }) }),
    ).toBeNull();
    const { consent: _consent, ...withoutConsent } = lead();
    expect(await followUp.draft({ tenant: tenant(), lead: withoutConsent })).toBeNull();
    expect(mailbox.drafts).toHaveLength(0);
  });

  it('leaves leads from an email thread to the reply drafted there', async () => {
    const { followUp, mailbox } = await setup(writer());
    expect(
      await followUp.draft({
        tenant: tenant(),
        lead: lead({ sessionId: 'em_0123456789abcdef01234567' }),
      }),
    ).toBeNull();
    expect(mailbox.drafts).toHaveLength(0);
  });

  it('falls back to a plain template when the model is unavailable', async () => {
    const failing: ChatProvider = {
      kind: 'failing',
      model: null,
      // eslint-disable-next-line require-yield -- it fails before yielding anything
      async *stream() {
        throw new Error('model down');
      },
    };
    const { followUp, mailbox } = await setup(failing);
    const link = await followUp.draft({ tenant: tenant(), lead: lead() });
    expect(link?.notes.join(' ')).toMatch(/template/);
    expect(mailbox.drafts[0]?.text).toContain('LS6 2AB');
  });

  it('words the subject and template for the kind of enquiry', async () => {
    const failing: ChatProvider = {
      kind: 'failing',
      model: null,
      // eslint-disable-next-line require-yield -- it fails before yielding anything
      async *stream() {
        throw new Error('model down');
      },
    };
    const cases = [
      {
        workflowId: undefined,
        subject: 'Your solar enquiry with Northwind Solar',
        about: 'about solar for your home in LS6 2AB',
        survey: 'confirm the right system for your roof',
      },
      {
        workflowId: 'wf_heat_pump',
        subject: 'Your heat pump enquiry with Northwind Solar',
        about: 'about a heat pump for your home in LS6 2AB',
        survey: 'work out the heat loss room by room',
      },
      {
        workflowId: 'wf_battery',
        subject: 'Your home battery enquiry with Northwind Solar',
        about: 'about a battery for your solar panels in LS6 2AB',
        survey: 'check your solar system, inverter and consumer unit',
      },
    ];
    for (const c of cases) {
      const { followUp, mailbox } = await setup(failing);
      await followUp.draft({
        tenant: tenant(),
        lead: lead(c.workflowId ? { workflowId: c.workflowId } : {}),
      });
      const draft = mailbox.drafts[0]!;
      expect(draft.subject).toBe(c.subject);
      expect(draft.text).toContain(c.about);
      expect(draft.text).toContain(c.survey);
      expect(draft.text).not.toMatch(/[–—]/);
      if (c.workflowId === 'wf_heat_pump') {
        // Nothing solar about it, beyond the installer's own name.
        expect(draft.text.replaceAll('Northwind Solar', '')).not.toMatch(/solar|roof|shading/i);
        expect(draft.text).toContain('subject to an on-site heat loss survey.');
      }
      if (c.workflowId === 'wf_battery') {
        expect(draft.text).toContain('an on-site survey of your solar system and electrics.');
        expect(draft.text).not.toContain('shading');
      }
      if (!c.workflowId) {
        // Solar keeps the standard footer, word for word.
        expect(draft.text).toContain(EMAIL_DISCLAIMER_FOOTER);
      }
    }
  });

  it('takes the topic from the quote shown, then the workflow, then solar', () => {
    const t = tenant();
    const heatPumpQuote = { kind: 'heat_pump' } as unknown as StoredQuote;
    const batteryQuote = { kind: 'battery' } as unknown as StoredQuote;
    const solarQuote = {} as unknown as StoredQuote;
    expect(enquiryTopic(t, {}, heatPumpQuote)).toBe('heat_pump');
    expect(enquiryTopic(t, {}, batteryQuote)).toBe('battery');
    // A quote outranks the workflow it came through.
    expect(enquiryTopic(t, { workflowId: 'wf_heat_pump' }, solarQuote)).toBe('solar');
    expect(enquiryTopic(t, { workflowId: 'wf_battery' }, null)).toBe('battery');
    expect(enquiryTopic(t, { workflowId: 'wf_unknown' }, null)).toBe('solar');
    expect(enquiryTopic(t, {}, null)).toBe('solar');
    expect(followUpSubject('heat_pump', 'Acme')).toBe('Your heat pump enquiry with Acme');
  });

  it('includes the latest visitor message when the turn is not stored yet', () => {
    const text = transcriptFor([], 'My email is sarah@customer.example');
    expect(text).toBe('Visitor: My email is sarah@customer.example');
  });
});

describe('composeReply signature', () => {
  it('signs with the configured name, or the company team by default', () => {
    const base = {
      answer: 'Solar suits your roof.',
      companyName: 'Northwind Solar',
      senderName: null,
      sources: [],
    };
    expect(composeReply(base)).toContain('The Northwind Solar team');
    expect(composeReply({ ...base, signatureName: 'Priya at Northwind Solar' })).toContain(
      'Priya at Northwind Solar',
    );
  });
});
