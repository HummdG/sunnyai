import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Sunny Studio's "Your conversation" tab, end to end: the installer adds their
 * own question whose answer adds their EV charger, reorders on the flow and in
 * the list, removes a preset (with its warning), adds a follow-up, zooms the
 * flow, flips to the question list, and resets.
 *
 * Runs against the real API with development sign-in (SUNNY_DEV_AUTH=1 in
 * playwright.config.ts) and a small price list published through the API.
 */

const SITE = `http://localhost:${process.env.MARKETING_PORT ?? 4176}`;
const API = `http://localhost:${process.env.API_PORT ?? 8787}`;

const RUN = Date.now().toString(36);
const OWNER = `flow-owner-${RUN}@brightside.test`;
const VIEWER = `flow-viewer-${RUN}@brightside.test`;

const EV = 'Do you have an electric car?';
const SHADING = 'Is the roof shaded by trees or buildings?';
const USAGE = 'How would you like to tell me about your electricity use?';
const HOUSEHOLD =
  'How many people live in the household? Answer 1 to 5, where 5 means five or more.';
const EV_PILL = 'Yes · +£899 7kW EV charger';

const PRICE_LIST = [
  'Category,Key,Name,Pricing,Amount,Unit,From,Percent,Mandatory,Prices include VAT',
  'vat,VAT,VAT rate,vat,,,,0,,no',
  'pv,PV-BASE,Solar PV system by panel count,table,"£3,985",,1,,,',
  'pv,PV-BASE,Solar PV system by panel count,table,"£4,195",,2,,,',
  'optional,EV-7KW,7kW EV charger,flat,£899,,,,,',
  'electrical,CABLE-RUN,Extra cable run,per_unit,£40,metre,,,,',
  'admin,ADMIN-FEE,Admin fee,flat,£150,,,,yes,',
].join('\n');

test.describe.configure({ mode: 'serial' });
// Tall enough that the whole flow and the side column fit on screen.
test.use({ viewport: { width: 1440, height: 1400 } });

let tenantId = '';

async function signInAs(page: Page, email: string, target: string): Promise<void> {
  await page.goto(`${SITE}/sign-in?next=${encodeURIComponent(target)}`);
  await page.evaluate((id) => window.localStorage.setItem('sunny.portal.tenant', id), tenantId);
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard/studio');
}

/** Straight to the conversation tab, by its address. */
async function openAs(page: Page, email: string): Promise<void> {
  await signInAs(page, email, '/dashboard/studio?tab=conversation');
  await expect(box(page, SHADING)).toBeVisible();
}

const editor = (page: Page) => page.getByRole('tabpanel', { name: 'Your conversation' });
const canvas = (page: Page) => editor(page).getByRole('region', { name: 'Flow' });
const list = (page: Page) => editor(page).getByRole('region', { name: 'Questions' });
const card = (page: Page) => editor(page).getByRole('region', { name: 'Selected question' });
const preview = (page: Page) => editor(page).getByRole('region', { name: 'How Sunny asks it' });
const box = (page: Page, name: string) => canvas(page).getByRole('button', { name, exact: true });
const row = (page: Page, name: string) => list(page).getByRole('listitem', { name, exact: true });
const view = (page: Page, name: 'Flow' | 'Questions') =>
  editor(page).getByRole('button', { name, exact: true });

/** The listed questions on the flow's spine, top to bottom. */
async function flowOrder(page: Page): Promise<string[]> {
  return canvas(page)
    .locator('[data-kind="top"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label') ?? ''));
}

/** The listed questions in the list, top to bottom. */
async function listOrder(page: Page): Promise<string[]> {
  return list(page)
    .locator('[data-step-row][data-depth="0"]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label') ?? ''));
}

/**
 * A native drag with the mouse, in small steps so the browser starts it (a
 * single jump, as `dragTo` makes, does not start this one).
 */
async function drag(page: Page, source: Locator, target: Locator, dy = 0): Promise<void> {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + dy, { steps: 10 });
  await page.mouse.move(to.x + to.width / 2 + 2, to.y + to.height / 2 + dy + 2, { steps: 2 });
  await page.mouse.up();
}

async function addPriceChange(answer: Locator, itemKey: string): Promise<void> {
  await answer.getByRole('button', { name: /Add a price change/ }).click();
  await answer.getByLabel('Item from your price list').selectOption(itemKey);
  await answer.getByRole('button', { name: 'Add', exact: true }).click();
}

