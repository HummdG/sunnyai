import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  configureHttp, DEFAULT_USER_AGENT, entryPaths, fetchCached, getHttpConfig, getHttpMode, getHttpStats, HOST_LIMITS, HttpError,
  parseHttpMode, peekCached, policyFor, ReplayMissError, requestKey, resetHttpConfig, resetHttpState, sanitizeUserAgent, setHttpMode,
} from '../src/http/index.js';
import { delay, startLocalServer, type LocalServer } from './support-data/local-server.js';

let server: LocalServer;
let dir: string;
let mode503 = 0;
const big = Buffer.alloc(1000, 7);
for (let i = 0; i < big.length; i++) big[i] = i % 251;

beforeAll(async () => {
  server = await startLocalServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/ok') {
      res.setHeader('content-type', 'text/plain');
      res.setHeader('etag', '"v1"');
      res.end(`hello ${u.searchParams.get('n') ?? ''}`);
    } else if (u.pathname === '/flaky') {
      if (mode503-- > 0) {
        res.statusCode = 503;
        res.setHeader('retry-after', '0');
        res.end('busy');
      } else res.end('recovered');
    } else if (u.pathname === '/status') {
      res.statusCode = Number(u.searchParams.get('code'));
      res.end(`status ${res.statusCode}`);
    } else if (u.pathname === '/slow') {
      await delay(Number(u.searchParams.get('ms') ?? 100));
      res.end('slow');
    } else if (u.pathname === '/range') {
      const m = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range ?? ''));
      if (m) {
        const a = +m[1];
        const b = Math.min(+m[2], big.length - 1);
        res.statusCode = 206;
        res.setHeader('content-range', `bytes ${a}-${b}/${big.length}`);
        res.end(big.subarray(a, b + 1));
      } else res.end(big);
    } else if (u.pathname === '/norange') {
      res.end(big); // ignores Range
    } else if (u.pathname === '/huge') {
      res.setHeader('content-length', String(64 * 1024 * 1024));
      res.write(Buffer.alloc(1024));
      // never finishes: the client must abort after reading the headers
    } else if (u.pathname === '/echo') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ua: req.headers['user-agent'], url: req.url, method: req.method }));
    } else {
      res.statusCode = 404;
      res.end('nope');
    }
  });
});
afterAll(async () => {
  await server.close();
  resetHttpConfig();
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sunscan-http-'));
  configureHttp({ mode: 'live', cacheDir: path.join(dir, 'cache'), fixturesDir: path.join(dir, 'fixtures'), backoffBaseMs: 5, hostLimits: { ...HOST_LIMITS } });
  resetHttpState();
  server.requests.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const hits = (p: string) => server.requests.filter((r) => r.url.startsWith(p)).length;

describe('configuration', () => {
  it('parses modes and keeps an identifying User-Agent without personal data', () => {
    expect(parseHttpMode('REPLAY')).toBe('replay');
    expect(parseHttpMode(undefined)).toBe('live');
    expect(() => parseHttpMode('offline')).toThrow(/Invalid SUNSCAN_HTTP_MODE/);
    expect(DEFAULT_USER_AGENT).toBe('SunScanV2/0.1 (UK house 3D modeller)');
    expect(sanitizeUserAgent('MyApp/1.0 (contact: someone@example.org)')).toBe(DEFAULT_USER_AGENT);
    expect(sanitizeUserAgent('SunScanV2-test/1')).toBe('SunScanV2-test/1');
    expect(configureHttp({ userAgent: 'x a.b@c.de' }).userAgent).toBe(DEFAULT_USER_AGENT);
  });
  it('enforces the Nominatim policy (1 concurrent, >= 1 s apart) and Overpass/EA policies', () => {
    expect(HOST_LIMITS['nominatim.openstreetmap.org']).toMatchObject({ concurrency: 1 });
    expect(HOST_LIMITS['nominatim.openstreetmap.org'].minIntervalMs).toBeGreaterThanOrEqual(1000);
    expect(policyFor('overpass')).toMatchObject({ timeoutMs: 40_000, retries: 0 });
    expect(policyFor('ea-wcs').retryStatuses).not.toContain(500);
    expect(policyFor('anything').timeoutMs).toBe(15_000);
    setHttpMode('replay');
    expect(getHttpMode()).toBe('replay');
  });
});

describe('live mode', () => {
  it('serves the second request from the disk cache and sends our User-Agent', async () => {
    const a = await fetchCached({ url: `${server.url}/echo?q=1`, provider: 'test', headers: { 'User-Agent': 'evil@example.com' } });
    const b = await fetchCached({ url: `${server.url}/echo?q=1`, provider: 'test' });
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(hits('/echo')).toBe(1);
    expect(JSON.parse(Buffer.from(a.body).toString()).ua).toBe(DEFAULT_USER_AGENT);
    expect(b.headers['x-sunscan-source']).toBe('cache');
    expect(getHttpStats().test).toMatchObject({ network: 1, cache: 1 });
  });
  it('respects the TTL, never caches 5xx, caches 404 as negative result', async () => {
    await fetchCached({ url: `${server.url}/ok?n=1`, provider: 'test', ttlSec: 0 });
    await fetchCached({ url: `${server.url}/ok?n=1`, provider: 'test', ttlSec: 0 });
    expect(hits('/ok')).toBe(2);
    await fetchCached({ url: `${server.url}/status?code=500`, provider: 'test', retries: 0 });
    await fetchCached({ url: `${server.url}/status?code=500`, provider: 'test', retries: 0 });
    expect(hits('/status?code=500')).toBe(2);
    await fetchCached({ url: `${server.url}/status?code=404`, provider: 'test' });
    const r = await fetchCached({ url: `${server.url}/status?code=404`, provider: 'test' });
    expect(r.status).toBe(404);
    expect(hits('/status?code=404')).toBe(1);
  });
  it('retries 5xx with backoff (honouring Retry-After) and gives up after the configured retries', async () => {
    mode503 = 2;
    const r = await fetchCached({ url: `${server.url}/flaky`, provider: 'test' });
    expect(r.status).toBe(200);
    expect(hits('/flaky')).toBe(3);
    mode503 = 5;
    const r2 = await fetchCached({ url: `${server.url}/flaky?x`, provider: 'test', retries: 1 });
    expect(r2.status).toBe(503);
    expect(hits('/flaky?x')).toBe(2);
    mode503 = 0;
  });
  it('does not retry statuses outside the provider policy (EA 500 = outside coverage)', async () => {
    const r = await fetchCached({ url: `${server.url}/status?code=500&ea`, provider: 'ea-wcs' });
    expect(r.status).toBe(500);
    expect(hits('/status?code=500&ea')).toBe(1);
  });
  it('turns timeouts and connection failures into HttpError after retries', async () => {
    await expect(fetchCached({ url: `${server.url}/slow?ms=400`, provider: 'test', timeoutMs: 50, retries: 1 })).rejects.toThrow(/timeout/);
    expect(hits('/slow')).toBe(2);
    await expect(fetchCached({ url: 'http://127.0.0.1:9/nothing', provider: 'test', retries: 0 })).rejects.toBeInstanceOf(HttpError);
  });
  it('supports byte ranges (206), slices bodies when the server ignores Range, refuses huge ignored ranges', async () => {
    const r = await fetchCached({ url: `${server.url}/range`, provider: 'test', range: [10, 19] });
    expect(r.status).toBe(206);
    expect([...r.body]).toEqual([...big.subarray(10, 20)]);
    const s = await fetchCached({ url: `${server.url}/norange`, provider: 'test', range: [995, 2000] });
    expect(s.status).toBe(206);
    expect([...s.body]).toEqual([...big.subarray(995)]);
    expect(s.headers['content-range']).toBe('bytes 995-999/1000');
    await expect(fetchCached({ url: `${server.url}/huge`, provider: 'test', range: [0, 9], retries: 0 })).rejects.toThrow(/ignored Range/);
    await expect(fetchCached({ url: `${server.url}/range`, provider: 'test', range: [5, 1] })).rejects.toThrow(/invalid byte range/);
  });
  it('limits per-host concurrency to 2 and paces requests per host', async () => {
    await Promise.all([1, 2, 3, 4, 5, 6].map((i) => fetchCached({ url: `${server.url}/slow?ms=60&i=${i}`, provider: 'test' })));
    expect(server.maxActive()).toBeLessThanOrEqual(2);
    configureHttp({ hostLimits: { ...HOST_LIMITS, [server.host]: { concurrency: 1, minIntervalMs: 120 } } });
    server.requests.length = 0;
    await Promise.all([1, 2, 3].map((i) => fetchCached({ url: `${server.url}/ok?pace=${i}`, provider: 'test' })));
    // arrival times at the server: the gate spaces the request *starts* 120 ms apart, connection set-up adds jitter
    // under load (a busy test runner delayed one arrival by ~30 ms), unpaced requests would arrive ~1–5 ms apart
    const t = server.requests.map((r) => r.t).sort((x, y) => x - y);
    expect(t[1] - t[0]).toBeGreaterThanOrEqual(70);
    expect(t[2] - t[1]).toBeGreaterThanOrEqual(70);
    expect(t[2] - t[0]).toBeGreaterThanOrEqual(180);
  });
  it('deduplicates identical in-flight requests and keeps fragments out of the wire request', async () => {
    await Promise.all([1, 2, 3].map(() => fetchCached({ url: `${server.url}/slow?ms=50&dedupe`, provider: 'test' })));
    expect(hits('/slow?ms=50&dedupe')).toBe(1);
    const r = await fetchCached({ url: `${server.url}/echo?f=1#etag=abc`, provider: 'test' });
    expect(JSON.parse(Buffer.from(r.body).toString()).url).toBe('/echo?f=1');
    expect(requestKey('GET', 'http://a/b#x')).not.toBe(requestKey('GET', 'http://a/b'));
    expect(requestKey('POST', 'http://a', 'x')).not.toBe(requestKey('POST', 'http://a', 'y'));
    expect(requestKey('GET', 'http://a', undefined, [0, 9])).not.toBe(requestKey('GET', 'http://a', undefined, [0, 10]));
  });
});

describe('record and replay', () => {
  it('records responses as <provider>/<sha1>.json + .bin and replays them without network', async () => {
    setHttpMode('record');
    const url = `${server.url}/ok?n=rec`;
    const live = await fetchCached({ url, provider: 'demo.provider' });
    const p = entryPaths(getHttpConfig().fixturesDir, 'demo.provider', requestKey('GET', url));
    const meta = JSON.parse(await readFile(p.json, 'utf8'));
    expect(meta).toMatchObject({ schema: 'sunscan.http/1', provider: 'demo.provider', status: 200, url, bytes: live.body.byteLength });
    expect(meta.headers.etag).toBe('"v1"');
    expect(Buffer.from(await readFile(p.bin)).toString()).toBe('hello rec');
    setHttpMode('replay');
    const before = server.requests.length;
    const again = await fetchCached({ url, provider: 'demo.provider' });
    expect(server.requests.length).toBe(before);
    expect(Buffer.from(again.body).toString()).toBe('hello rec');
    expect(again.fromCache).toBe(true);
    expect(again.headers['x-sunscan-source']).toBe('fixture');
  });
  it('fails loudly on a replay miss with a descriptive error', async () => {
    setHttpMode('replay');
    const err = await fetchCached({ url: `${server.url}/ok?n=missing`, provider: 'nominatim', range: [0, 9] }).catch((e) => e);
    expect(err).toBeInstanceOf(ReplayMissError);
    expect(err.message).toMatch(/nominatim GET .*\/ok\?n=missing \[bytes 0-9\]/);
    expect(err.message).toMatch(/SUNSCAN_HTTP_MODE=record/);
    expect(server.requests.length).toBe(0);
  });
  it('records failures and status errors so failover sequences replay identically', async () => {
    setHttpMode('record');
    await fetchCached({ url: `${server.url}/status?code=504`, provider: 'overpass' });
    await expect(fetchCached({ url: 'http://127.0.0.1:9/down', provider: 'overpass' })).rejects.toBeInstanceOf(HttpError);
    setHttpMode('replay');
    expect((await fetchCached({ url: `${server.url}/status?code=504`, provider: 'overpass' })).status).toBe(504);
    await expect(fetchCached({ url: 'http://127.0.0.1:9/down', provider: 'overpass' })).rejects.toBeInstanceOf(HttpError);
  });
  it('record mode reuses existing fixtures and the live cache', async () => {
    const url = `${server.url}/ok?n=reuse`;
    await fetchCached({ url, provider: 'test' }); // live -> cache
    setHttpMode('record');
    const r = await fetchCached({ url, provider: 'test' });
    expect(r.headers['x-sunscan-source']).toBe('cache');
    expect(hits('/ok?n=reuse')).toBe(1);
    const again = await fetchCached({ url, provider: 'test' });
    expect(again.headers['x-sunscan-source']).toBe('fixture');
  });
  it('peekCached never touches the network', async () => {
    const url = `${server.url}/ok?n=peek`;
    expect(await peekCached({ url, provider: 'test' })).toBeNull();
    expect(hits('/ok?n=peek')).toBe(0);
    await fetchCached({ url, provider: 'test' });
    expect((await peekCached({ url, provider: 'test' }))?.status).toBe(200);
    setHttpMode('replay');
    expect(await peekCached({ url, provider: 'test' })).toBeNull();
  });
});
