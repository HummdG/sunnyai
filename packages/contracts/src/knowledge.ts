import { z } from 'zod';

/**
 * Onboarding an installer's own documents, and the job that ingests them.
 *
 * Two shapes here are worth stating plainly because they are where the honesty
 * of this surface lives:
 *
 *   - **A source is the installer's document, and nothing else.** The fields are
 *     the document's own text and where it came from. There is no field for a
 *     URL to crawl, because this deployment does not fetch one: a source whose
 *     only content is a link would be an index over nothing, and "we will read it
 *     later" is how a retrieval layer ends up answering from an empty index.
 *     A caller that has a page's text sends the text and the URL it came from,
 *     and the citation is the URL.
 *   - **A version is required, not defaulted.** A warranty term without the
 *     revision it was read from cannot be checked against the one a visitor is
 *     sent, so the caller says which version this text is, exactly as the
 *     catalogue upload makes a price carry its source. The route does not
 *     invent "1.0" on the caller's behalf.
 */

export const KNOWLEDGE_ISSUE_CODES = [
  /** The document contained no text this index can use. */
  'empty-document',
  /** A heading with nothing under it: kept as a warning, not a failure. */
  'empty-section',
  /** Not indexed: the document appears to hold someone's personal data. */
  'quarantined-pii',
  /** Indexed with low-risk personal details (a private email, a mobile) masked. */
  'pii-redacted',
  /** Unfilled template text ("XXXXX XXXXXX", "[insert link]"): masked, never quoted. */
  'placeholder',
  /** A file whose text could not be read here (e.g. a PDF): skipped, not guessed at. */
  'needs-extraction',
  /** A page or file that could not be fetched this run. */
  'fetch-failed',
  /** A page the site's robots.txt asks crawlers not to read. */
  'robots-disallowed',
  /** A file type this pipeline does not read (images, spreadsheets, archives). */
  'unsupported-type',
] as const;

export type KnowledgeIssueCode = (typeof KNOWLEDGE_ISSUE_CODES)[number];

export const knowledgeIssueSchema = z.object({
  code: z.enum(KNOWLEDGE_ISSUE_CODES),
  severity: z.enum(['warning', 'error']),
  message: z.string(),
  detail: z.string().nullable(),
});

export type KnowledgeIssue = z.infer<typeof knowledgeIssueSchema>;

/**
 * What an installer posts to onboard or replace one document.
 *
 * `sourceId` absent means "this is a new source"; present means "replace that
 * source". An explicit id rather than matching on title, because two documents
 * may legitimately share a title -- a warranty for two product ranges -- and a
 * re-upload that silently overwrote the other one would be a deletion nobody
 * asked for.
 */
export const knowledgeSourceRequestSchema = z.object({
  tenantId: z.string().min(1).max(120),
  sourceId: z.string().min(1).max(120).optional(),
  title: z.string().min(1).max(200),
  /** Where the text came from, when it came from somewhere. Shown in citations. */
  url: z.string().max(2048).nullable().optional(),
  version: z.string().min(1).max(80),
  /**
   * The document's text. Capped at 2 MB, which is far above any policy page,
   * warranty or service-area list and still small enough that a single request
   * cannot be used to fill the disk.
   */
  text: z.string().min(1).max(2_000_000),
});

export type KnowledgeSourceRequest = z.infer<typeof knowledgeSourceRequestSchema>;

/**
 * A stored source, as the API reports it.
 *
 * `chunkCount` is what retrieval can actually reach, which is the number worth
 * showing: a 400 kB document that chunked to two passages is a document this
 * index cannot really read, and an installer seeing `2` next to it learns that.
 * The text itself is not echoed back -- it is already the caller's.
 */
export const knowledgeSourceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  version: z.string(),
  characters: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Where it came from: an upload, a crawled page, or a Drive file. */
  kind: z.enum(['upload', 'website', 'drive']).optional(),
  /** Unfilled template text found in it, with the section, for the installer to fix. */
  warnings: z
    .array(
      z.object({
        kind: z.enum(['placeholder', 'unfinished']),
        text: z.string(),
        section: z.string().nullable(),
      }),
    )
    .optional(),
});

export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

/**
 * An ingestion job.
 *
 * An upload is ingested synchronously and its job is written already finished.
 * A website crawl or a Drive sync is long-running, so its job moves through
 * `queued` → `running` → `succeeded` | `failed`, and the same id is rewritten as
 * it goes; `GET /v1/knowledge/jobs/:id` returns the latest state.
 */
