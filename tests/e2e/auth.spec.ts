import { expect, test } from '@playwright/test';

/**
 * Signing in through the website (the merged app: site + /dashboard).
 *
 * Runs with the API's development sign-in (SUNNY_DEV_AUTH=1), which goes
 * through exactly the same `/api/session` -> HttpOnly cookie path as Firebase.
 * The Firebase-specific flows (password with verification, reset, email link,
 * Google) run against the Firebase Auth emulator in auth-firebase.spec.ts
 * (`npm run test:e2e:auth-firebase`), which has its own config.
 */

const SITE = `http://localhost:${process.env.MARKETING_PORT ?? 4176}`;
const RUN = Date.now().toString(36);
const OWNER = `auth-${RUN}@brightside.test`;

test.describe.configure({ mode: 'serial' });

test('the dashboard is for signed-in installers only', async ({ page }) => {
  await page.goto(`${SITE}/dashboard/leads`);
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard%2Fleads/);
});

test('sign up from the website header, then sign out and back in', async ({ page, context }) => {
  await page.goto(`${SITE}/`);
  await page.getByRole('banner').getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/sign-up/);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page).toHaveURL(/\/dashboard\/onboarding/);

  // The credential is HttpOnly: page script can see only the expiry companion.
  const cookies = await context.cookies(SITE);
  const session = cookies.find((c) => c.name === 'sunny_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('sunny_session=');
  expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain('ses.');

  // Signed in: the site header offers the dashboard instead of sign-in.
  await page.goto(`${SITE}/`);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Dashboard' })).toBeVisible();

  // Sign out from the header's account menu.
  await page.getByRole('banner').getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
  expect((await context.cookies(SITE)).find((c) => c.name === 'sunny_session')).toBeUndefined();
  await page.goto(`${SITE}/dashboard`);
  await expect(page).toHaveURL(/\/sign-in/);

  // Back in, and sent where they were going.
  await page.goto(`${SITE}/sign-in?next=%2Fdashboard%2Fteam`);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/(team|onboarding)/);
});

test('a crafted next= cannot send someone off-site', async ({ page }) => {
  await page.goto(`${SITE}/sign-in?next=${encodeURIComponent('https://evil.example/')}`);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(new RegExp(`^${SITE}/dashboard`));
});

test('the dashboard proxy refuses cross-site writes and other API areas', async ({ request }) => {
  const forged = await request.post(`${SITE}/api/portal/v1/portal/tenants`, {
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    data: { companyName: 'Evil' },
  });
  expect(forged.status()).toBe(403);
  const noHeader = await request.post(`${SITE}/api/portal/v1/portal/tenants`, {
    data: { companyName: 'No header' },
  });
  expect(noHeader.status()).toBe(403);
  const elsewhere = await request.get(`${SITE}/api/portal/v1/catalog/products`);
  expect(elsewhere.status()).toBe(404);
  const signedOut = await request.get(`${SITE}/api/portal/v1/portal/me`);
  expect(signedOut.status()).toBe(401);
});
