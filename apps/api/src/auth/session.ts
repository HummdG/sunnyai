import { createHmac, timingSafeEqual } from 'node:crypto';

import type { VerifiedIdentity } from './firebase.js';

/**
 * Sunny portal sessions.
 *
 * The website signs an installer in with Firebase (or dev sign-in locally),
 * then trades that proof for one of these: a short-lived token the API signs
 * with the deployment's session secret. The Next.js app keeps it in an
 * HttpOnly cookie and forwards it to the API through its same-origin proxy, so
 * no credential is ever readable by page script.
 *
 * Format: `ses.<base64url payload>.<base64url HMAC-SHA256>`. The payload says
 * who (`uid`, `email`), when it was issued (`iat`), when it expires (`exp`)
 * and when the person originally signed in (`auth`). A refresh re-issues the
 * token but keeps `auth`, so a session cannot be extended past
 * `MAX_SESSION_MS` without signing in again. "Sign out everywhere" moves a
 * per-user epoch forward; tokens issued before it are refused.
 */
export const SESSION_PREFIX = 'ses.';
/** How long one session token lives. The website refreshes it before then. */
export const SESSION_TTL_MS = 60 * 60 * 1000;
/** The longest a chain of refreshes may run before a fresh sign-in. */
export const MAX_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionClaims {
  uid: string;
  email: string;
  iat: number;
  exp: number;
  auth: number;
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', `sunny-session:${secret}`).update(body).digest('base64url');
}

export function issueSessionToken(
  secret: string,
  identity: { uid: string; email: string },
  now: number,
  authAt: number = now,
): { token: string; claims: SessionClaims } {
  const claims: SessionClaims = {
    uid: identity.uid,
    email: identity.email.toLowerCase(),
    iat: now,
    exp: Math.min(now + SESSION_TTL_MS, authAt + MAX_SESSION_MS),
    auth: authAt,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { token: `${SESSION_PREFIX}${body}.${sign(secret, body)}`, claims };
}

export class SessionError extends Error {}

export function verifySessionToken(secret: string, token: string, now: number): SessionClaims {
  if (!token.startsWith(SESSION_PREFIX)) throw new SessionError('not a session token');
  const [body, signature, extra] = token.slice(SESSION_PREFIX.length).split('.');
  if (!body || !signature || extra !== undefined) throw new SessionError('malformed session');
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new SessionError('bad session signature');
  }
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims;
  } catch {
    throw new SessionError('malformed session');
  }
  if (
    typeof claims.uid !== 'string' ||
    typeof claims.email !== 'string' ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number' ||
    typeof claims.auth !== 'number'
  ) {
    throw new SessionError('malformed session');
  }
  if (claims.exp <= now) throw new SessionError('session expired');
  if (claims.auth + MAX_SESSION_MS <= now) throw new SessionError('session expired');
  return claims;
}

export function identityFromSession(claims: SessionClaims): VerifiedIdentity {
  // A session is only ever issued for a verified email (see the portal's
  // session route), so it carries that verification forward.
  return { uid: claims.uid, email: claims.email, emailVerified: true };
}
