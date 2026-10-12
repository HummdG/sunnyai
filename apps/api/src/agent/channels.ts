import type { ToolName } from '@sunny/contracts';

import { hasEntitlement, type AddonKey } from '../entitlements.js';
import type { Tenant } from '../tenants.js';

/**
 * The channels the headless core serves (Blueprint §1): one engine, one
 * knowledge base, one guardrail set -- and a per-channel adapter that decides
 * which tools the model may call and what shape its answer must take.
 */
export const CHANNELS = ['chat', 'email', 'voice'] as const;
export type Channel = (typeof CHANNELS)[number];

/** The Blueprint §5 voice formatting rule, verbatim. */
export const VOICE_OUTPUT_RULE =
  'Respond in 1 to 2 concise spoken sentences (<40 words). Do not use markdown, bullet points, or raw URLs.';

/** The footer every email reply carries (Blueprint §5 matrix: legal disclaimer footer). */
export const EMAIL_DISCLAIMER_FOOTER =
  'This reply was prepared with the help of an AI assistant. Any prices, savings or system sizes ' +
  'mentioned are non-binding estimates and are subject to an on-site structural and shading survey.';

export interface ChannelPolicy {
  /** Any one of these entitles the tenant to the channel. */
  entitlements: readonly AddonKey[];
  /** The tools the model may call on this channel. Everything else is refused. */
  tools: readonly ToolName[];
  /** Appended to the system instructions: how the answer must be shaped. */
  outputRule: string;
}

/**
 * The Blueprint §5 permission matrix. The Blueprint's `capture_lead` is
 * `create_lead` here (with `request_callback` for a visitor who wants a call
 * back instead of a quote); the names differ, the tool does not.
 *
 * Chat keeps the read-only tools the product already had -- knowledge,
 * questionnaire, catalogue, recommendation, SunScan -- because they are what a
 * grounded answer is built from. None of them writes anything but the lead and
 * the visitor's own answers (Blueprint §4.1).
 */
export const CHANNEL_POLICIES: Readonly<Record<Channel, ChannelPolicy>> = {
  chat: {
    entitlements: ['web_chat'],
    tools: [
      'retrieve_knowledge',
      'get_questionnaire',
      'save_answer',
      'search_catalogue',
      'validate_compatibility',
      'recommend_packages',
      'calculate_approved_estimate',
      'estimate_savings',
      'start_sunscan_assessment',
      'get_sunscan_result',
      'get_quote_journey',
      'save_answers',
      'get_quote_options',
      'create_lead',
      'request_callback',
      'handoff_to_human',
      'suggest_page_action',
    ],
    outputRule:
      'Format answers in short Markdown. When a sentence relies on a passage from <verified_context> or retrieve_knowledge, cite it with its marker, e.g. [S1].',
  },
  voice: {
    entitlements: ['voice_widget', 'phone_agent'],
    tools: ['retrieve_knowledge', 'create_lead', 'transfer_to_human', 'send_sms_link'],
    outputRule: VOICE_OUTPUT_RULE,
  },
  email: {
    entitlements: ['email_assistant'],
    tools: ['retrieve_knowledge', 'create_lead', 'create_gmail_draft'],
    outputRule:
      'Write a formal, courteous email reply in plain text: a greeting, a concise answer, and a sign-off from the team. Do not add a legal footer; the system adds it.',
  },
};

/** A tenant tried to use a channel it has not paid for. */
export class NotEntitledError extends Error {
  readonly channel: Channel;
  constructor(channel: Channel) {
    super(`The ${channel} channel is not part of this installer's plan.`);
    this.name = 'NotEntitledError';
    this.channel = channel;
  }
}

export function isEntitled(tenant: Tenant, channel: Channel): boolean {
  return CHANNEL_POLICIES[channel].entitlements.some((key) => hasEntitlement(tenant, key));
}

export function assertEntitled(tenant: Tenant, channel: Channel): void {
  if (!isEntitled(tenant, channel)) throw new NotEntitledError(channel);
}

/**
 * Enforce a channel's output policy on the finished answer.
 *
 * The model is told the rule; this is what holds when it does not follow it.
 * Voice strips Markdown and links and keeps to the word limit, because a
 * synthesiser reading "asterisk asterisk" or a URL aloud is the failure the
 * rule exists for. Email gets the footer appended by the system, so a model
 * cannot leave it out.
 */
export function finalizeOutput(channel: Channel, text: string): string {
  if (channel === 'voice') return toSpokenText(text);
  if (channel === 'email') return `${text.trimEnd()}\n\n--\n${EMAIL_DISCLAIMER_FOOTER}`;
  return text;
}

const VOICE_WORD_LIMIT = 40;

export function toSpokenText(text: string): string {
  const plain = text
    .replace(/\[S\d+\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = plain.split(' ').filter(Boolean);
  if (words.length <= VOICE_WORD_LIMIT) return plain;
  const cut = words.slice(0, VOICE_WORD_LIMIT).join(' ');
  return /[.!?]$/.test(cut) ? cut : `${cut.replace(/[,;:]$/, '')}.`;
}
