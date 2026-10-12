import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EMPTY_KNOWLEDGE, htmlToMarkdown } from '@sunny/knowledge';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { executeTool } from '../src/agent/tools.js';
import { issueDevToken } from '../src/auth/dev.js';
import {
  extractFromPage,
  extractWithGemini,
  geminiExtractor,
  looksLikeProductPage,
  markdownTables,
} from '../src/catalogue/extract.js';
import { CSV_TEMPLATE, exportCsv, productKey } from '../src/catalogue/service.js';
import { scanWebsite, setSheetSource, sheetFileId, syncSheet } from '../src/catalogue/sources.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const ISO = new Date(NOW).toISOString();
const SECRET = 'test-secret-not-used-in-production';

function makeConfig(adminToken: string | null = null): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-catalogue',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken,
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
  const dir = await mkdtemp(join(tmpdir(), 'sunny-catalogue-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: makeConfig(adminToken),
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
  });
  await app.ready();
  return { app, store, tenants };
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

const CSV = [
  'Category,Manufacturer,Model,Power (W),Capacity (kWh),Price,Currency,Warranty (years),Source URL',
  'panel,Aiko,AIKO-A450-MAH54Mw,450,,165.00,GBP,25,https://example.com/prices',
  'battery,GivEnergy,GIV-BAT-9.5,,9.5,3400.00,GBP,12,https://example.com/prices',
  'inverter,GivEnergy,GIV-HY5.0,5000,,1150.00,GBP,12,',
  'panel,,NO-MAKER,400,,,GBP,,',
].join('\n');

async function uploadAndPublish(app: FastifyInstance, tenantId: string, email: string, csv = CSV) {
  const preview = await app.inject({
    method: 'POST',
    url: `/v1/portal/tenants/${tenantId}/catalogue/upload`,
    headers: as(email),
    payload: { csv, mode: 'replace', fileName: 'prices.csv' },
  });
  expect(preview.statusCode).toBe(200);
  const upload = preview.json<{ upload: { id: string; accepted: number; issues: unknown[] } }>()
    .upload;
  const publish = await app.inject({
    method: 'POST',
    url: `/v1/portal/tenants/${tenantId}/catalogue/upload/${upload.id}/publish`,
    headers: as(email),
  });
  expect(publish.statusCode).toBe(200);
  return {
    upload,
    view: publish.json<{
      version: number;
      products: Array<{ id: string; model: string; source: string; priceStatus: string }>;
    }>(),
  };
}

