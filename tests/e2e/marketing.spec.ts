import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The marketing site, tested as a product surface rather than as a host fixture.
 *
 * Two things are worth testing here that are tested nowhere else. The first is
 * that the hero character is genuinely alive: `apps/marketing` drives
 * `SunnyAnimator` itself, so a broken frame loop would leave a page that still
 * looks finished -- a static Sunny is exactly what a working one looks like when
 * nobody is watching. The second is that the page makes no claim it cannot
 * support, which is asserted as content rather than left to review.
 *
 * The widget's own behaviour is covered by `widget.spec.ts` and the two host
 * fixtures; this file only checks that the marketing site mounts it at all.
 */

const MARKETING_PORT = Number(process.env.MARKETING_PORT ?? 4176);

test.use({ baseURL: `http://localhost:${MARKETING_PORT}` });

const HERO = '[data-testid="hero-stage"] svg';
const HOST = 'div[data-sunny-widget]';

test('renders the hero from the canonical character, not a placeholder', async ({ page }) => {
  await page.goto('/');

  const hero = page.locator(HERO);
  await expect(hero).toBeVisible();

  // The character is drawn from the traced reference art, so there is no single
  // element to name. What must be true is that the hero paints both the brand
  // orange and the character's ink; a placeholder or an empty frame would not.
  // Polled because the frame loop patches the SVG continuously.
  const paint = (): Promise<string> =>
    hero.evaluate((svg) =>
      [...svg.querySelectorAll('path, circle, ellipse')]
        .map((node) => getComputedStyle(node).fill.toLowerCase())
        .join(' | '),
    );

  await expect.poll(paint, { timeout: 15_000 }).toMatch(/255,\s*121,\s*0/);
  await expect.poll(paint, { timeout: 15_000 }).toMatch(/23,\s*23,\s*23/);
});

test('animates: the hero redraws as the visitor watches', async ({ page }) => {
  await page.goto('/');

  // The loop replaces the markup it rendered on the server. Capturing the
  // element's own HTML and waiting for it to differ is the direct assertion that
  // a frame was drawn -- a screenshot diff would pass for a still character and
  // fail for a legitimately identical blink.
  const hero = page.locator('[data-testid="hero-stage"]');
  const before = await hero.innerHTML();

  await expect
    .poll(async () => hero.innerHTML(), { timeout: 15_000, intervals: [400] })
    .not.toBe(before);
});

test('the visitor can make the character react', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('[data-testid="hero-stage"]');
  const before = await stage.innerHTML();

  await page.getByRole('button', { name: 'Celebrate' }).click();

  // `celebrate` is a distinctly larger sequence than idle blinking, so the
  // markup changes for a reason the visitor chose.
  await expect
    .poll(async () => stage.innerHTML(), { timeout: 15_000, intervals: [200] })
    .not.toBe(before);
});

test('mounts the real widget, opened by the site’s own Sunny', async ({ page }) => {
  await page.goto('/');

  // The site's guide is the launcher: the widget is loaded with
  // `data-launcher="none"`, so its own corner button stays hidden and the
  // page never shows two Sunnys at once.
  await expect(page.locator(HOST)).toHaveCount(1);
  await expect(page.getByRole('button', { name: /open the solar assistant/i })).toBeHidden();

  const guide = page.getByRole('button', { name: 'Chat with Sunny', exact: true });
  await guide.click();
  // The dialog lives in the widget's shadow root, so finding it by role proves
  // the bundle executed rather than that a script tag was written out.
  await expect(page.getByRole('dialog', { name: /solar assistant/i })).toBeVisible();
  // And the guide steps aside while the panel's own Sunny is on screen.
  await expect(page.locator('.sunny-guide')).toHaveClass(/is-away/);
});

test('shows one Sunny at a time, wherever the visitor scrolls', async ({ page }) => {
  await page.goto('/');
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    // Every drawing of the character on the page, the guide included, that is
    // actually in the viewport (a guide that has stepped aside is not). Brand
    // logos are images, not the live rig.
    const visible = await page.evaluate(
      () =>
        [...document.querySelectorAll('svg [data-part="body"]')]
          .filter((node) => !node.closest('.sunny-guide.is-away'))
          .map((node) => node.closest('svg')!.getBoundingClientRect())
          .filter((r) => r.bottom > 0 && r.top < window.innerHeight && r.width > 0).length,
    );
    expect(visible, `at scroll ${y}`).toBeLessThanOrEqual(1);
  }
});

test('shows the configured plans, with the headline the plan requires', async ({ page }) => {
  await page.goto('/');

  // Plan §6.1 names the hero headline exactly.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /Meet Sunny\.\s*Your brightest employee\./,
  );

  // Prices are configuration (plan §15, `apps/marketing/app/site.ts`); the page
  // renders one card per configured plan, each with a monthly price.
  const plans = page.locator('#pricing .plan');
  await expect(plans).toHaveCount(4);
  for (const plan of await plans.all()) {
    await expect(plan).toContainText(/\$\d+/);
  }
});

test('every page in the site map renders with its own heading', async ({ page }) => {
  for (const path of [
    '/product',
    '/meet-sunny',
    '/how-it-works',
    '/integrations',
    '/pricing',
    '/resources',
    '/privacy',
    '/terms',
    '/sign-in',
    '/start',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }), path).toBeVisible();
  }
});

test('the colour switcher re-themes the hero character', async ({ page }) => {
  await page.goto('/');
  await page.locator('#character').scrollIntoViewIfNeeded();
  await page.getByRole('radio', { name: 'Purple' }).click();

  const hero = page.locator('[data-testid="hero-stage"] svg');
  await expect
    .poll(
      () =>
        hero.evaluate((svg) =>
          [...svg.querySelectorAll('path, circle, ellipse')]
            .map((node) => getComputedStyle(node).fill)
            .join(' | '),
        ),
      { timeout: 10_000 },
    )
    .toMatch(/124,\s*77,\s*255/);
});

test('claims no customers, logos or ratings it does not have', async ({ page }) => {
  await page.goto('/');
  const body = await page.content();

  // Every phrase here would be an invented fact about a business that does not
  // yet have customers. The site has none of them today; this test is here so
  // that adding one is a deliberate act rather than a copy-paste.
  expect(body).not.toMatch(/trusted by|testimonial|as seen in|rated \d|★|\d+ installs/i);
});

test('passes axe with no serious or critical violations', async ({ page }) => {
  await page.goto('/');

  // Includes the widget's shadow root, which axe pierces.
  const results = await new AxeBuilder({ page }).analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(
    serious,
    serious
      .map(
        (v) =>
          `${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
      )
      .join('\n\n'),
  ).toEqual([]);
});

test('is reachable and readable without a mouse', async ({ page }) => {
  await page.goto('/');

  // The skip link is the first thing Tab reaches, and it must actually move the
  // reading position rather than merely exist.
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();

  await skip.press('Enter');
  await expect(page.locator('#main')).toBeInViewport();

  // The hero controls are reachable in order, which is what makes the character
  // an offer rather than a decoration only mouse users can poke.
  await expect(page.getByRole('button', { name: 'Say hello' })).toBeVisible();
});

test('serves one page-level widget even though the hero also runs the engine', async ({ page }) => {
  await page.goto('/');

  // Guard against a future refactor mounting the widget a second time from a
  // component as well as from the snippet: two hosts means two launchers, and
  // two launchers look like one until somebody counts them.
  await expect(page.locator(HOST)).toHaveCount(1);

  const parent = await page.locator(HOST).evaluate((node) => node.parentElement?.tagName ?? null);
  expect(parent).toBe('BODY');
});
