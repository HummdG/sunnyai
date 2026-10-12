import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * The Firebase sign-in flows end to end, against the Firebase Auth emulator:
 * email + password with verification, password reset, passwordless email link
 * and Google. Run with `npm run test:e2e:auth-firebase` (config:
 * tests/e2e/auth-firebase.config.ts), which starts the emulator, an API that
 * accepts emulator tokens, and a site built with Firebase switched on.
 *
 * The emails Firebase "sends" are read back from the emulator's REST API, and
 * each link is followed through the site's own `/auth/action` page -- the same
 * page the real email action URL points at in production.
 */

const SITE = `http://localhost:${process.env.AUTH_E2E_SITE_PORT ?? 4198}`;
const EMULATOR = 'http://127.0.0.1:9099';
const PROJECT = 'demo-sunny';
const RUN = Date.now().toString(36);
const OWNER = `owner-${RUN}@brightside.test`;
const FIRST_PASSWORD = 'sunny-first-9271';
const NEW_PASSWORD = 'sunny-second-4410';

type OobCode = { email: string; requestType: string; oobLink: string };

/** The newest emulator "email" of a kind for an address, as a site action URL. */
async function actionLink(page: Page, email: string, requestType: string): Promise<string> {
  let found: OobCode | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${EMULATOR}/emulator/v1/projects/${PROJECT}/oobCodes`,
        );
        const { oobCodes } = (await response.json()) as { oobCodes: OobCode[] };
        found = oobCodes
          .filter((c) => c.email.toLowerCase() === email.toLowerCase())
          .filter((c) => c.requestType === requestType)
          .at(-1);
        return found !== undefined;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  // Keep the emulator's query (mode, oobCode, apiKey); route it to our handler.
  return `${SITE}/auth/action${new URL(found!.oobLink).search}`;
}

/** The session is an HttpOnly cookie, and nothing token-shaped is in storage. */
async function expectSecureSession(page: Page, context: BrowserContext): Promise<void> {
  const session = (await context.cookies(SITE)).find((c) => c.name === 'sunny_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('sunny_session=');
  const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
  // A JWT starts "eyJ"; Firebase keeps its own state in IndexedDB, not here.
  expect(stored).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
}

async function signOutFromHeader(page: Page, context: BrowserContext): Promise<void> {
  await page.goto(`${SITE}/`);
  await page.getByRole('banner').getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
  expect((await context.cookies(SITE)).find((c) => c.name === 'sunny_session')).toBeUndefined();
}

test.describe.configure({ mode: 'serial' });

// One browser for the whole journey: signing up, out, back in and resetting a
// password are one person's story, and each step starts where the last ended.
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser, request }) => {
  // A clean emulator: accounts from a previous run would change the flows.
  await request.delete(`${EMULATOR}/emulator/v1/projects/${PROJECT}/accounts`);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test('the dashboard is for signed-in installers only', async () => {
  await page.goto(`${SITE}/dashboard/leads`);
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard%2Fleads/);
});

test('sign up with a password, verify the email, land in onboarding', async () => {
  await page.goto(`${SITE}/`);
  await page.getByRole('banner').getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/sign-up/);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByLabel('Choose a password', { exact: true }).fill(FIRST_PASSWORD);
  await page.getByRole('button', { name: 'Create my account' }).click();

  // Unverified accounts get no session: the site waits for the email link.
  await expect(page).toHaveURL(/\/verify-email/);
  expect((await context.cookies(SITE)).find((c) => c.name === 'sunny_session')).toBeUndefined();

  await page.goto(await actionLink(page, OWNER, 'VERIFY_EMAIL'));
  await expect(page).toHaveURL(/\/dashboard\/onboarding/);
  await expectSecureSession(page, context);
});

test('sign out, then the dashboard is closed again', async () => {
  await page.goto(`${SITE}/dashboard`);
  await signOutFromHeader(page, context);
  await page.goto(`${SITE}/dashboard`);
  await expect(page).toHaveURL(/\/sign-in/);
});

test('sign in again with the password', async () => {
  await page.goto(`${SITE}/sign-in?next=%2Fdashboard%2Fteam`);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByLabel('Password', { exact: true }).fill(FIRST_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/(team|onboarding)/);
  await expectSecureSession(page, context);
  await signOutFromHeader(page, context);
});

test('a wrong password is refused in plain English', async () => {
  await page.goto(`${SITE}/sign-in`);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password-1');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByText(/don.t match/)).toBeVisible();
  expect((await context.cookies(SITE)).find((c) => c.name === 'sunny_session')).toBeUndefined();
});

test('forgot password: reset by email link, then sign in with the new one', async () => {
  await page.goto(`${SITE}/sign-in`);
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible();

  await page.goto(await actionLink(page, OWNER, 'PASSWORD_RESET'));
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save my new password' }).click();
  await expect(page).toHaveURL(/\/sign-in\?reset=1/);

  // The old password no longer works; the new one does.
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByLabel('Password', { exact: true }).fill(FIRST_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByText(/don.t match/)).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expectSecureSession(page, context);
  await signOutFromHeader(page, context);
});

test('passwordless: sign in from an emailed link', async () => {
  await page.goto(`${SITE}/sign-in`);
  await page.getByRole('button', { name: 'Email me a link instead' }).click();
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText(/we.ve sent a sign-in link/i)).toBeVisible();

  await page.goto(await actionLink(page, OWNER, 'EMAIL_SIGNIN'));
  await expect(page).toHaveURL(/\/dashboard/);
  await expectSecureSession(page, context);
  await signOutFromHeader(page, context);
});

test('Google sign-in through the emulator, as a brand-new installer', async () => {
  await page.goto(`${SITE}/sign-in`);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();

  // The emulator's stand-in for Google's account chooser.
  await popup.getByText('Add new account').click();
  await popup.locator('#email-input').fill(`google-${RUN}@brightside.test`);
  await popup.locator('#display-name-input').fill('Gina Google');
  await popup.locator('#sign-in').click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expectSecureSession(page, context);
});
