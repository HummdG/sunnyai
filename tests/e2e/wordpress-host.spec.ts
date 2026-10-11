import { expect, test, type Page } from '@playwright/test';

/**
 * The widget on a WordPress page.
 *
 * The plain-HTML fixture proves the snippet works on a tidy page. It cannot
 * prove the thing this file exists for, because our own demo page is written to
 * be friendly: it has no `!important` global rules, no plugin injecting styles
 * after load, no fixed banner in a corner and no wrapper around the snippet.
 * A WordPress site has all four, and §6.2 asks for WordPress by name.
 *
 * The page is a reproduction of a WordPress site's *output*, not WordPress
 * itself (see the header of `apps/widget-demo/public/wordpress.html`). What the
 * widget reacts to is the DOM and the cascade, and both are faithful here; the
 * PHP that would have produced them is not what changes the answer.
 *
 * Two rules govern the assertions. The first is that every isolation claim is
 * paired with a control: the theme and the plugin must be shown to be *live* --
 * visibly styling the page's own elements -- before the widget's immunity to
 * them means anything. A fixture whose CSS had stopped applying would otherwise
 * make every isolation test pass for the wrong reason. The second is that the
 * widget's position is measured in the viewport, after scrolling, rather than
 * read off a stylesheet: the snippet sits inside a theme wrapper that both
 * clips and transforms, which is exactly the ancestor that breaks a
 * `position: fixed` element mounted in the wrong place.
 */

const PUBLIC_ID = 'w_demo000001';
const HOST = `[data-sunny-widget="${PUBLIC_ID}"]`;
const LAUNCHER = 'button[aria-label="Open the solar assistant"]';
const PANEL = '[role="dialog"][aria-label="Solar assistant"]';

/** The theme's accent, from `wordpress-theme.css`. */
const THEME_BLUE = 'rgb(34, 113, 177)';

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

/** A computed style of an element on the host page. */
async function pageStyle(page: Page, selector: string, property: string): Promise<string> {
  return page.evaluate(
    ([sel, prop]) => {
      const element = document.querySelector(sel as string);
      if (!element) throw new Error(`no element for ${sel}`);
      return getComputedStyle(element).getPropertyValue(prop as string);
    },
    [selector, property],
  );
}

/** A computed style of an element *inside* the widget's shadow root. */
async function shadowStyle(page: Page, selector: string, property: string): Promise<string> {
  return page.evaluate(
    ([sel, prop]) => {
      const host = document.querySelector('[data-sunny-widget]');
      const root = host?.shadowRoot;
      if (!root) throw new Error('the widget has no shadow root');
      const element = root.querySelector(sel as string);
      if (!element) throw new Error(`no element in the shadow root for ${sel}`);
      return getComputedStyle(element).getPropertyValue(prop as string);
    },
    [selector, property],
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/wordpress.html');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
});

test('the theme and the plugin are really styling this page', async ({ page }) => {
  // The control the rest of the file depends on. A theme that stopped applying
  // -- a renamed class, a typo in the fixture, a stylesheet that 404s -- would
  // make every isolation test below pass without testing anything, and this is
  // the test that would fail first.
  const link = page.locator('.wp-block-button__link');

  // The theme's own button rule, which is the one the launcher would be wearing
  // if the shadow root were not doing its job.
  await expect(link).toHaveCSS('background-color', THEME_BLUE);

  // And the plugin's, from the stylesheet it injects into the head *after* load
  // -- later in the cascade than the theme, and `!important`, so it is the
  // strongest rule on the page. It flattens the page's own button corners.
  const injected = await page.evaluate(
    () => document.getElementById('harborough-plugin-inline-css') !== null,
  );
  expect(injected).toBe(true);
  await expect(link).toHaveCSS('border-radius', '0px');

  // The rule that matters most here is the one that matches the widget's host:
  // `body > div`, from both stylesheets. `#page` is the other body-child div on
  // the page, so it is where that selector is shown to be live -- the theme's
  // 1px border and the plugin's dashed style, in one element.
  const wrapper = page.locator('#page');
  await expect(wrapper).toHaveCSS('border-top-style', 'dashed');
  await expect(wrapper).toHaveCSS('border-top-width', '1px');

  // And the plugin's timer is really mutating the page while the widget is up.
  await expect(page.locator('.widget_block li')).toHaveCount(3);
  const renders = await page.evaluate(
    () => (window as unknown as { harborough?: { renders: number } }).harborough?.renders ?? 0,
  );
  expect(renders).toBeGreaterThan(0);
});

test('the page cannot style the widget from the outside', async ({ page }) => {
  // The theme's `button { border-radius: 999px !important }` and the plugin's
  // later `button { border-radius: 0 !important }` both match a `button`, and
  // the launcher is one. Inside the shadow root neither rule exists: the
  // launcher is a circle at its own radius and paints nothing of its own.
  expect(await shadowStyle(page, '.launcher', 'border-radius')).toContain('50%');
  expect(await shadowStyle(page, '.launcher', 'background-color')).toBe('rgba(0, 0, 0, 0)');

  await openWidget(page);

  // The panel is the widget's own surface, and its colour and radius are its
  // tokens rather than the theme's. Asserted by value rather than by "differs
  // from the theme", so a change to either side has to be a deliberate one.
  expect(await shadowStyle(page, '.panel', 'background-color')).toBe('rgb(255, 252, 248)');
  expect(await shadowStyle(page, '.panel', 'border-radius')).toBe('18px');
});

