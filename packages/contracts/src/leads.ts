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
