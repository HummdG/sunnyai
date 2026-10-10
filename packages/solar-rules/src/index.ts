// @sunny/solar-rules — everything Sunny decides without asking a model.
//
// This package is pure: no network, no clock, no randomness, no store. Time
// arrives as an argument, ids arrive as a function, and products arrive as
// records. That is what makes a recommendation reproducible — the same
// catalogue, answers and request produce the same response, byte for byte —
// and it is why the interesting behaviour here can be tested as arithmetic
// rather than observed as a conversation.
//
//   - `csv.ts` reads a file into rows, without guessing at a schema.
//   - `rows.ts` reads rows into products, and says what was wrong with each.
//   - `constraints.ts` holds the compatibility rules and their boundaries.
//   - `packages.ts` assembles, filters and ranks what gets shown.
//
// The split matters to the plan's honesty requirements: everything that turns
// an installer's typing into a claim a visitor reads happens in `rows.ts` and
// `constraints.ts`, where it can be reviewed on its own.

export * from './csv.js';
export * from './rows.js';
export * from './constraints.js';
export * from './packages.js';
