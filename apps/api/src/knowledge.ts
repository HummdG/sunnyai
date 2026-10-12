import {
  chunkDocuments,
  EMPTY_KNOWLEDGE,
  HYBRID_RESULT_LIMIT,
  hybridSearch,
  maskPlaceholders,
  type KnowledgeDocument,
  type KnowledgeHit,
  type KnowledgeIndex,
  type Rerank,
} from '@sunny/knowledge';

import type { Embedder } from './ingest/embeddings.js';
import { embeddingKey } from './ingest/sync.js';
import type { KnowledgeSyncStore } from './ingest/sync-store.js';
import type { KnowledgeSourceRecord, Store } from './store.js';

/**
 * Turning a tenant's stored documents into the index a turn searches.
 *
 * The gate this phase has to pass is "update/delete reflected", and the way to
 * pass it is to have nothing that can go stale. So the *source of truth* is the
 * store, and a cached index is served only while the documents it was built from
 * are still the documents the store is holding. There is no invalidation call to
 * forget to make, which matters because the caller that would have to remember is
 * a route handler and the one that would have to forget is a test.
 *
 * Chunking is cached rather than recomputed per turn because a document is up to
 * two megabytes and the same one is chunked on every conversation the installer
 * ever has. Scoring is not cached: it is built per lookup, from chunks already in
 * memory, and a stale *ranking* is the one kind of staleness a key on the source
 * list would not catch.
 */
export function createKnowledgeLoader(store: Store) {
  const cache = new Map<string, { built: KnowledgeSourceRecord[]; index: KnowledgeIndex }>();

  function toDocument(source: KnowledgeSourceRecord): KnowledgeDocument {
    return {
      id: source.id,
      title: source.title,
      url: source.url,
      version: source.version,
      text: source.text,
    };
  }

  return async function loadKnowledgeIndex(tenantId: string): Promise<KnowledgeIndex> {
    const sources = await store.listKnowledgeSources(tenantId);
    if (sources.length === 0) {
      // Dropped rather than left to expire: an installer who deletes their last
      // document should not leave two megabytes of it resident, and there is
      // nothing correct left for the cache to say.
      cache.delete(tenantId);
      return EMPTY_KNOWLEDGE;
    }

    const cached = cache.get(tenantId);
    if (cached && unchanged(cached.built, sources)) return cached.index;

    const index: KnowledgeIndex = {
      sourceCount: sources.length,
      chunks: chunkDocuments(sources.map(toDocument)),
    };
    INDEX_TENANT.set(index, tenantId);
    cache.set(tenantId, { built: sources.map((source) => ({ ...source })), index });
    return index;
  };
}

/**
 * Which tenant an index was loaded for, as recorded by the loader itself.
 *
 * The chat core hands a search function an index, not a tenant. The hybrid
 * search needs the tenant to read that tenant's cached embeddings, and it must
 * not take it from anywhere a caller -- or the model -- could choose. So the
 * loader, which is only ever called with the tenant the server resolved from the
 * signed session, stamps every index object it builds; an index it did not build
 * has no tenant, and search over it is lexical only.
 */
const INDEX_TENANT = new WeakMap<KnowledgeIndex, string>();

export function tenantOfIndex(index: KnowledgeIndex): string | null {
  return INDEX_TENANT.get(index) ?? null;
}

/**
 * Whether the cached index was built from exactly these documents.
 *
 * Compared on the documents themselves rather than on a timestamp, which is the
 * obvious cheaper key and is wrong in one case that matters: two writes to the
 * same document within a single clock tick, where the second edit carries the
 * first's `updatedAt` and the cache would then serve the replaced text for as
 * long as the process lives. There is no timestamp resolution fine enough to
 * make that impossible, so the key is the content.
 *
 * Every field a chunk is derived from is compared, which is what makes a rename
 * or a version bump visible even when the body is untouched -- the citation a
 * passage carries is assembled from the title, the url and the version, so a
 * change to any of them has to rebuild. Field-by-field rather than by joining
 * the text into one string, because joining copies both megabytes on every turn
 * while comparing two identical strings does not.
 *
 * A field added to `KnowledgeSourceRecord` later must be added here too, or an
 * edit to *only* that field will not be reflected. That is the one maintenance
 * hazard in this file and it is why the list is spelled out rather than derived.
 */
function unchanged(
  built: readonly KnowledgeSourceRecord[],
  sources: readonly KnowledgeSourceRecord[],
): boolean {
  if (built.length !== sources.length) return false;
  return sources.every((source, at) => {
    const before = built[at];
    return (
      before !== undefined &&
      before.id === source.id &&
      before.version === source.version &&
      before.title === source.title &&
      before.url === source.url &&
      before.text === source.text
    );
  });
}

export type KnowledgeLoader = ReturnType<typeof createKnowledgeLoader>;

// ─── retrieval for the assistant ─────────────────────────────────────────────

/** Where a passage came from, in the form a citation needs. */
export interface KnowledgeCitation {
  title: string;
  /** The page URL, the Drive file link, or null for an upload with none. */
  url: string | null;
  version: string;
  kind: 'upload' | 'website' | 'drive';
  /** The section trail, e.g. "12. Generation change › Customer question: …". */
  section: string | null;
}

export interface RetrievedPassage {
  chunkId: string;
  /** Passage text, with any unfilled placeholder masked -- never quotable as a detail. */
  text: string;
  heading: string | null;
  citation: KnowledgeCitation;
  score: number;
  matchedTerms: string[];
  /** True when a placeholder was masked in `text`. */
  hasPlaceholder: boolean;
}

