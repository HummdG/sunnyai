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
    return claims;
  } catch {
    return null;
  }
}
