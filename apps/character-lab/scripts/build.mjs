#!/usr/bin/env node
/**
 * Bundle the animation lab.
 *
 * Unlike the widget this is a developer tool, so it is not size-budgeted and it
 * may use modern syntax. It is bundled rather than loaded as ESM modules because
 * the workspace packages resolve through path aliases that a browser does not
 * understand, and a bundler is the smallest thing that resolves them.
 */
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [here('../src/lab.ts')],
  outfile: here('../public/lab.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  logLevel: 'info',
  alias: {
    '@sunny/animation-engine': here('../../../packages/animation-engine/src/index.ts'),
    '@sunny/character': here('../../../packages/character/src/index.ts'),
    '@sunny/contracts': here('../../../packages/contracts/src/index.ts'),
    '@sunny/games': here('../../../packages/games/src/index.ts'),
  },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('character-lab: watching');
} else {
  await build(options);
}
