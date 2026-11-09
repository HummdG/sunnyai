import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * The widget for an installer who has uploaded their own logo.
 *
 * The demo tenant is Sunny, so its config is fetched for real and a brand is
 * added on the way back: everything else (the session, the chat) stays the real
 * path. The images are drawn here rather than committed, so what the fixture is
 * -- a dark tile with a lime bar, its mask, a wide wordmark -- is readable in the
 * file that depends on it.
 */

const PUBLIC_ID = 'w_demo000001';
const HOST = `[data-sunny-widget="${PUBLIC_ID}"]`;
const BRAND_DIR = `/v1/widget/brand/${PUBLIC_ID}`;
const ICON_ID = '0123456789abcdef';
const WORDMARK_ID = 'fedcba9876543210';

/** A PNG of `w`×`h` whose pixel colours come from `paint`. */
function png(w: number, h: number, paint: (x: number, y: number) => number[]): Buffer {
  const image = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = paint(x, y);
      image.data[i] = r!;
      image.data[i + 1] = g!;
      image.data[i + 2] = b!;
      image.data[i + 3] = a!;
    }
  }
  return PNG.sync.write(image);
}

const LIME = [163, 230, 53, 255];
const DARK = [24, 28, 36, 255];
const lime = (x: number, y: number, w: number, h: number) =>
  y > h * 0.4 && y < h * 0.6 && x > w * 0.15 && x < w * 0.85;

const ICON = png(64, 64, (x, y) => (lime(x, y, 64, 64) ? LIME : DARK));
const MASK = png(64, 64, () => [255, 255, 255, 255]);
const WORDMARK = png(240, 48, (x, y) => (lime(x, y, 240, 48) ? LIME : DARK));

const BRAND = {
  icon: {
    path: `${BRAND_DIR}/${ICON_ID}.png`,
    maskPath: `${BRAND_DIR}/${ICON_ID}-mask.png`,
    width: 64,
    height: 64,
    outline: null,
  },
  wordmark: { path: `${BRAND_DIR}/${WORDMARK_ID}.png`, width: 240, height: 48 },
  effects: ['shimmer', 'charge', 'segments'],
  colors: { primary: '#a3e635', glow: '#ecfccb' },
};

/** Serve the fixture images for the brand paths. */
async function stubImages(page: Page): Promise<void> {
  await page.route('**/v1/widget/brand/**', (route) => {
    const url = route.request().url();
    const body = url.endsWith('-mask.png') ? MASK : url.includes(WORDMARK_ID) ? WORDMARK : ICON;
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' },
      body,
    });
  });
}

/** The real config, with `brand` and a name set (or `brand` taken away). */
async function stubConfig(page: Page, brand: unknown): Promise<void> {
  await page.unroute('**/v1/widget/config/*');
  await page.route('**/v1/widget/config/*', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    if (brand === undefined) delete config['brand'];
    else Object.assign(config, { brand, assistantName: 'Nova' });
    await route.fulfill({ response, json: config });
  });
}

/**
 * Note on `window.__sawSunny` whether the Sunny character is ever in the
 * widget, and on `window.__sawPending` whether the launcher was ever held back,
 * from the very first frame of the page. Checked every animation frame, which
 * is how often the widget draws.
 */
async function watchForSunny(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __sawSunny: boolean; __sawPending: boolean };
    w.__sawSunny = false;
    w.__sawPending = false;
    const look = (): void => {
      const root = document.querySelector('[data-sunny-widget]')?.shadowRoot;
      if (root?.querySelector('.svg-host svg')) w.__sawSunny = true;
      if (root?.querySelector('.launcher.pending')) w.__sawPending = true;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}

const sawSunny = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sawSunny: boolean }).__sawSunny);
const sawPending = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sawPending: boolean }).__sawPending);

/** The config, answered only after `ms`, with `brand` added (or not). */
async function slowConfig(page: Page, brand: unknown, ms: number): Promise<void> {
  await page.unroute('**/v1/widget/config/*');
  await page.route('**/v1/widget/config/*', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, unknown>;
    if (brand !== undefined) Object.assign(config, { brand, assistantName: 'Nova' });
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fulfill({ response, json: config });
  });
}

