/**
 * A fresh data directory for a browser test run, with the demo installer named
 * "Northwind Solar".
 *
 * Two reasons it exists:
 *
 *   - The directory is emptied first, so a run starts from the same state on a
 *     developer's machine as on CI. A directory left over from an older run kept
 *     an old demo name, and the suite passed locally while failing on CI.
 *   - The shipped demo installer is called "Sunny", which is also the widget's
 *     built-in name before its config arrives. A test cannot tell those apart,
 *     so the browser tests give the demo installer a name of its own.
 *
 * Usage (playwright.config.ts runs it before starting the API):
 *   npx tsx scripts/e2e-data.ts .data-e2e
 */
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { FileStore } from '../apps/api/src/store.js';
import { defaultTenants } from '../apps/api/src/tenants.js';

const E2E_DEMO_COMPANY = 'Northwind Solar';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: npx tsx scripts/e2e-data.ts <data directory>');
  process.exit(2);
}
// Only a directory of its own, never the developer's `.data`.
if (!/^\.data-e2e[\w-]*$/.test(dir)) {
  console.error(`Refusing to empty "${dir}": expected a .data-e2e directory.`);
  process.exit(2);
}

await rm(resolve(dir), { recursive: true, force: true });
const store = new FileStore(resolve(dir));
for (const tenant of defaultTenants(false)) {
  await store.putTenant(
    tenant.id === 't_demo0001'
      ? { ...tenant, config: { ...tenant.config, companyName: E2E_DEMO_COMPANY } }
      : tenant,
  );
}
