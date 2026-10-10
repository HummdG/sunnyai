import { importProducts, parseCsv } from '@sunny/solar-rules';

import type { FileStore } from '../src/store.js';
import type { FastifyInstance } from 'fastify';

/**
 * One catalogue, shared by the tests that need rows to exist.
 *
 * Written as a column-name map rather than as comma-joined strings so a row
 * cannot silently drift out of line with the header, which is the failure a
 * hand-typed CSV fixture in a test suite always eventually has. The rows are
 * consistent on purpose: the 4 kW inverter accepts nine of the 430 W panels
 * (3.87 kW against a 4.6 kW limit, 343.8 V against 600 V), the battery is
 * listed against the inverter by the inverter's model, and every row that
 * carries a price carries provenance too -- so a recommendation over this
 * catalogue has something to price and nothing to doubt.
 */

export const HEADER = [
  'Category',
  'Manufacturer',
  'Model',
  'Power (W)',
  'Capacity (kWh)',
  'Price',
  'Currency',
  'Warranty (years)',
  'Source',
  'Max DC Power (W)',
  'Max String Voltage (V)',
  'Battery Families',
  'Compatible Inverters',
  'VOC',
];

export function csv(...rows: Array<Record<string, string>>): string {
  const lines = [HEADER.join(',')];
  for (const row of rows) lines.push(HEADER.map((column) => row[column] ?? '').join(','));
  return `${lines.join('\n')}\n`;
}

export const PANEL_430 = {
  Category: 'Panel',
  Manufacturer: 'Sunbeam',
  Model: 'SB-430',
  'Power (W)': '430',
  Price: '£180',
  'Warranty (years)': '12',
  Source: 'https://example.test/sb-430.pdf',
  VOC: '38.2',
};

export const PANEL_500 = {
  Category: 'Panel',
  Manufacturer: 'Sunbeam',
  Model: 'SB-500',
  'Power (W)': '500',
  Price: '£200',
  'Warranty (years)': '12',
  Source: 'https://example.test/sb-500.pdf',
  VOC: '41.5',
};

export const INVERTER_4K = {
  Category: 'Inverter',
  Manufacturer: 'Voltix',
  Model: 'VX-4K',
  Price: '1200',
  Currency: 'GBP',
  'Warranty (years)': '10',
  Source: 'https://example.test/vx-4k.pdf',
  'Max DC Power (W)': '4600',
  'Max String Voltage (V)': '600',
  'Battery Families': 'Alpha',
};

export const BATTERY = {
  Category: 'Battery',
  Manufacturer: 'Alpha',
  Model: 'Home 5',
  'Capacity (kWh)': '5',
  Price: '3200',
  Currency: 'GBP',
  'Warranty (years)': '10',
  Source: 'https://example.test/home5.pdf',
  'Compatible Inverters': 'Voltix VX-4K',
};

export const CATALOGUE = csv(PANEL_430, PANEL_500, INVERTER_4K, BATTERY);

export const DEMO_TENANT_ID = 't_demo0001';
export const TEST_ADMIN_TOKEN = 'admin-token-for-tests';

/**
 * Put a catalogue in a store without going through HTTP.
 *
 * It uses the same reader and the same id factory the upload route uses, so
 * these are the rows an installer's file actually produces rather than a
 * hand-built shape that happens to match the type. A test that needs a
 * deliberately thinner catalogue passes its own `csv`.
 */
export async function seedProducts(
  store: FileStore,
  options: { csv?: string; tenantId?: string } = {},
): Promise<void> {
  const tenantId = options.tenantId ?? DEMO_TENANT_ID;
  let counter = 0;
  const parsed = parseCsv(options.csv ?? CATALOGUE);
  const imported = importProducts(parsed.rows, {
    tenantId,
    now: '2026-01-01T00:00:00.000Z',
    nextId: () => `prd_seed${String(++counter).padStart(4, '0')}`,
  });
  if (parsed.issues.some((issue) => issue.severity === 'error')) {
    throw new Error(`the fixture file does not parse: ${JSON.stringify(parsed.issues)}`);
  }
  if (imported.issues.some((issue) => issue.severity === 'error')) {
    throw new Error(`the fixture file does not import: ${JSON.stringify(imported.issues)}`);
  }
  await store.saveProducts(tenantId, imported.products, 'replace');
}

export interface UploadResult<T> {
  status: number;
  body: T;
}

/**
 * The upload route, with the admin token this suite configures by default.
 *
 * Generic in the body so a caller can name the contract it expects without a
 * cast: the tests that assert on a report ask for `CatalogueUploadResponse`, and
 * the ones that assert on a refusal ask for the error envelope.
 */
export async function uploadCatalogue<T = Record<string, unknown>>(
  app: FastifyInstance,
  payload: Record<string, unknown>,
  token: string | null = TEST_ADMIN_TOKEN,
): Promise<UploadResult<T>> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/catalog/products',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    payload: { tenantId: DEMO_TENANT_ID, ...payload },
  });
  return { status: response.statusCode, body: response.json<T>() };
}
