/**
 * Renders the site's share image: `og-image.html`, beside this file, screenshot
 * at 1200x630 (the size Open Graph and X cards display) into
 * `app/opengraph-image.png`, which Next.js turns into the og:image tags.
 *
 *   node apps/marketing/scripts/og/render-og-image.mjs
 *
 * The PNG is committed; this only needs running after the page changes.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const page = fileURLToPath(new URL('./og-image.html', import.meta.url));
const out = fileURLToPath(new URL('../../app/opengraph-image.png', import.meta.url));

const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await tab.goto(pathToFileURL(page).href, { waitUntil: 'load' });
  await tab.evaluate('document.fonts.ready');
  await tab.screenshot({ path: out, type: 'png' });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
