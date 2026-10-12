import { createHash } from 'node:crypto';

import type { KnowledgeChunk, KnowledgeIndex } from '@sunny/knowledge';

import type { TurnEvent } from '../../agent/agent.js';
import { assertEntitled } from '../../agent/channels.js';
import { fallbackLine } from '../../agent/prompt.js';
import type { ConversationTurn, Store } from '../../store.js';
import type { Tenant } from '../../tenants.js';
import { composeReply, stripFooter } from './compose.js';
import type { EmailAddonConfig } from './config.js';
import {
  isAutomated,
  looksLikeInjection,
  messageForCore,
  splitQuoted,
  type InboundEmail,
} from './inbound.js';
import { buildMime, replySubject, type MimeAttachment } from './mime.js';
import { decideSend, groundingConfidence } from './policy.js';
import {
  driveFileIdFromUrl,
  MAX_ATTACHMENT_BYTES,
  type DriveFiles,
  type GmailPushClient,
  type MailboxClient,
} from './providers.js';
import type { EmailOutcome, EmailStateStore, ThreadLink } from './state.js';

/**
 * The email channel adapter (Blueprint §5 Add-On 2).
 *
 * One inbound email becomes one turn of the shared core with
 * `channel: 'email'`, and the core's answer becomes a draft reply in the
 * installer's mailbox for a person to approve. What the core sees is the
 * current email and the thread it quotes -- nothing else from the mailbox,
 * because there is no code path that reads anything else (Blueprint "zero
 * inbox read-back"). The turn is stored like a chat turn with `channel:
 * 'email'`, so the installer's unified inbox shows it beside web chat and voice.
 */

/** What the core needs for one email turn. Matches `runTurn`'s inputs. */
export interface EmailCoreInput {
  tenant: Tenant;
  sessionId: string;
  conversationId: string | null;
  history: ConversationTurn[];
  standingAnswers?: Record<string, string>;
  message: string;
  clientMessageId: string;
  knowledge: KnowledgeIndex;
}

/** The headless core, as the email adapter calls it (`runTurn` with channel 'email'). */
export type EmailCore = (input: EmailCoreInput) => AsyncIterable<TurnEvent>;

export interface EmailAssistantDeps {
  store: Store;
  state: EmailStateStore;
  config: EmailAddonConfig;
  core: EmailCore;
  loadKnowledge: (tenantId: string) => Promise<KnowledgeIndex>;
  /** The tenant's connected mailbox, or null when none is connected. */
  mailbox: (tenant: Tenant) => Promise<(MailboxClient & Partial<GmailPushClient>) | null>;
  /** Drive access for spec-sheet attachments, when the tenant has any. */
  driveFiles?: (tenant: Tenant) => DriveFiles | null;
  now: () => number;
}

export interface EmailResult {
  outcome: EmailOutcome;
  reason: string | null;
  duplicate: boolean;
  sessionId: string | null;
  draftId: string | null;
  webLink: string | null;
  autoSent: boolean;
  confidence: number;
  intent: 'sales' | 'support' | null;
  escalated: boolean;
  attachments: string[];
}

