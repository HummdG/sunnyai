import { z } from 'zod';

/**
 * Tenant and widget identifiers.
 *
 * `publicId` is what appears in the embed snippet. It is a lookup key, never a
 * credential: possessing it grants exactly one thing, the ability to open a
 * visitor session, and the server derives the tenant from it rather than
 * accepting a tenant id from the client.
 */
export const publicWidgetIdSchema = z
  .string()
  .regex(/^w_[a-z0-9]{10,40}$/, 'must look like w_ followed by 10-40 lowercase alphanumerics');
export type PublicWidgetId = z.infer<typeof publicWidgetIdSchema>;

export const tenantIdSchema = z.string().regex(/^t_[a-z0-9]{6,40}$/);
export type TenantId = z.infer<typeof tenantIdSchema>;

/** Where the launcher sits. Safe-area and viewport clamping is the client's job. */
export const widgetPositionSchema = z.enum([
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
]);
export type WidgetPosition = z.infer<typeof widgetPositionSchema>;

/**
 * Public widget configuration. Everything here is safe to serve to an anonymous
 * visitor on any origin; secrets and tenant-internal settings are not part of it.
 */
export const widgetConfigSchema = z.object({
  publicId: publicWidgetIdSchema,
  /** Display name of the installer, shown in the panel header. */
  companyName: z.string().min(1).max(120),
  /** One line of context under the company name. */
  tagline: z.string().max(200).nullable(),
  /** Brand colour as `#rrggbb`. Drives the theme preset nearest to it. */
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  position: widgetPositionSchema,
  /** Opening line in the panel, before the visitor has said anything. */
  greeting: z.string().min(1).max(300),
  /** Suggested prompts shown as chips. Capped so the panel cannot be spammed. */
  suggestions: z.array(z.string().min(1).max(120)).max(6),
  /** Animation intensity the tenant has chosen. */
  intensity: z.enum(['off', 'minimal', 'balanced', 'playful']),
  /** Whether the tenant has an entitlement for voice input. */
  voiceEnabled: z.boolean(),
});
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

/**
 * A visitor session.
 *
 * `sessionToken` is short-lived and scoped to one tenant and one conversation.
 * It is issued server-side against a public widget id and is not interchangeable
 * with any dashboard credential.
 *
 * There is deliberately **no `tenantId` here**, and the reason is the same one
 * that keeps the internal id out of a widget config: `t_...` is the string every
 * store key is built from, and this response goes to a browser -- an
 * unauthenticated caller who knows only a public id. Which tenant a session
 * belongs to is carried by the signed token, where it is not a string a page can
 * read and copy, and it is visible in what the token can read rather than in the
 * body. `scripts/verify-isolation.ts` asserts this against a running server.
 */
export const widgetSessionSchema = z.object({
  sessionId: z.string().min(1),
  sessionToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  /** The session that was resumed, if the visitor returned with a stored token. */
  resumed: z.boolean(),
});
export type WidgetSession = z.infer<typeof widgetSessionSchema>;

export const sessionRequestSchema = z.object({
  publicId: publicWidgetIdSchema,
  /**
   * The origin the script is running on, as the host reports it. The server
   * compares it with the tenant's authorised domains. Advisory, because a
   * browser can be told to lie; the real control is that the token it earns
   * grants only visitor-scoped reads.
   */
  origin: z.string().min(1).max(300),
  /** A previously issued token, to resume a conversation. */
  sessionToken: z.string().min(1).optional(),
});
export type SessionRequest = z.infer<typeof sessionRequestSchema>;
