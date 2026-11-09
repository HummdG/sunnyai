import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Sunny Studio's "Your conversation" editor, end to end: the installer adds
 * their own question whose answer adds their EV charger, reorders, removes a
 * preset (with its warning), adds a follow-up, minimises a panel, and resets.
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
// Tall enough that the whole question list fits on screen, so a drag can reach any row.
test.use({ viewport: { width: 1280, height: 1600 } });

let tenantId = '';

async function openAs(page: Page, email: string): Promise<void> {
  const target = '/dashboard/studio';
  await page.goto(`${SITE}/sign-in?next=${encodeURIComponent(target)}`);
  await page.evaluate((id) => window.localStorage.setItem('sunny.portal.tenant', id), tenantId);
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => url.pathname === target);
  await expect(questions(page).getByRole('listitem', { name: SHADING })).toBeVisible();
}

const editor = (page: Page) => page.getByRole('region', { name: 'Your conversation' });
const questions = (page: Page) => editor(page).getByRole('region', { name: 'Questions' });
const diagram = (page: Page) => editor(page).getByRole('region', { name: 'Flow diagram' });
const preview = (page: Page) => editor(page).getByRole('region', { name: 'Chat preview' });
const row = (page: Page, name: string) =>
  questions(page).getByRole('listitem', { name, exact: true });

/** The diagram's question boxes, top to bottom. */
async function diagramOrder(page: Page): Promise<string[]> {
  return diagram(page)
    .locator('[data-step-id]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label') ?? ''));
}

/**
 * A native drag with the mouse, in small steps so the browser starts it (a
 * single jump, as `dragTo` makes, does not start this one).
 */
async function drag(page: Page, source: Locator, target: Locator): Promise<void> {
  await questions(page).evaluate((list) => list.scrollIntoView({ block: 'start' }));
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.move(to.x + to.width / 2 + 2, to.y + to.height / 2 + 2, { steps: 2 });
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
  await openAs(page, OWNER);
  // The fixed start and end are shown, locked.
  const start = row(page, 'Address and roof check');
  await expect(start).toContainText('Always asked first');
  await expect(start.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  await expect(row(page, 'Quote, consent and contact details')).toContainText('Always asked last');
  await expect(row(page, SHADING)).toContainText("Sunny's question");

  await questions(page).getByRole('button', { name: '+ Add a question' }).click();
  const added = row(page, 'New question');
  await added.getByLabel('Question text').fill(EV);
  const ev = row(page, EV);
  await expect(ev).toContainText('Changes the quote');
  await addPriceChange(ev.getByRole('group', { name: 'Answer Yes' }), 'EV-7KW');
  await expect(ev.getByRole('group', { name: 'Answer Yes' })).toContainText(
    'Adds 7kW EV charger, £899',
  );

  // The preview shows the installer's wording and exactly what "Yes" does.
  await expect(preview(page)).toContainText(EV);
  await expect(preview(page)).toContainText('Sunny may phrase this more naturally in the chat.');
  await preview(page).getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(preview(page)).toContainText('Adds 7kW EV charger');
  await expect(preview(page)).toContainText('£899');
  await expect(diagram(page)).toContainText('Yes +£899');

  await editor(page).getByRole('button', { name: 'Save conversation' }).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved');

  await page.reload();
  await expect(row(page, EV)).toBeVisible();
  await row(page, EV).getByRole('button', { name: EV, exact: true }).click();
  await expect(row(page, EV).getByRole('group', { name: 'Answer Yes' })).toContainText(
    'Adds 7kW EV charger, £899',
  );
});

