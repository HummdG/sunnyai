import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultQuotationSettings } from '@sunny/contracts';
import { PNG } from 'pngjs';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { issueDevToken } from '../src/auth/dev.js';
import { MemoryBrandAssetStore } from '../src/branding/store.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

import { pdfText } from './pdf-text.js';

const T0 = Date.parse('2026-11-08T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SECRET = 'test-secret-not-used-in-production';
const OWNER = 'owner@brightside.test';
const MISSING = 'That image is no longer available. Upload it again.';

let clock = T0;

function makeConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-quotation',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: true,
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

async function setup() {
  clock = T0;
  const dir = await mkdtemp(join(tmpdir(), 'sunny-quotation-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: makeConfig(),
    store,
    tenants,
    now: () => clock,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
    brandAssets: new MemoryBrandAssetStore(() => clock),
  });
  await app.ready();
  return { app, tenants };
}

const as = (email: string) => ({ authorization: `Bearer ${issueDevToken(SECRET, email, clock)}` });

async function signUp(app: FastifyInstance, email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/portal/tenants',
    headers: as(email),
    payload: { companyName: 'Brightside Solar' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ tenant: { id: string } }>().tenant.id;
}

/** A transparent PNG with a disc of the given colour. */
function discPng(r: number): Buffer {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const inside = (x - 32) ** 2 + (y - 32) ** 2 <= 20 ** 2;
      png.data.set(inside ? [r, 230, 40, 255] : [0, 0, 0, 0], (y * 64 + x) * 4);
    }
  return PNG.sync.write(png);
}

function upload(app: FastifyInstance, tenantId: string, kind: string, png: Buffer) {
  return app.inject({
    method: 'POST',
    url: `/v1/portal/tenants/${tenantId}/brand/${kind}`,
    headers: as(OWNER),
    payload: { png: png.toString('base64') },
  });
}

async function uploadId(app: FastifyInstance, tenantId: string, kind: string, r: number) {
  const response = await upload(app, tenantId, kind, discPng(r));
  expect(response.statusCode).toBe(200);
  return response.json<{ asset: { id: string } }>().asset.id;
}

const url = (tenantId: string) => `/v1/portal/tenants/${tenantId}/quotation`;

function put(app: FastifyInstance, tenantId: string, settings: object, email = OWNER) {
  return app.inject({
    method: 'PUT',
    url: url(tenantId),
    headers: as(email),
    payload: { settings },
  });
}

function body() {
  const { version: _v, updatedAt: _u, ...rest } = defaultQuotationSettings();
  return rest;
}

interface View {
  settings: ReturnType<typeof defaultQuotationSettings>;
  saved: boolean;
  assets: { logo: { id: string } | null; accreditations: Array<{ id: string }> };
  colourNotes: {
    rail: { hex: string; adjusted: boolean };
    accent: { hex: string; adjusted: boolean };
  };
}

