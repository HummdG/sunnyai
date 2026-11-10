import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * Sunny Studio's "Your quotation" tab, end to end: the installer sets who signs
 * the letter, their MCS number, a 25% deposit, 45 days' validity and their own
 * T&Cs, turns Performance off, watches the real PDF redraw, saves, and finds it
 * all still there after a reload; uploads a PDF logo and an accreditation logo;
 * a viewer sees everything read-only; and the sample PDF downloads.
 *
 * Runs against the real API with development sign-in (SUNNY_DEV_AUTH=1 in
 * playwright.config.ts). The preview is rendered by the API from a sample quote.
 */

const SITE = `http://localhost:${process.env.MARKETING_PORT ?? 4176}`;
const API = `http://localhost:${process.env.API_PORT ?? 8787}`;

const RUN = Date.now().toString(36);
const OWNER = `quote-owner-${RUN}@brightside.test`;
const VIEWER = `quote-viewer-${RUN}@brightside.test`;

const TERMS = [
  'PAYMENT',
  '',
  'A deposit of the amount shown is payable once your survey has confirmed the final price.',
  '',
  '1. The balance is due within 7 days of completion.',
].join('\r\n');

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 1300 } });

let tenantId = '';
let ownerToken = '';

/** A small PNG: a coloured bar on a plain ground, wide or square. */
function png(width: number, height: number, bar: [number, number, number]): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const inBar = y >= height * 0.3 && y < height * 0.7 && x >= width * 0.15 && x < width * 0.85;
      image.data.set(inBar ? [...bar, 255] : [255, 255, 255, 255], (y * width + x) * 4);
    }
  return PNG.sync.write(image);
}

async function signInAs(page: Page, email: string): Promise<void> {
  const target = '/dashboard/studio?tab=quotation';
  await page.goto(`${SITE}/sign-in?next=${encodeURIComponent(target)}`);
  await page.evaluate((id) => window.localStorage.setItem('sunny.portal.tenant', id), tenantId);
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard/studio');
}

const tab = (page: Page) => page.getByRole('tabpanel', { name: 'Your quotation' });
const card = (page: Page, name: string) => tab(page).getByRole('region', { name, exact: true });
const preview = (page: Page) => tab(page).getByRole('region', { name: 'Preview' });
const chips = (page: Page) => preview(page).getByRole('group', { name: 'Pages' });
const chip = (page: Page, name: string) => chips(page).getByRole('button', { name, exact: true });
const isPreview = (url: string) => url.endsWith('/quotation/preview');

