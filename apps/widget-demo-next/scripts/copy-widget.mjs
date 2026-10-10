#!/usr/bin/env node
/**
 * Copy the built widget bundle where Next can serve it.
 *
 * This is the fixture's stand-in for a CDN. An integrator's Next site would
 * either point the snippet at a hosted bundle or serve it from `public/`, and
 * serving it from `public/` is the one that needs no network and no second
 * origin -- which matters, because the thing under test is the widget, not the
 * fixture's infrastructure.
 *
 * Deliberately the *built* artefact and never the source: the E2E run rebuilds
 * `packages/widget/dist` before this runs, so the fixture cannot pass against a
 * bundle that no longer exists.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const source = here('../../../packages/widget/dist/sunny-widget.js');
const destinationDir = here('../public/widget');

if (!existsSync(source)) {
  console.error(
    `widget-demo-next: no bundle at ${source}.\n` +
      'Run `npm run build:widget` from the repository root first.',
  );
  process.exit(1);
}

mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, `${destinationDir}/sunny-widget.js`);
console.log('widget-demo-next: copied the widget bundle into public/widget/');
