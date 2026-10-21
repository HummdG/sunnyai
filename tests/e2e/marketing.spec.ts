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

test('the hero replays its moment when the visitor points at it', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('[data-testid="hero-stage"]');
  // Let the arrival wave play out and settle on the still.
  await page.waitForTimeout(2_500);
  const before = await stage.innerHTML();

  await page.locator('.hero .scene').hover();

  await expect
    .poll(async () => stage.innerHTML(), { timeout: 15_000, intervals: [100] })
    .not.toBe(before);
});

test('mounts the real widget, not a picture of one', async ({ page }) => {
  await page.goto('/');

  // The launcher is inside the widget's shadow root, so finding it by role
  // proves the bundle executed rather than that a script tag was written out.
  const launcher = page.getByRole('button', { name: /open the solar assistant/i });
  await expect(launcher).toBeVisible();
  await expect(page.locator(HOST)).toHaveCount(1);

  await launcher.click();
  await expect(page.getByRole('dialog', { name: /solar assistant/i })).toBeVisible();
});

test('illustrates every section of every page with a scene of its own', async ({ page }) => {
  // The site's art direction: a crafted scene per section, each described in
  // words for anyone who cannot see it, rather than cameos with jokes.
  for (const path of [
    '/',
    '/product',
    '/meet-sunny',
    '/how-it-works',
    '/integrations',
    '/pricing',
    '/resources',
    '/privacy',
    '/terms',
  ]) {
    await page.goto(path);
    const scenes = page.locator('figure.scene');
    expect(await scenes.count(), path).toBeGreaterThan(0);
    for (const label of await scenes.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    )) {
      expect(label.length, `${path}: a scene without a description`).toBeGreaterThan(10);
    }
  }
});

test('shows the configured plans, with the headline the plan requires', async ({ page }) => {
  await page.goto('/');

  // Plan §6.1 names the hero headline exactly.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    /Meet Sunny\.\s*Your brightest employee\./,
  );

  // Prices are configuration (plan §15, `apps/marketing/app/site.ts`); the page
  // renders one card per configured plan, each with a monthly price in pounds:
  // Sunny sells to UK installers.
  const plans = page.locator('#pricing .plan');
  await expect(plans).toHaveCount(4);
  for (const plan of await plans.all()) {
    await expect(plan).toContainText(/£\d+/);
    await expect(plan).not.toContainText('$');
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

test('the waitlist form joins the real list, and only with consent', async ({ page }) => {
  await page.goto('/#waitlist');
  const section = page.locator('#waitlist');
  await expect(section.getByRole('heading', { name: 'Save your place' })).toBeVisible();
  await expect(section.locator('figure.scene')).toHaveCount(1);

  const email = `e2e-${Date.now()}@example.com`;
  await section.getByLabel('Work email').fill(email);
  await section.getByLabel(/Company/).fill('E2E Solar');

  // The browser holds the form until the box is ticked; nothing is sent.
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/v1/waitlist')) sent.push(r.method());
  });
  await section.getByRole('button', { name: 'Join the waitlist' }).click();
  await expect(section.getByRole('checkbox')).toBeFocused();
  expect(sent.filter((m) => m === 'POST')).toEqual([]);

  await section.getByRole('checkbox').check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/v1/waitlist') && r.request().method() === 'POST',
  );
  await section.getByRole('button', { name: 'Join the waitlist' }).click();
  expect((await response).status()).toBe(200);
  await expect(section.getByText('You’re on the list.')).toBeVisible();
  await expect(section.getByText(email)).toBeVisible();
});

// The owner's house style: no em dashes in anything a visitor reads.
test('no page uses an em dash', async ({ page }) => {
  for (const path of [
    '/',
    '/product',
    '/meet-sunny',
    '/how-it-works',
    '/integrations',
    '/pricing',
    '/resources',
    '/privacy',
    '/terms',
    '/sign-in',
    '/sign-up',
  ]) {
    await page.goto(path);
    const text = await page.evaluate(
      () => `${document.title}
${document.body.innerText}`,
    );
    expect(text.includes('—'), `${path} has an em dash`).toBe(false);
  }
});

test('the privacy policy and terms are complete, accessible and fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, sections] of [
    ['/privacy', 15],
    ['/terms', 17],
  ] as const) {
    await page.goto(path);
    // Every numbered section is there, and the contents list links to each.
    await expect(page.locator('.prose h2[id]')).toHaveCount(sections);
    for (const id of await page.locator('.prose h2[id]').evaluateAll((hs) => hs.map((h) => h.id))) {
      await expect(page.locator(`.prose ol a[href="#${id}"]`), `${path}#${id}`).toHaveCount(1);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).include('main').analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.help}`),
      path,
    ).toEqual([]);
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

  // The hero's two actions are next in reading order: getting started, and the
  // live chat with Sunny itself.
  await page.keyboard.press('Tab');
  const hero = page.locator('.hero');
  await expect(hero.getByRole('link', { name: /get started/i })).toBeVisible();
  await expect(hero.getByRole('button', { name: 'Chat with Sunny' })).toBeVisible();
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
