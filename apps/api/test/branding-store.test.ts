import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  brandAssetStoreFromEnv,
  FileBrandAssetStore,
  GcsBrandAssetStore,
  MemoryBrandAssetStore,
  type BrandAssetStore,
} from '../src/branding/store.js';

const NAME = '0123456789abcdef';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function fileStore(): Promise<FileBrandAssetStore> {
  const dir = await mkdtemp(join(tmpdir(), 'brand-'));
  dirs.push(dir);
  return new FileBrandAssetStore(dir);
}

describe.each([
  ['memory', () => Promise.resolve(new MemoryBrandAssetStore() as BrandAssetStore)],
  ['file', async () => (await fileStore()) as BrandAssetStore],
])('%s brand asset store', (_label, make) => {
  it('round-trips bytes per tenant and returns null when missing', async () => {
    const store = await make();
    await store.put('t1', `${NAME}.png`, new Uint8Array([1, 2, 3]));
    await store.put('t1', `${NAME}-mask.png`, new Uint8Array([4]));
    await store.put('t1', `${NAME}.json`, new Uint8Array([5]));
    expect(await store.get('t1', `${NAME}.png`)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.get('t1', `${NAME}-mask.png`)).toEqual(new Uint8Array([4]));
    expect(await store.get('t2', `${NAME}.png`)).toBeNull();
    expect(await store.get('t1', 'ffffffffffffffff.png')).toBeNull();
  });

  it("lists and deletes one tenant's files", async () => {
    const store = await make();
    await store.put('t1', `${NAME}.png`, new Uint8Array([1]));
    await store.put('t1', `${NAME}.json`, new Uint8Array([2]));
    await store.put('t2', `${NAME}.png`, new Uint8Array([3]));
    const names = (await store.list('t1')).map((f) => f.name).sort();
    expect(names).toEqual([`${NAME}.json`, `${NAME}.png`]);
    for (const file of await store.list('t1')) expect(file.createdAt).toBeGreaterThan(0);
    await store.delete('t1', `${NAME}.png`);
    await store.delete('t1', `${NAME}.png`);
    expect(await store.get('t1', `${NAME}.png`)).toBeNull();
    expect(await store.get('t2', `${NAME}.png`)).toEqual(new Uint8Array([3]));
    expect(await store.list('nobody')).toEqual([]);
  });

  it('rejects names outside the key shape', async () => {
    const store = await make();
    for (const bad of ['../x.png', 'x.png', `${NAME}.gif`, `${NAME}.png/..`, `${NAME}.PNG`]) {
      await expect(store.put('t1', bad, new Uint8Array([1]))).rejects.toThrow();
      await expect(store.get('t1', bad)).rejects.toThrow();
    }
  });
});

describe('file store tenant ids', () => {
  it('keeps a hostile tenant id inside its own folder', async () => {
    const store = await fileStore();
    await store.put('../evil', `${NAME}.png`, new Uint8Array([9]));
    expect(await store.get('../evil', `${NAME}.png`)).toEqual(new Uint8Array([9]));
    expect(await store.get('evil', `${NAME}.png`)).toBeNull();
  });
});

describe('dot-segment tenant ids', () => {
  it.each(['..', '.', '...'])('file store keeps %j inside its own folder', async (tenant) => {
    const dir = await mkdtemp(join(tmpdir(), 'brand-'));
    dirs.push(dir);
    const store = new FileBrandAssetStore(dir);
    await store.put(tenant, `${NAME}.png`, new Uint8Array([1]));
    const entries = await readdir(dir, { recursive: true });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const rel = relative(dir, join(dir, e));
      expect(rel.startsWith('..') && !rel.startsWith('..' + '%')).toBe(false);
      expect(isAbsolute(rel)).toBe(false);
    }
    expect(await readdir(join(dir, '..'))).not.toContain(`${NAME}.png`);
    expect(await store.get(tenant, `${NAME}.png`)).toEqual(new Uint8Array([1]));
    for (const other of ['..', '.', '...', 'x'].filter((t) => t !== tenant)) {
      expect(await store.get(other, `${NAME}.png`)).toBeNull();
    }
  });

  it('refuses an empty tenant id in every store', async () => {
    const file = await fileStore();
    await expect(file.put('', `${NAME}.png`, new Uint8Array([1]))).rejects.toThrow();
    await expect(file.get('', `${NAME}.png`)).rejects.toThrow();
    const gcs = new GcsBrandAssetStore({ bucket: 'b', token: null });
    expect(() => gcs.objectName('', `${NAME}.png`)).toThrow();
  });

  it.each(['..', '.'])('GCS object name for %j is a plain segment', (tenant) => {
    const gcs = new GcsBrandAssetStore({ bucket: 'b', token: null });
    const segments = gcs.objectName(tenant, `${NAME}.png`).split('/');
    expect(segments).toHaveLength(3);
    expect(segments[1]).not.toMatch(/^\.*$/);
    expect(gcs.objectName(tenant, `${NAME}.png`)).not.toBe(gcs.objectName('x', `${NAME}.png`));
  });
});

