/**
 * Types for `jar-archive.mjs`.
 *
 * The checker is plain JavaScript because `firestore-emulator.mjs` is run by
 * `node` with no loader in front of it, and the test that holds it is
 * TypeScript because everything else in the suite is. This file is the seam
 * between the two: without it the test's import of the `.mjs` would be an
 * untyped module and `npm run typecheck` would refuse it.
 */
export declare function looksLikeJar(bytes: Uint8Array, declaredLength?: number): boolean;
