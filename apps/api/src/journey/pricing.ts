/**
 * Where each tenant's pricing comes from, for the quote journey.
 *
 * Today: the demo tenant prices from the HSEnergy fixture (SunScan v1's seed,
 * `fixtures/pricing/hsenergy-demo-pricelist.json`, labelled demo data); every
 * other tenant has none, and gets sizes and savings without prices. The
 * installer catalogue (WS7, same SKUs) plugs in behind `PricingSource` later.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { pricingFromFile, type PricingSource, type TenantPricing } from '@sunny/quote-engine';

export const DEMO_PRICELIST_PATH = fileURLToPath(
  new URL('../../../../fixtures/pricing/hsenergy-demo-pricelist.json', import.meta.url),
);

let demo: TenantPricing | null = null;

export function demoPricing(): TenantPricing {
  demo ??= pricingFromFile(
    JSON.parse(readFileSync(DEMO_PRICELIST_PATH, 'utf8')) as unknown,
    'HSEnergy 2026 price list (demo)',
  );
  return demo;
}

/** The demo tenant(s) price from the fixture; everyone else has no price list yet. */
export function fixturePricingSource(demoTenantIds: readonly string[]): PricingSource {
  return {
    forTenant: (tenantId) =>
      Promise.resolve(demoTenantIds.includes(tenantId) ? demoPricing() : null),
  };
}
