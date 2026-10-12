import { createHmac, timingSafeEqual } from 'node:crypto';

import type { VerifiedIdentity } from './firebase.js';

/**
 * Development sign-in: a magic-link-style token for local work and tests.
 *
 * DEVELOPMENT ONLY. Enabled with `SUNNY_DEV_AUTH=1` and refused outright when
 * `NODE_ENV=production` (see `portalConfig`). Anyone who can reach the dev-login
 * route can sign in as any email, which is exactly what a local portal and an
 * e2e suite need and exactly what a deployment must never offer.
 *
 * Tokens are `dev.<payload>.<hmac>` signed with the deployment's session secret,
 * so they cannot be confused with, or forged as, a Firebase ID token.
 */
export const DEV_TOKEN_PREFIX = 'dev.';
const TTL_MS = 12 * 60 * 60 * 1000;

function sign(secret: string, body: string): string {
  return createHmac('sha256', `sunny-dev-auth:${secret}`).update(body).digest('base64url');
}

export function issueDevToken(secret: string, email: string, now: number): string {
  const body = Buffer.from(
    JSON.stringify({ email: email.toLowerCase(), exp: now + TTL_MS }),
  ).toString('base64url');
  return `${DEV_TOKEN_PREFIX}${body}.${sign(secret, body)}`;
}

export function verifyDevToken(secret: string, token: string, now: number): VerifiedIdentity {
  if (!token.startsWith(DEV_TOKEN_PREFIX)) throw new Error('not a dev token');
  const [body, signature] = token.slice(DEV_TOKEN_PREFIX.length).split('.');
  if (!body || !signature) throw new Error('malformed dev token');
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new Error('bad dev token signature');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
    email: string;
    exp: number;
  };
  if (payload.exp <= now) throw new Error('dev token expired');
  return { uid: `dev:${payload.email}`, email: payload.email, emailVerified: true };
}
