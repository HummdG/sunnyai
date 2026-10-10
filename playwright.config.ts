import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: a real browser, the real widget bundle, the real API.
 *
 * Everything else in this repository tests a layer in isolation. This is the
 * only check that answers "does the thing a customer pastes into their page
 * actually work", and the only one that can catch the failures that live in the
 * seams -- a shadow root that renders but cannot be focused, a widget that mounts
 * before the API is up, a page whose landmark is not where the widget thinks.
 *
 * `webServer` starts both processes, so `npx playwright test` is the whole
 * command and CI does not need orchestration around it. `reuseExistingServer`
 * locally means a developer running `npm run dev:api` is not fighting the tests
 * for the port.
 */
const API_PORT = Number(process.env.API_PORT ?? 8787);
const DEMO_PORT = Number(process.env.DEMO_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/e2e',
  // The API keeps process-local rate-limit buckets, so tests that share an
  // address share a budget. Fully parallel workers would let one test's requests
  // spend another's allowance and produce a 429 that reads as a broken widget.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    // `localhost`, not `127.0.0.1`: the demo page's embed snippet points the
    // widget at `http://localhost:8787`, and a page reached at one hostname
    // making cross-origin calls to another is the production shape being tested.
    // Using 127.0.0.1 here would quietly turn those calls same-site.
    baseURL: `http://localhost:${DEMO_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // A data directory of its own, so an e2e run cannot write into the
      // developer's `.data` or into whatever the smoke test used.
      command: 'npx tsx apps/api/src/main.ts',
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      env: {
        PORT: String(API_PORT),
        SUNNY_DATA_DIR: '.data-e2e',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npx tsx apps/widget-demo/serve.ts --port ${DEMO_PORT}`,
      url: `http://127.0.0.1:${DEMO_PORT}/`,
      env: { PORT: String(DEMO_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