test.beforeAll(async ({ request }) => {
  const login = await request.post(`${API}/v1/portal/dev-login`, { data: { email: OWNER } });
  const token = ((await login.json()) as { token: string }).token;
  const headers = { authorization: `Bearer ${token}` };
  const created = await request.post(`${API}/v1/portal/tenants`, {
    headers,
    data: { companyName: `Flow Solar ${RUN}` },
  });
  expect(created.status()).toBe(201);
  tenantId = ((await created.json()) as { tenant: { id: string } }).tenant.id;

  const base = `${API}/v1/portal/tenants/${tenantId}`;
  const upload = await request.post(`${base}/catalogue/price-list/upload`, {
    headers,
    data: { csv: PRICE_LIST, fileName: 'prices.csv' },
  });
  expect(upload.ok()).toBe(true);
  const pendingId = ((await upload.json()) as { pending: { id: string } }).pending.id;
  const published = await request.post(`${base}/catalogue/price-list/upload/${pendingId}/publish`, {
    headers,
  });
  expect(published.ok()).toBe(true);

  const invited = await request.post(`${base}/members`, {
    headers,
    data: { email: VIEWER, role: 'viewer' },
  });
  expect(invited.ok()).toBe(true);
});

test('an added question whose "Yes" adds the EV charger is saved and still there after a reload', async ({
  page,
}) => {
  // Studio opens on its first tab; the conversation is a tab of its own.
  await signInAs(page, OWNER, '/dashboard/studio');
  await expect(page.getByRole('tab', { name: 'Your brand' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Your conversation' }).click();
  await expect(page).toHaveURL(/[?&]tab=conversation/);
  await expect(box(page, SHADING)).toBeVisible();
  // Arrow keys move along the tabs.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Assistant settings' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(editor(page)).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await expect(box(page, SHADING)).toBeVisible();

  // The fixed start and end are drawn, locked: nothing to click or drag.
  await expect(canvas(page)).toContainText('Address and roof check');
  await expect(canvas(page)).toContainText('Quote, then contact details');
  await expect(canvas(page).getByRole('button', { name: 'Address and roof check' })).toHaveCount(0);
  await expect(box(page, SHADING)).toContainText("Sunny's question");

  await card(page).getByRole('button', { name: '+ Add a question' }).click();
  await card(page).getByLabel('Question text').fill(EV);
  await expect(box(page, EV)).toContainText('Changes the quote');
  await expect(box(page, EV)).toHaveAttribute('aria-pressed', 'true');
  const yes = card(page).getByRole('group', { name: 'Answer Yes' });
  await addPriceChange(yes, 'EV-7KW');
  await expect(yes).toContainText('Adds 7kW EV charger, £899');

  // The flow shows what "Yes" does, on a pill under the question.
  await expect(canvas(page).locator('.flow-pill', { hasText: EV_PILL })).toBeVisible();

  // The preview shows the installer's wording and exactly what "Yes" does.
  await expect(preview(page)).toContainText(EV);
  await expect(preview(page)).toContainText('Sunny may phrase this more naturally in the chat.');
  await preview(page).getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(preview(page)).toContainText('Adds 7kW EV charger');
  await expect(preview(page)).toContainText('£899');

  await editor(page).getByRole('button', { name: 'Save conversation' }).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved');

  await page.reload();
  await expect(box(page, EV)).toBeVisible();
  await box(page, EV).click();
  await expect(card(page).getByRole('group', { name: 'Answer Yes' })).toContainText(
    'Adds 7kW EV charger, £899',
  );
});

test('every box shows its whole question, never cut short', async ({ page }) => {
  await openAs(page, OWNER);
  await box(page, USAGE).click();
  for (const name of [SHADING, USAGE, HOUSEHOLD, EV]) {
    const text = box(page, name).locator('.flow-node-text');
    await expect(text).toHaveText(name);
    const clipped = await text.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    );
    expect(clipped).toBe(false);
  }
  // No two boxes overlap.
  const rects = await canvas(page)
    .locator('.flow-node')
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON() as DOMRect));
  for (const a of rects)
    for (const b of rects) {
      if (a === b) continue;
      const overlap =
        a.left < b.right - 1 &&
        b.left < a.right - 1 &&
        a.top < b.bottom - 1 &&
        b.top < a.bottom - 1;
      expect(overlap).toBe(false);
    }
});

