import { expect, test } from '@playwright/test';

/**
 * The installer sees a lead's house in 3D.
 *
 * The real path end to end: a visitor on the installer's site gives an address
 * in the chat (the scripted demo assistant drives the same tools a model would,
 * against SunScan in replay mode -- the 20 Forthlin Road fixture, no network),
 * agrees to be contacted, and the installer opens the lead's page in the
 * dashboard, where the SunScan viewer draws the model.
 *
 * Needs the API with SUNNY_DEMO_ASSISTANT=1, SUNSCAN_HTTP_MODE=replay and
 * SUNNY_DEV_AUTH=1 (see playwright.lead-roof.config.ts).
 */

const SITE = `http://localhost:${process.env.MARKETING_PORT ?? 4176}`;
const API = `http://localhost:${process.env.API_PORT ?? 8787}`;
const RUN = Date.now().toString(36);
const OWNER = `owner-${RUN}@roof.test`;
const HOST = `roof-${RUN}.example`;
const ORIGIN = `https://www.${HOST}`;

test.setTimeout(240_000);
// Runs only under its own config, whose API has the demo assistant and replay
// SunScan; the main suite's API has neither.
test.skip(process.env.LEAD_ROOF_E2E !== '1', 'needs playwright.lead-roof.config.ts');

test("the lead page draws the visitor's roof in 3D", async ({ page, request }) => {
  // The installer, created through the API with a dev sign-in.
  const login = await request.post(`${API}/v1/portal/dev-login`, { data: { email: OWNER } });
  const token = ((await login.json()) as { token: string }).token;
  const auth = { authorization: `Bearer ${token}` };
  const created = await request.post(`${API}/v1/portal/tenants`, {
    headers: auth,
    data: { companyName: `Roof Solar ${RUN}` },
  });
  expect(created.status()).toBe(201);
  const { tenant } = (await created.json()) as { tenant: { id: string; publicId: string } };
  // Connecting the website registers its domain for the widget.
  const site = await request.post(`${API}/v1/portal/tenants/${tenant.id}/knowledge/website`, {
    headers: auth,
    data: { url: `${ORIGIN}/` },
  });
  expect(site.ok()).toBe(true);

  // A visitor on that site: a session, the address, then consent.
  const session = await request.post(`${API}/v1/widget/session`, {
    headers: { origin: ORIGIN },
    data: { publicId: tenant.publicId, origin: ORIGIN },
  });
  expect(session.ok()).toBe(true);
  const { sessionId, sessionToken } = (await session.json()) as {
    sessionId: string;
    sessionToken: string;
  };
  const visitor = { authorization: `Bearer ${sessionToken}`, origin: ORIGIN };
  const chat = await request.post(`${API}/v1/chat/stream`, {
    headers: visitor,
    data: { sessionId, clientMessageId: `m-${RUN}`, text: '20 Forthlin Road, Liverpool L18 9TN' },
  });
  expect(chat.ok()).toBe(true);
  await chat.text();
  const lead = await request.post(`${API}/v1/leads`, {
    headers: visitor,
    data: { sessionId, consent: true, email: `visitor-${RUN}@example.com`, name: 'Pat' },
  });
  expect(lead.status()).toBeLessThan(300);
  const { leadId } = (await lead.json()) as { leadId: string };

  // The assessment runs in the background; wait for its model.
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `${API}/v1/portal/tenants/${tenant.id}/leads/${leadId}/assessment`,
          { headers: auth },
        );
        return ((await response.json()) as { modelAvailable?: boolean }).modelAvailable === true;
      },
      { timeout: 120_000, intervals: [1000] },
    )
    .toBe(true);

  // The installer signs in on the website and opens the lead.
  await page.goto(`${SITE}/sign-in`);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
  await page.goto(`${SITE}/dashboard/leads/${leadId}`);

  await expect(page.getByRole('heading', { name: 'Roof assessment' })).toBeVisible();
  const stage = page.locator('.roof-3d-stage');
  await expect(stage).toBeVisible({ timeout: 60_000 });
  const canvas = stage.locator('canvas');
  await expect(canvas).toHaveCount(1);

  // Something was drawn: the canvas is not one flat colour.
  await expect
    .poll(
      async () => {
        const shot = await canvas.screenshot();
        return new Set(shot.subarray(200, 20_000)).size;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(20);

  await expect(page.getByRole('list', { name: 'Roof planes' })).toBeVisible();
  await expect(page.getByText(/Indicative — subject to an on-site survey/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download the 3D model (GLB)' })).toBeVisible();
});
