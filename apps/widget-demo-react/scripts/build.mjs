#!/usr/bin/env node
/**
 * Build the React host fixture.
 *
 * esbuild rather than a framework's own build: the point of this app is to be a
 * *host* page, and the fewer moving parts between React and the widget the more
 * clearly a failure belongs to one of them. React's development build is what is
 * bundled, because `StrictMode`'s double-invocation of effects only happens in
 * development -- and that is one of the things being tested.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [here('../src/app.tsx')],
  outfile: here('../public/app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020', 'chrome90', 'firefox90', 'safari15', 'edge90'],
  jsx: 'automatic',
  // Deliberately not minified. A stack trace in this app should name the line in
  // `app.tsx` that threw, which is the whole value of having a fixture when
  // something does.
  minify: false,
  sourcemap: 'inline',
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"development"' },
};

await build(options).catch((error) => {
  console.error(error);
  process.exit(1);
});
