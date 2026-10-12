import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

/**
 * The Firebase sign-in flows, against the Firebase Auth EMULATOR.
 *
 *   npm run test:e2e:auth-firebase
 *
 * A separate config because these need three things the main suite does not:
 * the Auth emulator (Java from `.cache/jre`, fetched by scripts/ensure-jre.mjs),
 * an API that accepts the emulator's unsigned tokens (only possible outside
 * production -- see portal-config.ts), and a site built with Firebase settings
 * inlined. Ports are their own so a developer's servers on 4176/8787 are left
 * alone, and the site builds into `.next-auth-e2e` rather than `.next`.
 */

const API_PORT = Number(process.env.AUTH_E2E_API_PORT ?? 8898);
const SITE_PORT = Number(process.env.AUTH_E2E_SITE_PORT ?? 4198);
const EMULATOR = '127.0.0.1:9099';
const PROJECT = 'demo-sunny';
/** The servers' commands are written from the repo root. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: 'auth-firebase.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${SITE_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/ensure-jre.mjs && node scripts/auth-emulator.mjs',
      cwd: ROOT,
      url: `http://${EMULATOR}/`,
      reuseExistingServer: true,
      timeout: 300_000,
    },
    {
      command: 'npx tsx apps/api/src/main.ts',
      cwd: ROOT,
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'development',
        LOG_LEVEL: 'warn',
        SUNNY_DATA_DIR: '.data-auth-e2e',
        FIREBASE_PROJECT_ID: PROJECT,
        FIREBASE_AUTH_EMULATOR_HOST: EMULATOR,
        SUNNY_DASHBOARD_URL: `http://localhost:${SITE_PORT}`,
        WIDGET_ALLOWED_ORIGINS: `http://localhost:${SITE_PORT}`,
        SUNNY_RL_SESSION_LIMIT: '10000',
        SUNNY_RL_CHAT_LIMIT: '10000',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      cwd: ROOT,
      command:
        `npm run build:widget && npm run build -w @sunny/marketing && ` +
        `npx next start apps/marketing -p ${SITE_PORT}`,
      url: `http://127.0.0.1:${SITE_PORT}/`,
      env: {
        SUNNY_NEXT_DIST: '.next-auth-e2e',
        NEXT_PUBLIC_SUNNY_API_URL: `http://localhost:${API_PORT}`,
        SUNNY_API_URL: `http://localhost:${API_PORT}`,
        // Any key works against the emulator; it never reaches Google.
        NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-api-key',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'localhost',
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
        NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: EMULATOR,
      },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
