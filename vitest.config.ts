import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the `paths` in tsconfig.json. Tests import the packages by name,
    // exactly as the apps do, so nothing can pass a test through a relative
    // import that would not resolve in a real build.
    alias: {
      '@sunny/contracts': pkg('contracts'),
      '@sunny/character': pkg('character'),
      '@sunny/animation-engine': pkg('animation-engine'),
      '@sunny/games': pkg('games'),
      '@sunny/ui': pkg('ui'),
      '@sunny/solar-rules': pkg('solar-rules'),
      '@sunny/knowledge': pkg('knowledge'),
      '@sunny/sunscan-adapter': pkg('sunscan-adapter'),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      // The character's rendered output, compared against committed PNGs. Listed
      // separately from the two above because it is the one suite whose subject
      // is an image rather than an assertion about behaviour.
      'tests/visual/**/*.test.ts',
    ],
    // The Playwright suite in tests/e2e is run by `npm run test:e2e`, not here.
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    environment: 'node',
    // Generous on purpose, and raised after a real flake: when every worker runs
    // at once, the *first* test in a file can absorb that file's module import
    // (Fastify, zod, the packages) and blow a 5s budget while the code itself is
    // fine -- one such test failed at 6.1s alone in the suite and passed in
    // 1.6s for the whole file on its own. A timeout that fails a correct test is
    // worse than a longer one, and 20s still ends a genuine hang.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.d.ts', 'apps/widget-demo/**'],
    },
  },
});