export interface KnowledgeLookup {
  /** False when the installer has connected nothing: say so, do not guess. */
  configured: boolean;
  /** `hybrid` when embeddings took part, `lexical` when BM25 answered alone. */
  mode: 'hybrid' | 'lexical';
  passages: RetrievedPassage[];
  missingTerms: string[];
  indexedChunks: number;
  indexedSources: number;
}

export interface KnowledgeRetrieverDeps {
  store: Store;
  loader?: KnowledgeLoader;
  syncStore?: KnowledgeSyncStore | null;
  embedder?: Embedder | null;
  rerank?: Rerank | null;
}

/**
 * The function the assistant's `retrieve_knowledge` tool should call.
 *
 * `tenantId` must be the tenant the *server* resolved from the signed session
 * (Blueprint §4.2): it is never a tool argument, so the model cannot choose it.
 * Only that tenant's sources are loaded, and only that tenant's cached vectors
 * are read, so there is no code path from one installer's question to another
 * installer's passage.
 *
 * Embeddings are best-effort: a missing key, an outage or a timeout drops to
 * BM25 for that lookup and the answer still comes back.
 */
export function createKnowledgeRetriever(deps: KnowledgeRetrieverDeps) {
  const loader = deps.loader ?? createKnowledgeLoader(deps.store);
  const queryCache = new Map<string, number[]>();

  /** The tenant's cached passage vectors and the query's, or nothing (lexical). */
  async function vectorsFor(
    tenantId: string | null,
    index: KnowledgeIndex,
    query: string,
  ): Promise<{ queryVector: number[] | null; vectors?: Map<string, number[]> }> {
    const embedder = deps.embedder ?? null;
    if (!tenantId || !embedder || !deps.syncStore || query.trim() === '')
      return { queryVector: null };
    try {
      const keyed = index.chunks.map((chunk) => ({
        id: chunk.id,
        key: embeddingKey(embedder.model, chunk),
      }));
      const cached = await deps.syncStore.getEmbeddings(
        tenantId,
        embedder.model,
        keyed.map((k) => k.key),
      );
      if (cached.size === 0) return { queryVector: null };
      const vectors = new Map<string, number[]>();
      for (const { id, key } of keyed) {
        const v = cached.get(key);
        if (v) vectors.set(id, v);
      }
      const cacheKey = `${embedder.model}\u0000${query}`;
      const queryVector = queryCache.get(cacheKey) ?? (await embedder.embedQuery(query));
      if (queryCache.size > 500) queryCache.clear();
      queryCache.set(cacheKey, queryVector);
      return { queryVector, vectors };
    } catch {
      // An embedding outage is a lexical lookup, not a failed turn.
      return { queryVector: null };
    }
  }

  /**
   * One search over one tenant's index. Hits come back with any placeholder in
   * the passage masked (`maskPlaceholders`), so unfilled template text such as
   * "XXXXX XXXXXX" can reach the model only as "[not yet provided by the
   * installer]" -- never as something to quote.
   */
  async function search(
    tenantId: string | null,
    index: KnowledgeIndex,
    query: string,
    limit: number,
  ) {
    const { queryVector, vectors } = await vectorsFor(tenantId, index, query);
    const result = await hybridSearch(index.chunks, query, {
      queryVector,
      ...(vectors ? { vectors } : {}),
      rerank: deps.rerank ?? null,
      limit,
      sourceCount: index.sourceCount,
    });
    const hits: KnowledgeHit[] = result.hits.map((hit) =>
      hit.chunk.placeholders?.length
        ? { ...hit, chunk: { ...hit.chunk, text: maskPlaceholders(hit.chunk.text) } }
        : hit,
    );
    return { ...result, hits };
  }

  /**
   * The chat core's `PassageSearch` (apps/api/src/agent/retrieval.ts): the
   * server passes this as the default `passageSearch`. The tenant is the one the
   * server's own loader stamped on the index (`tenantOfIndex`).
   */
  async function passageSearch(
    index: KnowledgeIndex,
    query: string,
    limit: number,
  ): Promise<readonly KnowledgeHit[]> {
    if (index.sourceCount === 0 || query.trim() === '') return [];
    return (await search(tenantOfIndex(index), index, query, limit)).hits;
  }

  /** A lookup by tenant, with citations: for tools, routes and tests. */
  async function retrieveKnowledge(
    tenantId: string,
    query: string,
    options: { limit?: number } = {},
  ): Promise<KnowledgeLookup> {
    const index = await loader(tenantId);
    if (index.sourceCount === 0) {
      return {
        configured: false,
        mode: 'lexical',
        passages: [],
        missingTerms: [],
        indexedChunks: 0,
        indexedSources: 0,
      };
    }
    const sources = new Map(
      (await deps.store.listKnowledgeSources(tenantId)).map((s) => [s.id, s]),
    );
    const result = await search(tenantId, index, query, options.limit ?? HYBRID_RESULT_LIMIT);
    return {
      configured: true,
      mode: result.mode,
      passages: result.hits.map((hit) => ({
        chunkId: hit.chunk.id,
        text: hit.chunk.text,
        heading: hit.chunk.heading,
        citation: {
          title: hit.chunk.title,
          url: hit.chunk.url,
          version: hit.chunk.version,
          kind: sources.get(hit.chunk.documentId)?.kind ?? 'upload',
          section: hit.chunk.section?.slice(1).join(' › ') || hit.chunk.heading,
        },
        score: hit.score,
        matchedTerms: hit.matchedTerms,
        hasPlaceholder: (hit.chunk.placeholders?.length ?? 0) > 0,
      })),
      missingTerms: result.missingTerms,
      indexedChunks: result.indexedChunks,
      indexedSources: result.indexedSources,
    };
  }

  return { retrieveKnowledge, passageSearch };
}

export type KnowledgeRetriever = ReturnType<typeof createKnowledgeRetriever>;
