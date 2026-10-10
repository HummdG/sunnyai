import { expect, test, type Page } from '@playwright/test';

/**
 * The widget on a Next.js site.
 *
 * The plan asks for three host fixtures -- plain HTML, React and Next.js -- and
 * this is the third. It is not redundant with the React fixture: Next adds a
 * layer of its own on top of React's hoisting, and its recommended integration
 * (`next/script`) creates the script element after hydration rather than during
 * the server render. An integrator's first attempt at a Next site will use one
 * of these two routes, so both are driven here.
 *
 * What is asserted is deliberately the same on both: one widget, visible, on the
 * body, named from the API, openable. A host fixture earns its place by failing
 * when that stops being true, not by asserting more.
 */

const PUBLIC_ID = 'w_demo000001';
const HOST = `[data-sunny-widget="${PUBLIC_ID}"]`;
const LAUNCHER = 'button[aria-label="Open the solar assistant"]';
const PANEL = '[role="dialog"][aria-label="Solar assistant"]';

test.use({ baseURL: `http://localhost:${process.env.NEXT_PORT ?? 4175}` });

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

/** Every route below has to reach the same end state, so it is asserted once. */
async function expectAMountedWidget(page: Page): Promise<void> {
  const host = page.locator(HOST);
  await expect(host.locator(LAUNCHER)).toBeVisible();
  await expect(host).toHaveCount(1);

  // The rule from D-13, re-checked here because Next is the host that used to
  // break it: React hoists the snippet into the head, and the widget must place
  // its own host on the body regardless.
  const parent = await host.evaluate((node) => node.parentElement?.tagName ?? null);
  expect(parent).toBe('BODY');

  await host.locator(LAUNCHER).click();
  await expect(host.locator(PANEL)).toBeVisible();
}

test('mounts from the documented snippet, unmodified', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await expectAMountedWidget(page);
  expect(errors).toEqual([]);
});

test('mounts through next/script, which creates the element after hydration', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/script');
  await expectAMountedWidget(page);
  expect(errors).toEqual([]);
});

test('names itself from the API on a statically rendered page', async ({ page }) => {
  await page.goto('/');
  const name = page.locator(HOST).locator('.header .name');
  await expect(name).toHaveText(/northwind/i);
  // "Sunny" is the shell's built-in fallback, so its presence would mean the
  // config request never landed -- a static page that looks fine and is not.
  await expect(name).not.toHaveText(/^sunny$/i);
});

test('navigating between routes client-side leaves one widget, not two', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeVisible();

  // A Next `<Link>` is a client-side navigation: the App Router swaps the page
  // component without a document load. The second route mounts its own snippet,
  // so this is the dedupe rule (D-13) exercised through a router rather than by
  // removing a tag by hand.
  await page.getByRole('link', { name: 'next/script' }).click();
  await expect(page.getByRole('heading', { name: /next\/script/ })).toBeVisible();

  await expect(page.locator(HOST)).toHaveCount(1);
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeVisible();
});
