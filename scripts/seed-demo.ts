/**
 * Seed the demo tenant with the demo data the widget is meant to be looked at
 * with: a fictional price list and one fictional document to answer from.
 *
 * This is §12's "seeded demo tenant", and the point of it being a script rather
 * than a JSON file checked into the repository is that the demo tenant is *a
 * tenant like any other* -- it is filled through the same two admin routes a
 * real installer's data goes through. Nothing here writes to the store directly,
 * so a demo that looks right is also evidence that onboarding a real installer
 * through those routes works.
 *
 * Both files are demo data: fictional installer, fictional brands, invented
 * warranty terms and prices. `fixtures/demo-catalogue.csv` and
 * `fixtures/demo-knowledge.md` each say so at the top, and the seed refuses to
 * touch anything but a loopback deployment unless `--force` says otherwise.
 *
 * Usage:
 *   SUNNY_ADMIN_TOKEN=... npm run seed:demo
 *   SUNNY_ADMIN_TOKEN=... npm run seed:demo -- --force     # a deployment that is not local
 *   SUNNY_ADMIN_TOKEN=... SUNNY_SOURCE_ID=ks_... npm run seed:demo
 *
 * Environment:
 *   SUNNY_ADMIN_TOKEN   required -- the same token the API was started with
 *   SUNNY_API_URL       default http://localhost:8787
 *   SUNNY_TENANT_ID     default t_demo0001
 *   SUNNY_SOURCE_ID     the document to replace, from an earlier run
 *
 * The catalogue is `replace`, so re-running leaves one price list. The document
 * is not: a source can only be replaced by *naming* it, and no route lists the
 * sources, so a second run without `SUNNY_SOURCE_ID` ingests a second copy of
 * the same document. This script prints the id it created and says so, rather
 * than pretending to be idempotent when it is not.
 *
 * Exit codes: 0 seeded, 1 the deployment refused part of it or answered with
 * something that is not a report, 2 it was not run at all (no token, or a
 * non-local target without `--force`).
 */

import { readFile } from 'node:fs/promises';

import { catalogueUploadResponseSchema, knowledgeSourceResponseSchema } from '@sunny/contracts';

/**
 * Returns the exit code rather than calling `process.exit`.
 *
 * `process.exit` with a keep-alive socket still open trips a libuv assertion on
 * Windows and the process leaves with 127 instead of the code it asked for --
 * which would turn "refused to run" into an unreadable crash. Setting the code
 * and letting Node wind down is the version that reports what happened.
 */
async function main(): Promise<number> {
  const force = process.argv.includes('--force');

  const token = process.env['SUNNY_ADMIN_TOKEN'];
  if (!token) {
    console.error(
      'SUNNY_ADMIN_TOKEN is not set. Both of the routes this seeds are behind it, and the ' +
        'API the data is going to has to have been started with the same value.',
    );
    return 2;
  }

  const baseUrl = (process.env['SUNNY_API_URL'] ?? 'http://localhost:8787').replace(/\/$/, '');
  const tenantId = process.env['SUNNY_TENANT_ID'] ?? 't_demo0001';
  const sourceId = process.env['SUNNY_SOURCE_ID'];

  // The guard. A catalogue upload with `mode: replace` overwrites an installer's
  // whole price list, and the demo data is fictional -- so pointing this at a
  // deployment a real visitor can reach is a destructive change to real data made
  // on the strength of a command that does not say so. `--force` is the operator
  // saying it.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(baseUrl);
  if (!local && !force) {
    console.error(
      `${baseUrl} is not a local deployment.\n\n` +
        'This would replace that installer’s whole catalogue with fictional demo products ' +
        'and\nadd a fictional document the assistant would then quote at real visitors. If that ' +
        'is\nwhat you want, say so: npm run seed:demo -- --force',
    );
    return 2;
  }
  if (!local) {
    console.warn(`! Writing DEMO data to ${baseUrl}. This is not a local deployment.`);
  }

  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

  async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  }

  console.log(`Seeding ${baseUrl} (tenant ${tenantId})\n`);

  // ── the price list ─────────────────────────────────────────────────────────

  const csvPath = 'fixtures/demo-catalogue.csv';
  const csv = await readFile(csvPath, 'utf8');
  const uploaded = await post('/v1/catalog/products', {
    tenantId,
    csv,
    mode: 'replace',
    dryRun: false,
  });

  const catalogueReport = catalogueUploadResponseSchema.safeParse(uploaded.json);
  if (!catalogueReport.success) {
    console.error(
      `The catalogue upload answered ${uploaded.status} with a body that is not a report:\n` +
        JSON.stringify(catalogueReport.error.issues, null, 2),
    );
    return 1;
  }

  const errors = catalogueReport.data.issues.filter((issue) => issue.severity === 'error');
  console.log(
    `  catalogue  ${csvPath} -> accepted ${catalogueReport.data.accepted}, ` +
      `rejected ${catalogueReport.data.rejected}, ${catalogueReport.data.catalogueSize} rows held`,
  );
  for (const issue of errors) {
    console.error(`    ERROR line ${issue.rowNumber ?? '?'}: ${issue.message}`);
  }
  if (errors.length > 0) {
    // The same rule `seed:catalogue` follows, for the same reason: a step that
    // half-loaded a price list and exited 0 leaves a demo that is quietly wrong.
    console.error('The demo catalogue did not import cleanly, so the seed stopped.');
    return 1;
  }

  // ── the document the assistant answers from ────────────────────────────────

  const docPath = 'fixtures/demo-knowledge.md';
  const text = await readFile(docPath, 'utf8');
  const ingested = await post('/v1/knowledge/sources', {
    tenantId,
    ...(sourceId ? { sourceId } : {}),
    title: 'Northwind Solar — service, warranty and surveys (demo)',
    url: null,
    version: 'demo-1',
    text,
  });

  const knowledgeReport = knowledgeSourceResponseSchema.safeParse(ingested.json);
  if (!knowledgeReport.success) {
    console.error(
      `The knowledge upload answered ${ingested.status} with a body that is not a report:\n` +
        JSON.stringify(knowledgeReport.error.issues, null, 2),
    );
    return 1;
  }

  const { source, job } = knowledgeReport.data;
  if (source === null) {
    // The route stores nothing when a document produces no passages, so a null
    // source is the failure it says it is: the assistant would be listing a
    // document it cannot quote from.
    console.error(`  document   ${docPath} -> the job ${job.status}, and nothing was stored:`);
    for (const issue of job.issues) console.error(`    ${issue.severity}: ${issue.message}`);
    return 1;
  }

  console.log(
    `  document   ${docPath} -> ${source.chunkCount} passages, ${source.characters} characters`,
  );
  for (const issue of job.issues) {
    console.warn(`    ${issue.severity}: ${issue.message}`);
  }

  // ── what to run next time ──────────────────────────────────────────────────

  if (sourceId) {
    console.log(`\nReplaced ${sourceId}.`);
  } else {
    console.log(
      `\nThe document is ${source.id}. Keep that id: re-running without it adds a second ` +
        `copy, so\nreplace it with SUNNY_SOURCE_ID=${source.id} npm run seed:demo`,
    );
  }

  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`fatal: the seed could not run: ${String(error)}`);
  return 1;
});