/** Open the tab and wait for its first preview to draw. */
async function openAs(page: Page, email: string): Promise<void> {
  const first = page.waitForResponse((r) => isPreview(r.url()) && r.ok());
  await signInAs(page, email);
  await expect(page.getByRole('tab', { name: 'Your quotation' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await first;
  await expect(preview(page).locator('iframe')).toHaveAttribute('src', /^blob:/);
}

test.beforeAll(async ({ request }) => {
  const login = await request.post(`${API}/v1/portal/dev-login`, { data: { email: OWNER } });
  ownerToken = ((await login.json()) as { token: string }).token;
  const headers = { authorization: `Bearer ${ownerToken}` };
  const created = await request.post(`${API}/v1/portal/tenants`, {
    headers,
    data: { companyName: `Quote Solar ${RUN}` },
  });
  expect(created.status()).toBe(201);
  tenantId = ((await created.json()) as { tenant: { id: string } }).tenant.id;
  const invited = await request.post(`${API}/v1/portal/tenants/${tenantId}/members`, {
    headers,
    data: { email: VIEWER, role: 'viewer' },
  });
  expect(invited.ok()).toBe(true);
});

test('the settings redraw the preview, save, and are still there after a reload', async ({
  page,
  request,
}) => {
  await openAs(page, OWNER);
  // Cover and Quotation are locked on.
  const includes = card(page, 'What the PDF includes');
  await expect(includes.getByText('Always shown')).toHaveCount(2);
  await expect(chip(page, 'Performance')).toBeVisible();
  await expect(chip(page, 'Terms')).toHaveCount(0);

  const signer = card(page, 'Signed by');
  await signer.getByLabel('Name').fill('Alex Carter');
  await signer.getByLabel('Role').fill('Director');
  await card(page, 'Accreditations').getByLabel('MCS certificate number').fill('MCS-12345');

  const deposit = card(page, 'Deposit and validity');
  await deposit.getByRole('button', { name: 'Percentage', exact: true }).click();
  await deposit.getByLabel('Deposit percentage').fill('25');
  await deposit.getByLabel('Quote valid for (days)').fill('45');
  await expect(deposit).toContainText('Shown as a date, for example "Valid until');

  // Pasted T&Cs switch the Terms page on.
  await card(page, 'Your terms and conditions').getByLabel('Terms and conditions text').fill(TERMS);
  await expect(includes.getByRole('switch', { name: 'Your terms and conditions' })).toBeChecked();

  await expect(tab(page).getByText('Unsaved changes')).toBeVisible();
  const redrawn = page.waitForResponse((r) => isPreview(r.url()) && r.ok());
  await includes.getByRole('switch', { name: 'Performance' }).uncheck({ force: true });
  const response = await redrawn;
  const sent = response.request().postDataJSON() as {
    settings: { sections: { performance: boolean; terms: boolean }; deposit: unknown };
  };
  expect(sent.settings.sections.performance).toBe(false);
  expect(sent.settings.sections.terms).toBe(true);
  expect(sent.settings.deposit).toEqual({ kind: 'percent', percent: 25 });

  await expect(chip(page, 'Quotation')).toBeVisible();
  await expect(chip(page, 'Performance')).toHaveCount(0);
  await expect(chip(page, 'Terms')).toBeVisible();
  await chip(page, 'Quotation').click();
  await expect(chip(page, 'Quotation')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page).locator('iframe')).toHaveAttribute('src', /^blob:.*#page=\d+$/);

  await tab(page).getByRole('button', { name: 'Save quotation' }).click();
  await expect(tab(page).getByRole('status')).toContainText('Saved');
  await expect(tab(page).getByText('Unsaved changes')).toHaveCount(0);

  const stored = await request.get(`${API}/v1/portal/tenants/${tenantId}/quotation`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const view = (await stored.json()) as {
    saved: boolean;
    settings: { signer: { name: string }; validityDays: number; terms: string };
  };
  expect(view.saved).toBe(true);
  expect(view.settings.signer.name).toBe('Alex Carter');
  expect(view.settings.validityDays).toBe(45);
  expect(view.settings.terms).toContain('PAYMENT');

  await page.reload();
  await expect(card(page, 'Signed by').getByLabel('Name')).toHaveValue('Alex Carter');
  await expect(card(page, 'Accreditations').getByLabel('MCS certificate number')).toHaveValue(
    'MCS-12345',
  );
  await expect(
    card(page, 'Deposit and validity').getByRole('button', { name: 'Percentage', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'Deposit and validity').getByLabel('Deposit percentage')).toHaveValue(
    '25',
  );
  await expect(card(page, 'Deposit and validity').getByLabel('Quote valid for (days)')).toHaveValue(
    '45',
  );
  await expect(
    card(page, 'What the PDF includes').getByRole('switch', { name: 'Performance' }),
  ).not.toBeChecked();
  await expect(
    card(page, 'Your terms and conditions').getByLabel('Terms and conditions text'),
  ).toHaveValue(/PAYMENT/);
});

test('a PDF logo and an accreditation logo upload and save', async ({ page }) => {
  await openAs(page, OWNER);
  const logo = card(page, 'Logo');
  await expect(
    logo.getByRole('button', { name: 'Use a different logo for the PDF' }),
  ).toBeVisible();
  await logo.getByLabel('PDF logo file').setInputFiles({
    name: 'wordmark.png',
    mimeType: 'image/png',
    buffer: png(240, 60, [30, 120, 80]),
  });
  await expect(logo.getByRole('img', { name: 'Your PDF logo' })).toBeVisible();
  await expect(logo.getByRole('button', { name: 'Use the logo from Your brand' })).toBeVisible();

  const accreditations = card(page, 'Accreditations');
  await accreditations.getByLabel('Accreditation logo file').setInputFiles({
    name: 'trustmark.png',
    mimeType: 'image/png',
    buffer: png(120, 120, [20, 60, 160]),
  });
  await expect(accreditations.getByRole('listitem')).toHaveCount(1);
  await expect(accreditations).toContainText('1 of 8');

  await tab(page).getByRole('button', { name: 'Save quotation' }).click();
  await expect(tab(page).getByRole('status')).toContainText('Saved');

  await page.reload();
  await expect(card(page, 'Logo').getByRole('img', { name: 'Your PDF logo' })).toBeVisible();
  await expect(card(page, 'Accreditations').getByRole('listitem')).toHaveCount(1);
  // A picture of the finished tab, on request (QUOTE_SHOT=<path>).
  if (process.env.QUOTE_SHOT) {
    await expect(preview(page).locator('iframe')).toHaveAttribute('src', /^blob:/);
    await page.screenshot({ path: process.env.QUOTE_SHOT, fullPage: true });
  }
});

test('a viewer sees the settings and the preview, read-only', async ({ page }) => {
  await openAs(page, VIEWER);
  await expect(tab(page)).toContainText('Ask an admin to change them.');
  await expect(card(page, 'Signed by').getByLabel('Name')).toHaveValue('Alex Carter');
  await expect(card(page, 'Signed by').getByLabel('Name')).toBeDisabled();
  await expect(
    card(page, 'Your terms and conditions').getByLabel('Terms and conditions text'),
  ).toBeDisabled();
  await expect(
    card(page, 'What the PDF includes').getByRole('switch', { name: 'Savings and payback' }),
  ).toBeDisabled();
  await expect(
    card(page, 'Deposit and validity').getByRole('button', { name: 'None', exact: true }),
  ).toBeDisabled();
  await expect(
    card(page, 'Logo').getByRole('button', { name: 'Use the logo from Your brand' }),
  ).toBeDisabled();
  await expect(tab(page).getByRole('button', { name: 'Save quotation' })).toHaveCount(0);
  // The preview still works for them.
  await expect(chip(page, 'Terms')).toBeVisible();
  await chip(page, 'Cover').click();
  await expect(preview(page).locator('iframe')).toHaveAttribute('src', /#page=1$/);
});

test('the sample PDF downloads with the company in its name', async ({ page }) => {
  await openAs(page, OWNER);
  const download = page.waitForEvent('download');
  await tab(page).getByRole('button', { name: 'Download a sample PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/-sample-quotation\.pdf$/);
});