describe('catalogue upload, preview and publish', () => {
  it('previews a file without publishing it, then publishes it as version 1', async () => {
    const { app, store } = await setup();
    const tenantId = await signUp(app, 'owner@brightside.test');

    const preview = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/catalogue/upload`,
      headers: as('owner@brightside.test'),
      payload: { csv: CSV, mode: 'replace' },
    });
    const upload = preview.json<{
      upload: {
        id: string;
        accepted: number;
        rejected: number;
        issues: Array<{ code: string; rowNumber: number | null }>;
      };
    }>().upload;
    expect(upload.accepted).toBe(3);
    expect(upload.rejected).toBe(1);
    expect(upload.issues.some((i) => i.code === 'missing-manufacturer' && i.rowNumber === 5)).toBe(
      true,
    );
    // Nothing is live until it is published.
    expect(await store.listProducts(tenantId)).toHaveLength(0);

    const { view } = await uploadAndPublish(app, tenantId, 'owner@brightside.test');
    expect(view.version).toBe(1);
    expect(view.products.map((p) => p.model).sort()).toEqual([
      'AIKO-A450-MAH54Mw',
      'GIV-BAT-9.5',
      'GIV-HY5.0',
    ]);
    expect(view.products.every((p) => p.source === 'csv')).toBe(true);
    expect(await store.listProducts(tenantId)).toHaveLength(3);
  });

  it('serves the template and an export that re-imports', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, 'owner@brightside.test');
    await uploadAndPublish(app, tenantId, 'owner@brightside.test');

    const template = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${tenantId}/catalogue/template.csv`,
      headers: as('owner@brightside.test'),
    });
    expect(template.body).toBe(CSV_TEMPLATE);
    const onDisk = await readFile(
      join(__dirname, '..', '..', '..', 'docs', 'templates', 'product-catalogue-template.csv'),
      'utf8',
    );
    expect(onDisk).toBe(CSV_TEMPLATE);

    const exported = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${tenantId}/catalogue/export.csv`,
      headers: as('owner@brightside.test'),
    });
    expect(exported.headers['content-type']).toContain('text/csv');
    const again = await setup();
    const other = await signUp(again.app, 'second@brightside.test');
    const { view } = await uploadAndPublish(
      again.app,
      other,
      'second@brightside.test',
      exported.body,
    );
    expect(view.products).toHaveLength(3);
  });
});

describe('editing, versions and rollback', () => {
  it('edits a product as a new version and refuses an unsourced "verified" price', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, 'owner@brightside.test');
    const { view } = await uploadAndPublish(app, tenantId, 'owner@brightside.test');
    const inverter = view.products.find((p) => p.model === 'GIV-HY5.0')!;
    expect(inverter.priceStatus).toBe('indicative');

    const refused = await app.inject({
      method: 'PATCH',
      url: `/v1/portal/tenants/${tenantId}/catalogue/products/${inverter.id}`,
      headers: as('owner@brightside.test'),
      payload: { priceStatus: 'verified' },
    });
    expect(refused.statusCode).toBe(400);

    const edited = await app.inject({
      method: 'PATCH',
      url: `/v1/portal/tenants/${tenantId}/catalogue/products/${inverter.id}`,
      headers: as('owner@brightside.test'),
      payload: { priceMinor: 119900, sourceRef: 'Price list Oct 2026', priceStatus: 'verified' },
    });
    expect(edited.statusCode).toBe(200);
    const body = edited.json<{
      product: { priceMinor: number; priceStatus: string };
      version: number;
    }>();
    expect(body.product).toMatchObject({ priceMinor: 119900, priceStatus: 'verified' });
    expect(body.version).toBe(2);
  });

  it('deletes a product and rolls back to the earlier version', async () => {
    const { app, store } = await setup();
    const tenantId = await signUp(app, 'owner@brightside.test');
    const { view } = await uploadAndPublish(app, tenantId, 'owner@brightside.test');
    const panel = view.products.find((p) => p.model === 'AIKO-A450-MAH54Mw')!;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/portal/tenants/${tenantId}/catalogue/products/${panel.id}`,
      headers: as('owner@brightside.test'),
    });
    expect(deleted.json<{ version: number }>().version).toBe(2);
    expect(await store.listProducts(tenantId)).toHaveLength(2);

    const restored = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/catalogue/versions/1/rollback`,
      headers: as('owner@brightside.test'),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ version: number }>().version).toBe(3);
    expect((await store.listProducts(tenantId)).map((p) => p.model)).toContain('AIKO-A450-MAH54Mw');
  });
});

describe('roles and tenant isolation', () => {
  it('lets a viewer read but not change the catalogue', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, 'owner@brightside.test');
    await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/members`,
      headers: as('owner@brightside.test'),
      payload: { email: 'viewer@brightside.test', role: 'viewer' },
    });
    const read = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${tenantId}/catalogue`,
      headers: as('viewer@brightside.test'),
    });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/catalogue/upload`,
      headers: as('viewer@brightside.test'),
      payload: { csv: CSV },
    });
    expect(write.statusCode).toBe(403);
  });

  it('gives another installer the same 404 for every catalogue route', async () => {
    const { app } = await setup();
    const a = await signUp(app, 'owner@brightside.test');
    await signUp(app, 'owner@rival.test', 'Rival Solar');
    const { view } = await uploadAndPublish(app, a, 'owner@brightside.test');
    const productId = view.products[0]!.id;

    const attempts = [
      { method: 'GET' as const, url: `/v1/portal/tenants/${a}/catalogue` },
      { method: 'GET' as const, url: `/v1/portal/tenants/${a}/catalogue/export.csv` },
      { method: 'GET' as const, url: `/v1/portal/tenants/${a}/catalogue/drafts` },
      {
        method: 'POST' as const,
        url: `/v1/portal/tenants/${a}/catalogue/upload`,
        payload: { csv: CSV },
      },
      {
        method: 'PATCH' as const,
        url: `/v1/portal/tenants/${a}/catalogue/products/${productId}`,
        payload: { notes: 'mine now' },
      },
      { method: 'DELETE' as const, url: `/v1/portal/tenants/${a}/catalogue/products/${productId}` },
      { method: 'POST' as const, url: `/v1/portal/tenants/${a}/catalogue/versions/1/rollback` },
    ];
    for (const attempt of attempts) {
      const response = await app.inject({ ...attempt, headers: as('owner@rival.test') });
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404);
    }
  });
});

