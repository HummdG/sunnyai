import { expect, test, type Page } from '@playwright/test';

import { stubOptions } from './recommendation-fixture.js';

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

test('mounts on the body, wherever the snippet was pasted', async ({ page }) => {
  // The demo page happens to put the snippet at the end of <body>, which is the
  // one placement where mounting *beside* the script tag would also look right.
  // Pinning the parent is what stops the widget from drifting back to a rule
  // that breaks the two placements that matter -- a snippet in <head>, and a
  // framework that hoists an async script there itself.
  const parent = await page.locator(HOST).evaluate((node) => node.parentElement?.tagName ?? null);
  expect(parent).toBe('BODY');
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
    // The API the page's own embed snippet names -- the one the widget used --
    // rather than a hard-coded port that another server may be holding.
    const snippet = document.querySelector<HTMLScriptElement>('script[data-api-url]');
    const api = snippet?.dataset['apiUrl'] ?? 'http://localhost:8787';
    const response = await fetch(`${api}/v1/widget/config/w_demo000001`);
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

/**
 * The number of frames the launcher's art went through while the pointer was
 * held down.
 *
 * The widget redraws the character with `innerHTML` every frame whose rig
 * differs, so the node under a held pointer is replaced repeatedly. This counts
 * those replacements, so a test can hold the pointer across one deliberately
 * rather than hoping a frame lands inside a synthetic click.
 */
async function framesDuringHold(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const art = document
          .querySelector<HTMLElement>(`[data-sunny-widget]`)
          ?.shadowRoot?.querySelector('.launcher .svg-host');
        if (!art) {
          resolve(0);
          return;
        }
        // The art animates by patching its SVG in place (attributes) and only
        // occasionally replaces a node, so either kind of change counts as the
        // picture moving under the pointer.
        let redraws = 0;
        const observer = new MutationObserver((records) => {
          redraws += records.length;
        });
        observer.observe(art, { childList: true, subtree: true, attributes: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(redraws);
        }, 400);
      }),
  );
}

/**
 * A press that outlives the picture it started on.
 *
 * This is the shape of a real click: a person holds the button for a few
 * hundred milliseconds, and the launcher's art is replaced many times in that
 * window. The first version of the widget drew the character straight into the
 * element the pointer was over, so `mousedown` and `mouseup` landed on
 * different, by-then-removed nodes -- and the browser dispatches no `click` at
 * all when that happens. The launcher was present, hoverable and completely
 * inert: it did nothing when pressed, in every browser, while a 1ms synthetic
 * click in this file usually passed by landing between two frames.
 *
 * The assertion is deliberately about the press *and* the redraws, so the test
 * cannot quietly stop exercising the bug if the animation ever stops redrawing
 * the launcher.
 */
test('opens from a press held across the animation', async ({ page }) => {
  const launcher = page.locator(HOST).locator(LAUNCHER);
  const panel = page.locator(HOST).locator(PANEL);
  const box = await launcher.boundingBox();
  if (!box) throw new Error('the launcher has no box to press');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const redraws = await framesDuringHold(page);
  await page.mouse.up();

  expect(redraws, 'the launcher must have been redrawn while the pointer was held').toBeGreaterThan(
    0,
  );
  await expect(panel).toBeVisible();
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');
});

