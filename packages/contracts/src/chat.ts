import { z } from 'zod';

import { pageActionSchema, toolNameSchema } from './events.js';
import { sunscanStatusSchema, sunscanSummarySchema } from './sunscan.js';

/**
 * A single turn's role. `system` never crosses the wire: system instructions are
 * composed server-side and are not part of any client-visible payload.
 */
export const messageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: messageRoleSchema,
  text: z.string(),
  createdAt: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * The client's send payload.
 *
 * `clientMessageId` is required so retries are idempotent: the server records the
 * id with the message it produced and replays the same result rather than
 * generating a second answer for a request the browser sent twice.
 */
export const chatRequestSchema = z.object({
  sessionId: z.string().min(1),
  clientMessageId: z.string().min(1).max(120),
  text: z.string().min(1).max(4000),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ─── the streaming response ──────────────────────────────────────────────────

/**
 * Server-sent event payloads, in the order a normal turn produces them:
 *
 *   message_started → (text_delta | tool_started/tool_finished)* → message_finished → done
 *
 * `text_delta` is the only event carrying prose. Everything else carries an
 * identifier the client already knows how to draw, which is what keeps the
 * model's output from becoming client behaviour.
 */
const base = { messageId: z.string().min(1) };

/** One quote option, as a card. */
export const quoteOptionCardSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  isRecommended: z.boolean(),
  headline: z.string().max(200),
  panelCount: z.number().int().nonnegative(),
  systemKwp: z.number().nonnegative(),
  batteryType: z.string().max(120).nullable(),
  batteryCapacityKwh: z.number().nonnegative(),
  priceGbp: z.number().nonnegative().nullable(),
  priceLabel: z.string().max(120),
  annualGenerationKwh: z.number().nonnegative(),
  annualSavingsGbp: z.number(),
  paybackYears: z.number().nonnegative().nullable(),
  /** Even this option costs more than the budget the visitor gave. */
  aboveBudget: z.boolean().optional(),
  /** Sized by the roof's space rather than by the visitor's use. */
  roofLimited: z.boolean().optional(),
  /**
   * Items in this option the installer prices themselves (bespoke or not on
   * the price list), by label -- shown as such rather than given a figure.
   */
  installerPriced: z.array(z.string().max(120)).max(10).optional(),
  /** The installer's Sentinel optimisation uplift, when it offers one (indicative). */
  sentinel: z
    .object({
      upliftPercent: z.number().nonnegative(),
      annualSavingsGbp: z.number(),
      paybackYears: z.number().nonnegative().nullable(),
    })
    .optional(),
});

/** The quote the journey presented, compact enough for a stream frame. */
export const quoteCardSchema = z.object({
  quoteId: z.string().min(1).max(60),
  priced: z.boolean(),
  options: z.array(quoteOptionCardSchema).max(3),
  disclaimer: z.string().min(1).max(600),
  /** A PDF proposal can be downloaded for this quote. */
  proposalAvailable: z.boolean().optional(),
  /** The quote can be emailed to the visitor (outbound email is configured). */
  emailAvailable: z.boolean().optional(),
});

export type QuoteCard = z.infer<typeof quoteCardSchema>;

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message_started'), ...base }),
  z.object({ type: z.literal('text_delta'), ...base, text: z.string() }),
  z.object({
    type: z.literal('tool_started'),
    ...base,
    tool: toolNameSchema,
  }),
  z.object({
    type: z.literal('tool_finished'),
    ...base,
    tool: toolNameSchema,
    ok: z.boolean(),
  }),
  z.object({
    type: z.literal('recommendation_ready'),
    ...base,
    recommendationId: z.string().min(1),
  }),
  z.object({
    type: z.literal('lead_saved'),
    ...base,
    leadId: z.string().min(1),
  }),
  // The assistant has asked for a person to take over. The client shows this and
  // moves the character to a resting state; it does not close the conversation,
  // because the visitor may keep talking while they wait.
  z.object({
    type: z.literal('handoff_requested'),
    ...base,
    reason: z.string().max(500),
  }),
  z.object({
    type: z.literal('page_action_suggested'),
    ...base,
    action: pageActionSchema,
    /** A key the HOST resolves; never a selector or a URL. */
    target: z.string().min(1).max(120),
  }),
  z.object({
    type: z.literal('message_finished'),
    ...base,
    /** Token accounting, so per-tenant cost dashboards have real inputs. */
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .optional(),
  }),
  // The installer's documents the answer cites, as `[S1]`-style markers in the
  // text refer to them. Only sources the answer actually cited are listed, so a
  // link never claims to back a sentence it did not. Titles and links only --
  // never passage text, which is the installer's upload and stays server-side.
  z.object({
    type: z.literal('sources'),
    ...base,
    sources: z
      .array(
        z.object({
          /** The marker the text uses, e.g. `S1`. */
          ref: z.string().min(1).max(8),
          title: z.string().min(1).max(200),
          /** An http(s) page or Drive link, or null for an uploaded document. */
          url: z.string().url().max(2000).nullable(),
          chunkId: z.string().min(1).max(200),
        }),
      )
      .max(8),
  }),
  // A fixed, server-authored notice the client shows under the answer -- the
  // Blueprint §4.4 non-binding disclaimer on any savings or system-size
  // estimate. Never model text.
  z.object({
    type: z.literal('disclaimer'),
    ...base,
    kind: z.enum(['estimate']),
    text: z.string().min(1).max(400),
  }),
  // The conversation needs a person at the installer: a safety concern triaged
  // by the server before any model call. The text of the reply arrives as a
  // normal `text_delta`; this tells the client (and the inbox) why.
  z.object({
    type: z.literal('escalation'),
    ...base,
    kind: z.enum(['safety']),
  }),
  // A SunScan roof assessment the assistant started: its id and state, and the
  // compact summary once there is one. The client shows a roof card and, on
  // request, the 3D model fetched by id with the visitor's own session token.
  z.object({
    type: z.literal('sunscan'),
    ...base,
    assessmentId: z.string().min(1),
    status: sunscanStatusSchema,
    summary: sunscanSummarySchema.nullable(),
  }),
  // Three quote options from the quote journey (apps/api/src/journey): what the
  // widget shows as option cards. Every figure is indicative; `disclaimer`
  // says so in words and the card shows it. Prices are null when the installer
  // has no price list yet.
  z.object({
    type: z.literal('quote'),
    ...base,
    quote: quoteCardSchema,
  }),
  // A turn can fail after the stream has already opened. The client needs to be
  // told in-band, because it can no longer rely on the HTTP status.
  z.object({
    type: z.literal('error'),
    ...base,
    code: z.string().min(1),
    message: z.string(),
  }),
  z.object({ type: z.literal('done'), ...base }),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
export type ChatStreamEventType = ChatStreamEvent['type'];
