import type { ArtefactStore } from '@sunny/sunscan-adapter';

import type { TokenProvider } from '../google/auth.js';

/**
 * SunScan model files in a private Cloud Storage bucket (Cloud Run's disk is
 * ephemeral). Objects are keyed `<prefix>/<tenant>/<assessment>/<name>` with
 * every segment percent-encoded, so no id can reach another tenant's objects.
 * Nothing is ever made public: the API reads the bytes and serves them through
 * its own tenant-scoped routes.
 *
 * Uses the GCS JSON API over fetch (simple media upload, `alt=media` reads).
 * `endpoint` points at a local fake in tests; `token` is null for an emulator
 * that needs no auth.
 */
export interface GcsArtefactStoreOptions {
  bucket: string;
  prefix?: string;
  endpoint?: string;
  token: TokenProvider | null;
  fetch?: typeof fetch;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  'model.glb': 'model/gltf-binary',
  'spec.json': 'application/json',
};

export class GcsArtefactStore implements ArtefactStore {
  readonly #bucket: string;
  readonly #prefix: string;
  readonly #endpoint: string;
  readonly #token: TokenProvider | null;
  readonly #fetch: typeof fetch;

  constructor(options: GcsArtefactStoreOptions) {
    if (!options.bucket) throw new Error('A Cloud Storage bucket name is required.');
    this.#bucket = options.bucket;
    this.#prefix = (options.prefix ?? 'sunscan').replace(/\/+$/, '');
    this.#endpoint = (options.endpoint ?? 'https://storage.googleapis.com').replace(/\/+$/, '');
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  /** The object name. Encoded per segment: '/' or '..' in an id is just text. */
  objectName(tenantId: string, assessmentId: string, name: string): string {
    return [this.#prefix, tenantId, assessmentId, name]
      .map((segment, i) => (i === 0 ? segment : encodeURIComponent(segment)))
      .join('/');
  }

  async #headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return this.#token ? { authorization: `Bearer ${await this.#token()}`, ...extra } : extra;
  }

  async put(
    tenantId: string,
    assessmentId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const object = this.objectName(tenantId, assessmentId, name);
    const url =
      `${this.#endpoint}/upload/storage/v1/b/${encodeURIComponent(this.#bucket)}/o` +
      `?uploadType=media&name=${encodeURIComponent(object)}`;
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: await this.#headers({
        'content-type': CONTENT_TYPES[name] ?? 'application/octet-stream',
      }),
      // A copy backed by a plain ArrayBuffer, which is what fetch's BodyInit accepts.
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`Cloud Storage upload failed (${response.status}) for ${name}.`);
    }
  }

  async get(tenantId: string, assessmentId: string, name: string): Promise<Uint8Array | null> {
    const object = this.objectName(tenantId, assessmentId, name);
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
