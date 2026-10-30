import { expect, test, type Page } from '@playwright/test';

/**
 * What a search engine or a link preview sees of the website: share tags,
 * canonical URLs, the share image, robots.txt, the sitemap and the manifest.
 *
 * The suite builds the site without NEXT_PUBLIC_SITE_URL, so it describes
 * production: every absolute URL is on https://heysunny.co.uk.
 */

const MARKETING_PORT = Number(process.env.MARKETING_PORT ?? 4176);
const SITE = 'https://heysunny.co.uk';

test.use({ baseURL: `http://localhost:${MARKETING_PORT}` });

const PAGES = [
  { path: '/', title: 'Meet Sunny, your brightest employee' },
  { path: '/product', title: 'Product' },
  { path: '/meet-sunny', title: 'Meet Sunny' },
  { path: '/how-it-works', title: 'How it works' },
  { path: '/integrations', title: 'Integrations' },
  { path: '/pricing', title: 'Pricing' },
  { path: '/resources', title: 'Resources' },
  { path: '/privacy', title: 'Privacy policy' },
  { path: '/terms', title: 'Terms of service' },
];

const meta = (page: Page, key: string) =>
  page.locator(`meta[property="${key}"], meta[name="${key}"]`).first().getAttribute('content');

test('the home page carries a full link preview', async ({ page }) => {
  await page.goto('/');

  expect(await meta(page, 'og:title')).toBe('Meet Sunny, your brightest employee');
  expect(await meta(page, 'og:description')).toMatch(/solar installers/);
  expect(await meta(page, 'og:url')).toBe(SITE);
  expect(await meta(page, 'og:site_name')).toBe('Sunny');
  expect(await meta(page, 'og:locale')).toBe('en_GB');
  expect(await meta(page, 'og:type')).toBe('website');
  expect(await meta(page, 'og:image')).toMatch(new RegExp(`^${SITE}/opengraph-image\\.png`));
  expect(await meta(page, 'og:image:width')).toBe('1200');
  expect(await meta(page, 'og:image:height')).toBe('630');
  expect(await meta(page, 'og:image:alt')).toMatch(/Sunny/);
  expect(await meta(page, 'twitter:card')).toBe('summary_large_image');
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(SITE);
});

test('every public page has its own canonical URL and preview title', async ({ page }) => {
  for (const { path, title } of PAGES) {
    await page.goto(path);
    const url = path === '/' ? SITE : `${SITE}${path}`;
    expect(await page.locator('link[rel="canonical"]').getAttribute('href'), path).toBe(url);
    expect(await meta(page, 'og:url'), path).toBe(url);
    expect(await meta(page, 'og:title'), path).toContain(title);
    expect(await meta(page, 'og:image'), path).toMatch(/opengraph-image\.png/);
  }
});

test('the share image is a 1200x630 PNG', async ({ page, request }) => {
  await page.goto('/');
  const image = new URL((await meta(page, 'og:image')) ?? '');
  const response = await request.get(image.pathname + image.search);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/png');
  const bytes = await response.body();
  // The PNG header's IHDR chunk holds the width and height, big-endian.
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
});

test('the home page describes the organisation for search engines', async ({ page }) => {
  await page.goto('/');
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const graph = blocks.flatMap((text) => {
    const data = JSON.parse(text) as { '@graph'?: unknown[] };
    return data['@graph'] ?? [data];
  }) as { '@type': string; name?: string; url?: string }[];
  expect(graph).toContainEqual(
    expect.objectContaining({ '@type': 'Organization', name: 'Sunny', url: `${SITE}/` }),
  );
  expect(graph).toContainEqual(expect.objectContaining({ '@type': 'WebSite', url: `${SITE}/` }));
});

test('robots.txt lets the site be crawled, keeps the dashboard out and names the sitemap', async ({
  request,
}) => {
  const text = await (await request.get('/robots.txt')).text();
  expect(text).toMatch(/^Allow: \/$/m);
  expect(text).toMatch(/^Disallow: \/dashboard$/m);
  expect(text).toMatch(/^Disallow: \/api\/$/m);
  expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
});

test('the sitemap lists every public page', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  for (const { path } of PAGES) {
    const url = path === '/' ? SITE : `${SITE}${path}`;
    expect(xml, path).toContain(`<loc>${url}</loc>`);
  }
  expect(xml).not.toContain('/dashboard');
});

test('the web manifest names Sunny in its colours', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (await request.get(href ?? '')).json()) as Record<string, unknown>;
  expect(manifest).toMatchObject({ name: 'Sunny', short_name: 'Sunny', theme_color: '#ff7900' });
  expect(await meta(page, 'theme-color')).toBe('#ff7900');
});
