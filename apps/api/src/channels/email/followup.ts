import { isEntitled } from '../../agent/channels.js';
import type { ChatProvider } from '../../agent/provider.js';
import type { QuoteRecord } from '../../journey/quote.js';
import type { ConversationTurn, LeadRecord, Store } from '../../store.js';
import type { Tenant } from '../../tenants.js';
import { composeReply } from './compose.js';
import { buildMime } from './mime.js';
import type { MailboxClient } from './providers.js';
import type { EmailStateStore, ThreadLink } from './state.js';

/**
 * The follow-up email for a lead from the website chat.
 *
 * A visitor who gives their email address and agrees to be contacted has told
 * the installer everything a first email needs: what their home is like, what
 * they asked, the quote they were shown. This writes that email -- addressed to
 * the visitor, in the installer's voice -- and leaves it as a draft in the
 * connected mailbox (or in Sunny, with no mailbox), the same human-in-the-loop
 * rule the email replies follow. Nothing is ever sent from here.
 *
 * One draft per conversation: a visitor who corrects their details mid-chat
 * files a second lead, and should not get a second email.
 */

export interface LeadFollowUpDeps {
  store: Store;
  state: EmailStateStore;
  /** The tenant's connected mailbox, or null when none is connected. */
  mailbox: (tenant: Tenant) => Promise<MailboxClient | null>;
  /** The model that writes the email; the template below stands in when it fails. */
  provider: () => Promise<ChatProvider>;
  now: () => number;
}

export interface LeadFollowUpInput {
  tenant: Tenant;
  lead: LeadRecord;
  /** The visitor's message in the turn that filed the lead, which may not be stored yet. */
  latestMessage?: string;
}

const EMAIL_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MAX_TRANSCRIPT_CHARS = 6000;
const MAX_TURNS = 24;

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

/** The conversation as plain lines, newest kept when it is long. */
export function transcriptFor(turns: readonly ConversationTurn[], latest?: string): string {
  const lines = turns
    .slice(-MAX_TURNS)
    .map((t) => `${t.role === 'user' ? 'Visitor' : 'Assistant'}: ${t.text.trim()}`)
    .filter((line) => !line.endsWith(':'));
  if (latest && !turns.some((t) => t.role === 'user' && t.text.trim() === latest.trim())) {
    lines.push(`Visitor: ${latest.trim()}`);
  }
  let text = lines.join('\n');
  if (text.length > MAX_TRANSCRIPT_CHARS) text = text.slice(-MAX_TRANSCRIPT_CHARS);
  return text;
}

/** The quote the visitor was shown, as facts the email may repeat and nothing more. */
export function quoteFacts(quote: QuoteRecord | null): string | null {
  if (!quote || quote.options.length === 0) return null;
  const chosen = quote.chosenOptionId ?? null;
  const lines = quote.options.map((o) => {
    const parts = [
      `${o.panelCount} panels (${o.systemKwp} kWp)`,
      o.batteryCapacityKwh > 0 ? `${o.batteryCapacityKwh} kWh battery` : null,
      o.priceGbp !== null ? `${gbp(o.priceGbp)} (${o.priceLabel})` : 'priced at survey',
      `about ${gbp(o.annualSavingsGbp)} saved a year`,
    ].filter(Boolean);
    const tags = [
      o.id === chosen ? 'the one they chose' : null,
      o.isRecommended ? 'recommended' : null,
    ].filter(Boolean);
    return `- ${o.label}: ${parts.join(', ')}${tags.length ? ` [${tags.join(', ')}]` : ''}`;
  });
  return [`Quote for ${quote.basis.postcode}:`, ...lines, quote.disclaimer].join('\n');
}

function instruction(tenant: Tenant): string {
  return [
    `You write a short follow-up email from ${tenant.config.companyName}, a UK solar installer, to a person who has just chatted with the website assistant and asked to be contacted.`,
    'Write only the body of the email in plain text: no subject line, no greeting line, no sign-off (the system adds those).',
    'In 2 to 4 short paragraphs: thank them, recap what they told us about their home and what they want, mention the quote options only if facts are given below, and propose the next step (a free survey or a call back at a time that suits them).',
    'Use only facts from the conversation and the quote facts. Never invent prices, savings, dates or promises. Figures are indicative and confirmed at survey.',
    'Warm and professional British English. Do not use em dashes. Do not use Markdown.',
  ].join('\n');
}

/** What is written when the model is unavailable: plain, and true. */
function templateBody(lead: LeadRecord, facts: string | null): string {
  return [
    `Thank you for chatting with us on our website${lead.postcode ? ` about solar for your home in ${lead.postcode}` : ''}. ${lead.summary.trim().replace(/\.?$/, '.')}`,
    facts
      ? 'We have kept a copy of the quote options you were shown. They are indicative, and a free survey confirms the right system and the final price.'
      : 'The next step is a free survey, where we confirm the right system for your roof and give you a firm price.',
    'Just reply to this email with a day and time that suits you, or let us know the best number to reach you on.',
  ].join('\n\n');
}