test('the theme cannot reach the widget’s host element either', async ({ page }) => {
  // The host is the one element of the widget that lives in the page's own tree,
  // so it is the only one the page's CSS can select -- and the theme has a rule
  // that matches it exactly: the host is a `<div>` appended to `<body>`, and the
  // page builder styles `body > div` with `!important`, including
  // `position: relative`, which would take a fixed widget out of the corner and
  // put it into the document flow.
  //
  // So this is the assertion that matters most in this file, and the one the
  // fixture was written to make: whatever the page says about `div`, the widget
  // keeps the box it needs. It did not, until the shadow root's `:host` block
  // was marked `!important` (D-36): measured against this fixture, the host came
  // back `position: relative`, painted `rgb(251, 251, 251)` with a 1px dashed
  // border and a 6px radius, and the launcher sat 20px further in from the
  // document's own corner rather than the viewport's. The theme is proven live
  // above -- on `#page`, which the same `body > div` rule also matches -- so
  // this passing cannot be a stylesheet that is not there.
  const host = page.locator(HOST);

  await expect(host).toHaveCSS('position', 'fixed');
  await expect(host).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(host).toHaveCSS('border-top-style', 'none');
  await expect(host).toHaveCSS('border-top-width', '0px');
  await expect(host).toHaveCSS('box-shadow', 'none');
  // The theme's font must not reach the widget's host either: it is the value
  // anything inside the shadow root inherits if it names no font of its own.
  await expect(host).toHaveCSS('font-family', /ui-sans-serif/);
  // `overflow: hidden` and a `transform` on an ancestor are what a fixed element
  // cannot survive, so a host that had inherited either is a broken widget.
  expect(await host.evaluate((node) => getComputedStyle(node).overflow)).toBe('visible');
  expect(await host.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
});

test('mounts on the body even though the snippet is inside the theme wrapper', async ({ page }) => {
  // `wp_footer` is rendered inside `#page` by this theme, so the snippet arrives
  // in the middle of the document, inside an element that is transformed and
  // clipping. A widget that inserted itself beside its script tag would be
  // pinned to that wrapper and cut off at its edge; the widget appends to the
  // body instead, which is what these two assertions are about.
  const host = page.locator(HOST);
  expect(await host.evaluate((node) => node.parentElement?.tagName ?? null)).toBe('BODY');
  expect(await host.evaluate((node) => node.closest('#page') === null)).toBe(true);

  // The wrapper that would have trapped it is real: it clips and transforms.
  expect(await pageStyle(page, '#page', 'overflow')).toBe('hidden');
  expect(await pageStyle(page, '#page', 'transform')).not.toBe('none');
});

test('stays in the viewport corner after the visitor scrolls to the bottom', async ({ page }) => {
  // Fixed positioning is the property a transformed ancestor breaks, and the
  // break is invisible at the top of the page: the widget sits where it should
  // until the page moves under it. Scrolling to the foot of the page and
  // measuring in the viewport is what tells the two apart.
  const host = page.locator(HOST);

  const before = await host.boundingBox();
  expect(before).not.toBeNull();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => window.scrollY > 0);

  const after = await host.boundingBox();
  expect(after).not.toBeNull();

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('the browser is not reporting a viewport');

  // Bottom-right, 20px in from each edge, and still on screen -- all of it.
  expect(after!.x + after!.width).toBeCloseTo(viewport.width - 20, 0);
  expect(after!.y + after!.height).toBeCloseTo(viewport.height - 20, 0);
  expect(after!.y).toBeGreaterThanOrEqual(0);
  expect(after!.x).toBeGreaterThanOrEqual(0);

  // It did not move with the page: the same viewport corner before and after.
  expect(after!.y).toBeCloseTo(before!.y, 0);
});

test('the launcher is what the visitor actually clicks', async ({ page }) => {
  // A WordPress page is never empty at the bottom of the screen: this one has a
  // consent banner fixed in the opposite corner at `z-index: 99999`. The claim
  // worth testing is not that the widget's z-index is a big number, it is that
  // the pixel the visitor aims at is the widget's -- so the test asks the
  // browser what is on top at that point.
  await expect(page.locator('#cookie-notice')).toBeVisible();

  const box = await page.locator(HOST).locator(LAUNCHER).boundingBox();
  if (!box) throw new Error('the launcher has no box');

  const topmost = await page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x as number, y as number);
      if (!element) return null;
      return element.closest('[data-sunny-widget]') !== null;
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(topmost).toBe(true);

  // And it is clickable, not merely on top: the same click the tests above use.
  await openWidget(page);
});

test('the plugins’ churn leaves exactly one working widget', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  // A full poll cycle of the plugin's timer, plus its own re-render.
  await page.waitForFunction(() => {
    const state = (window as unknown as { harborough?: { renders: number } }).harborough;
    return (state?.renders ?? 0) >= 2;
  });

  await expect(page.locator(HOST)).toHaveCount(1);
  await openWidget(page);

  // The host page's own global is still there: the widget does not leak onto
  // `window`, and nothing it did replaced the page's namespace.
  expect(
    await page.evaluate(
      () => (window as unknown as { harborough?: unknown }).harborough !== undefined,
    ),
  ).toBe(true);

  expect(errors).toEqual([]);
});
