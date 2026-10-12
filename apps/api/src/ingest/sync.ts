import type { IngestionJob, KnowledgeConnectionRequest, KnowledgeIssue } from '@sunny/contracts';
import { chunkDocuments, type KnowledgeChunk } from '@sunny/knowledge';

import { newId, type KnowledgeSourceRecord, type Store } from '../store.js';
import { crawlSite } from './crawler.js';
import { driveLink, FOLDER_MIME, type DriveClient, type DriveFile } from './drive.js';
import type { Embedder } from './embeddings.js';
import type { Fetcher } from './fetcher.js';
import { prepareDocument, sha256 } from './prepare.js';
import type { KnowledgeConnectionRecord, KnowledgeSyncStore } from './sync-store.js';

/**
 * Keeping an installer's knowledge base in step with their website and their
 * Drive folder (Blueprint §3.1: "anything added or updated in that Drive folder
 * … is automatically synced").
 *
 * One sync is one job. A job is written `queued`, then `running`, then
 * `succeeded` or `failed`, and its counts say what happened: how many pages or
 * files were looked at, written, unchanged, deleted, quarantined for personal
 * data, skipped (a PDF that cannot be read yet), or failed to fetch.
 *
 * Every write goes through the same `prepareDocument` the upload route uses, so
 * a crawled page and an uploaded file are held to one standard.
 */

export interface KnowledgeSyncDeps {
  store: Store;
  syncStore: KnowledgeSyncStore;
  now: () => number;
  /** Fetches web pages. The network one is SSRF-guarded; tests pass a fake. */
  fetcher: Fetcher;
  /** A Drive client for a connection, or a reason it cannot be made. */
  driveClient: (connection: KnowledgeConnectionRecord) => DriveClient | { error: string };
  embedder: Embedder | null;
  /** Most embeddings computed in one sync, as a cost ceiling. */
  maxEmbeddingsPerSync?: number;
}

/** How long a website is trusted before it is crawled again (Blueprint: weekly). */
export const WEBSITE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** How often a Drive folder is polled for changes (`changes.list` is cheap). */
export const DRIVE_INTERVAL_MS = 15 * 60 * 1000;
/** A sync that has been "syncing" this long is assumed dead and may be retried. */
const STALE_LOCK_MS = 2 * 60 * 60 * 1000;
const MAX_ISSUES = 40;

interface Counts {
  seen: number;
  unchanged: number;
  deleted: number;
  quarantined: number;
  skipped: number;
  failed: number;
}

class JobRun {
  readonly issues: KnowledgeIssue[] = [];
  readonly counts: Counts = {
    seen: 0,
    unchanged: 0,
    deleted: 0,
    quarantined: 0,
    skipped: 0,
    failed: 0,
  };
  documents = 0;
  chunks = 0;
  #dropped = 0;
  /** Where the run has got to, for the installer's progress bar. */
  progress: { phase: 'reading' | 'indexing'; done: number; total: number | null } = {
    phase: 'reading',
    done: 0,
    total: null,
  };
  /** Saves the running job (throttled by the caller); set by the job runner. */
  report: () => Promise<void> = () => Promise.resolve();

  /** Start the indexing phase once the number of items is known. */
  async indexing(total: number): Promise<void> {
    this.progress = { phase: 'indexing', done: 0, total };
    await this.report();
  }

  /** One more item indexed. */
  async step(): Promise<void> {
    this.progress = { ...this.progress, done: this.progress.done + 1 };
    await this.report();
  }

  issue(issue: KnowledgeIssue): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push(issue);
    else this.#dropped += 1;
  }

  finalIssues(): KnowledgeIssue[] {
    return this.#dropped === 0
      ? this.issues
      : [
          ...this.issues,
          {
            code: 'fetch-failed',
            severity: 'warning',
            message: `${this.#dropped} further issue(s) not listed.`,
            detail: null,
          },
        ];
  }
}

function sourceIdFor(connectionId: string, key: string): string {
  return `${connectionId}_${sha256(key).slice(0, 16)}`;
}

