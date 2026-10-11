import { expect, test, type Page } from '@playwright/test';

import { FONT_FACES, FONT_FAMILY } from '@sunny/ui';

/**
 * The typeface, in a real browser.
 *
 * This file exists because of a defect that every other kind of test in this
 * repository would have called green. The first implementation declared an
 * `@font-face` inside the widget's shadow root: the unit tests checked the
 * string it produced, the build shipped the files, the headers served them —
 * and Chromium parsed the rule and never matched it, so no font was ever
 * requested and the panel was quietly set in the system font. Nothing failed.
 * A fallback is a plausible-looking page.
 *
 * So the claims that only a browser can settle are the ones here:
 *
 * - that the face is *applied*, measured as a difference in rendered width
 *   against a family that does not exist;
 * - that the file arrives from beside the widget's own script rather than from
 *   the API origin, which an integrator's CDN moves without telling us;
 * - that it is fetched before the panel is opened, which is what the eager load
 *   buys and what stops the face swapping in under the reader;
 * - that it survives a cross-origin request, which is the only way an embedded
 *   widget ever fetches its own font, and which the browser refuses outright
 *   without `access-control-allow-origin` on the response.
 *
 * The layout half of the same story — what the panel looks like when the face
 * does not arrive — is the last test in this file.
 */

const PUBLIC_ID = 'w_demo000001';
const HOST = `[data-sunny-widget="${PUBLIC_ID}"]`;
const LAUNCHER = 'button[aria-label="Open the solar assistant"]';
const PANEL = '[role="dialog"][aria-label="Solar assistant"]';

const DEMO_PORT = Number(process.env.DEMO_PORT ?? 4173);
const MARKETING_PORT = Number(process.env.MARKETING_PORT ?? 4176);

/** The subset this page's own English text needs; the other is for a visitor's words. */
const LATIN = FONT_FACES.find((face) => face.subset === 'latin')!;

/** A family no browser has, so setting it measures the fallback and nothing else. */
const MISSING_FAMILY = '"Sunny No Such Face"';

async function mount(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
}

/** Every font request the page made, by response status and URL. */
function collectFonts(page: Page): { status: number; url: string }[] {
  const fonts: { status: number; url: string }[] = [];
  page.on('response', (response) => {
    if ((response.headers()['content-type'] ?? '').startsWith('font/')) {
      fonts.push({ status: response.status(), url: response.url() });
    }
  });
  return fonts;
}

/**
 * The width of one run of text, set twice inside the widget's shadow root: once
 * in the family the widget names first, once in a family that does not exist.
 *
 * The second measurement is the control, and it is the whole design of this
 * probe. An unavailable family falls back to the browser's default font, so if
 * the brand face has *not* loaded the two measurements are the same number —
 * which is what makes this a test of "is the face in use" rather than of "is the
 * family named". Comparing against the widget's own fallback stack would not
 * work: a stack of one unknown name falls back to the default serif, not to the
 * generic sans after it, so the two would differ whether or not the face had
 * loaded, and the test would have passed against the very defect this file was
 * written for.
 *
 * The family is read off the widget's computed style rather than restated here.
 */
async function measureFace(page: Page): Promise<{ named: number; missing: number }> {
  return page.locator(HOST).evaluate((host, missing) => {
    const root = host.shadowRoot;
    if (!root) throw new Error('the widget is not in a shadow root');

    const stack = getComputedStyle(host)
      .fontFamily.split(',')
      .map((part) => part.trim());
    const [brand = ''] = stack;

    const probe = document.createElement('span');
    probe.textContent = 'Hamburgefonstiv 0123456789';
    probe.setAttribute(
      'style',
      'position:absolute;visibility:hidden;white-space:nowrap;font-size:16px;font-weight:650',
    );
    root.appendChild(probe);

    probe.style.fontFamily = brand;
    const named = probe.getBoundingClientRect().width;
    probe.style.fontFamily = missing;
    const missingWidth = probe.getBoundingClientRect().width;
    probe.remove();

    return { named, missing: missingWidth };
  }, MISSING_FAMILY);
}

