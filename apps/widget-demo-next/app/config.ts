/**
 * The demo tenant, as this fixture sees it.
 *
 * Deliberately not read from the environment: a fixture whose configuration can
 * drift from its tests is a fixture that passes for the wrong reason. The
 * browser suite asserts against these same literals.
 */
export const PUBLIC_ID = 'w_demo000001';

/** The API, which runs beside this fixture during the browser suite. */
export const API_URL = 'http://localhost:8787';
