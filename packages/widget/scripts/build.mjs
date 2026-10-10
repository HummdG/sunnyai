#!/usr/bin/env node
/**
 * Build the embeddable widget.
 *
 * One self-contained IIFE, because that is what the embed snippet promises. No
 * external requests, no globals beyond the small `window.sunny` handle, and no
 * framework: the whole character, animation engine and contracts bundle in.
 *
 *   node scripts/build.mjs [--watch] [--outdir <dir>]
 */
import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const outdirIndex = args.indexOf('--outdir');
const outdir = outdirIndex === -1 ? here('../dist') : args[outdirIndex + 1];

const pkg = JSON.parse(readFileSync(here('../package.json'), 'utf8'));

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [here('../src/index.ts')],
  outfile: `${outdir}/sunny-widget.js`,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // Broad enough for the browsers an installer's site will actually see. The
  // widget is embedded in other people's pages, so this is set by their
  // audience, not ours.
  target: ['es2020', 'chrome90', 'firefox90', 'safari15', 'edge90'],
  minify: !watch,
  sourcemap: !watch,
  legalComments: 'none',
  define: {
    __SUNNY_VERSION__: JSON.stringify(pkg.version),
  },
  // The contracts package pulls in zod, which is the single largest dependency.
  // It is genuinely needed -- the stream is parsed in the customer's browser and
  // must not be trusted -- so it stays in, and the size budget below enforces
  // that it has not grown without someone noticing.
  metafile: true,
  logLevel: 'info',
};

const SIZE_BUDGET_BYTES = 60 * 1024;

async function run() {
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('widget: watching');
    return;
  }

  const result = await build(options);
  const outFile = Object.keys(result.metafile.outputs).find((f) => f.endsWith('sunny-widget.js'));
  const js = readFileSync(outFile);
  const gzipped = gzipSync(js).length;

  console.log(
    `widget: ${outFile} — ${(js.length / 1024).toFixed(1)} kB ` +
      `(${(gzipped / 1024).toFixed(1)} kB gzipped)`,
  );

  // A budget rather than a report: the whole point of a single-file embed is
  // that it stays small, and a size that is only printed is a size that grows.
  if (gzipped > SIZE_BUDGET_BYTES) {
    console.error(
      `widget: FAILED the size budget — ${(gzipped / 1024).toFixed(1)} kB gzipped ` +
        `against a ${SIZE_BUDGET_BYTES / 1024} kB budget.`,
    );
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