describe('grounding: the chat reads only the published catalogue', () => {
  it('never sees pending uploads, drafts, or another tenant', async () => {
    const { app, store, tenants } = await setup();
    const a = await signUp(app, 'owner@brightside.test');
    const b = await signUp(app, 'owner@rival.test', 'Rival Solar');
    await uploadAndPublish(app, a, 'owner@brightside.test');

    // A pending upload with a product that is not published.
    await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${a}/catalogue/upload`,
      headers: as('owner@brightside.test'),
      payload: { csv: 'Category,Manufacturer,Model,Power (W)\npanel,Pending,PENDING-500,500\n' },
    });
    // A website draft that is not approved.
    await store.putKnowledgeSource({
      id: 'k1',
      tenantId: a,
      title: 'Batteries',
      url: 'https://brightside.example/batteries',
      version: 'v1',
      text: '# Batteries\n\n| Model | Capacity | Price |\n| --- | --- | --- |\n| Tesla Powerwall-3 | 13.5 kWh | £7,995 |\n',
      createdAt: ISO,
      updatedAt: ISO,
      kind: 'website',
    });
    expect((await scanWebsite(store, a, null, ISO)).drafts).toBe(1);

    const run = async (tenantId: string) => {
      const tenant = tenants.byId(tenantId)!;
      const result = await executeTool(
        { name: 'search_catalogue', args: { kind: 'all', maxResults: 25 } },
        {
          tenant,
          sessionId: 's1',
          conversationId: null,
          store,
          answers: {},
          events: [],
          sunscanConnected: false,
          knowledge: EMPTY_KNOWLEDGE,
        },
      );
      return JSON.stringify(result.data);
    };
    const seenByA = await run(a);
    expect(seenByA).toContain('AIKO-A450-MAH54Mw');
    expect(seenByA).not.toContain('PENDING-500');
    expect(seenByA).not.toContain('Powerwall');
    const seenByB = await run(b);
    expect(seenByB).not.toContain('AIKO-A450-MAH54Mw');
  });
});

// ─── website extraction ─────────────────────────────────────────────────────

const PRODUCT_TABLE_HTML = `<html><body><nav>Home</nav><main>
<h1>Home batteries</h1>
<p>We install the batteries below. Prices include fitting.</p>
<table>
<tr><th>Model</th><th>Usable capacity</th><th>Price</th><th>Warranty</th></tr>
<tr><td>Tesla Powerwall-3</td><td>13.5 kWh</td><td>From £7,995 inc. VAT</td><td>10 years</td></tr>
<tr><td>GivEnergy GIV-AIO-13.5</td><td>13.5kWh</td><td>£6,450</td><td>12 years</td></tr>
<tr><td>Our recommended battery</td><td>ask us</td><td></td><td></td></tr>
</table></main></body></html>`;

const SPEC_TABLE_HTML = `<html><body><main>
<h2>Solis S6 hybrid inverter</h2>
<table>
<tr><td>Manufacturer</td><td>Solis</td></tr>
<tr><td>Model</td><td>S6-EH1P5K-L-PLUS</td></tr>
<tr><td>Type</td><td>Hybrid inverter</td></tr>
<tr><td>Rated power</td><td>5 kW</td></tr>
<tr><td>Warranty</td><td>10 years</td></tr>
</table></main></body></html>`;

describe('website product extraction', () => {
  it('reads a product table, keeps provenance, marks prices indicative and skips non-products', () => {
    const markdown = htmlToMarkdown(PRODUCT_TABLE_HTML).markdown;
    expect(markdownTables(markdown)).toHaveLength(1);
    expect(looksLikeProductPage(markdown)).toBe(true);
    const url = 'https://brightside.example/batteries';
    const result = extractFromPage({ url, markdown, version: 'v7' }, 't1', ISO, 'Home batteries');
    const models = result.candidates.map((c) => `${c.product.manufacturer} ${c.product.model}`);
    expect(models).toEqual(['Tesla Powerwall-3', 'GivEnergy GIV-AIO-13.5']);
    const tesla = result.candidates[0]!;
    expect(tesla.product).toMatchObject({
      category: 'battery',
      capacityWh: 13500,
      priceMinor: 799500,
      currency: 'GBP',
      priceStatus: 'indicative',
      warrantyYears: 10,
      sourceRef: url,
      sourceVersion: 'v7',
    });
    expect(tesla.fieldSources['priceMinor']).toBe(`${url}#table-1`);
    expect(tesla.extractor).toBe('deterministic');
    expect(result.skipped).toBe(1);
  });

  it('reads a key/value spec table as one product', () => {
    const markdown = htmlToMarkdown(SPEC_TABLE_HTML).markdown;
    const result = extractFromPage(
      { url: 'https://brightside.example/inverters/solis', markdown },
      't1',
      ISO,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.product).toMatchObject({
      manufacturer: 'Solis',
      model: 'S6-EH1P5K-L-PLUS',
      category: 'inverter',
      powerW: 5000,
      priceMinor: null,
      priceStatus: 'unknown',
    });
  });

  it('never invents a value: a row without units or a model is not a draft', () => {
    const markdown =
      '# Panels\n\n| Model | Power |\n| --- | --- |\n| Aiko A450 | very powerful |\n';
    const result = extractFromPage({ url: 'https://x.example/p', markdown }, 't1', ISO, 'Panels');
    expect(result.candidates).toHaveLength(0);
  });

  it('feeds Gemini output through the same importer, and sends no guesses', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fakeFetch = ((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : '' });
      const payload = [
        {
          category: 'battery',
          manufacturer: 'Tesla',
          model: 'Powerwall-3',
          capacity: '13.5 kWh',
          price: '£7,995',
          currency: null,
          power: null,
          warranty: null,
        },
        {
          category: 'panel',
          manufacturer: 'Aiko',
          model: 'A450',
          power: null,
          capacity: null,
          price: null,
          currency: null,
          warranty: null,
        },
      ];
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;
    const extractor = geminiExtractor({ apiKey: 'k', fetch: fakeFetch });
    const result = await extractWithGemini(
      {
        url: 'https://brightside.example/powerwall',
        markdown: 'The Tesla Powerwall 3 holds 13.5 kWh and costs £7,995.',
      },
      extractor,
      't1',
      ISO,
    );
    expect(calls[0]!.body).toContain('Never infer');
    expect(calls[0]!.body).toContain('responseSchema');
    // The panel has no wattage on the page, so the importer refuses it rather than guessing.
    expect(result.candidates.map((c) => c.product.model)).toEqual(['Powerwall-3']);
    expect(result.candidates[0]!.extractor).toBe('gemini');
    expect(result.candidates[0]!.product.priceStatus).toBe('indicative');
  });

  it('turns a scan into drafts that need approval, and an approval into a new version', async () => {
    const { app, store } = await setup();
    const tenantId = await signUp(app, 'owner@brightside.test');
    await store.putKnowledgeSource({
      id: 'k-batt',
      tenantId,
      title: 'Home batteries',
      url: 'https://brightside.example/batteries',
      version: 'v1',
      text: htmlToMarkdown(PRODUCT_TABLE_HTML).markdown,
      createdAt: ISO,
      updatedAt: ISO,
      kind: 'website',
    });
    const scan = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/catalogue/website/scan`,
      headers: as('owner@brightside.test'),
    });
    expect(scan.json<{ scan: { drafts: number } }>().scan.drafts).toBe(2);
    expect(await store.listProducts(tenantId)).toHaveLength(0);

    const drafts = (
      await app.inject({
        method: 'GET',
        url: `/v1/portal/tenants/${tenantId}/catalogue/drafts`,
        headers: as('owner@brightside.test'),
      })
    ).json<{ drafts: Array<{ id: string; product: { model: string } }> }>().drafts;
    const tesla = drafts.find((d) => d.product.model === 'Powerwall-3')!;
    const other = drafts.find((d) => d.id !== tesla.id)!;

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/catalogue/drafts/approve`,
      headers: as('owner@brightside.test'),
      payload: { ids: [tesla.id] },
    });
    expect(approved.json<{ approved: number; version: number }>()).toMatchObject({
      approved: 1,
      version: 1,
    });
    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/catalogue/drafts/reject`,
      headers: as('owner@brightside.test'),
      payload: { ids: [other.id] },
    });
    expect(rejected.json<{ rejected: number }>().rejected).toBe(1);

    // A re-scan neither re-suggests the rejected product nor the approved one.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/catalogue/website/scan`,
      headers: as('owner@brightside.test'),
    });
    expect(again.json<{ scan: { drafts: number } }>().scan.drafts).toBe(0);
    const products = await store.listProducts(tenantId);
    expect(products.map((p) => p.model)).toEqual(['Powerwall-3']);
  });
});

