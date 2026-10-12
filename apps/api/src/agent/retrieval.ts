import { searchChunks, type KnowledgeHit, type KnowledgeIndex } from '@sunny/knowledge';

import type { CitedPassage } from './prompt.js';

/**
 * How a turn finds the installer's passages.
 *
 * ADAPTER POINT (knowledge workstream): the default is the lexical BM25 search
 * in `@sunny/knowledge`. The hybrid search (BM25 + embeddings + rerank,
 * Blueprint §3.3) plugs in here by passing a different `PassageSearch` to
 * `runTurn` -- the core does not care how hits are found, only that each one
 * carries the chunk's title, link and id for the citation.
 */
export type PassageSearch = (
  index: KnowledgeIndex,
  query: string,
  limit: number,
) => Promise<readonly KnowledgeHit[]>;

export const lexicalSearch: PassageSearch = (index, query, limit) => {
  if (index.sourceCount === 0 || query.trim() === '') return Promise.resolve([]);
  return Promise.resolve(
    searchChunks(index.chunks, query, { limit, sourceCount: index.sourceCount }).hits,
  );
};

/** Passages pre-retrieved into <verified_context> each turn (Blueprint §3.3: top 5). */
export const CONTEXT_PASSAGES = 5;

/**
 * Hands out stable `S1, S2, ...` markers for a turn, so a chunk retrieved twice
 * (up front and again by the tool) keeps the same marker and is cited once.
 */
export class CitationLedger {
  #byChunk = new Map<string, CitedPassage>();

  add(hits: readonly KnowledgeHit[]): CitedPassage[] {
    return hits.map((hit) => {
      const existing = this.#byChunk.get(hit.chunk.id);
      if (existing) return existing;
      const passage = { ref: `S${this.#byChunk.size + 1}`, chunk: hit.chunk };
      this.#byChunk.set(hit.chunk.id, passage);
      return passage;
    });
  }

  /**
   * The passages the answer actually cited, in marker order.
   *
   * Only cited ones: a source list that included everything retrieved would
   * attach the installer's warranty PDF to an answer about parking, which is a
   * citation claiming to support something it does not.
   */
  cited(text: string): CitedPassage[] {
    const refs = new Set([...text.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]));
    return [...this.#byChunk.values()].filter((p) => refs.has(p.ref));
  }
}

/** An http(s) link, or null: anything else is not offered to a visitor as a link. */
export function safeLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
