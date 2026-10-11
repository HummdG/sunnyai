import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Stage the page's own typeface for `next/font/local`.
 *
 * `next/font/local` resolves its `src` through the *app's* module graph, so the
 * file has to be inside `apps/marketing` even though the canonical copy lives in
 * `packages/ui/fonts/` — that is what the first attempt at this did not know, and
 * webpack said so rather than the face silently not loading.
 *
 * Copying rather than committing a second copy in the app is the whole point:
 * one file in the repository, one digest to verify, and the licence text in
 * `packages/ui/fonts/OFL.txt` next to it. A copy that drifts is exactly what a
 * committed duplicate becomes, and `packages/ui/test/fonts.test.ts` pins the
 * original.
 *
 * Only the Latin subset here. This page's text is English and ours; the wider
 * subsets the widget ships are for the text a customer's visitors type.
 *
 * This file is at `apps/marketing/scripts/`, so the repository root is three
 * levels up rather than the two it looks like from the app directory.
 */
const source = fileURLToPath(
  new URL('../../../packages/ui/fonts/plus-jakarta-sans-latin.woff2', import.meta.url),
);
const targetDir = fileURLToPath(new URL('../app/fonts', import.meta.url));
const target = fileURLToPath(
  new URL('../app/fonts/plus-jakarta-sans-latin.woff2', import.meta.url),
);

if (!existsSync(source)) {
  console.error(
    `marketing: no font at ${source}\n` +
      'The canonical subsets are committed in `packages/ui/fonts/`; see the ' +
      'provenance note beside them.',
  );
  process.exitCode = 1;
} else {
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);
  console.log(`marketing: staged the page's typeface at ${target}`);
}
