import { createPublicKey, createVerify, X509Certificate } from 'node:crypto';

/**
 * Firebase Authentication ID-token verification, without the Admin SDK.
 *
 * The installer portal signs people in with Firebase Auth (plan §3.1); the API
 * verifies the ID token the browser sends on each request. The checks are the
 * ones Firebase documents for verifying with a third-party JWT library:
 * RS256, a `kid` from Google's published `securetoken` certificates, the project
 * as audience, `https://securetoken.google.com/<project>` as issuer, unexpired,
 * issued and authenticated in the past, and a non-empty subject.
 */

export const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export class TokenError extends Error {}

interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}

export interface FirebaseVerifierOptions {
  projectId: string;
  /**
   * Accept the Auth emulator's unsigned tokens (`alg: none`). Only ever set
   * from `FIREBASE_AUTH_EMULATOR_HOST` outside production (portal-config),
   * which is how the end-to-end suite signs real Firebase accounts in.
   */
  emulator?: boolean;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Clock skew tolerated on `iat` / `auth_time`, in seconds. */
const SKEW_S = 60;

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

export function createFirebaseVerifier(options: FirebaseVerifierOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  let cache: CertCache | null = null;

  async function certificates(): Promise<Record<string, string>> {
    if (cache && cache.expiresAt > now()) return cache.certs;
    const response = await fetchImpl(FIREBASE_CERTS_URL);
    if (!response.ok) throw new TokenError(`certificate fetch failed: ${response.status}`);
    const certs = (await response.json()) as Record<string, string>;
    // Google rotates the keys and says how long this set is good for.
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '');
    cache = { certs, expiresAt: now() + (maxAge ? Number(maxAge[1]) : 3600) * 1000 };
    return certs;
  }

  return async function verify(token: string): Promise<VerifiedIdentity> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new TokenError('malformed token');
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
    let header: { alg?: string; kid?: string };
    let payload: Record<string, unknown>;
    try {
      header = decodeSegment(headerB64) as typeof header;
      payload = decodeSegment(payloadB64) as Record<string, unknown>;
    } catch {
      throw new TokenError('malformed token');
    }
    if (options.emulator && header.alg === 'none') {
      // The emulator signs nothing; the claims below are still checked.
    } else {
      if (header.alg !== 'RS256') throw new TokenError('unexpected algorithm');
      const certs = await certificates();
      const pem = header.kid ? certs[header.kid] : undefined;
      if (!pem) throw new TokenError('unknown signing key');

      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${headerB64}.${payloadB64}`);
      // Google publishes X.509 certificates; a bare public key is accepted too,
      // which is what the tests sign against.
      const key = pem.includes('BEGIN CERTIFICATE')
        ? new X509Certificate(pem).publicKey
        : createPublicKey(pem);
      if (!verifier.verify(key, Buffer.from(signatureB64, 'base64url'))) {
        throw new TokenError('bad signature');
      }
    }

    const nowS = Math.floor(now() / 1000);
    const { projectId } = options;
    if (payload['aud'] !== projectId) throw new TokenError('wrong audience');
    if (payload['iss'] !== `https://securetoken.google.com/${projectId}`) {
      throw new TokenError('wrong issuer');
    }
    if (typeof payload['exp'] !== 'number' || payload['exp'] <= nowS) {
      throw new TokenError('expired');
    }
    if (typeof payload['iat'] !== 'number' || payload['iat'] > nowS + SKEW_S) {
      throw new TokenError('issued in the future');
    }
    const authTime = payload['auth_time'];
    if (typeof authTime === 'number' && authTime > nowS + SKEW_S) {
      throw new TokenError('authenticated in the future');
    }
    const sub = payload['sub'];
    if (typeof sub !== 'string' || sub.length === 0 || sub.length > 128) {
      throw new TokenError('missing subject');
    }
    return {
      uid: sub,
      email: typeof payload['email'] === 'string' ? payload['email'].toLowerCase() : null,
      emailVerified: payload['email_verified'] === true,
    };
  };
}