describe('GCS brand asset store', () => {
  function fake(status = 200) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(status === 200 ? new Uint8Array([7]) : null, { status }));
    }) as typeof fetch;
    return { calls, impl };
  }

  it('percent-encodes the tenant id in the object name and sets content type', async () => {
    const { calls, impl } = fake();
    const store = new GcsBrandAssetStore({
      bucket: 'b',
      endpoint: 'http://gcs.test',
      token: () => Promise.resolve('tok'),
      fetch: impl,
    });
    await store.put('a/../b', `${NAME}.png`, new Uint8Array([1]));
    expect(calls[0]!.url).toBe(
      `http://gcs.test/upload/storage/v1/b/b/o?uploadType=media&name=${encodeURIComponent(`brand/a%2F..%2Fb/${NAME}.png`)}`,
    );
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['content-type']).toBe('image/png');
    expect(headers['authorization']).toBe('Bearer tok');
    await store.put('t', `${NAME}.json`, new Uint8Array([1]));
    expect((calls[1]!.init!.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect(await store.get('t', `${NAME}.png`)).toEqual(new Uint8Array([7]));
  });

  it('returns null on 404 and throws on other failures', async () => {
    const make = (s: number) =>
      new GcsBrandAssetStore({ bucket: 'b', token: null, fetch: fake(s).impl });
    expect(await make(404).get('t', `${NAME}.png`)).toBeNull();
    await expect(make(500).get('t', `${NAME}.png`)).rejects.toThrow();
    await expect(make(500).put('t', `${NAME}.png`, new Uint8Array([1]))).rejects.toThrow();
  });

  it('lists every page of the tenant folder and deletes by object name', async () => {
    const calls: { url: string; method: string }[] = [];
    const pages = [
      {
        items: [
          { name: `brand/t/${NAME}.png`, timeCreated: '2026-11-08T10:00:00.000Z' },
          { name: 'brand/t/stray.txt', timeCreated: '2026-11-08T10:00:00.000Z' },
        ],
        nextPageToken: 'p2',
      },
      { items: [{ name: `brand/t/${NAME}.json`, timeCreated: '2026-11-08T11:00:00.000Z' }] },
    ];
    const impl = ((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(Response.json(pages.shift()));
    }) as typeof fetch;
    const store = new GcsBrandAssetStore({
      bucket: 'b',
      endpoint: 'http://gcs.test',
      token: null,
      fetch: impl,
    });
    const files = await store.list('t');
    expect(files).toEqual([
      { name: `${NAME}.png`, createdAt: Date.parse('2026-11-08T10:00:00.000Z') },
      { name: `${NAME}.json`, createdAt: Date.parse('2026-11-08T11:00:00.000Z') },
    ]);
    expect(calls[0]!.url).toContain(`prefix=${encodeURIComponent('brand/t/')}`);
    expect(calls[1]!.url).toContain('pageToken=p2');
    await store.delete('t', `${NAME}.png`);
    expect(calls[2]).toEqual({
      url: `http://gcs.test/storage/v1/b/b/o/${encodeURIComponent(`brand/t/${NAME}.png`)}`,
      method: 'DELETE',
    });
    const failing = new GcsBrandAssetStore({ bucket: 'b', token: null, fetch: fake(500).impl });
    await expect(failing.delete('t', `${NAME}.png`)).rejects.toThrow();
    await expect(failing.list('t')).rejects.toThrow();
  });

  it('rejects bad names before any request', async () => {
    const { calls, impl } = fake();
    const store = new GcsBrandAssetStore({ bucket: 'b', token: null, fetch: impl });
    await expect(store.get('t', '../x.png')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('brandAssetStoreFromEnv', () => {
  it('throws for gcs without a bucket', () => {
    expect(() => brandAssetStoreFromEnv('/data', { BRAND_ASSET_STORE: 'gcs' })).toThrow(
      /BRAND_ASSET_BUCKET/,
    );
  });
  it('builds gcs and file stores', () => {
    expect(
      brandAssetStoreFromEnv('/data', {
        BRAND_ASSET_STORE: 'gcs',
        BRAND_ASSET_BUCKET: 'b',
        STORAGE_EMULATOR_HOST: 'http://localhost:1',
      }),
    ).toBeInstanceOf(GcsBrandAssetStore);
    expect(brandAssetStoreFromEnv('/data', {})).toBeInstanceOf(FileBrandAssetStore);
  });
});
