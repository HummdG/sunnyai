import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveStatic } from '../../scripts/static-server.js';

/**
 * Serves the demo page and the widget bundle the page loads.
 *
 *   npx tsx apps/widget-demo/serve.ts [--port 4173]
 *
 * The widget comes from the package's own `dist`, so the demo always runs the
 * artefact that would be published rather than a second build with its own
 * configuration.
 */

const here = fileURLToPath(new URL('.', import.meta.url));

const portArg = process.argv.indexOf('--port');
const port = Number(portArg === -1 ? (process.env.PORT ?? 4173) : process.argv[portArg + 1]);

serveStatic({
  port,
  mounts: [
    // Order matters: the first mount whose directory holds the file wins, so the
    // specific prefix has to come before the catch-all.
    //
    // A *directory* prefix, not `/sunny-widget.js`. A mount's prefix is stripped
    // and the remainder resolved inside `dir`, with an empty remainder meaning
    // `index.html` -- so mounting the bundle under its own filename asked for
    // `dist/index.html`, found nothing, fell through to the catch-all and 404'd.
    // The demo page had been shipping an embed snippet that loaded no widget;
    // that only surfaced when a browser finally fetched it.
    { prefix: '/widget', dir: resolve(here, '../../packages/widget/dist') },
    {
      prefix: '/',
      dir: resolve(here, 'public'),
      missingHint: {
        '/widget/sunny-widget.js': 'The widget bundle is not built yet. Run: npm run build:widget',
      },
    },
  ],
  // The pages' embed snippets point at the default dev API (localhost:8787).
  // A run that starts its own API on another port -- the e2e suite, or anyone
  // keeping a dev server up meanwhile -- sets SUNNY_DEMO_API_URL so the widget
  // talks to that API, not to whatever happens to be listening on 8787.
  ...(process.env['SUNNY_DEMO_API_URL']
    ? {
        rewriteHtml: (html: string) =>
          html.replaceAll('http://localhost:8787', process.env['SUNNY_DEMO_API_URL']!),
      }
    : {}),
  onReady: (bound) => {
    console.log(`widget demo: http://localhost:${bound}`);
  },
});
