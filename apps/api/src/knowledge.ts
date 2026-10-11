import {
  chunkDocuments,
  EMPTY_KNOWLEDGE,
  type KnowledgeDocument,
  type KnowledgeIndex,
} from '@sunny/knowledge';

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
    cache.set(tenantId, { built: sources.map((source) => ({ ...source })), index });
    return index;
  };
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
