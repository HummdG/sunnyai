import { z } from 'zod';

import { pageActionSchema, toolNameSchema } from './events.js';

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
