import { chunkDocuments } from './chunk.js';
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgeIndex,
  RetrievalResult,
} from './types.js';

/**
 * Retrieval over an installer's own documents, and what it is not.
 *
 * This is a **lexical** index: BM25 over the words the documents actually
 * contain. It is not a semantic one and it is not Google's. That distinction is
 * the point of the module rather than a caveat on it, because the plan's gate
 * for this phase is tenant isolation, update/delete visibility and ingestion
 * tests -- properties that belong to the pipeline and can be proven here -- while
 * the managed retrieval service it names is unreachable from this deployment
 * (no credentials, and its tenant-ACL isolation is Preview and unverified).
 * Building a lexical index means the pipeline can be real, tested and honest
 * today, and the swap to a managed index is a second implementation of
 * `searchIndex` rather than a rewrite of everything above it.
 *
 * Two properties follow from BM25 being what it is, and both are stated where a
 * caller can act on them rather than discovered in production:
 *
 *   - **It matches words, not meanings.** "cost" does not find "price". The
 *     assistant is told to search again with the installer's own vocabulary
 *     rather than to treat an empty result as evidence of nothing.
 *   - **It is deterministic.** The same query over the same documents returns
 *     the same passages in the same order, ties broken by chunk id. A retrieval
 *     step that shuffles would make every downstream test flaky and every
 *     citation unstable.
 */

/** Standard BM25 constants. Both are the textbook values, not tuned here. */
export const K1 = 1.2;
export const B = 0.75;

/** How many passages one lookup may return. */
export const DEFAULT_RESULT_LIMIT = 4;

/**
 * A tenant with no documents, as an index.
 *
 * A named empty rather than `undefined` defaults scattered through the callers:
 * "this installer has connected nothing" is a state the assistant has to be able
 * to tell apart from "retrieval is not wired up", and both are different from a
 * tenant whose documents simply did not match.
 */
export const EMPTY_KNOWLEDGE: KnowledgeIndex = { sourceCount: 0, chunks: [] };

export interface BuiltIndex {
  chunks: readonly KnowledgeChunk[];
  sourceCount: number;
  /** The token stream per chunk, heading included, built once per index. */
  tokens: Map<string, string[]>;
  documentFrequency: Map<string, number>;
  averageLength: number;
}

/**
 * The words in a piece of text, for matching purposes only.
 *
 * Hyphenated and dotted runs are kept whole *and* split, so `sb-430` is
 * findable by someone who types the part number and by someone who types the
 * one distinctive half of it. Lowercasing is the single piece of normalisation
 * in this package, and it happens here rather than in the chunker: it is a
 * property of the index and must never touch the text a visitor is shown.
 *
 * Tokens shorter than two characters are dropped -- `a`, `2` carry no signal on
 * their own -- which is a deliberate asymmetry: the *document's* short tokens
 * are dropped too, so a query for `2` cannot match only because a source
 * happened to be full of it. Two-character function words such as `of` are kept:
 * they are cheap, their document frequency makes BM25 discount them anyway, and
 * a stopword list is a vocabulary this package would then have to maintain in
 * every language an installer might write in.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9._\-/]*/g) ?? []) {
    const token = raw.replace(/[._\-/]+$/, '');
    if (token.length < 2) continue;
    out.push(token);
    if (/[._\-/]/.test(token)) {
      for (const part of token.split(/[._\-/]+/)) {
        if (part.length >= 2) out.push(part);
      }
    }
  }
  return out;
}

/**
 * Build the index for a tenant's chunks.
 *
 * Built per request from the stored documents rather than held across requests.
 * That is the honest choice at this size and it is also the one that makes
 * "update/delete reflected" true by construction: there is no second copy of
 * the corpus to go stale. The API layer memoises on the sources' own
 * `updatedAt`, so the work is not repeated within a turn, and a real deployment
 * would hand this to the managed index instead.
 */
export function buildIndex(chunks: readonly KnowledgeChunk[], sourceCount: number): BuiltIndex {
  const tokens = new Map<string, string[]>();
  const documentFrequency = new Map<string, number>();
  let total = 0;

  for (const chunk of chunks) {
    // The heading is searchable text: a query for "warranty" should reach the
    // clauses filed under a Warranty heading even when the body never says the
    // word again.
    const stream = tokenize(`${chunk.heading ?? ''}\n${chunk.text}`);
    tokens.set(chunk.id, stream);
    total += stream.length;
    for (const term of new Set(stream)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return {
    chunks,
    sourceCount,
    tokens,
    documentFrequency,
    // An empty corpus would divide by zero below; one is the neutral value that
    // makes the length normalisation term vanish.
    averageLength: chunks.length === 0 ? 1 : total / chunks.length,
  };
}

function idf(index: BuiltIndex, term: string): number {
  const df = index.documentFrequency.get(term) ?? 0;
  const n = index.chunks.length;
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

/**
 * Score every chunk against a query, best first.
 *
 * `missingTerms` is the other half of the answer, and it is why this returns a
 * result object rather than a list. A retrieval that returns nothing leaves the
 * assistant unable to tell "the installer has not documented this" from "I typed
 * the wrong word", and those need different behaviour: the first is a handoff,
 * the second is another search.
 */
export function searchIndex(
  index: BuiltIndex,
  query: string,
  limit: number = DEFAULT_RESULT_LIMIT,
): RetrievalResult {
  const terms = [...new Set(tokenize(query))];
  const missingTerms = terms.filter((term) => !index.documentFrequency.has(term)).sort();

  if (terms.length === 0 || index.chunks.length === 0) {
    return {
      hits: [],
      missingTerms,
      indexedChunks: index.chunks.length,
      indexedSources: index.sourceCount,
    };
  }

  const hits: KnowledgeHit[] = [];
  for (const chunk of index.chunks) {
    const stream = index.tokens.get(chunk.id) ?? [];
    const length = stream.length;
    const counts = new Map<string, number>();
    for (const token of stream) counts.set(token, (counts.get(token) ?? 0) + 1);

    let score = 0;
    const matchedTerms: string[] = [];
    for (const term of terms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      matchedTerms.push(term);
      const normaliser = 1 - B + (B * length) / index.averageLength;
      score += idf(index, term) * ((tf * (K1 + 1)) / (tf + K1 * normaliser));
    }

    // A chunk that shares no term with the query scores zero exactly. Dropping
    // it here rather than ranking it last is what keeps "no evidence" a fact
    // rather than a position in a list.
    if (score > 0) hits.push({ chunk, score, matchedTerms: matchedTerms.sort() });
  }

  hits.sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1));

  return {
    hits: hits.slice(0, Math.max(0, limit)),
    missingTerms,
    indexedChunks: index.chunks.length,
    indexedSources: index.sourceCount,
  };
}

/** Build and search in one call, for tests and for callers with one query. */
export function searchChunks(
  chunks: readonly KnowledgeChunk[],
  query: string,
  options: { limit?: number; sourceCount?: number } = {},
): RetrievalResult {
  const index = buildIndex(
    chunks,
    options.sourceCount ?? new Set(chunks.map((c) => c.documentId)).size,
  );
  return searchIndex(index, query, options.limit ?? DEFAULT_RESULT_LIMIT);
}

/** An index for a tenant's documents. */
export function indexDocuments(
  documents: readonly KnowledgeDocument[],
  sourceCount: number = documents.length,
): KnowledgeIndex {
  return { sourceCount, chunks: chunkDocuments(documents) };
}
