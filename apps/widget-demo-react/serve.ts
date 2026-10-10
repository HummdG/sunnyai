import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveStatic } from '../../scripts/static-server.js';

/**
 * Serves the React host fixture and the widget bundle it loads.
 *
 *   npx tsx apps/widget-demo-react/serve.ts [--port 4174]
 *
 * A port of its own so it can run beside the plain-HTML demo: the two pages test
 * different things, and being able to open both at once is how you tell a widget
 * bug from a host-page bug.
 */

const here = fileURLToPath(new URL('.', import.meta.url));

const portArg = process.argv.indexOf('--port');
const port = Number(portArg === -1 ? (process.env.PORT ?? 4174) : process.argv[portArg + 1]);

serveStatic({
  port,
  mounts: [
    { prefix: '/widget', dir: resolve(here, '../../packages/widget/dist') },
    { prefix: '/', dir: resolve(here, 'public') },
  ],
  onReady: (bound) => {
    console.log(`widget demo (react): http://localhost:${bound}`);
  },
});