test("a linked question's answers can be reworded, priced and followed up, and are saved", async ({
  page,
}) => {
  await openAs(page, OWNER);
  await box(page, USAGE).click();
  await expect(card(page).getByRole('group', { name: 'Linked questions' })).toContainText(
    HOUSEHOLD,
  );
  // A linked question has its own box, branching off the one it is asked with.
  const head = (await box(page, USAGE).boundingBox())!;
  const member = (await box(page, HOUSEHOLD).boundingBox())!;
  expect(member.x).toBeGreaterThan(head.x + head.width);

  await box(page, HOUSEHOLD).click();
  // It travels with its head: nothing moves or removes it on its own.
  await expect(card(page).getByRole('button', { name: `Remove: ${HOUSEHOLD}` })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: `Move up: ${HOUSEHOLD}` })).toHaveCount(0);
  await expect(box(page, HOUSEHOLD)).not.toHaveAttribute('data-draggable', 'true');

  await card(page)
    .getByRole('group', { name: 'Answer 5' })
    .getByLabel('Answer', { exact: true })
    .fill('Five or more');
  const five = card(page).getByRole('group', { name: 'Answer Five or more' });
  await addPriceChange(five, 'EV-7KW');
  await expect(five).toContainText('Adds 7kW EV charger, £899');
  await five.getByRole('button', { name: '+ Add a follow-up' }).click();
  await card(page).getByLabel('Question text').fill('Does anyone work from home?');
  await expect(box(page, 'Does anyone work from home?')).toBeVisible();

  // The preview answers what the linked question waits on, so its effect is exact.
  await box(page, HOUSEHOLD).click();
  await expect(
    five.getByRole('button', { name: 'Follow-up: Does anyone work from home?' }),
  ).toBeVisible();
  await preview(page).getByRole('button', { name: 'Five or more' }).click();
  await expect(preview(page)).toContainText('Adds 7kW EV charger');

  await editor(page).getByRole('button', { name: 'Save conversation' }).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved');
  await page.reload();
  await box(page, HOUSEHOLD).click();
  const saved = card(page).getByRole('group', { name: 'Answer Five or more' });
  await expect(saved).toContainText('Adds 7kW EV charger, £899');
  await expect(
    saved.getByRole('button', { name: 'Follow-up: Does anyone work from home?' }),
  ).toBeVisible();
});

test('a problem on a follow-up is flagged on its parent, and Save opens it', async ({ page }) => {
  await openAs(page, OWNER);
  await box(page, EV).click();
  await card(page)
    .getByRole('group', { name: 'Answer No' })
    .getByRole('button', { name: '+ Add a follow-up' })
    .click();
  // Leave the follow-up without its question, and pick another one.
  await box(page, SHADING).click();

  await editor(page).getByRole('button', { name: 'Save conversation' }).click();
  const message = card(page).getByText('Write the question Sunny should ask.');
  await expect(message).toBeVisible();
  await expect(message).toBeInViewport();
  await expect(box(page, 'New question')).toHaveAttribute('aria-pressed', 'true');

  // The parent says something below it needs attention, on the flow and in the list.
  await expect(box(page, EV)).toContainText('Needs attention');
  await view(page, 'Questions').click();
  await expect(row(page, EV)).toContainText('Needs attention');

  // Editing the question clears its flag until the next save.
  await card(page).getByLabel('Question text').fill('Is it charged at home?');
  await expect(row(page, EV)).not.toContainText('Needs attention');
});

test('dragging on the flow and in the list reorders, and so do the buttons', async ({ page }) => {
  await openAs(page, OWNER);
  let order = await flowOrder(page);
  expect(order.indexOf(EV)).toBeGreaterThan(order.indexOf(SHADING));

  // On the flow: drag the box up the spine, above roof shading (the whole flow in view).
  await canvas(page).getByRole('button', { name: 'Fit the flow in view' }).click();
  await drag(page, box(page, EV), box(page, SHADING), -12);
  order = await flowOrder(page);
  expect(order.indexOf(EV)).toBe(order.indexOf(SHADING) - 1);

  // In the list: drag roof shading's grip back onto the electric car row.
  await view(page, 'Questions').click();
  expect(await listOrder(page)).toEqual(order);
  await drag(page, row(page, SHADING).locator('.flow-drag'), row(page, EV));
  order = await listOrder(page);
  expect(order.indexOf(SHADING)).toBe(order.indexOf(EV) - 1);

  // The move buttons do the same by keyboard, in the list and in the side column.
  await row(page, EV)
    .getByRole('button', { name: `Move up: ${EV}` })
    .click();
  order = await listOrder(page);
  expect(order.indexOf(EV)).toBe(order.indexOf(SHADING) - 1);
  await row(page, EV).getByRole('button', { name: EV, exact: true }).click();
  await card(page)
    .getByRole('button', { name: `Move down: ${EV}` })
    .click();
  order = await listOrder(page);
  expect(order.indexOf(EV)).toBe(order.indexOf(SHADING) + 1);
});

