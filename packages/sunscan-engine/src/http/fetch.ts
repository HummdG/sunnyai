// fetchCached(): the single HTTP entry point for every provider.
//   live   : disk cache (.cache/http, per-provider TTL) -> network
//   record : existing fixture -> disk cache -> network; every response (and network failure) is written to fixtures/http
//   replay : fixtures only; a miss throws ReplayMissError (tests fail loudly, nothing touches the network)
// Network requests: per-host concurrency/pacing (Nominatim <= 1 req/s), timeouts, retries with backoff on
// 5xx/429/network errors (honouring Retry-After), byte ranges, identifying User-Agent (no personal data).
import type { HttpMode, HttpRequest, HttpResponse } from '../contracts.js';
import { configureHttp, getHttpConfig, hostLimitFor, policyFor, type HttpConfig, type ProviderPolicy } from './config.js';
import { HostGate, sleep } from './limiter.js';
import { entryPaths, readEntry, requestKey, writeEntry, type StoredEntry } from './store.js';

/** fetchCached options: the contract's HttpRequest plus per-call policy overrides. */
export interface FetchOptions extends HttpRequest {
  /** Extra attempts after the first (default: provider policy). */
  retries?: number;
  /** Statuses that are retried with backoff (default: provider policy). */
  retryStatuses?: number[];
  /** Whether a network response may enter the disk cache (default: 2xx, 404, 410). Fixtures are always written. */
  cacheable?: (res: HttpResponse) => boolean;
}

/** Thrown in replay mode when no fixture exists for a request. Never swallowed by provider failover logic. */
export class ReplayMissError extends Error {
  readonly code = 'REPLAY_MISS';
  constructor(
    readonly provider: string,
    readonly method: string,
    readonly url: string,
    readonly range: [number, number] | undefined,
    readonly key: string,
    readonly fixturePath: string,
  ) {
    super(
      `HTTP replay miss: no fixture for ${provider} ${method} ${url}${range ? ` [bytes ${range[0]}-${range[1]}]` : ''} ` +
        `(expected ${fixturePath}). Record it with SUNSCAN_HTTP_MODE=record ` +
        '(npx tsx apps/server/test/support-data/record-fixtures.ts).',
    );
    this.name = 'ReplayMissError';
  }
}

/** Network-level failure (timeout, DNS, connection reset, ...) after all retries, or a protocol violation. */
export class HttpError extends Error {
  readonly code = 'HTTP_ERROR';
  constructor(message: string, readonly provider: string, readonly url: string, readonly status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HttpError';
  }
}

/** True for errors that must propagate through any fallback logic (replay misses). */
export const isReplayMiss = (e: unknown): e is ReplayMissError => e instanceof ReplayMissError || (e as { code?: string })?.code === 'REPLAY_MISS';

/** Per-provider counters. */
export interface HttpStats { network: number; cache: number; fixture: number; replayMiss: number; failures: number; bytes: number }
/** One request served by fetchCached (diagnostics, fixture bookkeeping). */
export interface HttpLogEntry {
  provider: string; method: string; url: string; range?: [number, number]; key: string;
  source: 'network' | 'cache' | 'fixture' | 'miss'; status: number; ms: number; bytes: number;
}

const KEEP_HEADERS = ['content-type', 'content-range', 'etag', 'last-modified', 'retry-after', 'cache-control', 'expires', 'accept-ranges', 'location'];
const MAX_LOG = 20_000;
const gate = new HostGate((host) => hostLimitFor(host));
const inflight = new Map<string, Promise<StoredEntry>>();
const stats = new Map<string, HttpStats>();
const log: HttpLogEntry[] = [];

/** Sets the HTTP mode for the whole process. */
export function setHttpMode(mode: HttpMode): void {
  configureHttp({ mode });
}

/** Current HTTP mode (initially SUNSCAN_HTTP_MODE, default 'live'). */
export function getHttpMode(): HttpMode {
  return getHttpConfig().mode;
}

/** Snapshot of the per-provider counters. */
export function getHttpStats(): Record<string, HttpStats> {
  return Object.fromEntries([...stats].map(([k, v]) => [k, { ...v }]));
}

/** Requests served since the last {@link resetHttpState} (most recent last, capped). */
export function getHttpLog(): readonly HttpLogEntry[] {
  return log;
}

/** Clears counters, the request log and the host gate (tests). */
export function resetHttpState(): void {
  stats.clear();
  log.length = 0;
  gate.reset();
}

function bump(provider: string, field: keyof HttpStats, n = 1): void {
  let s = stats.get(provider);
  if (!s) stats.set(provider, (s = { network: 0, cache: 0, fixture: 0, replayMiss: 0, failures: 0, bytes: 0 }));
  s[field] += n;
}

function record(e: HttpLogEntry): void {
  log.push(e);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
}

const stripFragment = (url: string) => {
  const i = url.indexOf('#');
  return i < 0 ? url : url.slice(0, i);
};