test('settles Sunny into the header without covering any text', async ({ page }) => {
  // The evaluation of 2026-10-12 found the header avatar rendered at the SVG's
  // own 200 px size, sitting over the company name and the greeting -- a bug
  // every byte-level snapshot passed. This checks the geometry a visitor sees.
  await openWidget(page);
  await page.waitForTimeout(900); // past the ~560 ms opening
  const boxes = await page.locator(HOST).evaluate((host) => {
    const root = host.shadowRoot!;
    const box = (selector: string) => {
      const node = root.querySelector(selector);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      avatar: box('.header .avatar svg'),
      name: box('.header .name'),
      tagline: box('.header .tagline'),
      header: box('.header'),
      firstMessage: box('.log > *'),
    };
  });
  type Box = { x: number; y: number; w: number; h: number };
  const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  expect(boxes.avatar).not.toBeNull();
  const avatar = boxes.avatar!;
  expect(avatar.w).toBeLessThanOrEqual(48);
  expect(avatar.h).toBeLessThanOrEqual(48);
  for (const other of [boxes.name, boxes.tagline, boxes.firstMessage]) {
    if (other) expect(overlaps(avatar, other)).toBe(false);
  }
  // Inside the header, not spilling out of it.
  const header = boxes.header!;
  expect(avatar.y).toBeGreaterThanOrEqual(header.y);
  expect(avatar.y + avatar.h).toBeLessThanOrEqual(header.y + header.h);
});

test('exposes the documented handle on window', async ({ page }) => {
  const shape = await page.evaluate(() => {
    const sunny = (window as unknown as { sunny?: { widgets?: unknown[]; open?: unknown } }).sunny;
    return { hasOpen: typeof sunny?.open === 'function', widgets: sunny?.widgets?.length ?? 0 };
  });
  expect(shape.hasOpen).toBe(true);
  expect(shape.widgets).toBe(1);
});

test('acts out a text answer: thinks, looks it up, then speaks', async ({ page }) => {
  // Text chat used to leave Sunny on the hand-on-chin loop for the whole
  // answer: nothing mapped the streamed text to speaking. The stream here is
  // canned so the order of events is the test's, not a model's.
  const frame = (event: Record<string, unknown>): string =>
    `data: ${JSON.stringify({ messageId: 'm_e2e', ...event })}\n\n`;
  await page.route('**/v1/chat/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body:
        frame({ type: 'message_started' }) +
        frame({ type: 'tool_started', tool: 'retrieve_knowledge' }) +
        frame({ type: 'tool_finished', tool: 'retrieve_knowledge', ok: true }) +
        frame({ type: 'text_delta', text: 'Most homes ' }) +
        frame({ type: 'text_delta', text: 'save on their bills.' }) +
        frame({ type: 'message_finished' }),
    });
  });

  // Every state the character passes through, recorded as it happens. The
  // whole canned turn can land in one task, so each mutation's old value is
  // kept, not just the attribute's value when the observer runs.
  await page.locator(HOST).evaluate((host) => {
    const seen: string[] = [];
    (window as unknown as { __sunnyStates: string[] }).__sunnyStates = seen;
    const note = (state: string | null | undefined): void => {
      if (state && seen.at(-1) !== state) seen.push(state);
    };
    new MutationObserver((records) => {
      for (const record of records) note(record.oldValue);
      note((host as HTMLElement).dataset['sunnyState']);
    }).observe(host, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['data-sunny-state'],
    });
  });

  await page.locator(HOST).locator(LAUNCHER).click();
  const panel = page.locator(HOST).locator(PANEL);
  await panel.locator('.composer-input').fill('Will solar save me money?');
  await panel.locator('.composer-send').click();
  await expect(panel).toContainText('save on their bills.');

  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __sunnyStates: string[] }).__sunnyStates),
    )
    .toEqual(expect.arrayContaining(['listening', 'thinking', 'speaking', 'idle']));
  const states = await page.evaluate(
    () => (window as unknown as { __sunnyStates: string[] }).__sunnyStates,
  );
  expect(states.indexOf('speaking')).toBeGreaterThan(states.indexOf('thinking'));
});

