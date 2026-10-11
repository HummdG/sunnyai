import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Firestore store must need no composite index, and this is what enforces it.
 *
 * A query that both filters (`where`) and orders (`orderBy`) needs a composite
 * index. Real Firestore refuses it until that index exists; **the emulator
 * allows it either way**, so a green run of `test:firestore` cannot tell the two
 * apart. That gap is the one place where the suite that proves the production
 * store works says nothing about the deployment that runs it -- which makes it
 * worth a check of its own, and the only thing left to check is the source.
 *
 * So this reads `firestore-store.ts` and fails when a single query carries both.
 * The rule is not "never order" or "never filter": either alone uses one
 * automatic single-field index. It is the pair that costs an index somebody has
 * to create, in a project this repository has not been given.
 *
 * The detector is exercised against a source that violates it before it is
 * pointed at the real file, because a guard that has only ever reported "clean"
 * is a guard nobody knows works.
 */

const here = dirname(fileURLToPath(import.meta.url));
const STORE = join(here, '..', 'src', 'firestore-store.ts');

/** Comments talk about queries; only code runs them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Statements that filter and order at once, which is what needs the index.
 *
 * Statement granularity rather than chain granularity: a query is one
 * expression, so it is one statement, and splitting on `;` finds every one of
 * them without having to parse the chain. The failure direction of a missed
 * statement boundary (two neighbouring statements read as one) is a false
 * *positive*, which is the direction that gets noticed; the other direction
 * cannot lose a violation, because a violation already has both calls in one
 * statement.
 */
export function filterAndOrderViolations(source: string): string[] {
  const code = stripComments(source);
  return code
    .split(';')
    .filter((statement) => statement.includes('.where(') && statement.includes('.orderBy('))
    .map((statement) => statement.replace(/\s+/g, ' ').trim().slice(0, 160));
}

describe('the Firestore store needs no composite index', () => {
  it('detects a query that both filters and orders', () => {
    const offending = `
      const snap = await this.#tenantDoc(tenantId)
        .collection('leads')
        .where('sessionId', '==', sessionId)
        .orderBy('createdAt', 'desc')
        .get();
    `;
    expect(filterAndOrderViolations(offending)).toHaveLength(1);
  });

  it('accepts either call on its own', () => {
    const filtersOnly = `await leads.where('sessionId', '==', sessionId).get();`;
    const ordersOnly = `await this.#tenantDoc(t).collection('leads').orderBy('createdAt', 'desc').get();`;
    expect(filterAndOrderViolations(filtersOnly)).toEqual([]);
    expect(filterAndOrderViolations(ordersOnly)).toEqual([]);
  });

  it('holds for every query in the store', async () => {
    const source = await readFile(STORE, 'utf8');
    // If this fails, the store gained a query that needs a composite index: add
    // the index to the deployment and record it in `docs/firestore.md`, or -- as
    // the store does everywhere else -- take the ordering in memory instead.
    expect(filterAndOrderViolations(source)).toEqual([]);
  });
});
