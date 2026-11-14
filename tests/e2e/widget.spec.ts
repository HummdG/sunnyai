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

test('shows a Markdown reply formatted: a list, bold, and no citation markers', async ({
  page,
}) => {
  const frame = (event: Record<string, unknown>): string =>
    `data: ${JSON.stringify({ messageId: 'm_e2e', ...event })}\n\n`;
  await page.route('**/v1/chat/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body:
        frame({ type: 'message_started' }) +
        frame({ type: 'text_delta', text: 'Here is how I can help you:\n* **Measure your ' }) +
        frame({ type: 'text_delta', text: 'roof:** from map data [S2, S3].\n' }) +
        frame({ type: 'text_delta', text: '* **Arrange a survey:** with the installer [S3].' }) +
        frame({ type: 'message_finished' }),
    });
  });

  await page.locator(HOST).locator(LAUNCHER).click();
  const panel = page.locator(HOST).locator(PANEL);
  await panel.locator('.composer-input').fill('How can you help?');
  await panel.locator('.composer-send').click();

  const reply = panel.locator('.turn.assistant').last();
  await expect(reply.locator('li')).toHaveCount(2);
  await expect(reply.locator('li').first().locator('strong')).toHaveText('Measure your roof:');
  await expect(reply).toContainText('Here is how I can help you:');
  await expect(reply).not.toContainText('**');
  await expect(reply).not.toContainText('[S');
  await expect(reply).not.toContainText('* ');
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

/** GET /v1/quote/roof-picture: a 1×1 JPEG stands in for Google's photo. */
const ROOF_PICTURE = {
  width: 180,
  height: 160,
  image:
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  imageryYear: 2023,
  faces: [
    {
      facing: 'south',
      pitchDeg: 35,
      areaM2: 40,
      panelCount: 2,
      colour: '#f2a93b',
      panels: [
        [80, 110, 10.5, 15.4, 180],
        [92, 110, 10.5, 15.4, 180],
      ],
    },
    {
      facing: 'west',
      pitchDeg: 30,
      areaM2: 20,
      panelCount: 1,
      colour: '#4f86c6',
      panels: [[50, 70, 10.5, 16.3, 270]],
    },
  ],
};

test('shows the house from above with its roof faces, and no 3D roof', async ({ page }) => {
  await page.route('**/v1/chat/stream', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: streamOf(
        { type: 'message_started' },
        // SunScan still measures the roof on the server; the widget shows none of it.
        {
          type: 'sunscan',
          assessmentId: 'ss_e2e',
          status: 'succeeded',
          summary: {
            address: '3A Downs Walk, Peacehaven BN10 7SN',
            reliable: true,
            label: 'Indicative, subject to an on-site survey',
            usableRoofAreaM2: 52,
            estimatedMaxPanels: 21,
            bestFacing: 'S',
            roofPlanes: [],
          },
        },
        { type: 'roof_image' },
        { type: 'text_delta', text: 'Thanks. How do you use electricity at home?' },
        { type: 'message_finished' },
        { type: 'done', messageId: 'done' },
      ),
    }),
  );
  let auth = '';
  await page.route('**/v1/quote/roof-picture', (route) => {
    auth = route.request().headers()['authorization'] ?? '';
    return route.fulfill({ status: 200, json: ROOF_PICTURE });
  });
  let sunscanCalls = 0;
  await page.route('**/v1/sunscan/assessments/**', (route) => {
    sunscanCalls++;
    return route.fulfill({ status: 503 });
  });
  let roofScript = 0;
  await page.route('**/widget/sunny-roof.js', (route) => {
    roofScript++;
    return route.continue();
  });
  await openWidget(page);
  const panel = page.locator(HOST).locator(PANEL);
  await panel.locator('.composer-input').fill('3A Downs Walk, BN10 7SN');
  await panel.locator('.composer-input').press('Enter');

  const picture = panel.locator('figure.roof-pic');
  await expect(picture).toBeVisible();
  expect(auth).toMatch(/^Bearer /);
  await expect(picture.getByRole('img', { name: 'Your house from above' })).toBeVisible();
  await expect(picture).toContainText('room for about 3 panels across 2 faces');
  await expect(picture.locator('.roof-pic-key li')).toHaveText([
    'South-facing, 35° pitch, 2 panels',
    'West-facing, 30° pitch, 1 panel',
  ]);
  await expect(picture.locator('.roof-pic-panels rect')).toHaveCount(3);
  await expect(picture).toContainText('Aerial imagery: Google, 2023');

  // No 3D: no view, no button, no roof card, and the three.js file never loads.
  await expect(panel.getByRole('region', { name: /3D model of/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'See your roof in 3D' })).toHaveCount(0);
  await expect(panel.locator('.roof')).toHaveCount(0);
  await expect(panel).not.toHaveClass(/roof-open/);
  expect(sunscanCalls).toBe(0);
  expect(roofScript).toBe(0);
});