test('a failed answer says so once, with no empty bubble left behind', async ({ page }) => {
  const frame = (event: Record<string, unknown>): string =>
    `data: ${JSON.stringify({ messageId: 'm_e2e', ...event })}

`;
  await page.route('**/v1/chat/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body:
        frame({ type: 'message_started' }) +
        frame({
          type: 'error',
          code: 'upstream_failed',
          message: 'Sorry, I could not answer just then. Please try again in a moment.',
        }) +
        frame({ type: 'done', messageId: 'done' }),
    });
  });

  await page.locator(HOST).locator(LAUNCHER).click();
  const panel = page.locator(HOST).locator(PANEL);
  await panel.locator('.composer-input').fill('Will solar save me money?');
  await panel.locator('.composer-send').click();
  await expect(panel.locator('.turn.error')).toHaveText(
    'Sorry, I could not answer just then. Please try again in a moment.',
  );
  // Ready for another go: the send button wakes up as soon as there is text.
  await panel.locator('.composer-input').fill('And batteries?');
  await expect(panel.locator('.composer-send')).toBeEnabled();
  await expect(panel.locator('.turn.error')).toHaveCount(1);
  await expect(panel.locator('.turn.assistant')).toHaveCount(1); // the greeting only
});

test('loads without console errors', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
  await openWidget(page);
  expect(errors).toEqual([]);
});

test('shows no options panel when the visitor has asked for nothing', async ({ page }) => {
  // The opening state. The widget reads its options back as part of mounting --
  // before the panel is opened, so the cards are there the instant it is -- which
  // is why the response is awaited around a fresh navigation rather than around
  // the click. A 200 with nothing to price leaves the host empty rather than
  // putting an empty frame on screen; a missing route would fail here as a 404
  // rather than as silence.
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/v1/recommendations') && candidate.request().method() === 'GET',
    ),
    page.goto('/'),
  ]);

  expect(response.status()).toBe(200);
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeAttached();
  await expect(page.locator(HOST).locator('.options-host')).toBeHidden();
});

test('renders the options the visitor was given', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await stubOptions(page);
  await page.goto('/');
  await openWidget(page);

  const panel = page.locator(HOST).locator(PANEL);
  const region = panel.locator('.options');
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute('aria-label', 'Package options from this installer');
  await expect(panel.locator('[data-option-id]')).toHaveCount(2);

  const best = panel.locator('[data-option-id="opt-vx4k-sb430-9"]');
  await expect(best.locator('.option-rank')).toHaveText('Best match');
  await expect(best.locator('.option-title')).toHaveText('9 panels with a 4 kW inverter');

  // The line carries the model, the quantity, the specs the catalogue holds and
  // the installer's own record for the row.
  const panels = best.locator('.option-item[data-category="panel"]');
  await expect(panels.locator('.item-label')).toHaveText('9 × Sunbeam SB-430');
  await expect(panels.locator('.item-detail')).toHaveText('430 W per panel · 25-year warranty');
  await expect(panels.locator('.price-amount')).toHaveText('GBP 185.00');
  await expect(panels.locator('.price-status')).toHaveText('Verified price');
  await expect(panels.locator('.item-source')).toContainText('Northwind price list 2026-09.pdf');

  // A total the installer's own rows back, marked as such.
  await expect(best.locator('.option-total .total-amount')).toHaveText('GBP 2615.00');
  await expect(best.locator('.option-total')).toHaveClass(/status-verified/);
  await expect(best.locator('.total-label')).toHaveText('Verified price');

  // The four things §7.4 asks a card to carry, including the two the visitor has
  // to click for.
  await expect(best.locator('.option-reasons summary')).toHaveText('Why this option (2)');
  await expect(best.locator('.option-limits summary')).toHaveText('What it does not settle (2)');
  await expect(best.locator('.option-next')).toContainText('Book a survey');

  // The second option has a row with no price, so it has no total -- and says so
  // rather than showing a number a visitor would read as a price.
  const second = panel.locator('[data-option-id="opt-vx4k-sb500-8"]');
  await expect(second.locator('.option-rank')).toHaveText('Option 2');
  await expect(second.locator('.total-amount')).toHaveText('No total yet');
  await expect(second.locator('.total-label')).toHaveText(
    'At least one item has no price in the installer’s list.',
  );
  await expect(second.locator('.option-item[data-category="mounting"] .price-amount')).toHaveText(
    'No price',
  );

  // What the rules ruled out, so an option list is never unexplained.
  await expect(panel.locator('.options-exclusions')).toContainText(
    'A 6 kW inverter was over the budget you gave.',
  );

  // And the two things no card may ever do: quote a yield, or dress the panels'
  // rated DC power as generation.
  const text = await panel.innerText();
  expect(text).not.toMatch(/per year|kwh\/year|annual|generat|\bsaving|payback/i);
  expect(text).not.toContain('3870');

  expect(errors).toEqual([]);
});