test('renders the panel in the brand typeface', async ({ page }) => {
  await mount(page);

  // 650 is the weight the widget's own `.header .name` asks for, and the one a
  // static pair of files could not have served — it is the reason the shipped
  // face is a variable font. Polling rather than waiting a fixed time, because
  // the thing being waited for is a network fetch.
  await expect
    .poll(
      async () => {
        const { named, missing } = await measureFace(page);
        return named - missing;
      },
      {
        message:
          'the panel is being rendered in the fallback font: the brand family measures the same as a family that does not exist',
      },
    )
    .not.toBe(0);
});

test('fetches the typeface from beside its own script, before the panel is opened', async ({
  page,
}) => {
  const fonts = collectFonts(page);

  await mount(page);

  // Before the panel is opened, and that is the assertion rather than a detail
  // of timing: the launcher is an icon, so without the eager load the first
  // request would come when a visitor opens the panel and the face would swap
  // in under the reader, every session.
  await expect
    .poll(() => fonts.length, { message: 'no font was ever requested' })
    .toBeGreaterThan(0);

  for (const request of fonts) {
    expect(request.status, request.url).toBe(200);
    // The demo serves the bundle from `/widget/`, so its fonts are in
    // `/widget/fonts/` — the script's directory, which is what the widget
    // derives the URL from.
    expect(request.url).toContain(`/widget/fonts/${LATIN.file}`);
    // And specifically *not* the API origin, which the snippet also names and
    // which serves no files at all: reading the directory from `data-api-url`
    // is the mistake this pins (D-48).
    expect(request.url).not.toContain(':8787');
  }

  // Only the Latin subset: the page's own text is English, and the wider
  // subset is there for the words a *visitor* types. Loading both up front
  // would spend 21.7 kB on a guess.
  expect(fonts.map((request) => request.url)).toEqual([
    `http://localhost:${DEMO_PORT}/widget/fonts/${LATIN.file}`,
  ]);
});

test('serves the typeface to a page on another origin', async ({ page }) => {
  // The embedded case, in both directions: the fonts are fetched by a page that
  // is not the host serving them, which the browser allows only if the response
  // says so. The two hosts below are the two pieces of code that have to send
  // that header — `scripts/static-server.ts` for the fixtures, and
  // `apps/marketing/next.config.mjs` for the deployed site — and a missing
  // header fails this test as a rejected fetch rather than as a 404, which is
  // the shape the failure really has in a customer's console.
  const origins = [
    ['the demo host', `http://127.0.0.1:${DEMO_PORT}`],
    ['the marketing host', `http://127.0.0.1:${MARKETING_PORT}`],
  ] as const;

  await mount(page);

  for (const [label, origin] of origins) {
    const result = await page.evaluate(async (url: string) => {
      try {
        const response = await fetch(url);
        const body = await response.arrayBuffer();
        return { status: response.status, bytes: body.byteLength };
      } catch (error) {
        return { error: String(error) };
      }
    }, `${origin}/widget/fonts/${LATIN.file}`);

    expect(result, `${label} refused the font: ${JSON.stringify(result)}`).toMatchObject({
      status: 200,
      // The whole file, not an empty 200: a truncated or zero-length response
      // would decode as a broken font rather than as the right one.
      bytes: LATIN.bytes,
    });
  }
});

test('opens in the system stack when the typeface cannot be fetched', async ({ page }) => {
  // The designed failure. A typeface is an enhancement: it is fetched from a
  // host we do not control from a page we do not control, so it will sometimes
  // not arrive — and a widget that refuses to open because a font 404'd would
  // be trading the product for the letterforms.
  let blocked = 0;
  await page.route('**/widget/fonts/*.woff2', (route) => {
    blocked += 1;
    return route.abort();
  });

  await mount(page);
  await expect.poll(() => blocked, { message: 'the font was never requested' }).toBeGreaterThan(0);

  // The launcher is laid out and clickable, at a real size rather than a
  // collapsed one — text measured with a font that never arrived is still text.
  const launcher = page.locator(HOST).locator(LAUNCHER);
  const box = await launcher.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  await launcher.click();
  await expect(page.locator(HOST).locator(PANEL)).toBeVisible();

  // And the family is still named first, so a browser that has the face for some
  // other reason — a host page that happens to serve it, a later retry — still
  // gets it without anything else changing.
  const family = await page
    .locator(HOST)
    .evaluate((host) => getComputedStyle(host).fontFamily.split(',')[0]?.trim() ?? '');
  expect(family).toBe(`"${FONT_FAMILY}"`);
});
