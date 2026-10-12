import { defineConfig, devices } from '@playwright/test';

/**
 * The lead page's 3D roof, end to end (tests/e2e/lead-roof.spec.ts).
 *
 *   npx playwright test -c playwright.lead-roof.config.ts
 *
 * Its own servers on their own ports, because the API runs with the scripted
 * demo assistant and SunScan in replay mode -- settings that would change what
 * the main suite's widget and chat tests see. Its own data directory and Next
 * build directory, so it never touches a developer's running servers.
 */

const API_PORT = Number(process.env.LEAD_ROOF_API_PORT ?? 8898);
const SITE_PORT = Number(process.env.LEAD_ROOF_SITE_PORT ?? 4198);

process.env.API_PORT = String(API_PORT);
process.env.MARKETING_PORT = String(SITE_PORT);
process.env.LEAD_ROOF_E2E = '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['lead-roof.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx apps/api/src/main.ts',
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        SUNNY_DATA_DIR: '.data-e2e-roof',
        LOG_LEVEL: 'warn',
        SUNNY_DEV_AUTH: '1',
        SUNNY_DEMO_ASSISTANT: '1',
        SUNSCAN_HTTP_MODE: 'replay',
        SUNNY_DASHBOARD_URL: `http://localhost:${SITE_PORT}`,
        WIDGET_ALLOWED_ORIGINS: `http://localhost:${SITE_PORT}`,
        SUNNY_RL_SESSION_LIMIT: '10000',
        SUNNY_RL_CHAT_LIMIT: '10000',
        SUNNY_RL_CHAT_IP_LIMIT: '10000',
        SUNNY_RL_LEADS_LIMIT: '10000',
      },
    },
    {
      command: `npx next dev --webpack -p ${SITE_PORT} apps/marketing`,
      url: `http://localhost:${SITE_PORT}/sign-in`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        SUNNY_NEXT_DIST: '.next-e2e-roof',
        NEXT_PUBLIC_SUNNY_API_URL: `http://localhost:${API_PORT}`,
        SUNNY_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
