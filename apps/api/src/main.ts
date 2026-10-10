import {
  assertProductionReady,
  capabilityReport,
  loadConfig,
  productionWarnings,
} from './config.js';
import { buildServer } from './server.js';
import { FileStore } from './store.js';
import { TenantRegistry } from './tenants.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const problems = assertProductionReady(config);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[config] ${problem}`);
    process.exit(1);
  }

  const store = new FileStore(config.dataDir);
  const tenants = new TenantRegistry();
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