test('still has the options after the panel is closed and opened again', async ({ page }) => {
  // Closing the panel is not the same as ending the conversation, so reopening
  // shows the options that still stand rather than an empty frame. Reaching that
  // state calls nothing: the read happened at mount and the answer has not
  // changed, which is the whole reason the widget keeps the standing option set
  // on screen instead of clearing it when the panel closes.
  await stubOptions(page);
  await page.goto('/');
  await openWidget(page);
  const panel = page.locator(HOST).locator(PANEL);
  await expect(panel.locator('[data-option-id]')).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await openWidget(page);

  await expect(panel.locator('[data-option-id]')).toHaveCount(2);
  await expect(panel.locator('.option-title').first()).toHaveText('9 panels with a 4 kW inverter');
});

const streamOf = (...events: Record<string, unknown>[]) =>
  events.map((e) => `data: ${JSON.stringify({ messageId: 'm_e2e', ...e })}\n\n`).join('');

test('offers the answers to Sunny’s question as buttons, and a tap sends one', async ({ page }) => {
  const sent: string[] = [];
  await page.route('**/v1/chat/stream', async (route) => {
    sent.push((route.request().postDataJSON() as { text: string }).text);
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: streamOf(
        { type: 'message_started' },
        { type: 'text_delta', text: 'What kind of property is it?' },
        {
          type: 'quick_replies',
          questionId: 'property_type',
          multi: false,
          replies: [
            { value: 'detached', label: 'Detached' },
            { value: 'semi', label: 'Semi-detached' },
          ],
        },
        { type: 'message_finished' },
        { type: 'done', messageId: 'done' },
      ),
    });
  });
  await openWidget(page);
  const panel = page.locator(HOST).locator(PANEL);
  await panel.locator('.composer-input').fill('I want solar');
  await panel.locator('.composer-send').click();

  const answers = panel.getByRole('group', { name: 'Answers you can tap' });
  await expect(answers.getByRole('button')).toHaveText(['Detached', 'Semi-detached']);
  await answers.getByRole('button', { name: 'Semi-detached' }).click();
  await expect.poll(() => sent).toEqual(['I want solar', 'Semi-detached']);
});

