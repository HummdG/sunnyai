// @sunny/knowledge — an installer's own documents, chunked and searchable.
//
// Pure, like `@sunny/solar-rules`: no network, no clock, no randomness, no
// store. Documents come in as records and passages come out, so the part of
// retrieval that decides what a visitor is told can be tested as arithmetic
// rather than observed as a conversation.
//
//   - `chunk.ts` splits a document into passages that keep their headings.
//   - `search.ts` scores those passages against a query.
//
// What is deliberately absent matters as much as what is here. There is no
// embedding model, no vector store and no call to a managed search service:
// those are the parts this deployment cannot reach, and the honest position is a
// lexical index that works and says so (see the note at the top of `search.ts`)
// rather than a stub dressed as semantic retrieval.

export * from './types.js';
export * from './chunk.js';
export * from './search.js';
