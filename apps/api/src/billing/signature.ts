import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe webhook signature verification (the `Stripe-Signature` header).
 *
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 under the endpoint's
 * `whsec_` secret and sends `t=<timestamp>,v1=<hex>[,v1=...]`. The raw body is
 * required byte for byte -- a re-serialised JSON object would not match -- and
 * the timestamp must be within the tolerance, which is what stops a captured,
 * validly signed delivery being replayed later.
 */
export const DEFAULT_TOLERANCE_S = 300;

export class SignatureError extends Error {}

export function computeStripeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

/** Build a header as Stripe would; for tests and local tooling. */
export function stripeSignatureHeader(secret: string, timestamp: number, rawBody: string): string {
  return `t=${timestamp},v1=${computeStripeSignature(secret, timestamp, rawBody)}`;
}

export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowMs: number,
  toleranceS: number = DEFAULT_TOLERANCE_S,
): void {
  if (!header) throw new SignatureError('missing Stripe-Signature header');
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't' && value) timestamp = Number(value);
    if (key === 'v1' && value) signatures.push(value);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) {
    throw new SignatureError('malformed Stripe-Signature header');
  }
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceS) {
    throw new SignatureError('signature timestamp outside the tolerance window');
  }
  const expected = Buffer.from(computeStripeSignature(secret, timestamp, rawBody), 'hex');
  const matched = signatures.some((candidate) => {
    const given = Buffer.from(candidate, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matched) throw new SignatureError('signature does not match');
}
