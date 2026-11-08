import { ApiError, badRequestFromZod } from '@sunny/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AccountLinkError, type AccountMailer } from '../auth/account-email.js';
import type { VerifiedIdentity } from '../auth/firebase.js';
import type { RateLimitRule } from '../ratelimit.js';

/**
 * POST /v1/auth/email -- send an account email (verify, reset, sign-in link,
 * confirm a new address) from the company's own mailbox (auth/account-email.ts).
 *
 * Unauthenticated for the two a signed-out person needs (reset, sign-in link)
 * and signed in with a Firebase ID token for the two about an account
 * (verify, change). The answer never says whether an address has an account:
 * a reset for an unknown address answers exactly like one for a known address.
 * `not_enabled` means this deployment does not send its own account emails,
 * and the website falls back to Firebase's.
 */

export interface AccountEmailRouteDeps {
  mailer: AccountMailer | null;
  /** The website's origin; a continue URL must stay on it. */
  siteUrl: string;
  /** Verifies a Firebase ID token, verified email or not. Null without Firebase. */
  verifyIdToken: ((token: string) => Promise<VerifiedIdentity>) | null;
  /** Counts one request and throws `rate_limited` once the budget is spent. */
  enforceRateLimit: (
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    subject: string,
    rule: RateLimitRule,
  ) => void;
}

/** Per address: enough to resend, not enough to bomb an inbox. */
const PER_ADDRESS: RateLimitRule = { limit: 5, windowMs: 60 * 60_000 };
/**
 * Across everyone. The website's proxy calls this route, so the API sees the
 * proxy's address rather than the visitor's; a ceiling on the whole route keeps
 * a script from spending the mailbox's daily Gmail sending quota.
 */
const OVERALL: RateLimitRule = { limit: 300, windowMs: 60 * 60_000 };

const bodySchema = z.object({
  kind: z.enum(['verifyEmail', 'resetPassword', 'signIn', 'changeEmail']),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  newEmail: z.string().trim().toLowerCase().email().max(254).optional(),
  idToken: z.string().min(1).max(4096).optional(),
  continueUrl: z.string().url().max(2048),
});

export function registerAccountEmailRoutes(app: FastifyInstance, deps: AccountEmailRouteDeps) {
  const site = new URL(deps.siteUrl).origin;

  app.post('/v1/auth/email', async (request, reply) => {
    deps.enforceRateLimit(request, reply, 'account-email', 'all', OVERALL);
    if (!deps.mailer) {
      throw new ApiError('not_enabled', 'This deployment does not send its own account emails.');
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) throw badRequestFromZod(parsed.error);
    const body = parsed.data;
    if (new URL(body.continueUrl).origin !== site) {
      throw new ApiError('bad_request', 'The continue URL must be on this website.');
    }

    let email: string;
    if (body.kind === 'verifyEmail' || body.kind === 'changeEmail') {
      if (!body.idToken || !deps.verifyIdToken) {
        throw new ApiError('unauthorized', 'Sign in again to send this email.');
      }
      const identity = await deps.verifyIdToken(body.idToken).catch(() => {
        throw new ApiError('unauthorized', 'Sign in again to send this email.');
      });
      if (!identity.email) throw new ApiError('unauthorized', 'This account has no email address.');
      email = identity.email.toLowerCase();
      if (body.kind === 'verifyEmail' && identity.emailVerified) return reply.code(204).send();
      if (body.kind === 'changeEmail' && !body.newEmail) {
        throw new ApiError('bad_request', 'Give the new email address.');
      }
    } else {
      if (!body.email) throw new ApiError('bad_request', 'Give an email address.');
      email = body.email;
    }
    const recipient = body.kind === 'changeEmail' ? body.newEmail! : email;
    deps.enforceRateLimit(request, reply, 'account-email-to', recipient, PER_ADDRESS);

    try {
      await deps.mailer.send({
        kind: body.kind,
        email,
        ...(body.newEmail ? { newEmail: body.newEmail } : {}),
        continueUrl: body.continueUrl,
      });
    } catch (error) {
      // An unknown address answers like a known one: no account enumeration.
      if (
        error instanceof AccountLinkError &&
        /EMAIL_NOT_FOUND|USER_NOT_FOUND/.test(error.reason)
      ) {
        return reply.code(204).send();
      }
      if (error instanceof AccountLinkError && /EMAIL_EXISTS/.test(error.reason)) {
        throw new ApiError('bad_request', 'That email address is already in use.');
      }
      request.log.error({ err: error, kind: body.kind }, 'account email failed');
      throw new ApiError('upstream_failed', 'The email could not be sent. Please try again.');
    }
    return reply.code(204).send();
  });
}