test('shows nothing when there is no picture of the roof', async ({ page }) => {
  await page.route('**/v1/chat/stream', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: streamOf(
        { type: 'message_started' },
        { type: 'roof_image' },
        { type: 'text_delta', text: 'Thanks. How do you use electricity at home?' },
        { type: 'message_finished' },
        { type: 'done', messageId: 'done' },
      ),
    }),
  );
  await page.route('**/v1/quote/roof-picture', (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'not_found' } } }),
  );
  await openWidget(page);
  const panel = page.locator(HOST).locator(PANEL);
  await panel.locator('.composer-input').fill('3A Downs Walk, BN10 7SN');
  await panel.locator('.composer-input').press('Enter');
  await expect(panel).toContainText('How do you use electricity');
  await expect(panel.locator('figure.roof-pic')).toHaveCount(0);
});

test('takes the whole screen on a phone, and the × gives the page back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const launcher = page.locator(HOST).locator(LAUNCHER);
  await openWidget(page);
  const panel = page.locator(HOST).locator(PANEL);
  await page.waitForTimeout(600); // the opening has finished

  const p = (await panel.boundingBox())!;
  expect(p.x).toBeCloseTo(0, 0);
  expect(p.y).toBeCloseTo(0, 0);
  expect(p.width).toBeCloseTo(390, 0);
  expect(p.height).toBeCloseTo(844, 0);
  await expect(launcher).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');

  const close = panel.getByRole('button', { name: 'Close the assistant' });
  const c = (await close.boundingBox())!;
  expect(c.width).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(panel).toBeHidden();
  await expect(launcher).toBeVisible();
  const l = (await launcher.boundingBox())!;
  expect(l.x + l.width).toBeLessThanOrEqual(390 - 12 + 1);
  expect(l.y + l.height).toBeLessThanOrEqual(844 - 12 + 1);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
});

test('stays a floating card beside the launcher on a desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openWidget(page);
  await page.waitForTimeout(600);
  const p = (await page.locator(HOST).locator(PANEL).boundingBox())!;
  expect(p.width).toBeLessThanOrEqual(440);
  expect(p.x).toBeGreaterThan(0);
  await expect(page.locator(HOST).locator(LAUNCHER)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
});

for (const [w, h] of [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
  [390, 844],
] as const) {
  test(`keeps the message box and the conversation in view with the roof photo (${w}x${h})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.route('**/v1/chat/stream', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: streamOf(
          { type: 'message_started' },
          { type: 'roof_image' },
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
    await page.route('**/v1/quote/roof-picture', (route) =>
      route.fulfill({ status: 200, json: ROOF_PICTURE }),
    );
    await openWidget(page);
    const panel = page.locator(HOST).locator(PANEL);
    await panel.locator('.composer-input').fill('3A Downs Walk');
    await panel.locator('.composer-input').press('Enter');
    await expect(panel.locator('figure.roof-pic')).toBeVisible();
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
    expect((await box('.log')).height, 'conversation height').toBeGreaterThanOrEqual(115);
  });
}

const QUOTE = {
  quoteId: 'q_e2e',
  priced: false,
  disclaimer: 'Indicative and non-binding: a specialist confirms everything at a survey.',
  options: [
    ['essential', 'Smaller system', false, 4, 1585, 253, null],
    ['standard', 'Mid-sized system', true, 6, 2380, 341, null],
    ['premium', 'Larger system', false, 8, 3170, 512, 'Battery (to be specified)'],
  ].map(([id, label, isRecommended, panelCount, kwh, savings, batteryType]) => ({
    id,
    label,
    isRecommended,
    headline: 'Sized to your electricity use',
    panelCount,
    systemKwp: (panelCount as number) * 0.43,
    batteryType,
    batteryCapacityKwh: batteryType ? 5 : 0,
    priceGbp: null,
    priceLabel: 'Price to be confirmed by a specialist',
    annualGenerationKwh: kwh,
    annualSavingsGbp: savings,
    paybackYears: null,
  })),
};

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`sets the quote options out with the best one in the middle (${w}x${h})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.route('**/v1/chat/stream', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: streamOf(
          { type: 'message_started' },
          { type: 'text_delta', text: 'Here are three options for your home.' },
          { type: 'quote', quote: QUOTE },
          { type: 'message_finished' },
          { type: 'done', messageId: 'done' },
        ),
      }),
    );
    await openWidget(page);
    const panel = page.locator(HOST).locator(PANEL);
    await panel.locator('.composer-input').fill('Show me my options');
    await panel.locator('.composer-send').click();

    const options = panel.getByRole('list', { name: 'Your quote options' });
    const cards = options.locator(':scope > li');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(1)).toContainText('Best for you');
    await expect(cards.nth(1)).toContainText('Mid-sized system');
    await expect(cards.locator('svg.quote-art')).toHaveCount(3);
    await page.waitForTimeout(500); // the panel finishes widening
    const list = (await options.boundingBox())!;
    const boxes = await Promise.all(
      [0, 1, 2].map(async (i) => (await cards.nth(i).boundingBox())!),
    );
    if (w > 900) {
      // three across, in a panel that grew to hold them
      expect((await panel.boundingBox())!.width).toBeGreaterThan(800);
      expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
      expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
      expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(list.x + list.width + 1);
      await expect(panel.locator('.quote-dots')).toBeHidden();
    } else {
      // a row to swipe, opening on the best one with its neighbours peeking in
      const centre = boxes[1]!.x + boxes[1]!.width / 2;
      expect(Math.abs(centre - (list.x + list.width / 2))).toBeLessThan(4);
      await expect(panel.locator('.quote-dots')).toBeVisible();
      await panel.getByRole('button', { name: 'Show the Larger system' }).click();
      await expect
        .poll(async () => {
          const b = (await cards.nth(2).boundingBox())!;
          return Math.abs(b.x + b.width / 2 - (list.x + list.width / 2));
        })
        .toBeLessThan(4);
    }
    if (process.env.SUNNY_SHOTS) {
      await panel.screenshot({ path: `${process.env.SUNNY_SHOTS}/quote-${w}.png` });
    }
  });
}

