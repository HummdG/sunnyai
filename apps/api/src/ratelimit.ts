/**
 * Fixed-window rate limiting.
 *
 * Why this exists at all: every public route on this API either creates durable
 * state or spends money. `POST /v1/widget/session` is unauthenticated and writes
 * a conversation record; `POST /v1/chat/stream` calls a model and bills per
 * token. Without a limit, a single script can exhaust the deployment's model
 * budget, which is the whole attack -- there is no data to steal, only a bill to
 * run up. The error contract already reserved `rate_limited` / 429 for this; what
 * was missing was anything that could ever return it.
 *
 * Fixed window rather than a sliding log or a token bucket. A fixed window can be
 * burst up to 2x the limit across a boundary, and that is a deliberate trade: the
 * alternative keeps a timestamp per request for a full window (more memory, more
 * work per request) to defend against a threat this endpoint does not face. A
 * visitor who bursts across a window edge gets 60 requests in a minute instead of
 * 30, and nobody is harmed.
 *
 * In-memory and per-instance, so the effective limit is `limit x instances`. That
 * is the honest description: this is a backstop against a naive script and a
 * runaway client, NOT a hard quota, and not a substitute for an edge control at
 * scale. `docs/DECISIONS.md` (D-10) records the trade and its limits.
 */

export interface RateLimitRule {
  /** Requests permitted per window, per key. */
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms at which the current window ends and the count resets. */
  resetAt: number;
  /** Whole seconds a caller should wait; zero when the request was allowed. */
  retryAfterSec: number;
}

export interface RateLimiter {
  /**
   * Count one request against `key` and say whether it may proceed.
   *
   * Never throws: a limiter that fails closed on its own error turns a bug in the
   * limiter into an outage for every visitor, and a limiter should not be the
   * component deciding availability.
   */
  check(key: string, rule: RateLimitRule): RateLimitDecision;
  /** Live buckets. For tests and diagnostics, not for logic. */
  size(): number;
}

interface Bucket {
  count: number;
  /** Unix ms at which this window ends. Stored so a sweep needs no rule. */
  expiresAt: number;
}

export interface RateLimiterOptions {
  now?: () => number;
  /**
   * Ceiling on tracked keys, to bound memory.
   *
   * A guard rail, not a security boundary. At the cap, expired buckets are swept
   * first; if that is still not enough, the oldest are dropped and a dropped key
   * simply starts a fresh count. So the cap can only make the limiter more
   * permissive for the keys it evicts, never more restrictive -- the safe
   * direction for a memory guard to fail.
   */
  maxKeys?: number;
}

/**
 * Who to count a request against.
 *
 * Resolved here rather than by Fastify's `trustProxy` option for two reasons: the
 * policy is then explicit and unit-testable rather than delegated, and Fastify's
 * typings do not accept the hop count that `proxy-addr` actually supports.
 *
 * `X-Forwarded-For` is a comma-separated chain that each proxy appends to, so it
 * reads `client, hop1, hop2, ...` with the entry nearest to us written last.
 * Trusting `trustedHops` proxies therefore means the client is the entry
 * `trustedHops` back from the right. Everything to the left of that is whatever
 * the caller sent and is ignored -- reading the left-most entry, which is the
 * obvious implementation, hands an attacker the key they are limited by.
 *
 * With zero trusted hops, or with a chain shorter than the configured trust (a
 * misconfiguration, or a forged header on a deployment that trusts none), this
 * falls back to the socket peer. That is the fail-closed direction: unrelated
 * clients can be merged into one bucket, but nobody can escape theirs.
 */
export function clientAddress(input: {
  /** The address of the peer that opened the socket, i.e. the last hop. */
  socketAddress: string | undefined;
  /** The raw `X-Forwarded-For` header, if any. A repeated header arrives as an
   * array and means the same thing as one comma-joined line. */
  forwardedFor: string | string[] | undefined;
  trustedHops: number;
}): string {
  const fallback = input.socketAddress ?? 'unknown';
  const header = Array.isArray(input.forwardedFor)
    ? input.forwardedFor.join(',')
    : input.forwardedFor;
  if (input.trustedHops <= 0 || !header) return fallback;

  const chain = header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const index = chain.length - input.trustedHops;
  // `index < 0` means the chain is shorter than the trust we were told to place
  // in it, so the header describes fewer hops than the deployment expects and
  // cannot be believed. Fall back rather than guess.
  return index >= 0 ? (chain[index] ?? fallback) : fallback;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? 10_000;
  // Map preserves insertion order, so iteration is oldest-bucket-first until a
  // bucket is re-inserted on the far side of its window.
  const buckets = new Map<string, Bucket>();

  /** Drop expired buckets, then keep dropping oldest until under the cap. */
  function evict(at: number): void {
    for (const [key, bucket] of buckets) {
      if (at >= bucket.expiresAt) buckets.delete(key);
    }
    if (buckets.size < maxKeys) return;
    const excess = buckets.size - maxKeys + 1;
    let dropped = 0;
    for (const key of buckets.keys()) {
      if (dropped >= excess) break;
      buckets.delete(key);
      dropped += 1;
    }
  }

  return {
    check(key: string, rule: RateLimitRule): RateLimitDecision {
      const at = now();
      const existing = buckets.get(key);

      // Absent, or the window it belonged to has ended. Either way the caller is
      // the first in a new window.
      if (existing === undefined || at >= existing.expiresAt) {
        if (buckets.size >= maxKeys) evict(at);
        // Re-inserting moves the key to the end of the iteration order, which is
        // what keeps the eviction sweep above approximately oldest-first.
        buckets.delete(key);
        buckets.set(key, { count: 1, expiresAt: at + rule.windowMs });
        return {
          allowed: true,
          limit: rule.limit,
          remaining: Math.max(0, rule.limit - 1),
          resetAt: at + rule.windowMs,
          retryAfterSec: 0,
        };
      }

      existing.count += 1;
      const allowed = existing.count <= rule.limit;
      return {
        allowed,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - existing.count),
        resetAt: existing.expiresAt,
        // Rounded up, so a caller told "1" does not retry at 900 ms left and land
        // in the same window again.
        retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((existing.expiresAt - at) / 1000)),
      };
    },

    size(): number {
      return buckets.size;
    },
  };
}
