import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Copy the built widget bundle next to the marketing site.
 *
 * The marketing site embeds the real widget — the same file an integrator would
 * load — rather than a picture of it. Serving it from the site's own origin is
 * what the embed snippet promises, and it means a visitor to the marketing page
 * is exercising the same code path as a customer's visitor.
 *
 * The bundle is a build artefact of `@sunny/widget`, so it is not committed. If
 * it is missing, say so rather than shipping a page whose demo silently 404s.
 */
// This file is at `apps/marketing/scripts/`, so the repository root is three
// levels up rather than the two it looks like from the app directory.
const source = fileURLToPath(
  new URL('../../../packages/widget/dist/sunny-widget.js', import.meta.url),
);
const targetDir = fileURLToPath(new URL('../public/widget', import.meta.url));
const target = fileURLToPath(new URL('../public/widget/sunny-widget.js', import.meta.url));

if (!existsSync(source)) {
  console.error(
    `marketing: no widget bundle at ${source}\n` +
      'Run `npm run build:widget` from the repository root first.',
  );
  process.exitCode = 1;
} else {
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);
  console.log(`marketing: copied the widget bundle to ${target}`);
}
