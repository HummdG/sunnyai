import { expect, test, type Page } from '@playwright/test';

/**
 * The installer's product list and price list in the portal, end to end:
 * start from the HSEnergy example, publish it, filter and edit a product,
 * upload a CSV with a bad row, publish the price list.
 *
 * Runs against the real API with development sign-in (SUNNY_DEV_AUTH=1 in
 * playwright.config.ts). Website drafts and Google Sheet sync need crawled
 * pages and Drive credentials; they are covered by apps/api/test.
 */

const SITE = `http://localhost:${process.env.MARKETING_PORT ?? 4176}`;
const API = `http://localhost:${process.env.API_PORT ?? 8787}`;

const RUN = Date.now().toString(36);
const OWNER = `catalogue-${RUN}@brightside.test`;

test.describe.configure({ mode: 'serial' });

let token = '';
let tenantId = '';

/**
 * Sign in through the website (dev sign-in sets the HttpOnly session cookie)
 * and land on a dashboard page. The remembered installer is the only thing
 * kept in localStorage; the credential never is.
 */
async function openAs(page: Page, path: string): Promise<void> {
  const target = `/dashboard${path}`;
  await page.goto(`${SITE}/sign-in?next=${encodeURIComponent(target)}`);
  await page.evaluate((id) => window.localStorage.setItem('sunny.portal.tenant', id), tenantId);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => url.pathname === target);
}

test.beforeAll(async ({ request }) => {
  const login = await request.post(`${API}/v1/portal/dev-login`, { data: { email: OWNER } });
  token = ((await login.json()) as { token: string }).token;
  const created = await request.post(`${API}/v1/portal/tenants`, {
    headers: { authorization: `Bearer ${token}` },
    data: { companyName: `Catalogue Solar ${RUN}` },
  });
  expect(created.status()).toBe(201);
  tenantId = ((await created.json()) as { tenant: { id: string } }).tenant.id;
});

test('an empty catalogue offers the HSEnergy example, which goes live only when published', async ({
  page,
}) => {
  await openAs(page, '/products');
  await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Start from the HSEnergy example list' }).click();

  await expect(page).toHaveURL(/\/dashboard\/products\/upload/);
  await expect(page.getByText('Example products (HSEnergy 2026)')).toBeVisible();
  await expect(page.getByText('Example — edit before going live').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publish 19 products' }).click();

  await expect(page).toHaveURL(/\/dashboard\/products$/);
  await expect(page.locator('.products-table tbody tr')).toHaveCount(19);
  await page
    .getByRole('group', { name: 'Category' })
    .getByRole('button', { name: /Battery/ })
    .click();
  await expect(page.locator('.products-table tbody tr')).toHaveCount(4);
  await page.getByPlaceholder('Search by brand or model').fill('Powerwall');
  await expect(page.locator('.products-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.products-table')).toContainText('£9,195');
  await expect(page.locator('.products-table')).toContainText('Verified price');
});

test('a product price can be marked verified only with a source', async ({ page }) => {
  await openAs(page, '/products');
  await page.getByPlaceholder('Search by brand or model').fill('SE5000H');
  await page.getByRole('button', { name: /SE5000H/ }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('Price', { exact: true }).fill('1150');
  await drawer.getByRole('radio', { name: 'Verified' }).click();
  await drawer.getByRole('button', { name: 'Save' }).click();
  await expect(drawer.getByRole('alert')).toContainText('source');

  await drawer.getByLabel(/Source/).fill('Price list Oct 2026');
  await drawer.getByRole('button', { name: 'Save' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('.products-table')).toContainText('£1,150');

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.locator('table')).toContainText('Edited SolarEdge SE5000H');
});

test('an uploaded CSV is previewed with its bad rows explained before publishing', async ({
  page,
}) => {
  await openAs(page, '/products/upload');
  await page.getByRole('radio', { name: 'Add to my list' }).click();
  const csv = [
    'Category,Manufacturer,Model,Power (W),Price,Currency',
    'panel,Aiko,AIKO-A450-MAH54Mw,450,165.00,GBP',
    'panel,,NO-MAKER,400,,',
  ].join('\n');
  await page.getByLabel('CSV file').setInputFiles({
    name: 'more.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText('Preview: more.csv')).toBeVisible();
  await expect(page.locator('.issue-list')).toContainText('Row 3');
  await expect(page.locator('.issue-list')).toContainText('no manufacturer');
  await page.getByRole('button', { name: 'Publish 1 product' }).click();
  await expect(page).toHaveURL(/\/dashboard\/products$/);
  await expect(page.locator('.products-table tbody tr')).toHaveCount(20);
});

test('the example price list is reviewed, then published for quotes', async ({ page }) => {
  await openAs(page, '/products/price-list');
  await expect(page.getByText('Example price list (HSEnergy 2026)')).toBeVisible();
  await expect(page.locator('.issue-list')).toContainText('VAT');
  await page.getByRole('button', { name: 'Publish price list' }).click();
  await expect(page.getByText('Live price list')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Solar PV system' })).toBeVisible();
  await expect(page.getByText('ELEC-ADMIN-FEE')).toBeVisible();
  await expect(page.getByText('Always added')).toBeVisible();
  await expect(page.getByText(/VAT rate not set/)).toBeVisible();
});
