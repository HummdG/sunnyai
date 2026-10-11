import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CatalogueResponse,
  CatalogueUploadResponse,
  RecommendationResponse,
} from '@sunny/contracts';

import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry } from '../src/tenants.js';
import {
  BATTERY,
  CATALOGUE,
  DEMO_TENANT_ID,
  INVERTER_4K,
  PANEL_430,
  PANEL_500,
  TEST_ADMIN_TOKEN,
  csv,
  uploadCatalogue,
} from './catalogue-fixture.js';
import type { ServerConfig } from '../src/config.js';
import type { ChatProvider } from '../src/agent/provider.js';
import { ScriptedProvider } from './scripted-provider.js';
import type { FastifyInstance } from 'fastify';

/**
 * The catalogue route, the widget-facing catalogue read, and recommendations --
 * end to end through a real server, a real store on disk and the real engine.
 *
 * What this file is for is the *seam* between the HTTP layer and the honesty
 * rules: that an upload the route refuses stores nothing, that a file the reader
 * half-understood is reported rather than half-stored, and that the constraints
 * a visitor states accumulate across requests instead of being restated by the
 * caller. The engine's own arithmetic is tested in `packages/solar-rules`; what
 * is tested here is that the route hands it the right rows and stores what it
 * says it stored.
 */

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-catalogue',
    allowedOrigins: ['http://localhost:4173'],
    sessionSecret: 'test-secret-not-used-in-production',
    adminToken: 'admin-token-for-tests',
    logLevel: 'silent',
    rateLimit: {
      enabled: true,
      trustProxyHops: 0,
      rules: {
        session: { limit: 100_000, windowMs: 60_000 },
        chat: { limit: 100_000, windowMs: 60_000 },
        leads: { limit: 100_000, windowMs: 60_000 },
        qualification: { limit: 100_000, windowMs: 60_000 },
        catalogue: { limit: 100_000, windowMs: 60_000 },
        knowledge: { limit: 100_000, windowMs: 60_000 },
      },
      maxKeys: 10_000,
    },
    ...overrides,
  };
}

interface Harness {
  app: FastifyInstance;
  store: FileStore;
  dir: string;
}

let dirs: string[] = [];

beforeEach(() => {
  dirs = [];
});

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function h(config = makeConfig(), provider?: ChatProvider): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-cat-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const app = buildServer({
    config,
    store,
    tenants: new TenantRegistry(),
    ...(provider ? { provider } : {}),
    now: () => 1_700_000_000_000,
  });
  await app.ready();
  return { app, store, dir };
}

async function openSession(app: FastifyInstance): Promise<{ sessionId: string; token: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/widget/session',
    payload: { publicId: 'w_demo000001', origin: 'http://localhost:4173' },
  });
  const body = response.json<{ sessionId: string; sessionToken: string }>();
  return { sessionId: body.sessionId, token: body.sessionToken };
}

