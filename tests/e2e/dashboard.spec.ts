import { createHmac } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The installer portal, end to end (Blueprint §3.1 onboarding; plan §6.3–6.4).
 *
 * Runs against the real API with development sign-in (SUNNY_DEV_AUTH=1 in
 * playwright.config.ts) and drives billing with Stripe events signed by the
 * same secret the API is configured with, so no Stripe account is involved.
 */

const SITE = `http://localhost:${process.env.MARKETING_PORT ?? 4176}`;
const API = `http://localhost:${process.env.API_PORT ?? 8787}`;
const WHSEC = 'whsec_e2e_dashboard';

// Unique per run: the e2e data directory persists between runs.
const RUN = Date.now().toString(36);
const OWNER = `owner-${RUN}@brightside.test`;
const COMPANY = `Brightside Solar ${RUN}`;
const SITE_HOST = `brightside-${RUN}.example`;

test.describe.configure({ mode: 'serial' });

let tenantId = '';
let publicId = '';

/** A dev sign-in token for calling the API directly (the browser holds none). */
async function token(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API}/v1/portal/dev-login`, { data: { email: OWNER } });
  return ((await login.json()) as { token: string }).token;
}

/** Sign in from the website header, as an installer would. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${SITE}/`);
  await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByRole('button', { name: /sign in/i }).click();
  // The session cookie is set before this navigation; wait for it.
  await page.waitForURL(/\/dashboard/);
}

async function signedStripeEvent(request: APIRequestContext, event: Record<string, unknown>) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WHSEC).update(`${t}.${raw}`).digest('hex');
  return await request.post(`${API}/v1/billing/webhook`, {
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
    data: raw,
  });
}

test('a new installer signs up and the wizard remembers where they are', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard\/onboarding/);
  await page.getByLabel('Company name').fill(COMPANY);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Your website' })).toBeVisible();
  await page.getByLabel('Website address').fill(`https://www.${SITE_HOST}/`);
  await page.getByRole('button', { name: 'Connect website' }).click();
  await expect(page.getByRole('heading', { name: 'Your Google Drive folder' })).toBeVisible();

  // The step is stored on the server: a reload resumes on it.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your Google Drive folder' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();

  await expect(page.getByRole('heading', { name: 'Make Sunny yours' })).toBeVisible();
  await page.getByRole('button', { name: 'Purple' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Add Sunny to your website' })).toBeVisible();
  const snippet = await page.getByLabel('Install snippet').textContent();
  publicId = /data-widget-id="(w_[a-z0-9]+)"/.exec(snippet ?? '')?.[1] ?? '';
  expect(publicId).not.toBe('');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Going live needs the installer's phone for customers who need help.
  await expect(page.getByRole('heading', { name: 'Go live' })).toBeVisible();
  await expect(page.locator('#phone-warning')).toContainText('Add your phone number');
  await expect(page.getByRole('button', { name: 'Go live' })).toBeDisabled();
  await page.getByLabel(/Installer phone/).fill('01632 960123');
  await page.getByRole('button', { name: 'Go live' }).click();

  await expect(
    page.getByRole('heading', { name: new RegExp(`(Morning|Afternoon|Evening), ${COMPANY}`) }),
  ).toBeVisible();
  const me = await page.request.get(`${API}/v1/portal/me`, {
    headers: { authorization: `Bearer ${await token(page.request)}` },
  });
  tenantId = (await me.json()).tenants[0].id as string;
  expect(tenantId).toMatch(/^t_/);
});

test('a conversation from the live widget appears in the inbox, escalation first', async ({
  page,
  request,
}) => {
  // A visitor on the installer's site reports a safety problem through the
  // widget API. This path is answered by the server without a model.
  const session = await request.post(`${API}/v1/widget/session`, {
    data: { publicId, origin: `https://www.${SITE_HOST}` },
  });
  expect(session.ok()).toBe(true);
  const { sessionId, sessionToken } = (await session.json()) as {
    sessionId: string;
    sessionToken: string;
  };
  const chat = await request.post(`${API}/v1/chat/stream`, {
    headers: { authorization: `Bearer ${sessionToken}` },
    data: {
      sessionId,
      clientMessageId: `m-${RUN}`,
      text: 'There is smoke coming from my inverter',
    },
  });
  expect(chat.ok()).toBe(true);
  await chat.text();

  await signIn(page);
  await page.goto(`${SITE}/dashboard/inbox`);
  const first = page.getByRole('list', { name: 'Conversations' }).getByRole('button').first();
  await expect(first).toContainText('Safety escalation');
  await expect(first).toContainText('smoke');
  await first.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Call this customer back' }),
  ).toBeVisible();

  await page.goto(`${SITE}/dashboard`);
  await expect(page.getByText(/safety escalations? needs? a call back/i)).toBeVisible();
});

test('a signed Stripe event switches an add-on on, exactly once', async ({ page, request }) => {
  await signIn(page);
  await page.goto(`${SITE}/dashboard/billing`);
  const emailRow = page.locator('.addon-row').filter({ hasText: 'Email Assistant' });
  await expect(emailRow).toContainText('Not included');

  const event = {
    id: `evt_e2e_${RUN}`,
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        client_reference_id: tenantId,
        customer: `cus_e2e_${RUN}`,
        subscription: `sub_e2e_${RUN}`,
        metadata: { tenant_id: tenantId, plan: 'email' },
      },
    },
  };
  const first = await signedStripeEvent(request, event);
  expect((await first.json()).outcome).toBe('applied');
  const again = await signedStripeEvent(request, event);
  expect((await again.json()).outcome).toBe('duplicate');

  const forged = await request.post(`${API}/v1/billing/webhook`, {
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
    data: JSON.stringify({ ...event, id: `evt_forged_${RUN}` }),
  });
  expect(forged.status()).toBe(400);

  await page.reload();
  await expect(page.locator('.addon-row').filter({ hasText: 'Email Assistant' })).toContainText(
    'Included',
  );
});

test('another installer cannot open this one', async ({ request }) => {
  const login = await request.post(`${API}/v1/portal/dev-login`, {
    data: { email: `stranger-${RUN}@other.test` },
  });
  const { token: strangerToken } = (await login.json()) as { token: string };
  const response = await request.get(`${API}/v1/portal/tenants/${tenantId}/inbox`, {
    headers: { authorization: `Bearer ${strangerToken}` },
  });
  expect(response.status()).toBe(404);
});