/** The header logo's `data-logo-effect` values, recorded as they change. */
async function recordEffects(page: Page): Promise<void> {
  await page.locator(HOST).evaluate((host) => {
    const avatar = host.shadowRoot!.querySelector<HTMLElement>('.header .avatar')!;
    const seen: string[] = [avatar.dataset['logoEffect'] ?? ''];
    (window as unknown as { __effects: string[] }).__effects = seen;
    new MutationObserver(() => {
      const now = avatar.dataset['logoEffect'] ?? '';
      if (seen.at(-1) !== now) seen.push(now);
    }).observe(avatar, { attributes: true, attributeFilter: ['data-logo-effect'] });
  });
}

const effects = (page: Page) =>
  page.evaluate(() => (window as unknown as { __effects: string[] }).__effects);

/** A canned answer, held back a moment so the assistant is visibly busy. */
async function stubTurn(page: Page): Promise<void> {
  const frame = (event: Record<string, unknown>): string =>
    `data: ${JSON.stringify({ messageId: 'm_e2e', ...event })}\n\n`;
  await page.route('**/v1/chat/stream', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body:
        frame({ type: 'message_started' }) +
        frame({ type: 'text_delta', text: 'Most homes save on their bills.' }) +
        frame({ type: 'message_finished' }),
    });
  });
}

/** Open the panel, wait for the animated logo in the header, and send a message. */
async function driveTurn(page: Page): Promise<void> {
  const host = page.locator(HOST);
  await host.locator('button.launcher').click();
  const panel = host.locator('[role="dialog"]');
  await expect(panel).toBeVisible();
  await expect(host.locator('.header .avatar')).toHaveAttribute('data-logo-effect', 'still');
  await recordEffects(page);
  await panel.locator('.composer-input').fill('Will solar save me money?');
  await panel.locator('.composer-send').click();
  await expect(panel).toContainText('save on their bills.');
}

test.beforeEach(async ({ page }) => {
  await stubImages(page);
});

test('shows the logo on the launcher, and never Sunny', async ({ page }) => {
  await watchForSunny(page);
  await stubConfig(page, BRAND);
  await page.goto('/');

  const launcher = page.locator(HOST).locator('button.launcher');
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute('aria-label', 'Open Nova');
  // The plain image first, then the animated view drawn over the same pixels.
  await expect(launcher.locator('.logo-host')).toHaveAttribute('data-logo-effect', 'still');

  await launcher.click();
  const panel = page.locator(HOST).locator('[role="dialog"]');
  await expect(panel).toHaveAttribute('aria-label', 'Nova, solar assistant');
  const wordmark = panel.locator('.header .name img');
  await expect(wordmark).toHaveAttribute('alt', /northwind/i);
  await expect(wordmark).toHaveAttribute('src', new RegExp(`${WORDMARK_ID}\\.png$`));
  await expect(panel.locator('.header .tagline')).toBeVisible();

  await page.waitForTimeout(500);
  expect(await sawSunny(page)).toBe(false);
});

test('the launcher logo says hello once when the page loads, then stays still', async ({
  page,
}) => {
  await stubConfig(page, BRAND);
  await page.goto('/');
  const launcher = page.locator(HOST).locator('button.launcher .logo-host');
  // One effect pass, then back to the logo at rest, without anyone chatting.
  await expect(launcher).not.toHaveAttribute('data-logo-effect', 'still', { timeout: 10_000 });
  await expect(launcher).toHaveAttribute('data-logo-effect', 'still', { timeout: 10_000 });
  await page.waitForTimeout(3000);
  await expect(launcher).toHaveAttribute('data-logo-effect', 'still');
});

test('the launcher logo sits on a chip, so it reads over any page', async ({ page }) => {
  await stubConfig(page, { ...BRAND, plate: 'dark' });
  await page.goto('/');
  const launcher = page.locator(HOST).locator('button.launcher');
  await expect(launcher).toHaveAttribute('data-plate', 'dark');
  expect(await launcher.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    'rgb(29, 33, 41)',
  );
});

test('animates the header logo while busy, and stills it after', async ({ page }) => {
  await stubConfig(page, BRAND);
  await stubTurn(page);
  await page.goto('/');
  await driveTurn(page);

  await expect.poll(() => effects(page)).toEqual(expect.arrayContaining(['still']));
  const seen = await effects(page);
  expect(seen.some((effect) => effect !== 'still')).toBe(true);
  for (const effect of seen) expect(['still', ...BRAND.effects]).toContain(effect);
  await expect(page.locator(HOST).locator('.header .avatar')).toHaveAttribute(
    'data-logo-effect',
    'still',
    { timeout: 15_000 },
  );
});