test('removing electricity use shows its warning first, and the preview never asks it', async ({
  page,
}) => {
  await openAs(page, OWNER);
  await view(page, 'Questions').click();
  await row(page, USAGE)
    .getByRole('button', { name: `Remove: ${USAGE}` })
    .click();
  const confirm = card(page).getByRole('alertdialog');
  await expect(confirm).toContainText('Sunny uses this to work out savings.');
  await confirm.getByRole('button', { name: 'Remove question' }).click();
  await expect(row(page, USAGE)).toHaveCount(0);
  await view(page, 'Flow').click();
  expect(await flowOrder(page)).not.toContain(USAGE);

  await preview(page).getByRole('button', { name: 'Play the whole conversation' }).click();
  const asked: string[] = [];
  const ending = preview(page).getByText('Then Sunny shows the quote');
  const asking = preview(page).locator('[data-asking]');
  const current = async () =>
    (await asking.count()) === 0 ? null : await asking.getAttribute('data-asking');
  for (let turn = 0; turn < 30; turn++) {
    await expect(ending.or(asking)).toBeVisible();
    if (await ending.isVisible()) break;
    const prompt = (await current()) ?? '';
    asked.push(prompt);
    await preview(page).locator('.preview-chips button').first().click();
    await expect.poll(current).not.toBe(prompt);
  }
  await expect(preview(page).getByText('Then Sunny shows the quote')).toBeVisible();
  expect(asked).toContain(SHADING);
  expect(asked).not.toContain(USAGE);
});

test('a follow-up branches off its answer on the flow and sits indented in the list', async ({
  page,
}) => {
  await openAs(page, OWNER);
  await box(page, EV).click();
  await card(page)
    .getByRole('group', { name: 'Answer Yes' })
    .getByRole('button', { name: '+ Add a follow-up' })
    .click();
  await card(page).getByLabel('Question text').fill('Is it a Tesla?');

  // On the flow: to the right of its parent, on a priced branch whose pill names the answer.
  const parent = (await box(page, EV).boundingBox())!;
  const child = (await box(page, 'Is it a Tesla?').boundingBox())!;
  expect(child.x).toBeGreaterThan(parent.x + parent.width);
  const pill = canvas(page).locator('.flow-pill', { hasText: EV_PILL });
  await expect(pill).toHaveAttribute('data-price', 'true');
  await expect(box(page, 'Is it a Tesla?')).not.toHaveAttribute('data-draggable', 'true');

  // The preview of the follow-up shows what its own answer does, not the EV
  // charger its parent's "Yes" (given on the way to it) adds.
  await preview(page).getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(preview(page)).toContainText('No change to the quote.');
  await expect(preview(page)).not.toContainText('Adds 7kW EV charger');

  // In the list: indented under its parent, after the answer that opens it.
  await view(page, 'Questions').click();
  const followUp = row(page, 'Is it a Tesla?');
  await expect(followUp).toContainText('↳ if Yes:');
  await expect(followUp).toHaveAttribute('aria-current', 'true');
  const parentRow = (await row(page, EV).boundingBox())!;
  const childRow = (await followUp.boundingBox())!;
  expect(childRow.x).toBeGreaterThan(parentRow.x + 10);
  await expect(row(page, EV)).toContainText(`Yes: +£899 7kW EV charger`);

  // Picking in the list selects on the flow, and the reverse.
  await row(page, SHADING).getByRole('button', { name: SHADING, exact: true }).click();
  await view(page, 'Flow').click();
  await expect(box(page, SHADING)).toHaveAttribute('aria-pressed', 'true');
  await box(page, EV).click();
  await view(page, 'Questions').click();
  await expect(row(page, EV)).toHaveAttribute('aria-current', 'true');
});

