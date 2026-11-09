import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { brandSchema } from '@sunny/contracts';
import { PNG } from 'pngjs';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildSystemInstruction } from '../src/agent/prompt.js';
import { issueDevToken } from '../src/auth/dev.js';
import { MemoryBrandAssetStore } from '../src/branding/store.js';
import type { ServerConfig } from '../src/config.js';
import { loadPortalConfig } from '../src/routes/portal-config.js';
import { buildServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { TenantRegistry, defaultTenants } from '../src/tenants.js';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';
const OWNER = 'owner@brightside.test';
const EXPIRED = 'That logo upload has expired. Upload it again.';
const NO_ANIMATION = 'Choose at least one animation.';

function makeConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-branding-settings',
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

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-branding-settings-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: makeConfig(),
    store,
    tenants,
    now: () => NOW,
    portal: { ...loadPortalConfig({}, 'test'), devAuth: true },
    brandAssets: new MemoryBrandAssetStore(),
  });
  await app.ready();
  return { app, tenants };
}

const as = (email: string) => ({ authorization: `Bearer ${issueDevToken(SECRET, email, NOW)}` });

async function signUp(app: FastifyInstance) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/portal/tenants',
    headers: as(OWNER),
    payload: { companyName: 'Brightside Solar' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ tenant: { id: string; publicId: string } }>().tenant;
}

function discPng(): Buffer {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const inside = (x - 32) ** 2 + (y - 32) ** 2 <= 20 ** 2;
      png.data.set(inside ? [170, 230, 40, 255] : [0, 0, 0, 0], (y * 64 + x) * 4);
    }
  return PNG.sync.write(png);
}

/** The disc with isolated pixels flipped in and out: the trace fails, so only stencil effects. */
function speckledPng(): Buffer {
  const png = PNG.sync.read(discPng());
  let s = 777;
  for (let y = 1; y < 63; y += 3)
    for (let x = 1; x < 63; x += 3) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      if ((s >> 16) % 2 === 0) continue;
      const at = (y * 64 + x) * 4;
      const inside = png.data[at + 3]! > 0;
      png.data.set(inside ? [0, 0, 0, 0] : [170, 230, 40, 255], at);
    }
  return PNG.sync.write(png);
}

async function uploadIcon(app: FastifyInstance, tenantId: string, png: Buffer) {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/portal/tenants/${tenantId}/brand/icon`,
    headers: as(OWNER),
    payload: { png: png.toString('base64') },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ asset: { id: string } }>().asset.id;
}

function save(app: FastifyInstance, tenantId: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: `/v1/portal/tenants/${tenantId}/settings`,
    headers: as(OWNER),
    payload: payload as object,
  });
}

const message = (r: { json: <T>() => T }) => r.json<{ error: { message: string } }>().error.message;

const logo = (iconId: string | null, effects: string[], colors: unknown = null) => ({
  branding: { mode: 'logo', iconId, wordmarkId: null, effects, colors },
});

function publicConfig(app: FastifyInstance, publicId: string) {
  return app.inject({ method: 'GET', url: `/v1/widget/config/${publicId}` });
}

describe('branding settings', () => {
  it('saves a logo and serves it in the public config', async () => {
    const { app } = await setup();
    const tenant = await signUp(app);
    const iconId = await uploadIcon(app, tenant.id, discPng());
    const saved = await save(app, tenant.id, logo(iconId, ['comet', 'shimmer']));
    expect(saved.statusCode).toBe(200);
    const view = saved.json<{ tenant: { branding: { mode: string; icon: { url: string } } } }>();
    expect(view.tenant.branding.mode).toBe('logo');
    expect(view.tenant.branding.icon.url).toBe(
      `/v1/portal/tenants/${tenant.id}/brand/assets/${iconId}.png`,
    );

    const config = await publicConfig(app, tenant.publicId);
    expect(config.headers['cache-control']).toBe('public, max-age=60');
    const body = config.json<{ brand: unknown; assistantName: string }>();
    const brand = brandSchema.parse(body.brand);
    expect(brand.effects).toEqual(['comet', 'shimmer']);
    expect(brand.icon.path).toBe(`/v1/widget/brand/${tenant.publicId}/${iconId}.png`);
    expect(body.assistantName).toBe('Sunny');
  });

  it('drops requested effects the icon cannot do, and needs at least one left', async () => {
    const { app } = await setup();
    const tenant = await signUp(app);
    const iconId = await uploadIcon(app, tenant.id, speckledPng());
    const refused = await save(app, tenant.id, logo(iconId, ['comet']));
    expect(refused.statusCode).toBe(400);
    expect(message(refused)).toBe(NO_ANIMATION);
    const ok = await save(app, tenant.id, logo(iconId, ['comet', 'shimmer']));
    expect(ok.statusCode).toBe(200);
    const { brand } = (await publicConfig(app, tenant.publicId)).json<{
      brand: { effects: string[] };
    }>();
    expect(brand.effects).toEqual(['shimmer']);
  });

  it('refuses an unknown id and a logo with no icon', async () => {
    const { app } = await setup();
    const tenant = await signUp(app);
    const unknown = await save(app, tenant.id, logo('0123456789abcdef', ['shimmer']));
    expect(unknown.statusCode).toBe(400);
    expect(message(unknown)).toBe(EXPIRED);
    const none = await save(app, tenant.id, logo(null, []));
    expect(none.statusCode).toBe(400);
    expect(message(none)).toBe('Upload an icon first.');
  });

  it('going back to Sunny removes the brand and its public images, and keeps the choice', async () => {
    const { app } = await setup();
    const tenant = await signUp(app);
    const iconId = await uploadIcon(app, tenant.id, discPng());
    await save(app, tenant.id, logo(iconId, ['shimmer']));
    const asset = `/v1/widget/brand/${tenant.publicId}/${iconId}.png`;
    expect((await app.inject({ method: 'GET', url: asset })).statusCode).toBe(200);

    const back = await save(app, tenant.id, {
      branding: { mode: 'sunny', iconId: null, wordmarkId: null, effects: [], colors: null },
    });
    expect(back.statusCode).toBe(200);
    expect(
      back.json<{ tenant: { branding: { icon: { id: string } } } }>().tenant.branding.icon.id,
    ).toBe(iconId);
    const body = (await publicConfig(app, tenant.publicId)).json<Record<string, unknown>>();
    expect(body.brand).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: asset })).statusCode).toBe(404);
  });

  it('names the assistant in the config and the prompt', async () => {
    const { app, tenants } = await setup();
    const tenant = await signUp(app);
    const saved = await save(app, tenant.id, { assistantName: 'Volt' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<{ tenant: { assistantName: string } }>().tenant.assistantName).toBe('Volt');
    const body = (await publicConfig(app, tenant.publicId)).json<{ assistantName: string }>();
    expect(body.assistantName).toBe('Volt');
    const stored = tenants.byId(tenant.id)!;
    expect(buildSystemInstruction(stored, 'chat', 0)).toContain(
      'You are Volt, a customer assistant for Brightside Solar.',
    );
  });

  it('refuses markup as a name', async () => {
    const { app } = await setup();
    const tenant = await signUp(app);
    const response = await save(app, tenant.id, { assistantName: '<b>' });
    expect(response.statusCode).toBe(400);
  });

  it('an installer who never set these gets Sunny and no brand', async () => {
    const { app } = await setup();
    const tenant = await signUp(app);
    const body = (await publicConfig(app, tenant.publicId)).json<Record<string, unknown>>();
    expect(body.assistantName).toBe('Sunny');
    expect(body.brand).toBeUndefined();
  });
});
