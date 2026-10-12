/**
 * Cloudflare Turnstile server-side verification (Blueprint §4.6).
 *
 * The widget earns a token from Turnstile's invisible challenge and presents it
 * when it opens a session; the server checks it with Cloudflare's siteverify
 * endpoint before issuing a session token. A script that cannot pass the
 * challenge cannot open sessions, and so cannot spend model calls.
 *
 * Fails closed: a network error or an unreadable response is a failed check,
 * because the alternative lets an attacker turn the check off by making
 * Cloudflare unreachable from our side.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  success: boolean;
  /** Cloudflare's error codes, or our own `network-error` / `bad-response`. */
  errorCodes: string[];
}

export async function verifyTurnstile(
  token: string | undefined,
  secretKey: string,
  remoteIp: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!token) return { success: false, errorCodes: ['missing-input-response'] };
  const form = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);
  let response: Response;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { success: false, errorCodes: ['network-error'] };
  }
  try {
    const body = (await response.json()) as { success?: unknown; 'error-codes'?: unknown };
    return {
      success: body.success === true,
      errorCodes: Array.isArray(body['error-codes'])
        ? body['error-codes'].filter((c): c is string => typeof c === 'string')
        : [],
    };
  } catch {
    return { success: false, errorCodes: ['bad-response'] };
  }
}
