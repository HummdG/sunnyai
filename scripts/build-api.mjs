#!/usr/bin/env node
// Builds the API for its container: `dist/api/`, a pruned copy of the repo
// holding only what the API runs, compiled from TypeScript to JavaScript.
//
//   node scripts/build-api.mjs            # build
//   cd dist/api && npm install --omit=dev # production dependencies (the Dockerfile does this)
//   node apps/api/src/main.js             # run
//
// **Compiled file by file, not bundled.** The API and the SunScan engine find
// their data by paths relative to their own source files -- the proposal PDF's
// fonts (`apps/api/assets/fonts`), the demo price list (`fixtures/pricing`),
// the OSTN15 grid (`packages/sunscan-engine/data`). A bundle would move every
// module into one file and break each of those paths quietly, at the moment a
// customer asked for a quote. Keeping the repo's layout keeps them true, and
// lets the image run on plain `node` rather than `tsx`, a development runner.
//
// The workspace packages export `./src/*.ts`; in the build they export the
// compiled `./src/*.js`, so `@sunny/contracts` resolves exactly as it does in
// development, through the workspace symlinks `npm install` makes.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'api');

/** The API and every workspace package it imports, directly or through another. */
const WORKSPACES = [
  'apps/api',
  'packages/contracts',
  'packages/knowledge',
  'packages/quote-engine',
  'packages/solar-rules',
  'packages/sunscan-adapter',
  'packages/sunscan-core',
  'packages/sunscan-engine',
];

/** Data the code reads at run time, by path relative to its own source. */
const DATA = ['apps/api/assets', 'packages/sunscan-engine/data', 'fixtures/pricing'];

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) out.push(...sources(file));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(file);
  }
  return out;
}

/** `./src/x.ts` -> `./src/x.js`, through any nesting of conditions. */
function toJs(value) {
  if (typeof value === 'string') return value.replace(/\.ts$/, '.js');
  if (value && typeof value === 'object') {
    // The type-only condition the adapter publishes has no runtime meaning.
    const entries = Object.entries(value).filter(([key]) => key !== 'sunny-facade');
    if (entries.length === 1 && entries[0][0] === 'default') return toJs(entries[0][1]);
    return Object.fromEntries(entries.map(([key, inner]) => [key, toJs(inner)]));
  }
  return value;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const entryPoints = WORKSPACES.flatMap((ws) => sources(path.join(ROOT, ws, 'src')));
await build({
  entryPoints,
  outdir: OUT,
  outbase: ROOT,
  bundle: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: 'linked',
  logLevel: 'warning',
});

for (const ws of WORKSPACES) {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, ws, 'package.json'), 'utf8'));
  delete pkg.scripts;
  delete pkg.devDependencies;
  if (pkg.main) pkg.main = toJs(pkg.main);
  if (pkg.exports) pkg.exports = toJs(pkg.exports);
  mkdirSync(path.join(OUT, ws), { recursive: true });
  writeFileSync(path.join(OUT, ws, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

for (const dir of DATA) {
  if (!existsSync(path.join(ROOT, dir))) throw new Error(`missing run-time data: ${dir}`);
  cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
}

// The root: the workspaces above and nothing else, and the lockfile, so the
// image installs the versions the tests ran against.
const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
writeFileSync(
  path.join(OUT, 'package.json'),
  `${JSON.stringify(
    {
      name: root.name,
      version: root.version,
      private: true,
      type: 'module',
      engines: root.engines,
      workspaces: WORKSPACES,
    },
    null,
    2,
  )}\n`,
);
cpSync(path.join(ROOT, 'package-lock.json'), path.join(OUT, 'package-lock.json'));

process.stdout.write(`built ${entryPoints.length} modules into ${path.relative(ROOT, OUT)}\n`);
