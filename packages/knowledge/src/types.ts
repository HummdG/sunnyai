/**
 * What retrieval works on.
 *
 * A `KnowledgeDocument` is one thing an installer gave us: a page of their site,
 * a warranty PDF that has already been turned into text, a service-area list.
 * It carries its own provenance -- a title, the URL it came from if there was
 * one, and a version -- because a citation that cannot say which revision of the
 * warranty it read is not a citation.
 *
 * A `KnowledgeChunk` is the smallest thing retrieval can return, and it keeps
 * the document's provenance rather than pointing at it. A hit that has to be
 * joined back to its source before it can be cited is a hit that can be cited
 * wrongly; carrying the fields makes the citation a copy, not a lookup.
 */

export interface KnowledgeDocument {
  id: string;
  title: string;
  url: string | null;
  /** The installer's own version string: a date, a revision, a filename. */
  version: string;
  text: string;
}

export interface KnowledgeChunk {
  /** Deterministic: the same document chunked again yields the same ids. */
  id: string;
  documentId: string;
  title: string;
  url: string | null;
  version: string;
  /**
   * The nearest heading above this chunk, preserved rather than dropped.
   *
   * A passage that says "25 years" means nothing without the "Warranty" heading
   * it sat under, and the model reading it cannot see the heading it did not
   * get.
   */
  heading: string | null;
  /** Position within the document, so an order can be reconstructed. */
  ordinal: number;
  text: string;
  /**
   * The full heading trail above the chunk (H1 › H2 › H3), when it is deeper
   * than one heading. "Customer question: …" means little without the
   * "12. Generation change" it sits under, and a citation can name both.
   */
  section?: string[];
  /**
   * Unfilled template text in this chunk ("XXXXX XXXXXX", "[insert link]").
   * Retrieval masks these before the model sees the passage, so a placeholder
   * can never be quoted to a customer as if it were a real detail.
   */
  placeholders?: string[];
}

export interface KnowledgeHit {
  chunk: KnowledgeChunk;
  score: number;
  /** The query's own terms that this chunk contains, for a readable citation. */
  matchedTerms: string[];
}

export interface RetrievalResult {
  hits: KnowledgeHit[];
  /**
   * Query terms that appear nowhere in the index.
   *
   * Kept separate from "no hits" because the two are different answers: a query
   * whose words are all absent is asking about something the installer has not
   * documented, and saying so is more useful than a weak match on one word of
   * five.
   */
  missingTerms: string[];
  indexedChunks: number;
  indexedSources: number;
}

/** The tenant's whole searchable surface, and how many documents are behind it. */
export interface KnowledgeIndex {
  sourceCount: number;
  chunks: readonly KnowledgeChunk[];
}
