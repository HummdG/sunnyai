// Test support: repository paths and the recorded fixture inventory.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (packages/sunscan-engine/test/support -> ../../../..). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Directory with the recorded research data per address. */
export const FIXTURE_DIR = path.join(REPO_ROOT, 'fixtures', 'sunscan', 'raw');

/**
 * The test addresses vendored into Sunny: three of SunScanV2's nine (fixtures/sunscan/test-addresses.json lists all
 * nine; the raw research data and HTTP replay fixtures are copied for these three only, to keep the repository small).
 * The heritage and Scottish cases stay in SunScanV2's own suite.
 */
export const SLUGS = ['uk-mendips', 'uk-forthlin-road', 'wales-dylan-thomas-birthplace'] as const;

/** A fixture slug. */
export type Slug = (typeof SLUGS)[number];