function validate(req: FetchOptions): void {
  if (!req.provider) throw new Error('fetchCached: provider is required');
  if (!/^https?:\/\//i.test(req.url)) throw new Error(`fetchCached: absolute http(s) URL required, got "${req.url}"`);
  if (req.range) {
    const [a, b] = req.range;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a) throw new Error(`fetchCached: invalid byte range [${a}, ${b}]`);
  }
}

const defaultCacheable = (res: HttpResponse) => (res.status >= 200 && res.status < 300) || res.status === 404 || res.status === 410;

function isFresh(entry: StoredEntry, policy: ProviderPolicy, reqTtl?: number): boolean {
  const s = entry.meta.status;
  if (s === 0) return false;
  const ttl = s >= 200 && s < 300 ? (reqTtl ?? policy.ttlSec) : Math.min(reqTtl ?? Infinity, policy.negativeTtlSec);
  const age = Date.now() - Date.parse(entry.meta.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < ttl * 1000;
}

function toResponse(entry: StoredEntry, source: 'network' | 'cache' | 'fixture'): HttpResponse {
  const m = entry.meta;
  if (m.status === 0) {
    throw new HttpError(`${m.provider} ${m.request.method} ${m.request.url}: ${m.headers['x-sunscan-error'] ?? 'network error'}`, m.provider, m.request.url);
  }
  return {
    status: m.status,
    headers: { ...m.headers, 'x-sunscan-source': source, 'x-sunscan-fetched-at': m.fetchedAt },
    body: entry.body,
    fromCache: source !== 'network',
    url: m.url,
  };
}

/**
 * Fetches `req` according to the current HTTP mode. Resolves with the response for any HTTP status (callers interpret
 * 4xx/5xx); rejects with {@link HttpError} on network failures after retries and {@link ReplayMissError} on replay misses.
 */
export async function fetchCached(req: FetchOptions): Promise<HttpResponse> {
  validate(req);
  const cfg = getHttpConfig();
  const method = req.method ?? 'GET';
  const key = requestKey(method, req.url, req.body, req.range);
  const t0 = Date.now();
  const logIt = (source: HttpLogEntry['source'], status: number, bytes: number) =>
    record({ provider: req.provider, method, url: req.url, ...(req.range ? { range: req.range } : {}), key, source, status, ms: Date.now() - t0, bytes });

  if (cfg.mode === 'replay' || cfg.mode === 'record') {
    const fx = await readEntry(cfg.fixturesDir, req.provider, key);
    // record mode re-attempts recorded network failures instead of replaying them forever
    if (fx && !(cfg.mode === 'record' && fx.meta.status === 0)) {
      bump(req.provider, 'fixture');
      logIt('fixture', fx.meta.status, fx.meta.bytes);
      return toResponse(fx, 'fixture');
    }
    if (cfg.mode === 'replay') {
      bump(req.provider, 'replayMiss');
      logIt('miss', 0, 0);
      const miss = new ReplayMissError(req.provider, method, req.url, req.range, key, entryPaths(cfg.fixturesDir, req.provider, key).json);
      console.warn(`[http] ${miss.message}`); // stays visible even if a caller swallows the error
      throw miss;
    }
  }
  const policy = policyFor(req.provider);
  const cached = await readEntry(cfg.cacheDir, req.provider, key);
  if (cached && isFresh(cached, policy, req.ttlSec)) {
    if (cfg.mode === 'record') await writeEntry(cfg.fixturesDir, req.provider, key, cached);
    bump(req.provider, 'cache');
    logIt('cache', cached.meta.status, cached.meta.bytes);
    return toResponse(cached, 'cache');
  }
  let pending = inflight.get(key);
  if (!pending) {
    pending = networkAndStore(req, method, key, policy, cfg).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const entry = await pending;
  logIt('network', entry.meta.status, entry.meta.bytes);
  return toResponse(entry, 'network');
}

/**
 * Like {@link fetchCached} but never touches the network: returns a fixture (record/replay) or a fresh cache entry
 * (live/record), or null. Used to prefer an already-known answer before an expensive failover pass.
 */
export async function peekCached(req: FetchOptions): Promise<HttpResponse | null> {
  validate(req);
  const cfg = getHttpConfig();
  const method = req.method ?? 'GET';
  const key = requestKey(method, req.url, req.body, req.range);
  if (cfg.mode !== 'live') {
    const fx = await readEntry(cfg.fixturesDir, req.provider, key);
    if (fx && fx.meta.status !== 0) {
      bump(req.provider, 'fixture');
      record({ provider: req.provider, method, url: req.url, key, source: 'fixture', status: fx.meta.status, ms: 0, bytes: fx.meta.bytes });
      return toResponse(fx, 'fixture');
    }
    if (cfg.mode === 'replay') return null;
  }
  const cached = await readEntry(cfg.cacheDir, req.provider, key);
  if (!cached || !isFresh(cached, policyFor(req.provider), req.ttlSec)) return null;
  if (cfg.mode === 'record') await writeEntry(cfg.fixturesDir, req.provider, key, cached);
  bump(req.provider, 'cache');
  record({ provider: req.provider, method, url: req.url, key, source: 'cache', status: cached.meta.status, ms: 0, bytes: cached.meta.bytes });
  return toResponse(cached, 'cache');
}

async function networkAndStore(req: FetchOptions, method: string, key: string, policy: ProviderPolicy, cfg: Readonly<HttpConfig>): Promise<StoredEntry> {
  const entry = await networkFetch(req, method, policy, cfg);
  if (entry.meta.status === 0) {
    bump(req.provider, 'failures');
    // a failure is part of the recorded interaction (failover replays identically); never cached
    if (cfg.mode === 'record') await writeEntry(cfg.fixturesDir, req.provider, key, entry);
    return entry;
  }
  bump(req.provider, 'network');
  bump(req.provider, 'bytes', entry.meta.bytes);
  const res = toResponse(entry, 'network');
  if ((req.cacheable ?? defaultCacheable)(res)) {
    await writeEntry(cfg.cacheDir, req.provider, key, entry).catch((e) => console.warn(`[http] cache write failed: ${(e as Error).message}`));
  }
  if (cfg.mode === 'record') await writeEntry(cfg.fixturesDir, req.provider, key, entry);
  return entry;
}

function retryAfterMs(value: string | undefined, cfg: Readonly<HttpConfig>): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, cfg.maxRetryAfterMs) : undefined;
}

