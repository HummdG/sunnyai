/**
 * Publish the HSEnergy example catalogue and price list for a tenant (the demo
 * tenant by default), through the running API.
 *
 *   SUNNY_ADMIN_TOKEN=... npx tsx scripts/seed-hsenergy-catalogue.ts [tenantId]
 *
 * The data is HSEnergy Group Ltd's "Residential Sales Pricelists 2026 Master"
 * as structured in SunScan v1's prisma/seed.ts, with SunScan v1's SKUs kept
 * verbatim (apps/api/src/catalogue/examples/hsenergy.ts). It is published as
 * two new versions -- products and price list -- so it can be rolled back from
 * the portal like any other change. A new installer is offered the same data
 * as an editable preview from the dashboard ("Start from the HSEnergy example
 * list") instead.
 */

const token = process.env['SUNNY_ADMIN_TOKEN'];
if (!token) {
  console.error(
    'SUNNY_ADMIN_TOKEN is not set. The seed route refuses every request without it, ' +
      'and the API has to have been started with the same value.',
  );
  process.exit(2);
}

const baseUrl = (process.env['SUNNY_API_URL'] ?? 'http://localhost:8787').replace(/\/$/, '');
const tenantId =
  process.argv.slice(2).find((argument) => !argument.startsWith('--')) ??
  process.env['SUNNY_TENANT_ID'] ??
  't_demo0001';

const response = await fetch(`${baseUrl}/v1/catalogue/example/publish`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ tenantId }),
});
const body = (await response.json().catch(() => null)) as
  | { products: number; priceItems: number; productVersion: number; priceListVersion: number }
  | { error?: { message?: string } }
  | null;
if (!response.ok || !body || !('products' in body)) {
  const message = body && 'error' in body ? body.error?.message : undefined;
  console.error(`Seeding failed (${response.status}): ${message ?? 'no response body'}`);
  process.exit(1);
}
console.log(
  `Published the HSEnergy example for ${tenantId}: ${body.products} products ` +
    `(catalogue v${body.productVersion}) and ${body.priceItems} price-list items ` +
    `(price list v${body.priceListVersion}).`,
);

export {};
