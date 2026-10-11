#!/usr/bin/env node
/**
 * Copy the built widget — the script and its typeface — out of the dist where it
 * is built and into an app that serves it.
 *
 * Two apps need this, and it is one function rather than two scripts because the
 * two are not quite the same job. A host that copies `sunny-widget.js` and not
 * the `fonts/` directory next to it still mounts, still renders, and still looks
 * fine: the widget falls back to the system stack, exactly as it does when a
 * font fails for any other reason, and nothing on the page says a word about it.
 * The first version of the marketing copy script did copy both, and the Next
 * fixture's did not, and the only thing that noticed was a test asserting the
 * page logged no 404s.
 *
 * The typeface is resolved against the directory the widget's *own script* was
 * served from, so the two have to travel together. That is the whole rule, and
 * this file is the one place it is written down.
 *
 * Deliberately the *built* artefact and never the source: the E2E run rebuilds
 * `packages/widget/dist` before this runs, so no fixture can pass against a
 * bundle that no longer exists.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BUNDLE = fileURLToPath(new URL('../packages/widget/dist/sunny-widget.js', import.meta.url));
const FONTS = fileURLToPath(new URL('../packages/widget/dist/fonts', import.meta.url));

/**
 * Copy both artefacts into `targetDir`, which becomes the widget's directory.
 *
 * `label` only prefixes the output, so a build log says which app is talking.
 * Returns false and sets a failing exit code if anything is missing — a build
 * that quietly serves a widget with no font is the failure this exists to stop.
 */
export function copyWidgetBundle(targetDir, label) {
  if (!existsSync(BUNDLE)) {
    console.error(
      `${label}: no widget bundle at ${BUNDLE}.\n` +
        'Run `npm run build:widget` from the repository root first.',
    );
    process.exitCode = 1;
    return false;
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(BUNDLE, `${targetDir}/sunny-widget.js`);
  console.log(`${label}: copied the widget bundle to ${targetDir}`);

  if (!existsSync(FONTS)) {
    console.error(
      `${label}: the bundle has no fonts at ${FONTS}.\n` +
        'The widget would render in the system stack. Run `npm run build:widget` again.',
    );
    process.exitCode = 1;
    return false;
  }

  const targetFonts = `${targetDir}/fonts`;
  cpSync(FONTS, targetFonts, { recursive: true });
  const bytes = readdirSync(targetFonts)
    .filter((name) => name.endsWith('.woff2'))
    .reduce((total, name) => total + statSync(`${targetFonts}/${name}`).size, 0);
  console.log(`${label}: copied ${(bytes / 1024).toFixed(1)} kB of font subsets to ${targetFonts}`);

  return true;
}
