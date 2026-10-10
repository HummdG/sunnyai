import { expect, test } from '@playwright/test';

import { CATALOGUE, UNREACHABLE_GROUPS } from '@sunny/animation-engine';

/**
 * The animation catalogue, in a browser.
 *
 * The engine's own catalogue test proves each moment *would* be drawn, by
 * asking the scheduler. This proves it is drawn: the lab's `Play` button is the
 * only surface where a person can ask for a moment the way a stream event does
 * and watch the answer, and a card lights up only while its moment is the one
 * the scheduler drew. So "the catalogue and playable tests pass" is a claim
 * about something that was clicked rather than about something that was read.
 *
 * The lab is served on its own port by the `webServer` entry in
 * `playwright.config.ts`, rather than through `baseURL`, because it is a
 * developer surface rather than a host fixture.
 */

const LAB_URL = `http://localhost:${Number(process.env.LAB_PORT ?? 4180)}`;

const card = (group: string) => `#catalogue-card .moment[data-group="${group}"]`;

test('lists every catalogued moment, and only those', async ({ page }) => {
  await page.goto(LAB_URL);

  await expect(page.locator('#catalogue-card .moment')).toHaveCount(CATALOGUE.length);

  for (const entry of CATALOGUE) {
    const moment = page.locator(card(entry.group));
    await expect(moment, `${entry.group} is missing from the gallery`).toHaveCount(1);
    // The name on the page and the name in the catalogue are the same string,
    // so a moment cannot be renamed in one place and not the other.
    await expect(moment.locator('.moment-name')).toHaveText(entry.name);
    await expect(moment.locator('.moment-desc')).toHaveText(entry.description);
  }
});

test('marks the moments nothing asks for, rather than hiding them', async ({ page }) => {
  await page.goto(LAB_URL);

  // A moment with no caller is implemented and tested and cannot be reached in
  // production. Hiding it would let that stay true unremarked; the gallery shows
  // it dashed, with the reason underneath.
  await expect(page.locator('#catalogue-card .moment.unwired')).toHaveCount(
    UNREACHABLE_GROUPS.length,
  );
  for (const group of UNREACHABLE_GROUPS) {
    await expect(page.locator(card(group))).toHaveClass(/unwired/);
    await expect(page.locator(`${card(group)} .moment-why`)).not.toBeEmpty();
  }
});

test('plays every moment in the catalogue when it is asked for', async ({ page }) => {
  await page.goto(LAB_URL);

  for (const entry of CATALOGUE) {
    const moment = page.locator(card(entry.group));
    const play = moment.getByRole('button');
    await expect(play, `${entry.group} has no playable variant`).toBeEnabled();
    await play.click();

    // Asserted on the mark the page leaves for what it drew, not on the live
    // highlight. Several moments are on screen only briefly -- the listening
    // perk waits behind the 420 ms bubble the same event requests and is then
    // drawn for under a third of a second -- so sampling the class could miss a
    // moment that plays perfectly well and report it as broken. The generous
    // timeout is for the same reason: "eventually drawn" is the honest claim,
    // not "drawn on the next frame".
    await expect(moment, `"${entry.group}" was asked for and never drawn`).toHaveAttribute(
      'data-drawn',
      '1',
      { timeout: 10_000 },
    );
  }
});
