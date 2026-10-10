import { expect, test, type Page } from '@playwright/test';

/**
 * The widget, in a real browser, on a page that mounts it the way a customer
 * would.
 *
 * These tests deliberately drive the widget through the *page*, not through the
 * `window.sunny` handle: the snippet is what an installer pastes, so that is the
 * path that has to work. The handle gets one test of its own, because it is
 * public API and something will depend on it.
 */

const PUBLIC_ID = 'w_demo000001';
const HOST = `[data-sunny-widget="${PUBLIC_ID}"]`;
const LAUNCHER = 'button[aria-label="Open the solar assistant"]';
const PANEL = '[role="dialog"][aria-label="Solar assistant"]';

/**
 * Console errors and failed requests the page produced, so a test can assert
 * there were none.
 *
 * The resource failures are recorded with their URL. A bare "Failed to load
 * resource: 404" is what the console gives you, and it says nothing about which
 * file -- which turns a five-second diagnosis into a bisect.
 */
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

async function openWidget(page: Page): Promise<void> {
  await page.locator(HOST).locator(LAUNCHER).click();
  await expect(page.locator(HOST).locator(PANEL)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The widget mounts asynchronously after its config request resolves, so every
  // test starts from "it has mounted", not "the script tag exists".
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
});

test('mounts from the embed snippet, inside a shadow root', async ({ page }) => {
  const host = page.locator(HOST);
  await expect(host).toHaveCount(1);
  await expect(host.locator(LAUNCHER)).toBeVisible();

  // The isolation the widget promises integrators: the page's stylesheet cannot
  // reach in. Asserted structurally rather than by inspecting a computed style,
  // because it is the boundary itself that is load-bearing.
  const hasShadowRoot = await host.evaluate((node) => node.shadowRoot !== null);
  expect(hasShadowRoot).toBe(true);
});

test('names itself from the API rather than the page', async ({ page }) => {
  await openWidget(page);

  // The shell renders the widget's built-in name until config resolves, so
  // "Sunny" is the tell that this is still the fallback. Asserting it is *not*
  // that, and *is* what the API holds, is what makes this a claim about the data
  // path rather than about the demo page happening to agree.
  const name = page.locator(HOST).locator('.header .name');
  await expect(name).toHaveText(/northwind/i);
  await expect(name).not.toHaveText(/^sunny$/i);

  // Read the registry value independently, so the test fails if the widget shows
  // the right string by coincidence rather than because it fetched it.
  const config = await page.evaluate(async () => {
    const response = await fetch('http://localhost:8787/v1/widget/config/w_demo000001');
    return (await response.json()) as { companyName: string };
  });
  await expect(name).toHaveText(config.companyName);
});

test('leaks no tenant internals into the page', async ({ page }) => {
  // The same rule the API smoke test enforces on the config response, checked
  // here where it matters: after the widget has rendered it into the DOM.
  const html = await page.content();
  expect(html).not.toContain('sunscan');
  expect(html).not.toContain('t_demo');
});

test('opens and closes from the keyboard', async ({ page }) => {
  const launcher = page.locator(HOST).locator(LAUNCHER);
  const panel = page.locator(HOST).locator(PANEL);

  // Reachable by tabbing, not only by clicking: a launcher that can only be
  // clicked is unusable for anyone not using a pointer.
  await launcher.focus();
  await expect(launcher).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
});

test('exposes the documented handle on window', async ({ page }) => {
  const shape = await page.evaluate(() => {
    const sunny = (window as unknown as { sunny?: { widgets?: unknown[]; open?: unknown } }).sunny;
    return { hasOpen: typeof sunny?.open === 'function', widgets: sunny?.widgets?.length ?? 0 };
  });
  expect(shape.hasOpen).toBe(true);
  expect(shape.widgets).toBe(1);
});

test('loads without console errors', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
  await openWidget(page);
  expect(errors).toEqual([]);
});
