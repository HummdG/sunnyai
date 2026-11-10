import {
  searchChunks,
  type KnowledgeChunk,
  type KnowledgeHit,
  type KnowledgeIndex,
} from '@sunny/knowledge';

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
    // A single marker ("[S6]") or a group ("[S6, S7]", "[S6,S7]"): the model
    // writes both, and a grouped source the visitor never sees is a lost link.
    const refs = new Set(
      [...text.matchAll(/\[(S\d+(?:\s*,\s*S\d+)*)\]/g)].flatMap((m) =>
        m[1]!.split(',').map((ref) => ref.trim()),
      ),
    );
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

/** The most of one page added to a turn's context when it is read whole. */
export const MAX_PAGE_CHARS = 8000;

const WANTS_A_LIST = /\b(all|every|each|list|other|others|types|kinds)\b/i;

/**
 * The search hits, with the page they come from read whole when the visitor
 * wants all of something.
 *
 * Search hands the model a page's best passages, not the page. A page of "8
 * solar scams" is twelve passages, one per scam, and "what other scams are
 * there? list them all" brought back two of them, so the answer listed two and
 * could not know there were six more. When the question asks for a list, or
 * three of the hits come from the same page, that page's passages are all added
 * in their own order. It costs no model call, only the page's text, and a long
 * page is read outward from the passages that matched until the cap.
 */
export function withWholePage(
  index: KnowledgeIndex,
  hits: readonly KnowledgeHit[],
  message: string,
): readonly KnowledgeHit[] {
  const first = hits[0];
  if (!first) return hits;
  const perPage = new Map<string, number>();
  for (const hit of hits)
    perPage.set(hit.chunk.documentId, (perPage.get(hit.chunk.documentId) ?? 0) + 1);
  // The page with the most hits, the best-ranked one on a tie.
  const page = hits.reduce((best, hit) =>
    perPage.get(hit.chunk.documentId)! > perPage.get(best.chunk.documentId)! ? hit : best,
  ).chunk.documentId;
  if (perPage.get(page)! < 3 && !WANTS_A_LIST.test(message)) return hits;

  const matched = hits.filter((h) => h.chunk.documentId === page).map((h) => h.chunk.ordinal);
  const distance = (ordinal: number) => Math.min(...matched.map((m) => Math.abs(m - ordinal)));
  const nearestFirst = index.chunks
    .filter((c) => c.documentId === page)
    .sort((a, b) => distance(a.ordinal) - distance(b.ordinal) || a.ordinal - b.ordinal);
  const kept: KnowledgeChunk[] = [];
  let size = 0;
  for (const chunk of nearestFirst) {
    if (size + chunk.text.length > MAX_PAGE_CHARS && kept.length > 0) break;
    kept.push(chunk);
    size += chunk.text.length;
  }
  kept.sort((a, b) => a.ordinal - b.ordinal);

  const byId = new Map(hits.map((h) => [h.chunk.id, h]));
  const pageHits = kept.map((chunk) => byId.get(chunk.id) ?? { chunk, score: 0, matchedTerms: [] });
  // The page first, in reading order; the other pages' hits after it.
  return [...pageHits, ...hits.filter((h) => h.chunk.documentId !== page)];
}
