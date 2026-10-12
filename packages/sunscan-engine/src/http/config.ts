// HTTP layer configuration: mode, directories, User-Agent, per-provider policies and per-host limits.
// Environment: SUNSCAN_HTTP_MODE (live|record|replay), SUNSCAN_USER_AGENT, SUNSCAN_HTTP_CACHE_DIR, SUNSCAN_FIXTURES_DIR.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HttpMode } from '../contracts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (this file lives in apps/server/src/http). */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

/** Identifying, policy-compliant User-Agent. Never contains an e-mail address or other personal data. */
export const DEFAULT_USER_AGENT = 'SunScanV2/0.1 (UK house 3D modeller)';

/** Caching / timeout / retry policy of one logical provider (`HttpRequest.provider`). */
export interface ProviderPolicy {
  /** Disk-cache TTL for successful (2xx) responses, seconds. */
  ttlSec: number;
  /** Disk-cache TTL for cacheable negative responses (404/410), seconds. */
  negativeTtlSec: number;
  /** Per-attempt timeout (connect + full body), milliseconds. */
  timeoutMs: number;
  /** Extra attempts after the first one on retryable statuses / network errors. */
  retries: number;
  /** HTTP statuses that trigger a retry with backoff. Network errors and timeouts always do (when retries > 0). */
  retryStatuses: number[];
}

/** Concurrency and pacing limits applied per host to live network requests. */
export interface HostLimit {
  /** Maximum simultaneous requests to the host. */
  concurrency: number;
  /** Minimum spacing between the starts of two requests to the host, milliseconds. */
  minIntervalMs: number;
}

const DAY = 86_400;

/** Defaults for providers without an entry in {@link PROVIDER_POLICIES}. */
export const BASE_POLICY: ProviderPolicy = {
  ttlSec: DAY,
  negativeTtlSec: 3600,
  timeoutMs: 15_000,
  retries: 2,
  retryStatuses: [429, 500, 502, 503, 504],
};

/** Per-provider overrides (verified behaviour in docs/research/01 and 02). */
export const PROVIDER_POLICIES: Record<string, Partial<ProviderPolicy>> = {
  nominatim: { ttlSec: 30 * DAY, negativeTtlSec: DAY },
  photon: { ttlSec: 7 * DAY },
  'postcodes.io': { ttlSec: 30 * DAY, negativeTtlSec: DAY },
  // Failover across endpoints is done by the Overpass client: no same-host retries here.
  overpass: { ttlSec: 7 * DAY, timeoutMs: 40_000, retries: 0, retryStatuses: [] },
  overture: { ttlSec: 180 * DAY }, // release-versioned URL -> immutable
  // EA answers HTTP 500 for windows outside the coverage bbox: deterministic, never retried.
  'ea-wcs': { ttlSec: 90 * DAY, retryStatuses: [429, 502, 503, 504] },
  'ea-index': { ttlSec: 90 * DAY },
  'wales-cog': { ttlSec: 90 * DAY },
  'wales-index': { ttlSec: 90 * DAY },
  srsp: { ttlSec: 90 * DAY, negativeTtlSec: 7 * DAY },
  esri: { ttlSec: 7 * DAY },
};

/** Default per-host limit: at most 2 concurrent requests, no pacing. */
export const DEFAULT_HOST_LIMIT: HostLimit = { concurrency: 2, minIntervalMs: 0 };

/** Per-host overrides. Nominatim: OSMF policy "an absolute maximum of 1 request per second" for the whole app. */
export const HOST_LIMITS: Record<string, Partial<HostLimit>> = {
  'nominatim.openstreetmap.org': { concurrency: 1, minIntervalMs: 1100 },
  'photon.komoot.io': { minIntervalMs: 250 },
};

/** Effective configuration of the HTTP layer. */
export interface HttpConfig {
  mode: HttpMode;
  /** Live/record disk cache root (`<cacheDir>/<provider>/<key>.{json,bin}`). */
  cacheDir: string;
  /** Fixture root (`<fixturesDir>/<provider>/<key>.{json,bin}`). */
  fixturesDir: string;
  userAgent: string;
  policies: Record<string, Partial<ProviderPolicy>>;
  hostLimits: Record<string, Partial<HostLimit>>;
  /** Upper bound for honoured Retry-After values, milliseconds. */
  maxRetryAfterMs: number;
  /** Base of the exponential backoff (attempt n waits base * 2^n + jitter), milliseconds. */
  backoffBaseMs: number;
  /** Largest full (200) body accepted when a byte range was requested and the server ignored it. */
  maxIgnoredRangeBytes: number;
}

const EMAIL_RE = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;

/** Parses an HTTP mode string; throws on unknown values. */
export function parseHttpMode(v: string | undefined, fallback: HttpMode = 'live'): HttpMode {
  if (v == null || v === '') return fallback;
  const m = v.trim().toLowerCase();
  if (m === 'live' || m === 'record' || m === 'replay') return m;
  throw new Error(`Invalid SUNSCAN_HTTP_MODE "${v}" (expected live | record | replay)`);
}

/** Returns a safe User-Agent: the candidate unless it is empty or looks like it carries an e-mail address. */
export function sanitizeUserAgent(candidate: string | undefined): string {
  const ua = (candidate ?? '').trim();
  if (!ua) return DEFAULT_USER_AGENT;
  if (EMAIL_RE.test(ua)) {
    console.warn('[http] SUNSCAN_USER_AGENT looks like it contains an e-mail address; using the default User-Agent instead');
    return DEFAULT_USER_AGENT;
  }
  return ua;
}

function fromEnv(): HttpConfig {
  const env = process.env;
  return {
    mode: parseHttpMode(env.SUNSCAN_HTTP_MODE),
    cacheDir: path.resolve(env.SUNSCAN_HTTP_CACHE_DIR || path.join(REPO_ROOT, '.cache', 'http')),
    fixturesDir: path.resolve(env.SUNSCAN_FIXTURES_DIR || path.join(REPO_ROOT, 'fixtures', 'sunscan', 'http')),
    userAgent: sanitizeUserAgent(env.SUNSCAN_USER_AGENT),
    policies: PROVIDER_POLICIES,
    hostLimits: HOST_LIMITS,
    maxRetryAfterMs: 20_000,
    backoffBaseMs: 500,
    maxIgnoredRangeBytes: 32 * 1024 * 1024,
  };
}

let current: HttpConfig = fromEnv();

/** Current HTTP configuration (read-only view). */
export function getHttpConfig(): Readonly<HttpConfig> {
  return current;
}

/** Overrides parts of the configuration (tests, CLI). The User-Agent is always sanitised. */
export function configureHttp(patch: Partial<HttpConfig>): Readonly<HttpConfig> {
  current = { ...current, ...patch };
  if (patch.userAgent !== undefined) current.userAgent = sanitizeUserAgent(patch.userAgent);
  if (patch.mode !== undefined) current.mode = parseHttpMode(patch.mode);
  return current;
}

/** Restores the configuration derived from the environment. */
export function resetHttpConfig(): Readonly<HttpConfig> {
  current = fromEnv();
  return current;
}

/** Effective policy for a provider (defaults merged with overrides). */
export function policyFor(provider: string): ProviderPolicy {
  return { ...BASE_POLICY, ...(current.policies[provider] ?? {}) };
}

/** Effective limit for a host (defaults merged with overrides). */
export function hostLimitFor(host: string): HostLimit {
  return { ...DEFAULT_HOST_LIMIT, ...(current.hostLimits[host] ?? {}) };
}