describe('quotation settings routes', () => {
  it('returns defaults and saved false before anything is saved', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const response = await app.inject({ method: 'GET', url: url(id), headers: as(OWNER) });
    expect(response.statusCode).toBe(200);
    const view = response.json<View>();
    expect(view.saved).toBe(false);
    expect(view.settings).toEqual(defaultQuotationSettings());
    expect(view.assets).toEqual({ logo: null, accreditations: [] });
  });

  it('saves, round-trips and bumps the version on every save', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const first = await put(app, id, { ...body(), validityDays: 45 });
    expect(first.statusCode).toBe(200);
    const one = first.json<View>();
    expect(one.saved).toBe(true);
    expect(one.settings.version).toBe(1);
    expect(one.settings.validityDays).toBe(45);
    expect(one.settings.updatedAt).toBe(new Date(T0).toISOString());

    const second = await put(app, id, { ...body(), validityDays: 60 });
    expect(second.json<View>().settings.version).toBe(2);

    const read = await app.inject({ method: 'GET', url: url(id), headers: as(OWNER) });
    expect(read.json<View>().settings.validityDays).toBe(60);
    expect(read.json<View>().saved).toBe(true);
  });

  it('returns colourNotes, with chosen colours saved and flagged when adjusted', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const fresh = await app.inject({ method: 'GET', url: url(id), headers: as(OWNER) });
    expect(fresh.json<View>().colourNotes.rail.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(fresh.json<View>().colourNotes.rail.adjusted).toBe(false);
    expect(fresh.json<View>().colourNotes.accent.adjusted).toBe(false);
    const response = await put(app, id, {
      ...body(),
      colours: { rail: '#FFE066', accent: '#1f5c3d' },
    });
    expect(response.statusCode).toBe(200);
    const view = response.json<View>();
    expect(view.settings.colours).toEqual({ rail: '#ffe066', accent: '#1f5c3d' });
    expect(view.colourNotes.rail.adjusted).toBe(true);
    expect(view.colourNotes.accent).toEqual({ hex: '#1f5c3d', adjusted: false });
    const bad = await put(app, id, { ...body(), colours: { rail: 'red', accent: null } });
    expect(bad.statusCode).toBe(400);
  });

  it('ignores a version the client sends', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const response = await put(app, id, { ...body(), version: 99, updatedAt: 'x' });
    expect(response.statusCode).toBe(200);
    expect(response.json<View>().settings.version).toBe(1);
  });

  it('rejects settings that fail validation', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const response = await put(app, id, { ...body(), validityDays: 0 });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown logo or accreditation id with the plain message', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const logo = await put(app, id, { ...body(), logoAssetId: '0123456789abcdef' });
    expect(logo.statusCode).toBe(400);
    expect(logo.json<{ error: { message: string } }>().error.message).toBe(MISSING);
    const accreditation = await put(app, id, {
      ...body(),
      accreditations: { mcsNumber: '', logoAssetIds: ['fedcba9876543210'] },
    });
    expect(accreditation.statusCode).toBe(400);
    expect(accreditation.json<{ error: { message: string } }>().error.message).toBe(MISSING);
    const odd = await put(app, id, { ...body(), logoAssetId: '../../etc/passwd' });
    expect(odd.statusCode).toBe(400);
    expect(odd.json<{ error: { message: string } }>().error.message).toBe(MISSING);
  });

  it('returns the asset views for saved ids', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const logo = await uploadId(app, id, 'pdf-logo', 100);
    const badge = await uploadId(app, id, 'accreditation', 120);
    const response = await put(app, id, {
      ...body(),
      logoAssetId: logo,
      accreditations: { mcsNumber: 'MCS 1234', logoAssetIds: [badge] },
    });
    expect(response.statusCode).toBe(200);
    const view = response.json<View>();
    expect(view.assets.logo?.id).toBe(logo);
    expect(view.assets.accreditations.map((a) => a.id)).toEqual([badge]);
  });

  it('lets a viewer read but not save', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    // A second person joins as viewer through the store.
    const viewer = 'viewer@brightside.test';
    const invite = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${id}/members`,
      headers: as(OWNER),
      payload: { email: viewer, role: 'viewer' },
    });
    expect([200, 201]).toContain(invite.statusCode);
    const read = await app.inject({ method: 'GET', url: url(id), headers: as(viewer) });
    expect(read.statusCode).toBe(200);
    const write = await put(app, id, body(), viewer);
    expect(write.statusCode).toBe(403);
  });

  it('keeps saved logos through later uploads and prunes unsaved ones after the grace period', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const logo = await uploadId(app, id, 'pdf-logo', 100);
    const badge = await uploadId(app, id, 'accreditation', 120);
    const stray = await uploadId(app, id, 'pdf-logo', 140);
    await put(app, id, {
      ...body(),
      logoAssetId: logo,
      accreditations: { mcsNumber: '', logoAssetIds: [badge] },
    });

    clock = T0 + 2 * DAY;
    await uploadId(app, id, 'wordmark', 160);

    const asset = (name: string) =>
      app.inject({
        method: 'GET',
        url: `/v1/portal/tenants/${id}/brand/assets/${name}.png`,
        headers: as(OWNER),
      });
    expect((await asset(logo)).statusCode).toBe(200);
    expect((await asset(badge)).statusCode).toBe(200);
    expect((await asset(stray)).statusCode).toBe(404);
  });

  it('never sends the quotation settings to the browser', async () => {
    const { app, tenants } = await setup();
    const id = await signUp(app, OWNER);
    await put(app, id, { ...body(), validityDays: 45 });
    const tenant = tenants.byId(id)!;
    expect(tenant.config.quotation?.validityDays).toBe(45);
    expect(tenants.configFor(tenant.publicId)).not.toHaveProperty('quotation');
  });
});

describe('quotation preview and sample PDF', () => {
  const preview = (app: FastifyInstance, id: string, settings: object, email = OWNER) =>
    app.inject({
      method: 'POST',
      url: `${url(id)}/preview`,
      headers: as(email),
      payload: { settings },
    });
  const text = async (res: { rawPayload: Buffer }) => (await pdfText(res.rawPayload)).join(' ');
  const terms = (heading: string) => ({
    ...body(),
    sections: { system: true, performance: true, savings: true, terms: true },
    terms: `${heading}
The deposit is due on order.`,
  });

  it('renders an unsaved draft from the sample quote, marked Sample', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const res = await preview(app, id, terms('UNSAVED DRAFT HEADING'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const all = await text(res);
    expect(all).toContain('UNSAVED DRAFT HEADING');
    expect(all).toContain('20 Forthlin Road');
    expect(all).toContain('Sample');
    expect(all).toContain('Estimated total');
    expect(all).not.toContain('—');
    // Nothing was saved by previewing.
    const read = await app.inject({ method: 'GET', url: url(id), headers: as(OWNER) });
    expect(read.json<View>().saved).toBe(false);
  });

  it('downloads the sample with the saved settings and a named file', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    await put(app, id, terms('SAVED HEADING'));
    const res = await app.inject({
      method: 'GET',
      url: `${url(id)}/sample.pdf`,
      headers: as(OWNER),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="Brightside-Solar-sample-quotation.pdf"',
    );
    const all = await text(res);
    expect(all).toContain('SAVED HEADING');
    expect(all).toContain('Sample');
  });

  it('lets a viewer preview, and rejects invalid settings with 400', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const viewer = 'viewer@brightside.test';
    await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${id}/members`,
      headers: as(OWNER),
      payload: { email: viewer, role: 'viewer' },
    });
    expect((await preview(app, id, body(), viewer)).statusCode).toBe(200);
    expect((await preview(app, id, { ...body(), validityDays: 0 })).statusCode).toBe(400);
    const none = await app.inject({
      method: 'POST',
      url: `${url(id)}/preview`,
      headers: as(OWNER),
      payload: {},
    });
    expect(none.statusCode).toBe(400);
  });

  it('renders without an image the tenant does not hold, rather than failing', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    const res = await preview(app, id, {
      ...body(),
      logoAssetId: '0123456789abcdef',
      accreditations: { mcsNumber: '', logoAssetIds: ['fedcba9876543210', '../x'] },
    });
    expect(res.statusCode).toBe(200);
  });

  it('limits previews to 30 a minute per tenant', async () => {
    const { app } = await setup();
    const id = await signUp(app, OWNER);
    for (let i = 0; i < 30; i++) {
      const ok = await app.inject({
        method: 'GET',
        url: `${url(id)}/sample.pdf`,
        headers: as(OWNER),
      });
      expect(ok.statusCode).toBe(200);
    }
    const over = await preview(app, id, body());
    expect(over.statusCode).toBe(429);
    expect(over.headers['retry-after']).toBeDefined();
  }, 120_000);
});