test('the Flow or Questions choice is remembered, and the flow zooms', async ({ page }) => {
  await openAs(page, OWNER);
  const stage = canvas(page).locator('.flow-stage');
  const scale = async () => Number(await stage.getAttribute('data-scale'));
  const start = await scale();
  // It opens at full size, or a little smaller when the branches would not fit.
  expect(start).toBeGreaterThanOrEqual(0.85);
  expect(start).toBeLessThanOrEqual(1);
  const before = (await box(page, SHADING).boundingBox())!;
  await canvas(page).getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(scale).toBeCloseTo(start * 1.2, 1);
  const after = (await box(page, SHADING).boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width * 1.1);
  await canvas(page).getByRole('button', { name: 'Zoom out' }).click();
  await canvas(page).getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(scale).toBeCloseTo(start / 1.2, 1);
  await canvas(page).getByRole('button', { name: 'Fit the flow in view' }).click();
  await expect.poll(scale).not.toBeCloseTo(start / 1.2, 2);

  await view(page, 'Questions').click();
  await expect(row(page, SHADING)).toBeVisible();
  await expect(canvas(page)).toHaveCount(0);
  await page.reload();
  await expect(row(page, SHADING)).toBeVisible();
  await expect(view(page, 'Questions')).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas(page)).toHaveCount(0);
  await view(page, 'Flow').click();
  await expect(box(page, SHADING)).toBeVisible();
});

test('a mandatory item cannot be picked, and a per-metre item asks how many', async ({ page }) => {
  await openAs(page, OWNER);
  await box(page, SHADING).click();
  const heavy = card(page).getByRole('group', { name: 'Answer Heavily shaded' });
  await heavy.getByRole('button', { name: /Add a price change/ }).click();
  const item = heavy.getByLabel('Item from your price list');
  // Listed, so the installer sees why, but it cannot be chosen.
  await expect(item.locator('option', { hasText: 'Admin fee' })).toHaveJSProperty('disabled', true);
  await expect(item.locator('option', { hasText: 'Solar PV system' })).toHaveCount(0);

  await item.selectOption('CABLE-RUN');
  const add = heavy.getByRole('button', { name: 'Add', exact: true });
  await expect(add).toBeDisabled();
  await heavy.getByLabel('How many metres').fill('10');
  await add.click();
  await expect(heavy).toContainText('Adds 10 metres of Extra cable run, £40 per metre');
});

test('a viewer sees the conversation but cannot change it', async ({ page }) => {
  await openAs(page, VIEWER);
  await expect(box(page, EV)).toBeVisible();
  await expect(editor(page).getByRole('button', { name: 'Save conversation' })).toHaveCount(0);
  await expect(
    editor(page).getByRole('button', { name: "Reset to Sunny's questions" }),
  ).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: '+ Add a question' })).toHaveCount(0);
  await expect(canvas(page).locator('[data-draggable]')).toHaveCount(0);
  // A drag on the flow changes nothing.
  const order = await flowOrder(page);
  await drag(page, box(page, EV), box(page, SHADING), -12);
  expect(await flowOrder(page)).toEqual(order);

  await box(page, EV).click();
  await expect(card(page).getByLabel('Question text')).toBeDisabled();
  await expect(card(page).getByRole('button', { name: /Add a price change/ })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: /Remove|Move/ })).toHaveCount(0);

  await view(page, 'Questions').click();
  await expect(row(page, EV).getByRole('button', { name: /Remove|Move/ })).toHaveCount(0);
  await expect(list(page).locator('.flow-drag')).toHaveCount(0);
  await expect(list(page).getByRole('button', { name: '+ Add a question' })).toHaveCount(0);
});

test("reset restores Sunny's questions after confirming", async ({ page }) => {
  await openAs(page, OWNER);
  await expect(box(page, EV)).toBeVisible();
  await editor(page).getByRole('button', { name: "Reset to Sunny's questions" }).click();
  const confirm = editor(page).getByRole('alertdialog');
  await expect(confirm).toContainText('replaces your questions');
  await confirm.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(box(page, EV)).toHaveCount(0);
  await expect(box(page, USAGE)).toBeVisible();

  await page.reload();
  await expect(box(page, USAGE)).toBeVisible();
  await expect(box(page, EV)).toHaveCount(0);
});
