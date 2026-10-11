import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { stubOptions } from './recommendation-fixture.js';

/**
 * Accessibility, run against the rendered widget rather than the source.
 *
 * The plan requires an axe pass (section 12). It is worth being explicit about
 * what that does and does not establish: axe finds *machine-detectable* faults --
 * a missing accessible name, an unlabelled form field, a contrast ratio below the
 * threshold, a dialog with no role. It cannot tell you whether the assistant is
 * understandable, whether the focus order is sensible, or whether the animation
 * is tolerable. Passing this is a floor, not a clean bill of health.
 *
 * Both states are audited because they are built from different DOM: the launcher
 * exists in both, but the panel's contents do not exist until it is opened, and an
 * audit of the closed widget would not see any of them.
 */

const HOST = '[data-sunny-widget="w_demo000001"]';
const LAUNCHER = 'button[aria-label="Open the solar assistant"]';
const PANEL = '[role="dialog"][aria-label="Solar assistant"]';

/**
 * Anything at `serious` or `critical` fails. `moderate` and `minor` are reported
 * but do not fail, because a widget whose accessibility gate trips on a
 * "best practice" nit gets the gate switched off, and then the real faults go
 * unnoticed too.
 */
function serious(results: Awaited<ReturnType<AxeBuilder['analyze']>>) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

function describeViolations(violations: ReturnType<typeof serious>): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
    )
    .join('\n');
}

async function audit(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).analyze();
  const failures = serious(results);
  expect(failures, describeViolations(failures)).toEqual([]);
  return results;
}

test('the closed widget has no serious violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
  await audit(page, HOST);
});

test('the open panel has no serious violations', async ({ page }) => {
  await page.goto('/');
  await page.locator(HOST).locator(LAUNCHER).click();
  await expect(page.locator(HOST).locator(PANEL)).toBeVisible();
  await audit(page, HOST);
});

test('the panel with a message typed has no serious violations', async ({ page }) => {
  // A state worth auditing separately: the send button is `disabled` until there
  // is text, and axe skips disabled controls for contrast -- so the enabled state
  // is the only one where the button's white glyph on the brand fill is checked
  // at all. The plain open-panel audit looks clean and would never notice.
  await page.goto('/');
  await page.locator(HOST).locator(LAUNCHER).click();
  await page.locator(HOST).locator('.composer textarea').fill('How much for a 4kW system?');
  await expect(page.locator(HOST).locator('.composer button')).toBeEnabled();
  await audit(page, HOST);
});

test('the panel with options on it has no serious violations', async ({ page }) => {
  // The option cards are the densest surface the widget has -- headings, a
  // definition of price provenance carried by colour, and two collapsed
  // disclosure blocks -- so they get their own audit rather than riding on the
  // empty-panel one. The response is stubbed because the e2e API has no model
  // credential and no seeded catalogue: the point is the rendered DOM, and
  // interception is what lets it exist in a browser at all.
  await stubOptions(page);
  await page.goto('/');
  await page.locator(HOST).locator(LAUNCHER).click();
  await expect(page.locator(HOST).locator('[data-option-id]')).toHaveCount(2);
  await audit(page, HOST);
});

test('the tenant brand colour is made legible before it is painted', async ({ page }) => {
  // The visitor's own chat bubbles are white on the brand colour, and the
  // suggestion chips are the brand colour on a pale tint. Both are the accent, so
  // both are covered by checking the value the widget derived from it.
  //
  // This runs in the browser because the derivation happens at mount, from the
  // colour the API returned: a unit test can prove the maths, not that the widget
  // applied it. A chat turn cannot be produced here -- with no model key the
  // widget refuses to invent an answer -- which is exactly why the colour is
  // checked directly rather than through a bubble.
  await page.goto('/');
  await page.locator(HOST).locator(LAUNCHER).click();

  const ink = await page
    .locator(HOST)
    .evaluate((host) => getComputedStyle(host).getPropertyValue('--sunny-accent-ink').trim());
  expect(ink).toMatch(/^#[0-9a-f]{6}$/i);

  const ratio = await page.evaluate((value) => {
    const channel = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const hex = value.replace('#', '');
    const rgb = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
    const luminance = (c: [number, number, number]) =>
      0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    const [a, b] = [luminance(rgb), luminance([255, 255, 255])].sort((x, y) => y - x) as [
      number,
      number,
    ];
    return (a + 0.05) / (b + 0.05);
  }, ink);

  // White is the harder of the two backgrounds the accent has to clear, so
  // clearing it covers the pale chip as well.
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('the launcher has an accessible name and a state', async ({ page }) => {
  await page.goto('/');
  const launcher = page.locator(HOST).locator(LAUNCHER);
  await expect(launcher).toBeAttached();

  // `toHaveAccessibleName` resolves the computed name, so this is the name a
  // screen reader would announce -- not merely the presence of the attribute.
  await expect(launcher).toHaveAccessibleName(/open the solar assistant/i);
  await expect(launcher).toHaveAttribute('aria-haspopup', 'dialog');
  // Present in the closed state, which is the state a screen reader most often
  // meets it in. `aria-expanded` on a control that opens something is a
  // meaningful state, not decoration.
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
});
