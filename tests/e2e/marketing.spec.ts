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

  // The body is a `<circle>`, painted with the canonical orange and outlined in
  // the character's ink. Selecting it specifically rather than "the first
  // painted element" matters: the rays are drawn first and are stroke-only, so a
  // naive selector finds `fill: none` and would pass for any shape at all.
  //
  // Read through `expect.poll`, and that is not defensive padding. The frame
  // loop replaces the stage's markup about thirty times a second, so a node
  // located a moment ago can be detached by the time it is read -- and a
  // detached element has no computed style at all, so the read comes back
  // empty. That is how this test failed the first time it ran alongside the rest
  // of the suite: it passed alone and returned an empty string in the full run.
  // Polling retries the read, and because an empty string cannot match the
  // colours, a read that lost the race is retried rather than silently accepted.
  const paint = (): Promise<string> =>
    hero
      .locator('circle')
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return `${style.fill.toLowerCase()} / ${style.stroke.toLowerCase()}`;
      });

  await expect.poll(paint, { timeout: 15_000 }).toMatch(/255,\s*121,\s*0.*23,\s*23,\s*23/);
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

test('publishes no pricing, and says so', async ({ page }) => {
  await page.goto('/');

  const pricing = page.locator('#pricing');
  await expect(pricing).toBeVisible();

  // A currency symbol or a per-month figure anywhere in the pricing section
  // would be a price this repository has no authority to state. The plan forbids
  // inventing one, so the assertion is that none has appeared by accident.
  const text = (await pricing.innerText()).toLowerCase();
  expect(text).not.toMatch(/£|\$|€|\bper month\b|\bpm\b/);
  await expect(pricing).toContainText(/have not published one yet/i);
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
