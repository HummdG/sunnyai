import { expect, test } from '@playwright/test';

/**
 * The widget's lazy modules, loaded by a page on another origin.
 *
 * The widget itself arrives as a classic `<script src>`, which a browser runs
 * from any origin. The 3D roof (`sunny-roof.js`) and voice (`sunny-voice.js`)
 * arrive later through `import()`, and a module import is a CORS request: with
 * no `access-control-allow-origin` on the response the browser refuses it. On
 * our own site everything is one origin, so nothing failed; on an installer's
 * site the "See your roof in 3D" button did nothing at all, and voice could
 * never start.
 *
 * The two hosts are the two pieces of code that serve these files:
 * `scripts/static-server.ts` for the fixtures and `apps/marketing/next.config.mjs`
 * for the deployed site.
 */

const DEMO_PORT = Number(process.env.DEMO_PORT ?? 4173);
const MARKETING_PORT = Number(process.env.MARKETING_PORT ?? 4176);

test('the 3D roof and voice modules import into a page on another origin', async ({ page }) => {
  // localhost here, 127.0.0.1 below: two origins, as on an installer's site.
  await page.goto('/');

  const hosts = [
    ['the demo host', `http://127.0.0.1:${DEMO_PORT}`],
    ['the marketing host', `http://127.0.0.1:${MARKETING_PORT}`],
  ] as const;

  for (const [label, origin] of hosts) {
    for (const file of ['sunny-roof.js', 'sunny-voice.js']) {
      const result = await page.evaluate(async (url: string) => {
        try {
          const module = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
          return { exports: Object.keys(module).sort() };
        } catch (error) {
          return { error: String(error) };
        }
      }, `${origin}/widget/${file}`);

      expect(result, `${label} refused ${file}: ${JSON.stringify(result)}`).not.toHaveProperty(
        'error',
      );
    }
  }
});
