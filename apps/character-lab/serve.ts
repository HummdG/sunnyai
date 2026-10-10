import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveStatic } from '../../scripts/static-server.js';

/**
 * Serves the animation lab.
 *
 *   node apps/character-lab/scripts/build.mjs
 *   npx tsx apps/character-lab/serve.ts [--port 4180]
 */

const here = fileURLToPath(new URL('.', import.meta.url));

const portArg = process.argv.indexOf('--port');
const port = Number(portArg === -1 ? (process.env.PORT ?? 4180) : process.argv[portArg + 1]);

serveStatic({
  port,
  mounts: [
    {
      prefix: '/',
      dir: resolve(here, 'public'),
      missingHint: {
        '/lab.js': 'The lab is not built yet. Run: node apps/character-lab/scripts/build.mjs',
      },
    },
  ],
  onReady: (bound) => {
    console.log(`character lab: http://localhost:${bound}`);
  },
});