function parseSse(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n\n')
    .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

/** The upload route, asserting the report shape this file is about. */
function upload(
  app: FastifyInstance,
  payload: Record<string, unknown>,
  token: string | null = TEST_ADMIN_TOKEN,
): Promise<{ status: number; body: CatalogueUploadResponse }> {
  return uploadCatalogue<CatalogueUploadResponse>(app, payload, token);
}

async function storedCount(store: FileStore): Promise<number> {
  return (await store.listProducts(DEMO_TENANT_ID)).length;
}

describe('loading a catalogue', () => {
  it('stores a readable file and reports what it made of it', async () => {
    const { app, store } = await h();
    const { status, body } = await upload(app, { csv: CATALOGUE });

    expect(status).toBe(201);
    expect(body.accepted).toBe(4);
    expect(body.rejected).toBe(0);
    expect(body.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(body.catalogueSize).toBe(4);
    expect(body.dryRun).toBe(false);
    expect(body.mode).toBe('replace');

    // Read back from the store rather than from the response: the response
    // saying it stored four rows and the disk holding four rows are two
    // different claims, and this test is about the second one.
    const products = await store.listProducts('t_demo0001');
    expect(products).toHaveLength(4);

    const inverter = products.find((product) => product.model === 'VX-4K');
    expect(inverter?.priceMinor).toBe(120_000);
    expect(inverter?.currency).toBe('GBP');
    // The symbol in the price column, read as the currency it is, and the header
    // unit beside a bare number, read as the unit it states.
    expect(inverter?.compatibility.maxDcPowerW).toBe(4600);
    expect(inverter?.priceStatus).toBe('verified');
  });

  it('refuses every upload when the deployment has no admin token', async () => {
    const { app, store } = await h(makeConfig({ adminToken: null }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/catalog/products',
      // No header at all, and a plausible one: an unset token must refuse both,
      // because "no credential configured" is not "any credential accepted".
      payload: { tenantId: 't_demo0001', csv: CATALOGUE },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_enabled');
    expect(await storedCount(store)).toBe(0);
  });

  it('refuses a wrong admin token', async () => {
    const { app, store } = await h();
    const { status } = await upload(app, { csv: CATALOGUE }, 'not-the-admin-token');

    expect(status).toBe(401);
    expect(await storedCount(store)).toBe(0);
  });

  it('changes nothing on a dry run', async () => {
    const { app, store } = await h();
    const { status, body } = await upload(app, { csv: CATALOGUE, dryRun: true });

    expect(status).toBe(200);
    expect(body.dryRun).toBe(true);
    // The report is the whole point of a dry run, so it is the full report.
    expect(body.accepted).toBe(4);
    expect(body.products).toHaveLength(4);
    expect(await storedCount(store)).toBe(0);
  });

  it('stores nothing at all when the file itself cannot be trusted', async () => {
    const { app, store } = await h();
    // An unterminated quote means the rest of the file is inside one cell. Half
    // a price list is worse than none: the rows that survived would look as
    // solid as a complete upload.
    const truncated = `${CATALOGUE}Panel,Sunbeam,"SB-600,430\n`;
    const { status, body } = await upload(app, { csv: truncated });

    expect(status).toBe(200);
    expect(body.accepted).toBe(0);
    expect(body.products).toEqual([]);
    expect(body.issues.some((issue) => issue.code === 'unterminated-quote')).toBe(true);
    expect(await storedCount(store)).toBe(0);
  });

  it('keeps the readable rows and points at the one it could not read', async () => {
    const { app, store } = await h();
    const withBadRow = csv(PANEL_430, PANEL_500, INVERTER_4K, BATTERY, {
      ...PANEL_430,
      Model: 'SB-999',
      Price: 'POA',
    });
    const { status, body } = await upload(app, { csv: withBadRow });

    expect(status).toBe(201);
    expect(body.accepted).toBe(4);
    expect(body.rejected).toBe(1);
    const error = body.issues.find((issue) => issue.severity === 'error');
    expect(error?.code).toBe('unreadable-number');
    expect(error?.rowNumber).toBe(6);
    expect(await storedCount(store)).toBe(4);
  });

  it('appends without dropping what the installer already loaded', async () => {
    const { app, store } = await h();
    await upload(app, { csv: csv(PANEL_430) });
    const { status, body } = await upload(app, { csv: csv(PANEL_500), mode: 'append' });

    expect(status).toBe(201);
    expect(body.catalogueSize).toBe(2);
    expect((await store.listProducts('t_demo0001')).map((p) => p.model).sort()).toEqual([
      'SB-430',
      'SB-500',
    ]);
  });

  it('serves the tenant’s own catalogue to a widget session', async () => {
    const { app } = await h();
    await upload(app, { csv: CATALOGUE });
    const { token } = await openSession(app);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalog/products',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<CatalogueResponse>();
    expect(body.products).toHaveLength(4);
    expect(body.currencies).toEqual(['GBP']);
    expect(body.categories.sort()).toEqual(['battery', 'inverter', 'panel']);
  });

  it('refuses the catalogue read without a session token', async () => {
    const { app } = await h();
    await upload(app, { csv: CATALOGUE });
    const response = await app.inject({ method: 'GET', url: '/v1/catalog/products' });

    expect(response.statusCode).toBe(401);
  });
});

/** One refinement, asserting the POST succeeded, for the two describes that price. */
async function price(
  app: FastifyInstance,
  token: string,
  sessionId: string,
  want: Record<string, unknown>,
): Promise<RecommendationResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/recommendations',
    headers: { authorization: `Bearer ${token}` },
    payload: { sessionId, want },
  });
  expect(response.statusCode).toBe(200);
  return response.json<RecommendationResponse>();
}

describe('recommendations', () => {
  it('prices options for the size the visitor named', async () => {
    const { app } = await h();
    await upload(app, { csv: CATALOGUE });
    const { sessionId, token } = await openSession(app);

    const body = await price(app, token, sessionId, { targetKwp: 4 });

    expect(body.catalogue.products).toBe(4);
    expect(body.catalogue.currency).toBe('GBP');
    expect(body.catalogue.priceable).toBe(4);
    expect(body.packages.length).toBeGreaterThan(0);

    for (const option of body.packages) {
      const panels = option.items.find((item) => item.category === 'panel');
      const inverter = option.items.find((item) => item.category === 'inverter');
      expect(panels).toBeDefined();
      expect(inverter).toBeDefined();
      // Every option that reached the visitor is a priced one, which is the
      // whole reason the totals can be shown at all.
      expect(option.totalMinor).toBeGreaterThan(0);
      expect(option.currency).toBe('GBP');
      expect(option.limitations.join(' ')).not.toMatch(/yield|kWh per year|payback/i);
    }
  });

  it('accumulates a refinement instead of replacing what was asked for', async () => {
    const { app } = await h();
    await upload(app, { csv: CATALOGUE });
    const { sessionId, token } = await openSession(app);

    const first = await price(app, token, sessionId, { targetKwp: 4 });
    const refined = await price(app, token, sessionId, { requireBattery: true });

    // The refinement said nothing about size, and the size is still in force.
    expect(first.want.requireBattery).toBeUndefined();
    expect(refined.want.targetKwp).toBe(4);
    expect(refined.want.requireBattery).toBe(true);
    for (const option of refined.packages) {
      expect(option.batteryCapacityWh).toBe(5000);
      expect(option.items.some((item) => item.category === 'battery')).toBe(true);
    }

    // And it survives into the next request, which states something else again.
    const cheaper = await price(app, token, sessionId, { preferCheaper: true });
    expect(cheaper.want.targetKwp).toBe(4);
    expect(cheaper.want.requireBattery).toBe(true);
    expect(cheaper.want.preferCheaper).toBe(true);
  });

  it('starts again when the visitor changes their mind', async () => {
    const { app } = await h();
    await upload(app, { csv: CATALOGUE });
    const { sessionId, token } = await openSession(app);

    await price(app, token, sessionId, { targetKwp: 4, requireBattery: true });
    const reset = await price(app, token, sessionId, { targetKwp: 6, reset: true });

    expect(reset.want.requireBattery).toBeUndefined();
    expect(reset.want.targetKwp).toBe(6);
  });

  it('asks for a size rather than inventing one', async () => {
    const { app } = await h();
    await upload(app, { csv: CATALOGUE });
    const { sessionId, token } = await openSession(app);

    const body = await price(app, token, sessionId, {});

    expect(body.packages).toEqual([]);
    expect(body.note).toMatch(/how big a system/i);
    expect(body.surveyConfirmed).toEqual([]);
  });

  it('says the catalogue is empty rather than improvising one', async () => {
    const { app } = await h();
    const { sessionId, token } = await openSession(app);

    const body = await price(app, token, sessionId, { targetKwp: 4 });

    expect(body.packages).toEqual([]);
    expect(body.catalogue.products).toBe(0);
    expect(body.note).toMatch(/has not loaded a product list/i);
  });

  it('refuses a session token for a different session', async () => {
    const { app } = await h();
    await upload(app, { csv: CATALOGUE });
    const { token } = await openSession(app);
    const other = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/recommendations',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId: other.sessionId, want: { targetKwp: 4 } },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('reading the options back', () => {
  function read(
    app: FastifyInstance,
    token: string | null,
  ): Promise<{ status: number; body: RecommendationResponse }> {
    return app
      .inject({
        method: 'GET',
        url: '/v1/recommendations',
        ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
      })
      .then((response) => ({
        status: response.statusCode,
        body: response.json<RecommendationResponse>(),
      }));
  }

  it('requires a session token', async () => {
    const { app } = await h();
    expect((await read(app, null)).status).toBe(401);
  });

  it('returns the options already in force, without refining them', async () => {
    // This is the widget reopening a conversation: the visitor should see the
    // options they were given, not an empty frame. The read is the same pure
    // function of the stored constraints, so it cannot disagree with the POST
    // that produced them.
    const { app, store } = await h();
    await upload(app, { csv: CATALOGUE });
    const { sessionId, token } = await openSession(app);
    const priced = await price(app, token, sessionId, { targetKwp: 4 });

    const { status, body } = await read(app, token);

    expect(status).toBe(200);
    expect(body.want).toEqual(priced.want);
    expect(body.packages).toEqual(priced.packages);
    // And nothing was written: the standing constraints are exactly what the
    // last refinement left.
    expect(await store.getWant(DEMO_TENANT_ID, sessionId)).toEqual({ targetKwp: 4 });
  });

  it('reads the session the token names and no other', async () => {
    // The token *is* the session, so there is no id parameter to get wrong --
    // and a second visitor's token cannot read the first visitor's options.
    const { app } = await h();
    await upload(app, { csv: CATALOGUE });
    const first = await openSession(app);
    const second = await openSession(app);
    await price(app, first.token, first.sessionId, { targetKwp: 4 });

    const ours = await read(app, first.token);
    const theirs = await read(app, second.token);

    expect(ours.body.packages.length).toBeGreaterThan(0);
    expect(theirs.body.want).toEqual({});
    expect(theirs.body.packages).toEqual([]);
  });

  it('answers a session that has asked for nothing with nothing priced', async () => {
    const { app } = await h();
    await upload(app, { csv: CATALOGUE });
    const { token } = await openSession(app);

    const { body } = await read(app, token);

    expect(body.packages).toEqual([]);
    expect(body.want).toEqual({});
    expect(body.catalogue.products).toBe(4);
  });
});

describe('a chat turn that prices something', () => {
  it('tells the widget which option to show', async () => {
    // The one thing that cannot be tested by calling the tool directly: that the
    // option it assembled survives the turn and reaches the client as the event
    // the widget's "here are your options" moment fires on.
    const provider = new ScriptedProvider(() => [
      { type: 'tool_started', call: { name: 'recommend_packages', args: { targetKwp: 4 } } },
      { type: 'text', text: 'Here are the options I can price from Northwind’s list.' },
    ]);
    const { app } = await h(makeConfig(), provider);
    await upload(app, { csv: CATALOGUE });
    const { sessionId, token } = await openSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { authorization: `Bearer ${token}` },
      payload: { sessionId, clientMessageId: 'c1', text: 'what would four kilowatts cost?' },
    });

    const events = parseSse(response.body);
    expect(events.map((event) => event['type'])).toContain('tool_finished');

    const ready = events.find((event) => event['type'] === 'recommendation_ready');
    expect(ready?.['recommendationId']).toMatch(/^opt-/);

    const finished = events.find((event) => event['type'] === 'message_finished');
    expect(finished?.['tools']).toEqual(['recommend_packages']);
  });
});
