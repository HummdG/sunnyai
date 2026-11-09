import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { googleTokens, type TokenProvider } from '../google/auth.js';

/**
 * Uploaded logos (the PNG, its mask PNG and the metadata JSON), private per
 * tenant. The API reads the bytes and serves them through its own
 * tenant-scoped routes; nothing is ever public.
 */
export interface BrandAssetStore {
  put(tenantId: string, name: string, bytes: Uint8Array): Promise<void>;
  get(tenantId: string, name: string): Promise<Uint8Array | null>;
}

/** The only key shape: a 16-hex id, then `.png`, `-mask.png` or `.json`. */
const NAME_PATTERN = /^[a-f0-9]{16}(-mask\.png|\.png|\.json)$/;

function checkName(name: string): void {
  if (!NAME_PATTERN.test(name)) throw new Error('Invalid brand asset name.');
}

/**
 * One path or object segment for a tenant id. Percent-encoded, and an id made
 * only of dots ('.', '..') has its dots encoded too, so it is never a dot
 * segment. An empty id is refused. Distinct ids stay distinct ('%2E' encodes
 * to '%252E').
 */
export function tenantSegment(tenantId: string): string {
  if (!tenantId) throw new Error('A tenant id is required.');
  const encoded = encodeURIComponent(tenantId);
  return /^\.+$/.test(encoded) ? encoded.replace(/\./g, '%2E') : encoded;
}

function contentType(name: string): string {
  return name.endsWith('.json') ? 'application/json' : 'image/png';
}

/** Brand assets in memory, for tests. */
export class MemoryBrandAssetStore implements BrandAssetStore {
  readonly #objects = new Map<string, Uint8Array>();

  put(tenantId: string, name: string, bytes: Uint8Array): Promise<void> {
    if (!NAME_PATTERN.test(name)) return Promise.reject(new Error('Invalid brand asset name.'));
    this.#objects.set(JSON.stringify([tenantId, name]), new Uint8Array(bytes));
    return Promise.resolve();
  }

  get(tenantId: string, name: string): Promise<Uint8Array | null> {
    if (!NAME_PATTERN.test(name)) return Promise.reject(new Error('Invalid brand asset name.'));
    return Promise.resolve(this.#objects.get(JSON.stringify([tenantId, name])) ?? null);
  }
}

/** Brand assets on local disk, one folder per tenant. */
export class FileBrandAssetStore implements BrandAssetStore {
  constructor(private readonly dir: string) {}

  #path(tenantId: string, name: string): string {
    checkName(name);
    // One safe segment per tenant (see tenantSegment), so it cannot climb out of its folder.
    return join(this.dir, tenantSegment(tenantId), name);
  }

  async put(tenantId: string, name: string, bytes: Uint8Array): Promise<void> {
    const file = this.#path(tenantId, name);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  }

  async get(tenantId: string, name: string): Promise<Uint8Array | null> {
    const file = this.#path(tenantId, name);
    try {
      return new Uint8Array(await readFile(file));
    } catch {
      return null;
    }
  }
}

export interface GcsBrandAssetStoreOptions {
  bucket: string;
  prefix?: string;
  endpoint?: string;
  token: TokenProvider | null;
  fetch?: typeof fetch;
}

/**
 * Brand assets in a private Cloud Storage bucket, keyed
 * `<prefix>/<encoded tenant>/<name>`. Same JSON API over fetch as the SunScan
 * artefact store; `token` is null for an emulator that needs no auth.
 */
export class GcsBrandAssetStore implements BrandAssetStore {
  readonly #bucket: string;
  readonly #prefix: string;
  readonly #endpoint: string;
  readonly #token: TokenProvider | null;
  readonly #fetch: typeof fetch;

  constructor(options: GcsBrandAssetStoreOptions) {
    if (!options.bucket) throw new Error('A Cloud Storage bucket name is required.');
    this.#bucket = options.bucket;
    this.#prefix = (options.prefix ?? 'brand').replace(/\/+$/, '');
    this.#endpoint = (options.endpoint ?? 'https://storage.googleapis.com').replace(/\/+$/, '');
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  /** The object name. The tenant id is one safe segment: '/' or '..' in it is just text. */
  objectName(tenantId: string, name: string): string {
    checkName(name);
    return `${this.#prefix}/${tenantSegment(tenantId)}/${name}`;
  }

  async #headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return this.#token ? { authorization: `Bearer ${await this.#token()}`, ...extra } : extra;
  }

  async put(tenantId: string, name: string, bytes: Uint8Array): Promise<void> {
    const object = this.objectName(tenantId, name);
    const url =
      `${this.#endpoint}/upload/storage/v1/b/${encodeURIComponent(this.#bucket)}/o` +
      `?uploadType=media&name=${encodeURIComponent(object)}`;
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: await this.#headers({ 'content-type': contentType(name) }),
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`Cloud Storage upload failed (${response.status}) for ${name}.`);
    }
  }

  async get(tenantId: string, name: string): Promise<Uint8Array | null> {
    const object = this.objectName(tenantId, name);
    const url =
      `${this.#endpoint}/storage/v1/b/${encodeURIComponent(this.#bucket)}/o/` +
      `${encodeURIComponent(object)}?alt=media`;
    const response = await this.#fetch(url, {
      headers: await this.#headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Cloud Storage read failed (${response.status}) for ${name}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

/**
 * Where brand assets live. `BRAND_ASSET_STORE=gcs` uses the private bucket
 * `BRAND_ASSET_BUCKET`, authenticated as the runtime service account or
 * `BRAND_GCS_SERVICE_ACCOUNT_JSON`; `STORAGE_EMULATOR_HOST` points it at a
 * local emulator with no auth. Otherwise, local disk.
 */
export function brandAssetStoreFromEnv(dataDir: string, env: NodeJS.ProcessEnv): BrandAssetStore {
  if (env['BRAND_ASSET_STORE'] === 'gcs') {
    const bucket = env['BRAND_ASSET_BUCKET'];
    if (!bucket) throw new Error('BRAND_ASSET_STORE=gcs needs BRAND_ASSET_BUCKET.');
    const emulator = env['STORAGE_EMULATOR_HOST'];
    return new GcsBrandAssetStore({
      bucket,
      ...(emulator ? { endpoint: emulator } : {}),
      token: emulator ? null : googleTokens(env, 'BRAND_GCS_SERVICE_ACCOUNT_JSON', STORAGE_SCOPE),
    });
  }
  return new FileBrandAssetStore(env['BRAND_ASSET_DIR'] ?? join(dataDir, 'brand-assets'));
}