test('a second visit shows the logo even when the config cannot be read', async ({ page }) => {
  await stubConfig(page, BRAND);
  await page.goto('/');
  await expect(page.locator(HOST).locator('button.launcher .logo-host')).toBeAttached();

  await watchForSunny(page);
  await page.unroute('**/v1/widget/config/*');
  await page.route('**/v1/widget/config/*', (route) => route.abort());
  await page.reload();

  const launcher = page.locator(HOST).locator('button.launcher');
  await expect(launcher).toBeVisible();
  await expect(launcher.locator('.logo-host img, .logo-host svg')).toHaveCount(1);
  await expect(launcher).toHaveAttribute('aria-label', 'Open Nova');
  // The header is never left blank: the remembered wordmark names it.
  await expect(page.locator(HOST).locator('.header .name img.wordmark')).toHaveAttribute(
    'alt',
    'Nova',
  );
  await page.waitForTimeout(500);
  expect(await sawSunny(page)).toBe(false);
});

test('a config without a brand forgets the logo, so the next visit is Sunny', async ({ page }) => {
  await stubConfig(page, BRAND);
  await page.goto('/');
  await expect(page.locator(HOST).locator('button.launcher .logo-host')).toBeAttached();

  await stubConfig(page, undefined);
  await page.reload();
  await expect(page.locator(HOST).locator('.launcher .svg-host svg')).toBeAttached();

  // Remembered as Sunny, not forgotten: the next visit shows Sunny at once,
  // without holding the launcher back for a config that is slow to answer.
  const remembered = await page.evaluate(
    (id) => localStorage.getItem(`sunny:brand:${id}`),
    PUBLIC_ID,
  );
  expect(remembered).toBe('"sunny"');

  await watchForSunny(page);
  await slowConfig(page, undefined, 3000);
  await page.reload();
  const launcher = page.locator(HOST).locator('button.launcher');
  await expect(launcher.locator('.svg-host svg')).toBeAttached({ timeout: 1500 });
  await expect(launcher).toBeVisible({ timeout: 1500 });
  await expect(launcher.locator('.logo-host')).toHaveCount(0);
  expect(await sawPending(page)).toBe(false);
});

test('a returning visitor whose icon will not load sees a plain disc, never Sunny', async ({
  page,
}) => {
  await stubConfig(page, BRAND);
  await page.goto('/');
  await expect(page.locator(HOST).locator('button.launcher .logo-host')).toBeAttached();

  await watchForSunny(page);
  await page.unroute('**/v1/widget/config/*');
  await page.route('**/v1/widget/config/*', (route) => route.abort());
  await page.unroute('**/v1/widget/brand/**');
  await page.route('**/v1/widget/brand/**', (route) => route.fulfill({ status: 404 }));
  await page.reload();

  const launcher = page.locator(HOST).locator('button.launcher');
  const disc = launcher.locator('.logo-fallback');
  await expect(disc).toBeVisible();
  await expect(disc).toHaveCSS('background-color', 'rgb(163, 230, 53)');
  await expect(launcher).toBeVisible();
  const box = await launcher.boundingBox();
  expect(box?.width).toBeGreaterThan(40);
  await page.waitForTimeout(500);
  expect(await sawSunny(page)).toBe(false);
});

test('a slow first visit shows Sunny after the wait, then the logo once it arrives', async ({
  page,
}) => {
  await watchForSunny(page);
  await slowConfig(page, BRAND, 5000);
  await page.goto('/');

  const launcher = page.locator(HOST).locator('button.launcher');
  // Held back while the config may still name a logo...
  await page.waitForTimeout(2000);
  expect(await sawSunny(page)).toBe(false);
  await expect(launcher).toBeHidden();
  // ...then Sunny once the ~4 s wait is over, before the config has answered...
  await expect(launcher.locator('.svg-host svg')).toBeAttached({ timeout: 2800 });
  await expect(launcher).toBeVisible();
  // ...and the logo in Sunny's place when it does.
  await expect(launcher.locator('.logo-host')).toBeAttached({ timeout: 5000 });
  await expect(launcher.locator('.svg-host')).toHaveCount(0);
  await expect(launcher).toHaveAttribute('aria-label', 'Open Nova');
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('only ever shimmers', async ({ page }) => {
    await stubConfig(page, BRAND);
    await stubTurn(page);
    await page.goto('/');
    await driveTurn(page);

    await page.waitForTimeout(500);
    for (const effect of await effects(page)) expect(['shimmer', 'still']).toContain(effect);
  });
});
