import { z } from 'zod';

/**
 * A lead, submitted directly rather than through the conversation.
 *
 * `create_lead` already captures leads from inside a chat turn. This is the same
 * record for a host page that shows a form instead — a "request a callback" panel
 * on a page where the widget is closed, or a flow a visitor reaches without ever
 * opening the assistant. Both paths write the same `LeadRecord`, so an installer
 * reading the list does not have to care which one produced a given row.
 */

/**
 * Deliberately strict, and deliberately not `.email()`.
 *
 * `.email()` is Zod's regular expression, and it rejects addresses that are
 * genuinely deliverable — anything with a quoted local part, and some
 * internationalised forms. A false rejection here loses a real lead, which is a
 * worse failure than accepting an address that bounces. The format is validated
 * loosely and the truth is settled by whether the installer's mail arrives.
 */
const contactSchema = z.string().trim().min(1).max(320);

export const leadRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    /**
     * Must be exactly `true`. Not defaulted, not optional: a lead without the
     * visitor's agreement is a record the installer is not entitled to hold, so
     * the absence of consent has to be the thing that happens when a caller
     * simply omits it.
     */
    consent: z.literal(true),
    /**
     * The caller's idempotency key, for the submission as a whole.
     *
     * A form on a host page has no way to know whether a POST that timed out
     * reached us, so the visitor who presses submit twice -- or whose browser
     * retries -- can hand us one enquiry twice. Supplying a value here that stays
     * the same across retries of that one submission is what lets the route
     * recognise the second one as the first. It should be a fresh value for each
     * submission the visitor actually makes: reusing it for a different enquiry
     * is refused rather than guessed at.
     *
     * Optional, like `clientMessageId` on a turn: a caller that does not claim two
     * requests are one has told us nothing we may act on, and gets two rows.
     */
    clientLeadId: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().max(200).optional(),
    email: contactSchema.optional(),
    phone: contactSchema.optional(),
    postcode: z.string().trim().max(20).optional(),
    summary: z.string().trim().max(500).optional(),
  })
  .refine((value) => Boolean(value.email ?? value.phone), {
    // A lead with no way to reach anyone is a row the installer cannot act on.
    // Refusing it here means the visitor is told at the point they can still fix
    // it, rather than after the form appears to have succeeded.
    message: 'An email address or a phone number is required.',
    path: ['email'],
  });

export type LeadRequest = z.infer<typeof leadRequestSchema>;

/**
 * The answer to a lead submission.
 *
 * `duplicate` distinguishes a submission that was written from one that repeated
 * a key already on file. A caller that only cares that its enquiry is safely in
 * can ignore it -- the body is otherwise exactly what the first call returned,
 * `leadId` included, which is what makes a retry safe to send blindly. A caller
 * that wants to show the visitor "we already have this one" reads it.
 */
export const leadResponseSchema = z.object({
  leadId: z.string(),
  createdAt: z.string(),
  /** True when the key matched a lead already on file and nothing was written. */
  duplicate: z.boolean(),
});

export type LeadResponse = z.infer<typeof leadResponseSchema>;

/**
 * What was erased, reported back rather than answered with a bare body.
 *
 * Deletion is the one operation a caller cannot verify by reading afterwards --
 * a row that was removed looks exactly like a row that was never there -- so the
 * response names what went. `conversationId` is in it because a lead and its
 * transcript are erased together when the transcript belongs to that enquiry,
 * and `leadsDeleted` is how a conversation deletion reports the enquiries that
 * went with it. See `docs/DECISIONS.md`, D-44.
 */
export const deletionResponseSchema = z.object({
  deleted: z.literal(true),
  /** The lead that was named, or null when a conversation was. */
  leadId: z.string().nullable(),
  /** The conversation erased alongside it, or null when there was none. */
  conversationId: z.string().nullable(),
  /** How many leads went with a conversation. Zero for a lead deletion. */
  leadsDeleted: z.number(),
});

export type DeletionResponse = z.infer<typeof deletionResponseSchema>;
