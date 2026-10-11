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
});

export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

/**
 * Ingestion is synchronous in this build, so a job is written already finished.
 *
 * The status field is not decoration: the route pair exists because ingestion is
 * meant to be long-running once it has to crawl a site or walk a Drive folder,
 * and the client contract should not have to change when that happens. Today the
 * only statuses reachable are the two terminal ones, and `startedAt` and
 * `finishedAt` differ only by the work itself. Claiming a `queued` state that
 * never occurs would be describing a queue this code does not have.
 */
export const INGESTION_JOB_STATUSES = ['succeeded', 'failed'] as const;

export type IngestionJobStatus = (typeof INGESTION_JOB_STATUSES)[number];

export const ingestionJobSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  /** Null when the job failed before there was a source to point at. */
  sourceId: z.string().nullable(),
  status: z.enum(INGESTION_JOB_STATUSES),
  /** Documents offered to the job; always 1 today, one source per request. */
  documents: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(),
  issues: z.array(knowledgeIssueSchema),
  startedAt: z.string(),
  finishedAt: z.string(),
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
