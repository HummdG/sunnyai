import { expect, test, type Page } from '@playwright/test';

/**
 * The widget on a page whose phone has a cutout, and on a page whose installer's
 * API is not answering.
 *
 * §6.2 asks for the launcher to respect safe areas, and §11.2 for the host page
 * to keep working when Sunny fails. Both are claims about a browser rather than
 * about a function, so they are checked here.
 *
 * The two are in one file because they share a fixture and a reason: the widget
 * must be *peripheral* to the page it lives on. A cutout it ignores is a control
 * the visitor cannot reach; an outage it turns into an exception is a page the
 * installer's site broke. Neither is visible in a unit test of the widget, and
 * both are the reason the embed is a script tag rather than a framework.
 */

const PUBLIC_ID = 'w_demo000001';
const HOST = `[data-sunny-widget="${PUBLIC_ID}"]`;
const LAUNCHER = 'button[aria-label="Open the solar assistant"]';
const PANEL = '[role="dialog"][aria-label="Solar assistant"]';

/** The API the demo page points the widget at. */
const API = (url: URL): boolean => url.port === String(process.env.API_PORT ?? 8787);

/** The widget's own box, in viewport coordinates, freshly laid out. */
async function hostRect(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.locator(HOST).evaluate((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

/**
 * Console errors and uncaught exceptions that are *not* the widget's requests
 * failing on purpose.
 *
 * An aborted request is this file's fixture working, not a fault: the browser
 * logs `Failed to load resource: net::ERR_FAILED` for each one while the widget
 * catches every one of them. What must not appear is anything else -- an
 * uncaught exception, or a console warning about a value the widget mishandled
 * -- which is the difference between "the page survived" and "the page survived
 * quietly".
 */
function collectUnexpectedErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('ERR_FAILED') || text.includes('Failed to load resource')) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return errors;
}

async function openWidget(page: Page): Promise<void> {
  await page.locator(HOST).locator(LAUNCHER).click();
  await expect(page.locator(HOST).locator(PANEL)).toBeVisible();
}

/** Ask the assistant something, through the composer a visitor would use. */
async function ask(page: Page, text: string): Promise<void> {
  const panel = page.locator(HOST).locator(PANEL);
  await panel.locator('.composer-input').fill(text);
  await panel.locator('.composer-send').click();
}

// ── the device cutout ──────────────────────────────────────────────────────

test('the launcher keeps its gutter clear of the device cutout', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('the browser is not reporting a viewport');

  // The control, and the value the WordPress fixture also measures: with the
  // platform reporting no cutout -- which is every desktop browser, this one
  // included -- the launcher sits the plain 20px gutter in from each edge.
  const plain = await hostRect(page);
  expect(plain.x + plain.width).toBeCloseTo(viewport.width - 20, 0);
  expect(plain.y + plain.height).toBeCloseTo(viewport.height - 20, 0);

  // Now say a cutout is there. `env(safe-area-inset-*)` cannot be made nonzero
  // from a test, and a notched device cannot be conjured in CI -- so the test
  // sets the custom property the widget's own `env()` feeds, which is the same
  // channel a host page in a webview or a native shell would use, and measures
  // the arithmetic rather than the browser's idea of a notch. The widget adds
  // the inset to the gutter; it does not replace the gutter with it.
  await page.locator(HOST).evaluate((node) => {
    node.style.setProperty('--sunny-safe-right', '48px');
    node.style.setProperty('--sunny-safe-bottom', '48px');
  });

  const inset = await hostRect(page);
  expect(inset.x + inset.width).toBeCloseTo(viewport.width - 20 - 48, 0);
  expect(inset.y + inset.height).toBeCloseTo(viewport.height - 20 - 48, 0);
  // And the launcher is still whole and on screen, just further in.
  expect(inset.width).toBeCloseTo(plain.width, 0);
  expect(inset.y).toBeGreaterThan(0);
  expect(inset.x).toBeGreaterThan(0);
});

