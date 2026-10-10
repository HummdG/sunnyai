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
    { prefix: '/sunny-widget.js', dir: resolve(here, '../../packages/widget/dist') },
    {
      prefix: '/',
      dir: resolve(here, 'public'),
      missingHint: {
        '/sunny-widget.js':
          'The widget bundle is not built yet. Run: npm run build -w @sunny/widget',
      },
    },
  ],
  onReady: (bound) => {
    console.log(`widget demo: http://localhost:${bound}`);
  },
});