async function writeBody(
  provider: ChatProvider,
  tenant: Tenant,
  lead: LeadRecord,
  transcript: string,
  facts: string | null,
): Promise<string> {
  const message = [
    `Their name: ${lead.name ?? 'not given'}. Postcode: ${lead.postcode ?? 'not given'}.`,
    `What they want: ${lead.summary}`,
    facts ? `\n${facts}` : '',
    '\nThe conversation:',
    transcript || '(not available)',
  ].join('\n');
  let text = '';
  for await (const chunk of provider.stream({
    systemInstruction: instruction(tenant),
    history: [],
    message,
    tools: [],
    execute: () => Promise.reject(new Error('No tools in a follow-up email.')),
  })) {
    if (chunk.type === 'text') text += chunk.text;
  }
  return text.trim();
}

/** House style: no em dashes in anything a customer reads. */
function tidy(text: string): string {
  return text.replace(/\s*—\s*/g, ', ').replace(/\*\*/g, '');
}

export class LeadFollowUp {
  readonly #deps: LeadFollowUpDeps;

  constructor(deps: LeadFollowUpDeps) {
    this.#deps = deps;
  }

  /** Draft the follow-up for a website lead; null when this lead does not get one. */
  async draft({ tenant, lead, latestMessage }: LeadFollowUpInput): Promise<ThreadLink | null> {
    const { store, state, now } = this.#deps;
    if (!isEntitled(tenant, 'email')) return null;
    const to = lead.email?.trim() ?? '';
    if (!lead.consent || !EMAIL_ADDRESS.test(to)) return null;

    const conversation = await store.getConversation(tenant.id, lead.sessionId);
    // A lead from an email thread already has its reply drafted in that thread.
    if (
      lead.sessionId.startsWith('em_') ||
      conversation?.channel === 'email' ||
      conversation?.turns.some((t) => t.channel === 'email')
    ) {
      return null;
    }

    const at = new Date(now()).toISOString();
    const key = `followup:${lead.sessionId}`;
    if (await state.claim(tenant.id, key, at)) return null;

    try {
      const quotes = await store.listQuotes(tenant.id, lead.sessionId);
      const quote = quotes.at(-1) ?? null;
      const facts = quoteFacts(quote);
      const transcript = transcriptFor(conversation?.turns ?? [], latestMessage);

      let body = '';
      const notes = ['Follow-up to a website chat. Nothing is sent until you send it.'];
      try {
        body = await writeBody(await this.#deps.provider(), tenant, lead, transcript, facts);
      } catch {
        body = '';
      }
      if (!body) {
        body = templateBody(lead, facts);
        notes.push('Written from a template because the assistant was unavailable.');
      }

      const text = composeReply({
        answer: tidy(body),
        companyName: tenant.config.companyName,
        senderName: lead.name,
        sources: [],
        ...(tenant.config.email?.signatureName
          ? { signatureName: tenant.config.email.signatureName }
          : {}),
      });
      const subject = `Your solar enquiry with ${tenant.config.companyName}`;
      const mailbox = await this.#deps.mailbox(tenant);
      const from =
        (await state.getWatch(tenant.id))?.mailbox ?? tenant.config.email?.inboundAddress ?? '';
      const raw = buildMime({
        from: from || `${tenant.config.companyName} <no-reply@invalid>`,
        to,
        subject,
        text,
      });

      let draftId: string | null = null;
      let webLink: string | null = null;
      if (mailbox) {
        const draft = await mailbox.createDraft({
          raw,
          threadId: null,
          replyToProviderId: null,
          text,
          subject,
          to,
        });
        draftId = draft.draftId;
        webLink = draft.webLink;
      }

      const link: ThreadLink = {
        sessionId: lead.sessionId,
        provider: mailbox?.provider ?? 'none',
        draftId,
        webLink,
        sentMessageId: null,
        outcome: 'drafted',
        subject,
        at,
        draftText: text,
        notes,
      };
      await state.putThread(tenant.id, link);
      await state.finish(tenant.id, {
        key,
        outcome: 'drafted',
        reason: null,
        sessionId: lead.sessionId,
        draftId,
        at,
      });
      await state.addUsage(tenant.id, at.slice(0, 7), { processed: 1, drafts: 1 });
      return link;
    } catch (error) {
      await state.finish(tenant.id, {
        key,
        outcome: 'failed',
        reason: error instanceof Error ? error.message.slice(0, 200) : 'failed',
        sessionId: lead.sessionId,
        draftId: null,
        at,
      });
      throw error;
    }
  }
}
