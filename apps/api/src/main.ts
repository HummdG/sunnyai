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

async function main(): Promise<void> {
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
  const tenants = new TenantRegistry(defaultTenants(config.sandboxTenant));
  const app = buildServer({ config, store, tenants });

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
