import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * The email add-on's small cryptographic needs, all on `node:crypto`.
 *
 * - Mailbox refresh tokens are encrypted at rest with AES-256-GCM under a key
 *   from configuration (`SUNNY_EMAIL_TOKEN_KEY`, 32 bytes base64). This is the
 *   interim for Secret Manager: the stored value is a ciphertext and a key id,
 *   never the token, and a deployment with Secret Manager wired keeps the key
 *   there. Without a key the add-on refuses to store a token at all.
 * - The OAuth `state` is an HMAC-signed, expiring statement of which tenant
 *   started the flow, so a callback cannot be replayed against another tenant
 *   or forged by a third party (CSRF).
 * - A per-tenant inbound webhook token is derived, not stored: HMAC of the
 *   tenant id under the webhook secret. Rotating the secret rotates them all.
 */

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(text: string): Buffer {
  return Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Constant-time string comparison; unequal lengths leak only the length. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Parse the configured key. Returns null for an absent or malformed key. */
export function parseTokenKey(raw: string | null | undefined): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw.trim(), 'base64');
  return key.length === 32 ? key : null;
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', base64url(iv), base64url(cipher.getAuthTag()), base64url(body)].join('.');
}

export function decryptSecret(key: Buffer, sealed: string): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || body === undefined) {
    throw new Error('Unrecognised token format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, fromBase64url(iv));
  decipher.setAuthTag(fromBase64url(tag));
  return Buffer.concat([decipher.update(fromBase64url(body)), decipher.final()]).toString('utf8');
}

export interface OAuthState {
  tenantId: string;
  provider: 'gmail' | 'outlook';
  /** Where to send the installer back to afterwards (a dashboard path). */
  returnTo: string;
  exp: number;
  nonce: string;
}

export function signState(secret: string, state: Omit<OAuthState, 'nonce'>): string {
  const payload = base64url(
    Buffer.from(JSON.stringify({ ...state, nonce: base64url(randomBytes(9)) })),
  );
  const mac = base64url(createHmac('sha256', secret).update(`oauth-state.${payload}`).digest());
  return `${payload}.${mac}`;
}

export function verifyState(secret: string, token: string, nowMs: number): OAuthState | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = base64url(
    createHmac('sha256', secret).update(`oauth-state.${payload}`).digest(),
  );
  if (!safeEqual(mac, expected)) return null;
  try {
    const state = JSON.parse(fromBase64url(payload).toString('utf8')) as OAuthState;
    if (typeof state.tenantId !== 'string' || typeof state.exp !== 'number') return null;
    if (state.exp < nowMs) return null;
    return state;
  } catch {
    return null;
  }
}

/** The secret token that authenticates one tenant's inbound webhook URL. */
export function inboundToken(secret: string, tenantId: string): string {
  return base64url(createHmac('sha256', secret).update(`inbound-email.${tenantId}`).digest()).slice(
    0,
    32,
  );
}
