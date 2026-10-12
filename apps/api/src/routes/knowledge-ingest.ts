import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  ApiError,
  badRequestFromZod,
  knowledgeConnectionRequestSchema,
  type KnowledgeConnection,
  type KnowledgeSyncResponse,
} from '@sunny/contracts';
import { chunkDocuments, type Rerank } from '@sunny/knowledge';

import type { ServerConfig } from '../config.js';
import { createKnowledgeRetriever, type KnowledgeRetriever } from '../knowledge.js';
import { clientAddress, type RateLimitRule } from '../ratelimit.js';
import type { Store } from '../store.js';
import type { Tenant } from '../tenants.js';
import {
  oauthTokens,
  RestDriveClient,
  serviceAccountTokens,
  type DriveClient,
} from '../ingest/drive.js';
import {
  GeminiEmbedder,
  metadataToken,
  vertexReranker,
  type Embedder,
} from '../ingest/embeddings.js';
import { jinaFetcher, networkFetcher, assertPublicUrl, type Fetcher } from '../ingest/fetcher.js';
import {
  FileKnowledgeSyncStore,
  FirestoreKnowledgeSyncStore,
  publicConnection,
  type KnowledgeConnectionRecord,
  type KnowledgeSyncStore,
} from '../ingest/sync-store.js';
import { createKnowledgeSync, type KnowledgeSync } from '../ingest/sync.js';

/**
 * The knowledge pipeline's routes (Blueprint §3): connect a website or a Drive
 * folder, sync on demand, run due syncs (for Cloud Scheduler), list sources
 * with their warnings, and report what the pipeline can do on this deployment.
 *
 * Behind the admin token for now, the same as the upload route; the installer
 * portal reaches the same pipeline through `connector` below, behind its own
 * signed-in membership check.
 */

/** What tests (or a deployment) may swap out. Everything has a real default. */
export interface KnowledgePipelineOptions {
  fetcher?: Fetcher;
  driveClient?: (connection: KnowledgeConnectionRecord) => DriveClient | { error: string };
  embedder?: Embedder | null;
  rerank?: Rerank | null;
  syncStore?: KnowledgeSyncStore;
  env?: Record<string, string | undefined>;
  /** Checks a website URL before connecting it; defaults to the SSRF guard. */
  urlCheck?: (url: string) => Promise<unknown>;
}

export interface KnowledgePipeline {
  sync: KnowledgeSync;
  syncStore: KnowledgeSyncStore;
  /**
   * Hybrid retrieval. `passageSearch` is the chat core's default search
   * (`ServerDeps.passageSearch`); `retrieveKnowledge(tenantId, query)` returns
   * passages with citations for tools and routes.
   */
  retrieve: KnowledgeRetriever;
  /** The portal's view of the pipeline (`KnowledgeSyncConnector`). */
  connector: {
    syncWebsite: (tenant: Tenant, url: string) => Promise<{ jobId: string | null }>;
    syncDrive: (tenant: Tenant, folderId: string) => Promise<{ jobId: string | null }>;
  };
  capabilities: KnowledgeCapabilities;
}

export interface KnowledgeCapabilities {
  crawler: { available: true; renderer: 'built-in' | 'jina' };
  drive: {
    /** The address an installer shares their folder with, or null when unconfigured. */
    serviceAccountEmail: string | null;
    oauth: boolean;
  };
  semantic: { available: boolean; model: string | null; reason: string | null };
  rerank: { available: boolean; provider: 'vertex' | null };
  pdf: { available: false; reason: string };
}

interface RouteHelpers {
  config: ServerConfig;
  store: Store;
  tenants: { all: Tenant[] };
  now: () => number;
  enforceRateLimit: (
    request: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    subject: string,
    rule: RateLimitRule,
  ) => void;
  isAdmin: (request: FastifyRequest) => boolean;
}

