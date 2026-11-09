import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * An installer's own question changes a visitor's quote, end to end.
 *
 * The installer publishes a price list and saves a conversation with one
 * question of their own ("Do you have an electric car?", whose "Yes" adds their
 * EV charger). A visitor answers it in the widget, the quote carries the charger
 * at its listed price in every option, and the installer's lead page shows the
 * question and the answer in the installer's wording.
 *
 * The chat model is the scripted demo assistant (no model is called) with
 * SunScan in replay mode; see playwright.conversation-flow.config.ts.
 */

const SITE = `http://localhost:${process.env.MARKETING_PORT ?? 4197}`;
const API = `http://localhost:${process.env.API_PORT ?? 8897}`;
const WIDGET = `http://localhost:${process.env.WIDGET_PORT ?? 4199}`;
const RUN = Date.now().toString(36);
const OWNER = `owner-${RUN}@flow.test`;

const EV_KEY = 'EV-PROJECTEV-7KW-UNTETHERED';
const QUESTION = 'Do you have an electric car?';
const YES = 'Yes, I have one';
const NO = 'No, not yet';

test.setTimeout(240_000);

// The installer's website, served for real on a port of its own: a page the browser
// sees as local may call the local API, which a faked response may not.
let publicId = '';
let ORIGIN = '';
const website = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(
    '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Flow Solar</title></head>' +
      `<body><main><h1>Flow Solar</h1></main><script src="${WIDGET}/widget/sunny-widget.js" ` +
      `data-widget-id="${publicId}" data-api-url="${API}" async></script></body></html>`,
  );
});
test.beforeAll(async () => {
  await new Promise<void>((resolve) => website.listen(0, 'localhost', resolve));
  ORIGIN = `http://localhost:${(website.address() as AddressInfo).port}`;
});
test.afterAll(() => {
  website.close();
});
test.skip(
  process.env.CONVERSATION_FLOW_E2E !== '1',
  'needs playwright.conversation-flow.config.ts',
);

/** The charger's listed price in the example price list the installer publishes. */
function listedPrice(): number {
  const csv = readFileSync(
    join(process.cwd(), 'fixtures/catalogue/hsenergy-price-list.csv'),
    'utf8',
  );
  const line = csv.split('\n').find((l) => l.split(',')[1] === EV_KEY);
  // The row's fields, allowing quoted ones such as "£1,095"; Amount is the seventh.
  const fields = [...(line ?? '').matchAll(/"([^"]*)"|([^,]*)(?:,|$)/g)].map((m) => m[1] ?? m[2]);
  const amount = /^£([\d,]+)$/.exec(fields[6] ?? '');
  if (!amount) throw new Error(`${EV_KEY} has no £ amount in the fixture`);
  return Number(amount[1]!.replace(/,/g, ''));
}
const gbp = (n: number) => `£${n.toLocaleString('en-GB')}`;

