import { z } from 'zod';

/**
 * What a visitor agreed to, and where.
 *
 * §4 asks for "consent provenance, source, timestamps". The first two are the
 * hard ones, because both are things a caller can claim and neither can be
 * proven from inside this server. So the rule here is: record only what the
 * server itself observed, and where the server cannot know, record `null` rather
 * than a string the caller handed over. Two consequences follow, and both are
 * deliberate:
 *
 *   - **The wording is named, not quoted.** `version` points into
 *     `CONSENT_WORDINGS`, which this repository owns, so a record from two years
 *     ago still resolves to the exact sentence the visitor saw. A field carrying
 *     the text the caller *said* it showed would be a place for arbitrary strings
 *     to enter a lead -- and the server has no way to check the claim anyway.
 *   - **The origin is the session's, not the body's.** It is the `origin` the
 *     session was opened with, carried in the signed token, so a caller cannot
 *     change it afterwards. See `sessions.ts`.
 *
 * What is *not* here: a timestamp. A lead is not written without consent -- the
 * request schema requires `consent: true` and the tools refuse without it -- so
 * the record's `createdAt` is the moment consent was asserted, and a second field
 * holding the same instant would be a second thing free to disagree.
 */

/**
 * The consent wordings this deployment has used, newest last.
 *
 * Kept as a map rather than a single constant because the point of a version is
 * that the old ones stay readable: a lead filed under `2026-10-01` is only
 * evidence of anything if that sentence can still be produced years later.
 * Changing the live wording therefore means adding a key and moving
 * `CONSENT_VERSION`, never editing the text under an existing key -- which is
 * what makes the version a version rather than a label.
 */
export const CONSENT_WORDINGS = {
  '2026-10-01':
    'I agree that my details may be passed to the installer so they can contact me about my enquiry.',
} as const;

export type ConsentVersion = keyof typeof CONSENT_WORDINGS;

/** The wording in force. Every new lead records this; old ones keep their own. */
export const CONSENT_VERSION: ConsentVersion = '2026-10-01';

/**
 * How the enquiry reached the server.
 *
 * Whether the person told the assistant, or filled in a form on a page where the
 * widget was closed. The distinction matters when the two are read back
 * together: a `widget` lead came out of a conversation that can be read for the
 * context of the agreement, and a `form` lead did not.
 */
export const CONSENT_SURFACES = ['widget', 'form'] as const;
export const consentSurfaceSchema = z.enum(CONSENT_SURFACES);
export type ConsentSurface = z.infer<typeof consentSurfaceSchema>;

export const leadConsentSchema = z.object({
  /** Which wording was in force. See `CONSENT_WORDINGS`. */
  version: z.string(),
  surface: consentSurfaceSchema,
  /**
   * The page origin the session was opened from, as the server accepted it, or
   * null when the session named none.
   *
   * A header- and body-independent value: it is a signed claim minted when the
   * session opened, so it survives a caller's later request but cannot be
   * changed by one. Null is common and is not an error -- see `sessions.ts` for
   * why the origin is optional there in the first place.
   */
  origin: z.string().nullable(),
});

export type LeadConsent = z.infer<typeof leadConsentSchema>;

/** The wording for a version, or null for one this build does not know. */
export function consentWording(version: string): string | null {
  return (CONSENT_WORDINGS as Record<string, string>)[version] ?? null;
}
