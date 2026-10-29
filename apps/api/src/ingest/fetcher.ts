import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Fetching pages from an installer's website, safely.
 *
 * The crawler fetches URLs that come from a tenant's own configuration and from
 * links on their pages -- which is to say, from outside. Without a guard, a
 * `website` connection pointed at `http://169.254.169.254/` (the cloud metadata
 * server) or `http://localhost:8787/v1/...` would turn the crawler into a way to
 * read the platform's own internals (SSRF). So every request is checked:
 * http(s) only, and the host must resolve to public addresses only.
 *
 * Tests inject a `Fetcher` instead; the guard wraps the real network one.
 */

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export type Fetcher = (url: string) => Promise<FetchedPage>;

export const USER_AGENT =
  'SunnyBot/1.0 (+https://heysunny.co.uk/bot; knowledge sync for the site owner)';

const MAX_BYTES = 3 * 1024 * 1024;

function privateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function privateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return privateV4(lower.slice(7));
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80')
  );
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return privateV4(ip);
  if (family === 6) return privateV6(ip);
  return true;
}

/** Throws unless `url` is http(s) and its host resolves only to public addresses. */
export async function assertPublicUrl(
  url: string,
  options: { resolve?: boolean } = {},
): Promise<URL> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs can be crawled, not ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(`Refusing to crawl internal host ${host}`);
  }
  // `resolve: false` checks literals and names only -- for tests whose hosts
  // are fake. Real requests always resolve, because a public-looking name can
  // point at a private address.
  if (!isIP(host) && options.resolve === false) return parsed;
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`Refusing to crawl ${host}: it resolves to a private address`);
  }
  return parsed;
}

/**
 * The real fetcher: SSRF-guarded, timed out, size-capped, and following
 * redirects by hand so every hop is checked against the same guard.
 */
export function networkFetcher(options: { timeoutMs?: number } = {}): Fetcher {
  const timeoutMs = options.timeoutMs ?? 15_000;
  return async (start: string): Promise<FetchedPage> => {
    let url = start;
    for (let hop = 0; hop < 5; hop++) {
      await assertPublicUrl(url);
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,text/plain,application/xml;q=0.9,*/*;q=0.5',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break;
        url = new URL(location, url).toString();
        continue;
      }
      const contentType = response.headers.get('content-type') ?? '';
      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > MAX_BYTES) {
        return { url, status: 413, contentType, body: '' };
      }
      const buffer = await response.arrayBuffer();
      const body = new TextDecoder().decode(
        buffer.byteLength > MAX_BYTES ? buffer.slice(0, MAX_BYTES) : buffer,
      );
      return { url, status: response.status, contentType, body };
    }
    return { url, status: 310, contentType: '', body: '' };
  };
}

/**
 * Optional: Jina Reader (`https://r.jina.ai/<url>`) renders JavaScript-heavy
 * pages to Markdown. Off unless `SUNNY_CRAWL_JINA=1`; never required. The target
 * URL is still checked by the guard before it is handed over.
 */
export function jinaFetcher(options: { apiKey?: string; timeoutMs?: number } = {}): Fetcher {
  const timeoutMs = options.timeoutMs ?? 30_000;
  return async (url: string): Promise<FetchedPage> => {
    await assertPublicUrl(url);
    const headers: Record<string, string> = { accept: 'text/plain', 'x-return-format': 'markdown' };
    if (options.apiKey) headers['authorization'] = `Bearer ${options.apiKey}`;
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      url,
      status: response.status,
      contentType: 'text/markdown',
      body: await response.text(),
    };
  };
}