test("a linked question's answers can be reworded, priced and followed up, and are saved", async ({
  page,
}) => {
  await openAs(page, OWNER);
  await row(page, USAGE).getByRole('button', { name: USAGE, exact: true }).click();
  const member = row(page, HOUSEHOLD);
  await expect(member).toBeVisible();
  // It travels with its head: nothing moves or removes it on its own.
  await expect(member.getByRole('button', { name: `Remove: ${HOUSEHOLD}` })).toHaveCount(0);
  await expect(member.getByRole('button', { name: `Move up: ${HOUSEHOLD}` })).toHaveCount(0);
  await expect(member.locator('.flow-drag')).toHaveCount(0);

  await member.getByRole('button', { name: HOUSEHOLD, exact: true }).click();
  await member
    .getByRole('group', { name: 'Answer 5' })
    .getByLabel('Answer', { exact: true })
    .fill('Five or more');
  const five = member.getByRole('group', { name: 'Answer Five or more' });
  await addPriceChange(five, 'EV-7KW');
  await expect(five).toContainText('Adds 7kW EV charger, £899');
  await five.getByRole('button', { name: '+ Add a follow-up' }).click();
  await row(page, 'New question').getByLabel('Question text').fill('Does anyone work from home?');
  await expect(five.getByRole('listitem', { name: 'Does anyone work from home?' })).toBeVisible();
  await expect(diagram(page).getByRole('button', { name: HOUSEHOLD })).toBeVisible();
  await expect(
    diagram(page).getByRole('button', { name: 'Does anyone work from home?' }),
  ).toBeVisible();

  // The preview answers what the linked question waits on, so its effect is exact.
  await member.getByRole('button', { name: HOUSEHOLD, exact: true }).click();
  await preview(page).getByRole('button', { name: 'Five or more' }).click();
  await expect(preview(page)).toContainText('Adds 7kW EV charger');

  await editor(page).getByRole('button', { name: 'Save conversation' }).click();
  await expect(editor(page).getByRole('status')).toContainText('Saved');
  await page.reload();
  await row(page, USAGE).getByRole('button', { name: USAGE, exact: true }).click();
  await row(page, HOUSEHOLD).getByRole('button', { name: HOUSEHOLD, exact: true }).click();
  const saved = row(page, HOUSEHOLD).getByRole('group', { name: 'Answer Five or more' });
  await expect(saved).toContainText('Adds 7kW EV charger, £899');
  await expect(saved.getByRole('listitem', { name: 'Does anyone work from home?' })).toBeVisible();
});

test('a problem on a follow-up is flagged on its closed parent, and Save opens it', async ({
  page,
}) => {
  await openAs(page, OWNER);
  await row(page, EV).getByRole('button', { name: EV, exact: true }).click();
  await row(page, EV)
    .getByRole('group', { name: 'Answer No' })
    .getByRole('button', { name: '+ Add a follow-up' })
    .click();
  // Leave the follow-up without its question, and close its parent.
  await row(page, SHADING).getByRole('button', { name: SHADING, exact: true }).click();
  await expect(row(page, 'New question')).toHaveCount(0);

  await editor(page).getByRole('button', { name: 'Save conversation' }).click();
  const message = row(page, 'New question').getByText('Write the question Sunny should ask.');
  await expect(message).toBeVisible();
  await expect(message).toBeInViewport();

  // Closed again, the parent still says something below it needs attention.
  const evHead = row(page, EV).locator('.flow-row-head').first();
  await row(page, SHADING).getByRole('button', { name: SHADING, exact: true }).click();
  await expect(evHead).toContainText('Needs attention');

  // Editing the question clears its flag until the next save.
  await row(page, EV).getByRole('button', { name: EV, exact: true }).click();
  await row(page, 'New question')
    .getByRole('button', { name: 'New question', exact: true })
    .click();
  await row(page, 'New question').getByLabel('Question text').fill('Is it charged at home?');
  await expect(evHead).not.toContainText('Needs attention');
});

test('dragging the question above roof shading reorders the diagram too, and so do the buttons', async ({
  page,
}) => {
  await openAs(page, OWNER);
  let order = await diagramOrder(page);
  expect(order.indexOf(EV)).toBeGreaterThan(order.indexOf(SHADING));

  // The handle is for a mouse; the move buttons below do the same by keyboard.
  await drag(page, row(page, EV).locator('.flow-drag'), row(page, SHADING));
  order = await diagramOrder(page);
  expect(order.indexOf(EV)).toBe(order.indexOf(SHADING) - 1);

  await row(page, EV)
    .getByRole('button', { name: `Move down: ${EV}` })
    .click();
  order = await diagramOrder(page);
  expect(order.indexOf(EV)).toBe(order.indexOf(SHADING) + 1);
  await row(page, EV)
    .getByRole('button', { name: `Move up: ${EV}` })
    .click();
  order = await diagramOrder(page);
  expect(order.indexOf(EV)).toBe(order.indexOf(SHADING) - 1);
});

