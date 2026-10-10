import { describe, expect, it } from 'vitest';

import { clientAddress, createRateLimiter, type RateLimitRule } from '../src/ratelimit.js';

/**
 * The rate limiter and the address resolution it keys on.
 *
 * Both are pure, so they are tested directly rather than only through a route.
 * The address resolution in particular is the part where a plausible-looking
 * implementation is a security bug, so it gets tested against the spoofing case
 * explicitly rather than only against the happy path.
 */

describe('clientAddress', () => {
  it('uses the socket peer when no proxies are trusted', () => {
    expect(
      clientAddress({
        socketAddress: '10.0.0.9',
        forwardedFor: '203.0.113.7',
        trustedHops: 0,
      }),
    ).toBe('10.0.0.9');
  });

  it('uses the socket peer when there is no header at all', () => {
    expect(
      clientAddress({ socketAddress: '10.0.0.9', forwardedFor: undefined, trustedHops: 1 }),
    ).toBe('10.0.0.9');
  });

  it('reads the entry one hop in for a single trusted proxy', () => {
    // `client, proxy1` -- proxy1 is nearest to us and is the socket peer, so the
    // client is the last entry.
    expect(
      clientAddress({
        socketAddress: '10.0.0.9',
        forwardedFor: '203.0.113.7, 10.0.0.9',
        trustedHops: 1,
      }),
    ).toBe('10.0.0.9');
  });

  it('counts in from the right for two trusted proxies', () => {
    expect(
      clientAddress({
        socketAddress: '10.0.0.9',
        forwardedFor: '203.0.113.7, 10.0.0.8, 10.0.0.9',
        trustedHops: 2,
      }),
    ).toBe('10.0.0.8');
  });

  it('ignores an entry the caller prepended', () => {
    // The attack this whole helper exists to prevent: a caller sends their own
    // X-Forwarded-For. Trusting one hop, the forged left-most entry must be
    // ignored and the address the trusted proxy appended must be used -- else the
    // attacker picks the key they are limited by and simply changes it per
    // request, which is the same as having no limit at all.
    expect(
      clientAddress({
        socketAddress: '10.0.0.9',
        forwardedFor: '1.2.3.4, 203.0.113.7, 10.0.0.9',
        trustedHops: 1,
      }),
    ).toBe('10.0.0.9');
  });

  it('falls back to the socket when the chain is shorter than the trust', () => {
    // Fewer hops than configured means the deployment is misconfigured or the
    // header is forged. Believe neither, and fail closed onto the socket peer.
    expect(
      clientAddress({
        socketAddress: '10.0.0.9',
        forwardedFor: '203.0.113.7',
        trustedHops: 2,
      }),
    ).toBe('10.0.0.9');
  });

  it('treats a repeated header as one comma-joined chain', () => {
    expect(
      clientAddress({
        socketAddress: '10.0.0.9',
        forwardedFor: ['203.0.113.7', '10.0.0.9'],
        trustedHops: 1,
      }),
    ).toBe('10.0.0.9');
  });

  it('tolerates whitespace and empty entries', () => {
    expect(
      clientAddress({
        socketAddress: '10.0.0.9',
        forwardedFor: '  203.0.113.7 ,, 10.0.0.9  ',
        trustedHops: 1,
      }),
    ).toBe('10.0.0.9');
  });

  it('degenerates to a single shared key when the socket address is unknown', () => {
    // Every such request shares one bucket, which over-limits rather than
    // under-limits. Coarse, and the safe direction.
    expect(
      clientAddress({ socketAddress: undefined, forwardedFor: undefined, trustedHops: 0 }),
    ).toBe('unknown');
  });
});

describe('createRateLimiter', () => {
  const rule: RateLimitRule = { limit: 3, windowMs: 1000 };

  function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it('allows exactly `limit` requests and refuses the next', () => {
    const limiter = createRateLimiter({ now: clock().now });
    const decisions = [1, 2, 3, 4, 5].map(() => limiter.check('k', rule));
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false, false]);
    expect(decisions[2]?.remaining).toBe(0);
    expect(decisions[3]?.remaining).toBe(0);
  });

  it('reports remaining correctly as the window fills', () => {
    const limiter = createRateLimiter({ now: clock().now });
    expect(limiter.check('k', rule).remaining).toBe(2);
    expect(limiter.check('k', rule).remaining).toBe(1);
    expect(limiter.check('k', rule).remaining).toBe(0);
  });

  it('resets once the window has elapsed', () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now });
    for (let i = 0; i < 3; i += 1) expect(limiter.check('k', rule).allowed).toBe(true);
    expect(limiter.check('k', rule).allowed).toBe(false);

    c.advance(999);
    expect(limiter.check('k', rule).allowed).toBe(false);

    c.advance(1);
    const afterReset = limiter.check('k', rule);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(2);
  });

  it('counts each key independently', () => {
    const limiter = createRateLimiter({ now: clock().now });
    for (let i = 0; i < 3; i += 1) limiter.check('a', rule);
    expect(limiter.check('a', rule).allowed).toBe(false);
    expect(limiter.check('b', rule).allowed).toBe(true);
  });

  it('rounds the retry hint up so a caller cannot retry inside the window', () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now });
    for (let i = 0; i < 3; i += 1) limiter.check('k', rule);
    expect(limiter.check('k', rule).retryAfterSec).toBe(1);

    // 100 ms left: still "1", not "0" -- truncating here would tell a client to
    // retry immediately, into the same window, and it would be refused again.
    c.advance(900);
    expect(limiter.check('k', rule).retryAfterSec).toBe(1);
  });

  it('reports a reset time at the end of the window, not the start of the request', () => {
    const c = clock();
    const limiter = createRateLimiter({ now: c.now });
    const first = limiter.check('k', rule);
    c.advance(400);
    const later = limiter.check('k', rule);
    expect(first.resetAt).toBe(1000);
    expect(later.resetAt).toBe(1000);
  });

  it('bounds memory: the sweep keeps the bucket count at the cap', () => {
    // The cap only reshapes the limiter under extreme key cardinality, so the
    // assertion is the invariant (bounded) rather than a particular victim.
    const limiter = createRateLimiter({ now: clock().now, maxKeys: 10 });
    for (let i = 0; i < 500; i += 1) limiter.check(`key-${i}`, rule);
    expect(limiter.size()).toBeLessThanOrEqual(10);
  });

  it('does not let an evicted key permanently bypass the limit', () => {
    // Eviction is a memory guard, so a dropped key starts a fresh count. What
    // must remain true is that refilling still gets limited: the limiter is
    // bounded, not open.
    const limiter = createRateLimiter({ now: clock().now, maxKeys: 4 });
    for (let i = 0; i < 100; i += 1) limiter.check(`filler-${i}`, rule);
    const refill = [1, 2, 3, 4].map(() => limiter.check('victim', rule));
    expect(refill.slice(0, 3).every((d) => d.allowed)).toBe(true);
    expect(refill[3]?.allowed).toBe(false);
  });
});