export function createKnowledgePipeline(
  helpers: Pick<RouteHelpers, 'config' | 'store' | 'now'>,
  options: KnowledgePipelineOptions = {},
): KnowledgePipeline {
  const env = options.env ?? process.env;
  const { config, store, now } = helpers;

  const syncStore =
    options.syncStore ??
    (config.firestore
      ? new FirestoreKnowledgeSyncStore({
          project: config.firestore.project,
          databaseId: config.firestore.databaseId,
          emulatorHost: config.firestore.emulatorHost,
        })
      : new FileKnowledgeSyncStore(config.dataDir));

  const useJina = env['SUNNY_CRAWL_JINA'] === '1';
  const fetcher =
    options.fetcher ??
    (useJina
      ? jinaFetcher(env['JINA_API_KEY'] ? { apiKey: env['JINA_API_KEY'] } : {})
      : networkFetcher());

  const serviceAccountJson = env['GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON'] ?? null;
  let serviceAccountEmail: string | null = null;
  try {
    serviceAccountEmail = serviceAccountJson
      ? ((JSON.parse(serviceAccountJson) as { client_email?: string }).client_email ?? null)
      : null;
  } catch {
    serviceAccountEmail = null;
  }
  const oauthClient =
    env['GOOGLE_OAUTH_CLIENT_ID'] && env['GOOGLE_OAUTH_CLIENT_SECRET']
      ? { id: env['GOOGLE_OAUTH_CLIENT_ID'], secret: env['GOOGLE_OAUTH_CLIENT_SECRET'] }
      : null;
  const saTokens = serviceAccountJson ? safe(() => serviceAccountTokens(serviceAccountJson)) : null;

  const driveClient =
    options.driveClient ??
    ((connection: KnowledgeConnectionRecord): DriveClient | { error: string } => {
      if (connection.mode === 'oauth') {
        if (!oauthClient)
          return { error: 'Google sign-in for Drive is not configured on this deployment.' };
        if (!connection.refreshToken)
          return { error: 'This Drive connection has no Google sign-in token.' };
        return new RestDriveClient(oauthTokens(oauthClient, connection.refreshToken));
      }
      if (!saTokens) {
        return {
          error:
            'Drive sharing is not configured on this deployment (GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is unset).',
        };
      }
      return new RestDriveClient(saTokens);
    });

  const geminiKey = env['GEMINI_API_KEY'];
  const embedder =
    options.embedder !== undefined
      ? options.embedder
      : geminiKey
        ? new GeminiEmbedder({ apiKey: geminiKey, model: env['SUNNY_EMBEDDING_MODEL'] })
        : null;

  const rerankProject =
    env['SUNNY_RERANK'] === 'vertex' ? (env['GOOGLE_CLOUD_PROJECT'] ?? null) : null;
  const rerank =
    options.rerank !== undefined
      ? options.rerank
      : rerankProject
        ? vertexReranker({ project: rerankProject, token: metadataToken() })
        : null;

  const sync = createKnowledgeSync({ store, syncStore, now, fetcher, driveClient, embedder });
  const retrieve = createKnowledgeRetriever({ store, syncStore, embedder, rerank });

  return {
    sync,
    syncStore,
    retrieve,
    connector: {
      syncWebsite: async (tenant, url) => {
        const started = await sync.connect({ tenantId: tenant.id, kind: 'website', url });
        return { jobId: started.job.id };
      },
      syncDrive: async (tenant, folderId) => {
        const started = await sync.connect({
          tenantId: tenant.id,
          kind: 'drive',
          folderId,
          mode: 'service_account',
        });
        return { jobId: started.job.id };
      },
    },
    capabilities: {
      crawler: { available: true, renderer: useJina ? 'jina' : 'built-in' },
      drive: { serviceAccountEmail, oauth: oauthClient !== null },
      semantic: embedder
        ? { available: true, model: embedder.model, reason: null }
        : {
            available: false,
            model: null,
            reason: 'GEMINI_API_KEY is not set: retrieval is keyword-only (BM25).',
          },
      rerank: { available: rerank !== null, provider: rerank ? 'vertex' : null },
      pdf: {
        available: false,
        reason:
          'PDFs are recorded as needing extraction. Convert to a Google Doc, or run scripts/pdf-to-markdown.py and upload the Markdown.',
      },
    },
  };
}

function safe<T>(make: () => T): T | null {
  try {
    return make();
  } catch {
    return null;
  }
}

