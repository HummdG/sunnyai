#!/usr/bin/env node
/**
 * Build the embeddable widget.
 *
 * One self-contained IIFE, because that is what the embed snippet promises. No
 * globals beyond the small `window.sunny` handle and no framework: the whole
 * character, animation engine and contracts bundle in.
 *
 * "Self-contained" is about the script, and two things are still fetched from
 * elsewhere at runtime: the API, and the typeface. The typeface is the reason
 * this build copies anything besides the bundle — the fonts are published *with*
 * the script, in `fonts/` beside it, so that wherever the file is served from
 * the faces come from there too. They are not inlined: two subsets are 49 kB of
 * binary against a 42 kB gzipped script, and every visitor who never opens the
 * panel would pay for them.
 *
 *   node scripts/build.mjs [--watch] [--outdir <dir>]
 */
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const outdirIndex = args.indexOf('--outdir');
const outdir = outdirIndex === -1 ? here('../dist') : args[outdirIndex + 1];

const pkg = JSON.parse(readFileSync(here('../package.json'), 'utf8'));

/**
 * Copy the family's subsets next to the bundle.
 *
 * The list is read off the directory rather than written here, and the invariant
 * that the directory holds exactly the faces `@sunny/ui` declares is a test
 * (`packages/ui/test/fonts.test.ts`) rather than a second list that can fall
 * behind. The bundle's `@font-face` rules name files in this directory, so a
 * missing one is a 404 on a customer's page: it is worth the line that says so
 * in the build output.
 */
function copyFonts() {
  const source = here('../../ui/fonts/');
  const files = readdirSync(source).filter((name) => name.endsWith('.woff2'));
  const target = `${outdir}/fonts`;

  mkdirSync(target, { recursive: true });

  let bytes = 0;
  for (const file of files) {
    copyFileSync(`${source}${file}`, `${target}/${file}`);
    bytes += statSync(`${target}/${file}`).size;
  }

  console.log(
    `widget: ${files.length} font subsets — ${(bytes / 1024).toFixed(1)} kB ` +
      `to ${target} (fetched on demand, not with the script)`,
  );
}

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
  copyFonts();

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('widget: watching');
    return;
  }

  const result = await build(options);

  // The voice add-on, a separate ESM file the widget imports on first press of
  // the microphone (src/voice.ts). Not counted against the widget's budget,
  // because tenants without the add-on never download it.
  const voiceResult = await build({
    ...options,
    entryPoints: [here('../src/voice.ts')],
    outfile: `${outdir}/sunny-voice.js`,
    format: 'esm',
  });
  const voiceFile = Object.keys(voiceResult.metafile.outputs).find((f) =>
    f.endsWith('sunny-voice.js'),
  );
  const voiceJs = readFileSync(voiceFile);
  console.log(
    `widget: ${voiceFile} — ${(voiceJs.length / 1024).toFixed(1)} kB ` +
      `(${(gzipSync(voiceJs).length / 1024).toFixed(1)} kB gzipped, loaded on demand)`,
  );
  // The 3D roof view (src/roof.ts: SunScan's three.js viewer and the house
  // synthesis), a separate ESM file the widget imports only when a visitor
  // presses "See your roof in 3D". Not counted against the widget's budget.
  const roofResult = await build({
    ...options,
    entryPoints: [here('../src/roof.ts')],
    outfile: `${outdir}/sunny-roof.js`,
    format: 'esm',
  });
  const roofFile = Object.keys(roofResult.metafile.outputs).find((f) =>
    f.endsWith('sunny-roof.js'),
  );
  const roofJs = readFileSync(roofFile);
  console.log(
    `widget: ${roofFile} — ${(roofJs.length / 1024).toFixed(1)} kB ` +
      `(${(gzipSync(roofJs).length / 1024).toFixed(1)} kB gzipped, loaded on demand)`,
  );
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
