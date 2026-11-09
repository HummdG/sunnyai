import { createHmac } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

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
  // One tab per kind of website, each with the same widget id in its own syntax.
  const platforms = page.getByRole('tablist', { name: 'Your website platform' });
  await platforms.getByRole('tab', { name: 'WordPress' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('WPCode');
  await expect(page.getByLabel(/functions\.php/)).toContainText(publicId);
  await page.keyboard.press('ArrowRight');
  await expect(platforms.getByRole('tab', { name: 'Wix' })).toBeFocused();
  await expect(platforms.getByRole('tab', { name: 'Wix' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await platforms.getByRole('tab', { name: 'React and Next.js' }).click();
  await expect(page.getByLabel('Next.js', { exact: true })).toContainText(
    `data-widget-id="${publicId}"`,
  );
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

/** A dark opaque tile with a lime bar across the middle: a logo the server can trace. */
function tilePng(): Buffer {
  const image = new PNG({ width: 80, height: 80 });
  for (let y = 0; y < 80; y++)
    for (let x = 0; x < 80; x++) {
      const bar = y >= 30 && y < 50 && x >= 15 && x < 65;
      image.data.set(bar ? [163, 230, 53, 255] : [20, 24, 40, 255], (y * 80 + x) * 4);
    }
  return PNG.sync.write(image);
}

/** A lime disc on nothing, as an SVG: Studio turns it into a PNG before upload. */
const DISC_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
  '<circle cx="150" cy="150" r="110" fill="#a3e635"/></svg>';

async function widgetConfig(request: APIRequestContext): Promise<Record<string, unknown>> {
  const response = await request.get(`${API}/v1/widget/config/${publicId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

test('Studio swaps Sunny for the installer logo and name', async ({ page, request }) => {
  await signIn(page);
  await page.goto(`${SITE}/dashboard/studio`);
  const logo = page.getByRole('group', { name: 'Your logo' });
  await expect(logo).toBeVisible();
  await logo.getByLabel('Use my logo').check();

  await logo.getByLabel('Icon file').setInputFiles({
    name: 'tile.png',
    mimeType: 'image/png',
    buffer: tilePng(),
  });
  await expect(logo.getByText('Outline traced and checked.')).toBeVisible();
  // The traced outline is drawn over the uploaded image, and the image loads
  // through the same-origin proxy.
  await expect(logo.locator('.brand-slot img').first()).toHaveJSProperty('complete', true);
  await expect
    .poll(() =>
      logo
        .locator('.brand-slot img')
        .first()
        .evaluate((i) => (i as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(logo.locator('.brand-slot svg path').first()).toBeVisible();

  const animations = logo.getByRole('group', { name: 'Animations' });
  const boxes = animations.getByRole('checkbox');
  await expect(boxes).toHaveCount(7);
  for (const box of await boxes.all()) await box.uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Choose at least one animation.' }),
  ).toBeVisible();

  await animations.getByLabel('Comet trace').check();
  await animations.getByLabel('Shimmer').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

  // The name and greeting are on their own tab, saved by their own button.
  await page.getByRole('tab', { name: 'Assistant settings' }).click();
  await expect(page).toHaveURL(/[?&]tab=settings/);
  await expect(logo).toBeHidden();
  // The browser checks the name the way the API does, and says how in plain words.
  const nameInput = page.getByLabel('Assistant name');
  const validity = () =>
    nameInput.evaluate((el) => ({
      valid: (el as HTMLInputElement).validity.valid,
      title: (el as HTMLInputElement).title,
    }));
  await nameInput.fill('Nova!');
  expect(await validity()).toEqual({
    valid: false,
    title: "Use letters, numbers, spaces and . ' & - only, up to 40 characters.",
  });
  await nameInput.fill("Nova & Co. O'Neil-2");
  expect((await validity()).valid).toBe(true);
  // Starter buttons are what visitors ask, shown as chips beside the form.
  const starters = page.getByRole('textbox', { name: /^Starter buttons/ });
  await expect(starters).toHaveAccessibleDescription(/what visitors ask Sunny/);
  await starters.fill('How much could I save?\nDo you fit batteries?');
  await expect(
    page.getByRole('list', { name: 'Starter buttons' }).getByRole('listitem'),
  ).toHaveText(['How much could I save?', 'Do you fit batteries?']);
  await page.getByLabel('Assistant name').fill('Volt');
  await expect(page.getByLabel('Greeting')).toHaveValue(/I'm Volt/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  const branded = await widgetConfig(request);
  expect(branded['assistantName']).toBe('Volt');
  expect(branded['greeting']).toContain("I'm Volt");
  expect((branded['brand'] as { effects: string[] }).effects).toEqual(['comet', 'shimmer']);

  // The preview shows the logo, not the character.
  await page.getByRole('tab', { name: 'Your brand' }).click();
  const preview = page.getByLabel('Live preview');
  await expect(preview.locator('.sunny-preview')).toHaveCount(0);
  await expect(preview.locator('[data-logo-effect]').first()).toBeVisible();
  // It looks like the widget: its pale header, and a launcher with no backing disc.
  const css = (selector: string, prop: string) =>
    preview
      .locator(selector)
      .first()
      .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  expect(await css('.logo-preview-header', 'background-color')).toBe('rgb(255, 241, 229)');
  expect(await css('.logo-preview-header', 'color')).toBe('rgb(23, 23, 23)');
  // The launcher sits on the widget's chip (light or dark by the logo), as on a site.
  expect(['rgb(255, 255, 255)', 'rgb(29, 33, 41)']).toContain(
    await css('.logo-preview-launcher', 'background-color'),
  );
  expect(await css('.logo-preview-launcher', 'padding-top')).toBe('16px');

  // An SVG is rasterised in the browser: the server only ever receives a PNG.
  const uploaded = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/brand\/icon$/.test(r.url()),
  );
  await logo.getByLabel('Icon file').setInputFiles({
    name: 'disc.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(DISC_SVG),
  });
  const upload = await uploaded;
  expect(upload.ok()).toBe(true);
  const body = upload.request().postDataJSON() as { png: string };
  expect(body.png.startsWith('iVBORw0KGgo')).toBe(true);
  await expect(logo.getByText('Outline traced and checked.')).toBeVisible();

  await logo.getByLabel('Use Sunny').check();
  const saving = page.waitForResponse((r) => /\/settings$/.test(r.url()));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saving).ok()).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect.poll(async () => 'brand' in (await widgetConfig(request))).toBe(false);
  await expect(preview.locator('.sunny-preview')).toHaveCount(1);
});

test('each Studio tab saves only its own part, and leaves the other as it was', async ({
  page,
}) => {
  interface Saved {
    primaryColor: string;
    greeting: string;
    tagline: string | null;
    position: string;
    assistantName: string;
    suggestions: string[];
    branding: unknown;
  }
  await signIn(page);
  const headers = { authorization: `Bearer ${await token(page.request)}` };
  const stored = async (): Promise<Saved> => {
    const response = await page.request.get(`${API}/v1/portal/tenants/${tenantId}`, { headers });
    return ((await response.json()) as { tenant: Saved }).tenant;
  };
  const saving = () =>
    page.waitForRequest((r) => r.method() === 'POST' && /\/settings$/.test(r.url()));
  const before = await stored();

  // The brand tab sends its colour and logo, nothing else.
  await page.goto(`${SITE}/dashboard/studio`);
  await page
    .getByRole('group', { name: 'Brand colour' })
    .getByRole('button', { name: 'Purple' })
    .click();
  const brandSave = saving();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(Object.keys((await brandSave).postDataJSON() as object).sort()).toEqual([
    'branding',
    'primaryColor',
  ]);
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  const afterBrand = await stored();
  expect(afterBrand.primaryColor).toBe('#7C4DFF');
  for (const key of ['greeting', 'tagline', 'position', 'assistantName', 'suggestions'] as const) {
    expect(afterBrand[key]).toEqual(before[key]);
  }

  // The settings tab sends its own fields, and the colour and logo stay.
  await page.getByRole('tab', { name: 'Assistant settings' }).click();
  await page.getByLabel('Tagline under your name').fill('Solar, sorted');
  const settingsSave = saving();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(Object.keys((await settingsSave).postDataJSON() as object).sort()).toEqual([
    'assistantName',
    'greeting',
    'position',
    'suggestions',
    'tagline',
  ]);
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  const afterSettings = await stored();
  expect(afterSettings.tagline).toBe('Solar, sorted');
  expect(afterSettings.primaryColor).toBe('#7C4DFF');
  expect(afterSettings.branding).toEqual(afterBrand.branding);
  expect(afterSettings.greeting).toBe(before.greeting);
  expect(afterSettings.suggestions).toEqual(before.suggestions);
  expect(afterSettings.assistantName).toBe(before.assistantName);
});

test('an unsaved logo stays with its installer when the owner switches', async ({ page }) => {
  // A second installer for the same owner, so the dashboard shows its switcher.
  const second = await page.request.post(`${API}/v1/portal/tenants`, {
    headers: { authorization: `Bearer ${await token(page.request)}` },
    data: { companyName: `Second Site ${RUN}` },
  });
  expect(second.ok()).toBe(true);

  await signIn(page);
  await page.goto(`${SITE}/dashboard/studio?tab=settings`);
  await expect(page.getByLabel('Assistant name')).toHaveValue('Volt');
  // Arrow keys move along the Studio tabs, and the open tab is in the address.
  await page.getByRole('tab', { name: 'Assistant settings' }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Your brand' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page).toHaveURL(/[?&]tab=brand/);
  const logo = page.getByRole('group', { name: 'Your logo' });
  await logo.getByLabel('Use my logo').check();
  await logo.getByLabel('Icon file').setInputFiles({
    name: 'tile.png',
    mimeType: 'image/png',
    buffer: tilePng(),
  });
  await expect(logo.getByText('Outline traced and checked.')).toBeVisible();

  // A second upload is still in flight when the owner switches installer.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/brand/icon', async (route) => {
    await held;
    await route.continue();
  });
  await logo.getByLabel('Icon file').setInputFiles({
    name: 'tile.png',
    mimeType: 'image/png',
    buffer: tilePng(),
  });
  await expect(logo.getByRole('button', { name: 'Uploading…' })).toBeVisible();
  const late = page.waitForResponse((r) => /\/brand\/icon$/.test(r.url()));
  await page
    .getByRole('combobox', { name: 'Installer' })
    .selectOption({ label: `Second Site ${RUN}` });
  await expect(page.getByLabel('Assistant name')).toHaveValue('Sunny');
  release();
  await late;

  // The second installer starts clean: none of the first one's draft came along.
  await expect(logo.getByLabel('Use Sunny')).toBeChecked();
  await expect(logo.getByLabel('Icon file')).toHaveCount(0);
  await logo.getByLabel('Use my logo').check();
  await expect(logo.getByRole('button', { name: 'Upload icon' })).toBeVisible();
  await expect(logo.locator('.brand-slot img')).toHaveCount(0);
});

test("the lead page shows the installer's questions and the visitor's answers", async ({
  page,
}) => {
  // The list answers with a lead from a customised conversation.
  await page.route(/\/leads$/, async (route) => {
    await route.fulfill({
      json: {
        leads: [
          {
            id: 'lead_flow1',
            name: 'Sarah Jones',
            email: 'sarah@customer.example',
            phone: null,
            postcode: 'LS6 2AB',
            summary: 'Wants solar and an EV charger',
            createdAt: new Date().toISOString(),
            conversationId: null,
            status: 'new',
            assessmentId: null,
            flowVersion: 3,
            flowAnswers: [
              {
                id: 'c_evcharger1',
                question: 'Would you like an EV charger fitted at the same time?',
                value: 'yes',
                answer: 'Yes please',
                mode: 'quote',
              },
              {
                id: 'c_evmodel',
                question: 'Which car is it?',
                value: 'A blue Polestar 2',
                answer: 'A blue Polestar 2',
                mode: 'lead',
              },
            ],
          },
        ],
      },
    });
  });
  await signIn(page);
  await page.goto(`${SITE}/dashboard/leads/lead_flow1`);
  const answers = page.getByRole('region', { name: 'Their answers' });
  await expect(answers).toBeVisible();
  await expect(
    answers.getByText('Would you like an EV charger fitted at the same time?'),
  ).toBeVisible();
  await expect(answers.getByText('Yes please')).toBeVisible();
  await expect(answers.getByText('Which car is it?')).toBeVisible();
  await expect(answers.getByText('A blue Polestar 2')).toBeVisible();
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