test("an installer's electric-car question adds their charger to the visitor's quote", async ({
  page,
  request,
}) => {
  // The installer: a tenant, the example price list, and their own question.
  const login = await request.post(`${API}/v1/portal/dev-login`, { data: { email: OWNER } });
  const token = ((await login.json()) as { token: string }).token;
  const auth = { authorization: `Bearer ${token}` };
  const created = await request.post(`${API}/v1/portal/tenants`, {
    headers: auth,
    data: { companyName: `Flow Solar ${RUN}` },
  });
  expect(created.status()).toBe(201);
  const { tenant } = (await created.json()) as { tenant: { id: string; publicId: string } };
  publicId = tenant.publicId;
  const base = `${API}/v1/portal/tenants/${tenant.id}`;

  const example = await request.post(`${base}/catalogue/example`, { headers: auth });
  expect(example.ok()).toBe(true);
  const { upload, priceList } = (await example.json()) as {
    upload: { id: string };
    priceList: { id: string };
  };
  expect(
    (await request.post(`${base}/catalogue/upload/${upload.id}/publish`, { headers: auth })).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`${base}/catalogue/price-list/upload/${priceList.id}/publish`, {
        headers: auth,
      })
    ).ok(),
  ).toBe(true);

  const saved = await request.put(`${base}/conversation`, {
    headers: auth,
    data: {
      flow: {
        version: 0,
        updatedAt: new Date().toISOString(),
        steps: [
          {
            kind: 'custom',
            id: 'c_electriccar',
            prompt: QUESTION,
            mode: 'quote',
            answer: 'choice',
            choices: [
              { value: 'yes', label: YES, effects: [{ kind: 'add', itemKey: EV_KEY }] },
              { value: 'no', label: NO, effects: [] },
            ],
          },
        ],
      },
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);

  // Connecting the website registers its domain for the widget.
  const connected = await request.post(`${base}/knowledge/website`, {
    headers: auth,
    data: { url: `${ORIGIN}/` },
  });
  expect(connected.ok()).toBe(true);

  // The visitor: the widget on the installer's site.
  let session: { sessionId: string; sessionToken: string } | null = null;
  page.on('response', async (response) => {
    if (response.url().endsWith('/v1/widget/session') && response.ok()) {
      session = (await response.json()) as { sessionId: string; sessionToken: string };
    }
  });
  await page.goto(`${ORIGIN}/`);
  const host = page.locator(`[data-sunny-widget="${tenant.publicId}"]`);
  await host.locator('button[aria-label^="Open"]').click();
  const panel = host.locator('[role="dialog"]');
  await expect(panel).toBeVisible();

  await panel.locator('.composer-input').fill('20 Forthlin Road, Liverpool L18 9TN');
  await panel.locator('.composer-send').click();

  // Answer whatever Sunny asks with the first tap, but the installer's question with "Yes".
  const cards = panel.locator('ul[aria-label="Your quote options"] > li');
  const chips = panel.locator('[aria-label="Answers you can tap"] button');
  let asked = false;
  for (let turn = 0; turn < 30 && (await cards.count()) === 0; turn++) {
    await expect(chips.first().or(cards.first())).toBeVisible({ timeout: 60_000 });
    if ((await cards.count()) > 0) break;
    const yes = chips.filter({ hasText: YES });
    if ((await yes.count()) > 0) {
      asked = true;
      await expect(panel).toContainText(QUESTION);
      await yes.click();
    } else {
      await chips.first().click();
    }
    await page.waitForTimeout(500);
  }
  expect(asked, "Sunny asked the installer's own question").toBe(true);
  await expect(cards).toHaveCount(3, { timeout: 60_000 });

  // The lead, with the quote attached.
  const { sessionId, sessionToken } = session!;
  const visitor = { authorization: `Bearer ${sessionToken}`, origin: ORIGIN };
  const lead = await request.post(`${API}/v1/leads`, {
    headers: visitor,
    data: { sessionId, consent: true, email: `visitor-${RUN}@example.com`, name: 'Pat' },
  });
  expect(lead.status()).toBeLessThan(300);
  const { leadId } = (await lead.json()) as { leadId: string };

  // Every quote option carries the charger once, at its listed price.
  const price = listedPrice();
  const quoted = await request.get(`${base}/leads/${leadId}/quote`, { headers: auth });
  const { quote } = (await quoted.json()) as {
    quote: {
      options: Array<{ lineItems: Array<{ sku: string; quantity: number; totalGbp: number }> }>;
    };
  };
  expect(quote.options.length).toBeGreaterThanOrEqual(3);
  for (const option of quote.options) {
    const lines = option.lineItems.filter((l) => l.sku === EV_KEY);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.totalGbp).toBe(price);
  }

  // The installer's dashboard: the quote's lines, and the answer in their words.
  await page.goto(`${SITE}/sign-in`);
  await page.evaluate((id) => window.localStorage.setItem('sunny.portal.tenant', id), tenant.id);
  await page.getByLabel('Work email').fill(OWNER);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
  await page.goto(`${SITE}/dashboard/leads/${leadId}`);

  const answers = page.getByRole('region', { name: 'Their answers' });
  await expect(answers).toContainText(QUESTION);
  await expect(answers).toContainText(YES);

  const options = page.locator('article.quote-option');
  await expect(options).toHaveCount(quote.options.length);
  for (let i = 0; i < quote.options.length; i++) {
    const option = options.nth(i);
    await option.locator('summary').click();
    const line = option.locator('.quote-lines tr', { hasText: /EV Charger/i });
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(gbp(price));
  }
});