test('removing electricity use shows its warning first, and the preview never asks it', async ({
  page,
}) => {
  await openAs(page, OWNER);
  await row(page, USAGE)
    .getByRole('button', { name: `Remove: ${USAGE}` })
    .click();
  const confirm = row(page, USAGE).getByRole('alertdialog');
  await expect(confirm).toContainText('Sunny uses this to work out savings.');
  await confirm.getByRole('button', { name: 'Remove question' }).click();
  await expect(row(page, USAGE)).toHaveCount(0);
  expect(await diagramOrder(page)).not.toContain(USAGE);

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

test('a follow-up sits indented under its answer and in the diagram, selection kept in step', async ({
  page,
}) => {
  await openAs(page, OWNER);
  await row(page, EV).getByRole('button', { name: EV, exact: true }).click();
  // The follow-up has a "Yes" of its own once it opens: the first is the parent's.
  const yes = row(page, EV).getByRole('group', { name: 'Answer Yes' }).first();
  await yes.getByRole('button', { name: '+ Add a follow-up' }).click();
  await row(page, 'New question').getByLabel('Question text').fill('Is it a Tesla?');

  const followUp = yes.getByRole('listitem', { name: 'Is it a Tesla?' });
  await expect(followUp).toBeVisible();
  const parentBox = await row(page, EV).boundingBox();
  const childBox = await followUp.boundingBox();
  expect(childBox!.x).toBeGreaterThan(parentBox!.x + 10);

  await expect(diagram(page).getByRole('button', { name: 'Is it a Tesla?' })).toBeVisible();
  await expect(diagram(page)).toContainText('if Yes');

  // The preview of the follow-up shows what its own answer does, not the EV
  // charger its parent's "Yes" (given on the way to it) adds.
  await diagram(page).getByRole('button', { name: 'Is it a Tesla?' }).click();
  await preview(page).getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(preview(page)).toContainText('No change to the quote.');
  await expect(preview(page)).not.toContainText('Adds 7kW EV charger');

  // Picking in the diagram selects in the list, and the reverse.
  await diagram(page).getByRole('button', { name: SHADING }).click();
  await expect(row(page, SHADING)).toHaveAttribute('aria-current', 'true');
  await row(page, EV).getByRole('button', { name: EV, exact: true }).click();
  await expect(diagram(page).getByRole('button', { name: EV })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('minimising the diagram keeps the list and the preview, and is remembered', async ({
  page,
}) => {
  await openAs(page, OWNER);
  await editor(page).getByRole('button', { name: 'Minimise Flow diagram' }).click();
  await expect(diagram(page).locator('svg.flow-diagram')).toBeHidden();
  await expect(row(page, SHADING)).toBeVisible();
  await expect(
    preview(page).getByText('Sunny may phrase this more naturally in the chat.'),
  ).toBeVisible();

  await page.reload();
  await expect(row(page, SHADING)).toBeVisible();
  await expect(diagram(page).locator('svg.flow-diagram')).toBeHidden();
  await editor(page).getByRole('button', { name: 'Show Flow diagram' }).click();
  await expect(diagram(page).locator('svg.flow-diagram')).toBeVisible();
});

test('a mandatory item cannot be picked, and a per-metre item asks how many', async ({ page }) => {
  await openAs(page, OWNER);
  await row(page, SHADING).getByRole('button', { name: SHADING, exact: true }).click();
  const heavy = row(page, SHADING).getByRole('group', { name: 'Answer Heavily shaded' });
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
  await expect(row(page, EV)).toBeVisible();
  await expect(editor(page).getByRole('button', { name: 'Save conversation' })).toHaveCount(0);
  await expect(questions(page).getByRole('button', { name: '+ Add a question' })).toHaveCount(0);
  await expect(row(page, EV).getByRole('button', { name: /Remove|Move/ })).toHaveCount(0);
  await expect(row(page, EV).locator('.flow-drag')).toHaveCount(0);
  await row(page, EV).getByRole('button', { name: EV, exact: true }).click();
  await expect(row(page, EV).getByLabel('Question text')).toBeDisabled();
  await expect(row(page, EV).getByRole('button', { name: /Add a price change/ })).toHaveCount(0);
});

test("reset restores Sunny's questions after confirming", async ({ page }) => {
  await openAs(page, OWNER);
  await expect(row(page, EV)).toBeVisible();
  await editor(page).getByRole('button', { name: "Reset to Sunny's questions" }).click();
  const confirm = editor(page).getByRole('alertdialog');
  await expect(confirm).toContainText('replaces your questions');
  await confirm.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(row(page, EV)).toHaveCount(0);
  await expect(row(page, USAGE)).toBeVisible();

  await page.reload();
  await expect(row(page, USAGE)).toBeVisible();
  await expect(row(page, EV)).toHaveCount(0);
});
