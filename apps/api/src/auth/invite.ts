import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Team invitation links.
 *
 * Adding a colleague creates their membership straight away (keyed by email,
 * bound to their user id on first sign-in). The link is how they find it: a
 * signed token naming the installer and the invited email, valid for 14 days.
 * It grants nothing by itself -- accepting requires signing in as that email.
 */
const PREFIX = 'inv.';
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

function sign(secret: string, body: string): string {
  return createHmac('sha256', `sunny-invite:${secret}`).update(body).digest('base64url');
}

export interface InviteClaims {
  tenantId: string;
  email: string;
  exp: number;
}

export function issueInviteToken(
  secret: string,
  invite: { tenantId: string; email: string },
  now: number,
): string {
  const claims: InviteClaims = {
    tenantId: invite.tenantId,
    email: invite.email.toLowerCase(),
    exp: now + TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${PREFIX}${body}.${sign(secret, body)}`;
}

export function verifyInviteToken(secret: string, token: string, now: number): InviteClaims {
  if (!token.startsWith(PREFIX)) throw new Error('not an invitation');
  const [body, signature, extra] = token.slice(PREFIX.length).split('.');
  if (!body || !signature || extra !== undefined) throw new Error('malformed invitation');
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new Error('bad invitation signature');
  }
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as InviteClaims;
  if (typeof claims.tenantId !== 'string' || typeof claims.email !== 'string') {
    throw new Error('malformed invitation');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('invitation expired');
  return claims;
}
