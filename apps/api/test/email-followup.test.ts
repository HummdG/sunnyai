/* eslint-disable @typescript-eslint/require-await -- the fakes implement async interfaces and have nothing to await */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONSENT_VERSION } from '@sunny/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatProvider, ChatTurnRequest } from '../src/agent/provider.js';
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
