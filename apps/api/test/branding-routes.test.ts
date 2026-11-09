import { randomFillSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const SECRET = 'test-secret-not-used-in-production';
const OWNER = 'owner@brightside.test';
const RIVAL = 'rival@other.test';
const NOT_PNG = "That file isn't a PNG. Upload a PNG or SVG.";
const TOO_LARGE = 'That image is too big. Use one under 2048 pixels on each side and 3 MB.';

function makeConfig(rateLimited = false): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    nodeEnv: 'test',
    gemini: undefined,
    dataDir: '.data-test-branding',
    allowedOrigins: [],
    sessionSecret: SECRET,
    adminToken: null,
    logLevel: 'silent',
    sandboxTenant: false,
    leadRetentionDays: 730,
    rateLimit: {
      enabled: rateLimited,
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

async function setup(rateLimited = false) {
  const dir = await mkdtemp(join(tmpdir(), 'sunny-branding-'));
  dirs.push(dir);
  const store = new FileStore(dir);
  const tenants = await TenantRegistry.load(store, defaultTenants(false));
  const app = buildServer({
    config: makeConfig(rateLimited),
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

/** A transparent PNG with a lime disc. */
function discPng(): Buffer {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const inside = (x - 32) ** 2 + (y - 32) ** 2 <= 20 ** 2;
      png.data.set(inside ? [170, 230, 40, 255] : [0, 0, 0, 0], (y * 64 + x) * 4);
    }
  return PNG.sync.write(png);
}

/** Opaque noise, which deflate cannot shrink: 980 x 980 is about 3.1 MB of PNG. */
function noisePng(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  randomFillSync(png.data);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  const bytes = PNG.sync.write(png);
  expect(bytes.length).toBeGreaterThan(3 * 1024 * 1024);
  return bytes;
}

interface AssetBody {
  asset: { id: string; availableEffects: string[]; url: string; maskUrl: string | null };
}

function upload(app: FastifyInstance, tenantId: string, email: string, png: Buffer) {
  return app.inject({
    method: 'POST',
    url: `/v1/portal/tenants/${tenantId}/brand/icon`,
    headers: as(email),
    payload: { png: png.toString('base64') },
  });
}

const message = (r: { json: <T>() => T }) => r.json<{ error: { message: string } }>().error.message;

describe('logo upload', () => {
  it('processes a transparent disc for an admin', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, OWNER);
    const response = await upload(app, tenantId, OWNER, discPng());
    expect(response.statusCode).toBe(200);
    const { asset } = response.json<AssetBody>();
    expect(asset.availableEffects).toHaveLength(7);
    expect(asset.url).toBe(`/v1/portal/tenants/${tenantId}/brand/assets/${asset.id}.png`);
    expect(asset.maskUrl).toBe(`/v1/portal/tenants/${tenantId}/brand/assets/${asset.id}-mask.png`);
  });

  it('refuses a viewer', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, OWNER);
    const invite = await app.inject({
      method: 'POST',
      url: `/v1/portal/tenants/${tenantId}/members`,
      headers: as(OWNER),
      payload: { email: 'viewer@brightside.test', role: 'viewer' },
    });
    expect(invite.statusCode).toBeLessThan(300);
    const response = await upload(app, tenantId, 'viewer@brightside.test', discPng());
    expect(response.statusCode).toBe(403);
  });

  it('tells a JPEG it is not a PNG, in plain words', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, OWNER);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    const response = await upload(app, tenantId, OWNER, jpeg);
    expect(response.statusCode).toBe(400);
    expect(message(response)).toBe(NOT_PNG);
  });

  it('rejects a body that is not plain base64, or is empty', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, OWNER);
    for (const png of ['', 'data:image/png;base64,AAAA', 'not base64!']) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/portal/tenants/${tenantId}/brand/icon`,
        headers: as(OWNER),
        payload: { png },
      });
      expect(response.statusCode).toBe(400);
      expect(message(response)).toBe(NOT_PNG);
    }
  });

  it('answers an oversize body with a 4xx, never a 500', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, OWNER);
    const response = await upload(app, tenantId, OWNER, Buffer.alloc(3.5 * 1024 * 1024, 1));
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it('gives the too-large copy for a payload over 3 MB that fits the body limit', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, OWNER);
    const response = await upload(app, tenantId, OWNER, Buffer.alloc(3 * 1024 * 1024 + 1, 1));
    expect(response.statusCode).toBe(400);
    expect(message(response)).toBe(TOO_LARGE);
  });

  it('gives a plain 400 for a real PNG over 3 MB', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, OWNER);
    const response = await upload(app, tenantId, OWNER, noisePng(980, 980));
    expect(response.statusCode).toBe(400);
    expect(message(response)).toBe(TOO_LARGE);
  });

  it('allows 20 uploads per installer in 10 minutes, then refuses with a 429', async () => {
    const { app } = await setup(true);
    const tenantId = await signUp(app, OWNER);
    const other = await signUp(app, RIVAL);
    const png = discPng();
    for (let i = 0; i < 20; i++) {
      expect((await upload(app, tenantId, OWNER, png)).statusCode).toBe(200);
    }
    const refused = await upload(app, tenantId, OWNER, png);
    expect(refused.statusCode).toBe(429);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('rate_limited');
    expect(message(refused)).toBe('Too many requests. Please wait a moment and try again.');
    expect(refused.headers['retry-after']).toBeDefined();
    // Another installer has its own allowance.
    expect((await upload(app, other, RIVAL, png)).statusCode).toBe(200);
  });
});

describe('logo reads', () => {
  it('serves the stored PNG to a portal member and to nobody else', async () => {
    const { app } = await setup();
    const tenantId = await signUp(app, OWNER);
    const other = await signUp(app, RIVAL);
    const { asset } = (await upload(app, tenantId, OWNER, discPng())).json<AssetBody>();
    const read = await app.inject({ method: 'GET', url: asset.url, headers: as(OWNER) });
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toBe('image/png');
    expect(read.rawPayload.subarray(1, 4).toString('ascii')).toBe('PNG');
    // The rival's own tenant holds no such file.
    const own = await app.inject({
      method: 'GET',
      url: `/v1/portal/tenants/${other}/brand/assets/${asset.id}.png`,
      headers: as(RIVAL),
    });
    expect(own.statusCode).toBe(404);
    // And the rival is not a member of ours; a non-member is told it does not exist.
    const crossed = await app.inject({ method: 'GET', url: asset.url, headers: as(RIVAL) });
    expect(crossed.statusCode).toBe(404);
  });

  it('serves publicly only what the saved logo branding names', async () => {
    const { app, tenants } = await setup();
    const tenantId = await signUp(app, OWNER);
    const other = await signUp(app, RIVAL);
    const mine = (await upload(app, tenantId, OWNER, discPng())).json<AssetBody>().asset;
    const tenant = tenants.byId(tenantId)!;
    const rival = tenants.byId(other)!;
    const url = `/v1/widget/brand/${tenant.publicId}/${mine.id}.png`;

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);

    const meta = { id: mine.id, kind: 'icon', hasMask: true } as never;
    tenant.config.branding = {
      mode: 'logo',
      icon: meta,
      wordmark: null,
      effects: [],
      colors: null,
    };
    const served = await app.inject({ method: 'GET', url });
    expect(served.statusCode).toBe(200);
    expect(served.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'x-content-type-options': 'nosniff',
    });

    // The rival names this id too, but it is not in the rival's own store.
    rival.config.branding = { mode: 'logo', icon: meta, wordmark: null, effects: [], colors: null };
    const through = `/v1/widget/brand/${rival.publicId}/${mine.id}.png`;
    expect((await app.inject({ method: 'GET', url: through })).statusCode).toBe(404);
    const unsaved = `/v1/widget/brand/${tenant.publicId}/ffffffffffffffff.png`;
    expect((await app.inject({ method: 'GET', url: unsaved })).statusCode).toBe(404);

    tenant.config.branding.mode = 'sunny';
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });
});
