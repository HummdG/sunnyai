import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Firestore } from '@google-cloud/firestore';

import type { KnowledgeConnection } from '@sunny/contracts';

/**
 * What the knowledge sync keeps between runs: the connections an installer has
 * made (their website, a Drive folder) with each one's sync cursor, and the
 * embedding cache.
 *
 * Kept beside the main `Store` rather than inside it, so the knowledge pipeline
 * can grow without every other workstream's store changes colliding with it.
 * Same two backends, same tenant scoping: every read and write names a tenant,
 * and in Firestore the tenant is a path segment.
 */

export interface KnowledgeConnectionRecord extends KnowledgeConnection {
  /** Page cap for a website crawl. */
  maxPages?: number;
  /**
   * The Drive `changes.list` cursor and the folder tree it applies to, so an
   * incremental sync can tell which changes are inside the connected folder.
   */
  cursor?: { pageToken: string; folderIds: string[] } | null;
  /**
   * An OAuth refresh token, for `oauth` Drive connections. Server-side only: it
   * is stripped from every API response (`publicConnection`). Production should
   * move it to Secret Manager and keep only a reference here (plan §4).
   */
  refreshToken?: string | null;
  /** When the current sync started; the lock that stops two running at once. */
  syncStartedAt?: string;
}

export function publicConnection(record: KnowledgeConnectionRecord): KnowledgeConnection {
  const { maxPages: _m, cursor: _c, refreshToken: _r, syncStartedAt: _s, ...rest } = record;
  return rest;
}

export interface KnowledgeSyncStore {
  listConnections(tenantId: string): Promise<KnowledgeConnectionRecord[]>;
  /** Every tenant's connections: what the scheduler walks. */
  listAllConnections(): Promise<KnowledgeConnectionRecord[]>;
  getConnection(tenantId: string, id: string): Promise<KnowledgeConnectionRecord | null>;
  putConnection(record: KnowledgeConnectionRecord): Promise<KnowledgeConnectionRecord>;
  deleteConnection(tenantId: string, id: string): Promise<boolean>;
  /** Cached passage embeddings by content key, for one tenant and model. */
  getEmbeddings(
    tenantId: string,
    model: string,
    keys: readonly string[],
  ): Promise<Map<string, number[]>>;
  putEmbeddings(
    tenantId: string,
    model: string,
    entries: readonly { key: string; vector: number[] }[],
  ): Promise<void>;
}

// ─── in memory (tests) ───────────────────────────────────────────────────────

export class MemoryKnowledgeSyncStore implements KnowledgeSyncStore {
  protected connections = new Map<string, KnowledgeConnectionRecord[]>();
  protected embeddings = new Map<string, Map<string, number[]>>();

  listConnections(tenantId: string): Promise<KnowledgeConnectionRecord[]> {
    return Promise.resolve((this.connections.get(tenantId) ?? []).map((c) => structuredClone(c)));
  }
  listAllConnections(): Promise<KnowledgeConnectionRecord[]> {
    return Promise.resolve([...this.connections.values()].flat().map((c) => structuredClone(c)));
  }
  getConnection(tenantId: string, id: string): Promise<KnowledgeConnectionRecord | null> {
    const found = (this.connections.get(tenantId) ?? []).find((c) => c.id === id);
    return Promise.resolve(found ? structuredClone(found) : null);
  }
  async putConnection(record: KnowledgeConnectionRecord) {
    const list = this.connections.get(record.tenantId) ?? [];
    const at = list.findIndex((c) => c.id === record.id);
    const copy = structuredClone(record);
    if (at === -1) list.push(copy);
    else list[at] = copy;
    this.connections.set(record.tenantId, list);
    await this.persist(record.tenantId);
    return structuredClone(record);
  }
  async deleteConnection(tenantId: string, id: string) {
    const list = this.connections.get(tenantId) ?? [];
    const next = list.filter((c) => c.id !== id);
    this.connections.set(tenantId, next);
    await this.persist(tenantId);
    return next.length !== list.length;
  }
  async getEmbeddings(tenantId: string, model: string, keys: readonly string[]) {
    const bucket = await this.bucket(tenantId, model);
    const out = new Map<string, number[]>();
    for (const key of keys) {
      const v = bucket.get(key);
      if (v) out.set(key, v);
    }
    return out;
  }
  async putEmbeddings(
    tenantId: string,
    model: string,
    entries: readonly { key: string; vector: number[] }[],
  ) {
    const bucket = await this.bucket(tenantId, model);
    for (const { key, vector } of entries) bucket.set(key, vector);
    await this.persistEmbeddings(tenantId, model);
  }
  protected bucket(tenantId: string, model: string): Promise<Map<string, number[]>> {
    const id = `${tenantId}\u0000${model}`;
    let bucket = this.embeddings.get(id);
    if (!bucket) {
      bucket = new Map();
      this.embeddings.set(id, bucket);
    }
    return Promise.resolve(bucket);
  }
  /** Where a subclass writes connections through; memory keeps them only in the maps. */
  protected persist(_tenantId: string): Promise<void> {
    return Promise.resolve();
  }
  protected persistEmbeddings(_tenantId: string, _model: string): Promise<void> {
    return Promise.resolve();
  }
}

// ─── files (development) ─────────────────────────────────────────────────────

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value), 'utf8');
  await rename(temp, file);
}

export class FileKnowledgeSyncStore extends MemoryKnowledgeSyncStore {
  readonly #dir: string;
  #loaded: Promise<void> | null = null;
  readonly #loadedBuckets = new Set<string>();

