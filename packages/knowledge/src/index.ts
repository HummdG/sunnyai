// @sunny/knowledge — an installer's own documents, chunked and searchable.
//
// Pure, like `@sunny/solar-rules`: no network, no clock, no randomness, no
// store. Documents come in as records and passages come out, so the part of
// retrieval that decides what a visitor is told can be tested as arithmetic
// rather than observed as a conversation.
//
//   - `chunk.ts` splits a document into passages that keep their headings.
//   - `search.ts` scores those passages against a query (BM25).
//   - `hybrid.ts` fuses that lexical ranking with a vector ranking (RRF) and
//     an optional reranker. The vectors are passed in: computing embeddings
//     is a network call and lives in the API, so this stays arithmetic.
//   - `html.ts` turns crawled web pages into Markdown the chunker cuts well.
//   - `pii.ts` decides whether a document may be indexed at all.
//   - `placeholders.ts` finds unfilled template text so it is never quoted.

export * from './types.js';
export * from './chunk.js';
export * from './search.js';
export * from './hybrid.js';
export * from './html.js';
export * from './pii.js';
export * from './placeholders.js';
