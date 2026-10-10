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
      '@sunny/ui': pkg('ui'),
      '@sunny/solar-rules': pkg('solar-rules'),
      '@sunny/sunscan-adapter': pkg('sunscan-adapter'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // The Playwright suite in tests/e2e is run by `npm run test:e2e`, not here.
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.d.ts', 'apps/widget-demo/**'],
    },
  },
});
