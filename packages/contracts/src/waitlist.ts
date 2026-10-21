import { z } from 'zod';

/**
 * The waitlist: installers asking to hear when Sunny opens to them.
 *
 * Deployment-wide rather than per tenant, because the person joining has no
 * tenant yet. The home page posts to `POST /v1/waitlist`; the operator reads the
 * list with the admin token (`GET /v1/waitlist`) and removes someone who asks
 * (`DELETE /v1/waitlist`). The consent wording is in `waitlist-wording.ts`, a
 * module with no dependencies, so the website's form can show it without
 * shipping zod to the browser.
 */
export {
  WAITLIST_CONSENT_VERSION,
  WAITLIST_CONSENT_WORDINGS,
  type WaitlistConsentVersion,
} from './waitlist-wording.js';

export const waitlistRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** The installer's business. Optional, so the form is one field for anyone in a hurry. */
  company: z.string().trim().max(120).optional(),
  /** The box the person ticked. Nothing is stored without it. */
  consent: z.literal(true),
});
export type WaitlistRequest = z.infer<typeof waitlistRequestSchema>;

export const waitlistEntrySchema = z.object({
  email: z.string(),
  company: z.string().nullable(),
  joinedAt: z.string(),
  consentVersion: z.string(),
  /** The page's origin, as the browser reported it, for the record of where they agreed. */
  origin: z.string().nullable(),
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

/**
 * The answer to a join. The same whether the address was new or already on the
 * list, so the endpoint cannot be used to find out who has joined.
 */
export const waitlistResponseSchema = z.object({ ok: z.literal(true) });
export type WaitlistResponse = z.infer<typeof waitlistResponseSchema>;

/** The operator removing someone who asked: `DELETE /v1/waitlist`. */
export const waitlistRemoveSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
