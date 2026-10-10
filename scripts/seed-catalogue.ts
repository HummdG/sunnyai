/**
 * Load an installer's catalogue into a running Sunny API.
 *
 * This is the operator's door into the same route the product offers, not a
 * second implementation of it: the file goes to `POST /v1/catalog/products` as
 * text, and what comes back is the importer's report, printed whole. Nothing
 * here reads the CSV or decides what is wrong with it -- if this script and the
 * route ever disagreed about a row, the route would be right.
 *
 * Usage:
 *   SUNNY_ADMIN_TOKEN=... npm run seed:catalogue -- [file.csv] [--dry-run]
 *
 * Environment:
 *   SUNNY_ADMIN_TOKEN  required -- the same token the API was started with
 *   SUNNY_API_URL      default http://localhost:8787
 *   SUNNY_TENANT_ID    default t_demo0001
 *
 * `--dry-run` asks the route to read the file and report on it without storing
 * anything, which is the way to check a real price list before it lands.
 *
 * The default file, `fixtures/demo-catalogue.csv`, is demo data: fictional
 * brands, models and prices. It exists to exercise the widget locally and must
 * not be uploaded to a deployment a real visitor can reach.
 */

import { readFile } from 'node:fs/promises';

import { catalogueUploadResponseSchema } from '@sunny/contracts';

const file =
  process.argv.slice(2).find((argument) => !argument.startsWith('--')) ??
  'fixtures/demo-catalogue.csv';
const dryRun = process.argv.includes('--dry-run');

const token = process.env['SUNNY_ADMIN_TOKEN'];
if (!token) {
  console.error(
    'SUNNY_ADMIN_TOKEN is not set. The upload route refuses every request without it, ' +
      'and the API the file is going to has to have been started with the same value.',
  );
  process.exit(2);
}

const baseUrl = (process.env['SUNNY_API_URL'] ?? 'http://localhost:8787').replace(/\/$/, '');
const tenantId = process.env['SUNNY_TENANT_ID'] ?? 't_demo0001';

const csv = await readFile(file, 'utf8');

const response = await fetch(`${baseUrl}/v1/catalog/products`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ tenantId, csv, mode: 'replace', dryRun }),
  signal: AbortSignal.timeout(30_000),
});

/** The report, or whatever the API said instead. */
const body: unknown = await response.json();

if (!response.ok) {
  console.error(`HTTP ${response.status}: ${JSON.stringify(body, null, 2)}`);
  process.exit(1);
}

// Read against the published contract rather than cast: a route that answered
// with a shape this script did not expect is a mismatch worth failing on, and
// the failure is more useful here than three lines of `undefined` later.
const report = catalogueUploadResponseSchema.safeParse(body);
if (!report.success) {
  console.error(`The API answered with a body that is not a catalogue report:`);
  console.error(JSON.stringify(report.error.issues, null, 2));
  process.exit(1);
}

console.log(
  `${file} -> ${baseUrl} (tenant ${tenantId})${dryRun ? ' [dry run: nothing stored]' : ''}`,
);
console.log(
  `  accepted ${report.data.accepted}, rejected ${report.data.rejected}, ` +
    `catalogue now ${report.data.catalogueSize} rows`,
);

const errors = report.data.issues.filter((issue) => issue.severity === 'error');
const warnings = report.data.issues.filter((issue) => issue.severity === 'warning');

for (const issue of errors) {
  console.error(`  ERROR${issue.rowNumber ? ` line ${issue.rowNumber}` : ''}: ${issue.message}`);
}
for (const issue of warnings) {
  console.warn(`  warn${issue.rowNumber ? ` line ${issue.rowNumber}` : ''}: ${issue.message}`);
}

// A row the importer refused is the file's problem to fix, so this exits
// non-zero: a seed step in a script has to fail loudly rather than leave a
// silently short catalogue behind.
if (errors.length > 0) process.exit(1);
