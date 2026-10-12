import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import {
  HSENERGY_PRICE_LIST_CSV,
  HSENERGY_PRODUCTS_CSV,
} from '../src/catalogue/examples/hsenergy.js';
import { PRICE_LIST_TEMPLATE, importPriceList, priceFor } from '../src/catalogue/price-list.js';
import { getPublishedPriceList, priceListToCsv } from '../src/catalogue/price-list-service.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';
const ROOT = join(__dirname, '..', '..', '..');

function makeConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-price-list',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: false,
      trustProxyHops: 0,
      rules: {
        session: { limit: 1000, windowMs: 60_000 },
        chat: { limit: 1000, windowMs: 60_000 },
        leads: { limit: 1000, windowMs: 60_000 },
        qualification: { limit: 1000, windowMs: 60_000 },
        catalogue: { limit: 1000, windowMs: 60_000 },
        knowledge: { limit: 1000, windowMs: 60_000 },
      },
      maxKeys: 1000,
    },
  } as unknown as ServerConfig;
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(adminToken: string | null = null) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-price-list-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: { ...makeConfig(), adminToken },
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
  });
  await app.ready();
  return { app, store };
}

const as = (email: string) => ({ authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}` });

async function signUp(app: FastifyInstance, email: string, companyName = 'Brightside Solar') {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/portal/tenants',
    headers: as(email),
    payload: { companyName },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ tenant: { id: string } }>().tenant.id;
}

const SKUS = [
  'DMEGC-DM430',
  'DMEGC-DM455',
  'REA-HD96-460',
  'REA-HD108-450-ENPHASE',
  'FOX-H1-3.7',
  'SE-SE5000H',
  'FOX-H3-8.0',
  'MOUNT-PITCHED-TILE',
  'MOUNT-GROUND-15',
  'MOUNT-FLAT-VDV',
  'FOX-EC2900',
  'FOX-EQ4800',
  'FOX-EVO-1024',
  'TESLA-PW3',
  'SCAFFOLD-EXTRA-SIDE',
  'SCAFFOLD-EXTRA-STOREY',
  'SCAFFOLD-SMALL-OBSTACLE',
  'SCAFFOLD-LARGE-OBSTACLE',
  'SCAFFOLD-RESTRICTED-ACCESS',
  'ELEC-INVERTER-HYBRID',
  'ELEC-INVERTER-PV-STRING',
  'ELEC-SUB-BOARD',
  'ELEC-INTERNAL-CABLE-RUN',
  'ELEC-ADMIN-FEE',
  'STRUCT-FLATROOF-SURVEY',
  'EV-PROJECTEV-7KW-UNTETHERED',
  'EV-PROJECTEV-7KW-TETHERED',
  'EV-PROJECTEV-22KW-UNTETHERED',
  'EV-PROJECTEV-22KW-TETHERED',
  'OPT-TIGO-PART',
  'OPT-TIGO-FULL',
  'OPT-BIRDMESH',
  'EPS-FOX',
  'EPS-GENERIC',
  'OPT-ENPHASE-IQ8HC',
];

describe('price list files', () => {
  it('keeps the template and HSEnergy fixtures identical to the code that serves them', async () => {
    expect(await readFile(join(ROOT, 'docs', 'templates', 'price-list-template.csv'), 'utf8')).toBe(
      PRICE_LIST_TEMPLATE,
    );
    expect(
      await readFile(join(ROOT, 'fixtures', 'catalogue', 'hsenergy-catalogue.csv'), 'utf8'),
    ).toBe(HSENERGY_PRODUCTS_CSV);
    expect(
      await readFile(join(ROOT, 'fixtures', 'catalogue', 'hsenergy-price-list.csv'), 'utf8'),
    ).toBe(HSENERGY_PRICE_LIST_CSV);
    expect(
      importPriceList(PRICE_LIST_TEMPLATE).issues.filter((i) => i.severity === 'error'),
    ).toEqual([]);
  });
});

describe('the HSEnergy price list', () => {
  const { list, issues } = importPriceList(HSENERGY_PRICE_LIST_CSV);
  const item = (key: string) => list!.items.find((i) => i.key === key)!;

  it('reads with no errors and every SunScan v1 SKU kept verbatim', () => {
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    const keys = list!.items.map((i) => i.key);
    for (const sku of SKUS) expect(keys, sku).toContain(sku);
    const trench = item('TRENCH-HARD').pricing;
    expect(trench.kind === 'tiered' && trench.tiers.map((t) => t.sku)).toEqual([
      'TRENCH-HARD-0-24',
      'TRENCH-HARD-25-99',
      'TRENCH-HARD-100-149',
      'TRENCH-HARD-150PLUS',
    ]);
  });

  it('assumes nothing the sheet does not say', () => {
    // No VAT rate on the sheet, so none is set and the import says so.
    expect(list!.vatRatePercent).toBeNull();
    expect(issues.some((i) => i.key === 'vat' && i.severity === 'warning')).toBe(true);
    // Inverters are not on the sheet: indicative, not verified.
    expect(item('FOX-H1-3.7').priceStatus).toBe('indicative');
    expect(item('ELEC-ADMIN-FEE')).toMatchObject({ mandatory: true, priceStatus: 'verified' });
    expect(item('FOX-EC2900').expansion).toMatchObject({
      sku: 'FOX-ECS2900',
      perUnitMinor: 89_500,
      capacityWh: 2900,
      maxUnits: 7,
    });
    expect(item('FOX-EVO-1024').additionalUnitDiscountMinor).toBe(20_000);
    expect(item('OPT-TIGO-PART').exclusiveGroup).toBe('tigo');
    expect(list!.budgetBands.map((b) => b.id)).toEqual([
      'under_6k',
      '6k_8k',
      '8k_10k',
      '10k_12k',
      '12k_15k',
      '15k_plus',
      'unsure',
    ]);
  });

  it('prices items exactly as the sheet does, and refuses to extrapolate', () => {
    expect(priceFor(item('PV-BASE'), { quantity: 12 })).toEqual({
      status: 'priced',
      amountMinor: 647_100,
    });
    expect(priceFor(item('PV-BASE'), { quantity: 51 }).status).toBe('unpriced');
    expect(priceFor(item('OPT-BIRDMESH'), { quantity: 20 })).toEqual({
      status: 'priced',
      amountMinor: 60_000,
    });
    expect(priceFor(item('OPT-BIRDMESH'), { quantity: 24 })).toEqual({
      status: 'priced',
      amountMinor: 72_000,
    });
    expect(priceFor(item('TRENCH-SOFT'), { quantity: 30 })).toEqual({
      status: 'priced',
      amountMinor: 70_000,
    });
    expect(priceFor(item('TRENCH-SOFT'), { quantity: 200 }).status).toBe('bespoke');
    expect(priceFor(item('FOX-EQ4800'), { context: 'retrofit' })).toEqual({
      status: 'priced',
      amountMinor: 469_500,
    });
    expect(priceFor(item('DMEGC-DM455'), { pvBaseMinor: 647_100 })).toEqual({
      status: 'priced',
      amountMinor: 48_533,
    });
    expect(priceFor(item('OPT-ENPHASE-IQ8HC'), { quantity: 10 })).toEqual({
      status: 'priced',
      amountMinor: 175_000,
    });
  });

  it('exports to a CSV that re-imports to the same list', () => {
    const again = importPriceList(priceListToCsv(list!));
    expect(again.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const strip = (l: typeof list) => l!.items.map(({ rows: _rows, ...rest }) => rest);
    expect(strip(again.list)).toEqual(strip(list));
    expect(again.list!.budgetBands).toEqual(list!.budgetBands);
  });
});

describe('price list validation', () => {
  it('reports bad rows by line', () => {
    const csv = [
      'Category,Key,Name,Pricing,Amount,Unit,From,To',
      'pv,PV-BASE,PV,table,£3985,,1,',
      'pv,PV-BASE,PV,table,lots,,2,',
      'scaffold,SCAF,Scaffold,per_unit,£10,,,',
      'optional,MESH,Mesh,tier,£600,panel,1,20',
      'optional,MESH,Mesh,tier,£600,panel,10,',
    ].join('\n');
    const { issues } = importPriceList(csv);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.find((e) => e.rowNumber === 3)?.message).toContain('not an amount');
    expect(errors.some((e) => e.key === 'SCAF' && e.message.includes('Unit'))).toBe(true);
    expect(errors.some((e) => e.key === 'MESH' && e.message.includes('overlap'))).toBe(true);
  });
});

describe('price list routes', () => {
  it('previews, publishes, rolls back, and is isolated per installer', async () => {
    const { app, store } = await setup();
    const a = await signUp(app, 'owner@brightside.test');
    await signUp(app, 'owner@rival.test', 'Rival Solar');

    const upload = async (csv: string) => {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/portal/tenants/${a}/catalogue/price-list/upload`,
        headers: as('owner@brightside.test'),
        payload: { csv, fileName: 'prices.csv' },
      });
      return response.json<{ pending: { id: string; itemCount: number } }>().pending;
    };
    const publish = async (id: string) =>
      (
        await app.inject({
          method: 'POST',
          url: `/v1/portal/tenants/${a}/catalogue/price-list/upload/${id}/publish`,
          headers: as('owner@brightside.test'),
        })
      ).json<{ version: number }>();

    const first = await upload(HSENERGY_PRICE_LIST_CSV);
    expect(first.itemCount).toBe(38);
    expect(await getPublishedPriceList(store, a)).toBeNull();
    expect((await publish(first.id)).version).toBe(1);
    expect((await getPublishedPriceList(store, a))?.items).toHaveLength(38);

    expect((await publish((await upload(PRICE_LIST_TEMPLATE)).id)).version).toBe(2);
    expect((await getPublishedPriceList(store, a))?.items).toHaveLength(10);

    const rolled = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${a}/catalogue/price-list/versions/1/rollback`,
      headers: as('owner@brightside.test'),
    });
    expect(rolled.json<{ version: number }>().version).toBe(3);
    expect((await getPublishedPriceList(store, a))?.items).toHaveLength(38);

    const view = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${a}/catalogue/price-list`,
      headers: as('owner@brightside.test'),
    });
    const items = view.json<{ published: { items: Array<{ key: string; description: string }> } }>()
      .published.items;
    expect(items.find((i) => i.key === 'OPT-BIRDMESH')?.description).toContain('£600');

    for (const url of [
      `/v1/portal/tenants/${a}/catalogue/price-list`,
      `/v1/portal/tenants/${a}/catalogue/price-list/export.csv`,
    ]) {
      const other = await app.inject({ method: 'GET', url, headers: as('owner@rival.test') });
      expect(other.statusCode, url).toBe(404);
    }
    const otherWrite = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${a}/catalogue/price-list/upload`,
      headers: as('owner@rival.test'),
      payload: { csv: PRICE_LIST_TEMPLATE },
    });
    expect(otherWrite.statusCode).toBe(404);
  });

  it('offers the HSEnergy example as previews only, labelled as an example', async () => {
    const { app, store } = await setup();
    const tenantId = await signUp(app, 'owner@brightside.test');
    const response = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/catalogue/example`,
      headers: as('owner@brightside.test'),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      upload: { accepted: number; example: boolean };
      priceList: { itemCount: number; example: boolean };
    }>();
    expect(body.upload).toMatchObject({ accepted: 19, example: true });
    expect(body.priceList).toMatchObject({ itemCount: 38, example: true });
    // Nothing is live until the installer publishes it.
    expect(await store.listProducts(tenantId)).toHaveLength(0);
    expect(await getPublishedPriceList(store, tenantId)).toBeNull();
    expect((await store.getCatalogueState(tenantId))?.pendingUpload?.example).toBe(true);
  });
});

describe('seeding the demo tenant', () => {
  it('publishes the example with the admin token and refuses without it', async () => {
    const { app, store } = await setup('admin-seed-token');
    const refused = await app.inject({
      method: 'POST',
      url: '/v1/catalogue/example/publish',
      payload: { tenantId: 't_demo0001' },
    });
    expect(refused.statusCode).toBe(401);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/catalogue/example/publish',
      headers: { authorization: 'Bearer admin-seed-token' },
      payload: { tenantId: 't_demo0001' },
    });
    expect(response.json()).toEqual({
      productVersion: 1,
      priceListVersion: 1,
      products: 19,
      priceItems: 38,
    });
    expect(await store.listProducts('t_demo0001')).toHaveLength(19);
    expect((await getPublishedPriceList(store, 't_demo0001'))?.items).toHaveLength(38);
  });
});