const step = (priceGbp: number, panelCount: number, batteryKwh: number, savings: number) => ({
  priceGbp,
  panelCount,
  systemKwp: Math.round(panelCount * 43) / 100,
  batteryKwh,
  annualGenerationKwh: panelCount * 380,
  annualSavingsGbp: savings,
  paybackYears: Math.round((priceGbp / savings) * 10) / 10,
  twentyFiveYearSavingsGbp: savings * 25,
});

const PRICED_QUOTE = {
  ...QUOTE,
  quoteId: 'q_budget',
  priced: true,
  options: QUOTE.options.map((o, i) => ({
    ...o,
    priceGbp: [5200, 7400, 14800][i],
    priceLabel: 'Indicative price',
  })),
  budget: {
    minGbp: 5200,
    maxGbp: 14800,
    initialGbp: 7500,
    fromAnswer: true,
    steps: [
      step(5200, 8, 0, 420),
      step(7400, 12, 0, 610),
      step(9900, 12, 5.2, 820),
      step(14800, 16, 10.4, 1100),
    ],
  },
};

test('a budget slider changes what the quote shows, as it moves', async ({ page }) => {
  await page.route('**/v1/chat/stream', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: streamOf(
        { type: 'message_started' },
        { type: 'text_delta', text: 'Here are three options for your home.' },
        { type: 'quote', quote: PRICED_QUOTE },
        { type: 'message_finished' },
        { type: 'done', messageId: 'done' },
      ),
    }),
  );
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/v1/quote')) requests++;
  });
  await openWidget(page);
  const panel = page.locator(HOST).locator(PANEL);
  await panel.locator('.composer-input').fill('Show me my options');
  await panel.locator('.composer-send').click();

  const slider = panel.getByRole('slider', { name: 'Try a different budget' });
  await expect(slider).toBeVisible();
  const budget = panel.locator('.budget');
  // Starts at their own budget: the 12 panel system fits, the battery one does not.
  await expect(budget.locator('.budget-amount')).toHaveText('£7,500');
  await expect(budget.locator('.budget-system')).toHaveText('12 panels (5.16 kWp), for £7,400');
  const cards = panel.getByRole('list', { name: 'Your quote options' }).locator(':scope > li');
  await expect(cards.nth(2)).toHaveClass(/beyond-budget/);

  const slide = (value: number) =>
    slider.evaluate((input, v) => {
      (input as HTMLInputElement).value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);

  await slide(10_000);
  await expect(budget.locator('.budget-amount')).toHaveText('£10,000');
  await expect(budget.locator('.budget-system')).toHaveText(
    '12 panels (5.16 kWp) with a 5.2 kWh battery, for £9,900',
  );
  await expect(budget.locator('.budget-stats')).toContainText('£820');

  await slide(15_000);
  await expect(budget.locator('.budget-system')).toContainText('16 panels');
  await expect(cards.nth(2)).not.toHaveClass(/beyond-budget/);

  await slide(5_000);
  await expect(budget.locator('.budget-system')).toHaveText(
    'The smallest system is 8 panels (3.44 kWp), at £5,200',
  );
  // Every figure came with the quote: sliding asks the server nothing.
  expect(requests).toBe(0);
});
