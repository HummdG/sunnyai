import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { SunScanError } from './engine.js';
import {
  FINAL_STATUSES,
  type ArtefactStore,
  type AssessmentRecord,
  type AssessmentRepository,
  type AssessmentTarget,
  type JobQueue,
  type RoofAssessmentSummary,
  type SunScanEngine,
  type SunScanService,
} from './types.js';

/**
 * In-process queue. The pipeline is CPU-bound (LiDAR fitting, mesh synthesis)
 * and talks to rate-limited open-data hosts, so it runs one job at a time by
 * default; a deployment that wants more puts Cloud Tasks behind `JobQueue`.
 */
export class InProcessQueue implements JobQueue {
  #running = 0;
  #pending: (() => Promise<void>)[] = [];
  #waiters: (() => void)[] = [];

  constructor(private readonly concurrency = 1) {}

  enqueue(job: () => Promise<void>): void {
    this.#pending.push(job);
    this.#pump();
  }

  idle(): Promise<void> {
    if (this.#running === 0 && this.#pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #pump(): void {
    while (this.#running < this.concurrency && this.#pending.length > 0) {
      const job = this.#pending.shift()!;
      this.#running++;
      void job()
        .catch(() => undefined)
        .finally(() => {
          this.#running--;
          this.#pump();
          if (this.#running === 0 && this.#pending.length === 0) {
            for (const resolve of this.#waiters.splice(0)) resolve();
          }
        });
    }
  }
}

/** Model files on local disk, under `<dir>/<tenant>/<assessment>/<name>`. */
export class FileArtefactStore implements ArtefactStore {
  constructor(private readonly dir: string) {}

  #path(tenantId: string, id: string, name: string): string {
    // Every segment is encoded, so no id or name can climb out of its tenant's folder.
    return join(
      this.dir,
      encodeURIComponent(tenantId),
      encodeURIComponent(id),
      encodeURIComponent(name),
    );
  }

  async put(tenantId: string, id: string, name: string, bytes: Uint8Array): Promise<void> {
    const file = this.#path(tenantId, id, name);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  }

  async get(tenantId: string, id: string, name: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#path(tenantId, id, name)));
    } catch {
      return null;
    }
  }
}

/** Artefacts in memory, for tests. */
export class MemoryArtefactStore implements ArtefactStore {
  #files = new Map<string, Uint8Array>();
  put(tenantId: string, id: string, name: string, bytes: Uint8Array): Promise<void> {
    this.#files.set(JSON.stringify([tenantId, id, name]), bytes);
    return Promise.resolve();
  }
  get(tenantId: string, id: string, name: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.#files.get(JSON.stringify([tenantId, id, name])) ?? null);
  }
}

/** Records in memory, for tests. */
export class MemoryAssessmentRepository implements AssessmentRepository {
  #records = new Map<string, AssessmentRecord>();
  save(record: AssessmentRecord): Promise<void> {
    this.#records.set(`${record.tenantId}\u0000${record.id}`, structuredClone(record));
    return Promise.resolve();
  }
  get(tenantId: string, id: string): Promise<AssessmentRecord | null> {
    const r = this.#records.get(`${tenantId}\u0000${id}`);
    return Promise.resolve(r ? structuredClone(r) : null);
  }
}

export interface ServiceOptions {
  engine: SunScanEngine;
  repository: AssessmentRepository;
  artefacts: ArtefactStore;
  queue?: JobQueue;
  now?: () => Date;
  newId?: () => string;
}

/**
 * Starting, running and reading assessments.
 *
 * Every read is keyed by tenant *and* id, and the tenant always comes from the
 * caller's credential, never from the request body -- an assessment id from
 * another installer is simply not found.
 */
export function createSunScanService(opts: ServiceOptions): SunScanService {
  const queue = opts.queue ?? new InProcessQueue(1);
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? (() => `ss_${randomUUID().replace(/-/g, '').slice(0, 20)}`);
  const { engine, repository, artefacts } = opts;

  async function update(
    record: AssessmentRecord,
    patch: Partial<AssessmentRecord>,
  ): Promise<AssessmentRecord> {
    const next = { ...record, ...patch, updatedAt: now().toISOString() };
    await repository.save(next);
    return next;
  }

  async function run(initial: AssessmentRecord): Promise<void> {
    let record = await update(initial, { status: 'running' });
    try {
      const outcome = await engine.assess(record.target);
      await artefacts.put(
        record.tenantId,
        record.id,
        'spec.json',
        new TextEncoder().encode(outcome.specJson),
      );
      await artefacts.put(record.tenantId, record.id, 'model.glb', outcome.glb);
      record = await update(record, {
        status: outcome.summary.reliable ? 'succeeded' : 'low-confidence',
        summary: outcome.summary,
        artefacts: ['spec.json', 'model.glb'],
      });
    } catch (e) {
      const error =
        e instanceof SunScanError
          ? { code: e.code, message: e.message }
          : { code: 'engine-error' as const, message: (e as Error)?.message ?? String(e) };
      await update(record, { status: 'failed', error });
    }
  }

  return {
    engineVersion: engine.version,

    async startAssessment(tenantId, target: AssessmentTarget, meta = {}) {
      const at = now().toISOString();
      const record: AssessmentRecord = {
        id: newId(),
        tenantId,
        status: 'queued',
        createdAt: at,
        updatedAt: at,
        target: { ...target },
        sessionId: meta.sessionId ?? null,
        summary: null,
        error: null,
        artefacts: [],
        engine: engine.version,
      };
      await repository.save(record);
      queue.enqueue(() => run(record));
      return record;
    },

    getAssessment: (tenantId, id) => repository.get(tenantId, id),

    async getArtefact(tenantId, id, name) {
      const record = await repository.get(tenantId, id);
      if (!record || !record.artefacts.includes(name)) return null;
      return artefacts.get(tenantId, id, name);
    },

    async waitFor(tenantId, id, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const record = await repository.get(tenantId, id);
        if (!record || FINAL_STATUSES.includes(record.status) || Date.now() >= deadline)
          return record;
        await new Promise((r) => setTimeout(r, Math.min(250, Math.max(10, deadline - Date.now()))));
      }
    },

    idle: () => queue.idle(),
  };
}

/**
 * The stable hand-off for downstream consumers (the quote journey): a finished
 * assessment's summary with its id and status, or null while it is still
 * running or when it failed.
 */
export function toRoofAssessmentSummary(record: AssessmentRecord): RoofAssessmentSummary | null {
  if (!record.summary || (record.status !== 'succeeded' && record.status !== 'low-confidence')) {
    return null;
  }
  return { ...record.summary, assessmentId: record.id, status: record.status };
}
