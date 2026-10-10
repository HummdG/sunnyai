import { expect, test, type Page } from '@playwright/test';

/**
 * The widget on a page that React owns.
 *
 * The plain-HTML demo proves the snippet works when a page author pastes it into
 * markup. It cannot prove the thing this file exists for: that the widget shares
 * a DOM with a framework. React removes the nodes it created and is disturbed by
 * nodes it did not, and the widget's script tag -- rendered from JSX, exactly as
 * an integrator would write it -- sits inside a React-managed element. So this is
 * where "insert the widget beside my script tag" either holds up or is wrong.
 *
 * The three shapes below fail differently and are therefore tested separately:
 * StrictMode's double-invocation, a re-render over a live widget, and a
 * route-change-style unmount and remount.
 */

const PUBLIC_ID = 'w_demo000001';
const HOST = `[data-sunny-widget="${PUBLIC_ID}"]`;
const LAUNCHER = 'button[aria-label="Open the solar assistant"]';
const PANEL = '[role="dialog"][aria-label="Solar assistant"]';

test.use({ baseURL: `http://localhost:${process.env.REACT_PORT ?? 4174}` });

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

/** Widgets the page thinks it has, according to the widget's own handle. */
async function handles(page: Page): Promise<number> {
  return page.evaluate(() => window.sunny?.widgets?.length ?? 0);
}

/** Widget hosts actually in the DOM -- the number a user would see. */
async function hostsInDom(page: Page): Promise<number> {
  return page.locator(HOST).count();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
});

test('mounts exactly once even though StrictMode renders the script tag twice', async ({
  page,
}) => {
  // StrictMode double-invokes effects in development, so a widget that mounts
  // from an effect gets asked twice. Two launchers stacked on top of one another
  // is the visible form of that bug, and it is invisible to every test that
  // loads the demo page instead.
  expect(await hostsInDom(page)).toBe(1);
  expect(await handles(page)).toBe(1);

  // The React tree is still intact underneath: React did not throw while
  // reconciling around a node it does not own.
  await expect(page.getByRole('heading', { name: /A React site/ })).toBeVisible();
});

test('survives a re-render with the widget mounted', async ({ page }) => {
  // This is the one that throws `NotFoundError: Failed to execute 'removeChild'`
  // when a child widget appends itself to a node React is managing.
  const rerender = page.getByTestId('rerender');
  for (let i = 0; i < 3; i += 1) await rerender.click();

  await expect(page.getByTestId('mount-log')).toContainText('re-render 3');
  expect(await hostsInDom(page)).toBe(1);
  expect(await handles(page)).toBe(1);

  // Still functional, not merely present.
  await page.locator(HOST).locator(LAUNCHER).click();
  await expect(page.locator(HOST).locator(PANEL)).toBeVisible();
});

test('a route-change unmount and remount leaves one widget, not two', async ({ page }) => {
  const toggle = page.getByTestId('toggle-mount');

  await toggle.click();

  // Removing the script tag does not tear the widget down, and that is the
  // documented behaviour rather than an oversight: the widget belongs to the
  // document, so a single-page app changing route under it leaves the assistant
  // where it was. React cannot remove the host either -- it never created it.
  await expect(page.locator(HOST)).toHaveCount(1);

  await toggle.click();

  // The remount loads the bundle a second time, so without the per-id guard this
  // is where a second launcher appears, stacked on the first.
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeVisible();
  expect(await hostsInDom(page)).toBe(1);
  expect(await handles(page)).toBe(1);
});

test('opens from React state through the window handle', async ({ page }) => {
  await page.getByTestId('open-widget').click();
  await expect(page.locator(HOST).locator(PANEL)).toBeVisible();
});

test('the whole React lifecycle runs without a console error', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.getByTestId('rerender').click();
  await page.getByTestId('toggle-mount').click();
  await page.getByTestId('toggle-mount').click();
  await page.locator(HOST).locator(LAUNCHER).click();
  await expect(page.locator(HOST).locator(PANEL)).toBeVisible();

  // React logs a warning rather than throwing when child removal misbehaves, and
  // a warning a customer sees in their console is a bug report to us either way.
  expect(errors).toEqual([]);
});