// ─── Google Sheet ───────────────────────────────────────────────────────────

describe('Google Sheet as the product list', () => {
  it('parses Sheet links', () => {
    expect(
      sheetFileId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=0'),
    ).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(sheetFileId('not a link')).toBeNull();
  });

  it('drafts the rows for approval by default, and does nothing when unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-sheet-'));
    dirs.push(dir);
    const store = new FileStore(dir);
    let csv = CSV;
    const reader = { exportCsv: () => Promise.resolve(csv) };
    await setSheetSource(
      store,
      't1',
      {
        url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit',
        autoPublish: false,
      },
      ISO,
    );
    const first = await syncSheet(store, 't1', reader, ISO);
    expect(first).toMatchObject({ status: 'drafted', published: false, drafts: 3, errors: 1 });
    expect(await store.listProducts('t1')).toHaveLength(0);
    const state = await store.getCatalogueState('t1');
    expect(
      state?.drafts.every((d) => d.origin === 'sheet' && d.sourceUrl?.includes('docs.google.com')),
    ).toBe(true);

    const second = await syncSheet(store, 't1', reader, ISO);
    expect(second.status).toBe('unchanged');

    csv = CSV.split('\n').slice(0, 3).join('\n');
    const third = await syncSheet(store, 't1', reader, ISO);
    expect(third.status).toBe('drafted');
    expect(
      (await store.getCatalogueState('t1'))?.drafts.filter((d) => d.origin === 'sheet'),
    ).toHaveLength(2);
  });

  it('auto-publishes a clean Sheet only when the installer opted in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sunny-sheet-'));
    dirs.push(dir);
    const store = new FileStore(dir);
    const clean = CSV.split('\n').slice(0, 4).join('\n');
    await setSheetSource(
      store,
      't1',
      {
        url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit',
        autoPublish: true,
      },
      ISO,
    );
    const outcome = await syncSheet(store, 't1', { exportCsv: () => Promise.resolve(clean) }, ISO);
    expect(outcome).toMatchObject({ status: 'published', published: true });
    const state = await store.getCatalogueState('t1');
    expect(state?.currentVersion).toBe(1);
    expect(Object.values(state?.productSources ?? {})).toEqual(['sheet', 'sheet', 'sheet']);

    // A Sheet with an error row is never auto-published, even when opted in.
    const outcome2 = await syncSheet(store, 't1', { exportCsv: () => Promise.resolve(CSV) }, ISO);
    expect(outcome2.status).toBe('drafted');
    expect((await store.getCatalogueState('t1'))?.currentVersion).toBe(1);
  });

  it('reports plainly when Drive is not configured', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, 'owner@brightside.test');
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/portal/tenants/${tenantId}/catalogue/sheet`,
      headers: as('owner@brightside.test'),
      payload: { url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sync: { status: string; message: string } }>();
    expect(body.sync.status).toBe('failed');
    expect(body.sync.message).toContain('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON');
  });
});

describe('scheduler', () => {
  it('requires the admin token', async () => {
    const { app } = await setup('admin-token-123');
    const refused = await app.inject({ method: 'POST', url: '/v1/catalogue/sync-due' });
    expect(refused.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/catalogue/sync-due',
      headers: { authorization: 'Bearer admin-token-123' },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('helpers', () => {
  it('keys products by manufacturer and model, ignoring case and punctuation', () => {
    expect(productKey({ manufacturer: 'GivEnergy', model: 'GIV-HY5.0' })).toBe(
      productKey({ manufacturer: 'givenergy', model: 'giv hy5 0' }),
    );
  });

  it('defuses spreadsheet formulas in the export', () => {
    const csv = exportCsv([
      {
        id: 'p1',
        tenantId: 't1',
        category: 'other',
        manufacturer: 'Acme',
        model: 'X1',
        powerW: null,
        capacityWh: null,
        priceMinor: null,
        currency: null,
        priceStatus: 'unknown',
        warrantyYears: null,
        compatibility: {
          vocV: null,
          iscA: null,
          maxDcPowerW: null,
          maxStringVoltageV: null,
          mpptCount: null,
          phase: null,
          hybrid: null,
          batteryFamilies: null,
          batteryFamily: null,
          inverterModels: null,
        },
        sourceRef: null,
        sourceVersion: null,
        documentRefs: [],
        imageUrl: null,
        notes: '=HYPERLINK("evil")',
        rowNumber: null,
        createdAt: ISO,
      },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
  });
});
