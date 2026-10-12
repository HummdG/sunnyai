import { decodeEntities, htmlToMarkdown } from '@sunny/knowledge';

import type { Fetcher } from './fetcher.js';
import { parseRobots, type RobotsRules } from './robots.js';

/**
 * Crawling an installer's website into Markdown pages (Blueprint §2, §3.1).
 *
 * Sitemap first, because it is the site owner's own list of what matters and it
 * reaches pages no menu links to; breadth-first link following from the home
 * page as the fallback and the supplement. Same site only (the `www.` and bare
 * host count as one), robots.txt honoured, a page cap, a depth cap, and a small
 * worker pool so a crawl never hammers the installer's hosting.
 */

export interface CrawledPage {
  url: string;
  title: string;
  markdown: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  failed: { url: string; reason: string }[];
  disallowed: string[];
  skipped: { url: string; reason: string; needsExtraction: boolean }[];
  /** True when the crawl stopped at the page cap rather than running out of links. */
  truncated: boolean;
}

export interface CrawlOptions {
  startUrl: string;
  fetcher: Fetcher;
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
}

const SKIP_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|zip|gz|rar|mp4|mov|avi|mp3|wav|woff2?|ttf|eot|xml|rss|atom)(\?|$)/i;

function sameSite(a: URL, b: URL): boolean {
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, '');
  return bare(a.hostname) === bare(b.hostname) && a.protocol === b.protocol;
}

function normalise(raw: string, base: string): URL | null {
  try {
    const url = new URL(decodeEntities(raw.trim()), base);
    url.hash = '';
    // Tracking parameters make one page look like many.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    return url;
  } catch {
    return null;
  }
}

function linksIn(html: string, base: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = match[2] ?? match[3] ?? match[4] ?? '';
    if (/^(mailto|tel|javascript|data):/i.test(href) || href.startsWith('#')) continue;
    const url = normalise(href, base);
    if (url) out.push(url.toString());
  }
  return out;
}

function locsIn(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1] ?? ''));
}

async function readRobots(origin: string, fetcher: Fetcher): Promise<RobotsRules> {
  try {
    const page = await fetcher(`${origin}/robots.txt`);
    if (page.status === 200) return parseRobots(page.body);
  } catch {
    // Unreachable robots.txt allows everything, by convention.
  }
  return parseRobots('');
}

async function readSitemaps(
  roots: string[],
  start: URL,
  fetcher: Fetcher,
  limit: number,
): Promise<string[]> {
  const urls: string[] = [];
  const queue = [...roots];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < 10 && urls.length < limit) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    try {
      const page = await fetcher(next);
      if (page.status !== 200) continue;
      const locs = locsIn(page.body);
      if (/<sitemapindex/i.test(page.body)) queue.push(...locs);
      else {
        for (const loc of locs) {
          const url = normalise(loc, start.toString());
          if (url && sameSite(url, start)) urls.push(url.toString());
        }
      }
    } catch {
      // A broken sitemap is not a broken site; link following still runs.
    }
  }
  return urls.slice(0, limit);
}

export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? 200;
  const maxDepth = options.maxDepth ?? 4;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  const start = new URL(options.startUrl);
  start.hash = '';
  const origin = start.origin;
  const { fetcher } = options;

  const robots = await readRobots(origin, fetcher);
  const sitemapRoots = robots.sitemaps.length > 0 ? robots.sitemaps : [`${origin}/sitemap.xml`];
  const fromSitemap = await readSitemaps(sitemapRoots, start, fetcher, maxPages);

  const result: CrawlResult = {
    pages: [],
    failed: [],
    disallowed: [],
    skipped: [],
    truncated: false,
  };
  const queued = new Set<string>();
  const queue: { url: string; depth: number }[] = [];
  const enqueue = (url: string, depth: number): void => {
    if (queued.has(url)) return;
    const parsed = new URL(url);
    if (!sameSite(parsed, start) || SKIP_EXTENSIONS.test(parsed.pathname)) return;
    if (!robots.allowed(parsed.pathname + parsed.search)) {
      queued.add(url);
      result.disallowed.push(url);
      return;
    }
    if (queued.size - result.disallowed.length >= maxPages) {
      result.truncated = true;
      return;
    }
    queued.add(url);
    queue.push({ url, depth });
  };

  enqueue(start.toString(), 0);
  for (const url of fromSitemap) enqueue(url, 1);

  const seenBodies = new Set<string>();
  async function worker(): Promise<void> {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const page = await fetcher(item.url);
        if (page.status !== 200) {
          result.failed.push({ url: item.url, reason: `HTTP ${page.status}` });
          continue;
        }
        const type = page.contentType.toLowerCase();
        if (type.includes('pdf')) {
          result.skipped.push({
            url: item.url,
            reason: 'PDF: text extraction is not available in this pipeline yet',
            needsExtraction: true,
          });
          continue;
        }
        let title: string | null = null;
        let markdown: string;
        if (type.includes('html') || /^\s*<(!doctype|html)/i.test(page.body)) {
          const converted = htmlToMarkdown(page.body, page.url);
          title = converted.title;
          markdown = converted.markdown;
          if (item.depth < maxDepth) {
            for (const link of linksIn(page.body, page.url)) enqueue(link, item.depth + 1);
          }
        } else if (type.includes('text/plain') || type.includes('markdown')) {
          markdown = page.body.trim();
        } else {
          result.skipped.push({
            url: item.url,
            reason: `Unsupported content type ${type || 'unknown'}`,
            needsExtraction: false,
          });
          continue;
        }
        // The same page served under two URLs (a trailing slash, a query string)
        // is one page.
        if (markdown === '' || seenBodies.has(markdown)) continue;
        seenBodies.add(markdown);
        result.pages.push({ url: item.url, title: title ?? new URL(item.url).pathname, markdown });
      } catch (error) {
        result.failed.push({
          url: item.url,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Workers drain a queue that grows as pages are read; re-run until it is empty.
  while (queue.length > 0) {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }
  result.pages.sort((a, b) => (a.url < b.url ? -1 : 1));
  return result;
}
