import { createPublicKey, createSign, createVerify } from 'node:crypto';

/**
 * Google credentials for the production adapters (Cloud Storage, Cloud Tasks),
 * with no SDK: access tokens from the Cloud Run metadata server or a
 * service-account key, and verification of the OIDC tokens Cloud Tasks signs.
 */

export type TokenProvider = () => Promise<string>;
type Fetch = typeof fetch;

export const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function cached(fetchToken: () => Promise<{ token: string; expiresIn: number }>): TokenProvider {
  let current: { token: string; expiresAt: number } | null = null;
  return async () => {
    if (current && current.expiresAt > Date.now() + 60_000) return current.token;
    const { token, expiresIn } = await fetchToken();
    current = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  };
}

async function readToken(response: Response): Promise<{ token: string; expiresIn: number }> {
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(
      `Google token request failed (${response.status}): ${json.error ?? 'no token'}`,
    );
  }
  return { token: json.access_token, expiresIn: json.expires_in ?? 3600 };
}

/** The runtime service account's token, from the metadata server (Cloud Run, GCE). */
export function metadataTokens(fetchImpl: Fetch = fetch): TokenProvider {
  return cached(async () =>
    readToken(
      await fetchImpl(METADATA_TOKEN_URL, {
        headers: { 'metadata-flavor': 'Google' },
        signal: AbortSignal.timeout(5_000),
      }),
    ),
  );
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** A service-account key's token for `scope` (RFC 7523 JWT bearer). */
export function serviceAccountTokens(
  keyJson: string,
  scope: string,
  fetchImpl: Fetch = fetch,
): TokenProvider {
  const key = JSON.parse(keyJson) as ServiceAccountKey;
  if (!key.client_email || !key.private_key) {
    throw new Error('The service-account key is missing client_email or private_key.');
  }
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  return cached(async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({ iss: key.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${base64url(signer.sign(key.private_key))}`;
    return readToken(
      await fetchImpl(tokenUri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
        signal: AbortSignal.timeout(15_000),
      }),
    );
  });
}

/**
 * Tokens for a Google API: a service-account key from the named environment
 * variable when one is set (local runs, other clouds), otherwise the runtime
 * identity from the metadata server (Cloud Run -- no key to manage).
 */
export function googleTokens(
  env: NodeJS.ProcessEnv,
  keyVariable: string,
  scope: string,
  fetchImpl: Fetch = fetch,
): TokenProvider {
  const key = env[keyVariable];
  return key ? serviceAccountTokens(key, scope, fetchImpl) : metadataTokens(fetchImpl);
}

export interface OidcExpectation {
  /** The `aud` the token must carry (the URL the task was created for). */
  audience: string;
  /** The service account the queue signs as; any other signer is refused. */
  email: string;
  jwksUrl?: string;
  fetch?: Fetch;
  now?: () => number;
}

/**
 * Verifies a Google-signed OIDC ID token (what Cloud Tasks attaches with
 * `oidcToken`): RS256 against Google's published keys, issuer, audience,
 * expiry and the signing service account's verified email. Returns false
 * rather than throwing, so a caller can answer one opaque 401.
 */
export function createOidcVerifier(expect: OidcExpectation): (token: string) => Promise<boolean> {
  const fetchImpl = expect.fetch ?? fetch;
  const now = expect.now ?? (() => Date.now());
  let keys: { at: number; byKid: Map<string, JsonWebKey> } | null = null;

  async function keyFor(kid: string): Promise<JsonWebKey | null> {
    if (!keys || now() - keys.at > 3_600_000 || !keys.byKid.has(kid)) {
      const response = await fetchImpl(expect.jwksUrl ?? GOOGLE_JWKS_URL, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const json = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
      keys = {
        at: now(),
        byKid: new Map((json.keys ?? []).map((k) => [String(k.kid), k])),
      };
    }
    return keys.byKid.get(kid) ?? null;
  }

  return async (token: string) => {
    try {
      const [h, c, sig] = token.split('.');
      if (!h || !c || !sig) return false;
      const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as {
        alg?: string;
        kid?: string;
      };
      if (header.alg !== 'RS256' || !header.kid) return false;
      const jwk = await keyFor(header.kid);
      if (!jwk) return false;
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${h}.${c}`);
      if (!verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), sig, 'base64url')) {
        return false;
      }
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as {
        iss?: string;
        aud?: string;
        exp?: number;
        email?: string;
        email_verified?: boolean;
      };
      const seconds = Math.floor(now() / 1000);
      return (
        (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com') &&
        claims.aud === expect.audience &&
        typeof claims.exp === 'number' &&
        claims.exp > seconds &&
        claims.email === expect.email &&
        claims.email_verified === true
      );
    } catch {
      return false;
    }
  };
}
