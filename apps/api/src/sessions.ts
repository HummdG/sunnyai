import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Session tokens.
 *
 * A widget session is anonymous: no login, no cookie, nothing that survives the
 * visitor leaving the page. The token exists so the server can recognise a
 * conversation it started, and so a session cannot be adopted by guessing an id.
 *
 * Signed rather than stored, because the API runs on Cloud Run with more than
 * one instance: an in-memory session table would work perfectly in development
 * and drop every other request in production.
 */

export interface SessionClaims {
  sessionId: string;
  tenantId: string;
  /** Unix milliseconds. */
  expiresAt: number;
  /**
   * The page origin the session was opened from, as it was accepted at the time.
   *
   * Null is a real answer rather than a gap, though this build has one route that
   * only ever names an origin: `POST /v1/widget/session` requires one, because a
   * widget that cannot say where it is embedded cannot be judged against the
   * allowed origins. Null therefore arrives two ways -- a token signed before
   * this field existed (which is why it is optional), and any future caller that
   * opens a session naming nowhere. A token is signed rather than stored, so an
   * origin not claimed at issue time cannot be added later.
   *
   * It is in the *token* rather than looked up per request for one reason: a
   * later request is not evidence of where the page was. Once it is inside the
   * signed claims it is fixed for the life of the session -- the caller can carry
   * it, and cannot alter it -- which is what makes it usable as consent
   * provenance (D-44) rather than as another header a caller writes.
   *
   * Optional in the type as well as at runtime, because tokens signed before this
   * field existed must keep verifying: a visitor mid-conversation across a deploy
   * should not be signed out by a field being added.
   */
  origin?: string | null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export function issueSessionToken(claims: SessionClaims, secret: string): string {
  const body = b64url(JSON.stringify(claims));
  return `${body}.${sign(body, secret)}`;
}

/**
 * Verify a token. Returns null for anything that is not a live token this server
 * issued -- wrong signature, wrong shape, expired, or simply absent. Callers
 * turn null into `unauthorized`; there is no path that treats an unverifiable
 * token as a valid one.
 */
export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now: number,
): SessionClaims | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Length must match before `timingSafeEqual`, which throws on a mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims;
    if (typeof claims.sessionId !== 'string' || typeof claims.tenantId !== 'string') return null;
    if (typeof claims.expiresAt !== 'number' || claims.expiresAt <= now) return null;
    // Absent is accepted, since tokens signed before the field existed must keep
    // working. Anything present that is not a string or null is not something
    // this server issued, so the token is refused rather than trusted loosely --
    // a claim the reader has to interpret is a claim an attacker gets to choose.
    if (
      claims.origin !== undefined &&
      claims.origin !== null &&
      typeof claims.origin !== 'string'
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