export const INGESTION_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;

export type IngestionJobStatus = (typeof INGESTION_JOB_STATUSES)[number];

export const ingestionJobSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  /** Null when the job failed before there was a source to point at, or for a sync. */
  sourceId: z.string().nullable(),
  status: z.enum(INGESTION_JOB_STATUSES),
  /** Documents written (created or changed) by the job. */
  documents: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(),
  issues: z.array(knowledgeIssueSchema),
  startedAt: z.string(),
  /** Empty while the job is queued or running. */
  finishedAt: z.string(),
  /** What ran: a single upload, a website crawl, or a Drive folder sync. */
  kind: z.enum(['upload', 'website', 'drive']).optional(),
  /** The connection a sync job ran for. */
  connectionId: z.string().nullable().optional(),
  /** A sync's counts, so an installer can see what changed and what did not. */
  counts: z
    .object({
      /** Pages or files looked at. */
      seen: z.number().int().nonnegative(),
      unchanged: z.number().int().nonnegative(),
      deleted: z.number().int().nonnegative(),
      quarantined: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    })
    .optional(),
  /**
   * Where a running sync has got to: `reading` while it finds the pages or
   * files (the total is not known yet), then `indexing` with a known total.
   */
  progress: z
    .object({
      phase: z.enum(['reading', 'indexing']),
      done: z.number().int().nonnegative(),
      total: z.number().int().nonnegative().nullable(),
    })
    .optional(),
});

export type IngestionJob = z.infer<typeof ingestionJobSchema>;

/**
 * The answer to an onboarding request.
 *
 * `source` is null exactly when the job failed, which is what makes a client's
 * handling unambiguous: there is no state where a source exists but was not
 * ingested, or where a job succeeded and named nothing.
 */
export const knowledgeSourceResponseSchema = z.object({
  source: knowledgeSourceSchema.nullable(),
  job: ingestionJobSchema,
});

export type KnowledgeSourceResponse = z.infer<typeof knowledgeSourceResponseSchema>;

export const knowledgeJobResponseSchema = z.object({
  job: ingestionJobSchema,
});

export type KnowledgeJobResponse = z.infer<typeof knowledgeJobResponseSchema>;

/**
 * Connecting a knowledge source the platform keeps in sync (Blueprint §3.1):
 * the installer's website, crawled weekly, or a Google Drive folder, synced on
 * change. Either is re-synced on demand through the sync route.
 */
export const knowledgeConnectionRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    tenantId: z.string().min(1).max(120),
    kind: z.literal('website'),
    /** The site's address; only this origin is crawled. */
    url: z.string().url().max(2048),
    /** Page cap per crawl. */
    maxPages: z.number().int().min(1).max(1000).optional(),
  }),
  z.object({
    tenantId: z.string().min(1).max(120),
    kind: z.literal('drive'),
    /** The folder's id, from its Drive URL. */
    folderId: z.string().min(5).max(200),
    /**
     * `service_account`: the installer shared the folder (Viewer) with the
     * platform's service account. `oauth`: they connected with Google sign-in
     * and the refresh token is supplied here (never echoed back).
     */
    mode: z.enum(['service_account', 'oauth']),
    refreshToken: z.string().min(10).max(2048).optional(),
  }),
]);

export type KnowledgeConnectionRequest = z.infer<typeof knowledgeConnectionRequestSchema>;

export const KNOWLEDGE_CONNECTION_STATUSES = ['pending', 'syncing', 'connected', 'failed'] as const;

/** A connection as the API reports it. Credentials are never part of it. */
export const knowledgeConnectionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  kind: z.enum(['website', 'drive']),
  /** The site origin, or the Drive folder id. */
  target: z.string(),
  mode: z.enum(['crawl', 'service_account', 'oauth']),
  status: z.enum(KNOWLEDGE_CONNECTION_STATUSES),
  /** Why the last sync failed, in words an installer can act on. */
  lastError: z.string().nullable(),
  lastJobId: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  createdAt: z.string(),
});

export type KnowledgeConnection = z.infer<typeof knowledgeConnectionSchema>;

export const knowledgeSyncResponseSchema = z.object({
  connection: knowledgeConnectionSchema,
  job: ingestionJobSchema,
});

export type KnowledgeSyncResponse = z.infer<typeof knowledgeSyncResponseSchema>;
