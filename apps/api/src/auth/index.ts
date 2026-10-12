import { ApiError } from '@sunny/contracts';

import type { PortalConfig } from '../routes/portal-config.js';
import { MEMBER_ROLES, type MemberRole, type Membership, type Store } from '../store.js';
import { DEV_TOKEN_PREFIX, verifyDevToken } from './dev.js';
import { createFirebaseVerifier, type VerifiedIdentity } from './firebase.js';
import { identityFromSession, SESSION_PREFIX, verifySessionToken } from './session.js';

export type { VerifiedIdentity } from './firebase.js';

/**
 * Who is calling the portal, and what they may do in one installer's portal.
 *
 * Roles are resolved on the server on every request from the store's
 * memberships -- never from a claim the browser sends -- so removing a
 * colleague takes effect on their next request.
 */
export interface Authenticator {
  identify(authorization: string | undefined): Promise<VerifiedIdentity>;
}

export function createAuthenticator(options: {
  portal: PortalConfig;
  sessionSecret: string;
  now: () => number;
  fetch?: typeof fetch;
  /**
   * Where "sign out everywhere" is recorded. Without it a session token is
   * still verified (signature, expiry) but revocation cannot be checked, so
   * every route that accepts sessions passes the store.
   */
  store?: Pick<Store, 'getSessionEpoch'>;
}): Authenticator {
  const { portal, sessionSecret, now } = options;
  const firebase = portal.firebaseProjectId
    ? createFirebaseVerifier({
        projectId: portal.firebaseProjectId,
        emulator: portal.firebaseEmulator,
        now,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
    : null;

  return {
    async identify(authorization) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
      if (!match) throw new ApiError('unauthorized', 'Sign in to use the portal.');
      const token = match[1]!.trim();
      try {
        if (token.startsWith(SESSION_PREFIX)) {
          const claims = verifySessionToken(sessionSecret, token, now());
          if (options.store) {
            const epoch = await options.store.getSessionEpoch(claims.email);
            if (claims.iat < epoch) throw new Error('this session was signed out');
          }
          return identityFromSession(claims);
        }
        if (token.startsWith(DEV_TOKEN_PREFIX)) {
          if (!portal.devAuth) throw new Error('dev sign-in is disabled');
          return verifyDevToken(sessionSecret, token, now());
        }
        if (!firebase) throw new Error('no sign-in provider is configured');
        const identity = await firebase(token);
        if (!identity.email || !identity.emailVerified) {
          throw new Error('a verified email address is required');
        }
        return identity;
      } catch (error) {
        throw new ApiError(
          'unauthorized',
          `Your sign-in could not be verified: ${error instanceof Error ? error.message : 'invalid token'}.`,
        );
      }
    },
  };
}

/**
 * Verify a sign-in proof -- a Firebase ID token, or a dev token where dev
 * sign-in is on -- for exchange into a portal session. Session tokens are not
 * accepted here: a session is refreshed through its own route, so its
 * absolute lifetime is kept.
 */
export async function verifySignInProof(
  auth: Authenticator,
  proof: string,
): Promise<VerifiedIdentity> {
  if (proof.startsWith(SESSION_PREFIX)) {
    throw new ApiError('unauthorized', 'Sign in again to start a new session.');
  }
  return await auth.identify(`Bearer ${proof}`);
}

export function roleAtLeast(role: MemberRole, minimum: MemberRole): boolean {
  return MEMBER_ROLES.indexOf(role) >= MEMBER_ROLES.indexOf(minimum);
}

/**
 * The caller's membership of `tenantId`, or a refusal.
 *
 * Not-a-member and no-such-tenant are the same 404, so the portal cannot be
 * used to discover which tenant ids exist.
 */
export async function requireMembership(
  store: Store,
  identity: VerifiedIdentity,
  tenantId: string,
  minimum: MemberRole,
): Promise<Membership> {
  const email = identity.email;
  const membership = email
    ? (await store.listMembershipsByEmail(email)).find((m) => m.tenantId === tenantId)
    : undefined;
  if (!membership) throw new ApiError('not_found', 'No such installer.');
  if (!roleAtLeast(membership.role, minimum)) {
    throw new ApiError('forbidden', `This needs the ${minimum} role or above.`);
  }
  if (membership.userId === null) {
    // First sign-in of an invited colleague: bind the provider's user id.
    await store.putMembership({ ...membership, userId: identity.uid });
  }
  return membership;
}