test('docks the 3D roof in the conversation and grows the panel round it', async ({ page }) => {
  const summary = {
    address: '3A Downs Walk, Peacehaven BN10 7SN',
    postcode: 'BN10 7SN',
    reliable: true,
    label: 'Indicative, subject to an on-site survey',
    usableRoofAreaM2: 52,
    estimatedMaxPanels: 21,
    bestFacing: 'S',
    roofPlanes: [
      {
        id: 0,
        facing: 'S',
        pitchDeg: 45,
        areaM2: 67,
        usableAreaM2: 52,
        maxPanels: 21,
        suitable: true,
      },
      {
        id: 1,
        facing: 'N',
        pitchDeg: 19,
        areaM2: 143,
        usableAreaM2: 0,
        maxPanels: 0,
        suitable: false,
      },
    ],
  };
  await page.route('**/v1/chat/stream', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: streamOf(
        { type: 'message_started' },
        { type: 'sunscan', assessmentId: 'ss_e2e', status: 'succeeded', summary },
        { type: 'text_delta', text: 'Your main roof faces south. Does that look right?' },
        { type: 'message_finished' },
        { type: 'done', messageId: 'done' },
      ),
    }),
  );
  // the model itself is not under test here
  await page.route('**/v1/sunscan/assessments/**', (route) => route.fulfill({ status: 503 }));
  await openWidget(page);
  const panel = page.locator(HOST).locator(PANEL);
  // layout width, not the on-screen box: the opening animation scales the panel
  const width = () => panel.evaluate((e) => (e as HTMLElement).offsetWidth);
  const before = await width();
  // sent from the keyboard, so the message box has focus when the roof arrives
  await panel.locator('.composer-input').fill('3A Downs Walk, BN10 7SN');
  await panel.locator('.composer-input').press('Enter');

  // it opens by itself, inside the conversation rather than over it
  const roof = panel.getByRole('region', { name: /3D model of 3A Downs Walk/ });
  await expect(roof).toBeVisible();
  await expect(panel).toContainText('Does that look right?');
  await expect(panel.locator('.composer-input')).toBeVisible();
  // and opening by itself does not take the visitor's place in the message box
  await expect(panel.locator('.composer-input')).toBeFocused();
  await expect.poll(width).toBeGreaterThan(before + 100);

  await roof.getByRole('button', { name: 'Shrink' }).click();
  await expect(roof.getByRole('button', { name: 'Show roof' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect.poll(width).toBe(before);

  await roof.getByRole('button', { name: 'Close the 3D view' }).click();
  await expect(roof).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'See your roof in 3D' })).toBeVisible();
});

for (const [w, h] of [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
  [390, 844],
] as const) {
  test(`keeps the message box and the conversation in view with the roof docked (${w}x${h})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.route('**/v1/chat/stream', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: streamOf(
          { type: 'message_started' },
          {
            type: 'sunscan',
            assessmentId: 'ss_fit',
            status: 'succeeded',
            summary: {
              address: '3A Downs Walk, Peacehaven BN10 7SN',
              reliable: true,
              label: 'Indicative, subject to an on-site survey',
              usableRoofAreaM2: 52,
              estimatedMaxPanels: 21,
              bestFacing: 'S',
              roofPlanes: [
                {
                  id: 0,
                  facing: 'S',
                  pitchDeg: 45,
                  areaM2: 67,
                  usableAreaM2: 52,
                  maxPanels: 21,
                  suitable: true,
                },
                {
                  id: 1,
                  facing: 'N',
                  pitchDeg: 19,
                  areaM2: 143,
                  usableAreaM2: 0,
                  maxPanels: 0,
                  suitable: false,
                },
              ],
            },
          },
          { type: 'text_delta', text: 'Your main roof faces south. Does that look right?' },
          {
            type: 'quick_replies',
            questionId: 'roof_confirmed',
            multi: false,
            replies: [
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ],
          },
          { type: 'message_finished' },
          { type: 'done', messageId: 'done' },
        ),
      }),
    );
    await page.route('**/v1/sunscan/assessments/**', (route) => route.fulfill({ status: 503 }));
    await openWidget(page);
    const panel = page.locator(HOST).locator(PANEL);
    await panel.locator('.composer-input').fill('3A Downs Walk');
    await panel.locator('.composer-input').press('Enter');
    await expect(panel.getByRole('region', { name: /3D model of/ })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Yes' })).toBeVisible();
    // the panel has finished growing
    await page.waitForTimeout(500);

    const box = async (sel: string) => (await panel.locator(sel).first().boundingBox())!;
    const p = (await panel.boundingBox())!;
    for (const sel of ['.composer', '.footnote', '.suggestions']) {
      const b = await box(sel);
      expect(b.y, `${sel} top`).toBeGreaterThanOrEqual(p.y - 1);
      expect(b.y + b.height, `${sel} bottom`).toBeLessThanOrEqual(p.y + p.height + 1);
    }
    expect(p.y, 'panel top').toBeGreaterThanOrEqual(0);
    expect(p.y + p.height, 'panel bottom').toBeLessThanOrEqual(h);
    expect((await box('.log')).height, 'conversation height').toBeGreaterThanOrEqual(150);
  });
}
