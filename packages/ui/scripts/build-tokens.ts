#!/usr/bin/env node
/**
 * Write `src/tokens.css` from the token definitions.
 *
 * The stylesheet is an artefact, not a source file. That is the whole point: a
 * hand-maintained token file drifts from the code that is supposed to own it,
 * and nothing notices until a page looks wrong. A test compares the file on disk
 * with what `cssVariables()` returns, so a hand edit fails the build rather than
 * becoming a mystery.
 *
 *   npm run build:tokens
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { cssVariables } from '../src/index.js';

const target = fileURLToPath(new URL('../src/tokens.css', import.meta.url));

writeFileSync(target, cssVariables(), 'utf8');
console.log(`ui: wrote ${target}`);