  constructor(dataDir: string) {
    super();
    this.#dir = join(dataDir, 'knowledge-sync');
  }

  #connectionsFile(): string {
    return join(this.#dir, 'connections.json');
  }

  #embeddingFile(tenantId: string, model: string): string {
    return join(
      this.#dir,
      'embeddings',
      `${encodeURIComponent(tenantId)}.${encodeURIComponent(model)}.json`,
    );
  }

  async #load(): Promise<void> {
    this.#loaded ??= (async () => {
      const rows = await readJson<KnowledgeConnectionRecord[]>(this.#connectionsFile(), []);
      for (const row of rows) {
        const list = this.connections.get(row.tenantId) ?? [];
        list.push(row);
        this.connections.set(row.tenantId, list);
      }
    })();
    return this.#loaded;
  }

  override async listConnections(tenantId: string) {
    await this.#load();
    return super.listConnections(tenantId);
  }
  override async listAllConnections() {
    await this.#load();
    return super.listAllConnections();
  }
  override async getConnection(tenantId: string, id: string) {
    await this.#load();
    return super.getConnection(tenantId, id);
  }
  override async putConnection(record: KnowledgeConnectionRecord) {
    await this.#load();
    return super.putConnection(record);
  }
  override async deleteConnection(tenantId: string, id: string) {
    await this.#load();
    return super.deleteConnection(tenantId, id);
  }

  protected override async persist(): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    await writeJson(this.#connectionsFile(), [...this.connections.values()].flat());
  }

  protected override async bucket(tenantId: string, model: string): Promise<Map<string, number[]>> {
    const bucket = await super.bucket(tenantId, model);
    const id = `${tenantId}\u0000${model}`;
    if (!this.#loadedBuckets.has(id)) {
      this.#loadedBuckets.add(id);
      const rows = await readJson<Record<string, number[]>>(
        this.#embeddingFile(tenantId, model),
        {},
      );
      for (const [key, vector] of Object.entries(rows))
        if (!bucket.has(key)) bucket.set(key, vector);
    }
    return bucket;
  }

  protected override async persistEmbeddings(tenantId: string, model: string): Promise<void> {
    const bucket = await this.bucket(tenantId, model);
    await mkdir(join(this.#dir, 'embeddings'), { recursive: true });
    await writeJson(this.#embeddingFile(tenantId, model), Object.fromEntries(bucket));
  }
}

// ─── Firestore (production) ──────────────────────────────────────────────────

export class FirestoreKnowledgeSyncStore implements KnowledgeSyncStore {
  readonly #db: Firestore;

  constructor(options: { project: string; databaseId?: string; emulatorHost?: string | null }) {
    this.#db = new Firestore({
      projectId: options.project,
      databaseId: options.databaseId ?? '(default)',
      ...(options.emulatorHost ? { host: options.emulatorHost, ssl: false } : {}),
      ignoreUndefinedProperties: true,
    });
  }

  #tenant(tenantId: string) {
    return this.#db.collection('tenants').doc(encodeURIComponent(tenantId));
  }

  async listConnections(tenantId: string): Promise<KnowledgeConnectionRecord[]> {
    const snap = await this.#tenant(tenantId).collection('knowledge_connections').get();
    return snap.docs
      .map((d) => d.data() as KnowledgeConnectionRecord)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listAllConnections(): Promise<KnowledgeConnectionRecord[]> {
    const snap = await this.#db.collectionGroup('knowledge_connections').get();
    return snap.docs.map((d) => d.data() as KnowledgeConnectionRecord);
  }

  async getConnection(tenantId: string, id: string): Promise<KnowledgeConnectionRecord | null> {
    const snap = await this.#tenant(tenantId)
      .collection('knowledge_connections')
      .doc(`c_${encodeURIComponent(id)}`)
      .get();
    return snap.exists ? (snap.data() as KnowledgeConnectionRecord) : null;
  }

  async putConnection(record: KnowledgeConnectionRecord): Promise<KnowledgeConnectionRecord> {
    await this.#tenant(record.tenantId)
      .collection('knowledge_connections')
      .doc(`c_${encodeURIComponent(record.id)}`)
      .set({ ...record });
    return record;
  }

  async deleteConnection(tenantId: string, id: string): Promise<boolean> {
    const ref = this.#tenant(tenantId)
      .collection('knowledge_connections')
      .doc(`c_${encodeURIComponent(id)}`);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }

  #embeddingRef(tenantId: string, model: string, key: string) {
    return this.#tenant(tenantId)
      .collection('knowledge_embeddings')
      .doc(`e_${encodeURIComponent(model)}_${key}`);
  }

  async getEmbeddings(
    tenantId: string,
    model: string,
    keys: readonly string[],
  ): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    for (let i = 0; i < keys.length; i += 300) {
      const refs = keys.slice(i, i + 300).map((key) => this.#embeddingRef(tenantId, model, key));
      if (refs.length === 0) continue;
      const snaps = await this.#db.getAll(...refs);
      snaps.forEach((snap, j) => {
        if (snap.exists) out.set(keys[i + j]!, (snap.data() as { vector: number[] }).vector);
      });
    }
    return out;
  }

  async putEmbeddings(
    tenantId: string,
    model: string,
    entries: readonly { key: string; vector: number[] }[],
  ): Promise<void> {
    for (let i = 0; i < entries.length; i += 400) {
      const batch = this.#db.batch();
      for (const { key, vector } of entries.slice(i, i + 400)) {
        batch.set(this.#embeddingRef(tenantId, model, key), { vector, model });
      }
      await batch.commit();
    }
  }
}
