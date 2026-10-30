import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The staff dashboard, end to end: a staff member signs in and every page
 * renders against the real API; an installer who is not staff is turned away.
 *
 * The API runs with SUNNY_STAFF_EMAILS set to STAFF (playwright.config.ts) and
 * no Google project, so the Cloud Monitoring and billing panels show why they
 * are unavailable -- which is itself what a page must do when a source is down.
 */

const SITE = `http://localhost:${process.env.MARKETING_PORT ?? 4176}`;
const STAFF = 'staff@sunny-e2e.test';
const OUTSIDER = `installer-${Date.now().toString(36)}@brightside.test`;

test.describe.configure({ mode: 'serial' });

/** Ask for a staff page signed out, sign in, and land back on it. */
async function signInTo(page: Page, path: string, email: string): Promise<void> {
  await page.goto(`${SITE}${path}`);
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname.startsWith(path));
}

async function noSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).include('#main').analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious,
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n'),
  ).toEqual([]);
}

test('staff see every page of the dashboard', async ({ page }) => {
  await signInTo(page, '/admin', STAFF);
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
  // No Google project in e2e: the overview says so rather than going blank.
  await expect(page.getByText(/GOOGLE_CLOUD_PROJECT is not set/).first()).toBeVisible();
  await noSeriousViolations(page);

  const nav = page.getByRole('navigation', { name: 'Staff' });
  for (const [link, heading] of [
    ['Usage', 'Usage'],
    ['Health', 'Health'],
    ['Costs', 'Costs'],
    ['Installers', 'Installers'],
    ['Errors', 'Errors'],
  ] as const) {
    await nav.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await noSeriousViolations(page);
  }
});

test('the usage charts have a table behind them and change range', async ({ page }) => {
  await signInTo(page, '/admin/usage', STAFF);
  await page.getByRole('button', { name: '7 days' }).click();
  await expect(page.getByRole('button', { name: '7 days' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const first = page.locator('details.viz-table').first();
  await first.getByText('Show as a table').click();
  // Seven days, seven rows.
  await expect(first.locator('tbody tr')).toHaveCount(7);
});

test('an installer drill-down opens from the list', async ({ page }) => {
  await signInTo(page, '/admin/tenants', STAFF);
  const firstInstaller = page.locator('tbody tr').first().getByRole('link').first();
  const name = (await firstInstaller.textContent()) ?? '';
  await firstInstaller.click();
  await expect(page.getByRole('heading', { name: name.trim(), level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: /Models/ })).toBeVisible();
});

test('anyone else is turned away', async ({ page }) => {
  await signInTo(page, '/admin', OUTSIDER);
  await expect(page.getByRole('heading', { name: 'This page isn’t available' })).toBeVisible();
  const api = await page.request.get(`${SITE}/api/portal/v1/admin/overview`, {
    headers: { 'x-sunny-csrf': '1' },
  });
  expect(api.status()).toBe(404);
});