/** Register the routes and return the pipeline, so the server can share it. */
export function registerKnowledgeIngestRoutes(
  app: FastifyInstance,
  helpers: RouteHelpers,
  options: KnowledgePipelineOptions = {},
): KnowledgePipeline {
  const { config, store, tenants } = helpers;
  const pipeline = createKnowledgePipeline(helpers, options);

  const guard = (request: FastifyRequest, reply: FastifyReply): void => {
    if (config.adminToken === null) {
      throw new ApiError(
        'not_enabled',
        'Knowledge ingestion is disabled on this deployment (SUNNY_ADMIN_TOKEN is unset).',
      );
    }
    if (!helpers.isAdmin(request))
      throw new ApiError('unauthorized', 'A valid admin token is required.');
    helpers.enforceRateLimit(
      request,
      reply,
      'knowledge',
      clientAddress({
        socketAddress: request.raw.socket.remoteAddress,
        forwardedFor: request.headers['x-forwarded-for'],
        trustedHops: config.rateLimit.trustProxyHops,
      }),
      config.rateLimit.rules.knowledge,
    );
  };
  const tenantFrom = (tenantId: unknown): Tenant => {
    const tenant =
      typeof tenantId === 'string' ? tenants.all.find((t) => t.id === tenantId) : undefined;
    if (!tenant) throw new ApiError('not_found', 'Unknown tenant.');
    return tenant;
  };

  app.get('/v1/knowledge/capabilities', async (request, reply) => {
    guard(request, reply);
    return pipeline.capabilities;
  });

  app.post('/v1/knowledge/connections', async (request, reply) => {
    guard(request, reply);
    const body = knowledgeConnectionRequestSchema.safeParse(request.body);
    if (!body.success) throw badRequestFromZod(body.error);
    tenantFrom(body.data.tenantId);
    if (body.data.kind === 'website') {
      try {
        await (options.urlCheck ?? assertPublicUrl)(body.data.url);
      } catch (error) {
        throw new ApiError(
          'bad_request',
          error instanceof Error ? error.message : 'That URL cannot be crawled.',
        );
      }
    }
    const started = await pipeline.sync.connect(body.data);
    // The sync runs on; its job is polled at GET /v1/knowledge/jobs/:id.
    started.done.catch((error: unknown) => request.log.error({ error }, 'knowledge sync crashed'));
    const payload: KnowledgeSyncResponse = {
      connection: publicConnection(started.connection),
      job: started.job,
    };
    reply.code(202);
    return payload;
  });

  app.get('/v1/knowledge/connections', async (request, reply) => {
    guard(request, reply);
    const tenant = tenantFrom((request.query as { tenantId?: string }).tenantId);
    const connections: KnowledgeConnection[] = (
      await pipeline.syncStore.listConnections(tenant.id)
    ).map(publicConnection);
    return { connections };
  });

  app.post('/v1/knowledge/connections/:id/sync', async (request, reply) => {
    guard(request, reply);
    const tenant = tenantFrom((request.query as { tenantId?: string }).tenantId);
    const { id } = request.params as { id: string };
    const full = (request.body as { full?: unknown } | undefined)?.full === true;
    const started = await pipeline.sync.sync(tenant.id, id, { full });
    if (!started)
      throw new ApiError('not_found', 'No such knowledge connection for this installer.');
    started.done.catch((error: unknown) => request.log.error({ error }, 'knowledge sync crashed'));
    const connection = await pipeline.syncStore.getConnection(tenant.id, id);
    const payload: KnowledgeSyncResponse = {
      connection: publicConnection(connection!),
      job: started.job,
    };
    reply.code(202);
    return payload;
  });

  app.delete('/v1/knowledge/connections/:id', async (request, reply) => {
    guard(request, reply);
    const tenant = tenantFrom((request.query as { tenantId?: string }).tenantId);
    const { id } = request.params as { id: string };
    const removed = await pipeline.sync.disconnect(tenant.id, id);
    if (removed < 0)
      throw new ApiError('not_found', 'No such knowledge connection for this installer.');
    return { removedSources: removed };
  });

  /**
   * Run every sync that is due: websites weekly, Drive folders every fifteen
   * minutes. Cloud Scheduler calls this; an in-process timer would be throttled
   * on Cloud Run between requests.
   */
  app.post('/v1/knowledge/sync-due', async (request, reply) => {
    guard(request, reply);
    const jobs = await pipeline.sync.runDue();
    return { jobs };
  });

  /** A tenant's sources with what an installer needs to see: kind, size, warnings. */
  app.get('/v1/knowledge/sources', async (request, reply) => {
    guard(request, reply);
    const tenant = tenantFrom((request.query as { tenantId?: string }).tenantId);
    const sources = await store.listKnowledgeSources(tenant.id);
    return {
      sources: sources.map((source) => ({
        id: source.id,
        tenantId: source.tenantId,
        title: source.title,
        url: source.url,
        version: source.version,
        characters: source.text.length,
        chunkCount: chunkDocuments([
          {
            id: source.id,
            title: source.title,
            url: source.url,
            version: source.version,
            text: source.text,
          },
        ]).length,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        kind: source.kind ?? 'upload',
        warnings: source.warnings ?? [],
      })),
    };
  });

  return pipeline;
}