/** The content key a passage's embedding is cached under. */
export function embeddingKey(model: string, chunk: KnowledgeChunk): string {
  return sha256(`${model}\u0000${chunk.title}\u0000${chunk.heading ?? ''}\u0000${chunk.text}`);
}

export function createKnowledgeSync(deps: KnowledgeSyncDeps) {
  const { store, syncStore, now } = deps;
  const iso = () => new Date(now()).toISOString();

  async function businessDomains(tenantId: string, extra?: string): Promise<string[]> {
    const connections = await syncStore.listConnections(tenantId);
    const hosts = connections
      .filter((c) => c.kind === 'website')
      .map((c) => {
        try {
          return new URL(c.target).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      });
    if (extra) hosts.push(extra.replace(/^www\./, ''));
    return [...new Set(hosts.filter(Boolean))];
  }

  async function saveJob(job: IngestionJob): Promise<IngestionJob> {
    await store.saveIngestionJob(job);
    return job;
  }

  /**
   * Write one document through the shared checks. Returns what happened to it,
   * and records issues on the run.
   */
  async function writeDocument(
    run: JobRun,
    connection: KnowledgeConnectionRecord,
    existing: Map<string, KnowledgeSourceRecord>,
    doc: {
      id: string;
      title: string;
      url: string;
      version: string;
      text: string;
      domains: string[];
    },
  ): Promise<'written' | 'unchanged' | 'quarantined' | 'empty'> {
    const prepared = prepareDocument(doc.text, {
      id: doc.id,
      title: doc.title,
      url: doc.url,
      version: doc.version,
      businessDomains: doc.domains,
    });
    const before = existing.get(doc.id);
    if (prepared.verdict !== 'index') {
      for (const issue of prepared.issues)
        run.issue({ ...issue, detail: `${issue.detail ?? ''} (${doc.url})`.trim() });
      // A page that now holds personal data, or is now empty, stops being quotable.
      if (before) await store.deleteKnowledgeSource(connection.tenantId, doc.id);
      return prepared.verdict === 'quarantine' ? 'quarantined' : 'empty';
    }
    for (const issue of prepared.issues) {
      if (issue.code !== 'empty-section') run.issue(issue);
    }
    if (before && before.contentHash === prepared.contentHash && before.title === doc.title) {
      return 'unchanged';
    }
    const at = iso();
    await store.putKnowledgeSource({
      id: doc.id,
      tenantId: connection.tenantId,
      title: doc.title,
      url: doc.url,
      version: doc.version,
      text: prepared.text,
      createdAt: before?.createdAt ?? at,
      updatedAt: at,
      kind: connection.kind,
      connectionId: connection.id,
      contentHash: prepared.contentHash,
      warnings: prepared.warnings,
    });
    run.documents += 1;
    run.chunks += prepared.chunks;
    return 'written';
  }

  async function existingFor(
    connection: KnowledgeConnectionRecord,
  ): Promise<Map<string, KnowledgeSourceRecord>> {
    const all = await store.listKnowledgeSources(connection.tenantId);
    return new Map(all.filter((s) => s.connectionId === connection.id).map((s) => [s.id, s]));
  }

  // ─── website ───────────────────────────────────────────────────────────────

  async function syncWebsite(connection: KnowledgeConnectionRecord, run: JobRun): Promise<void> {
    const crawl = await crawlSite({
      startUrl: connection.target,
      fetcher: deps.fetcher,
      maxPages: connection.maxPages ?? 200,
    });
    if (crawl.pages.length === 0) {
      throw new Error(
        crawl.failed[0]
          ? `The site could not be read: ${crawl.failed[0].reason} (${crawl.failed[0].url}).`
          : 'No readable pages were found on the site.',
      );
    }
    const host = new URL(connection.target).hostname;
    const domains = await businessDomains(connection.tenantId, host);
    const existing = await existingFor(connection);
    const seen = new Set<string>();
    const version = iso().slice(0, 10);
    await run.indexing(crawl.pages.length);

    for (const page of crawl.pages) {
      run.counts.seen += 1;
      await run.step();
      const id = sourceIdFor(connection.id, page.url);
      seen.add(id);
      const outcome = await writeDocument(run, connection, existing, {
        id,
        title: page.title,
        url: page.url,
        // The crawl date: a page has no revision of its own, and the date is what
        // tells an installer how fresh a quoted passage is. An unchanged page is
        // not rewritten, so it keeps the date it last changed.
        version,
        text: page.markdown,
        domains,
      });
      if (outcome === 'unchanged') run.counts.unchanged += 1;
      if (outcome === 'quarantined') run.counts.quarantined += 1;
      if (outcome === 'empty') run.counts.skipped += 1;
    }

    for (const skipped of crawl.skipped) {
      run.counts.skipped += 1;
      run.issue({
        code: skipped.needsExtraction ? 'needs-extraction' : 'unsupported-type',
        severity: 'warning',
        message: skipped.reason,
        detail: skipped.url,
      });
    }
    for (const failed of crawl.failed) {
      run.counts.failed += 1;
      run.issue({
        code: 'fetch-failed',
        severity: 'warning',
        message: failed.reason,
        detail: failed.url,
      });
    }
    if (crawl.disallowed.length > 0) {
      run.issue({
        code: 'robots-disallowed',
        severity: 'warning',
        message: `${crawl.disallowed.length} page(s) were not read because the site's robots.txt asks crawlers not to.`,
        detail: crawl.disallowed.slice(0, 5).join(', '),
      });
    }

    // Pages that have gone from the site go from the index -- but only when the
    // crawl saw the whole site. A crawl cut short by the page cap, or one where
    // pages failed to load, has not proven anything is gone.
    if (!crawl.truncated && crawl.failed.length === 0) {
      for (const id of existing.keys()) {
        if (!seen.has(id)) {
          await store.deleteKnowledgeSource(connection.tenantId, id);
          run.counts.deleted += 1;
        }
      }
    }
  }

  // ─── Drive ─────────────────────────────────────────────────────────────────

  async function writeDriveFile(
    run: JobRun,
    connection: KnowledgeConnectionRecord,
    client: DriveClient,
    existing: Map<string, KnowledgeSourceRecord>,
    file: DriveFile,
    domains: string[],
  ): Promise<void> {
    run.counts.seen += 1;
    const id = sourceIdFor(connection.id, file.id);
    const version = file.version ?? file.modifiedTime;
    const before = existing.get(id);
    // Unchanged in Drive: skip the export call entirely.
    if (before && before.version === version) {
      run.counts.unchanged += 1;
      return;
    }
    const content = await client.read(file);
    if (content.kind !== 'text') {
      run.counts.skipped += 1;
      run.issue({
        code: content.kind === 'needs-extraction' ? 'needs-extraction' : 'unsupported-type',
        severity: 'warning',
        message: `"${file.name}" was skipped.`,
        detail: content.reason,
      });
      if (before) {
        await store.deleteKnowledgeSource(connection.tenantId, id);
        run.counts.deleted += 1;
      }
      return;
    }
    const outcome = await writeDocument(run, connection, existing, {
      id,
      title: file.name,
      url: driveLink(file),
      version,
      text: content.markdown,
      domains,
    });
    if (outcome === 'unchanged') run.counts.unchanged += 1;
    if (outcome === 'quarantined') run.counts.quarantined += 1;
    if (outcome === 'empty') run.counts.skipped += 1;
  }

  async function syncDrive(
    connection: KnowledgeConnectionRecord,
    run: JobRun,
    full: boolean,
  ): Promise<KnowledgeConnectionRecord['cursor']> {
    const made = deps.driveClient(connection);
    if ('error' in made) throw new Error(made.error);
    const client = made;
    const domains = await businessDomains(connection.tenantId);
    const existing = await existingFor(connection);

    if (full || !connection.cursor) {
      // Take the cursor *before* listing, so a change made during the listing is
      // seen again by the next incremental sync rather than lost.
      const pageToken = await client.startPageToken();
      const { files, folderIds } = await client.listFolder(connection.target);
      const live = new Set<string>();
      await run.indexing(files.length);
      for (const file of files) {
        await run.step();
        live.add(sourceIdFor(connection.id, file.id));
        await writeDriveFile(run, connection, client, existing, file, domains);
      }
      for (const id of existing.keys()) {
        if (!live.has(id)) {
          await store.deleteKnowledgeSource(connection.tenantId, id);
          run.counts.deleted += 1;
        }
      }
      return { pageToken, folderIds };
    }

    const { changes, newStartPageToken } = await client.changes(connection.cursor.pageToken);
    const folders = new Set(connection.cursor.folderIds);
    for (const change of changes) {
      const id = sourceIdFor(connection.id, change.fileId);
      const known = existing.has(id);
      const inside = change.file?.parents?.some((p) => folders.has(p)) ?? false;
      if (!known && !inside) continue;
      if (change.file?.mimeType === FOLDER_MIME) {
        // The folder tree changed; the cheapest correct answer is a full listing.
        return syncDrive(connection, run, true);
      }
      if (change.removed || change.file?.trashed || (known && !inside && change.file)) {
        if (known) {
          await store.deleteKnowledgeSource(connection.tenantId, id);
          existing.delete(id);
          run.counts.deleted += 1;
        }
        continue;
      }
      if (change.file)
        await writeDriveFile(run, connection, client, existing, change.file, domains);
    }
    return { pageToken: newStartPageToken, folderIds: [...folders] };
  }

  // ─── embeddings ────────────────────────────────────────────────────────────

  /** Embed any passages of this tenant that have no cached vector yet. */
  async function embedTenant(tenantId: string, run?: JobRun): Promise<number> {
    const embedder = deps.embedder;
    if (!embedder) return 0;
    const sources = await store.listKnowledgeSources(tenantId);
    const chunks = chunkDocuments(
      sources.map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        version: s.version,
        text: s.text,
      })),
    );
    const keyed = chunks.map((chunk) => ({ chunk, key: embeddingKey(embedder.model, chunk) }));
    const cached = await syncStore.getEmbeddings(
      tenantId,
      embedder.model,
      keyed.map((k) => k.key),
    );
    const missing = keyed
      .filter((k) => !cached.has(k.key))
      .slice(0, deps.maxEmbeddingsPerSync ?? 2000);
    if (missing.length === 0) return 0;
    try {
      const vectors = await embedder.embedDocuments(
        missing.map(({ chunk }) => ({
          title: chunk.title,
          text: chunk.heading ? `${chunk.heading}\n\n${chunk.text}` : chunk.text,
        })),
      );
      await syncStore.putEmbeddings(
        tenantId,
        embedder.model,
        missing.map((m, i) => ({ key: m.key, vector: vectors[i]! })),
      );
      return missing.length;
    } catch (error) {
      run?.issue({
        code: 'fetch-failed',
        severity: 'warning',
        message:
          'Semantic search could not be updated this run; keyword search still covers every page.',
        detail: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  // ─── running a sync ────────────────────────────────────────────────────────

  /**
   * Start a sync and return its queued job at once. `done` resolves with the
   * finished job; routes return the queued one and the caller polls.
   */
  async function sync(
    tenantId: string,
    connectionId: string,
    options: { full?: boolean } = {},
  ): Promise<{ job: IngestionJob; done: Promise<IngestionJob> } | null> {
    const connection = await syncStore.getConnection(tenantId, connectionId);
    if (!connection) return null;

    const startedAt = iso();
    const queued = await saveJob({
      id: newId('job'),
      tenantId,
      sourceId: null,
      status: 'queued',
      documents: 0,
      chunks: 0,
      issues: [],
      startedAt,
      finishedAt: '',
      kind: connection.kind,
      connectionId: connection.id,
    });
    await syncStore.putConnection({
      ...connection,
      status: 'syncing',
      lastJobId: queued.id,
      syncStartedAt: startedAt,
    });

    const done = (async (): Promise<IngestionJob> => {
      const run = new JobRun();
      // Progress is saved at most twice a second, and always at a phase change.
      let lastSaved = 0;
      let lastPhase = run.progress.phase;
      run.report = async () => {
        const at = Date.now();
        if (at - lastSaved < 500 && run.progress.phase === lastPhase) return;
        lastSaved = at;
        lastPhase = run.progress.phase;
        await saveJob({
          ...queued,
          status: 'running',
          counts: { ...run.counts },
          progress: { ...run.progress },
        });
      };
      await saveJob({ ...queued, status: 'running', progress: { ...run.progress } });
      let cursor = connection.cursor ?? null;
      let error: string | null = null;
      try {
        if (connection.kind === 'website') await syncWebsite(connection, run);
        else cursor = (await syncDrive(connection, run, options.full ?? false)) ?? null;
        await embedTenant(tenantId, run);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        run.issue({
          code: 'fetch-failed',
          severity: 'error',
          message: 'The sync failed.',
          detail: error,
        });
      }
      const finished: IngestionJob = {
        ...queued,
        status: error ? 'failed' : 'succeeded',
        documents: run.documents,
        chunks: run.chunks,
        issues: run.finalIssues(),
        finishedAt: iso(),
        counts: run.counts,
      };
      await saveJob(finished);
      const latest = (await syncStore.getConnection(tenantId, connectionId)) ?? connection;
      await syncStore.putConnection({
        ...latest,
        status: error ? 'failed' : 'connected',
        lastError: error,
        lastJobId: finished.id,
        lastSyncAt: finished.finishedAt,
        cursor,
      });
      return finished;
    })();

    return { job: queued, done };
  }

  /** Create (or replace) a connection and start its first sync. */
  async function connect(request: KnowledgeConnectionRequest): Promise<{
    connection: KnowledgeConnectionRecord;
    job: IngestionJob;
    done: Promise<IngestionJob>;
  }> {
    const existing = await syncStore.listConnections(request.tenantId);
    const target =
      request.kind === 'website'
        ? new URL(request.url).origin + new URL(request.url).pathname
        : request.folderId;
    const same = existing.find((c) => c.kind === request.kind && c.target === target);
    const record: KnowledgeConnectionRecord = {
      id: same?.id ?? newId('kc'),
      tenantId: request.tenantId,
      kind: request.kind,
      target,
      mode: request.kind === 'website' ? 'crawl' : request.mode,
      status: 'pending',
      lastError: null,
      lastJobId: same?.lastJobId ?? null,
      lastSyncAt: same?.lastSyncAt ?? null,
      createdAt: same?.createdAt ?? iso(),
      ...(request.kind === 'website' && request.maxPages ? { maxPages: request.maxPages } : {}),
      ...(request.kind === 'drive' && request.refreshToken
        ? { refreshToken: request.refreshToken }
        : {}),
      cursor: same?.cursor ?? null,
    };
    await syncStore.putConnection(record);
    const started = await sync(record.tenantId, record.id, { full: true });
    if (!started) throw new Error('The connection could not be read back after it was saved.');
    return {
      connection: (await syncStore.getConnection(record.tenantId, record.id)) ?? record,
      ...started,
    };
  }

  /** Remove a connection and everything it brought into the index. */
  async function disconnect(tenantId: string, connectionId: string): Promise<number> {
    const connection = await syncStore.getConnection(tenantId, connectionId);
    if (!connection) return -1;
    const existing = await existingFor(connection);
    for (const id of existing.keys()) await store.deleteKnowledgeSource(tenantId, id);
    await syncStore.deleteConnection(tenantId, connectionId);
    return existing.size;
  }

  /** Run every sync that is due. What Cloud Scheduler calls (via the route). */
  async function runDue(): Promise<IngestionJob[]> {
    const finished: IngestionJob[] = [];
    for (const connection of await syncStore.listAllConnections()) {
      const last = connection.lastSyncAt ? Date.parse(connection.lastSyncAt) : 0;
      const interval = connection.kind === 'website' ? WEBSITE_INTERVAL_MS : DRIVE_INTERVAL_MS;
      if (now() - last < interval) continue;
      const started = connection.syncStartedAt ? Date.parse(connection.syncStartedAt) : 0;
      if (connection.status === 'syncing' && now() - started < STALE_LOCK_MS) continue;
      const run = await sync(connection.tenantId, connection.id);
      if (run) finished.push(await run.done);
    }
    return finished;
  }

  return { connect, sync, disconnect, runDue, embedTenant };
}

export type KnowledgeSync = ReturnType<typeof createKnowledgeSync>;
