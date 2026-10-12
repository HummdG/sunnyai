// Disk persistence shared by the live cache (.cache/http) and the recorded fixtures (fixtures/http).
// Layout: <root>/<provider>/<key>.json (metadata) + <key>.bin (raw body), key = sha1(method, url, body, range).
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

/** Metadata stored next to every cached/recorded body. */
export interface StoredMeta {
  schema: 'sunscan.http/1';
  provider: string;
  request: { method: string; url: string; body?: string; range?: [number, number] };
  status: number;
  /** Whitelisted response headers (lower-case names). */
  headers: Record<string, string>;
  /** Final URL after redirects. */
  url: string;
  /** ISO time the response was fetched from the network. */
  fetchedAt: string;
  bytes: number;
}

/** A stored response: metadata + body bytes. */
export interface StoredEntry {
  meta: StoredMeta;
  body: Uint8Array;
}

/**
 * Stable key of a request: sha1 over method, URL (including any `#fragment`, which is never sent but may pin a
 * resource version), body and byte range.
 */
export function requestKey(method: string, url: string, body?: string, range?: [number, number]): string {
  const r = range ? `${range[0]}-${range[1]}` : '';
  return createHash('sha1').update(`${method}\n${url}\n${body ?? ''}\n${r}`).digest('hex');
}

/** File-system safe folder name for a provider id. */
export function providerDir(provider: string): string {
  const p = provider.toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
  return p || 'unknown';
}

/** Paths of the metadata and body files of an entry. */
export function entryPaths(root: string, provider: string, key: string): { json: string; bin: string } {
  const dir = path.join(root, providerDir(provider));
  return { json: path.join(dir, `${key}.json`), bin: path.join(dir, `${key}.bin`) };
}

/** Reads an entry; returns null when it does not exist or is incomplete/corrupt. */
export async function readEntry(root: string, provider: string, key: string): Promise<StoredEntry | null> {
  const p = entryPaths(root, provider, key);
  let metaText: string;
  try {
    metaText = await readFile(p.json, 'utf8');
  } catch {
    return null;
  }
  try {
    const meta = JSON.parse(metaText) as StoredMeta;
    const buf = await readFile(p.bin);
    if (meta.schema !== 'sunscan.http/1' || buf.byteLength !== meta.bytes) return null;
    return { meta, body: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
  } catch {
    return null;
  }
}

async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, data);
  try {
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

/** Writes an entry atomically (body first, then metadata, so a reader never sees metadata without body). */
export async function writeEntry(root: string, provider: string, key: string, entry: StoredEntry): Promise<void> {
  const p = entryPaths(root, provider, key);
  await mkdir(path.dirname(p.json), { recursive: true });
  await atomicWrite(p.bin, entry.body);
  await atomicWrite(p.json, JSON.stringify(entry.meta, null, 1));
}
