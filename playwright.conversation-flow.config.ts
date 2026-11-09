import { defineConfig, devices } from '@playwright/test';

/**
 * An installer's question changing a visitor's quote, end to end
 * (tests/e2e/conversation-flow.spec.ts).
 *
 *   npx playwright test -c playwright.conversation-flow.config.ts
 *
 * Its own servers on their own ports, for the same reason as the lead-roof
 * config: the API runs with the scripted demo assistant (no model is called)
 * and SunScan in replay mode, settings the main suite's chat tests must not see.
 * The widget bundle is served by the demo server; the spec mounts it on a host
 * page of its own, registered to the installer it creates.
 */

const API_PORT = Number(process.env.FLOW_API_PORT ?? 8897);
const SITE_PORT = Number(process.env.FLOW_SITE_PORT ?? 4197);
const WIDGET_PORT = Number(process.env.FLOW_WIDGET_PORT ?? 4199);

process.env.API_PORT = String(API_PORT);
process.env.MARKETING_PORT = String(SITE_PORT);
process.env.WIDGET_PORT = String(WIDGET_PORT);
process.env.CONVERSATION_FLOW_E2E = '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['conversation-flow.spec.ts'],
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
      reuseExistingServer: process.env.FLOW_REUSE === '1',
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        SUNNY_DATA_DIR: '.data-e2e-flow',
        LOG_LEVEL: 'warn',
        SUNNY_DEV_AUTH: '1',
        SUNNY_DEMO_ASSISTANT: '1',
        SUNSCAN_HTTP_MODE: 'replay',
        SUNNY_DASHBOARD_URL: `http://localhost:${SITE_PORT}`,
        SUNNY_RL_SESSION_LIMIT: '10000',
        SUNNY_RL_CHAT_LIMIT: '10000',
        SUNNY_RL_CHAT_IP_LIMIT: '10000',
        SUNNY_RL_LEADS_LIMIT: '10000',
      },
    },
    {
      command: `npm run build:widget && npx tsx apps/widget-demo/serve.ts --port ${WIDGET_PORT}`,
      url: `http://127.0.0.1:${WIDGET_PORT}/`,
      env: { PORT: String(WIDGET_PORT), SUNNY_DEMO_API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: process.env.FLOW_REUSE === '1',
      timeout: 120_000,
    },
    {
      command: `npx next dev --webpack -p ${SITE_PORT} apps/marketing`,
      url: `http://localhost:${SITE_PORT}/sign-in`,
      reuseExistingServer: process.env.FLOW_REUSE === '1',
      timeout: 240_000,
      env: {
        SUNNY_NEXT_DIST: '.next-e2e-flow',
        NEXT_PUBLIC_SUNNY_API_URL: `http://localhost:${API_PORT}`,
        SUNNY_API_URL: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
