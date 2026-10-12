import { buildIndex, searchIndex } from './search.js';
import type { KnowledgeChunk, KnowledgeHit, RetrievalResult } from './types.js';

/**
 * Hybrid retrieval: keyword and meaning, fused (Blueprint §3.3).
 *
 * BM25 finds exact model numbers -- `IQ8M`, `REC420AA`, an SEG tariff code --
 * which an embedding blurs into "some inverter". Embeddings find "how much does
 * it cost" in a page that only ever says "price". Each misses what the other
 * catches, so both run and their rankings are merged by reciprocal rank fusion:
 * a passage near the top of *either* list rises, one near the top of both rises
 * furthest, and neither score scale has to be calibrated against the other.
 *
 * Pure: the vectors are passed in. Computing them is a network call and lives
 * in the API (`apps/api/src/ingest/embeddings.ts`); this module is the
 * arithmetic, which is what the tests need to be able to pin down.
 */

/** How many candidates each retriever contributes before fusion. */
export const CANDIDATES_PER_RETRIEVER = 15;
/** How many passages a lookup returns after fusion and reranking. */
export const HYBRID_RESULT_LIMIT = 5;
/** The standard RRF constant; damps the advantage of rank 1 over rank 2. */
export const RRF_K = 60;

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Merge ranked id lists. Ties broken by id, so the order is deterministic. */
export function reciprocalRankFusion(
  rankings: readonly (readonly string[])[],
  k: number = RRF_K,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

/** A reranker sees the query and the fused candidates and returns them reordered. */
export type Rerank = (
  query: string,
  candidates: readonly KnowledgeChunk[],
) => Promise<readonly string[]>;

export interface HybridOptions {
  /** The query's embedding; absent means "lexical only". */
  queryVector?: readonly number[] | null;
  /** Chunk embeddings by chunk id; chunks without one take part lexically only. */
  vectors?: ReadonlyMap<string, readonly number[]>;
  rerank?: Rerank | null;
  limit?: number;
  sourceCount?: number;
  /** Minimum cosine similarity for a vector-only candidate to count at all. */
  minSimilarity?: number;
}

export interface HybridResult extends RetrievalResult {
  mode: 'hybrid' | 'lexical';
  reranked: boolean;
}

/**
 * Search one tenant's chunks.
 *
 * The caller passes only that tenant's chunks; there is no tenant argument here
 * because there is nothing here that could reach another tenant's. The API
 * layer's `retrieveKnowledge` is where the tenant is resolved, from the server's
 * session -- never from the model.
 */
export async function hybridSearch(
  chunks: readonly KnowledgeChunk[],
  query: string,
  options: HybridOptions = {},
): Promise<HybridResult> {
  const limit = options.limit ?? HYBRID_RESULT_LIMIT;
  const sourceCount = options.sourceCount ?? new Set(chunks.map((c) => c.documentId)).size;
  const index = buildIndex(chunks, sourceCount);
  const lexical = searchIndex(index, query, CANDIDATES_PER_RETRIEVER);

  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const lexicalHits = new Map(lexical.hits.map((hit) => [hit.chunk.id, hit]));

  const vectorRanking: string[] = [];
  const similarity = new Map<string, number>();
  const queryVector = options.queryVector ?? null;
  if (queryVector && queryVector.length > 0 && options.vectors && options.vectors.size > 0) {
    const min = options.minSimilarity ?? 0.35;
    const scored: { id: string; s: number }[] = [];
    for (const chunk of chunks) {
      const vector = options.vectors.get(chunk.id);
      if (!vector) continue;
      const s = cosine(queryVector, vector);
      if (s >= min) scored.push({ id: chunk.id, s });
    }
    scored.sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1));
    for (const { id, s } of scored.slice(0, CANDIDATES_PER_RETRIEVER)) {
      vectorRanking.push(id);
      similarity.set(id, s);
    }
  }

  const mode: HybridResult['mode'] =
    queryVector && queryVector.length > 0 && (options.vectors?.size ?? 0) > 0
      ? 'hybrid'
      : 'lexical';
  const fused = reciprocalRankFusion([lexical.hits.map((h) => h.chunk.id), vectorRanking]);

  let order = fused.map((f) => f.id);
  let reranked = false;
  if (options.rerank && order.length > 1) {
    try {
      const candidates = order.map((id) => byId.get(id)!).filter(Boolean);
      const next = await options.rerank(query, candidates);
      const known = new Set(order);
      const kept = next.filter((id) => known.has(id));
      // A reranker may only reorder: anything it dropped keeps its fused place
      // after the ones it ranked, so a flaky reranker cannot lose evidence.
      order = [...kept, ...order.filter((id) => !kept.includes(id))];
      reranked = true;
    } catch {
      // A reranker outage degrades to the fused order rather than failing the turn.
    }
  }

  const fusedScore = new Map(fused.map((f) => [f.id, f.score]));
  const hits: KnowledgeHit[] = order.slice(0, Math.max(0, limit)).map((id) => {
    const lexicalHit = lexicalHits.get(id);
    return {
      chunk: byId.get(id)!,
      score: fusedScore.get(id) ?? 0,
      matchedTerms: lexicalHit?.matchedTerms ?? [],
    };
  });

  return {
    hits,
    // Only "missing" when meaning could not stand in for it: a term absent from
    // the corpus is still reported, but a semantic hit means the question is
    // not unanswered.
    missingTerms: lexical.missingTerms,
    indexedChunks: chunks.length,
    indexedSources: sourceCount,
    mode,
    reranked,
  };
}
