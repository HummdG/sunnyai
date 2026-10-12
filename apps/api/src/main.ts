import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  assertProductionReady,
  assertStoreConfigured,
  capabilityReport,
  loadConfig,
  productionWarnings,
} from './config.js';
import { FirestoreStore } from './firestore-store.js';
import { buildServer } from './server.js';
import { FileStore } from './store.js';
import { defaultTenants, TenantRegistry } from './tenants.js';
import type { Store } from './store.js';

/**
 * Local development reads a `.env` file from the repo root, so enabling chat is
 * "copy `.env.example`, paste a key" rather than exporting variables by hand.
 * Values already in the environment win, and a deployment (Cloud Run) sets its
 * environment directly and has no file, so this changes nothing there.
 */
function loadLocalEnv(): void {
  const file = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [key, value] of Object.entries(before)) process.env[key] = value;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const config = loadConfig();

  const problems = [...assertStoreConfigured(config), ...assertProductionReady(config)];
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[config] ${problem}`);
    process.exit(1);
  }

  // The store is chosen once, here, and handed to the server whole. This is the
  // only expression in the process that knows which implementation is in use,
  // which is what makes `store.ts`'s claim -- that the swap to Firestore is a new
  // implementation rather than a rewrite of the routes -- checkable by reading
  // one line rather than by grepping for the other one.
  const store: Store = config.firestore
    ? new FirestoreStore(config.firestore)
    : new FileStore(config.dataDir);
  // Store-backed: seeded tenants plus every installer created in the portal.
  // Refreshed on an interval so another instance's sign-ups become visible.
  const tenants = await TenantRegistry.load(store, defaultTenants(config.sandboxTenant));
  setInterval(() => {
    tenants.refresh().catch((error: unknown) => console.error('[tenants] refresh failed', error));
  }, 30_000).unref();
  // Demo mode: a scripted assistant that drives the real quote journey without
  // a model, for walk-throughs when no Gemini key is set. Never in production.
  const demo = ['1', 'true'].includes(process.env['SUNNY_DEMO_ASSISTANT'] ?? '');
  if (demo && config.nodeEnv === 'production') {
    console.error('[config] SUNNY_DEMO_ASSISTANT must not be set in production');
    process.exit(1);
  }
  const provider =
    demo && !config.gemini
      ? new (await import('./agent/demo-provider.js')).DemoProvider()
      : undefined;
  if (provider)
    console.warn(
      '[demo] SUNNY_DEMO_ASSISTANT=1: chat is answered by a SCRIPTED demo assistant, not a model.',
    );
  const app = buildServer({ config, store, tenants, ...(provider ? { provider } : {}) });

  const capabilities = capabilityReport(config);
  await app.listen({ port: config.port, host: config.host });

  const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  app.log.info({ url, capabilities }, 'sunny api listening');

  // Printed rather than logged so the capability report is visible even when the
  // log level is raised. An operator should never have to guess whether the
  // assistant is live or merely present.
  if (!capabilities.chat.available) {
    console.warn(
      `\n  chat: DISABLED — ${capabilities.chat.reason}\n` +
        `  The API is running; only the assistant is unavailable.\n`,
    );
  }
  if (!capabilities.escalation.available) {
    console.warn(`  escalation: unavailable — ${capabilities.escalation.reason}\n`);
  }
  for (const warning of productionWarnings(config)) {
    console.warn(`  warning: ${warning}\n`);
  }
}

main().catch((error: unknown) => {
  console.error('fatal: failed to start', error);
  process.exit(1);
});