const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_TOTAL = 15 * 1024 * 1024;

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function day(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function month(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** The key that makes a redelivered message recognisable. */
export function messageKey(email: InboundEmail): string {
  if (email.providerMessageId) return `${email.source}:${email.providerMessageId}`;
  if (email.messageId) return `mid:${email.messageId}`;
  return `hash:${sha([email.from.address, email.subject, email.date ?? '', email.text].join('\n')).slice(0, 32)}`;
}

/**
 * The session an email belongs to: one per thread, so a customer's follow-up
 * continues the same conversation in the inbox. The thread's root id comes from
 * the email's own threading headers; it is hashed with the tenant id, so two
 * tenants can never share a session even for the same thread.
 */
export function threadSessionId(tenantId: string, email: InboundEmail): string {
  const root =
    email.references[0] ??
    email.inReplyTo ??
    email.providerThreadId ??
    email.messageId ??
    messageKey(email);
  return `em_${sha(`${tenantId}\n${root}`).slice(0, 24)}`;
}

/** Addresses that belong to the installer: their mail is never answered. */
function ownAddresses(tenant: Tenant, extra: readonly (string | null | undefined)[]): Set<string> {
  return new Set(
    [tenant.config.email?.inboundAddress, tenant.config.supportContact?.email, ...extra]
      .filter((a): a is string => typeof a === 'string' && a.includes('@'))
      .map((a) => a.trim().toLowerCase()),
  );
}

export class EmailAssistant {
  readonly #deps: EmailAssistantDeps;

  constructor(deps: EmailAssistantDeps) {
    this.#deps = deps;
  }

  async handleInbound(tenant: Tenant, email: InboundEmail): Promise<EmailResult> {
    // Before anything is spent or stored: the add-on must be on the plan.
    assertEntitled(tenant, 'email');
    const { state, now } = this.#deps;
    const at = new Date(now()).toISOString();
    const key = messageKey(email);
    const empty: Omit<EmailResult, 'outcome' | 'reason'> = {
      duplicate: false,
      sessionId: null,
      draftId: null,
      webLink: null,
      autoSent: false,
      confidence: 0,
      intent: null,
      escalated: false,
      attachments: [],
    };

    const previous = await state.claim(tenant.id, key, at);
    if (previous) {
      return {
        ...empty,
        duplicate: true,
        outcome: previous.outcome === 'processing' ? 'skipped' : previous.outcome,
        reason: previous.outcome === 'processing' ? 'already being processed' : 'already processed',
        sessionId: previous.sessionId,
        draftId: previous.draftId,
      };
    }

    const skip = async (reason: string): Promise<EmailResult> => {
      await state.finish(tenant.id, {
        key,
        outcome: 'skipped',
        reason,
        sessionId: null,
        draftId: null,
        at,
      });
      await state.addUsage(tenant.id, month(now()), { skipped: 1 });
      return { ...empty, outcome: 'skipped', reason };
    };

    const automated = isAutomated(email);
    if (automated) return skip(`automated mail (${automated})`);
    const watch = await state.getWatch(tenant.id);
    if (ownAddresses(tenant, [watch?.mailbox]).has(email.from.address)) {
      return skip("the installer's own address");
    }
    const today = day(now());
    if (
      (await state.messagesToday(tenant.id, email.from.address, today)) >=
      this.#deps.config.dailySenderLimit
    ) {
      return skip('sender reached the daily message limit');
    }
    await state.recordMessage(tenant.id, email.from.address, today);

    try {
      return await this.#answer(tenant, email, key, at);
    } catch (error) {
      await state.finish(tenant.id, {
        key,
        outcome: 'failed',
        reason: error instanceof Error ? error.message.slice(0, 200) : 'failed',
        sessionId: null,
        draftId: null,
        at,
      });
      throw error;
    }
  }

  async #answer(
    tenant: Tenant,
    email: InboundEmail,
    key: string,
    at: string,
  ): Promise<EmailResult> {
    const { store, state, config, now } = this.#deps;
    const sessionId = threadSessionId(tenant.id, email);
    const existing = await store.getConversation(tenant.id, sessionId);
    const knowledge = await this.#deps.loadKnowledge(tenant.id);
    const message = messageForCore(email);
    const injectionSuspected = looksLikeInjection(`${email.subject}\n${email.text}`);

    let answer = '';
    let escalated = false;
    const tools: string[] = [];
    let sources: Array<{ title: string; url: string | null; chunkId: string }> = [];
    for await (const event of this.#deps.core({
      tenant,
      sessionId,
      conversationId: existing?.id ?? null,
      history: existing?.turns ?? [],
      ...(existing?.answers ? { standingAnswers: existing.answers } : {}),
      message,
      clientMessageId: `email:${key}`.slice(0, 200),
      knowledge,
    })) {
      if (event.type === 'message_finished') {
        answer = event.text;
        tools.push(...event.tools);
      } else if (event.type === 'escalation') {
        escalated = true;
      } else if (event.type === 'sources') {
        sources = event.sources;
      }
    }

    const conversation = await store.getConversation(tenant.id, sessionId);
    const intent = conversation?.intent ?? (escalated ? 'support' : null);
    const usedFallback = answer.includes(fallbackLine());
    const chunksById = new Map<string, KnowledgeChunk>(knowledge.chunks.map((c) => [c.id, c]));
    const citedChunks = sources
      .map((s) => chunksById.get(s.chunkId))
      .filter((c): c is KnowledgeChunk => c !== undefined);

    const reply = composeReply({
      answer,
      companyName: tenant.config.companyName,
      senderName: email.from.name,
      sources,
    });
    const { latest } = splitQuoted(email.text);
    const confidence = escalated
      ? 0
      : groundingConfidence({
          question: `${email.subject}\n${latest}`,
          answer: stripFooter(answer),
          cited: citedChunks.map((c) => ({ heading: c.heading, text: c.text })),
          tools,
        });

    const attachments = escalated ? [] : await this.#attachments(tenant, citedChunks);
    const mailbox = await this.#deps.mailbox(tenant);
    const from =
      (await state.getWatch(tenant.id))?.mailbox ?? tenant.config.email?.inboundAddress ?? '';
    const subject = replySubject(email.subject);
    const raw = buildMime({
      from: from || `${tenant.config.companyName} <no-reply@invalid>`,
      to: email.from.address,
      subject,
      text: reply,
      inReplyTo: email.messageId,
      references: email.references,
      attachments,
    });
    const send = {
      raw,
      threadId: email.providerThreadId,
      // Forwarded and Gmail mail carry no Graph message id, so an Outlook draft
      // is a new message with a "Re:" subject (see GraphMailClient).
      replyToProviderId: null,
      text: reply,
      subject,
      to: email.from.address,
    };

    const today = day(now());
    const decision = decideSend({
      autoSendEnabled: tenant.config.email?.autoSend === true,
      confidence,
      threshold: config.autoSendThreshold,
      autoRepliesToday: await state.autoRepliesToday(tenant.id, email.from.address, today),
      cap: config.autoReplyCapPerSender,
      escalated,
      usedFallback,
      injectionSuspected,
      canSend: mailbox !== null,
    });

    let outcome: EmailOutcome = 'drafted';
    let draftId: string | null = null;
    let webLink: string | null = null;
    let sentMessageId: string | null = null;
    if (decision.send && mailbox) {
      sentMessageId = (await mailbox.send(send)).messageId;
      outcome = 'sent';
      await state.recordAutoReply(tenant.id, email.from.address, today);
    } else if (mailbox) {
      const draft = await mailbox.createDraft(send);
      draftId = draft.draftId;
      webLink = draft.webLink;
    }
    // With no mailbox connected (forwarded mail only), the reply is still drafted
    // -- held in Sunny for the installer to copy from the inbox.

    const reason = decision.send ? null : decision.reason;
    const link: ThreadLink = {
      sessionId,
      provider: mailbox?.provider ?? 'none',
      draftId,
      webLink,
      sentMessageId,
      outcome,
      subject,
      at,
      draftText: reply,
      notes: [
        ...(injectionSuspected
          ? ['The email looked like it tried to instruct the assistant; check the reply.']
          : []),
        ...(escalated ? ['Safety escalation: the customer reported a possible hazard.'] : []),
        ...(usedFallback
          ? ['The answer was not in the knowledge base; a specialist should follow up.']
          : []),
        ...(reason ? [`Not sent automatically: ${reason}.`] : []),
      ],
    };
    await state.putThread(tenant.id, link);
    await state.finish(tenant.id, { key, outcome, reason, sessionId, draftId, at });
    await state.addUsage(tenant.id, month(now()), {
      processed: 1,
      ...(outcome === 'sent' ? { autoSends: 1 } : { drafts: 1 }),
    });

    return {
      outcome,
      reason,
      duplicate: false,
      sessionId,
      draftId,
      webLink,
      autoSent: outcome === 'sent',
      confidence,
      intent,
      escalated,
      attachments: attachments.map((a) => a.filename),
    };
  }

  /** PDF spec sheets from the installer's Drive for the passages the reply cited. */
  async #attachments(tenant: Tenant, cited: readonly KnowledgeChunk[]): Promise<MimeAttachment[]> {
    const drive = this.#deps.driveFiles?.(tenant) ?? null;
    if (!drive) return [];
    const ids = [
      ...new Set(
        cited.map((c) => driveFileIdFromUrl(c.url)).filter((id): id is string => id !== null),
      ),
    ];
    const out: MimeAttachment[] = [];
    let total = 0;
    for (const id of ids.slice(0, MAX_ATTACHMENTS)) {
      try {
        const file = await drive.downloadPdf(id);
        if (!file || file.data.length > MAX_ATTACHMENT_BYTES) continue;
        if (total + file.data.length > MAX_ATTACHMENT_TOTAL) break;
        total += file.data.length;
        out.push(file);
      } catch {
        // A spec sheet that cannot be fetched is left out; the reply still goes
        // to the installer, who can attach it by hand.
      }
    }
    return out;
  }

  /**
   * A Gmail push: fetch only the messages it reports as newly added to the
   * inbox, answer each, and advance the cursor.
   */
  async handlePush(tenant: Tenant, _pushedHistoryId: string): Promise<EmailResult[]> {
    assertEntitled(tenant, 'email');
    const { state } = this.#deps;
    const watch = await state.getWatch(tenant.id);
    if (!watch) return [];
    const client = await this.#deps.mailbox(tenant);
    if (!client?.newInboxMessageIds || !client.getMessage) return [];
    const { parseGmailMessage } = await import('./inbound.js');
    const { ids, historyId: next } = await client.newInboxMessageIds(watch.historyId);
    const results: EmailResult[] = [];
    for (const id of ids) {
      const message = await client.getMessage(id);
      const labels = message.labelIds ?? [];
      if (labels.includes('SENT') || labels.includes('DRAFT')) continue;
      let email: InboundEmail;
      try {
        email = parseGmailMessage(message);
      } catch {
        continue;
      }
      results.push(await this.handleInbound(tenant, email));
    }
    // The cursor advances to what was actually listed -- not to the push's own
    // id, which could skip messages a capped listing has not reached yet -- and
    // never backwards. The push's own id only says there is something new.
    const cursor = BigInt(next) > BigInt(watch.historyId) ? next : watch.historyId;
    await state.putWatch(tenant.id, { ...watch, historyId: cursor });
    return results;
  }
}
