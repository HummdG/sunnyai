import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { CATALOGUE, UNWIRED_GROUPS } from '@sunny/animation-engine';

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

  // A moment with no caller of any kind -- neither an engine event nor a gesture
  // the host forwards -- is implemented and tested and cannot be reached in
  // production. Hiding it would let that stay true unremarked; the gallery shows
  // it dashed, with the reason underneath.
  //
  // The count is of the *unwired* moments, which is a different list from the
  // unreachable ones: a gesture moment like the balloon is also unwired here,
  // because the widget does not forward a pointer yet, but it is not unreachable
  // in the sense the catalogue means -- something outside the engine asks for it.
  await expect(page.locator('#catalogue-card .moment.unwired')).toHaveCount(UNWIRED_GROUPS.length);
  for (const group of UNWIRED_GROUPS) {
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

/**
 * A05 in a browser: the one moment a visitor starts by hand.
 *
 * The engine tests prove `tap()` hit-tests the right thing at the right
 * coordinate. What only a browser can show is that the gesture *arrives* -- that
 * a pointer at a screen position becomes the viewBox coordinate the engine
 * reasons in, through the transform the browser actually applied and not one
 * this test re-derived. `stagePoint` converts with the same screen matrix the
 * lab does, so a lab whose conversion broke would fail here rather than only in
 * the eye.
 */
async function stagePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  // `#stage > svg` and not `#stage svg`: the stage's own `<svg>` holds the frame
  // the renderer produced, which is *another* `<svg>`. The lab reads the outer
  // one's screen matrix, so the test has to read the same one -- and it is the
  // same mapping either way, because the inner svg is laid out to fill exactly
  // the outer viewport.
  return page.locator('#stage > svg').evaluate(
    (node, viewBox) => {
      const ctm = (node as SVGSVGElement).getScreenCTM();
      if (!ctm) throw new Error('the stage svg has no screen ctm');
      const p = new DOMPoint(viewBox.x, viewBox.y).matrixTransform(ctm);
      return { x: p.x, y: p.y };
    },
    { x, y },
  );
}

test('gives her a balloon on a tap, and pops it on a second one', async ({ page }) => {
  await page.goto(LAB_URL);
  const balloon = page.locator('#stage [data-prop="balloon"]');
  const log = page.locator('#scrubber .event-log');
  await expect(balloon).toHaveCount(0);

  // A tap on the body. The body centre is the viewBox centre, which is the one
  // point on the stage that needs no arithmetic to locate.
  const body = await stagePoint(page, 100, 100);
  await page.mouse.click(body.x, body.y);
  await expect(balloon).toHaveCount(1);

  // Let it finish rising. The float eases into place over the first fifth of its
  // loop, so reading its position before then would read a balloon in flight.
  await page.waitForTimeout(2_000);

  // Tap the balloon where it is painted, rather than at a coordinate this test
  // worked out: the hit test is against the drawing, so the click should be too.
  //
  // The query and the rectangle are read in one page-side call, and not through
  // an element handle. The lab replaces the stage's markup on every animation
  // frame, so a handle obtained a moment ago is already detached and reports a
  // zero rectangle -- `boundingBox()` returns null for the same reason.
  const box = await page.evaluate(() => {
    const node = document.querySelector('#stage [data-prop="balloon"]');
    if (!node) return null;
    const rect = (node as SVGGraphicsElement).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  expect(box?.width ?? 0, 'the balloon is drawn but has no size on screen').toBeGreaterThan(0);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // The float is gone rather than drawn underneath its own shards. The log entry
  // is what makes this a claim about the pop rather than merely about absence:
  // it records what the tap produced, and outlives the burst itself.
  await expect(balloon).toHaveCount(0);
  await expect(log).toContainText('→ pop');
});

test('does nothing at all when the empty stage is tapped', async ({ page }) => {
  await page.goto(LAB_URL);

  // A corner of the viewBox: outside the silhouette and outside every ray, so
  // the one gesture a visitor can make by accident is a no-op.
  const corner = await stagePoint(page, 12, 12);
  await page.mouse.click(corner.x, corner.y);

  await expect(page.locator('#scrubber .event-log')).toContainText('nothing there');
});