test('the gutter narrows on a small screen and the cutout still adds to it', async ({ page }) => {
  // The breakpoint that used to restate the `inset` shorthands in plain pixels,
  // which would have dropped the cutout on exactly the screens most likely to
  // have one. It changes the gutter now, and the cutout terms survive it.
  await page.setViewportSize({ width: 380, height: 720 });
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();

  const plain = await hostRect(page);
  expect(plain.x + plain.width).toBeCloseTo(380 - 12, 0);
  expect(plain.y + plain.height).toBeCloseTo(720 - 12, 0);

  await page.locator(HOST).evaluate((node) => {
    node.style.setProperty('--sunny-safe-bottom', '34px');
  });

  const inset = await hostRect(page);
  expect(inset.y + inset.height).toBeCloseTo(720 - 12 - 34, 0);
  // Only the bottom edge was told about a cutout, so only the bottom edge moved.
  expect(inset.x + inset.width).toBeCloseTo(380 - 12, 0);
});

// ── the Sunny API is down ──────────────────────────────────────────────────

test('the host page is untouched when the Sunny API is the thing that is down', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);

  // Every call the widget makes fails at the network, which is what a Sunny
  // outage looks like from an unrelated installer's site. The widget *bundle*
  // still loads, because it comes from the host's own script tag rather than
  // from the API -- the failure being tested is the API's, not the CDN's.
  await page.route(API, (route) => route.abort('failed'));
  await page.goto('/');

  // The page is a page first: its own script ran, and its own navigation works.
  // The demo's status line reads the same API the widget does, so it is an
  // independent witness that the outage is real.
  await expect(page.locator('#api-status')).toContainText('API is not running');
  await expect(page.locator('h1')).toBeVisible();
  await page.locator('nav a[href="#pricing"]').click();
  await expect(page).toHaveURL(/#pricing$/);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // The widget still mounts and still opens. The character is never gated on a
  // network call, so an outage costs the installer's copy -- the header falls
  // back to the built-in name -- and not the widget.
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeVisible();
  await openWidget(page);
  const panel = page.locator(HOST).locator(PANEL);
  await expect(panel.locator('.header .name')).toHaveText('Sunny');
  await expect(panel.locator('.header .name')).not.toHaveText(/northwind/i);
  await expect(panel.locator('.turn.assistant').first()).toContainText('Ask me about solar');

  // And when the visitor asks something, it fails honestly in the panel --
  // where they are looking -- rather than silently or in the console.
  await ask(page, 'How much for ten panels?');
  await expect(panel.locator('.turn.error')).toContainText('cannot reach the assistant');

  expect(errors).toEqual([]);
});

test('a session outage costs the conversation, not the branding', async ({ page }) => {
  const errors = collectUnexpectedErrors(page);

  // The config route answers; the session route does not. A visitor then gets a
  // widget wearing the installer's own name, colour and suggestions, and no
  // assistant behind it -- which is the state that has to be honest rather than
  // the state that has to be hidden.
  await page.route(
    (url) => API(url) && url.pathname.startsWith('/v1/widget/session'),
    (route) => route.abort('failed'),
  );
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
  await openWidget(page);

  const panel = page.locator(HOST).locator(PANEL);
  await expect(panel.locator('.header .name')).toHaveText(/northwind/i);
  await expect(panel.locator('.suggestions button').first()).toBeVisible();

  await ask(page, 'How much for ten panels?');
  await expect(panel.locator('.turn.error')).toContainText('cannot reach the assistant');

  expect(errors).toEqual([]);
});

test('an outage mid-conversation ends the turn instead of hanging it', async ({ page }) => {
  const errors = collectUnexpectedErrors(page);

  // The API is up when the widget mounts -- session, options and all -- and dies
  // on the first message. This is the failure a visitor is most likely to meet,
  // and the one a widget with no error path hangs on: a typing indicator that
  // never stops and a send button that never comes back.
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
  await openWidget(page);

  await page.route(
    (url) => API(url) && url.pathname.startsWith('/v1/chat/stream'),
    (route) => route.abort('failed'),
  );

  const panel = page.locator(HOST).locator(PANEL);
  await ask(page, 'How much for ten panels?');

  await expect(panel.locator('.turn.error')).toBeVisible();
  await expect(panel.locator('.typing')).toHaveCount(0);
  // The turn is over rather than still pending: the composer is no longer busy,
  // which is what stops the typing indicator from being a lie.
  await expect(panel.locator('.composer-input')).toHaveAttribute('aria-busy', 'false');

  // And the page it lives on never noticed.
  expect(errors).toEqual([]);
});
