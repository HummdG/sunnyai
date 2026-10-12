// HTTP layer public API: one cached/recorded/replayed fetch for every provider (spec §5.8).
export type { HttpMode, HttpRequest, HttpResponse } from '../contracts.js';
export {
  fetchCached, peekCached, setHttpMode, getHttpMode, getHttpStats, getHttpLog, resetHttpState,
  ReplayMissError, HttpError, isReplayMiss,
  type FetchOptions, type HttpStats, type HttpLogEntry,
} from './fetch.js';
export {
  configureHttp, getHttpConfig, resetHttpConfig, parseHttpMode, sanitizeUserAgent, policyFor, hostLimitFor,
  DEFAULT_USER_AGENT, REPO_ROOT, PROVIDER_POLICIES, HOST_LIMITS,
  type HttpConfig, type ProviderPolicy, type HostLimit,
} from './config.js';
export { requestKey, entryPaths, readEntry, providerDir, type StoredMeta, type StoredEntry } from './store.js';
export { HostGate, sleep } from './limiter.js';

import type { HttpResponse } from '../contracts.js';

/** Decodes a response body as UTF-8 text. */
export function bodyText(res: HttpResponse): string {
  return new TextDecoder('utf-8').decode(res.body);
}

/** Parses a response body as JSON; returns null when it is not valid JSON (e.g. an HTML error page). */
export function bodyJson<T = unknown>(res: HttpResponse): T | null {
  try {
    return JSON.parse(bodyText(res)) as T;
  } catch {
    return null;
  }
}

/** Copies a response body into a standalone ArrayBuffer (for parsers that need one, e.g. geotiff.js). */
export function bodyArrayBuffer(res: HttpResponse): ArrayBuffer {
  const b = res.body;
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
}

/** Builds a query string, skipping undefined/null/empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  return u.toString();
}