async function networkFetch(req: FetchOptions, method: string, policy: ProviderPolicy, cfg: Readonly<HttpConfig>): Promise<StoredEntry> {
  const target = stripFragment(req.url);
  const host = new URL(target).host;
  const retries = Math.max(0, req.retries ?? policy.retries);
  const retryStatuses = req.retryStatuses ?? policy.retryStatuses;
  const timeoutMs = req.timeoutMs ?? policy.timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const release = await gate.acquire(host);
    let entry: StoredEntry | undefined;
    let error: unknown;
    try {
      entry = await once(req, method, target, timeoutMs, cfg);
    } catch (e) {
      error = e;
    } finally {
      release();
    }
    const retryable = entry ? retryStatuses.includes(entry.meta.status) : true;
    if (!retryable || attempt >= retries) {
      if (entry) return entry;
      const message = (error as Error)?.message ?? String(error);
      return {
        meta: {
          schema: 'sunscan.http/1', provider: req.provider,
          request: { method, url: req.url, ...(req.body != null ? { body: req.body } : {}), ...(req.range ? { range: req.range } : {}) },
          status: 0, headers: { 'x-sunscan-error': message.slice(0, 300) }, url: target, fetchedAt: new Date().toISOString(), bytes: 0,
        },
        body: new Uint8Array(0),
      };
    }
    const hinted = retryAfterMs(entry?.meta.headers['retry-after'], cfg);
    await sleep(hinted ?? cfg.backoffBaseMs * 2 ** attempt + Math.random() * 250);
  }
}

async function once(req: FetchOptions, method: string, target: string, timeoutMs: number, cfg: Readonly<HttpConfig>): Promise<StoredEntry> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: '*/*' };
    for (const [k, v] of Object.entries(req.headers ?? {})) if (k.toLowerCase() !== 'user-agent') headers[k] = v;
    headers['User-Agent'] = cfg.userAgent; // always ours: identifying, no personal data
    if (req.body != null && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (req.range) headers.Range = `bytes=${req.range[0]}-${req.range[1]}`;
    const res = await fetch(target, { method, headers, body: req.body, signal: ctrl.signal, redirect: 'follow' });
    let status = res.status;
    const kept: Record<string, string> = {};
    for (const h of KEEP_HEADERS) {
      const v = res.headers.get(h);
      if (v != null) kept[h] = v;
    }
    let body: Uint8Array;
    if (req.range && status === 200) {
      // server ignored the Range header: accept only small bodies and slice them, never stream a huge file
      const declared = Number(res.headers.get('content-length') ?? NaN);
      if (Number.isFinite(declared) && declared > cfg.maxIgnoredRangeBytes) {
        ctrl.abort(new Error('range ignored'));
        throw new HttpError(`${req.provider}: server ignored Range on a ${declared}-byte resource ${target}`, req.provider, target, 200);
      }
      const full = new Uint8Array(await res.arrayBuffer());
      const [a, b] = req.range;
      body = full.slice(Math.min(a, full.byteLength), Math.min(full.byteLength, b + 1));
      status = 206;
      kept['content-range'] = `bytes ${a}-${a + body.byteLength - 1}/${full.byteLength}`;
    } else {
      body = new Uint8Array(await res.arrayBuffer());
    }
    return {
      meta: {
        schema: 'sunscan.http/1', provider: req.provider,
        request: { method, url: req.url, ...(req.body != null ? { body: req.body } : {}), ...(req.range ? { range: req.range } : {}) },
        status, headers: kept, url: res.url || target, fetchedAt: new Date().toISOString(), bytes: body.byteLength,
      },
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}
